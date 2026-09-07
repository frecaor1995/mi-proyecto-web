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
