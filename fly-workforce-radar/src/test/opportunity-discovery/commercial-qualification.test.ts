import { describe, expect, it } from "vitest";
import { qualifyCommercialSignal, type QualificationInput } from "../../domain/commercial-qualification";
import { DISCOVERY_GEOGRAPHIES, DISCOVERY_TRADE_CATEGORIES, SIGNAL_CATEGORIES, classifySignalEvidence, detectLocation, detectTrades, planDiscoveryCycle } from "../../domain/discovery-coverage";
import { providerQuotaFrom } from "../../server/company-discovery/brave-search-provider";
import { isRepeatableNoise } from "../../server/opportunity-search/run-discovery-cycle";
import { listSignals } from "../../server/opportunity-discovery/signals";
import { automaticExecutionConfirmed } from "../../server/opportunity-search/get-discovery-refresh-status";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

/** Builds gate input exactly the way the read model does: from the source text only. */
const input = (title: string, description: string | null, url: string, overrides: Partial<QualificationInput> = {}): QualificationInput => {
  const domain = new URL(url).hostname;
  const text = `${title} ${description ?? ""}`;
  const fromTitle = detectTrades(title);
  return { title, description, url, domain, professions: fromTitle.length ? fromTitle : detectTrades(text), titleNamesProfession: fromTitle.length > 0,
    location: detectLocation(text), categories: classifySignalEvidence(text, domain).categories, stale: false, ...overrides };
};

describe("commercial noise control", () => {
  it("never admits job-board search/count pages, even when they state a number", () => {
    const result = qualifyCommercialSignal(input("35 Welder Jobs in Midland, TX | Glassdoor", "Search Welder jobs in Midland, TX with company ratings & salaries. 35 open jobs.", "https://www.glassdoor.com/Job/midland-welder-jobs-SRCH_IL.0,7_IC1140171_KO8,14.htm"));
    expect(result).toMatchObject({ qualified: false, tier: "EXCLUDED", noise: "JOB_BOARD_AGGREGATION" });
  });
  it("excludes directories, 'near me' pages and bare homepages", () => {
    expect(qualifyCommercialSignal(input("Industrial Contractors in Texas | Top 25", "Find the best industrial contractors in Texas.", "https://www.example-listings.com/texas/industrial")).noise).toBe("DIRECTORY");
    expect(qualifyCommercialSignal(input("Electrician Jobs Near Me", "Now hiring electricians near you in Houston, TX.", "https://www.example.com/electrician-jobs")).noise).toBe("DIRECTORY");
    expect(qualifyCommercialSignal(input("Company XYZ — Home", "Company XYZ provides industrial services in Houston, TX.", "https://www.companyxyz.com/")).noise).toBe("HOMEPAGE");
  });
  it("excludes career/licensing information, stale pages and results without source context", () => {
    expect(qualifyCommercialSignal(input("How to Become a Journeyman Electrician in Texas", "Licensing requirements and salary.", "https://www.example.edu/become-electrician")).noise).toBe("CAREER_INFORMATION");
    expect(qualifyCommercialSignal(input("Zachry is seeking pipefitters — Freeport, TX", "Zachry Group is seeking pipefitters.", "https://zachrygroup.com/careers", { stale: true })).noise).toBe("STALE");
    expect(qualifyCommercialSignal(input("Welders needed — Midland, TX", null, "https://www.acme.com/welders")).noise).toBe("NO_SOURCE_CONTEXT");
  });
});

