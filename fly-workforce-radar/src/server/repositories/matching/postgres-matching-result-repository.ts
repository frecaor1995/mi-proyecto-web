import type { CriterionEvaluation, CriterionImportance, CriterionKey, CriterionState, MatchOutcome } from "../../../domain/matching-engine";
import type { WorkerDemandMatchCriterionRecord, WorkerDemandMatchResultRecord } from "../../../domain/matching-results";
import type { WorkerLifecycleStatus } from "../../../domain/worker";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { InsertWorkerDemandMatchResultInput, MatchingResultRepository } from "./matching-result-repository";

interface ResultRow {
  id: string; demand_signal_id: string; worker_id: string; outcome: MatchOutcome; rule_version: string;
  evaluation_date: string | Date; evaluated_at: string | Date; worker_input_fingerprint: string; demand_input_fingerprint: string;
  worker_lifecycle_status_at_evaluation: WorkerLifecycleStatus; superseded_at: string | Date | null; created_at: string | Date;
}
const resultRecord = (r: ResultRow): WorkerDemandMatchResultRecord => ({
  id: r.id, demandSignalId: r.demand_signal_id, workerId: r.worker_id, outcome: r.outcome, ruleVersion: r.rule_version,
  evaluationDate: new Date(r.evaluation_date), evaluatedAt: new Date(r.evaluated_at),
  workerInputFingerprint: r.worker_input_fingerprint, demandInputFingerprint: r.demand_input_fingerprint,
  workerLifecycleStatusAtEvaluation: r.worker_lifecycle_status_at_evaluation,
  supersededAt: r.superseded_at === null ? null : new Date(r.superseded_at), createdAt: new Date(r.created_at),
});

interface CriterionRow {
  id: string; match_result_id: string; criterion: CriterionKey; subject: string | null; importance: CriterionImportance;
  state: CriterionState; reason_code: string; observed_demand: string | null; observed_worker: string | null; created_at: string | Date;
}
const criterionRecord = (r: CriterionRow): WorkerDemandMatchCriterionRecord => ({
  id: r.id, matchResultId: r.match_result_id, criterion: r.criterion, subject: r.subject, importance: r.importance,
  state: r.state, reasonCode: r.reason_code, observedDemand: r.observed_demand, observedWorker: r.observed_worker,
  createdAt: new Date(r.created_at),
});

export class PostgresMatchingResultRepository implements MatchingResultRepository {
  constructor(private readonly client: SqlClient) {}

  async supersedeCurrentResult(demandSignalId: string, workerId: string, supersededAt: Date): Promise<void> {
    await this.client.query(
      `update worker_demand_match_results set superseded_at=$3
       where demand_signal_id=$1 and worker_id=$2 and superseded_at is null`,
      [demandSignalId, workerId, supersededAt],
    );
  }

  async insertResult(input: InsertWorkerDemandMatchResultInput): Promise<WorkerDemandMatchResultRecord> {
    const q = await this.client.query<ResultRow>(
      `insert into worker_demand_match_results
         (demand_signal_id, worker_id, outcome, rule_version, evaluation_date, evaluated_at,
          worker_input_fingerprint, demand_input_fingerprint, worker_lifecycle_status_at_evaluation)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id, demand_signal_id, worker_id, outcome, rule_version, evaluation_date, evaluated_at,
                 worker_input_fingerprint, demand_input_fingerprint, worker_lifecycle_status_at_evaluation,
                 superseded_at, created_at`,
      [
        input.demandSignalId, input.workerId, input.outcome, input.ruleVersion, input.evaluationDate, input.evaluatedAt,
        input.workerInputFingerprint, input.demandInputFingerprint, input.workerLifecycleStatusAtEvaluation,
      ],
    );
    return resultRecord((q.rows as ResultRow[])[0]);
  }

  async insertCriteria(matchResultId: string, criteria: readonly CriterionEvaluation[]): Promise<void> {
    for (const c of criteria) {
      await this.client.query(
        `insert into worker_demand_match_criteria
           (match_result_id, criterion, subject, importance, state, reason_code, observed_demand, observed_worker)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [matchResultId, c.criterion, c.subject, c.importance, c.state, c.reasonCode, c.observedDemand, c.observedWorker],
      );
    }
  }

  async getCurrentResult(demandSignalId: string, workerId: string): Promise<WorkerDemandMatchResultRecord | null> {
    const q = await this.client.query<ResultRow>(
      `select id, demand_signal_id, worker_id, outcome, rule_version, evaluation_date, evaluated_at,
              worker_input_fingerprint, demand_input_fingerprint, worker_lifecycle_status_at_evaluation,
              superseded_at, created_at
       from worker_demand_match_results
       where demand_signal_id=$1 and worker_id=$2 and superseded_at is null`,
      [demandSignalId, workerId],
    );
    const row = (q.rows as ResultRow[])[0];
    return row ? resultRecord(row) : null;
  }

  async listCurrentResultsForDemand(demandSignalId: string): Promise<WorkerDemandMatchResultRecord[]> {
    const q = await this.client.query<ResultRow>(
      `select id, demand_signal_id, worker_id, outcome, rule_version, evaluation_date, evaluated_at,
              worker_input_fingerprint, demand_input_fingerprint, worker_lifecycle_status_at_evaluation,
              superseded_at, created_at
       from worker_demand_match_results
       where demand_signal_id=$1 and superseded_at is null
       order by worker_id`,
      [demandSignalId],
    );
    return (q.rows as ResultRow[]).map(resultRecord);
  }

  async listHistoryForWorker(demandSignalId: string, workerId: string): Promise<WorkerDemandMatchResultRecord[]> {
    const q = await this.client.query<ResultRow>(
      `select id, demand_signal_id, worker_id, outcome, rule_version, evaluation_date, evaluated_at,
              worker_input_fingerprint, demand_input_fingerprint, worker_lifecycle_status_at_evaluation,
              superseded_at, created_at
       from worker_demand_match_results
       where demand_signal_id=$1 and worker_id=$2
       order by created_at`,
      [demandSignalId, workerId],
    );
    return (q.rows as ResultRow[]).map(resultRecord);
  }

  async listCriteriaForResult(matchResultId: string): Promise<WorkerDemandMatchCriterionRecord[]> {
    const q = await this.client.query<CriterionRow>(
      `select id, match_result_id, criterion, subject, importance, state, reason_code, observed_demand, observed_worker, created_at
       from worker_demand_match_criteria
       where match_result_id=$1
       order by created_at`,
      [matchResultId],
    );
    return (q.rows as CriterionRow[]).map(criterionRecord);
  }
}
