import { describe, expect, it } from "vitest";
import {
  DISCOVERY_ACCEPTANCE_RECIPES, classifyElectricalLevel, diffWatchSnapshot, identifyAtsPlatform,
  nextWatchAt, observationIdentity, productMetrics, shouldReuseQuery, speedMetrics,
} from "../../domain/discovery-intelligence";
import { planRecipeQueries } from "../../server/discovery-intelligence/execute-discovery-recipes";

describe("Discovery Intelligence 1.0", () => {
  it("keeps strategies provider-neutral and recipes measurable", () => {
    expect(DISCOVERY_ACCEPTANCE_RECIPES.map((recipe) => recipe.strategy)).toEqual(["STAFFING_AGENCY_WATCH", "ATS_CAREER_DISCOVERY"]);
    expect(DISCOVERY_ACCEPTANCE_RECIPES.every((recipe) => recipe.version === 1 && recipe.queryTemplates.length >= 5)).toBe(true);
  });

  it.each([
    ["Electrical helper - Houston, TX", "HELPER"], ["Experienced apprentice electrician", "APPRENTICE"],
    ["Apprentice or Journeyman Electrician", "APPRENTICE_OR_JOURNEYMAN"], ["Journeyman license required", "JOURNEYMAN"],
    ["$31/hour electrician", "UNKNOWN"],
  ])("classifies only evidence-supported levels", (text, expected) => expect(classifyElectricalLevel(text)).toBe(expected));

  it("identifies ATS platforms from URL evidence", () => {
    expect(identifyAtsPlatform("https://jobs.lever.co/example/123")).toBe("LEVER");
    expect(identifyAtsPlatform("https://careers.example.com/jobs/123")).toBeNull();
  });

  it("uses layered stable observation identity", () => {
    const first = observationIdentity({ sourceId: "source", normalizedUrl: "https://example.com/a", externalPostingId: "42" });
    const second = observationIdentity({ sourceId: "source", normalizedUrl: "https://example.com/b", externalPostingId: "42" });
    expect(first).toBe(second);
  });

  it("establishes baseline then reports new, still observed and conservative absence", () => {
    const captured = "2026-10-05T12:00:00.000Z";
    expect(diffWatchSnapshot([], [{ identity: "a", normalizedUrl: "https://a.test", publishedAt: null }], captured, true)[0].state).toBe("BASELINE");
    const diff = diffWatchSnapshot([{ identity: "a", firstSeenAt: captured, lastSeenAt: captured }], [
      { identity: "a", normalizedUrl: "https://a.test", publishedAt: null }, { identity: "b", normalizedUrl: "https://b.test", publishedAt: null },
    ], "2026-10-06T12:00:00.000Z", false);
    expect(diff.map((item) => item.state)).toEqual(["STILL_OBSERVED", "NEW"]);
    expect(diffWatchSnapshot([{ identity: "a", firstSeenAt: captured, lastSeenAt: captured }], [], "2026-10-06T12:00:00.000Z", false)[0].state).toBe("NO_LONGER_OBSERVED");
  });

  it("supports configurable cadence and conservative query reuse", () => {
    expect(nextWatchAt(new Date("2026-10-05T00:00:00Z"), "B").toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(shouldReuseQuery({ previousCompletedAt: "2026-10-05T00:00:00Z", now: "2026-10-06T00:00:00Z", reuseWindowHours: 48 })).toEqual({ reuse: true, reason: "RECENT_IDENTICAL_RECIPE_QUERY" });
    expect(shouldReuseQuery({ previousCompletedAt: "2026-10-05T00:00:00Z", now: "2026-10-06T00:00:00Z", reuseWindowHours: 48, explicitRefresh: true }).reuse).toBe(false);
  });

  it("preserves unknown speed and coverage endpoints", () => {
    expect(speedMetrics({ publishedAt: null, firstSeenAt: "2026-10-05T00:00:00Z", reviewedAt: null, firstCommercialActionAt: null, firstConversationAt: null })).toEqual({
      detectionLatencyHours: null, reviewLatencyHours: null, timeToFirstTouchHours: null, timeToConversationHours: null,
    });
    expect(productMetrics({ benchmarkCount: null, benchmarkDetected: null, reviewedCount: 0, usefulCount: 0 })).toEqual({ benchmarkCoverage: null, usefulSignalYield: null });
  });

  it("builds a bounded recipe plan and reuses identical recent queries unless explicitly refreshed", () => {
    const recipe = { id: "00000000-0000-4000-8000-000000000001", recipe_key: "test", strategy_kind: "ATS_CAREER_DISCOVERY" as const,
      name: "Electrical test", query_templates: ["one", "two", "three"], execution_budget: 2, reuse_window_hours: 48, cadence_hours: 48 };
    const previous = new Map([[`${recipe.id}\u0000one`, { id: "previous", completedAt: "2026-10-05T00:00:00.000Z" }]]);
    const planned = planRecipeQueries([recipe], previous, "2026-10-05T01:00:00.000Z");
    expect(planned).toHaveLength(2);
    expect(planned.map((item) => item.reuse)).toEqual([true, false]);
    expect(planned.every((item) => item.plan.tradeCategoryId === "ELECTRICAL" && item.plan.geographyTier === "TEXAS")).toBe(true);
    expect(planRecipeQueries([recipe], previous, "2026-10-05T01:00:00.000Z", true).every((item) => !item.reuse)).toBe(true);
  });
});
