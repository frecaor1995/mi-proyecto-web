import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";

/**
 * Phase 4G concurrency/atomicity correction. A genuinely connection-scoped
 * transaction boundary. `getProductionSqlClient()`'s `query()` calls
 * `pool.query()` independently per call -- under a real `pg.Pool`, sequential
 * `BEGIN`/`...`/`COMMIT` statements issued that way are NOT guaranteed to run
 * on the same physical connection, so they do not actually scope a
 * transaction across multiple statements. A `TransactionRunner` fixes this by
 * handing `fn` a `SqlClient` bound to one dedicated connection for the
 * duration of `fn`, committing on success and rolling back on any thrown
 * error -- see production-transaction-runner.ts for the production
 * implementation (via `pool.connect()`/`PoolClient`) and individual test
 * files for the PGlite equivalent (PGlite has no real connection pooling, so
 * reusing its single client for the whole callback is already correct).
 */
export type TransactionRunner = <T>(fn: (client: SqlClient) => Promise<T>) => Promise<T>;

/** TX-INTEGRITY-04B-R1: runs one independent transaction on a client whose
 * PostgreSQL session is already owned by the caller. */
export function transactionRunnerOnClient(client: SqlClient): TransactionRunner {
  return async <T>(fn: (client: SqlClient) => Promise<T>): Promise<T> => {
    await client.query("begin");
    try {
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  };
}

export interface ResponseCaptureOwnershipContext {
  readonly client: SqlClient;
  readonly transactionRunner: TransactionRunner;
}

/** Owns one response-capture idempotency key on one dedicated PostgreSQL
 * session for the complete callback lifetime. */
export type ResponseCaptureOwnershipRunner = <T>(
  idempotencyKey: string,
  fn: (context: ResponseCaptureOwnershipContext) => Promise<T>,
) => Promise<T>;
