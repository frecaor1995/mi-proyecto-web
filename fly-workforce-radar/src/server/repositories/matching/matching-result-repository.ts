import type { CriterionEvaluation } from "../../../domain/matching-engine";
import type { WorkerDemandMatchCriterionRecord, WorkerDemandMatchResultRecord } from "../../../domain/matching-results";
import type { WorkerLifecycleStatus } from "../../../domain/worker";
import type { MatchOutcome } from "../../../domain/matching-engine";

export interface InsertWorkerDemandMatchResultInput {
  readonly demandSignalId: string;
  readonly workerId: string;
  readonly outcome: MatchOutcome;
  readonly ruleVersion: string;
  readonly evaluationDate: Date;
  readonly evaluatedAt: Date;
  readonly workerInputFingerprint: string;
  readonly demandInputFingerprint: string;
  readonly workerLifecycleStatusAtEvaluation: WorkerLifecycleStatus;
}

/**
 * MATCHING-B2-B. `supersedeCurrentResult` and `insertResult` are always
 * called in that exact order, on the same transactionRunner-provided
 * connection, per the Manager's certified correction: superseding the
 * previous current row must happen BEFORE inserting the new one, because
 * the partial unique index (demand_signal_id, worker_id) WHERE
 * superseded_at IS NULL would otherwise reject the new insert while the old
 * row is still current.
 */
export interface MatchingResultRepository {
  supersedeCurrentResult(demandSignalId: string, workerId: string, supersededAt: Date): Promise<void>;
  insertResult(input: InsertWorkerDemandMatchResultInput): Promise<WorkerDemandMatchResultRecord>;
  insertCriteria(matchResultId: string, criteria: readonly CriterionEvaluation[]): Promise<void>;
  getCurrentResult(demandSignalId: string, workerId: string): Promise<WorkerDemandMatchResultRecord | null>;
  listCurrentResultsForDemand(demandSignalId: string): Promise<WorkerDemandMatchResultRecord[]>;
  listHistoryForWorker(demandSignalId: string, workerId: string): Promise<WorkerDemandMatchResultRecord[]>;
  listCriteriaForResult(matchResultId: string): Promise<WorkerDemandMatchCriterionRecord[]>;
}
