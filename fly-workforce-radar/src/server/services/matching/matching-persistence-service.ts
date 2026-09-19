import type { MatchOutcome, WorkerDemandMatchResult } from "../../../domain/matching-engine";
import type { MatchingReadyDemandInput } from "../../../domain/demand-matching";
import type { MatchingReadyWorkerInput, WorkerLifecycleStatus } from "../../../domain/worker";
import type { TransactionRunner } from "../../database/transaction";
import { PostgresMatchingResultRepository } from "../../repositories/matching/postgres-matching-result-repository";
import { fingerprintDemandInput, fingerprintWorkerInput } from "../../matching/fingerprint";
import { MATCHING_RULE_VERSION } from "../../matching/evaluate-worker-demand-match";

/**
 * MATCHING-B2-B. Durable persistence boundary for one worker-demand
 * evaluation. Deliberately carries NO operator-permission gate: matching
 * results are server-computed facts, not an operator-authored mutation
 * (MATCHING-B2-A B2.10 / Manager's B2-B5 instruction) -- there is no
 * "matching_result.write" permission, only "matching_result.read" (see
 * MatchingReadModelService). A future trusted orchestration entry point
 * (out of B2-B's scope -- "the next matching phase") is expected to be the
 * only caller.
 *
 * Only an EVALUATED engine result is ever persisted. INELIGIBLE is not a
 * qualification outcome and produces no row at all.
 */

export type PersistWorkerDemandMatchResultOutcome =
  | { readonly kind: "NOT_PERSISTED_INELIGIBLE" }
  | { readonly kind: "PERSISTED"; readonly resultId: string; readonly outcome: MatchOutcome };

export interface PersistWorkerDemandMatchResultInput {
  readonly demand: MatchingReadyDemandInput;
  readonly worker: MatchingReadyWorkerInput;
  readonly workerLifecycleStatus: WorkerLifecycleStatus;
  readonly evaluationDate: Date;
  readonly engineResult: WorkerDemandMatchResult;
}

export interface MatchingPersistenceServiceDeps {
  readonly transactionRunner: TransactionRunner;
}

export class MatchingPersistenceService {
  constructor(private readonly deps: MatchingPersistenceServiceDeps) {}

  /**
   * Manager-corrected transactional order (MATCHING-B2-B), all on one
   * transactionRunner-provided connection:
   *   1. supersede the existing current result for this (demand, worker) pair
   *   2. insert the new result (superseded_at = null)
   *   3. insert its criteria
   * A failure at step 2 or 3 rolls back the whole transaction, including
   * step 1's supersede -- the previous row's superseded_at reverts to null
   * automatically, so it remains the current result.
   */
  async persist(input: PersistWorkerDemandMatchResultInput): Promise<PersistWorkerDemandMatchResultOutcome> {
    if (input.engineResult.kind !== "EVALUATED") return { kind: "NOT_PERSISTED_INELIGIBLE" };

    const workerInputFingerprint = fingerprintWorkerInput(input.worker);
    const demandInputFingerprint = fingerprintDemandInput(input.demand);
    const outcome = input.engineResult.evaluation.outcome;
    const criteria = input.engineResult.evaluation.criteria;

    return this.deps.transactionRunner(async (client) => {
      const repository = new PostgresMatchingResultRepository(client);
      const evaluatedAt = new Date();

      await repository.supersedeCurrentResult(input.demand.demandSignalId, input.worker.workerId, evaluatedAt);

      const inserted = await repository.insertResult({
        demandSignalId: input.demand.demandSignalId,
        workerId: input.worker.workerId,
        outcome,
        ruleVersion: MATCHING_RULE_VERSION,
        evaluationDate: input.evaluationDate,
        evaluatedAt,
        workerInputFingerprint,
        demandInputFingerprint,
        workerLifecycleStatusAtEvaluation: input.workerLifecycleStatus,
      });

      await repository.insertCriteria(inserted.id, criteria);

      return { kind: "PERSISTED", resultId: inserted.id, outcome };
    });
  }
}
