import type { HumanVerificationScope } from "@/domain/human-verification";
import type { ManpowerAcceptanceResult } from "@/domain/manpower-acceptance";

/**
 * UI-2 bounded read-model boundary -- shared vocabulary.
 *
 * This is the single source of truth for the frontend-facing trust /
 * currentness / scope / capability vocabulary. UI-1's
 * src/components/ui/status-primitives.tsx independently declares the same
 * VERIFIED/UNVERIFIED/... label set for rendering; its string literals must
 * stay identical to the ones below (checked by
 * src/test/read-models/read-model-mapping.test.ts) until a later phase
 * imports this module directly from that component.
 *
 * The canonical backend declares at least four independently-evolved trust
 * vocabularies with overlapping but non-identical members:
 *   - VerificationState        domain/database.ts (and duplicated in domain/verification.ts)
 *   - BuyerEvidenceState       domain/buyer-vendor-intelligence.ts
 *   - IntelligenceState        domain/temporal-project-intelligence.ts (structurally identical to BuyerEvidenceState)
 *   - AggregationReviewState   domain/evidence-aggregation.ts
 * Every mapping function below documents which backend vocabulary it
 * projects from and why each member lands where it does.
 */

export const READ_MODEL_TRUST_STATES = [
  "VERIFIED", "UNVERIFIED", "CANDIDATE", "INFERENCE", "STALE", "CONFLICT",
  "MISSING_EVIDENCE", "HUMAN_VERIFICATION_REQUIRED", "BLOCKED", "NOT_APPLICABLE",
] as const;
export type ReadModelTrustState = (typeof READ_MODEL_TRUST_STATES)[number];

export const READ_MODEL_CURRENTNESS_STATES = ["CURRENT", "AGING", "STALE", "UNKNOWN"] as const;
export type ReadModelCurrentness = (typeof READ_MODEL_CURRENTNESS_STATES)[number];

export const READ_MODEL_SCOPE_KINDS = ["COMPANY", "DIVISION", "PROJECT", "TRADE", "UNKNOWN"] as const;
export type ReadModelScopeKind = (typeof READ_MODEL_SCOPE_KINDS)[number];

export const READ_MODEL_CAPABILITY_STATES = ["OPERATIONAL", "PARTIAL", "PLANNED", "UNAVAILABLE", "UNKNOWN"] as const;
export type ReadModelCapabilityState = (typeof READ_MODEL_CAPABILITY_STATES)[number];

/**
 * Semantic only -- UI-2R removed the presentation-language `label` field
 * this type used to carry (I18N-0 confirmed issue #2). `divisionName` is not
 * a presentation label invented by this boundary: it is the original
 * free-text division/subsidiary name a human already entered upstream
 * (domain/human-verification.ts's HumanVerificationScope.divisionOrSubsidiary),
 * the same "proper noun / original source content" category as a company
 * name -- it passes through unchanged regardless of display language, it is
 * never translated. Rendering (e.g. "Project {projectId}" in English,
 * "Proyecto {projectId}" in Spanish) belongs entirely to a future UI
 * presentation layer, never to this read-model boundary.
 */
export interface ScopeDescriptor {
  readonly kind: ReadModelScopeKind;
  readonly companyId: string | null;
  readonly projectId: string | null;
  readonly divisionName: string | null;
  readonly tradeId: string | null;
}

export const UNKNOWN_SCOPE: ScopeDescriptor = { kind: "UNKNOWN", companyId: null, projectId: null, divisionName: null, tradeId: null };

export interface ProvenanceRef {
  readonly evidenceId: string | null;
  readonly claimId: string | null;
  readonly sourceUrl: string | null;
}

export interface TrustMetadata {
  readonly asOf: string;
  readonly currentness: ReadModelCurrentness;
  readonly verificationState: ReadModelTrustState;
  readonly scope: ScopeDescriptor;
  readonly provenanceRefs: readonly ProvenanceRef[];
  readonly capabilityState: ReadModelCapabilityState;
  readonly effectivePeriod: { readonly from: string | null; readonly until: string | null } | null;
}

/**
 * A metric that may legitimately be zero, may be genuinely unknown (the
 * assembler was not given a value at all), or may be structurally
 * unavailable (no canonical assembler exists yet to produce it). Never
 * collapse any of these three into a bare `0` or `null` -- see UI-2 section 21.
 */
export type MetricValue =
  | { readonly state: "KNOWN"; readonly value: number }
  | { readonly state: "UNKNOWN" }
  | { readonly state: "UNAVAILABLE"; readonly reason: string };

export const knownMetric = (value: number): MetricValue => ({ state: "KNOWN", value });
export const unknownMetric = (): MetricValue => ({ state: "UNKNOWN" });
export const unavailableMetric = (reason: string): MetricValue => ({ state: "UNAVAILABLE", reason });

/**
 * Projects domain/database.ts VerificationState (claims, aliases, contact
 * routes/people, company roles). REJECTED maps to BLOCKED, not UNVERIFIED --
 * a rejected fact must never present as merely "not yet checked."
 */
export function mapDatabaseVerificationState(state: "UNVERIFIED" | "VERIFIED" | "REJECTED" | "STALE"): ReadModelTrustState {
  if (state === "VERIFIED") return "VERIFIED";
  if (state === "REJECTED") return "BLOCKED";
  if (state === "STALE") return "STALE";
  return "UNVERIFIED";
}

