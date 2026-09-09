import { Pool } from "pg";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { transactionRunnerOnClient, type ResponseCaptureOwnershipContext, type ResponseCaptureOwnershipRunner, type TransactionRunner } from "./transaction";
declare global { var __flyWorkforceRadarPool: Pool | undefined; }

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const pool = globalThis.__flyWorkforceRadarPool ?? new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  globalThis.__flyWorkforceRadarPool = pool;
  return pool;
}

export function getProductionSqlClient(): SqlClient | null {
  const pool = getPool();
  if (!pool) return null;
  return { async query<T>(text: string, values?: unknown[]) { const result = await pool.query(text, values); return { rows: result.rows as T[] }; } };
}

/**
 * Phase 4G concurrency/atomicity correction (see transaction.ts). Acquires
 * one dedicated connection via `pool.connect()` for the whole callback, so
 * BEGIN/.../COMMIT genuinely scope a real transaction -- unlike
 * getProductionSqlClient(), whose query() calls pool.query() independently
 * per call with no such guarantee. Fails closed (returns null) with no DB
 * configured, matching getProductionSqlClient()'s convention.
 */
export function getProductionTransactionRunner(): TransactionRunner | null {
  const pool = getPool();
  if (!pool) return null;
  return async <T>(fn: (client: SqlClient) => Promise<T>): Promise<T> => {
    const poolClient = await pool.connect();
    const scopedClient: SqlClient = { async query<Row>(text: string, values?: unknown[]) { const result = await poolClient.query(text, values); return { rows: result.rows as Row[] }; } };
    try {
      await scopedClient.query("begin");
      const result = await fn(scopedClient);
      await scopedClient.query("commit");
      return result;
    } catch (error) {
      await scopedClient.query("rollback").catch(() => {});
      throw error;
    } finally {
      poolClient.release();
    }
  };
}

const RESPONSE_CAPTURE_LOCK_NAMESPACE = "fly-workforce-radar:human-verification:response-capture-recovery:v1:";

/**
 * TX-INTEGRITY-04B-R1. Owns a response-capture key continuously on one
 * dedicated pg PoolClient. Independent BEGIN/COMMIT transactions run on that
 * same session while pg_advisory_lock remains held. If unlock fails (or
 * reports that this session did not own the lock), release(true) destroys the
 * connection instead of returning a potentially locked session to the pool.
 * PostgreSQL also releases the session lock automatically if the connection
 * or process actually terminates.
 */
export function getProductionResponseCaptureOwnershipRunner(): ResponseCaptureOwnershipRunner | null {
  const pool = getPool();
  if (!pool) return null;
  return async <T>(idempotencyKey: string, fn: (context: ResponseCaptureOwnershipContext) => Promise<T>): Promise<T> => {
    const poolClient = await pool.connect();
    const client: SqlClient = {
      async query<Row>(text: string, values?: unknown[]) {
        const result = await poolClient.query(text, values);
        return { rows: result.rows as Row[] };
      },
    };
    const lockName = `${RESPONSE_CAPTURE_LOCK_NAMESPACE}${idempotencyKey}`;
    let acquired = false;
    let discard = false;
    let operationError: unknown;
    try {
      await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [lockName]);
      acquired = true;
      return await fn({ client, transactionRunner: transactionRunnerOnClient(client) });
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      if (acquired) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "select pg_advisory_unlock(hashtextextended($1, 0)) as unlocked",
            [lockName],
          );
          if (unlocked.rows[0]?.unlocked !== true) {
            throw new Error("Response-capture advisory lock was not owned by the dedicated session at release");
          }
        } catch (unlockError) {
          discard = true;
          if (operationError === undefined) throw unlockError;
        } finally {
          poolClient.release(discard);
        }
      } else {
        poolClient.release(discard);
      }
    }
  };
}
