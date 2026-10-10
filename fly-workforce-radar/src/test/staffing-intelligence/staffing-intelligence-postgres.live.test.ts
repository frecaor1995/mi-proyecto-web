import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { ProjectSignalLinkError, confirmProjectSignalLink, importProjectSignals, loadProjectSignals } from "../../server/staffing-intelligence/project-signals";
import { loadStaffingIntelligence } from "../../server/staffing-intelligence/get-staffing-intelligence";

/** Staffing commercial intelligence against the LOCAL database; every test is rolled back. No network. */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });
const fixture = async () => JSON.parse(await readFile(resolve(process.cwd(), "src/test/fixtures/staffing/project-signal-demo.json"), "utf8"));
const DEMO_COMPANY = "40000000-0000-4000-8000-000000000001"; // existing "DEMO LOCAL Contractor"
// the fixture's sourceRecordId is suffixed per test so it never collides with the authorized demo import
const unique = (payload: Record<string, unknown>, suffix: string) => ({ ...payload, records: (payload.records as Record<string, unknown>[]).map((r) => ({ ...r, sourceRecordId: `${r.sourceRecordId}-${suffix}` })) });

describe.skipIf(!databaseUrl)("Staffing commercial intelligence (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session)); } finally { await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const operatorId = async (client: SqlClient) => (await client.query<{ id: string }>("select id from workforce_operators where status='ACTIVE' order by created_at limit 1")).rows[0].id;
  const counts = async (client: SqlClient) => (await client.query<Record<string, string>>(`select (select count(*) from companies) companies, (select count(*) from projects) projects,
    (select count(*) from company_roles) roles, (select count(*) from opportunities) opportunities, (select count(*) from commercial_activities) activities,
    (select count(*) from workforce_workers) workers, (select count(*) from source_capture_policy_decisions) policies, (select count(*) from discovery_signal_reviews) reviews`)).rows[0];

  it("imports idempotently, versions changes with history and creates nothing but evidence", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const before = await counts(client);
      const payload = unique(await fixture(), "t1");
      const first = await importProjectSignals(client, payload, op, new Date("2026-10-10T13:00:00Z"));
      expect(first.results.map((r) => r.outcome)).toEqual(["CREATED"]);
      const again = await importProjectSignals(client, payload, op, new Date("2026-10-10T13:05:00Z"));
      expect(again.results).toEqual([expect.objectContaining({ outcome: "DUPLICATE", evidenceId: first.results[0].evidenceId, version: 1 })]);
      const changed = { ...payload, records: (payload.records as Record<string, unknown>[]).map((r) => ({ ...r, duration: { value: "8 months", kind: "ESTIMATED", evidenceRef: "DEMO: fixture note" } })) };
      const second = await importProjectSignals(client, changed, op, new Date("2026-10-10T13:10:00Z"));
      expect(second.results).toEqual([expect.objectContaining({ outcome: "NEW_VERSION", version: 2 })]);
      const supersession = await client.query("select 1 from evidence_supersessions where superseded_evidence_id=$1 and superseding_evidence_id=$2", [first.results[0].evidenceId, second.results[0].evidenceId]);
      expect(supersession.rows).toHaveLength(1);
      const original = (await client.query<{ metadata: Record<string, unknown> }>("select metadata from raw_evidence where id=$1", [first.results[0].evidenceId])).rows[0].metadata;
      expect((original.record as Record<string, Record<string, unknown>>).duration).toMatchObject({ value: null, kind: "UNKNOWN" }); // version 1 unchanged
      const listed = (await loadProjectSignals(client)).find((p) => p.sourceRecordId === "DEMO-PS-0001-t1")!;
      expect(listed).toMatchObject({ version: 2, versions: 2, dataClass: "DEMO", link: null });
      const rejected = await importProjectSignals(client, { ...payload, records: [{ ...(payload.records as Record<string, unknown>[])[0], sourceRecordId: "bad", company: { name: "Real Name" } }] }, op);
      expect(rejected.results[0]).toMatchObject({ outcome: "REJECTED", errors: ["DEMO records must name the company 'DEMO LOCAL …'"] });
      expect(await counts(client)).toEqual(before); // no company, project, role, opportunity or activity
    });
  });

  it("creates a project and a company role only after explicit human confirmation, without creating companies", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const before = await counts(client);
      const { results } = await importProjectSignals(client, unique(await fixture(), "t2"), op);
      const evidenceId = results[0].evidenceId!;
      const realCompany = (await client.query<{ id: string }>("select id from companies where coalesce(common_name,legal_name) not ilike 'DEMO LOCAL%' order by id limit 1")).rows[0].id;
      const now = new Date("2026-10-10T14:00:00Z");
      await expect(confirmProjectSignalLink(client, { evidenceId, companyId: realCompany, role: "ELECTRICAL_CONTRACTOR", createProjectAndRole: true, note: "x", operatorId: op, now }))
        .rejects.toMatchObject({ code: "demoRealMismatch" }); // DEMO never touches real companies
      await expect(confirmProjectSignalLink(client, { evidenceId, companyId: DEMO_COMPANY, role: "ELECTRICAL_CONTRACTOR", createProjectAndRole: true, note: " ", operatorId: op, now }))
        .rejects.toBeInstanceOf(ProjectSignalLinkError);
      expect(await counts(client)).toEqual(before);
      const linked = await confirmProjectSignalLink(client, { evidenceId, companyId: DEMO_COMPANY, role: "ELECTRICAL_CONTRACTOR", createProjectAndRole: true, note: "Fixture: notice names the contractor.", operatorId: op, now });
      expect(linked.outcome).toBe("LINKED");
      const role = (await client.query<Record<string, unknown>>("select company_id,role::text,project_id,raw_evidence_id,assertion_kind::text,verification_state::text,role_basis from company_roles where id=$1", [linked.companyRoleId])).rows[0];
      expect(role).toMatchObject({ company_id: DEMO_COMPANY, role: "ELECTRICAL_CONTRACTOR", project_id: linked.projectId, raw_evidence_id: evidenceId, assertion_kind: "FACT", verification_state: "VERIFIED", role_basis: "PROJECT_SIGNAL_HUMAN_LINK" });
      const again = await confirmProjectSignalLink(client, { evidenceId, companyId: DEMO_COMPANY, role: "ELECTRICAL_CONTRACTOR", createProjectAndRole: true, note: "again", operatorId: op, now });
      expect(again).toMatchObject({ outcome: "ALREADY_LINKED", projectId: linked.projectId, companyRoleId: linked.companyRoleId });
      const after = await counts(client);
      expect([Number(after.companies), Number(after.projects), Number(after.roles), after.opportunities, after.activities, after.workers, after.policies])
        .toEqual([Number(before.companies), Number(before.projects) + 1, Number(before.roles) + 1, before.opportunities, before.activities, before.workers, before.policies]);
    });
  });

  it("requires the latest version and an official source to create facts", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const payload = unique(await fixture(), "t3");
      const v1 = (await importProjectSignals(client, payload, op)).results[0].evidenceId!;
      await importProjectSignals(client, { ...payload, records: (payload.records as Record<string, unknown>[]).map((r) => ({ ...r, duration: "6 months" })) }, op);
      await expect(confirmProjectSignalLink(client, { evidenceId: v1, companyId: DEMO_COMPANY, role: "GC", createProjectAndRole: false, note: "x", operatorId: op, now: new Date() }))
        .rejects.toMatchObject({ code: "superseded" });
      // without an official source, OFFICIAL facts need their own evidenceRef (otherwise the record is rejected)
      const noSource = unique({ ...payload, records: (payload.records as Record<string, unknown>[]).map((r) => ({ ...r, officialSourceUrl: null,
        contractStatus: { value: "Awarded", kind: "OFFICIAL", evidenceRef: "DEMO: fixture notice p.1" },
        project: { ...(r.project as Record<string, unknown>), workType: { value: "Electrical substation retrofit", kind: "OFFICIAL", evidenceRef: "DEMO: fixture notice p.1" } } })) }, "ns");
      const id = (await importProjectSignals(client, noSource, op)).results[0].evidenceId!;
      await expect(confirmProjectSignalLink(client, { evidenceId: id, companyId: DEMO_COMPANY, role: "GC", createProjectAndRole: true, note: "x", operatorId: op, now: new Date() }))
        .rejects.toMatchObject({ code: "officialSourceRequired" });
      expect((await confirmProjectSignalLink(client, { evidenceId: id, companyId: DEMO_COMPANY, role: "GC", createProjectAndRole: false, note: "link only", operatorId: op, now: new Date() })))
        .toMatchObject({ outcome: "LINKED", projectId: null, companyRoleId: null });
    });
  });

  it("reads one row per company, keeps DEMO apart from real metrics and never creates clients or requests", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const realBefore = (await loadStaffingIntelligence(client, new Date("2026-10-10T15:00:00Z"))).metrics.real;
      const evidenceId = (await importProjectSignals(client, unique(await fixture(), "t4"), op)).results[0].evidenceId!;
      await confirmProjectSignalLink(client, { evidenceId, companyId: DEMO_COMPANY, role: "ELECTRICAL_CONTRACTOR", createProjectAndRole: true, note: "fixture", operatorId: op, now: new Date() });
      const snapshot = await loadStaffingIntelligence(client, new Date("2026-10-10T15:00:00Z"));
      expect(snapshot.metrics.real).toEqual(realBefore); // the DEMO import does not move real metrics
      const demo = snapshot.companies.find((c) => c.companyId === DEMO_COMPANY)!;
      expect(demo).toMatchObject({ dataClass: "DEMO", demand: { demandClass: "INFERRED" } });
      expect(demo.demand.ruleNotes).toContain("AWARD_NOT_SHORTAGE");
      expect(demo.demand.requirements.headcount).toEqual({ value: null, origin: "UNKNOWN" });
      const names = snapshot.companies.filter((c) => c.dataClass === "REAL").map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(["Enterprise Electrical", "Walker Engineering", "Facility Solutions Group (FSG)"]));
      expect(new Set(snapshot.companies.map((c) => c.key)).size).toBe(snapshot.companies.length); // one row per company
      const walker = snapshot.companies.find((c) => c.name === "Walker Engineering")!;
      expect(walker.evidence.postingsTotal).toBe(1); // Walker 441: one posting (latest observation), not two
      expect(walker.demand.requirements.headcount.origin).toBe("UNKNOWN");
      expect(snapshot.metrics.real.staffRequests).toBe(0);
    });
  });
});
