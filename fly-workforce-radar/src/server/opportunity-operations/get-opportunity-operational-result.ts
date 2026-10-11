import { getProductionSqlClient } from "../database/production-sql-client";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresOpportunityRepository } from "../repositories/opportunity/postgres-opportunity-repository";
import { PostgresEligibilityRepository } from "../repositories/eligibility/postgres-eligibility-repository";
import { computeOpportunityGraph } from "../services/opportunity/opportunity-service";
import { EligibilityService } from "../services/eligibility/eligibility-service";
import { ScoringService } from "../services/scoring/scoring-service";
import { CommercialActionService } from "../services/commercial-action/commercial-action-service";
import { gatedCommercialActionForGraph } from "../services/opportunity-actionability/opportunity-actionability-service";
import type { ActionabilityInput, ActionabilityState, GatedCommercialActionResult } from "../../domain/opportunity-actionability";
import { actionabilityInputFromClaims, describeActionabilityClaimStatus, type ActionabilityClaimStatus } from "../../domain/opportunity-actionability-claim";
import type { OpportunityGraph, OpportunityGap, OpportunityLifecycle } from "../../domain/opportunity";
import type { EligibilityResult, EligibilitySnapshot, EligibilityType, RequirementResult } from "../../domain/eligibility";
import type { ScoreResult, ScoreSnapshot } from "../../domain/scoring";
import type { CommercialActionResult } from "../../domain/commercial-action";
import type { EligibilityRepository } from "../repositories/eligibility/eligibility-repository";
import type { ScoringRepository } from "../repositories/scoring/scoring-repository";
import type { CommercialActionRepository } from "../repositories/commercial-action/commercial-action-repository";

/**
 * Read-only canonical operational evaluation for one real, Postgres-backed
 * opportunity. Reuses the exact same non-persisting composition pattern
 * already established (and tested) by active-lead-service.ts,
 * decision-preview-service.ts and opportunity-actionability-service.ts: real
 * EligibilityService/ScoringService/CommercialActionService `.assess()`
 * calls (never `.evaluate()`) fed by no-op repositories, so nothing is ever
 * written to eligibility_evaluation_snapshots, scoring snapshots, or
 * commercial_actions merely by rendering a page. The only difference from
 * those three files is the graph source: this module loads the REAL graph
 * from Postgres (via OpportunityRepository.loadGraph + the pure
 * computeOpportunityGraph extracted from OpportunityService.graph) instead
 * of a synthetic opportunity-qualification-service Seed.
 *
 * No new eligibility/HOT/scoring/commercial-action rule is defined here.
 * The only new judgment calls are the four-way product classification (see
 * classifyOperationalStatus) and the human-readable explanation strings,
 * both built strictly from fields these canonical services already compute.
 */

const noopEligibility: EligibilityRepository = {
  async activeEvidenceIds(ids) { return ids; },
  async save(r) { return { ...r, id: "unused", createdAt: r.evaluatedAt }; },
  async list() { return []; },
};
const noopScoring: ScoringRepository = {
  async save(r) { return { ...r, id: "unused", createdAt: r.evaluatedAt }; },
  async list() { return []; },
};
const noopActions: CommercialActionRepository = {
  async save(r) { return { ...r, id: "unused", createdAt: r.evaluatedAt }; },
  async list() { return []; },
};

export const OPERATIONAL_CLASSIFICATIONS = ["HOT", "NEAR_READY", "WATCH", "NOT_ACTIONABLE"] as const;
export type OperationalClassification = (typeof OPERATIONAL_CLASSIFICATIONS)[number];

export interface OperationalEligibilityView {
  readonly eligibilityType: EligibilityType;
  readonly eligible: boolean;
  readonly failedRequirements: readonly { readonly code: string; readonly detail: string }[];
}

/**
 * Structured, code-carrying reason for the classification -- the
 * presentation layer (see present-operational-result.ts) localizes each
 * `kind` into commercial language via operationalRadar.reason.{kind} in the
 * i18n dictionary. classificationReason (below) stays the existing raw
 * English technical sentence, preserved for the audit/technical-detail view
 * -- this type is what lets the *primary* UI stop showing that raw text.
 */
export type ClassificationReasonCode =
  | { readonly kind: "HOT_ACTIVE"; readonly eligibilityType: EligibilityType }
  | { readonly kind: "LIFECYCLE_CLOSED" }
  | { readonly kind: "ACTIONABILITY_TERMINAL"; readonly actionabilityState: ActionabilityState }
  | { readonly kind: "ELIGIBLE_BUT_INACTIVE"; readonly eligibilityType: EligibilityType; readonly actionabilityState: ActionabilityState }
  | { readonly kind: "CLOSE_TO_ELIGIBLE"; readonly eligibilityType: EligibilityType; readonly missingCount: number }
  | { readonly kind: "WATCH" };

