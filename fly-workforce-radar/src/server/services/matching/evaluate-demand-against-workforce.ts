import type { MatchingReadyDemandInput } from "../../../domain/demand-matching";
import type {
  DemandWorkforceEvaluationFailure, DemandWorkforceEvaluationRun, DemandWorkforceFailureReasonCode,
} from "../../../domain/demand-workforce-evaluation";
import type { MatchOutcome } from "../../../domain/matching-engine";
import { authorizeOperator } from "../../auth/authorization";
import type { ServerSession } from "../../auth/session";
import type { OperatorRepository } from "../../repositories/operator/operator-repository";
import { isEligibleForMatching } from "../../matching/eligibility";
import { evaluateWorkerDemandMatch } from "../../matching/evaluate-worker-demand-match";
import type { DemandRequirementService } from "../demand/demand-requirement-service";
import type { WorkerService } from "../worker/worker-service";
import type { MatchingPersistenceService } from "./matching-persistence-service";

/**
 * MATCHING-B3-B. The single server-side coordination boundary for ONE
 * demand-to-workforce evaluation run:
 *
 *   one demandSignalId
 *   -> load the canonical demand matching input (exactly once)
 *   -> enumerate the ACTIVE workforce (existing worker search + pagination)
 *   -> per worker: re-check lifecycle, build matching-safe input, evaluate
 *      with the certified deterministic engine, persist via B2
 *   -> continue after isolated per-worker failures
 *   -> return a RUN-SCOPED summary (DemandWorkforceEvaluationRun)
 *
 * The orchestrator only COORDINATES. Qualification is decided solely by the
 * deterministic engine (evaluateWorkerDemandMatch); trade / occupation /
 * experience / skill / credential / availability / compensation rules are
 * never re-implemented here, and workers are deliberately NOT pre-filtered
 * by trade -- a worker with no matching trade row must still reach the
 * engine and may legitimately come back INSUFFICIENT_DATA.
 *
 * It never reads the B2 read model (MatchingReadModelService): the returned
 * summary is what THIS run did, not the persisted current-results view. It
 * is not wrapped in one database transaction -- each worker's persistence is
 * its own B2 transaction, so one worker's failure never rolls back another.
 *
 * Authorization: `matching.execute` gates the trigger itself and is distinct
 * from `matching_result.read` (neither implies the other). The composed
 * services keep enforcing their OWN permissions unchanged (demand
 * requirements, worker_profile.read, worker_compensation.read); a missing
 * dependency permission is a systemic problem, not a per-worker failure, so
 * it stops the run and surfaces as UNAUTHENTICATED / UNAUTHORIZED.
 */

/** Recommended commercial-v1 page size; also the maximum WorkerService.searchWorkers accepts. */
export const DEMAND_WORKFORCE_PAGE_SIZE = 200;

export type EvaluateDemandAgainstWorkforceResult =
  | { readonly kind: "UNAUTHENTICATED" }
  | { readonly kind: "UNAUTHORIZED" }
  /** The canonical demand input could not be assembled; no worker was processed. */
  | { readonly kind: "DEMAND_NOT_FOUND" }
  | { readonly kind: "DEMAND_LOAD_FAILED" }
  /** The ACTIVE workforce could not be enumerated; no worker was processed. */
  | { readonly kind: "WORKFORCE_ENUMERATION_FAILED" }
  | { readonly kind: "OK"; readonly value: DemandWorkforceEvaluationRun };

export interface EvaluateDemandAgainstWorkforceDeps {
  readonly demandRequirementService: Pick<DemandRequirementService, "getMatchingReadyInput">;
  readonly workerService: Pick<WorkerService, "searchWorkers" | "getWorker" | "buildMatchingReadyInput">;
  readonly persistenceService: Pick<MatchingPersistenceService, "persist">;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
  /** Read once for startedAt (= the run's explicit evaluationDate) and once for completedAt. */
  readonly clock?: () => Date;
  /** Defaults to DEMAND_WORKFORCE_PAGE_SIZE; must be an integer in [1, 200]. */
  readonly pageSize?: number;
  /** Test seam only; defaults to the certified engine. */
  readonly evaluate?: typeof evaluateWorkerDemandMatch;
}

