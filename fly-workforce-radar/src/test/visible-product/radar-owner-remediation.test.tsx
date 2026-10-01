import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignalList } from "../../components/opportunity-discovery/signal-list";
import type { SignalListResult } from "../../server/opportunity-discovery/signals";

const result: SignalListResult = {
  state: "READY",
  counts: { NEW: 1, NEEDS_REVIEW: 0, VERIFIED: 0, REJECTED: 0, PROMOTED: 0, total: 1 },
  latestRun: { id: "run-1", provider: "BRAVE_WEB_SEARCH", target: "MMR Constructors", completedAt: "2026-09-27T23:50:54.995Z", findingsCount: 20, newlySeenCount: 4, rediscoveredCount: 16, historicalUniqueCount: 34 },
  signals: [{
    candidateId: "signal-1", title: "$35-$87/hr Mmr Electrician Jobs (NOW HIRING) May 2026", url: "https://example.com/job", domain: "example.com",
    description: "MMR Constructors is accepting resumes for journeyman electricians for a project in Abilene, Texas.", queryKind: "ELECTRICAL_HIRING", relevanceReason: "Electrical workforce demand",
    searchKeyword: null, searchLocation: null, searchTrade: null, firstDiscoveredAt: "2026-09-14T00:00:00Z", lastDiscoveredAt: "2026-09-27T23:50:55Z", timesSeen: 6,
    status: "NEW", promotedOpportunityId: null, company: "MMR Constructors", provider: "BRAVE_WEB_SEARCH", location: "Abilene, TX", trade: "journeyman electricians",
    workforceNeed: "journeyman electricians", pay: "$35-$87/hr", headcount: null, perDiem: null, publicationDate: null, qualityGroup: "READY_FOR_REVIEW", isLatestRun: true, previouslySeen: true,
    tradeCategoryId: "ELECTRICAL", professions: [{ tradeCategoryId: "ELECTRICAL", occupationIds: ["ELECTRICIAN", "JOURNEYMAN_ELECTRICIAN"] }], workforceTradeCode: "ELECTRICAL", locationTier: "TEXAS", signalCategory: "DIRECT_HIRING", signalCategories: ["DIRECT_HIRING"],
    jobBoard: false, searchedAs: null, freshness: "REDISCOVERED",
    qualification: { qualified: true, tier: "SECONDARY", category: "DIRECT_HIRING", organization: "MMR Constructors", project: null, noise: null, missing: [], evidenceOrigin: "SNIPPET", enrichment: null, expiry: null },
    page: null,
  }],
};

describe("Radar owner remediation", () => {
  it("makes the latest real run, provenance, unknown fields, and review action visible", () => {
    const html = renderToStaticMarkup(<SignalList locale="en-US" result={result} active={null} />);
    expect(html).toContain("Latest real discovery run");
    expect(html).toContain("20 real findings");
    expect(html).toContain("4 newly seen");
    expect(html).toContain("16 rediscovered");
    expect(html).toContain("Historical / previous runs · 34");
    expect(html).toContain("Demo / test · 0");
    expect(html).toContain("Ready for review");
    expect(html).toContain("Review signal");
    expect(html).toContain("Missing information");
    expect(html).toContain("Headcount · Per diem · Recruiter / contact");
    expect(html).not.toContain("Not found");
    expect(html).not.toContain("ELECTRICAL_HIRING");
  });
});
