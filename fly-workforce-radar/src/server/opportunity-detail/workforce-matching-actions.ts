"use server";

import { revalidatePath } from "next/cache";
import type { DemandWorkforceEvaluationRun } from "../../domain/demand-workforce-evaluation";
import { authorizeOperator } from "../auth/authorization";
import { PostgresOpportunityRepository } from "../repositories/opportunity/postgres-opportunity-repository";
import { evaluateDemandAgainstWorkforce } from "../services/matching/evaluate-demand-against-workforce";
import { createProductionMatchingServices } from "./get-opportunity-workforce-matching";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SerializedDemandWorkforceEvaluationRun extends Omit<DemandWorkforceEvaluationRun, "startedAt" | "completedAt"> {
  readonly startedAt: string;
  readonly completedAt: string;
}

export type WorkforceMatchingActionState = {
  readonly status: "READY" | "COMPLETED" | "PARTIAL_SUCCESS" | "FAILED";
  readonly demandSignalId: string | null;
  readonly run: SerializedDemandWorkforceEvaluationRun | null;
  readonly errorKey: string | null;
};

const failed = (errorKey: string, demandSignalId: string | null = null): WorkforceMatchingActionState => ({
  status: "FAILED", demandSignalId, run: null, errorKey,
});

export async function runOpportunityWorkforceMatchingAction(
  _previous: WorkforceMatchingActionState,
  formData: FormData,
): Promise<WorkforceMatchingActionState> {
  const opportunityId = String(formData.get("opportunityId") ?? "").trim();
  const demandSignalId = String(formData.get("demandSignalId") ?? "").trim();
  if (!UUID.test(opportunityId)) return failed("workforceMatching.error.invalidOpportunity");
  if (!UUID.test(demandSignalId)) return failed("workforceMatching.error.invalidDemand");

  const authorization = await authorizeOperator("matching.execute");
  if (authorization.state === "UNAUTHENTICATED") return failed("workforceMatching.error.requiresSignIn", demandSignalId);
  if (authorization.state !== "AUTHORIZED") return failed("workforceMatching.error.executionPermission", demandSignalId);

  const services = createProductionMatchingServices();
  if (!services) return failed("workforceMatching.error.unavailable", demandSignalId);

  try {
    const graph = await new PostgresOpportunityRepository(services.client).loadGraph(opportunityId, new Date());
    const linked = graph.demandSignals.some((demand) => String(demand.id) === demandSignalId);
    if (!linked) return failed("workforceMatching.error.demandNotLinked", demandSignalId);

    const result = await evaluateDemandAgainstWorkforce(demandSignalId, {
      demandRequirementService: services.demandRequirementService,
      workerService: services.workerService,
      persistenceService: services.persistenceService,
      operatorRepository: services.operatorRepository,
    });
    if (result.kind !== "OK") {
      const errorKey = result.kind === "UNAUTHENTICATED" ? "workforceMatching.error.requiresSignIn"
        : result.kind === "UNAUTHORIZED" ? "workforceMatching.error.executionPermission"
          : result.kind === "DEMAND_NOT_FOUND" ? "workforceMatching.error.demandNotFound"
            : "workforceMatching.error.runFailed";
      return failed(errorKey, demandSignalId);
    }

    const run: SerializedDemandWorkforceEvaluationRun = {
      ...result.value,
      startedAt: result.value.startedAt.toISOString(),
      completedAt: result.value.completedAt.toISOString(),
    };
    revalidatePath(`/opportunities/${encodeURIComponent(opportunityId)}`);
    return {
      status: run.persistedWorkerCount > 0 && run.failedWorkerCount > 0 ? "PARTIAL_SUCCESS"
        : run.persistedWorkerCount === 0 && run.failedWorkerCount > 0 ? "FAILED" : "COMPLETED",
      demandSignalId,
      run,
      errorKey: run.persistedWorkerCount === 0 && run.failedWorkerCount > 0 ? "workforceMatching.error.noResultsPersisted" : null,
    };
  } catch {
    return failed("workforceMatching.error.runFailed", demandSignalId);
  }
}
