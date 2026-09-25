import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OpportunitySearchPanel } from "../../components/opportunity-radar/opportunity-search-panel";
import { DEFAULT_RADAR_CADENCE_HOURS, nextScheduledRun, parseOpportunitySearchRequest, scheduledWindow } from "../../domain/opportunity-search";
import { buildOpportunityDiscoveryQueries } from "../../server/company-discovery/brave-search-provider";
import type { PostgresCompanyDiscoveryRepository } from "../../server/company-discovery/discovery-repository";
import { executeDueOpportunitySearches, runOpportunityDiscovery } from "../../server/opportunity-search/run-opportunity-discovery";

const request = { company: "MMR", keyword: null, tradeProfession: "Electrician", location: "Texas" };
const candidate = { queryKind: "COMBINED" as const, title: "MMR craft opening", url: "https://mmr.example/jobs/1", normalizedUrl: "https://mmr.example/jobs/1",
  domain: "mmr.example", providerDescription: "Public candidate", relevanceReason: "Combined operator search intent", providerRank: 1,
  evidenceCaptured: false, duplicate: false, correlatedCompanyId: null, correlatedProjectId: null, correlatedOpportunityId: null, humanReviewRequired: true };

function completed(candidates = [candidate]) {
  return { state: "COMPLETED" as const, runId: "run-1", target: "MMR", status: "COMPLETED" as const, sourceCount: 1,
    findingsCount: candidates.length, evidenceCount: 0, duplicatesSuppressedCount: 0, opportunitiesCreatedCount: 0, opportunitiesUpdatedCount: 0,
    startedAt: "2026-09-25T00:00:00.000Z", completedAt: "2026-09-25T00:00:01.000Z", targetResolutionState: "UNRESOLVED" as const,
    candidates, failureCode: null };
}

