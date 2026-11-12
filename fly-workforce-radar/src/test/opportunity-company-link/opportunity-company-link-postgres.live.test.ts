import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { linkOpportunityToCompany, loadOpportunityCompanyLinks, OpportunityCompanyLinkError } from "../../server/opportunity-company-link/opportunity-company-link";
import { loadCorporateChannelCompanies } from "../../server/contact-intelligence/company-contact-desk";
import { getWorkforceReadiness } from "../../server/source-enrichment/workforce-readiness";

/** Opportunity → company link against the LOCAL database; every test is rolled back. No network. */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });
const DEMO_COMPANY = "40000000-0000-4000-8000-000000000001"; // existing "DEMO LOCAL Contractor"
const PILOT_OPPORTUNITY = "1fb90f31-a576-450e-9c6b-8fa1d01690dd";
const REASON = "Fixture: posting text names Walker Engineering as the hiring contractor.";

describe.skipIf(!databaseUrl)("Opportunity → company link (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session)); } finally { await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const operatorId = async (client: SqlClient) => (await client.query<{ id: string }>("select id from workforce_operators where status='ACTIVE' order by created_at limit 1")).rows[0].id;
  const walkerId = async (client: SqlClient) => (await client.query<{ id: string }>("select id from companies where common_name='Walker Engineering'")).rows[0]?.id;
  const errorsOf = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (e) { expect(e).toBeInstanceOf(OpportunityCompanyLinkError); return (e as OpportunityCompanyLinkError).errors; } };

  it("suggests, but never links, the pilot opportunity; only REAL candidates for a REAL company", async () => {
    await inTransaction(async (client) => {
      const walker = await walkerId(client); if (!walker) return;
      const view = await loadOpportunityCompanyLinks(client, walker);
      const pilot = view.candidates.find((c) => c.opportunityId === PILOT_OPPORTUNITY);
      if (!pilot) return; // already linked by a human: nothing to suggest
      expect(pilot).toMatchObject({ suggested: true, aggregatorSource: true, isDemo: false });
      expect(pilot.sources.map((s) => s.host)).toContain("ziprecruiter.com");
      expect(view.candidates.every((c) => !c.isDemo)).toBe(true);
      expect(view.linked.some((l) => l.opportunityId === PILOT_OPPORTUNITY)).toBe(false);
      const demo = await loadOpportunityCompanyLinks(client, DEMO_COMPANY);
      expect(demo.candidates.every((c) => c.isDemo)).toBe(true);
    });
  });

  it("links only with reason, human confirmation and aggregator acknowledgment; keeps pay and publisher untouched; refuses duplicates", async () => {
    await inTransaction(async (client) => {
      const walker = await walkerId(client); if (!walker) return;
      if ((await client.query("select 1 from opportunity_companies where opportunity_id=$1", [PILOT_OPPORTUNITY])).rows.length) return;
      const op = await operatorId(client);
      const counts = async () => (await client.query<Record<string, string>>("select (select count(*) from opportunities) o,(select count(*) from demand_signals) d,(select count(*) from workforce_workers) w")).rows[0];
      const demandBefore = (await client.query<Record<string, unknown>>("select d.* from opportunity_demand_signals od join demand_signals d on d.id=od.demand_signal_id where od.opportunity_id=$1", [PILOT_OPPORTUNITY])).rows;
      const before = await counts();
      const base = { opportunityId: PILOT_OPPORTUNITY, companyId: walker, reason: REASON, evidenceNote: null, humanConfirmed: true, aggregatorAcknowledged: true };
      expect(await errorsOf(linkOpportunityToCompany(client, { ...base, humanConfirmed: false, aggregatorAcknowledged: false }, op))).toEqual({ humanConfirmed: "required", aggregatorAcknowledged: "required" });
      expect(await errorsOf(linkOpportunityToCompany(client, { ...base, companyId: DEMO_COMPANY }, op))).toEqual({ opportunityId: "demoMismatch" });
      const linked = await linkOpportunityToCompany(client, base, op, new Date("2026-10-10T18:00:00Z"));
      expect(linked.aggregatorSource).toBe(true);
      const row = (await client.query<Record<string, unknown>>("select company_id,link_reason,evidence_id from opportunity_companies where opportunity_id=$1", [PILOT_OPPORTUNITY])).rows;
      expect(row).toEqual([{ company_id: walker, link_reason: REASON, evidence_id: linked.evidenceId }]);
      const evidence = (await client.query<{ metadata: Record<string, unknown>; extractor_version: string }>("select metadata,extractor_version from raw_evidence where id=$1", [linked.evidenceId])).rows[0];
      expect(evidence.extractor_version).toBe("opportunity-company-link@1");
      expect(evidence.metadata).toMatchObject({ kind: "OPPORTUNITY_COMPANY_LINK", payAttributedToCompany: false, publisherConfirmed: false, aggregatorSource: true, aggregatorAcknowledged: true, humanConfirmed: true });
      const demandAfter = (await client.query<Record<string, unknown>>("select d.* from opportunity_demand_signals od join demand_signals d on d.id=od.demand_signal_id where od.opportunity_id=$1", [PILOT_OPPORTUNITY])).rows;
      expect(demandAfter).toEqual(demandBefore); // pay, publisher and headcount are not touched by a link
      expect(await errorsOf(linkOpportunityToCompany(client, base, op))).toEqual({ opportunityId: "alreadyLinked" });
      expect(await counts()).toEqual(before); // no opportunity, demand or worker created
      const view = await loadOpportunityCompanyLinks(client, walker);
      expect(view.linked.find((l) => l.opportunityId === PILOT_OPPORTUNITY)).toMatchObject({ aggregatorSource: true, linkReason: REASON });
    });
    // rolled back: the pilot opportunity stays unlinked
    expect((await pool.query("select count(*)::int n from opportunity_companies where opportunity_id=$1", [PILOT_OPPORTUNITY])).rows[0].n).toBe(0);
  });

  it("lists companies with corporate channels and no investigation; readiness counts DEMO workers by the shared criterion", async () => {
    await inTransaction(async (client) => {
      const walker = await walkerId(client);
      const companies = await loadCorporateChannelCompanies(client);
      if (walker && (await client.query("select 1 from contact_routes where company_id=$1 and contact_person_id is null", [walker])).rows.length)
        expect(companies.find((c) => c.companyId === walker)).toMatchObject({ companyName: "Walker Engineering", isDemo: false });
      const expected = (await client.query<{ demo: boolean; n: number }>(`select w.display_name ~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)' demo,count(distinct w.id)::int n
          from worker_trade_occupations t join workforce_workers w on w.id=t.worker_id where t.trade_code='ELECTRICAL' and w.lifecycle_status='ACTIVE' group by 1`)).rows;
      const readiness = await getWorkforceReadiness(client, { professions: [{ tradeCategoryId: "ELECTRICAL", occupationIds: [] }], promotedOpportunityId: null });
      expect(readiness.tradeCodes).toEqual(["ELECTRICAL"]);
      expect(readiness.supply).toEqual({ real: expected.find((r) => !r.demo)?.n ?? 0, demo: expected.find((r) => r.demo)?.n ?? 0 });
      expect(readiness.supply.demo).toBeGreaterThanOrEqual(expected.length ? 1 : 0); // "demo segundo"-style names are DEMO, not real supply
    });
  });
});