describe("commercial qualification categories (source evidence only)", () => {
  it("A — explicit external workforce demand on the contractor's own page is primary", () => {
    const result = qualifyCommercialSignal(input("Zachry Group manpower request — Freeport, TX",
      "Zachry Group is seeking contract labor and manpower suppliers for welders and pipefitters at the Freeport LNG Expansion, Freeport, TX.", "https://zachrygroup.com/suppliers/manpower"));
    expect(result).toMatchObject({ qualified: true, tier: "PRIMARY", category: "MANPOWER_REQUEST", organization: "Zachry Group" });
  });
  it("B — explicit subcontractor request is primary", () => {
    const result = qualifyCommercialSignal(input("Kiewit invites electrical subcontractors — Port Arthur LNG Phase 2",
      "Kiewit is inviting qualified electrical subcontractors to submit prequalification for the Port Arthur LNG Phase 2 project in Port Arthur, TX.", "https://www.kiewit.com/subcontractors/port-arthur"));
    expect(result).toMatchObject({ qualified: true, tier: "PRIMARY", category: "SUBCONTRACTOR_VENDOR" });
  });
  it("C — a public solicitation with trade scope is primary", () => {
    const result = qualifyCommercialSignal(input("Invitation to Bid: HVAC Maintenance Services",
      "Harris County invites sealed bids for HVAC maintenance services at county facilities in Houston, TX. Bid due October 30.", "https://purchasing.harriscountytx.gov/bids/25-0412"));
    expect(result).toMatchObject({ qualified: true, tier: "PRIMARY", category: "PROCUREMENT_BID", organization: "Harris County" });
  });
  it("C — identifies the issuing public body even in an all-caps notice", () => {
    const result = qualifyCommercialSignal(input("JEFFERSON COUNTY PURCHASING DEPARTMENT Deborah L. Clark, Purchasing Agent",
      "Request for proposals: electrical services and professional engineering services for county facilities in Beaumont, TX.", "https://www.jeffersoncountytx.gov/purchasing/rfp-2026-14.pdf"));
    expect(result).toMatchObject({ qualified: true, tier: "PRIMARY", category: "PROCUREMENT_BID", organization: "Jefferson County" });
  });

  it("does not treat a professional-engineering solicitation as trade workforce demand (real Jefferson County RFQ wording)", () => {
    const result = qualifyCommercialSignal(input("JEFFERSON COUNTY PURCHASING DEPARTMENT Deborah L. Clark, Purchasing Agent",
      "1149 Pearl Street, 1st Floor, Beaumont, TX 77701 ... Professional Engineering Services for Electrical Vault Replacement at the Jack Brooks Regional Airport ... You are invited to submit a statement of qualifications in accordance with (RFQ 21-045/JW)",
      "https://jeffersoncountytx.gov/blobs/purchasing/nfb/BID/180.pdf"));
    expect(result.qualified).toBe(false);
    expect(result.missing).toContain("PROFESSION");
  });

  it("recovers a named new-construction project that mentions a licensing registry (false negative fixed)", () => {
    const result = qualifyCommercialSignal(input("MMR CONSTRUCTORS INC | Houston, TX | Opening ~Sep 2027 | Zabalist",
      "13008 GULF COMMERCE DRIVE, Houston, TX 77034 · MMR CONSTRUCTORS INC is a new construction project at 13008 GULF COMMERCE DRIVE, Houston, in Harris County, TX, tracked from its Texas Department of Licensing and Regulation registration",
      "https://www.zabalist.com/projects/TABS2026026008"));
    expect(result).toMatchObject({ qualified: true, tier: "SECONDARY", category: "PROJECT_DEMAND", project: "New construction at 13008 Gulf Commerce Drive", organization: "MMR Constructors Inc" });
  });

  it("D — a named project is secondary: demand possible, supplier acceptance not established", () => {
    const result = qualifyCommercialSignal(input("ExxonMobil announces Baytown Chemical Expansion",
      "ExxonMobil announced a $2 billion Baytown Chemical Expansion; construction begins in 2027 in Baytown, TX.", "https://news.example.com/exxonmobil-baytown"));
    expect(result).toMatchObject({ qualified: true, tier: "SECONDARY", category: "PROJECT_DEMAND", project: "Baytown Chemical Expansion" });
  });
  it("E — a specific employer's posting is secondary direct hiring, never a manpower opportunity", () => {
    const result = qualifyCommercialSignal(input("Journeyman Electricians at MMR Constructors, Inc. - Abilene, TX",
      "Contract labor manpower needed for an industrial project in Abilene, TX.", "https://www.roaddogjobs.com/job/123456"));
    expect(result).toMatchObject({ qualified: true, tier: "SECONDARY", category: "DIRECT_HIRING", organization: "MMR Constructors, Inc" });
  });
  it("F — insufficient evidence stays not qualified and says what is missing", () => {
    const result = qualifyCommercialSignal(input("Midland TX Industrial Construction | Permian Basin Contractor", "We deliver industrial construction across the Permian Basin.", "https://www.permian-builder.com/industrial"));
    expect(result.qualified).toBe(false);
    expect(result.missing).toContain("REQUIREMENT");
  });
  it("does not require the profession to exist in the current workforce database (demand first)", () => {
    const carpenters = qualifyCommercialSignal(input("Hensel Phelps manpower request — Austin, TX", "Hensel Phelps is seeking contract labor for 40 carpenters and ironworkers in Austin, TX.", "https://www.henselphelps.com/trade-partners/labor"));
    expect(DISCOVERY_TRADE_CATEGORIES.find((trade) => trade.id === "CONSTRUCTION")!.occupations.find((occupation) => occupation.id === "CARPENTER")!.workforceTradeCode).toBeNull();
    expect(carpenters).toMatchObject({ qualified: true, category: "MANPOWER_REQUEST" });
  });
});

