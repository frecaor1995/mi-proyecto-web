import { Pool } from "pg";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import type { TransactionRunner } from "./transaction";
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
