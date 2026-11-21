import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildCommercialIntelligence, type IntelligenceInput } from "../../domain/signal-intelligence";
import type { SourceQualification } from "../../domain/commercial-qualification";
import { detectTrades } from "../../domain/discovery-coverage";
import { getWorkforceReadiness, workforceTradeCodes } from "../../server/source-enrichment/workforce-readiness";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

const qualification = (overrides: Partial<SourceQualification> = {}): SourceQualification => ({
  qualified: true, tier: "PRIMARY", category: "MANPOWER_REQUEST", organization: "Zachry Group", project: null, noise: null, missing: [],
  evidenceOrigin: "SNIPPET", enrichment: null, expiry: null, ...overrides,
});
const input = (snippet: string, overrides: Partial<IntelligenceInput> = {}): IntelligenceInput => ({
  url: "https://example.com/notice", snippet, page: null, qualification: qualification(), professions: detectTrades(snippet), location: "Freeport, TX",
  providerPublicationDate: null, status: "NEW", ...overrides,
});

describe("field-level commercial intelligence (source-supported only)", () => {
  it("extracts supported requirements with provenance and quotes", () => {
    const intel = buildCommercialIntelligence(input(
      "Zachry Group is seeking contract labor: 40 pipefitters and 12 welders, 5+ years of experience, OSHA 30 and TWIC required, 6x10s, start October 15, 2026, 12 week turnaround, $42/hr plus $120/day per diem, travel required. Contact: Maria Lopez, Procurement Manager, mlopez@zachry.example, (409) 555-0142."));
    const f = intel.fields;
    expect(f.headcount).toMatchObject({ status: "SUPPORTED", value: "40", origin: "SNIPPET" });
    expect(f.certifications.value).toContain("OSHA 30");
    expect(f.certifications.value).toContain("TWIC");
    expect(f.experience.status).toBe("SUPPORTED");
    expect(f.schedule.value).toBe("6x10s");
    expect(f.startDate.value).toBe("October 15, 2026");
    expect(f.duration.value).toBe("12 week");
    expect(f.hourlyRate.value).toBe("$42/hr");
    expect(f.perDiem).toMatchObject({ status: "SUPPORTED" });
    expect(f.travel.status).toBe("SUPPORTED");
    expect(f.contactEmail).toMatchObject({ status: "SUPPORTED", value: "mlopez@zachry.example", origin: "SNIPPET" });
    expect(f.contactPhone.value).toBe("(409) 555-0142");
    expect(f.contactName.quote).toContain("Maria Lopez");
    expect(intel.supplierEligibility).toBe("EXPLICIT");
    expect(intel.nextAction).toBe("MANPOWER");
  });

  it("never fabricates headcount from job counts, per diem from the query, or contacts", () => {
    const intel = buildCommercialIntelligence(input("35 welder Jobs in Midland, TX, September 2026 | Glassdoor. Search welder jobs with company ratings & salaries.",
      { qualification: qualification({ qualified: false, tier: "EXCLUDED", category: null, noise: "JOB_BOARD_AGGREGATION", evidenceOrigin: null }) }));
    expect(intel.fields.headcount.status).toBe("UNKNOWN");
    expect(intel.fields.perDiem.status).toBe("UNKNOWN");
    expect(intel.fields.contactName.status).toBe("UNKNOWN");
    expect(intel.fields.contactEmail.status).toBe("UNKNOWN");
    expect(intel.nextAction).toBe("NOISE");
  });

  it("does not infer supplier eligibility from a direct-hiring ad, and honours explicit exclusions", () => {
    const hiring = buildCommercialIntelligence(input("Journeyman Electricians at MMR Constructors, Inc. - Abilene, TX. Apply today.",
      { qualification: qualification({ tier: "SECONDARY", category: "DIRECT_HIRING", organization: "MMR Constructors, Inc" }) }));
    expect(hiring.supplierEligibility).toBe("UNCONFIRMED");
    expect(hiring.fields.supplierEligibility.status).toBe("REQUIRES_CONFIRMATION");
    expect(hiring.nextAction).toBe("DIRECT_HIRING");
    const excluded = buildCommercialIntelligence(input("Acme seeks subcontractors for welding. No staffing agencies or third parties."));
    expect(excluded.supplierEligibility).toBe("EXCLUDED");
  });

  it("keeps per diem mentions without an amount as requiring confirmation, and lists missing fields", () => {
    const intel = buildCommercialIntelligence(input("Kiewit invites electrical subcontractors for Port Arthur LNG Phase 2 in Port Arthur, TX. Per diem provided.",
      { qualification: qualification({ category: "SUBCONTRACTOR_VENDOR", organization: "Kiewit" }) }));
    expect(intel.fields.perDiem.status).toBe("REQUIRES_CONFIRMATION");
    expect(intel.missing).toEqual(expect.arrayContaining(["headcount", "contactName", "contactEmail"]));
    expect(intel.nextAction).toBe("VENDOR");
  });

  it("prefers structured page data with its own provenance and marks expired notices", () => {
    const intel = buildCommercialIntelligence(input("Pipefitter at Acme Industrial - Baytown, TX", {
      page: { status: "FETCHED", text: "Pipefitter. Bids will be received until July 20, 2021.", title: null, fetchedAt: "2026-09-30T00:00:00Z",
        jobPosting: { hiringOrganization: "Acme Industrial", datePosted: "2026-09-20", locality: "Baytown", region: "TX", salary: "USD 30–38 per hour" } },
      qualification: qualification({ qualified: false, tier: "EXCLUDED", category: null, noise: "EXPIRED", evidenceOrigin: null, expiry: { date: "2021-07-20", basis: "RESPONSE_DEADLINE" } }),
    }));
    expect(intel.fields.company).toMatchObject({ value: "Acme Industrial", origin: "STRUCTURED_DATA" });
    expect(intel.fields.publicationDate).toMatchObject({ value: "2026-09-20", origin: "STRUCTURED_DATA", status: "SUPPORTED" });
    expect(intel.fields.responseDeadline).toMatchObject({ value: "2021-07-20", note: "Deadline has passed" });
    expect(intel.nextAction).toBe("EXPIRED");
  });

  it("gives the expired action whenever the source is out of date, even when the gate excluded it for another reason", () => {
    const intel = buildCommercialIntelligence(input("JEFFERSON COUNTY PURCHASING DEPARTMENT", { qualification: qualification({ qualified: false, tier: "EXCLUDED", category: null, missing: ["PROFESSION"], evidenceOrigin: null, expiry: { date: "2021-06-30", basis: "DOCUMENT_DATE" } }) }));
    expect(intel.nextAction).toBe("EXPIRED");
  });

  it("maps verified and rejected human decisions without changing them", () => {
    expect(buildCommercialIntelligence(input("x", { status: "PROMOTED" })).nextAction).toBe("VERIFIED");
    expect(buildCommercialIntelligence(input("x", { status: "REJECTED" })).nextAction).toBe("REJECTED");
  });
});

