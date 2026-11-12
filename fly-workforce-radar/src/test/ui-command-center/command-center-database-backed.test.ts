import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

const mockState: { client: SqlClient | null } = { client: null };
vi.mock("../../server/database/production-sql-client", () => ({
  getProductionSqlClient: () => mockState.client,
}));

function fakeClient(handler: (sql: string) => { rows: unknown[] }): SqlClient {
  return { query: async <Row>(sql: string) => handler(sql) as { rows: Row[] } };
}

describe("Command Center: real database-backed summary", () => {
  beforeEach(() => {
    mockState.client = null;
  });

  it("connection OPERATIONAL and a positive verification count are both real, not fabricated", async () => {
    mockState.client = fakeClient((sql) => {
      if (sql.includes("select 1")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("human_verification_tasks")) return { rows: [{ open_count: "3" }] };
      throw new Error(`unexpected query in test: ${sql}`);
    });
    const { getCommandCenterSummary } = await import("../../server/command-center/get-command-center-summary");
    const summary = await getCommandCenterSummary(new Date("2026-03-01T00:00:00.000Z"));
    expect(summary.dataConnectionCapability).toBe("OPERATIONAL");
    expect(summary.verificationWorkCount.value).toEqual({ state: "KNOWN", value: 3 });
  });

  it("a supported metric can be a real, database-confirmed zero (not UNKNOWN)", async () => {
    mockState.client = fakeClient((sql) => {
      if (sql.includes("select 1")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("human_verification_tasks")) return { rows: [{ open_count: "0" }] };
      throw new Error(`unexpected query in test: ${sql}`);
    });
    const { getCommandCenterSummary } = await import("../../server/command-center/get-command-center-summary");
    const summary = await getCommandCenterSummary(new Date("2026-03-01T00:00:00.000Z"));
    expect(summary.verificationWorkCount.value).toEqual({ state: "KNOWN", value: 0 });
    expect(summary.verificationWorkCount.value.state).not.toBe("UNKNOWN");
  });

  it("metrics with no canonical rule or truthful aggregation path (stale evidence, conflicts, blocked, actionable routes) remain UNKNOWN even when the database is connected", async () => {
    mockState.client = fakeClient((sql) => {
      if (sql.includes("select 1")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("human_verification_tasks")) return { rows: [{ open_count: "5" }] };
      throw new Error(`unexpected query in test: ${sql}`);
    });
    const { getCommandCenterSummary } = await import("../../server/command-center/get-command-center-summary");
    const summary = await getCommandCenterSummary(new Date("2026-03-01T00:00:00.000Z"));
    expect(summary.dataConnectionCapability).toBe("OPERATIONAL");
    expect(summary.staleEvidenceCount.value.state).toBe("UNKNOWN");
    expect(summary.conflictCount.value.state).toBe("UNKNOWN");
    expect(summary.blockedCount.value.state).toBe("UNKNOWN");
    expect(summary.actionableRoutesCount.value.state).toBe("UNKNOWN");
  });

  it("HOT/Near Ready/prioritized-action counts stay UNKNOWN when the operational radar itself cannot be evaluated (incomplete mock == real query failure)", async () => {
    mockState.client = fakeClient((sql) => {
      if (sql.includes("select 1")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("human_verification_tasks")) return { rows: [{ open_count: "5" }] };
      throw new Error(`opportunity enumeration not mocked in this test: ${sql}`);
    });
    const { getCommandCenterSummary } = await import("../../server/command-center/get-command-center-summary");
    const summary = await getCommandCenterSummary(new Date("2026-03-01T00:00:00.000Z"));
    expect(summary.hotCount.value.state).toBe("UNKNOWN");
    expect(summary.nearReadyCount.value.state).toBe("UNKNOWN");
    expect(summary.prioritizedActionCount.value.state).toBe("UNKNOWN");
  });

  it("UNAVAILABLE connection does not fabricate a fallback OPERATIONAL/zero state", async () => {
    mockState.client = fakeClient(() => { throw new Error("connection refused"); });
    const { getCommandCenterSummary } = await import("../../server/command-center/get-command-center-summary");
    const summary = await getCommandCenterSummary(new Date("2026-03-01T00:00:00.000Z"));
    expect(summary.dataConnectionCapability).toBe("UNAVAILABLE");
    expect(summary.verificationWorkCount.value.state).toBe("UNAVAILABLE");
  });

  it("no client configured (UNKNOWN) is distinct from a failed query (UNAVAILABLE)", async () => {
    mockState.client = null;
    const { getCommandCenterSummary } = await import("../../server/command-center/get-command-center-summary");
    const summary = await getCommandCenterSummary(new Date("2026-03-01T00:00:00.000Z"));
    expect(summary.dataConnectionCapability).toBe("UNKNOWN");
  });
});

