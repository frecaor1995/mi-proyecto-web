import type { EconomicFactTier } from "./economic-value";

/** Human-supplied business dispositions. They are never calculated results. */
export const ECONOMIC_DISPOSITIONS = ["PROCEED", "DECLINE", "DEFER"] as const;
export type EconomicDisposition = (typeof ECONOMIC_DISPOSITIONS)[number];

export interface CreateEconomicDecisionInput {
  readonly opportunityId: string;
  readonly scenarioSnapshotId: string;
  readonly disposition: EconomicDisposition;
  readonly rationale: string;
  /** Server-derived from the immutable scenario snapshot; never client input. */
  readonly scenarioEffectiveCertainty: EconomicFactTier;
  /** Server-derived from the immutable scenario snapshot; never client input. */
  readonly scenarioBlockingReasons: readonly string[];
  readonly ruleVersion: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly supersedesDecisionId: string | null;
}

export interface EconomicDecisionRecord extends CreateEconomicDecisionInput {
  readonly id: string;
  readonly createdAt: Date;
}

export interface CreateEconomicDecisionMutationInput {
  readonly opportunityId: string;
  readonly scenarioSnapshotId: string;
  readonly disposition: EconomicDisposition;
  readonly rationale: string;
  readonly ruleVersion: string;
  readonly expectedCurrentDecisionId: string | null;
  readonly idempotencyKey: string;
}

export type EconomicDecisionMutationRejectionReason =
  | "UNAUTHENTICATED"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "CONCURRENCY_CONFLICT"
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_OPPORTUNITY_MISMATCH"
  | "SNAPSHOT_INTEGRITY_ERROR";

export interface EconomicDecisionMutationRejection {
  readonly kind: "REJECTED";
  readonly reason: EconomicDecisionMutationRejectionReason;
  readonly detail?: string;
}
