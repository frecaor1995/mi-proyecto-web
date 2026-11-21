import { describe, expect, it } from "vitest";
import { listSignals } from "../../server/opportunity-discovery/signals";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

const row = (overrides: Record<string, unknown>) => ({
  id: "16dc4187-8b65-4587-9109-564496239b3c", title: "Electrician Jobs", candidate_url: "https://example.test/job", source_domain: "example.test",
  provider_description: null, query_kind: "ELECTRICAL_HIRING", relevance_reason: null, search_keyword: "electrician", search_location: "Midland, TX",
  search_trade: "ELECTRICAL", target_text: "MMR Constructors", provider: "BRAVE_WEB_SEARCH", first_seen: "2026-09-27T00:00:00Z",
  last_seen: "2026-09-27T00:00:00Z", times_seen: 1, status: "NEW", promoted_opportunity_id: null, is_latest_run: true, previously_seen: false,
  ...overrides,
});

const clientFor = (rows: readonly Record<string, unknown>[], counts: readonly Record<string, unknown>[] = []): SqlClient => ({
  query: async (sql: string) => {
    if (sql.includes("group by status")) return { rows: counts };
    if (sql.includes("historical_count")) return { rows: [] };
    return { rows };
  },
}) as unknown as SqlClient;

describe("Opportunity Radar signal integrity", () => {
  it("never presents search inputs as facts found in the source", async () => {
    const result = await listSignals(clientFor([row({ title: "Commercial construction news", provider_description: "A general article with no hiring details." })]), null);
    expect(result.state).toBe("READY");
    if (result.state !== "READY") return;
    const [signal] = result.signals;
    expect(signal.company).toBeNull();
    expect(signal.location).toBeNull();
    expect(signal.trade).toBeNull();
    expect(signal.workforceNeed).toBeNull();
    expect(signal.headcount).toBeNull();
    expect(signal.pay).toBeNull();
    expect(signal.status).toBe("NEW");
  });

  it("extracts only what the listing itself states", async () => {
    const result = await listSignals(clientFor([row({
      title: "$22-$57/hr Electrician Jobs Houston, TX (NOW HIRING)", target_text: "Walker Engineering",
      provider_description: "Walker Engineering is currently hiring for Licensed Journeyman Electricians in the Houston Metro.",
    })]), null);
    if (result.state !== "READY") throw new Error(result.state);
    const [signal] = result.signals;
    expect(signal.company).toBe("Walker Engineering");
    expect(signal.location).toBe("Houston, TX");
    expect(signal.pay).toBe("$22-$57/hr");
    expect(signal.workforceNeed).not.toBeNull();
    expect(signal.qualityGroup).toBe("READY_FOR_REVIEW");
  });

  it("reports human review states from reviews, never auto-verifying discoveries", async () => {
    const result = await listSignals(clientFor([], [{ status: "NEW", n: "3" }, { status: "VERIFIED", n: 1 }, { status: "PROMOTED", n: 1 }]), null);
    if (result.state !== "READY") throw new Error(result.state);
    expect(result.counts).toMatchObject({ NEW: 3, NEEDS_REVIEW: 0, VERIFIED: 1, REJECTED: 0, PROMOTED: 1, total: 5 });
  });

  it("never lets a manpower search turn a job-board ad into a manpower request, and prefers listing evidence over search intent", async () => {
    const jobAd = row({ title: "Pipefitter Jobs in Houston, TX (NOW HIRING)", source_domain: "www.ziprecruiter.com", provider_description: "Contract labor manpower needed now hiring pipefitters.",
      searched_query: "pipefitter contract labor manpower needed Houston TX", searched_trade_category: "CONSTRUCTION", searched_geography_tier: "TEXAS", searched_signal_category: "MANPOWER_REQUEST" });
    const manpower = await listSignals(clientFor([jobAd]), null, 100, "LATEST", { category: "MANPOWER_REQUEST" });
    if (manpower.state !== "READY") throw new Error(manpower.state);
    expect(manpower.signals).toHaveLength(0);
    const all = await listSignals(clientFor([jobAd]), null);
    if (all.state !== "READY") throw new Error(all.state);
    expect(all.signals[0]).toMatchObject({ signalCategory: "DIRECT_HIRING", jobBoard: true, tradeCategoryId: "MECHANICAL_HVAC", locationTier: "HOUSTON_METRO" });
    expect(all.signals[0].searchedAs?.signalCategory).toBe("MANPOWER_REQUEST");
    const construction = await listSignals(clientFor([jobAd]), null, 100, "LATEST", { trade: "CONSTRUCTION" });
    if (construction.state !== "READY") throw new Error(construction.state);
    expect(construction.signals).toHaveLength(0);
    const texas = await listSignals(clientFor([jobAd]), null, 100, "LATEST", { tier: "HOUSTON_METRO" });
    if (texas.state !== "READY") throw new Error(texas.state);
    expect(texas.signals).toHaveLength(1);
  });

  it("marks a rediscovered old posting STALE from its provider page date, not as a new opening", async () => {
    const result = await listSignals(clientFor([row({ previously_seen: true, page_age: "2025-01-10T00:00:00.000Z", last_seen: new Date().toISOString() })]), null);
    if (result.state !== "READY") throw new Error(result.state);
    expect(result.signals[0]).toMatchObject({ freshness: "STALE", publicationDate: "2025-01-10T00:00:00.000Z" });
  });

  it("is unavailable without a database instead of inventing signals", async () => {
    expect(await listSignals(null, null)).toEqual({ state: "UNAVAILABLE" });
  });
});
