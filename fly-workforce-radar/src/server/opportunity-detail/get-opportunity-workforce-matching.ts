import type { DemandMatchReadModel } from "../../domain/matching-results";
import type { OperatorPermission } from "../../domain/operator";
import { authorizeOperator } from "../auth/authorization";
import { getProductionSqlClient, getProductionTransactionRunner } from "../database/production-sql-client";
import { PostgresDemandRequirementRepository } from "../repositories/demand/postgres-demand-requirement-repository";
import { PostgresMatchingResultRepository } from "../repositories/matching/postgres-matching-result-repository";
import { PostgresOperatorRepository } from "../repositories/operator/postgres-operator-repository";
import { PostgresWorkerRepository } from "../repositories/worker/postgres-worker-repository";
import { DemandRequirementService } from "../services/demand/demand-requirement-service";
import { MatchingPersistenceService } from "../services/matching/matching-persistence-service";
import { MatchingReadModelService } from "../services/matching/matching-read-model-service";
import { WorkerService } from "../services/worker/worker-service";
import { getWorkerDemandEngagementUi, type WorkerDemandEngagementUi } from "./get-worker-demand-engagement-ui";

export interface WorkforceMatchingUiPermissions {
  readonly authenticated: boolean;
  readonly canExecute: boolean;
  readonly canRead: boolean;
}

export type DemandMatchingReadState =
  | { readonly state: "READY"; readonly value: DemandMatchReadModel; readonly engagements?: Readonly<Record<string, WorkerDemandEngagementUi>> }
  | { readonly state: "UNAVAILABLE" | "ERROR"; readonly value: null };

export interface OpportunityWorkforceMatchingPageData {
  readonly permissions: WorkforceMatchingUiPermissions;
  readonly demandResults: Readonly<Record<string, DemandMatchingReadState>>;
}

export function createProductionMatchingServices() {
  const client = getProductionSqlClient();
  const transactionRunner = getProductionTransactionRunner();
  if (!client || !transactionRunner) return null;
  const operatorRepository = new PostgresOperatorRepository(client);
  const workerService = new WorkerService({ repository: new PostgresWorkerRepository(client), transactionRunner, operatorRepository });
  const demandRequirementService = new DemandRequirementService({ repository: new PostgresDemandRequirementRepository(client), transactionRunner, operatorRepository });
  return {
    client,
    operatorRepository,
    workerService,
    demandRequirementService,
    persistenceService: new MatchingPersistenceService({ transactionRunner }),
    readModelService: new MatchingReadModelService({
      repository: new PostgresMatchingResultRepository(client), workerService, demandRequirementService, operatorRepository,
    }),
  };
}

/** UI permission checks control visibility only. B2/B3 and every composed
 * service independently enforce the same permissions again at execution. */
export async function resolveWorkforceMatchingUiPermissions(): Promise<WorkforceMatchingUiPermissions> {
  const read = await authorizeOperator("matching_result.read");
  if (read.state === "AUTHORIZED") {
    const has = (permission: OperatorPermission) => read.operator.permissions.includes(permission);
    return { authenticated: true, canRead: true, canExecute: has("matching.execute") };
  }
  const execute = await authorizeOperator("matching.execute");
  return {
    authenticated: read.state !== "UNAUTHENTICATED" || execute.state !== "UNAUTHENTICATED",
    canRead: false,
    canExecute: execute.state === "AUTHORIZED",
  };
}

export async function getOpportunityWorkforceMatching(demandSignalIds: readonly string[]): Promise<OpportunityWorkforceMatchingPageData> {
  const permissions = await resolveWorkforceMatchingUiPermissions();
  if (!permissions.canRead || demandSignalIds.length === 0) return { permissions, demandResults: {} };
  const services = createProductionMatchingServices();
  if (!services) {
    return { permissions, demandResults: Object.fromEntries(demandSignalIds.map((id) => [id, { state: "UNAVAILABLE", value: null }])) };
  }

  const entries = await Promise.all(demandSignalIds.map(async (demandSignalId): Promise<readonly [string, DemandMatchingReadState]> => {
    try {
      const result = await services.readModelService.getDemandMatchReadModel(demandSignalId);
      const engagements=result.kind==="OK"?Object.fromEntries(await Promise.all(result.value.workers.map(async worker=>[worker.workerId,await getWorkerDemandEngagementUi(demandSignalId,worker.workerId)] as const))):{};
      return result.kind === "OK"
        ? [demandSignalId, { state: "READY", value: result.value, engagements }]
        : [demandSignalId, { state: "ERROR", value: null }];
    } catch {
      return [demandSignalId, { state: "ERROR", value: null }];
    }
  }));
  return { permissions, demandResults: Object.fromEntries(entries) };
}