const ACTIONABILITY_TERMINAL_STATES = new Set<ActionabilityState>(["EXPIRED", "CLOSED", "AWARDED", "CANCELLED", "TERMINATED"]);

export interface OperationalResult {
  readonly opportunityId: string;
  readonly identityKey: string;
  readonly title: string | null;
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly projectRef: string | null;
  readonly location: string | null;
  readonly lifecycle: OpportunityLifecycle;
  readonly classification: OperationalClassification;
  /** Raw, technical English sentence -- audit/technical-detail use only. */
  readonly classificationReason: string;
  readonly classificationReasonCode: ClassificationReasonCode;
  readonly eligibility: readonly OperationalEligibilityView[];
  readonly score: { readonly state: ScoreResult["state"]; readonly score: number | null };
  readonly commercialAction: { readonly action: CommercialActionResult["action"]; readonly explanation: string; readonly preventedStrongerActions: readonly string[] };
  /** The full, real CommercialActionService.assess() result -- exposed so a
   * cross-opportunity consumer (Command Center's "next commercial actions"
   * panel) can reuse the existing assembleCommercialActionItem() read-model
   * assembler directly instead of a second, parallel mapping. */
  readonly commercialActionResult: CommercialActionResult;
  readonly gatedAction: { readonly gate: GatedCommercialActionResult["gate"]; readonly activeRecommendation: GatedCommercialActionResult["activeRecommendation"]; readonly explanation: string };
  readonly actionability: { readonly state: GatedCommercialActionResult["actionability"]["state"]; readonly explanation: string; readonly blockers: readonly string[] };
  /** NONE: no actionability-status evidence has ever been submitted for this
   * opportunity. PENDING: submitted but not yet human-verified. VERIFIED: a
   * human-verified claim exists and was used to compute `actionability`
   * above. See the Actionability Capture workflow. */
  readonly actionabilityClaimStatus: ActionabilityClaimStatus;
  readonly humanVerificationRequired: boolean;
  readonly gaps: readonly OpportunityGap[];
  readonly conflicts: readonly string[];
  /** Structured missing items (code + raw technical detail). The
   * presentation layer maps `code` to a commercial sentence; `detail` stays
   * available for the technical/audit view. */
  readonly missing: readonly { readonly code: string; readonly detail: string }[];
  /** Raw, technical English sentence -- audit/technical-detail use only. */
  readonly nextStep: string;
  readonly asOf: string;
}

export function requirementDetails(result: EligibilityResult): { code: string; detail: string }[] {
  return result.requirements.filter((r: RequirementResult) => !r.passed).map((r) => ({ code: r.code, detail: r.detail }));
}

/**
 * Classification rules, each traced to an existing canonical field:
 *  - HOT: exactly active-lead-service.ts's ActiveHotLead.active definition
 *    (eligible for HOT_A/HOT_B AND actionability-gated "active").
 *  - NOT_ACTIONABLE: opportunity.lifecycle === "CLOSED" -- a real, persisted
 *    domain/opportunity.ts field, not inferred.
 *  - NEAR_READY has two reused sub-cases: (a) eligible for HOT_A/HOT_B but
 *    blocked only by actionability gating -- this is exactly
 *    active-lead-service.ts's ActiveHotLeadMetrics.technicallyEligibleButInactive
 *    concept; (b) not yet eligible, but at most 2 named requirements remain
 *    on the closer HOT type -- the same "<=2 blockers -> NEAR_READY" threshold
 *    hot-conversion-engine-service.ts's readiness() already uses, applied
 *    here to EligibilityResult.failedRequirements instead of that file's own
 *    ConversionBlockerCode list (that engine's own input shape could not be
 *    populated from real Postgres opportunities without a new, unproven
 *    adapter -- see the accompanying report's Part 1 finding).
 *  - WATCH is the explicit residual: a real, legitimate, non-closed
 *    opportunity that is neither HOT nor NEAR_READY. A further WATCH/
 *    NOT_ACTIONABLE split by staleness or blocker severity would be a new
 *    business rule this task does not invent silently (see report Part J).
 */
