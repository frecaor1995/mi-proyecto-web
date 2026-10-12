import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DISCOVERY_TRADE_CATEGORIES, detectTrades } from "../../domain/discovery-coverage";
import { getProfessionOverview, listSignals, type ProfessionOverview } from "../../server/opportunity-discovery/signals";
import { automaticExecutionConfirmed } from "../../server/opportunity-search/get-discovery-refresh-status";
import { ProfessionGrid, ProfessionResults } from "../../components/opportunity-discovery/profession-explorer";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

let seq = 0;
const row = (overrides: Record<string, unknown>) => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, title: "Listing", candidate_url: `https://example.test/${seq}`, source_domain: "example.test",
  provider_description: null, query_kind: "TRADE_PROFESSION", relevance_reason: null, search_keyword: null, search_location: null, search_trade: null,
  target_text: "Multi-trade discovery cycle · 10 queries", provider: "BRAVE_WEB_SEARCH", first_seen: "2026-09-28T00:00:00Z", last_seen: new Date().toISOString(),
  times_seen: 1, status: "NEW", promoted_opportunity_id: null, is_latest_run: true, previously_seen: false, ...overrides,
});

const clientFor = (rows: readonly Record<string, unknown>[], searches: readonly Record<string, unknown>[] = []): SqlClient => ({
  query: async (sql: string) => {
    if (sql.includes("from discovery_query_executions where status")) return { rows: searches };
    if (sql.includes("group by status")) return { rows: [] };
    if (sql.includes("historical_count")) return { rows: [] };
    return { rows };
  },
}) as unknown as SqlClient;

const professionsOf = async (overrides: Record<string, unknown>) => {
  const result = await listSignals(clientFor([row(overrides)]), null, 100, "ALL");
  if (result.state !== "READY") throw new Error(result.state);
  return result.signals[0];
};

describe("profession classification integrity", () => {
  it("classifies an electrical listing from explicit occupation wording", async () => {
    const signal = await professionsOf({ title: "Journeyman Electricians needed — Houston, TX" });
    expect(signal.professions).toEqual([{ tradeCategoryId: "ELECTRICAL", occupationIds: ["ELECTRICIAN", "JOURNEYMAN_ELECTRICIAN"] }]);
  });

  it("classifies an HVAC listing", async () => {
    expect((await professionsOf({ title: "HVAC Technician - Commercial, Katy, TX" })).professions).toEqual([{ tradeCategoryId: "MECHANICAL_HVAC", occupationIds: ["HVAC_TECHNICIAN"] }]);
  });

  it("classifies an industrial listing", async () => {
    expect((await professionsOf({ title: "Combo Welder needed, Midland, TX" })).professions).toEqual([{ tradeCategoryId: "INDUSTRIAL", occupationIds: ["WELDER"] }]);
  });

  it("uses the source content, not the search terms, when they conflict", async () => {
    const conflict = { title: "Pipefitter Jobs in Houston, TX | iHireConstruction", searched_query: "construction laborer contract labor manpower needed Houston TX",
      searched_trade_category: "CONSTRUCTION", searched_signal_category: "MANPOWER_REQUEST", searched_geography_tier: "HOUSTON_METRO" };
    expect((await professionsOf(conflict)).professions.map((profession) => profession.tradeCategoryId)).toEqual(["MECHANICAL_HVAC"]);
    const construction = await listSignals(clientFor([row(conflict)]), null, 100, "ALL", { trade: "CONSTRUCTION" });
    if (construction.state !== "READY") throw new Error(construction.state);
    expect(construction.signals).toHaveLength(0);
  });

  it("lets the title decide over trades mentioned in passing in the excerpt", async () => {
    const signal = await professionsOf({ title: "Pipefitter Jobs in Houston, TX | iHireConstruction",
      provider_description: "Before becoming a Pipefitter, a person may start as a Plumber, a Welder, or a Construction Laborer." });
    expect(signal.professions).toEqual([{ tradeCategoryId: "MECHANICAL_HVAC", occupationIds: ["PIPEFITTER"] }]);
    const welders = await listSignals(clientFor([row({ title: "Pipefitter Jobs in Houston, TX", provider_description: "may start as a Welder" })]), null, 100, "ALL", { trade: "INDUSTRIAL", occupation: "WELDER" });
    if (welders.state !== "READY") throw new Error(welders.state);
    expect(welders.signals).toHaveLength(0);
    const generic = await professionsOf({ title: "Refinery turnaround — Port Arthur, TX", provider_description: "Now hiring millwrights for the unit restart." });
    expect(generic.professions).toEqual([{ tradeCategoryId: "MECHANICAL_HVAC", occupationIds: ["MILLWRIGHT"] }]);
  });

  it("keeps a listing with insufficient trade evidence unclassified even when searched for a trade", async () => {
    const vague = { title: "Commercial Contractors of Houston | Pasadena, TX", provider_description: "Our delivery model supports new-build and expansion programs.", searched_trade_category: "ELECTRICAL", searched_query: "electrician jobs hiring Houston TX" };
    expect((await professionsOf(vague)).professions).toEqual([]);
    const electrical = await listSignals(clientFor([row(vague)]), null, 100, "ALL", { trade: "ELECTRICAL" });
    if (electrical.state !== "READY") throw new Error(electrical.state);
    expect(electrical.signals).toHaveLength(0);
  });

  it("never reads a job-board listing count as a headcount", async () => {
    expect((await professionsOf({ title: "35 welder Jobs in Midland, TX, September 2026 | Glassdoor" })).headcount).toBeNull();
    expect((await professionsOf({ title: "117 instrumentation technician Jobs in Baytown, TX" })).headcount).toBeNull();
    expect((await professionsOf({ title: "Turnaround needs 40 pipefitters — Port Arthur, TX" })).headcount).toBe(40);
  });

  it("never assigns a profession from a company name alone", () => {
    expect(detectTrades("Walker Engineering announces new Dallas office leadership")).toEqual([]);
    expect(detectTrades("MMR Group quarterly update")).toEqual([]);
  });

  it("lists a multi-trade listing under each named profession without inflating unique totals", async () => {
    const rows = [
      row({ title: "Refinery turnaround hiring electricians, pipefitters and welders — Port Arthur, TX" }),
      row({ title: "Journeyman Electrician — Baytown, TX", status: "VERIFIED" }),
      row({ title: "Commercial construction news" }),
    ];
    const overview = await getProfessionOverview(clientFor(rows, [{ trade_category: "ELECTRICAL", last: "2026-09-28T03:05:47Z" }]));
    if (overview.state !== "READY") throw new Error(overview.state);
    const count = (id: string) => overview.professions.find((profession) => profession.tradeCategoryId === id)!;
    expect(overview.totalUnique).toBe(3);
    expect(overview.multiProfession).toBe(1);
    expect(overview.unclassified).toBe(1);
    expect(count("ELECTRICAL")).toMatchObject({ discovered: 2, notReviewed: 1, verified: 1, lastSuccessfulSearchAt: "2026-09-28T03:05:47.000Z" });
    expect(count("MECHANICAL_HVAC")).toMatchObject({ discovered: 1, lastSuccessfulSearchAt: null });
    expect(count("INDUSTRIAL").discovered).toBe(1);
    expect(count("CONSTRUCTION").discovered).toBe(0);
    const familySum = overview.professions.reduce((sum, profession) => sum + profession.discovered, 0);
    expect(familySum).toBeGreaterThan(overview.totalUnique - overview.unclassified);
  });

  it("narrows by specialty within a profession", async () => {
    const rows = [row({ title: "Combo Welder needed, Midland, TX" }), row({ title: "Instrumentation Technician — Freeport, TX" })];
    const welders = await listSignals(clientFor(rows), null, 100, "ALL", { trade: "INDUSTRIAL", occupation: "WELDER" });
    if (welders.state !== "READY") throw new Error(welders.state);
    expect(welders.signals.map((signal) => signal.title)).toEqual(["Combo Welder needed, Midland, TX"]);
  });
});

