import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOpportunityRepository } from "../../server/repositories/opportunity/postgres-opportunity-repository";
import { assembleOpportunityRadarItem } from "../../server/read-models/opportunity-radar";
import { getOpportunityRadarPage, parseOpportunityRadarQuery } from "../../server/opportunity-radar/get-opportunity-radar-page";

const AS_OF = new Date("2026-09-05T12:00:00Z");
describe("UI-4A production opportunity enumeration", () => {
  let db: PGlite, repository: PostgresOpportunityRepository;
  beforeAll(async () => {
    db = new PGlite();
    for (const migration of ["20260817010000_canonical_model.sql", "20260817090000_opportunity_graph.sql"]) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    repository = new PostgresOpportunityRepository(db as unknown as SqlClient);
  });
  afterAll(async () => db.close());
  it("returns a successful known-empty result from canonical persistence", async () => { const result = await repository.enumerate({ search: "", sort: "company", currentness: "all", asOf: AS_OF, limit: 25, offset: 0 }); expect(result).toEqual({ items: [], total: 0 }); });
  it("enumerates only persisted opportunities and preserves stable identifiers", async () => {
    const company = (await db.query<{ id: string }>("insert into companies(common_name)values('Persisted Electric')returning id")).rows[0];
    const project = (await db.query<{ id: string }>("insert into projects(name,location_text)values('Grid Upgrade','Houston, TX')returning id")).rows[0];
    const opportunity = (await db.query<{ id: string }>("insert into opportunities(title,project_id,lifecycle,opportunity_identity_key,first_seen_at,last_seen_at,stale_after)values('Electrical demand',$1,'ACTIVE','stable-persisted-key',$2,$2,$3)returning id", [project.id, AS_OF.toISOString(), "2026-10-01T00:00:00Z"])).rows[0];
    await db.query("insert into opportunity_companies(opportunity_id,company_id,link_reason)values($1,$2,'COMMERCIAL_CONTEXT')", [opportunity.id, company.id]);
    const result = await repository.enumerate({ search: "Persisted", sort: "company", currentness: "CURRENT", asOf: AS_OF, limit: 25, offset: 0 });
    expect(result.total).toBe(1); expect(result.items[0].opportunity.id).toBe(opportunity.id); expect(result.items[0].opportunity.identityKey).toBe("stable-persisted-key"); expect(result.items[0].company?.commonName).toBe("Persisted Electric"); expect(result.items[0].location).toBe("Houston, TX");
    const view = assembleOpportunityRadarItem({ ...result.items[0], asOf: AS_OF }); expect(view.opportunityId).toBe(opportunity.id); expect(view.tradeId).toBeNull(); expect(view.externalManpowerAcceptance).toBeNull(); expect(view.verificationState).toBe("UNVERIFIED");
  });
  it("uses deterministic server pagination, search, currentness, and sorting", async () => { await db.query("insert into opportunities(title,lifecycle,opportunity_identity_key,first_seen_at,last_seen_at,stale_after)values('Alpha','ACTIVE','key-alpha',$1,$1,$2),('Zulu','ACTIVE','key-zulu',$1,$1,$3)", [AS_OF.toISOString(), "2026-08-01T00:00:00Z", "2026-11-01T00:00:00Z"]); const page = await repository.enumerate({ search: "", sort: "project", currentness: "all", asOf: AS_OF, limit: 1, offset: 0 }); expect(page.total).toBe(3); expect(page.items).toHaveLength(1); expect(page.items[0].opportunity.title).toBe("Alpha"); const stale = await repository.enumerate({ search: "Alpha", sort: "currentness", currentness: "STALE", asOf: AS_OF, limit: 25, offset: 0 }); expect(stale.total).toBe(1); });
  it("executes read-only SQL for enumeration", async () => { const statements: string[] = []; const client: SqlClient = { query: async <T>(text: string) => { statements.push(text); return { rows: (text.includes("count(*)::text count from") ? [{ count: "0" }] : []) as T[] }; } }; await new PostgresOpportunityRepository(client).enumerate({ search: "", sort: "company", currentness: "all", asOf: AS_OF, limit: 25, offset: 0 }); expect(statements.every(sql => sql.trim().toLowerCase().startsWith("select"))).toBe(true); });
  it("keeps query failure distinct from known-empty and unavailable", async () => { const query = parseOpportunityRadarQuery({}); const failed = await getOpportunityRadarPage(query, async () => { throw new Error("offline"); }); expect(failed.capability).toBe("UNKNOWN"); expect(failed.reason).toBe("OPPORTUNITY_QUERY_FAILED"); expect(failed.filteredCount).toBeNull(); });
});
