import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { evaluateDatabaseConnectionHealth } from "../../server/database/connection-health";

describe("Workforce database connection health", () => {
  it("CONNECTED: a real query against a reachable database succeeds", async () => {
    const db = new PGlite();
    try {
      expect(await evaluateDatabaseConnectionHealth(db as unknown as SqlClient)).toBe("CONNECTED");
    } finally {
      await db.close();
    }
  });

  it("UNAVAILABLE: a client exists but the health query fails", async () => {
    const failingClient: SqlClient = { query: async () => { throw new Error("connection terminated unexpectedly"); } };
    expect(await evaluateDatabaseConnectionHealth(failingClient)).toBe("UNAVAILABLE");
  });

  it("UNKNOWN: no client could be constructed (e.g. DATABASE_URL unset)", async () => {
    expect(await evaluateDatabaseConnectionHealth(null)).toBe("UNKNOWN");
  });

  it("UNKNOWN and UNAVAILABLE are distinct outcomes, not interchangeable", async () => {
    const failingClient: SqlClient = { query: async () => { throw new Error("boom"); } };
    const unavailable = await evaluateDatabaseConnectionHealth(failingClient);
    const unknown = await evaluateDatabaseConnectionHealth(null);
    expect(unavailable).not.toBe(unknown);
  });

  it("never surfaces the underlying driver error, credentials, or connection string", async () => {
    const secretConnectionString = "postgres://produser:sup3rSecret@internal-db.example:5432/workforce";
    const failingClient: SqlClient = {
      query: async () => { throw new Error(`could not connect to server: ${secretConnectionString}`); },
    };
    const result = await evaluateDatabaseConnectionHealth(failingClient);
    expect(result).toBe("UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("produser");
    expect(JSON.stringify(result)).not.toContain("sup3rSecret");
    expect(JSON.stringify(result)).not.toContain("postgres://");
  });

  it("source never reads process.env or a connection string directly -- only via getProductionSqlClient()", async () => {
    const source = await readFile(resolve(process.cwd(), "src/server/database/connection-health.ts"), "utf8");
    expect(source).not.toMatch(/process\.env|postgres:\/\/|connectionString\s*[:=]/i);
  });
});
