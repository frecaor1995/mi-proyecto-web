import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresCompanyRepository } from "../../server/repositories/company/postgres-company-repository";
import { ensureInvestigation, loadBuyerInvestigation, runBuyerInvestigation, updateInvestigationSettings } from "../../server/contact-intelligence/buyer-investigation";
import { runResearch } from "../../server/contact-intelligence/research-engine";
import { functionsFor } from "../../domain/buyer-intelligence";
import type { safeFetchSource } from "../../server/source-enrichment/safe-fetch";

/**
 * Contact Intelligence 2.1A research engine end to end against the LOCAL database as the runtime app role (real grants,
 * RLS, append-only triggers). Fictional organization, deterministic fake provider and fetcher (no network); every test is
 * rolled back. Proves COMPANY → LOCATION → ADDRESS → INSTITUTION → PERSON → CHANNEL → corroboration with parents, depth,
 * provenance, budgets and no state promotion.
 */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");

const ORG = "Brightwater Industrial Services";
const DOMAIN = "brightwater-fixture.com";
const INSTITUTION_URL = "https://members.harbor-alliance-fixture.org/list/member/brightwater-industrial-services-12";
const OWN_NEWS_URL = "https://www.brightwater-fixture.com/news/chamber-award";
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });
const text = (body: string, url: string) => ({ ok: true as const, status: 200, finalUrl: url, contentType: "text/plain", body: Buffer.from(body) });

const ABOUT = [
  "About Us", `${ORG} delivers maintenance and turnaround services to refining and chemical customers.`,
  "LOCATIONS", "Home Office", "100 Main Street", "Springfield, TX 77001", "+1 512.555.0100",
  "Fabrication Yard", "4200 Harbor Rd.", "Port Lavaca, TX 77979",
].join("\n");
const INSTITUTION = [
  "Member Directory", ORG, "Categories", "Industrial Maintenance", "4200 Harbor Rd.", "Port Lavaca", "TX", "77979", "(361) 555-0142",
  "About Us", `${ORG} provides maintenance and fabrication services.`,
  "Rep/Contact Info", "Morgan Testwell", "Close", "Morgan Testwell", "Director, Supply Chain", "Phone:", "(361) 555-0142", "Send an Email",
  "Casey Boardman", "Close", "Casey Boardman", "Board Director", "Send an Email",
].join("\n");

const fetches: string[] = [];
const fetcher = (async (url: string) => {
  fetches.push(url);
  if (url.replace(/\/$/, "").endsWith(`${DOMAIN}/about`)) return text(ABOUT, url);
  if (url === INSTITUTION_URL) return text(INSTITUTION, url);
  if (url === OWN_NEWS_URL) return text([`${ORG} wins Harbor Chamber member award`, "4200 Harbor Rd.", "Port Lavaca, TX 77979"].join("\n"), url);
  return { ok: false as const, status: 404, failure: "HTTP_ERROR" as const, finalUrl: url, contentType: "text/html" };
}) as unknown as typeof safeFetchSource;

const queries: string[] = [];
const search = {
  configured: true,
  async searchWeb(query: string) {
    queries.push(query);
    if (query.startsWith(`"${ORG}"`) && /member/.test(query) && /\bTX\b/.test(query)) {
      return [{ title: `${ORG} | Industrial Maintenance - Member / Harbor Economic Alliance`, url: INSTITUTION_URL, description: `${ORG} provides maintenance and fabrication services.`, pageAge: null },
        { title: `${ORG} wins Harbor Chamber member award`, url: OWN_NEWS_URL, description: `${ORG} recognized by the chamber.`, pageAge: null }];
    }
    if (query.includes('"Morgan Testwell"')) {
      return [{ title: `Morgan Testwell - Director, Supply Chain - ${ORG} | LinkedIn`, url: "https://www.linkedin.com/in/morgan-testwell-fixture", description: `Director, Supply Chain at ${ORG}. Port Lavaca, Texas.`, pageAge: null }];
    }
    return [];
  },
};
const noHunter = async () => ({ state: "NOT_CONFIGURED" as const });
/** Fixture runs must not depend on how many real queries the local database recorded today (the cap itself is tested separately). */
const ISOLATED_CAP = { CONTACT_RESEARCH_DAILY_QUERY_CAP: "1000" };

