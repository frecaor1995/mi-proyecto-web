import type { MatchOutcome } from "../../../domain/matching-engine";
import type { DemandMatchCounts, DemandMatchReadModel, DemandMatchWorkerRow, WorkerDemandMatchFreshness } from "../../../domain/matching-results";
import type { OperatorPermission } from "../../../domain/operator";
import { authorizeOperator } from "../../auth/authorization";
import type { ServerSession } from "../../auth/session";
import type { OperatorRepository } from "../../repositories/operator/operator-repository";
import type { MatchingResultRepository } from "../../repositories/matching/matching-result-repository";
import { fingerprintDemandInput, fingerprintWorkerInput } from "../../matching/fingerprint";
import type { DemandRequirementService } from "../demand/demand-requirement-service";
import type { WorkerService } from "../worker/worker-service";

/**
 * MATCHING-B2-B. Read-only commercial read model for one demand
 * (MATCHING-B2-A B2.13): counts by outcome plus a display-safe per-worker
 * row, using only current (non-superseded) results. Gated on the narrow
 * `matching_result.read` operator permission -- there is no corresponding
 * write permission (see MatchingPersistenceService's own header comment):
 * matching results are server-computed facts, never operator-authored.
 *
 * This service composes the already-existing WorkerService (for a
 * worker's display-safe name, current lifecycle, and a freshly-computed
 * MatchingReadyWorkerInput to fingerprint) and DemandRequirementService
 * (the same, demand-side) -- the caller is expected to construct both with
 * a context that already holds the underlying read permissions those
 * services themselves require (worker_profile.read/worker_compensation.read,
 * demand_requirement.write); the `matching_result.read` gate on THIS
 * service's own method is what actually governs who may call the read
 * model, exactly like any other aggregate read model in this codebase
 * composes narrower, already-sanctioned data-access methods rather than
 * re-deriving its own copy of them.
 */

export type MatchingReadModelOperationResult<T> =
  | { readonly kind: "UNAUTHENTICATED" }
  | { readonly kind: "UNAUTHORIZED" }
  | { readonly kind: "OK"; readonly value: T };

export interface MatchingReadModelServiceDeps {
  readonly repository: MatchingResultRepository;
  readonly workerService: WorkerService;
  readonly demandRequirementService: DemandRequirementService;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
}

const EMPTY_COUNTS: DemandMatchCounts = { STRONG_MATCH: 0, POSSIBLE_MATCH: 0, NO_MATCH: 0, INSUFFICIENT_DATA: 0 };
const HARD_LIMITATION_STATES = new Set(["VIOLATED", "SATISFIED_WITH_LIMITATION"]);

export class MatchingReadModelService {
  constructor(private readonly deps: MatchingReadModelServiceDeps) {}

  private async authorize(permission: OperatorPermission): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly result: MatchingReadModelOperationResult<never> }
  > {
    const auth = await authorizeOperator(permission, { getSession: this.deps.getSession, repository: this.deps.operatorRepository });
    if (auth.state === "UNAUTHENTICATED") return { ok: false, result: { kind: "UNAUTHENTICATED" } };
    if (auth.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { ok: false, result: { kind: "UNAUTHORIZED" } };
    return { ok: true };
  }

  async getDemandMatchReadModel(demandSignalId: string): Promise<MatchingReadModelOperationResult<DemandMatchReadModel>> {
    const auth = await this.authorize("matching_result.read");
    if (!auth.ok) return auth.result;

    const results = await this.deps.repository.listCurrentResultsForDemand(demandSignalId);

    const demandInputResult = await this.deps.demandRequirementService.getMatchingReadyInput(demandSignalId);
    const currentDemandFingerprint =
      demandInputResult.kind === "OK" && demandInputResult.value !== null ? fingerprintDemandInput(demandInputResult.value) : null;

    const counts: { [K in MatchOutcome]: number } = { ...EMPTY_COUNTS };
    const workers: DemandMatchWorkerRow[] = [];

    for (const result of results) {
      counts[result.outcome] += 1;

      const criteria = await this.deps.repository.listCriteriaForResult(result.id);
      const topReasons = criteria.filter((c) => c.importance === "HARD" && HARD_LIMITATION_STATES.has(c.state)).map((c) => c.reasonCode);
      const missingInformationReasons = criteria.filter((c) => c.state === "UNKNOWN").map((c) => c.reasonCode);

      const workerRecordResult = await this.deps.workerService.getWorker(result.workerId);
      const workerDisplayName = workerRecordResult.kind === "OK" && workerRecordResult.value ? workerRecordResult.value.displayName : "";
      const currentWorkerLifecycleStatus = workerRecordResult.kind === "OK" && workerRecordResult.value ? workerRecordResult.value.lifecycleStatus : null;

      const workerInputResult = await this.deps.workerService.buildMatchingReadyInput(result.workerId);
      const currentWorkerFingerprint =
        workerInputResult.kind === "OK" && workerInputResult.value !== null ? fingerprintWorkerInput(workerInputResult.value) : null;

      const freshness: WorkerDemandMatchFreshness =
        currentDemandFingerprint !== null &&
        currentWorkerFingerprint !== null &&
        currentDemandFingerprint === result.demandInputFingerprint &&
        currentWorkerFingerprint === result.workerInputFingerprint
          ? "FRESH"
          : "POTENTIALLY_STALE";

      workers.push({
        workerId: result.workerId,
        workerDisplayName,
        outcome: result.outcome,
        topReasons,
        missingInformationReasons,
        evaluationDate: result.evaluationDate,
        evaluatedAt: result.evaluatedAt,
        freshness,
        workerLifecycleStatusAtEvaluation: result.workerLifecycleStatusAtEvaluation,
        currentWorkerLifecycleStatus,
      });
    }

    return { kind: "OK", value: { demandSignalId, counts, workers } };
  }
}