describe("Opportunity Radar governed search vertical slice", () => {
  it("requires bounded intent and retains all four optional dimensions", () => {
    expect(() => parseOpportunitySearchRequest({})).toThrow("At least one");
    expect(parseOpportunitySearchRequest({ company: " MMR ", keyword: " electricians ", tradeProfession: " Electrician ", location: " Texas " })).toEqual({ company: "MMR", keyword: "electricians", tradeProfession: "Electrician", location: "Texas" });
  });

  it("builds company, keyword, trade, location and combined external queries", () => {
    const queries = buildOpportunityDiscoveryQueries({ company: "Bechtel", keyword: "LNG", tradeProfession: "Electrician", location: "Texas" });
    expect(queries.map((query) => query.kind)).toEqual(["COMBINED", "EXACT_COMPANY", "KEYWORD", "TRADE_PROFESSION", "LOCATION"]);
    expect(queries.every((query) => query.query.includes("Texas"))).toBe(false);
    expect(queries[0].query).toContain("LNG");
  });

  it("does not inject electrical or Texas terms into a welding search", () => {
    const text = buildOpportunityDiscoveryQueries({ company: null, keyword: null, tradeProfession: "Welder", location: "Midland, TX" }).map((query) => query.query).join(" ").toLowerCase();
    expect(text).toContain("welder"); expect(text).toContain("midland, tx");
    expect(text).not.toContain("electric"); expect(text).not.toMatch(/\btexas\b/);
  });

  it("rejects inactive/unauthorized human execution before persistence or provider access", async () => {
    const repository = { acquireOpportunityRun: vi.fn() } as unknown as PostgresCompanyDiscoveryRepository;
    const provider = { search: vi.fn() };
    const result = await runOpportunityDiscovery({ request, authority: { kind: "HUMAN", authorization: { state: "AUTHENTICATED_BUT_UNAUTHORIZED", authUserId: "x", email: null } }, repository, provider, capture: { captureDestination: vi.fn() } });
    expect(result.state).toBe("UNAUTHORIZED"); expect(provider.search).not.toHaveBeenCalled();
  });

  it("persists one manual run and never auto-promotes a provider candidate", async () => {
    const repository = {
      acquireOpportunityRun: vi.fn().mockResolvedValue("run-1"),
      complete: vi.fn(async (_id, candidates) => completed(candidates)), fail: vi.fn(),
    } as unknown as PostgresCompanyDiscoveryRepository;
    const capture = { captureDestination: vi.fn().mockResolvedValue({ state: "CAPTURED", evidenceId: "evidence-1" }) };
    const result = await runOpportunityDiscovery({ request, authority: { kind: "HUMAN", authorization: { state: "AUTHORIZED", operator: { operatorId: "op-1", authUserId: "auth-1", email: "safe@example.invalid", permissions: ["company_discovery.run"] } } },
      repository, provider: { search: vi.fn().mockResolvedValue({ state: "COMPLETED", queries: [], candidates: [candidate], duplicatesSuppressed: 0 }) }, capture });
    expect(result.result?.opportunitiesCreatedCount).toBe(0);
    expect(repository.complete).toHaveBeenCalledOnce();
    expect((repository.complete as ReturnType<typeof vi.fn>).mock.calls[0][1][0].correlatedOpportunityId).toBeNull();
  });

  it("fails safely when the provider is absent without exposing a credential", async () => {
    const fail = vi.fn(async (_id, code, message) => ({ ...completed([]), state: "NOT_CONFIGURED" as const, status: "FAILED" as const, failureCode: code, target: message }));
    const repository = { acquireOpportunityRun: vi.fn().mockResolvedValue("run-1"), fail } as unknown as PostgresCompanyDiscoveryRepository;
    const result = await runOpportunityDiscovery({ request, authority: { kind: "SCHEDULER" }, repository,
      provider: { search: vi.fn().mockResolvedValue({ state: "NOT_CONFIGURED", queries: [] }) }, capture: { captureDestination: vi.fn() } });
    expect(result.result?.failureCode).toBe("NOT_CONFIGURED");
    expect(JSON.stringify(result)).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it("uses six-hour UTC windows and calculates the next run", () => {
    const at = new Date("2026-09-25T07:31:00Z"); const window = scheduledWindow(at, DEFAULT_RADAR_CADENCE_HOURS);
    expect(window.toISOString()).toBe("2026-09-25T06:00:00.000Z");
    expect(nextScheduledRun(window, 6).toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });

  it("suppresses a duplicate scheduled profile/window and advances cadence", async () => {
    const repository = { dueProfiles: vi.fn().mockResolvedValue([{ id: "profile-1", enabled: true, request, cadenceHours: 6, nextRunAt: "2026-09-25T06:00:00Z" }]),
      acquireOpportunityRun: vi.fn().mockResolvedValue(null), advanceProfile: vi.fn() } as unknown as PostgresCompanyDiscoveryRepository;
    const result = await executeDueOpportunitySearches({ repository, capture: { captureDestination: vi.fn() }, now: new Date("2026-09-25T07:00:00Z") });
    expect(result).toEqual({ due: 1, executed: 0, overlapsSuppressed: 1 }); expect(repository.advanceProfile).toHaveBeenCalledOnce();
  });

  it("bounds scheduled provider retries to three attempts", async () => {
    const search = vi.fn().mockResolvedValue({ state: "FAILED", queries: [], failure: { classification: "PROVIDER_FAILURE", message: "External discovery provider failed" } });
    const repository = { acquireOpportunityRun: vi.fn().mockResolvedValue("run-1"), fail: vi.fn(async () => completed([])) } as unknown as PostgresCompanyDiscoveryRepository;
    await runOpportunityDiscovery({ request, authority: { kind: "SCHEDULER" }, repository, provider: { search }, capture: { captureDestination: vi.fn() } });
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("renders bilingual controls, history and distinct refresh semantics", () => {
    const status = { available: true, automaticEnabled: true, cadenceHours: 6, nextRunAt: "2026-09-25T12:00:00Z", runs: [] };
    const en = renderToStaticMarkup(<OpportunitySearchPanel locale="en-US" authorized status={status} />);
    const es = renderToStaticMarkup(<OpportunitySearchPanel locale="es-US" authorized status={status} />);
    expect(en).toContain("Search Now"); expect(en).toContain("Refresh"); expect(en).toContain("Every 6 hours");
    expect(es).toContain("Buscar ahora"); expect(es).toContain("Actualizar"); expect(es).toContain("Cada 6 horas");
    expect(en).toContain('href="/opportunities"');
  });

  it("declares durable profiles, scheduled overlap uniqueness and cross-run fingerprints", async () => {
    const [migration, repository] = await Promise.all([
      readFile("supabase/migrations/20260925011609_opportunity_radar_search_automation.sql", "utf8"),
      readFile("src/server/company-discovery/discovery-repository.ts", "utf8"),
    ]);
    expect(migration).toContain("opportunity_search_profiles"); expect(migration).toContain("company_discovery_scheduled_window_unique");
    expect(migration).toContain("company_discovery_candidate_fingerprints"); expect(migration).toContain("cadence_hours integer not null default 6");
    expect(repository).toContain("on conflict(provider,normalized_candidate_url) do update");
    expect(repository).toContain("seen_count=company_discovery_candidate_fingerprints.seen_count+1");
  });

  it("keeps scheduler secrets server-only and configures an hourly UTC due-check", async () => {
    const [route, schedule] = await Promise.all([readFile("src/app/api/radar/scheduled-search/route.ts", "utf8"), readFile("vercel.json", "utf8")]);
    expect(route).toContain("process.env.CRON_SECRET"); expect(route).not.toContain("NEXT_PUBLIC");
    expect(JSON.parse(schedule).crons[0]).toEqual({ path: "/api/radar/scheduled-search", schedule: "0 * * * *" });
  });
});