export function classifyOperationalStatus(
  graph: OpportunityGraph,
  eligibility: readonly EligibilityResult[],
  gated: GatedCommercialActionResult,
): { classification: OperationalClassification; reason: string; reasonCode: ClassificationReasonCode } {
  const hotA = eligibility.find((e) => e.eligibilityType === "HOT_A_ELIGIBLE")!;
  const hotB = eligibility.find((e) => e.eligibilityType === "HOT_B_ELIGIBLE")!;
  const activeHotA = hotA.eligible && gated.countsAsActiveHotA;
  const activeHotB = hotB.eligible && gated.countsAsActiveHotB;

  if (activeHotA || activeHotB) {
    const eligibilityType = activeHotA ? "HOT_A_ELIGIBLE" : "HOT_B_ELIGIBLE";
    return { classification: "HOT", reason: `Eligible for ${eligibilityType} and currently actionable (${gated.activeRecommendation}).`, reasonCode: { kind: "HOT_ACTIVE", eligibilityType } };
  }

  if (graph.opportunity.lifecycle === "CLOSED") {
    return { classification: "NOT_ACTIONABLE", reason: "This opportunity's lifecycle is CLOSED; it cannot justify further commercial action.", reasonCode: { kind: "LIFECYCLE_CLOSED" } };
  }

  // A verified terminal actionability observation (EXPIRED/CLOSED/AWARDED/
  // CANCELLED/TERMINATED) means there is no realistic path to HOT regardless
  // of eligibility -- this must never present as NEAR_READY (which implies
  // real, ongoing hope of progression). Checked before the eligible-but-
  // inactive branch below specifically because that branch would otherwise
  // also match a technically-eligible-but-terminal opportunity.
  if (ACTIONABILITY_TERMINAL_STATES.has(gated.actionability.state)) {
    return { classification: "NOT_ACTIONABLE", reason: `Verified actionability state is ${gated.actionability.state}; no realistic path to HOT remains.`, reasonCode: { kind: "ACTIONABILITY_TERMINAL", actionabilityState: gated.actionability.state } };
  }

  const technicallyEligibleButInactive = hotA.eligible || hotB.eligible;
  if (technicallyEligibleButInactive) {
    const eligibilityType = hotA.eligible ? "HOT_A_ELIGIBLE" : "HOT_B_ELIGIBLE";
    return { classification: "NEAR_READY", reason: `Eligible for ${eligibilityType} but not currently actionable: ${gated.explanation}`, reasonCode: { kind: "ELIGIBLE_BUT_INACTIVE", eligibilityType, actionabilityState: gated.actionability.state } };
  }

  const closerType = hotA.failedRequirements.length <= hotB.failedRequirements.length ? hotA : hotB;
  const closerFailedCount = closerType.failedRequirements.length;
  if (closerFailedCount > 0 && closerFailedCount <= 2) {
    const details = requirementDetails(closerType).map((r) => r.detail).join("; ");
    return { classification: "NEAR_READY", reason: `${closerFailedCount} specific requirement(s) remain for ${closerType.eligibilityType}: ${details}.`, reasonCode: { kind: "CLOSE_TO_ELIGIBLE", eligibilityType: closerType.eligibilityType, missingCount: closerFailedCount } };
  }

  return { classification: "WATCH", reason: "A legitimate opportunity, but not yet close to HOT eligibility and not currently ready for commercial action.", reasonCode: { kind: "WATCH" } };
}

export function missingFor(eligibility: readonly EligibilityResult[], graph: OpportunityGraph): { code: string; detail: string }[] {
  const hotA = eligibility.find((e) => e.eligibilityType === "HOT_A_ELIGIBLE")!;
  const hotB = eligibility.find((e) => e.eligibilityType === "HOT_B_ELIGIBLE")!;
  const closer = hotA.failedRequirements.length <= hotB.failedRequirements.length ? hotA : hotB;
  if (closer.failedRequirements.length > 0) return requirementDetails(closer);
  return graph.gaps.map((g) => ({ code: g, detail: g }));
}

/**
 * actionabilityInput, when omitted, is now derived from a real, human-
 * VERIFIED opportunity_actionability_status claim if one exists (see
 * actionabilityInputFromClaims in domain/opportunity-actionability-claim.ts
 * -- the Actionability Capture workflow's read side), falling back to
 * NO_ACTIONABILITY_EVIDENCE only when no such verified claim is present.
 * This is the same honest default already established for the
 * qualification fixtures (opportunity-actionability-service.ts): absence of
 * verified evidence is never treated as evidence of openness. The explicit
 * parameter still exists so tests can prove the HOT branch itself is
 * correct without needing a full claim/verification fixture -- production
 * callers never override it.
 */
