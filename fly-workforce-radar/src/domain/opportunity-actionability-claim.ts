import type { ActionabilityInput, ExplicitTerminalStatus } from "./opportunity-actionability";
import { NO_ACTIONABILITY_EVIDENCE } from "./opportunity-actionability";

/**
 * The persisted shape of a claims.claim_value row for predicate
 * "opportunity_actionability_status" (subject_type OPPORTUNITY). This is the
 * one new fact opportunity-actionability-service.ts's ActionabilityInput has
 * always needed and the real schema had no capture path for -- see the
 * Visible Action UX report's Actionability Capture section. Every field
 * mirrors ActionabilityInput 1:1; nothing here is a new business rule, it is
 * only a JSON encoding of exactly what that existing type already requires.
 */
export interface OpportunityActionabilityClaimValue {
  readonly status: ExplicitTerminalStatus | "OPEN";
  readonly freshUntil: string | null;
  readonly deadlineDate: string | null;
  readonly deadlineKind: "ORIGINAL" | "AMENDMENT" | null;
  readonly startDate: string | null;
}

export function isOpportunityActionabilityClaimValue(value: unknown): value is OpportunityActionabilityClaimValue {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.status === "string";
}

interface ActionabilityClaimRow {
  readonly predicate: string;
  readonly claim_value: unknown;
  readonly verification_state: string;
  readonly supporting_evidence_id: string | null;
  readonly asserted_at: string | Date;
}

const ACTIONABILITY_PREDICATE = "opportunity_actionability_status";

/**
 * Pure: picks the latest VERIFIED opportunity_actionability_status claim (if
 * any) and maps it onto a real ActionabilityInput. An UNVERIFIED or REJECTED
 * candidate never feeds actionability -- matching opportunity-actionability-
 * service.ts's own rule that "absence of evidence is never treated as
 * evidence of openness," this applies equally to *unverified* evidence: only
 * a human-verified observation is trusted here. Falls back to the same
 * NO_ACTIONABILITY_EVIDENCE default used everywhere else in this codebase
 * when no verified claim exists.
 */
export function actionabilityInputFromClaims(opportunityId: string, claims: readonly ActionabilityClaimRow[]): ActionabilityInput {
  const verified = claims
    .filter((c) => c.predicate === ACTIONABILITY_PREDICATE && c.verification_state === "VERIFIED" && isOpportunityActionabilityClaimValue(c.claim_value))
    .sort((a, b) => new Date(b.asserted_at).getTime() - new Date(a.asserted_at).getTime());
  const latest = verified[0];
  if (!latest) return NO_ACTIONABILITY_EVIDENCE(opportunityId);
  const value = latest.claim_value as OpportunityActionabilityClaimValue;
  const evidenceIds = latest.supporting_evidence_id ? [latest.supporting_evidence_id] : [];
  return {
    opportunityId,
    explicitStatus: value.status,
    explicitStatusFreshUntil: value.freshUntil ? new Date(value.freshUntil) : null,
    deadlines: value.deadlineDate ? [{ kind: value.deadlineKind ?? "ORIGINAL", date: new Date(value.deadlineDate), observedAt: new Date(latest.asserted_at), evidenceIds }] : [],
    startDate: value.startDate ? new Date(value.startDate) : null,
    evidenceIds,
  };
}

export const ACTIONABILITY_CLAIM_STATUSES = ["NONE", "PENDING", "VERIFIED", "REJECTED"] as const;
export type ActionabilityClaimStatus = (typeof ACTIONABILITY_CLAIM_STATUSES)[number];

/**
 * For the UI: is there any actionability-status claim at all, and where is
 * it in the existing Human Verification lifecycle? "REJECTED"/"STALE"
 * claims never reach this function at all -- loadGraph() already excludes
 * them from OpportunityGraph.claims, so their absence here is itself
 * truthful (they simply do not count as pending or verified evidence).
 */
export function describeActionabilityClaimStatus(claims: readonly ActionabilityClaimRow[]): ActionabilityClaimStatus {
  const relevant = claims.filter((c) => c.predicate === ACTIONABILITY_PREDICATE);
  if (!relevant.length) return "NONE";
  return relevant.some((c) => c.verification_state === "VERIFIED") ? "VERIFIED" : "PENDING";
}

export { ACTIONABILITY_PREDICATE as OPPORTUNITY_ACTIONABILITY_STATUS_PREDICATE };