let seq = 0;
const row = (overrides: Record<string, unknown>) => ({
  id: `10000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, title: "t", candidate_url: `https://example.test/${seq}`, source_domain: "example.test",
  provider_description: "d", query_kind: "WORKFORCE", relevance_reason: null, search_keyword: null, search_location: null, search_trade: null,
  target_text: "Multi-trade discovery cycle · 10 queries", provider: "BRAVE_WEB_SEARCH", first_seen: "2026-09-29T00:00:00Z", last_seen: new Date().toISOString(),
  times_seen: 1, status: "NEW", promoted_opportunity_id: null, is_latest_run: true, previously_seen: false, ...overrides,
});
const clientFor = (rows: readonly Record<string, unknown>[]): SqlClient => ({ query: async (sql: string) => ({ rows: sql.includes("group by status") || sql.includes("historical_count") ? [] : rows }) }) as unknown as SqlClient;

describe("qualification in the read model", () => {
  it("never treats the search query as evidence", async () => {
    const result = await listSignals(clientFor([row({ title: "Industrial Services | Acme", provider_description: "Acme provides services.", searched_query: "welder contract labor manpower needed Houston TX", searched_signal_category: "MANPOWER_REQUEST", searched_trade_category: "INDUSTRIAL" })]), null, 100, "ALL");
    if (result.state !== "READY") throw new Error(result.state);
    expect(result.signals[0].qualification.qualified).toBe(false);
  });
  it("lists a qualified trade-scope request under its profession without inventing a specialty; noise gets no family", async () => {
    const result = await listSignals(clientFor([
      row({ title: "JEFFERSON COUNTY PURCHASING DEPARTMENT", provider_description: "Request for proposals: electrical services for county facilities in Beaumont, TX.", source_domain: "www.jeffersoncountytx.gov", candidate_url: "https://www.jeffersoncountytx.gov/rfp/14" }),
      row({ title: "Electrical Contractors in Beaumont, TX | Top 10", provider_description: "Find electrical services near you.", source_domain: "www.example-list.com", candidate_url: "https://www.example-list.com/beaumont" }),
    ]), null, 100, "ALL", { trade: "ELECTRICAL" });
    if (result.state !== "READY") throw new Error(result.state);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ professions: [{ tradeCategoryId: "ELECTRICAL", occupationIds: [] }], qualification: { qualified: true, category: "PROCUREMENT_BID", organization: "Jefferson County" } });
  });

  it("commercial view keeps human-reviewed signals, hides unqualified new ones, and never auto-verifies", async () => {
    const rows = [
      row({ title: "$22-$57/hr Electrician Jobs Houston, TX (NOW HIRING)", source_domain: "www.ziprecruiter.com", candidate_url: "https://www.ziprecruiter.com/Jobs/Electrician/-in-Houston,TX", status: "PROMOTED", provider_description: "Walker Engineering is hiring electricians." }),
      row({ title: "35 welder Jobs in Midland, TX | Glassdoor", source_domain: "www.glassdoor.com", candidate_url: "https://www.glassdoor.com/Job/x.htm" }),
      row({ title: "Journeyman Electricians at MMR Constructors, Inc. - Abilene, TX", source_domain: "www.roaddogjobs.com", candidate_url: "https://www.roaddogjobs.com/job/1", provider_description: "Industrial electrical work in Abilene, TX." }),
      row({ title: "Journeyman Electrician at Acme Electric - Houston, TX", source_domain: "www.roaddogjobs.com", candidate_url: "https://www.roaddogjobs.com/job/2", provider_description: "Now hiring in Houston, TX.", status: "REJECTED" }),
    ];
    const commercial = await listSignals(clientFor(rows), null, 100, "ALL", { qualifiedOnly: true });
    if (commercial.state !== "READY") throw new Error(commercial.state);
    expect(commercial.signals.map((signal) => signal.status).sort()).toEqual(["NEW", "PROMOTED"]);
    expect(commercial.signals.find((signal) => signal.status === "NEW")?.qualification).toMatchObject({ qualified: true, category: "DIRECT_HIRING" });
    const rejected = await listSignals(clientFor(rows), "REJECTED", 100, "ALL", { qualifiedOnly: true, statusRequested: true });
    if (rejected.state !== "READY") throw new Error(rejected.state);
    expect(rejected.signals.some((signal) => signal.status === "REJECTED")).toBe(true);
    const raw = await listSignals(clientFor(rows), null, 100, "ALL");
    if (raw.state !== "READY") throw new Error(raw.state);
    expect(raw.signals).toHaveLength(4);
    expect(raw.signals.every((signal) => signal.status !== "VERIFIED" || rows.some((r) => r.status === "VERIFIED"))).toBe(true);
  });
});

