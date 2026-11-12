import { describe, expect, it } from "vitest";
import { contextNamesCompany, isAggregatorUrl, validateOpportunityCompanyLink } from "../../domain/opportunity-company-link";
import { DEMO_WORD_PATTERN, isDemoWorkerName, isDemoWorkerSql } from "../../domain/demo-records";
import { DEMO_WORKER_PATTERN } from "../../server/source-enrichment/workforce-readiness";

const input = { opportunityId: "o", companyId: "c", reason: "Posting names Walker Engineering as the hiring contractor.", evidenceNote: null, humanConfirmed: true, aggregatorAcknowledged: true };
const ctx = { opportunityIsDemo: false, companyIsDemo: false, aggregatorSource: true, existingLink: "NONE" as const };

describe("Opportunity → company link — rules", () => {
  it("recognizes job aggregators (and their subdomains) but not company sites", () => {
    expect(isAggregatorUrl("https://www.ziprecruiter.com/Jobs/Electrician/-in-Houston,TX")).toBe(true);
    expect(isAggregatorUrl("https://jobs.indeed.com/x")).toBe(true);
    expect(isAggregatorUrl("https://www.walkertx.com/careers/")).toBe(false);
    expect(isAggregatorUrl("not a url")).toBe(false);
  });
  it("only suggests a company when the recorded text names it; it never decides", () => {
    expect(contextNamesCompany("Walker Engineering", "Walker Engineering")).toBe(true);
    expect(contextNamesCompany("Walker Engineering, Inc.", "Walker Engineering")).toBe(true);
    expect(contextNamesCompany("Walker", "Walker Engineering")).toBe(false);
    expect(contextNamesCompany(null, "Walker Engineering")).toBe(false);
  });
  it("requires a reason, a human confirmation and, for aggregator evidence, the acknowledgment", () => {
    expect(validateOpportunityCompanyLink(input, ctx)).toEqual({});
    expect(validateOpportunityCompanyLink({ ...input, humanConfirmed: false, aggregatorAcknowledged: false, reason: "short" }, ctx))
      .toEqual({ humanConfirmed: "required", aggregatorAcknowledged: "required", reason: "tooShort" });
    expect(validateOpportunityCompanyLink({ ...input, aggregatorAcknowledged: false }, { ...ctx, aggregatorSource: false })).toEqual({});
  });
  it("refuses duplicates, a second company and REAL/DEMO mixing", () => {
    expect(validateOpportunityCompanyLink(input, { ...ctx, existingLink: "SAME_COMPANY" })).toEqual({ opportunityId: "alreadyLinked" });
    expect(validateOpportunityCompanyLink(input, { ...ctx, existingLink: "OTHER_COMPANY" })).toEqual({ opportunityId: "linkedToOtherCompany" });
    expect(validateOpportunityCompanyLink(input, { ...ctx, companyIsDemo: true })).toEqual({ opportunityId: "demoMismatch" });
  });
});

describe("Shared DEMO worker criterion", () => {
  it("matches the word demo anywhere, in any case, as the Workforce repositories do", () => {
    expect(["DEMO LOCAL Electrician", "demo segundo electricista", "Juan (Demo)", "Demo"].map(isDemoWorkerName)).toEqual([true, true, true, true]);
    expect(["Demond Smith", "Pandemonium Electric", "Juan Pérez", "", null].map(isDemoWorkerName)).toEqual([false, false, false, false, false]);
    expect(DEMO_WORKER_PATTERN).toBe(DEMO_WORD_PATTERN);
    expect(isDemoWorkerSql("w.display_name")).toBe("w.display_name ~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)'");
  });
});
