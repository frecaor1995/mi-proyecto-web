import { getProductionSqlClient } from "./production-sql-client";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import type { ReadModelCapabilityState } from "../read-models/shared";

export const DATABASE_CONNECTION_HEALTH_STATES = ["CONNECTED", "UNAVAILABLE", "UNKNOWN"] as const;
export type DatabaseConnectionHealth = (typeof DATABASE_CONNECTION_HEALTH_STATES)[number];

/**
 * Single canonical mapping from the tri-state health result onto the app's
 * existing ReadModelCapabilityState vocabulary (i18n already localizes
 * OPERATIONAL as "Connected"/"Conectado", UNAVAILABLE as "Not connected"/
 * "No conectado", UNKNOWN as "Connection status unknown"/"Estado de
 * conexión desconocido" -- see capabilityState in src/i18n/locales/*.ts).
 * Every consumer (the global shell header, Command Center, or anything
 * else) must import this one table rather than declaring its own -- that is
 * exactly what previously let the shell show a hardcoded "Not connected"
 * while Command Center showed the real state.
 */
export const CONNECTION_HEALTH_TO_CAPABILITY: Record<DatabaseConnectionHealth, ReadModelCapabilityState> = {
  CONNECTED: "OPERATIONAL",
  UNAVAILABLE: "UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
};

/**
 * CONNECTED requires a real round trip, not just configuration presence.
 * UNKNOWN means health has not (yet) been evaluated -- no client could be
 * constructed at all, e.g. DATABASE_URL is unset. UNAVAILABLE means a client
 * exists but the smallest safe query against it failed. Never surfaces the
 * underlying error (which can embed host/user detail from the driver) --
 * only the tri-state result crosses this boundary.
 */
export async function evaluateDatabaseConnectionHealth(client: SqlClient | null): Promise<DatabaseConnectionHealth> {
  if (!client) return "UNKNOWN";
  try {
    await client.query("select 1");
    return "CONNECTED";
  } catch {
    return "UNAVAILABLE";
  }
}

export function checkWorkforceDatabaseConnectionHealth(): Promise<DatabaseConnectionHealth> {
  return evaluateDatabaseConnectionHealth(getProductionSqlClient());
}

/**
 * The one call any UI surface (global shell header, Command Center, or
 * future surfaces) should make for "what is the real Workforce DB
 * connection state, in presentation vocabulary" -- guarantees they can
 * never disagree, since both resolve through this same function.
 */
export async function getWorkforceDataConnectionCapability(): Promise<ReadModelCapabilityState> {
  return CONNECTION_HEALTH_TO_CAPABILITY[await checkWorkforceDatabaseConnectionHealth()];
}