type AuthFailureKind = "UNAUTHENTICATED" | "UNAUTHORIZED";
const authFailureOf = (result: { readonly kind: string }): AuthFailureKind | null =>
  result.kind === "UNAUTHENTICATED" || result.kind === "UNAUTHORIZED" ? result.kind : null;

/** Per-worker result. `AUTH` is systemic and aborts the whole run; everything else is isolated. */
type WorkerStepResult =
  | { readonly kind: "PERSISTED"; readonly outcome: MatchOutcome }
  | { readonly kind: "INELIGIBLE" }
  | { readonly kind: "FAILED"; readonly reasonCode: DemandWorkforceFailureReasonCode }
  | { readonly kind: "AUTH"; readonly auth: AuthFailureKind };

export async function evaluateDemandAgainstWorkforce(
  demandSignalId: string,
  deps: EvaluateDemandAgainstWorkforceDeps,
): Promise<EvaluateDemandAgainstWorkforceResult> {
  const pageSize = deps.pageSize ?? DEMAND_WORKFORCE_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > DEMAND_WORKFORCE_PAGE_SIZE) {
    throw new RangeError(`pageSize must be an integer between 1 and ${DEMAND_WORKFORCE_PAGE_SIZE}`);
  }
  const clock = deps.clock ?? (() => new Date());
  const evaluate = deps.evaluate ?? evaluateWorkerDemandMatch;

  const auth = await authorizeOperator("matching.execute", { getSession: deps.getSession, repository: deps.operatorRepository });
  if (auth.state === "UNAUTHENTICATED") return { kind: "UNAUTHENTICATED" };
  if (auth.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { kind: "UNAUTHORIZED" };

  const startedAt = clock();
  // One explicit evaluation instant for the whole run: every worker is judged
  // "as of" the same moment, and the engine never reads a clock itself.
  const evaluationDate = startedAt;

  // B3-B5: the canonical demand input is loaded exactly once, before any worker is touched.
  let demand: MatchingReadyDemandInput;
  try {
    const loaded = await deps.demandRequirementService.getMatchingReadyInput(demandSignalId);
    const loadAuthFailure = authFailureOf(loaded);
    if (loadAuthFailure) return { kind: loadAuthFailure };
    if (loaded.kind !== "OK") return { kind: "DEMAND_LOAD_FAILED" };
    if (loaded.value === null) return { kind: "DEMAND_NOT_FOUND" };
    demand = loaded.value;
  } catch {
    return { kind: "DEMAND_LOAD_FAILED" };
  }

  // B3-B3 / B3-B13: enumerate lifecycleStatus = ACTIVE through the existing
  // search, one page at a time, deliberately with NO trade/occupation filter.
  // Only worker ids are retained: pages are ordered by id, so walking them all
  // BEFORE evaluating anything yields one consistent population snapshot --
  // offsets are not disturbed by the (potentially long) evaluation work or by
  // workers created/deactivated while it runs. Defensive de-duplication keeps
  // "exactly once" true even if the snapshot itself raced a concurrent write.
  const snapshot = new Set<string>();
  try {
    for (let offset = 0; ; offset += pageSize) {
      const page = await deps.workerService.searchWorkers({ lifecycleStatus: "ACTIVE", limit: pageSize, offset });
      const pageAuthFailure = authFailureOf(page);
      if (pageAuthFailure) return { kind: pageAuthFailure };
      if (page.kind !== "OK") return { kind: "WORKFORCE_ENUMERATION_FAILED" };
      for (const worker of page.value) snapshot.add(worker.id);
      if (page.value.length < pageSize) break;
    }
  } catch {
    return { kind: "WORKFORCE_ENUMERATION_FAILED" };
  }

  const outcomes: { [K in MatchOutcome]: number } = { STRONG_MATCH: 0, POSSIBLE_MATCH: 0, NO_MATCH: 0, INSUFFICIENT_DATA: 0 };
  const failures: DemandWorkforceEvaluationFailure[] = [];
  let persistedWorkerCount = 0;
  let ineligibleWorkerCount = 0;

  // B3-B13: strictly sequential -- no Promise.all, no bounded concurrency yet.
  for (const workerId of snapshot) {
    const step = await processWorker(workerId, demand, evaluationDate, deps, evaluate);
    switch (step.kind) {
      case "AUTH":
        return { kind: step.auth };
      case "INELIGIBLE":
        ineligibleWorkerCount += 1;
        break;
      case "FAILED":
        failures.push({ workerId, reasonCode: step.reasonCode });
        break;
      case "PERSISTED":
        // B3-B7: only after persistence succeeded do the counts move.
        persistedWorkerCount += 1;
        outcomes[step.outcome] += 1;
        break;
    }
  }

  return {
    kind: "OK",
    value: {
      demandSignalId,
      startedAt,
      completedAt: clock(),
      eligibleWorkerCount: snapshot.size,
      // Evaluated = persisted + evaluated-but-not-durable (PERSISTENCE_FAILED).
      evaluatedWorkerCount: persistedWorkerCount + failures.filter((f) => f.reasonCode === "PERSISTENCE_FAILED").length,
      persistedWorkerCount,
      ineligibleWorkerCount,
      failedWorkerCount: failures.length,
      outcomes,
      failures,
    },
  };
}

