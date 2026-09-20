import type { MatchOutcome } from "./matching-engine";

/**
 * MATCHING-B3-B. Execution-result contract for ONE demand-to-workforce
 * evaluation run (MATCHING-B3-A B3-B1).
 *
 * RUN-SCOPED, not a read model. Every count below describes only what
 * happened during THIS invocation. `outcomes` counts only results that were
 * both evaluated AND durably persisted during this invocation -- it never
 * includes a historical/current B2 result that this run did not itself
 * write (for example a worker who became INACTIVE after an earlier run keeps
 * their old persisted result, but that result is not counted here). The
 * persisted "current results" view is a separate concept owned by
 * MatchingReadModelService; the two are intentionally not merged.
 *
 * Population accounting: `eligibleWorkerCount` is the size of the initial
 * ACTIVE enumeration snapshot. Every worker in that snapshot ends the run in
 * exactly one bucket, so
 *   eligibleWorkerCount = persistedWorkerCount + ineligibleWorkerCount + failedWorkerCount
 * and `evaluatedWorkerCount` = persistedWorkerCount + the PERSISTENCE_FAILED
 * failures (the engine evaluated them but no result became durable).
 *
 * Deliberately absent (never add here): score, rank, percentage, AI
 * confidence, contact data, consent, credential identifiers, addresses, raw
 * exception text.
 */

/** Closed, privacy-safe set. A failure NEVER carries a raw exception message. */
export const DEMAND_WORKFORCE_FAILURE_REASON_CODES = [
  "WORKER_INPUT_BUILD_FAILED",
  "PERSISTENCE_FAILED",
  "UNEXPECTED_ERROR",
] as const;
export type DemandWorkforceFailureReasonCode = (typeof DEMAND_WORKFORCE_FAILURE_REASON_CODES)[number];

export interface DemandWorkforceEvaluationFailure {
  readonly workerId: string;
  readonly reasonCode: DemandWorkforceFailureReasonCode;
}

export type DemandWorkforceOutcomeCounts = { readonly [K in MatchOutcome]: number };

export interface DemandWorkforceEvaluationRun {
  readonly demandSignalId: string;
  readonly startedAt: Date;
  readonly completedAt: Date;

  readonly eligibleWorkerCount: number;
  readonly evaluatedWorkerCount: number;
  readonly persistedWorkerCount: number;
  readonly ineligibleWorkerCount: number;
  readonly failedWorkerCount: number;

  readonly outcomes: DemandWorkforceOutcomeCounts;
  readonly failures: readonly DemandWorkforceEvaluationFailure[];
}
