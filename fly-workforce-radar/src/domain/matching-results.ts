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

export type DemandMatchCounts = { readonly [K in MatchOutcome]: number };

export interface DemandMatchReadModel {
  readonly demandSignalId: string;
  readonly counts: DemandMatchCounts;
  readonly workers: readonly DemandMatchWorkerRow[];
}