/**
 * Projects domain/buyer-vendor-intelligence.ts BuyerEvidenceState and the
 * structurally-identical domain/temporal-project-intelligence.ts
 * IntelligenceState. CANDIDATE never upgrades to VERIFIED here -- only a real
 * human verification event (a different backend call this function never
 * sees) can do that.
 */
export function mapCandidateEvidenceState(state: "UNKNOWN" | "CANDIDATE" | "VERIFIED" | "CONFLICTING" | "REJECTED" | "STALE"): ReadModelTrustState {
  if (state === "VERIFIED") return "VERIFIED";
  if (state === "CANDIDATE") return "CANDIDATE";
  if (state === "CONFLICTING") return "CONFLICT";
  if (state === "REJECTED") return "BLOCKED";
  if (state === "STALE") return "STALE";
  return "UNVERIFIED";
}

/**
 * Projects domain/manpower-acceptance.ts ManpowerAcceptanceResult (AF01).
 * VERIFIED_POSITIVE and VERIFIED_NEGATIVE both map to VERIFIED -- a negative
 * result is still a verified fact. Callers read the paired `accepted`
 * boolean (see opportunity-radar.ts's ExternalManpowerAcceptanceView) to
 * learn which one it was; this function alone cannot and must not guess.
 */
export function mapManpowerAcceptanceTrustState(result: ManpowerAcceptanceResult): ReadModelTrustState {
  if (result === "VERIFIED_POSITIVE" || result === "VERIFIED_NEGATIVE") return "VERIFIED";
  if (result === "NOT_VERIFIED") return "UNVERIFIED";
  if (result === "INSUFFICIENT_EVIDENCE") return "MISSING_EVIDENCE";
  return "STALE";
}

/**
 * Currentness is derived, never invented: it requires the caller's own
 * `asOf` instant and the record's own `staleAfter` -- `null` means "the
 * backend asserts no expiry" (CURRENT), `undefined` means "the assembler was
 * not given this information at all" and must stay UNKNOWN, never silently
 * CURRENT. `agingWindowMs` is a UI-2 presentation default, not a canonical
 * business rule.
 */
export function currentnessFromStaleAfter(asOf: Date, staleAfter: Date | null | undefined, agingWindowMs = 14 * 24 * 60 * 60 * 1000): ReadModelCurrentness {
  if (staleAfter === undefined) return "UNKNOWN";
  if (staleAfter === null) return "CURRENT";
  const remaining = staleAfter.getTime() - asOf.getTime();
  if (remaining <= 0) return "STALE";
  if (remaining <= agingWindowMs) return "AGING";
  return "CURRENT";
}

/**
 * For records that carry a "last observed" timestamp rather than an explicit
 * staleAfter deadline (e.g. CompanyRecord.lastSeenAt, SourceRecord.lastSeenAt,
 * DemandSignal.observedAt). Thresholds are a UI-2 presentation default;
 * change them here, not silently inside a calling assembler.
 */
export function currentnessFromLastObserved(
  asOf: Date,
  lastObservedAt: Date | null | undefined,
  agingAfterMs = 30 * 24 * 60 * 60 * 1000,
  staleAfterMs = 180 * 24 * 60 * 60 * 1000,
): ReadModelCurrentness {
  if (lastObservedAt === undefined || lastObservedAt === null) return "UNKNOWN";
  const age = asOf.getTime() - lastObservedAt.getTime();
  if (age <= agingAfterMs) return "CURRENT";
  if (age <= staleAfterMs) return "AGING";
  return "STALE";
}

/**
 * Projects domain/human-verification.ts HumanVerificationScope onto the
 * frontend scope vocabulary. Absence of an explicit scope, or a scope with no
 * positively-identified dimension, is always UNKNOWN -- never widened to
 * COMPANY/global.
 */
export function scopeFromHumanVerificationScope(scope: HumanVerificationScope | null | undefined): ScopeDescriptor {
  if (!scope) return UNKNOWN_SCOPE;
  if (scope.projectId) return { ...UNKNOWN_SCOPE, kind: "PROJECT", projectId: scope.projectId };
  if (scope.tradeId) return { ...UNKNOWN_SCOPE, kind: "TRADE", tradeId: scope.tradeId };
  if (scope.companyScope === "DIVISION" || scope.companyScope === "SUBSIDIARY") {
    return { ...UNKNOWN_SCOPE, kind: "DIVISION", divisionName: scope.divisionOrSubsidiary ?? null };
  }
  if (scope.companyScope === "COMPANYWIDE") return { ...UNKNOWN_SCOPE, kind: "COMPANY" };
  return UNKNOWN_SCOPE;
}

export function toProvenanceRefs(input: {
  evidenceIds?: readonly (string | null | undefined)[] | null;
  claimIds?: readonly (string | null | undefined)[] | null;
  sourceUrls?: readonly (string | null | undefined)[] | null;
}): ProvenanceRef[] {
  const refs: ProvenanceRef[] = [];
  for (const id of input.evidenceIds ?? []) if (id) refs.push({ evidenceId: id, claimId: null, sourceUrl: null });
  for (const id of input.claimIds ?? []) if (id) refs.push({ evidenceId: null, claimId: id, sourceUrl: null });
  for (const url of input.sourceUrls ?? []) if (url) refs.push({ evidenceId: null, claimId: null, sourceUrl: url });
  return refs;
}