async function processWorker(
  workerId: string,
  demand: MatchingReadyDemandInput,
  evaluationDate: Date,
  deps: EvaluateDemandAgainstWorkforceDeps,
  evaluate: typeof evaluateWorkerDemandMatch,
): Promise<WorkerStepResult> {
  // The stage decides how an unexpected throw is classified. Only the closed
  // reason code leaves this function -- never the exception or its message.
  let stage: "RELOAD" | "BUILD" | "EVALUATE" | "PERSIST" = "RELOAD";
  try {
    // B3-B4: the enumeration was only a snapshot -- reload the CURRENT lifecycle.
    const current = await deps.workerService.getWorker(workerId);
    const reloadAuthFailure = authFailureOf(current);
    if (reloadAuthFailure) return { kind: "AUTH", auth: reloadAuthFailure };
    if (current.kind !== "OK" || current.value === null) return { kind: "FAILED", reasonCode: "UNEXPECTED_ERROR" };
    const lifecycleStatus = current.value.lifecycleStatus;

    // A worker who became INACTIVE/ARCHIVED after enumeration gets no new result;
    // any historical B2 result is left exactly as it was.
    if (!isEligibleForMatching(lifecycleStatus)) return { kind: "INELIGIBLE" };

    stage = "BUILD";
    const built = await deps.workerService.buildMatchingReadyInput(workerId);
    const buildAuthFailure = authFailureOf(built);
    if (buildAuthFailure) return { kind: "AUTH", auth: buildAuthFailure };
    if (built.kind !== "OK" || built.value === null) return { kind: "FAILED", reasonCode: "WORKER_INPUT_BUILD_FAILED" };

    stage = "EVALUATE";
    const engineResult = evaluate({ demand, worker: built.value, workerLifecycleStatus: lifecycleStatus, evaluationDate });

    // Unreachable after the explicit check above unless the two ever disagree;
    // the engine's word is final and INELIGIBLE is never persisted.
    if (engineResult.kind === "INELIGIBLE") return { kind: "INELIGIBLE" };

    stage = "PERSIST";
    const persisted = await deps.persistenceService.persist({
      demand, worker: built.value, workerLifecycleStatus: lifecycleStatus, evaluationDate, engineResult,
    });
    // An EVALUATED result was handed over, so anything but PERSISTED means no durable result exists.
    if (persisted.kind !== "PERSISTED") return { kind: "FAILED", reasonCode: "PERSISTENCE_FAILED" };
    return { kind: "PERSISTED", outcome: persisted.outcome };
  } catch {
    const reasonCode: DemandWorkforceFailureReasonCode =
      stage === "BUILD" ? "WORKER_INPUT_BUILD_FAILED" : stage === "PERSIST" ? "PERSISTENCE_FAILED" : "UNEXPECTED_ERROR";
    return { kind: "FAILED", reasonCode };
  }
}