describe("refresh reliability and provider budget", () => {
  it("parses the provider's own rate-limit headers", () => {
    const headers = new Headers({ "x-ratelimit-limit": "1, 15000", "x-ratelimit-remaining": "0, 14872", "x-ratelimit-reset": "1, 1987654" });
    expect(providerQuotaFrom(headers, new Date("2026-09-30T00:00:00Z"))).toEqual({ perSecondLimit: 1, monthlyLimit: 15000, monthlyRemaining: 14872, monthlyResetSeconds: 1987654, observedAt: "2026-09-30T00:00:00.000Z" });
    expect(providerQuotaFrom(new Headers())).toBeNull();
  });
  it("does not re-store identical generic pages, but keeps specific postings", () => {
    expect(isRepeatableNoise({ title: "143 pipe fitter Jobs in Houston, TX | Glassdoor", providerDescription: "x", url: "https://www.glassdoor.com/Job/houston.htm", domain: "www.glassdoor.com" })).toBe(true);
    expect(isRepeatableNoise({ title: "Pipefitter at Acme Industrial - Baytown, TX", providerDescription: "x", url: "https://www.roaddogjobs.com/job/77", domain: "www.roaddogjobs.com" })).toBe(false);
  });
  it("keeps every planned query bounded, provider-safe and pointed away from aggregators", () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      const plan = planDiscoveryCycle({ budget: 10, cycleNumber: cycle, lastSearched: new Map() });
      expect(plan).toHaveLength(10);
      for (const query of plan) {
        expect(query.query.length).toBeLessThanOrEqual(300);
        expect(query.query.split(/\s+/).length).toBeLessThanOrEqual(50);
        expect(query.query).toContain("-site:indeed.com");
      }
    }
    expect(DISCOVERY_GEOGRAPHIES.length * SIGNAL_CATEGORIES.length).toBeGreaterThan(10);
  });
  it("confirms automatic execution on a six-hour cadence only from consecutive scheduled runs", () => {
    const now = Date.parse("2026-09-30T13:00:00Z");
    const cycle = (startedAt: string) => ({ trigger: "SCHEDULED" as const, status: "COMPLETED" as const, startedAt });
    expect(automaticExecutionConfirmed([cycle("2026-09-30T12:00:05Z"), cycle("2026-09-30T06:00:04Z")], 6, now)).toBe(true);
    expect(automaticExecutionConfirmed([cycle("2026-09-30T12:00:05Z"), cycle("2026-09-29T12:00:04Z")], 6, now)).toBe(false);
    expect(automaticExecutionConfirmed([cycle("2026-09-30T12:00:05Z")], 6, now)).toBe(false);
  });
});