describe("Command Center: HOT/Near Ready counts against a real (PGlite) database with complete coverage", () => {
  beforeEach(() => { mockState.client = null; });

  it("a real, database-confirmed Near Ready count is KNOWN, not UNKNOWN, and distinct from a KNOWN zero", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const { createHash } = await import("node:crypto");
    const { PostgresEvidenceRepository } = await import("../../server/repositories/evidence/postgres-evidence-repository");
    const { OpportunityService } = await import("../../server/services/opportunity/opportunity-service");
    const { PostgresOpportunityRepository } = await import("../../server/repositories/opportunity/postgres-opportunity-repository");

    const migrations = [
      "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql", "20260817030000_source_registry_compliance.sql",
      "20260817040000_controlled_ingestion.sql", "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
      "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql", "20260817090000_opportunity_graph.sql",
      "20260817100000_human_verification.sql", "20260817110000_eligibility_engine.sql", "20260817120000_explainable_scoring.sql",
      "20260817130000_commercial_action_engine.sql", "20260817140000_contact_grade_ordering.sql",
    ];
    const db = new PGlite();
    for (const m of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", m), "utf8"));
    const client = db as unknown as SqlClient;
    mockState.client = client;

    const asOf = new Date("2026-08-20T12:00:00Z");
    const ev = new PostgresEvidenceRepository(client);
    const repo = new PostgresOpportunityRepository(client);
    const service = new OpportunityService(repo, () => asOf);
    const source = await db.query<{ id: string }>("insert into sources(name)values('cc-fixture')returning id");
    const evidence = await ev.create({ sourceId: source.rows[0].id, sourceUrl: "https://fixture/cc/1", capturedAt: asOf, captureMethod: "HTTP_FETCH", contentHash: createHash("sha256").update("cc-1").digest("hex"), payloadSizeBytes: 8 });
    const demand = await db.query<{ id: string }>("insert into demand_signals(title,role_type,source_id,raw_evidence_id,source_identity_key,last_seen_at)values('Electrician','ELECTRICIAN',$1,$2,'external:cc-1',$3)returning id", [source.rows[0].id, evidence.id, asOf.toISOString()]);
    // No company/acceptance/route at all: HOT_A fails on many requirements,
    // but HOT_B's permissive UNKNOWN_BUYER rule (passes with no project) means
    // only HOT_B_INTELLIGENCE_PATH_PRESENT fails -- 1 failure, genuinely NEAR_READY.
    await service.create({ demandSignalIds: [demand.rows[0].id], unresolvedCompanyContext: "CC Fixture Co", observedAt: asOf });

    const { getCommandCenterSummary } = await import("../../server/command-center/get-command-center-summary");
    const summary = await getCommandCenterSummary(asOf);

    expect(summary.dataConnectionCapability).toBe("OPERATIONAL");
    expect(summary.nearReadyCount.value).toEqual({ state: "KNOWN", value: 1 });
    expect(summary.hotCount.value).toEqual({ state: "KNOWN", value: 0 });
    expect(summary.hotCount.value.state).not.toBe("UNKNOWN");
    await db.close();
  });
});