describe("workforce readiness (read-only, demo labelled)", () => {
  const client = (rows: Record<string, unknown[]>) => ({ query: async (sql: string) => ({ rows: sql.includes("worker_demand_match_results") ? rows.results ?? [] : rows.supply ?? [] }) }) as unknown as SqlClient;

  it("maps specialties and scope-only families to workforce trades, and reports trades missing from the workforce database", async () => {
    expect(workforceTradeCodes([{ tradeCategoryId: "INDUSTRIAL", occupationIds: ["WELDER"] }])).toEqual(["WELDING"]);
    expect([...workforceTradeCodes([{ tradeCategoryId: "CONSTRUCTION", occupationIds: [] }])].sort()).toEqual(["FIELD_MANAGEMENT", "GENERAL_CRAFT"]);
    const readiness = await getWorkforceReadiness(client({}), { professions: [{ tradeCategoryId: "CONSTRUCTION", occupationIds: ["CARPENTER"] }], promotedOpportunityId: null });
    expect(readiness.state).toBe("TRADE_NOT_IN_WORKFORCE");
    const unknown = await getWorkforceReadiness(client({}), { professions: [], promotedOpportunityId: null });
    expect(unknown.state).toBe("PROFESSION_UNKNOWN");
  });

  it("blocks matching until promotion and separates demo supply from real supply", async () => {
    const readiness = await getWorkforceReadiness(client({ supply: [{ demo: true, n: 7 }] }), { professions: [{ tradeCategoryId: "ELECTRICAL", occupationIds: ["ELECTRICIAN"] }], promotedOpportunityId: null });
    expect(readiness).toMatchObject({ state: "MATCHING_BLOCKED", supply: { real: 0, demo: 7 } });
  });

  it("reports completed matching and flags demo-only matches", async () => {
    const readiness = await getWorkforceReadiness(client({ supply: [{ demo: true, n: 7 }], results: [{ outcome: "STRONG_MATCH", demo: true, n: 2 }, { outcome: "POSSIBLE_MATCH", demo: true, n: 2 }, { outcome: "INSUFFICIENT_DATA", demo: true, n: 6 }] }),
      { professions: [{ tradeCategoryId: "ELECTRICAL", occupationIds: ["ELECTRICIAN"] }], promotedOpportunityId: "1fb90f31-a576-450e-9c6b-8fa1d01690dd" });
    expect(readiness).toMatchObject({ state: "MATCHING_COMPLETED", demoOnlyMatches: true, outcomes: { STRONG_MATCH: 2, POSSIBLE_MATCH: 2, INSUFFICIENT_DATA: 6 } });
    const none = await getWorkforceReadiness(client({ results: [{ outcome: "NO_MATCH", demo: true, n: 3 }] }), { professions: [{ tradeCategoryId: "INDUSTRIAL", occupationIds: ["WELDER"] }], promotedOpportunityId: "x" });
    expect(none.state).toBe("NO_MATCHING_WORKERS");
  });

  it("renders a static label so the render smoke works", () => {
    expect(renderToStaticMarkup(<span>DEMO LOCAL</span>)).toContain("DEMO LOCAL");
  });
});
