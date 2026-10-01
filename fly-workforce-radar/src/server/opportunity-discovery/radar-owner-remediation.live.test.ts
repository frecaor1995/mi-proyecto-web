import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { listSignals } from "./signals";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

describe.skipIf(!pool)("Radar owner remediation against the configured local database", () => {
  afterAll(async () => { await pool?.end(); });

  it("reconciles the latest real run with unique historical signals", async () => {
    const client = pool as unknown as SqlClient;
    const latest = await listSignals(client, null, 100, "LATEST");
    const historical = await listSignals(client, null, 100, "HISTORICAL");
    expect(latest.state).toBe("READY");
    expect(historical.state).toBe("READY");
    if (latest.state !== "READY" || historical.state !== "READY") return;
    expect(latest.latestRun).toMatchObject({ provider: "BRAVE_WEB_SEARCH", findingsCount: 20, newlySeenCount: 4, rediscoveredCount: 16, historicalUniqueCount: 34 });
    expect(latest.counts.total).toBe(20);
    expect(historical.counts.total).toBe(34);
    expect(latest.signals[0]).toMatchObject({
      title: "$35-$87/hr Mmr Electrician Jobs (NOW HIRING) May 2026",
      company: "MMR Constructors", location: "Abilene, TX", trade: "Electrician", qualityGroup: "READY_FOR_REVIEW",
    });
  });
});
