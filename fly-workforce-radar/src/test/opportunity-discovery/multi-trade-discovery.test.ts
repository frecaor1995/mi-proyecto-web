import { describe, expect, it } from "vitest";
import {
  DISCOVERY_GEOGRAPHIES, DISCOVERY_TRADE_CATEGORIES, SIGNAL_CATEGORIES, WATCHED_COMPANIES, classifySignalEvidence, coverageCellKey, detectLocation, detectTrade,
  planDiscoveryCycle, type PlannedDiscoveryQuery,
} from "../../domain/discovery-coverage";
import { BraveSearchProvider } from "../../server/company-discovery/brave-search-provider";
import { runDiscoveryCycle, type CycleRepository } from "../../server/opportunity-search/run-discovery-cycle";
import { executeDueOpportunitySearches } from "../../server/opportunity-search/run-opportunity-discovery";
import { REVIEW_ONLY_CAPTURE } from "../../server/company-discovery/candidate-processing";
import type { AuthorizationResult } from "../../server/auth/authorization";

describe("multi-trade discovery configuration", () => {
  it("covers every requested trade family and occupation through configuration", () => {
    const occupations = DISCOVERY_TRADE_CATEGORIES.flatMap((trade) => trade.occupations.map((occupation) => occupation.id));
    expect(DISCOVERY_TRADE_CATEGORIES.map((trade) => trade.id)).toEqual(["ELECTRICAL", "MECHANICAL_HVAC", "PLUMBING_PIPING", "INDUSTRIAL", "CONSTRUCTION", "EQUIPMENT_LOGISTICS"]);
    for (const id of ["ELECTRICIAN", "APPRENTICE_ELECTRICIAN", "JOURNEYMAN_ELECTRICIAN", "ELECTRICAL_SUPERVISOR", "HVAC_TECHNICIAN", "PIPEFITTER", "MILLWRIGHT", "PLUMBER",
      "PIPE_WELDER", "WELDER", "INSTRUMENTATION_TECHNICIAN", "CARPENTER", "IRONWORKER", "CONSTRUCTION_LABOR", "HEAVY_EQUIPMENT_OPERATOR", "RIGGER", "FORKLIFT_OPERATOR", "WAREHOUSE_LOGISTICS"]) {
      expect(occupations).toContain(id);
    }
    const geographies = DISCOVERY_GEOGRAPHIES.map((geo) => geo.id);
    for (const id of ["HOUSTON", "KATY", "PASADENA", "BAYTOWN", "FREEPORT", "BEAUMONT", "PORT_ARTHUR", "CORPUS_CHRISTI", "MIDLAND", "ODESSA", "DFW", "AUSTIN", "SAN_ANTONIO", "TEXAS_STATEWIDE"]) {
      expect(geographies).toContain(id);
    }
    expect(DISCOVERY_GEOGRAPHIES.some((geo) => geo.tier === "US_MOBILIZATION")).toBe(true);
  });

  it("accepts a newly configured trade without engine changes", () => {
    const plan = planDiscoveryCycle({ budget: 5, cycleNumber: 0, lastSearched: new Map(), companies: [],
      trades: [{ id: "SOLAR", label: "Solar", labelEs: "Solar", icon: "bolt", commercialTerm: "solar", scopeDetect: /\bsolar\b/i, occupations: [{ id: "SOLAR_INSTALLER", label: "Solar installers", labelEs: "Instaladores solares", searchTerm: "solar installer", detect: /solar installers?/i, workforceTradeCode: null }] }] });
    expect(plan).toHaveLength(5);
    expect(plan.every((query) => query.tradeCategoryId === "SOLAR")).toBe(true);
    expect(new Set(plan.map((query) => query.signalCategory)).size).toBe(5);
  });
});

