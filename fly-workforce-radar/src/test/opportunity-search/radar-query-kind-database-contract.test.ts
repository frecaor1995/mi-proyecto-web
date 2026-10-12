import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DISCOVERY_QUERY_KINDS } from "../../domain/company-discovery";
import {
  buildCompanyDiscoveryQueries,
  buildOpportunityDiscoveryQueries,
} from "../../server/company-discovery/brave-search-provider";

const HISTORICAL_QUERY_KINDS = [
  "EXACT_COMPANY", "PROJECTS", "ELECTRICAL_HIRING", "WORKFORCE",
  "CONSTRUCTION", "PROCUREMENT", "TEXAS", "DISCOVERED_LOCATION",
] as const;

const RADAR_QUERY_KINDS = ["COMBINED", "KEYWORD", "TRADE_PROFESSION", "LOCATION"] as const;

describe("Opportunity Radar query-kind PostgreSQL contract", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create table public.company_discovery_candidates (
        id bigint generated always as identity primary key,
        query_kind text not null,
        constraint company_discovery_candidates_query_kind_check check (query_kind in (
          'EXACT_COMPANY', 'PROJECTS', 'ELECTRICAL_HIRING', 'WORKFORCE',
          'CONSTRUCTION', 'PROCUREMENT', 'TEXAS', 'DISCOVERED_LOCATION'
        ))
      );
      insert into public.company_discovery_candidates(query_kind)
      values ('EXACT_COMPANY'),('ELECTRICAL_HIRING'),('TEXAS');
    `);
    await db.exec(await readFile(
      "supabase/migrations/20260925021527_radar_query_kind_schema_compatibility.sql",
      "utf8",
    ));
  });

  afterEach(async () => db.close());

  it("preserves historical rows and accepts the complete canonical vocabulary", async () => {
    for (const queryKind of DISCOVERY_QUERY_KINDS) {
      await expect(db.query(
        "insert into public.company_discovery_candidates(query_kind) values($1)",
        [queryKind],
      )).resolves.toBeDefined();
    }
    const persisted = await db.query<{ query_kind: string }>(
      "select query_kind from public.company_discovery_candidates",
    );
    expect(new Set(persisted.rows.map((row) => row.query_kind))).toEqual(new Set(DISCOVERY_QUERY_KINDS));
    expect(new Set(DISCOVERY_QUERY_KINDS)).toEqual(new Set([...HISTORICAL_QUERY_KINDS, ...RADAR_QUERY_KINDS]));
  });

  it("rejects an unsupported query kind through the real database constraint", async () => {
    await expect(db.query(
      "insert into public.company_discovery_candidates(query_kind) values('UNSUPPORTED_KIND')",
    )).rejects.toThrow(/company_discovery_candidates_query_kind_check/i);
  });

  it("accepts every query kind emitted by both certified provider paths", async () => {
    const emitted = new Set([
      ...buildCompanyDiscoveryQueries("Fly Electric").map((query) => query.kind),
      ...buildOpportunityDiscoveryQueries({
        company: "Fly Electric",
        keyword: "data center",
        tradeProfession: "Electrician",
        location: "Virginia",
      }).map((query) => query.kind),
    ]);
    const allowed = new Set(DISCOVERY_QUERY_KINDS);
    expect([...emitted].filter((queryKind) => !allowed.has(queryKind))).toEqual([]);
    for (const queryKind of emitted) {
      await expect(db.query(
        "insert into public.company_discovery_candidates(query_kind) values($1)",
        [queryKind],
      )).resolves.toBeDefined();
    }
  });
});
