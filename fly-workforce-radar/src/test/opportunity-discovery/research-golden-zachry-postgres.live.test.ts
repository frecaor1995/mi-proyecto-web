import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresCompanyRepository } from "../../server/repositories/company/postgres-company-repository";
import { ensureInvestigation, loadBuyerInvestigation, runBuyerInvestigation, updateInvestigationSettings } from "../../server/contact-intelligence/buyer-investigation";
import { fixtureFetcher, fixtureSearch, loadFixtures } from "./fixtures-contact-research";

/**
 * Golden case (Contact Intelligence 2.1A): captured public pages and search results for one industrial contractor are
 * replayed through the GENERIC research engine against the local database (rolled back). The engine contains no rule
 * for this company; the test proves it reaches organization → location/address → local institution → professional →
 * corroboration → channel classification → procurement on its own, and that nothing is promoted beyond the evidence.
 */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");

const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });
const noHunter = async () => ({ state: "NOT_CONFIGURED" as const });
/** Fixture runs must not depend on how many real queries the local database recorded today (the cap itself is tested separately). */
const ISOLATED_CAP = { CONTACT_RESEARCH_DAILY_QUERY_CAP: "1000" };

describe.skipIf(!databaseUrl)("research engine — golden industrial-contractor fixture (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });

  it("reproduces the discovery chain generically and keeps the found professional below buyer status", async () => {
    const session = await pool.connect();
    try {
      await session.query("begin");
      const client = wrap(session);
      const { pages, searches } = loadFixtures("zachry");
      const queryLog: string[] = []; const fetchLog: string[] = [];
      const company = await new PostgresCompanyRepository(client).createCompany({ commonName: "Zachry Group", normalized: "zachry group golden fixture", observedAt: new Date() });
      const subject = { kind: "COMPANY" as const, companyId: company.id };
      const row = await ensureInvestigation(client, subject, null);
      await updateInvestigationSettings(client, row.id, { officialDomain: { domain: "zachrygroup.com", basis: "fixture" }, organizationType: "INDUSTRIAL_CONTRACTOR" });
      const run = await runBuyerInvestigation(client, subject, null, { search: fixtureSearch(searches, queryLog), fetcher: fixtureFetcher(pages, fetchLog), hunter: noHunter, spacingMs: 0, env: ISOLATED_CAP });

      // Budgets (golden 10): per-investigation ceilings respected.
      expect(run.research.queries).toBeLessThanOrEqual(24);
      expect(run.research.pages).toBeLessThanOrEqual(20);
      expect(run.research.dailyLimitHit).toBe(false);

      const view = await loadBuyerInvestigation(client, subject);
      const pivots = view.research.pivots;
      const byId = new Map(pivots.map((p) => [p.id, p]));
      const chainOf = (id: string): string[] => { const out: string[] = []; for (let p = byId.get(id); p; p = p.parentId ? byId.get(p.parentId) : undefined) out.unshift(p.kind); return out; };
      expect(pivots.every((p) => p.depth >= 0 && p.depth <= 3)).toBe(true);
      expect(pivots.filter((p) => p.kind === "COMPANY")).toHaveLength(1);
      expect(pivots.filter((p) => p.kind !== "COMPANY").every((p) => p.parentId && byId.has(p.parentId))).toBe(true);

      // 1–2: organization relations (subsidiary/brand and joint venture) with provenance.
      const subsidiary = pivots.find((p) => p.kind === "ORG_SUBSIDIARY" && /jvic/i.test(p.value));
      expect(subsidiary?.sourceUrl).toBeTruthy();
      expect(pivots.some((p) => p.kind === "ORG_JOINT_VENTURE")).toBe(true);

      // 3: official footprint → location → address (address parented by its location).
      const location = pivots.find((p) => p.kind === "LOCATION" && p.value === "Pasadena, TX")!;
      const address = pivots.find((p) => p.kind === "ADDRESS" && p.value.startsWith("3741"))!;
      expect(address.parentId).toBe(location.id);

      // 4: local institution tied to the address, parented by that address.
      const institution = pivots.find((p) => p.kind === "INSTITUTION" && /brazoriacountyeda/i.test(p.sourceUrl ?? ""))!;
      expect(institution.parentId).toBe(address.id);

      // 5: the professional is discovered through the institution, and the listed phone becomes a CHANNEL pivot.
      const person = pivots.find((p) => p.kind === "PERSON" && p.value === "Dale Kuntz")!;
      expect(person.parentId).toBe(institution.id);
      const channel = pivots.find((p) => p.kind === "CHANNEL" && p.value === "(713) 568-2612")!;
      expect(channel.parentId).toBe(person.id);
      expect(chainOf(channel.id)).toEqual(["COMPANY", "LOCATION", "ADDRESS", "INSTITUTION", "PERSON", "CHANNEL"]);

      // 6–7: field corroboration by independent registrable domains; phone association stays institution-published.
      const dale = [...view.people, ...view.otherPeople].find((p) => p.name === "Dale Kuntz")!;
      expect(dale).toBeTruthy();
      const insight = view.research.insights[dale.key];
      expect(insight.via.join(" > ")).toMatch(/LOCATION.*ADDRESS.*INSTITUTION/);
      expect(insight.corroboration.fields.identity.status).toBe("CORROBORATED");
      expect(new Set(insight.corroboration.fields.identity.domains).size).toBeGreaterThanOrEqual(2);
      expect(insight.corroboration.phoneAssociation).toBe("PUBLISHED_WITH_CONTACT_BY_INSTITUTION");
      expect(insight.corroboration.fields.externalWorkforceResponsibility.status).toBe("UNKNOWN");
      expect(insight.corroboration.stale).not.toBe("CURRENT");

      // 8: never promoted — not contactable via a verified direct line, not responsibility-confirmed, not the route's buyer.
      expect(dale.state).toBe("PROFESSIONAL_IDENTIFIED");
      expect(view.route.person?.name ?? null).not.toBe("Dale Kuntz");
      expect(view.route.phoneClass).not.toBe("A_DIRECT");
      expect(view.research.referenceContacts.some((c) => c.name === "Dale Kuntz" && c.association === "PUBLISHED_WITH_CONTACT_BY_INSTITUTION")).toBe(true);

      // 9: procurement distinguishes supplier/subcontract routes from external-workforce purchasing (unknown).
      expect(view.research.procurement).toMatchObject({ supplierRoute: true, subcontractRoute: true, externalWorkforcePurchasing: "UNKNOWN" });

      // Provenance: every pivot-tagged retrieval references a pivot of this investigation; no query left the fixture set.
      const orphan = await client.query<{ n: string }>(
        "select count(*) n from contact_source_retrievals r left join contact_research_pivots p on p.id=r.pivot_id where r.investigation_id=$1 and r.pivot_id is not null and (p.id is null or p.investigation_id<>r.investigation_id)", [row.id]);
      expect(Number(orphan.rows[0].n)).toBe(0);
      expect(queryLog.length).toBe(new Set(queryLog).size);
    } finally {
      await session.query("rollback").catch(() => undefined); session.release();
    }
  }, 120_000);
});
