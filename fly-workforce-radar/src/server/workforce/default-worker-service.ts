import { getProductionSqlClient, getProductionTransactionRunner } from "../database/production-sql-client";
import { PostgresWorkerRepository } from "../repositories/worker/postgres-worker-repository";
import { WorkerService } from "../services/worker/worker-service";

/**
 * WORKFORCE-TALENT-A4. The narrow production wiring A3 didn't need for
 * itself (its own tests inject a repository/transactionRunner directly).
 * Mirrors defaultOperatorRepository()'s fail-closed shape in authorization.ts
 * exactly: no DATABASE_URL configured returns null, never a client that
 * silently no-ops. authorizeOperator's own default (an unset
 * `operatorRepository`) is left alone here -- WorkerService already omits
 * it when not provided, which resolves to defaultOperatorRepository()
 * inside authorizeOperator itself.
 */
export function defaultWorkerService(): WorkerService | null {
  const client = getProductionSqlClient();
  const transactionRunner = getProductionTransactionRunner();
  if (!client || !transactionRunner) return null;
  return new WorkerService({ repository: new PostgresWorkerRepository(client), transactionRunner });
}