describe("automatic execution is only confirmed by evidence", () => {
  const now = Date.parse("2026-09-30T02:00:00Z");
  const cycle = (startedAt: string, trigger = "SCHEDULED", status = "COMPLETED") => ({ trigger: trigger as "SCHEDULED", status: status as "COMPLETED", startedAt });
  it("is not confirmed by a single scheduled run, manual runs, or a configured schedule", () => {
    expect(automaticExecutionConfirmed([cycle("2026-09-30T00:00:10Z")], 24, now)).toBe(false);
    expect(automaticExecutionConfirmed([cycle("2026-09-30T00:00:10Z", "MANUAL"), cycle("2026-09-29T00:00:10Z", "MANUAL")], 24, now)).toBe(false);
    expect(automaticExecutionConfirmed([], 24, now)).toBe(false);
  });
  it("is confirmed by two successful scheduled runs one cadence apart, the latest recent", () => {
    expect(automaticExecutionConfirmed([cycle("2026-09-30T00:00:10Z"), cycle("2026-09-29T00:00:12Z")], 24, now)).toBe(true);
    expect(automaticExecutionConfirmed([cycle("2026-09-30T00:00:10Z"), cycle("2026-09-29T00:00:12Z")], 24, now + 2 * 86_400_000)).toBe(false);
    expect(automaticExecutionConfirmed([cycle("2026-09-30T00:00:10Z"), cycle("2026-09-29T23:55:00Z")], 24, now)).toBe(false);
  });
});

describe("profession explorer UI", () => {
  const overview: ProfessionOverview = { state: "READY", totalUnique: 5, unclassified: 1, multiProfession: 0, qualifiedTotal: 3, verifiedTotal: 0,
    professions: DISCOVERY_TRADE_CATEGORIES.map((trade, index) => ({ tradeCategoryId: trade.id, discovered: index, qualified: Math.floor(index / 2), notReviewed: index, verified: 0, lastSuccessfulSearchAt: null })) };
  it("shows the six configured profession families with persisted counts and a clear action", () => {
    const html = renderToStaticMarkup(<ProfessionGrid locale="es-US" overview={overview} />);
    for (const trade of DISCOVERY_TRADE_CATEGORIES) {
      expect(html).toContain(trade.labelEs);
      expect(html).toContain(`/radar?trade=${trade.id}`);
    }
    expect(html.match(/Ver oportunidades/g)).toHaveLength(6);
    expect(html).toContain("Aún sin buscar");
  });
  it("shows a clear empty state and a way back to all professions", () => {
    const industrial = DISCOVERY_TRADE_CATEGORIES.find((trade) => trade.id === "INDUSTRIAL")!;
    const html = renderToStaticMarkup(<ProfessionResults locale="es-US" trade={industrial} overview={overview}
      result={{ state: "READY", signals: [], counts: { NEW: 0, NEEDS_REVIEW: 0, VERIFIED: 0, REJECTED: 0, PROMOTED: 0, total: 0 }, latestRun: null, filteredCount: 0 }}
      filters={{ occupation: "WELDER", tier: null, category: null, freshness: null, status: null }} />);
    expect(html).toContain("No se encontraron oportunidades");
    expect(html).toContain("Limpiar filtros");
    expect(html).toContain("Todas las profesiones");
    expect(html).toContain("Soldadores");
  });
});