describe("bounded rotating query plan", () => {
  it("respects the budget, mixes trades, geographies and demand types, and is not MMR- or electrical-only", () => {
    const plan = planDiscoveryCycle({ budget: 10, cycleNumber: 0, lastSearched: new Map() });
    expect(plan).toHaveLength(10);
    expect(plan.map((query) => query.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(plan.map((query) => query.tradeCategoryId).filter(Boolean)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(plan.map((query) => query.geographyTier))).toEqual(new Set(["HOUSTON_METRO", "TEXAS", "US_MOBILIZATION"]));
    expect(plan.filter((query) => query.company)).toHaveLength(1);
    expect(plan.filter((query) => /mmr/i.test(query.query)).length).toBeLessThanOrEqual(1);
    expect(plan.filter((query) => query.tradeCategoryId === "ELECTRICAL").length).toBeLessThanOrEqual(2);
  });

  it("never exceeds the hard cap", () => {
    expect(planDiscoveryCycle({ budget: 500, cycleNumber: 3, lastSearched: new Map() })).toHaveLength(20);
  });

  it("rotates to the least recently searched coverage cells so every cell is eventually covered", () => {
    const lastSearched = new Map<string, string>();
    const seen = new Set<string>();
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const plan = planDiscoveryCycle({ budget: 10, cycleNumber: cycle, lastSearched });
      for (const query of plan) {
        if (!query.tradeCategoryId) continue;
        const key = coverageCellKey(query.tradeCategoryId, query.signalCategory);
        seen.add(key);
        lastSearched.set(key, `2026-09-${String(10 + cycle).padStart(2, "0")}T00:00:00Z`);
      }
    }
    expect(seen.size).toBe(DISCOVERY_TRADE_CATEGORIES.length * SIGNAL_CATEGORIES.length);
  });

  it("rotates watched companies across cycles", () => {
    const companies = [0, 1, 2].map((cycle) => planDiscoveryCycle({ budget: 10, cycleNumber: cycle, lastSearched: new Map() }).find((query) => query.company)?.company);
    expect(companies).toEqual(WATCHED_COMPANIES.slice(0, 3));
  });
});

describe("evidence-based classification", () => {
  it("caps job-board listings at direct hiring, never a B2B manpower opportunity", () => {
    const evidence = classifySignalEvidence("Contract labor manpower needed — now hiring pipefitters in Baytown, TX", "www.indeed.com");
    expect(evidence.jobBoard).toBe(true);
    expect(evidence.categories).toEqual(["DIRECT_HIRING"]);
  });

  it("recognizes explicit subcontractor, procurement and project language only when stated", () => {
    expect(classifySignalEvidence("Zachry is seeking qualified electrical subcontractors for the Freeport LNG expansion", "zachry.com").categories).toContain("SUBCONTRACTOR_VENDOR");
    expect(classifySignalEvidence("Invitation to bid: HVAC maintenance services for Harris County", "harriscountytx.gov").primary).toBe("PROCUREMENT_BID");
    expect(classifySignalEvidence("A $2 billion plant expansion announced in Port Arthur", "news.example.com").categories).toContain("PROJECT_DEMAND");
    expect(classifySignalEvidence("Company history and leadership team", "example.com")).toEqual({ primary: null, categories: [], jobBoard: false });
  });

  it("detects trades from listing text across trades and prefers the most specific occupation", () => {
    expect(detectTrade("Hiring Journeyman Electricians in Houston")?.occupationId).toBe("JOURNEYMAN_ELECTRICIAN");
    expect(detectTrade("Pipe Welder needed for refinery turnaround")?.occupationId).toBe("PIPE_WELDER");
    expect(detectTrade("Millwrights wanted, Beaumont")).toMatchObject({ tradeCategoryId: "MECHANICAL_HVAC", workforceTradeCode: null });
    expect(detectTrade("Forklift Operator - 2nd shift")?.tradeCategoryId).toBe("EQUIPMENT_LOGISTICS");
    expect(detectTrade("Quarterly earnings report")).toBeNull();
  });

  it("detects locations and geography tiers from the listing, not the search", () => {
    expect(detectLocation("Welder Jobs Baytown, TX")).toMatchObject({ label: "Baytown, TX", tier: "HOUSTON_METRO" });
    expect(detectLocation("Pipefitter - Corpus Christi, Texas")).toMatchObject({ label: "Corpus Christi, TX", tier: "TEXAS" });
    expect(detectLocation("Shutdown work in Lake Charles, LA with per diem")).toMatchObject({ state: "LA", tier: "US_MOBILIZATION" });
    expect(detectLocation("Great pay and benefits")).toBeNull();
  });
});

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const plan = (count: number): readonly PlannedDiscoveryQuery[] => planDiscoveryCycle({ budget: count, cycleNumber: 0, lastSearched: new Map(), companies: [] });

describe("provider per-query execution", () => {
  it("isolates a failed query and keeps the others, with cross-query de-duplication and page dates", async () => {
    let call = 0;
    const transport = (async () => {
      call += 1;
      if (call === 2) return response({}, 500);
      return response({ web: { results: [
        { title: "Pipefitter jobs", url: "https://example.com/a?utm_source=x", description: "x", page_age: "2026-09-20T00:00:00" },
        { title: `Unique ${call}`, url: `https://example.com/u${call}` },
      ] } });
    }) as unknown as typeof fetch;
    const result = await new BraveSearchProvider("key", transport).searchPlanned(plan(3), { spacingMs: 0 });
    if (result.state !== "COMPLETED") throw new Error(result.state);
    expect(result.outcomes.map((outcome) => outcome.state)).toEqual(["COMPLETED", "FAILED", "COMPLETED"]);
    expect(result.outcomes[1].failure).toBe("PROVIDER_HTTP_500");
    expect(result.duplicatesSuppressed).toBe(1);
    expect(result.outcomes[0].candidates[0]).toMatchObject({ normalizedUrl: "https://example.com/a", providerPageAge: "2026-09-20T00:00:00.000Z", queryPosition: 1 });
  });

  it("stops at a rate limit and skips the rest instead of retrying", async () => {
    let calls = 0;
    const transport = (async () => { calls += 1; return response({}, 429); }) as unknown as typeof fetch;
    const result = await new BraveSearchProvider("key", transport).searchPlanned(plan(4), { spacingMs: 0 });
    expect(calls).toBe(1);
    expect(result.outcomes.map((outcome) => outcome.state)).toEqual(["FAILED", "SKIPPED", "SKIPPED", "SKIPPED"]);
  });

  it("reports NOT_CONFIGURED without calling the provider", async () => {
    const transport = (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch;
    expect((await new BraveSearchProvider("", transport).searchPlanned(plan(2))).state).toBe("NOT_CONFIGURED");
  });
});

function fakeRepository(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, value: unknown) => { (calls[name] ??= []).push(value); };
  const repository = {
    abandonStaleCycles: async (olderThan: Date) => { record("abandon", olderThan); return 0; },
    cycleRotationState: async () => ({ cycleNumber: 0, lastSearched: new Map(), lastCycleStartedAt: null }),
    acquireOpportunityRun: async (input: unknown) => { record("acquire", input); return "run-1"; },
    knownCandidateUrls: async () => new Set(["https://example.com/known"]),
    recordQueryExecutions: async (_runId: string, records: readonly { query: PlannedDiscoveryQuery }[]) => { record("executions", records); return new Map(records.map((r) => [r.query.position, `exec-${r.query.position}`])); },
    complete: async (...args: unknown[]) => { record("complete", args); return { status: (args[5] as { queryFailures: number }).queryFailures ? "PARTIAL" : "COMPLETED", findingsCount: (args[1] as unknown[]).length } as never; },
    fail: async (...args: unknown[]) => { record("fail", args); return { status: "FAILED", findingsCount: 0, failureCode: args[1] } as never; },
    ...overrides,
  } as unknown as CycleRepository;
  return { repository, calls };
}

const authorized: AuthorizationResult = { state: "AUTHORIZED", operator: { operatorId: "op-1" } } as unknown as AuthorizationResult;

describe("discovery cycle orchestration", () => {
  it("records every query, counts new vs rediscovered, links candidates to their query and never auto-verifies", async () => {
    const { repository, calls } = fakeRepository();
    const provider = { searchPlanned: async (queries: readonly PlannedDiscoveryQuery[]) => ({ state: "COMPLETED" as const, duplicatesSuppressed: 0, outcomes: queries.map((query) => ({
      query, state: "COMPLETED" as const, resultCount: 2, failure: null, candidates: [
        { queryKind: query.kind, title: "t", url: `https://example.com/new-${query.position}`, normalizedUrl: `https://example.com/new-${query.position}`, domain: "example.com", providerDescription: null,
          relevanceReason: query.reason, providerRank: 1, evidenceCaptured: false, duplicate: false, correlatedCompanyId: null, correlatedProjectId: null, correlatedOpportunityId: null, humanReviewRequired: true, queryPosition: query.position },
        ...(query.position === 1 ? [{ queryKind: query.kind, title: "k", url: "https://example.com/known", normalizedUrl: "https://example.com/known", domain: "example.com", providerDescription: null,
          relevanceReason: query.reason, providerRank: 2, evidenceCaptured: false, duplicate: false, correlatedCompanyId: null, correlatedProjectId: null, correlatedOpportunityId: null, humanReviewRequired: true, queryPosition: 1 }] : []),
      ] })) }) };
    const execution = await runDiscoveryCycle({ authority: { kind: "HUMAN", authorization: authorized }, repository, capture: REVIEW_ONLY_CAPTURE, provider, budget: 4 });
    expect(execution.state).toBe("EXECUTED");
    const executions = calls.executions[0] as { newCount: number; state: string }[];
    expect(executions).toHaveLength(4);
    expect(executions[0].newCount).toBe(1);
    const [, candidates] = calls.complete[0] as [string, { queryExecutionId: string; humanReviewRequired: boolean; correlatedOpportunityId: string | null }[]];
    expect(candidates.every((candidate) => candidate.queryExecutionId?.startsWith("exec-"))).toBe(true);
    expect(candidates.every((candidate) => candidate.humanReviewRequired && candidate.correlatedOpportunityId === null)).toBe(true);
    expect((calls.acquire[0] as { trigger: string }).trigger).toBe("MANUAL");
  });

  it("marks the run PARTIAL when some queries fail and FAILED when all fail", async () => {
    const outcomes = (states: readonly ("COMPLETED" | "FAILED")[]) => ({ searchPlanned: async (queries: readonly PlannedDiscoveryQuery[]) => ({ state: "COMPLETED" as const, duplicatesSuppressed: 0,
      outcomes: queries.map((query, index) => ({ query, state: states[index], resultCount: 0, failure: states[index] === "FAILED" ? "TIMEOUT" : null, candidates: [] })) }) });
    const partial = fakeRepository();
    expect((await runDiscoveryCycle({ authority: { kind: "SCHEDULER" }, repository: partial.repository, capture: REVIEW_ONLY_CAPTURE, provider: outcomes(["COMPLETED", "FAILED"]), budget: 2 })).result?.status).toBe("PARTIAL");
    const failed = fakeRepository();
    const execution = await runDiscoveryCycle({ authority: { kind: "SCHEDULER" }, repository: failed.repository, capture: REVIEW_ONLY_CAPTURE, provider: outcomes(["FAILED", "FAILED"]), budget: 2 });
    expect(execution.result?.status).toBe("FAILED");
    expect((failed.calls.executions[0] as unknown[]).length).toBe(2);
  });

  it("refuses manual cycles during the cooldown and when another cycle holds the lock", async () => {
    const recent = fakeRepository({ cycleRotationState: async () => ({ cycleNumber: 3, lastSearched: new Map(), lastCycleStartedAt: new Date(Date.now() - 60_000).toISOString() }) });
    expect((await runDiscoveryCycle({ authority: { kind: "HUMAN", authorization: authorized }, repository: recent.repository, capture: REVIEW_ONLY_CAPTURE })).state).toBe("COOLDOWN");
    expect(recent.calls.acquire).toBeUndefined();
    const locked = fakeRepository({ acquireOpportunityRun: async () => null });
    const provider = { searchPlanned: async () => { throw new Error("must not search"); } };
    expect((await runDiscoveryCycle({ authority: { kind: "SCHEDULER" }, repository: locked.repository, capture: REVIEW_ONLY_CAPTURE, provider })).state).toBe("OVERLAP_SUPPRESSED");
  });

  it("rejects unauthorized manual cycles before touching the provider", async () => {
    const { repository, calls } = fakeRepository();
    const execution = await runDiscoveryCycle({ authority: { kind: "HUMAN", authorization: { state: "UNAUTHENTICATED" } as unknown as AuthorizationResult }, repository, capture: REVIEW_ONLY_CAPTURE });
    expect(execution.state).toBe("UNAUTHORIZED");
    expect(calls.abandon).toBeUndefined();
  });
});

describe("existing scheduler drives the daily multi-trade cycle", () => {
  it("runs a due MULTI_TRADE_CYCLE profile as a scheduled cycle and advances it by its cadence", async () => {
    const advanced: [string, Date][] = [];
    const { repository, calls } = fakeRepository();
    const scheduler = Object.assign(repository, {
      dueProfiles: async () => [{ id: "profile-1", enabled: true, cadenceHours: 24, nextRunAt: "2026-09-28T00:00:00Z", kind: "MULTI_TRADE_CYCLE", queriesPerCycle: 3,
        request: { company: null, keyword: "Multi-trade discovery cycle", tradeProfession: null, location: null } }],
      advanceProfile: async (id: string, next: Date) => { advanced.push([id, next]); },
    });
    const cycleProvider = { searchPlanned: async (queries: readonly PlannedDiscoveryQuery[]) => ({ state: "COMPLETED" as const, duplicatesSuppressed: 0,
      outcomes: queries.map((query) => ({ query, state: "COMPLETED" as const, resultCount: 0, failure: null, candidates: [] })) }) };
    const now = new Date("2026-09-28T10:30:00Z");
    const result = await executeDueOpportunitySearches({ repository: scheduler as never, capture: REVIEW_ONLY_CAPTURE, cycleProvider, now });
    expect(result).toEqual({ due: 1, executed: 1, overlapsSuppressed: 0 });
    expect(calls.acquire[0]).toMatchObject({ trigger: "SCHEDULED", profileId: "profile-1", operatorId: null });
    expect((calls.executions[0] as unknown[]).length).toBe(3);
    expect(advanced[0][1].toISOString()).toBe("2026-09-29T00:00:00.000Z");
  });
});