describe.skipIf(!databaseUrl)("research engine 2.1A (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session)); } finally { await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const setup = async (client: SqlClient) => {
    const company = await new PostgresCompanyRepository(client).createCompany({ commonName: ORG, normalized: "brightwater industrial services fixture", observedAt: new Date() });
    const subject = { kind: "COMPANY" as const, companyId: company.id };
    const row = await ensureInvestigation(client, subject, null);
    await updateInvestigationSettings(client, row.id, { officialDomain: { domain: DOMAIN, basis: "fixture" }, organizationType: "INDUSTRIAL_CONTRACTOR" });
    return { company, subject, investigationId: row.id };
  };

  it("chains COMPANY → LOCATION → ADDRESS → INSTITUTION → PERSON → CHANNEL with parents, depth and provenance, without promotion", async () => {
    await inTransaction(async (client) => {
      queries.length = 0; fetches.length = 0;
      const { company, subject, investigationId } = await setup(client);
      const run = await runBuyerInvestigation(client, subject, null, { search, fetcher, hunter: noHunter, spacingMs: 0, env: ISOLATED_CAP });
      expect(run.research.queries).toBeLessThanOrEqual(24);
      expect(run.research.pages).toBeLessThanOrEqual(20);

      const rows = (await client.query<{ id: string; kind: string; value: string; parent_pivot_id: string | null; depth: number; source_retrieval_id: string | null }>(
        "select id, kind, value, parent_pivot_id, depth, source_retrieval_id from contact_research_pivots where investigation_id=$1", [investigationId])).rows;
      const find = (kind: string, value: string | RegExp) => rows.find((r) => r.kind === kind && (typeof value === "string" ? r.value === value : value.test(r.value)));
      const root = find("COMPANY", ORG)!;
      const location = find("LOCATION", "Port Lavaca, TX")!;
      const address = find("ADDRESS", /^4200 /)!;
      const institution = find("INSTITUTION", INSTITUTION_URL)!;
      // The organization's own site is footprint, never a third-party institution.
      expect(rows.some((r) => r.kind === "INSTITUTION" && r.value === OWN_NEWS_URL)).toBe(false);
      const person = find("PERSON", "Morgan Testwell")!;
      const channel = find("CHANNEL", "(361) 555-0142")!;
      // Parents.
      expect(root.parent_pivot_id).toBeNull();
      expect(location.parent_pivot_id).toBe(root.id);
      expect(address.parent_pivot_id).toBe(location.id);
      expect(institution.parent_pivot_id).toBe(address.id);
      expect(person.parent_pivot_id).toBe(institution.id);
      expect(channel.parent_pivot_id).toBe(person.id);
      // Depth: official footprint is one hop; the institution needed one query hop more; same-page discoveries keep it.
      expect([root.depth, location.depth, address.depth, institution.depth, person.depth, channel.depth]).toEqual([0, 1, 1, 2, 2, 2]);
      expect(rows.every((r) => r.depth <= 3)).toBe(true);
      // Provenance: the institution/person/channel come from the fetched institution page, which was fetched for a pivot.
      const source = (await client.query<{ url: string; pivot_id: string | null; content_hash: string | null; excerpt: string | null }>(
        "select url, pivot_id, content_hash, excerpt from contact_source_retrievals where id=$1", [person.source_retrieval_id])).rows[0];
      expect(source.url).toBe(INSTITUTION_URL);
      expect(source.pivot_id).toBeTruthy();
      expect(source.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(source.excerpt).toContain("Morgan Testwell");
      expect(channel.source_retrieval_id).toBe(person.source_retrieval_id);

      // Role-aware person pivot query and channel pivot query were issued from the discovered person/channel.
      expect(queries.some((q) => q.startsWith('"Morgan Testwell"'))).toBe(true);
      expect(queries.some((q) => q.startsWith('"361-555-0142"'))).toBe(true);

      // Corroboration: identity on two independent registrable domains; phone stays institution-published.
      const view = await loadBuyerInvestigation(client, subject);
      const morgan = [...view.people, ...view.otherPeople].find((p) => p.name === "Morgan Testwell")!;
      const insight = view.research.insights[morgan.key];
      expect(insight.via.join(" > ")).toMatch(/LOCATION.*ADDRESS.*INSTITUTION/);
      expect(insight.corroboration.fields.identity.status).toBe("CORROBORATED");
      expect([...insight.corroboration.fields.identity.domains].sort()).toEqual(["harbor-alliance-fixture.org", "linkedin.com"]);
      expect(insight.corroboration.phoneAssociation).toBe("PUBLISHED_WITH_CONTACT_BY_INSTITUTION");
      expect(insight.corroboration.fields.commercialResponsibility.status).not.toBe("CONFIRMED");
      expect(insight.corroboration.fields.externalWorkforceResponsibility.status).toBe("UNKNOWN");

      // No promotion: a title plus an institution listing is not authority; no canonical contact is created.
      expect(morgan.state).not.toBe("COMMERCIAL_RESPONSIBILITY_CONFIRMED");
      // a Supply Chain title is a target function for research (2.1A remediation) — still only State 2 without evidence
      expect(view.people.map((p) => p.name)).toContain("Morgan Testwell");
      expect(morgan.state).toBe("PROFESSIONAL_IDENTIFIED");
      expect(view.route.phoneClass).not.toBe("A_DIRECT");
      expect(view.canonical).toEqual([]);
      const canonical = await client.query<{ n: string }>("select count(*) n from contact_people where company_id=$1", [company.id]);
      expect(Number(canonical.rows[0].n)).toBe(0);
      expect(view.research.procurement.externalWorkforcePurchasing).toBe("UNKNOWN");
      // Reference contacts are limited to target-function people: the listed board director is not one.
      expect(view.research.referenceContacts.map((c) => c.name)).toContain("Morgan Testwell");
      expect(view.research.referenceContacts.map((c) => c.name)).not.toContain("Casey Boardman");
    });
  }, 120_000);

  it("re-running is loop-free: no duplicate pivots, queries served from cache, append-only rows untouched", async () => {
    await inTransaction(async (client) => {
      const { subject, investigationId } = await setup(client);
      await runBuyerInvestigation(client, subject, null, { search, fetcher, hunter: noHunter, spacingMs: 0, env: ISOLATED_CAP });
      const before = (await client.query<{ n: string }>("select count(*) n from contact_research_pivots where investigation_id=$1", [investigationId])).rows[0].n;
      const firstRun = [...queries]; queries.length = 0;
      const again = await runBuyerInvestigation(client, subject, null, { search, fetcher, hunter: noHunter, spacingMs: 0, env: ISOLATED_CAP });
      const after = (await client.query<{ n: string }>("select count(*) n from contact_research_pivots where investigation_id=$1", [investigationId])).rows[0].n;
      expect(after).toBe(before);
      expect(again.research.pivotsCreated).toBe(0);
      expect(again.research.queryCacheHits).toBeGreaterThan(0);
      // A person found mid-run may earn one follow-up on the next run (stage 1 confirmation), but nothing already asked repeats.
      expect(queries.filter((q) => firstRun.includes(q))).toEqual([]);
      queries.length = 0;
      const third = await runBuyerInvestigation(client, subject, null, { search, fetcher, hunter: noHunter, spacingMs: 0, env: ISOLATED_CAP });
      expect(third.research.pivotsCreated).toBe(0);
      expect(queries).toEqual([]);
      await expect(client.query("update contact_research_pivots set value='x' where investigation_id=$1", [investigationId])).rejects.toThrow();
    });
  }, 120_000);

  it("respects the per-investigation query/page budget and the configurable daily cap", async () => {
    await inTransaction(async (client) => {
      const { investigationId } = await setup(client);
      const organization = { name: ORG, officialDomain: DOMAIN, type: "INDUSTRIAL_CONTRACTOR" as const, location: null, project: null };
      const small = await runResearch(client, { investigationId, organization, functions: functionsFor("INDUSTRIAL_CONTRACTOR"), search, fetcher, spacingMs: 0, env: {}, budget: { maxQueries: 3, maxPages: 2 } });
      expect(small.metrics.queries).toBeLessThanOrEqual(3);
      expect(small.metrics.pages).toBeLessThanOrEqual(2);
      const issued = await client.query<{ n: string }>("select count(*) n from contact_source_retrievals where investigation_id=$1 and provider='WEB_SEARCH_RESULT' and status in ('OK','FAILED')", [investigationId]);
      expect(Number(issued.rows[0].n)).toBeLessThanOrEqual(3);
    });
    await inTransaction(async (client) => {
      const { investigationId } = await setup(client);
      const organization = { name: ORG, officialDomain: DOMAIN, type: "INDUSTRIAL_CONTRACTOR" as const, location: null, project: null };
      queries.length = 0;
      const capped = await runResearch(client, { investigationId, organization, functions: functionsFor("INDUSTRIAL_CONTRACTOR"), search, fetcher, spacingMs: 0, env: { CONTACT_RESEARCH_DAILY_QUERY_CAP: "1" } });
      expect(capped.metrics.dailyLimitHit).toBe(true);
      expect(queries.length).toBeLessThanOrEqual(1);
    });
  }, 120_000);
});
