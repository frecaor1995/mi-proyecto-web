import { Pool } from "pg";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
declare global { var __flyWorkforceRadarPool: Pool | undefined; }
export function getProductionSqlClient(): SqlClient | null { const connectionString = process.env.DATABASE_URL; if (!connectionString) return null; const pool = globalThis.__flyWorkforceRadarPool ?? new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }); globalThis.__flyWorkforceRadarPool = pool; return { async query<T>(text: string, values?: unknown[]) { const result = await pool.query(text, values); return { rows: result.rows as T[] }; } }; }
