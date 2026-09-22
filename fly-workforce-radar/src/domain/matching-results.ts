import type { CriterionImportance, CriterionKey, CriterionState, MatchOutcome } from "./matching-engine";
import type { WorkerLifecycleStatus } from "./worker";

/**
 * MATCHING-B2-B. Durable persistence shapes for worker_demand_match_results
 * / worker_demand_match_criteria (MATCHING-B2-A). Append-only; the only
 * mutable field on a result row is `supersededAt` (MATCHING-B2-A B2.4).
 */

export interface WorkerDemandMatchResultRecord {
  readonly id: string;
  readonly demandSignalId: string;
  readonly workerId: string;
  readonly outcome: MatchOutcome;
  readonly ruleVersion: string;
  readonly evaluationDate: Date;
  readonly evaluatedAt: Date;
  readonly workerInputFingerprint: string;
  readonly demandInputFingerprint: string;
  readonly workerLifecycleStatusAtEvaluation: WorkerLifecycleStatus;
  readonly supersededAt: Date | null;
  readonly createdAt: Date;
}

export interface WorkerDemandMatchCriterionRecord {
  readonly id: string;
  readonly matchResultId: string;
  readonly criterion: CriterionKey;
  readonly subject: string | null;
  readonly importance: CriterionImportance;
  readonly state: CriterionState;
  readonly reasonCode: string;
  readonly observedDemand: string | null;
  readonly observedWorker: string | null;
  readonly createdAt: Date;
}

/** MATCHING-B2-A B2.6/B2.7: whether a persisted result's inputs still match
 * a freshly-computed fingerprint of the worker/demand's current state. */
export const WORKER_DEMAND_MATCH_FRESHNESS_STATES = ["FRESH", "POTENTIALLY_STALE"] as const;
export type WorkerDemandMatchFreshness = (typeof WORKER_DEMAND_MATCH_FRESHNESS_STATES)[number];

/** One demand's commercial read-model row (MATCHING-B2-A B2.13). Never
 * carries contact data -- structurally unreachable from the result/criteria
 * tables, which never store it in the first place. */
export interface DemandMatchWorkerRow {
  readonly workerId: string;
  readonly workerDisplayName: string;
  readonly outcome: MatchOutcome;
  readonly topReasons: readonly string[];
  readonly missingInformationReasons: readonly string[];
  /** MATCHING-B4-B. Complete, display-safe deterministic criteria for the
   * current result. Deliberately excludes observed values: the UI needs the
   * canonical state/reason/subject to explain the result, not raw matching
   * inputs or any sensitive worker data. */
  readonly explanations: readonly DemandMatchCriterionExplanation[];
  readonly evaluationDate: Date;
  readonly evaluatedAt: Date;
  readonly freshness: WorkerDemandMatchFreshness;
  readonly workerLifecycleStatusAtEvaluation: WorkerLifecycleStatus;
  /** MATCHING-B2-A B2.9/B2.13: the worker's CURRENT lifecycle status, looked
   * up independently of the immutable evaluation-time snapshot above --
   * null only if the worker's current record could not be loaded (e.g. a
   * transient read failure), never as a stand-in for "worker not found". */
  readonly currentWorkerLifecycleStatus: WorkerLifecycleStatus | null;
}

export interface DemandMatchCriterionExplanation {
  readonly criterion: CriterionKey;
  readonly subject: string | null;
  readonly importance: CriterionImportance;
  readonly state: CriterionState;
  readonly reasonCode: MatchingExplanationReasonCode;
}

/** Closed reason-code vocabulary emitted by the published B1 engine. Keeping
 * it explicit makes the bilingual B4 presentation exhaustive at compile time. */
export const MATCHING_EXPLANATION_REASON_CODES = [
  "DEMAND_TRADE_NOT_SPECIFIED", "WORKER_TRADE_UNKNOWN", "TRADE_MATCH_PRIMARY", "TRADE_MATCH_SECONDARY",
  "DEMAND_OCCUPATION_NOT_SPECIFIED", "WORKER_OCCUPATION_UNKNOWN", "OCCUPATION_MATCH",
  "DEMAND_MINIMUM_EXPERIENCE_NOT_SPECIFIED", "WORKER_EXPERIENCE_UNKNOWN", "EXPERIENCE_MEETS_MINIMUM", "EXPERIENCE_BELOW_MINIMUM",
  "REQUIRED_SKILL_UNKNOWN", "PREFERRED_SKILL_UNKNOWN", "SKILL_REJECTED", "REQUIRED_SKILL_VERIFIED", "PREFERRED_SKILL_VERIFIED", "REQUIRED_SKILL_UNVERIFIED", "PREFERRED_SKILL_UNVERIFIED",
  "REQUIRED_CREDENTIAL_UNKNOWN", "PREFERRED_CREDENTIAL_UNKNOWN", "CREDENTIAL_EXPIRED", "CREDENTIAL_REJECTED", "REQUIRED_CREDENTIAL_VERIFIED", "PREFERRED_CREDENTIAL_VERIFIED", "REQUIRED_CREDENTIAL_UNVERIFIED", "PREFERRED_CREDENTIAL_UNVERIFIED",
  "DEMAND_START_DATE_NOT_SPECIFIED", "WORKER_AVAILABILITY_UNKNOWN", "WORKER_COMMITTED_STATUS_UNKNOWN", "AVAILABLE_FOR_START", "WORKER_AVAILABLE_FROM_AFTER_REQUIRED_START", "WORKER_UNAVAILABLE_FOR_START",
  "DEMAND_COMPENSATION_NOT_SPECIFIED", "WORKER_COMPENSATION_UNKNOWN", "COMPENSATION_NOT_COMPARABLE", "COMPENSATION_PAY_PERIOD_NOT_COMPARABLE", "COMPENSATION_COMPATIBLE", "COMPENSATION_NEGOTIABLE_GAP", "COMPENSATION_HARD_GAP",
] as const;
export type MatchingExplanationReasonCode = (typeof MATCHING_EXPLANATION_REASON_CODES)[number];

export type DemandMatchCounts = { readonly [K in MatchOutcome]: number };

export interface DemandMatchReadModel {
  readonly demandSignalId: string;
  readonly counts: DemandMatchCounts;
  readonly workers: readonly DemandMatchWorkerRow[];
}