export async function evaluateOpportunityOperationalResult(
  opportunityId: string,
  asOf: Date,
  client: SqlClient,
  actionabilityInput?: ActionabilityInput,
): Promise<OperationalResult> {
  const opportunityRepo = new PostgresOpportunityRepository(client);
  const raw = await opportunityRepo.loadGraph(opportunityId, asOf);
  const graph = computeOpportunityGraph(raw, asOf);

  // Replicates EligibilityService.evaluate()'s own evidence-active filter
  // (a real, read-only Postgres query) so eligibility fidelity matches the
  // persisting path exactly -- only the trailing save() is skipped.
  const eligibilityRepo = new PostgresEligibilityRepository(client);
  const activeIds = new Set(await eligibilityRepo.activeEvidenceIds(graph.evidence.map((e) => String(e.id)), asOf));
  const liveGraph: OpportunityGraph = { ...graph, evidence: graph.evidence.filter((e) => activeIds.has(String(e.id))) };

  const eligibility = new EligibilityService({ graph: async () => liveGraph }, noopEligibility, () => asOf).assess(liveGraph, asOf);
  const snapshots: EligibilitySnapshot[] = eligibility.map((r) => ({ ...r, id: `live:${r.opportunityId}:${r.eligibilityType}`, createdAt: asOf }));
  const score = new ScoringService({ graph: async () => liveGraph }, noopEligibility, noopScoring, () => asOf).assess(liveGraph, snapshots, asOf);
  const scoreSnapshot: ScoreSnapshot = { ...score, id: `live:${liveGraph.opportunity.id}:score`, createdAt: asOf };
  const action = new CommercialActionService({ graph: async () => liveGraph }, noopEligibility, noopScoring, noopActions, () => asOf).assess(liveGraph, snapshots, [scoreSnapshot], asOf);
  const resolvedActionabilityInput = actionabilityInput ?? actionabilityInputFromClaims(opportunityId, liveGraph.claims as unknown as { predicate: string; claim_value: unknown; verification_state: string; supporting_evidence_id: string | null; asserted_at: string | Date }[]);
  const gated = gatedCommercialActionForGraph(liveGraph, resolvedActionabilityInput, asOf);

  const { classification, reason, reasonCode } = classifyOperationalStatus(liveGraph, eligibility, gated);
  const humanVerificationRequired = eligibility.some((e) => e.failedRequirements.includes("HUMAN_VERIFICATION_REQUIRED"));
  const actionabilityClaimStatus = describeActionabilityClaimStatus(liveGraph.claims as unknown as { predicate: string; claim_value: unknown; verification_state: string; supporting_evidence_id: string | null; asserted_at: string | Date }[]);

  const company = liveGraph.companies[0] as Record<string, unknown> | undefined;
  const project = liveGraph.project as Record<string, unknown> | null;

  return {
    opportunityId: liveGraph.opportunity.id,
    identityKey: liveGraph.opportunity.identityKey,
    title: liveGraph.opportunity.title,
    companyId: (company?.id as string | null) ?? null,
    companyName: (company?.common_name as string | null) ?? (company?.legal_name as string | null) ?? null,
    projectRef: liveGraph.opportunity.projectId,
    location: (project?.location_text as string | null) ?? null,
    lifecycle: liveGraph.opportunity.lifecycle,
    classification,
    classificationReason: reason,
    classificationReasonCode: reasonCode,
    eligibility: eligibility.map((e) => ({ eligibilityType: e.eligibilityType, eligible: e.eligible, failedRequirements: requirementDetails(e) })),
    score: { state: score.state, score: score.score },
    commercialAction: { action: action.action, explanation: action.explanation, preventedStrongerActions: action.preventedStrongerActions },
    commercialActionResult: action,
    gatedAction: { gate: gated.gate, activeRecommendation: gated.activeRecommendation, explanation: gated.explanation },
    actionability: { state: gated.actionability.state, explanation: gated.actionability.explanation, blockers: gated.actionability.blockers },
    actionabilityClaimStatus,
    humanVerificationRequired,
    gaps: liveGraph.gaps,
    conflicts: liveGraph.conflicts,
    missing: missingFor(eligibility, liveGraph),
    // gated.explanation and action.explanation both already start with the
    // action code itself (e.g. "CALL_TODAY is active: ..."), so this is not
    // re-prefixed here -- doing so previously produced a duplicated label.
    nextStep: gated.gate === "ACTIVE" ? gated.explanation : action.explanation,
    asOf: asOf.toISOString(),
  };
}

export type OperationalResultOutcome =
  | { readonly state: "READY"; readonly result: OperationalResult }
  | { readonly state: "NOT_FOUND"; readonly result: null }
  | { readonly state: "UNAVAILABLE" | "ERROR"; readonly result: null; readonly reason: string };

export async function loadOpportunityOperationalResult(opportunityId: string, asOf: Date = new Date()): Promise<OperationalResultOutcome> {
  const client = getProductionSqlClient();
  if (!client) return { state: "UNAVAILABLE", result: null, reason: "DATABASE_CONNECTION_UNAVAILABLE" };
  try {
    const result = await evaluateOpportunityOperationalResult(opportunityId, asOf, client);
    return { state: "READY", result };
  } catch (error) {
    if (error instanceof Error && error.message === "Opportunity not found") return { state: "NOT_FOUND", result: null };
    return { state: "ERROR", result: null, reason: "OPERATIONAL_EVALUATION_FAILED" };
  }
}
