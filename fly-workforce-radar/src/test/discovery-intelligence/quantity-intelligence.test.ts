import { describe, expect, it } from "vitest";
import { canonicalHeadcount, classifyDiscoveryQuantity, marketPressureLabel, talentGap } from "../../domain/discovery-quantity";

const classify = (title: string, description = "", domain = "synthetic-employer.test", url = "https://synthetic-employer.test/jobs/example") => classifyDiscoveryQuantity({ title, description, domain, url });

describe("Discovery quantity intelligence 1.3", () => {
  it("classifies aggregator counts without turning them into headcount", () => { const q = classify("47 Synthetic Apprentice Jobs in North Metro", "Search results", "www.indeed.com"); expect(q).toMatchObject({ type: "AGGREGATE_MARKET_COUNT", value: 47, scope: "MARKET_SEARCH_RESULTS", employerHeadcount: null }); expect(canonicalHeadcount(q, true)).toBeNull(); });
  it("classifies explicit employer headcount but gates canonical headcount on human verification", () => { const q = classify("Project staffing", "We are hiring 24 electricians for the project."); expect(q).toMatchObject({ type: "EXPLICIT_EMPLOYER_HEADCOUNT", value: 24, scope: "EMPLOYER_WORKERS" }); expect(canonicalHeadcount(q, false)).toBeNull(); expect(canonicalHeadcount(q, true)).toBe(24); });
  it("keeps posting count distinct from headcount", () => { const q = classify("Electrical careers", "We published 7 distinct openings this week."); expect(q).toMatchObject({ type: "POSTING_COUNT", value: 7, scope: "DISTINCT_POSTINGS" }); expect(canonicalHeadcount(q, true)).toBeNull(); });
  it("preserves ambiguous quantity", () => expect(classify("Electrical hiring", "Several positions are available.")).toMatchObject({ type: "AMBIGUOUS_QUANTITY", value: null, scope: "UNKNOWN" }));
  it.each([
    ["$21-$39/hr Electrician", ""], ["Electrician", "$58,000 annual salary"], ["Electrician", "5 years experience"],
    ["September 2027 Electrician", ""], ["Electrician", "Monday 6AM-4PM"], ["Electrician", "Assignment duration 8 months"],
    ["Electrician", "Houston TX 77077"], ["Electrician", "Call 555-222-0199"], ["Electrician", "12% night differential"],
    ["Electrician", "$1500 signing bonus"], ["Job 88421", ""], ["Safety is our #1 value", ""],
  ])("does not treat non-workforce numbers as headcount: %s", (title, description) => expect(classify(title, description).type).toBe("NOT_A_WORKFORCE_QUANTITY"));
  it("never sums overlapping aggregator populations", () => { const signals = [classify("41 Synthetic Helper Jobs", "", "www.linkedin.com"), classify("63 Synthetic Helper Jobs", "", "www.glassdoor.com")]; expect(marketPressureLabel(signals)).toEqual({ sourceSignalCount: 2, summedMarketCount: null, label: "MULTIPLE SOURCES SHOW HIGH DEMAND" }); });
  it("keeps talent gap unknown without verified headcount", () => expect(talentGap(null, 7)).toEqual({ needed: null, viable: 7, gap: null, coverageRatio: null }));
  it("derives talent gap only from explicit headcount", () => expect(talentGap(12, 7)).toEqual({ needed: 12, viable: 7, gap: 5, coverageRatio: 7 / 12 }));
});
