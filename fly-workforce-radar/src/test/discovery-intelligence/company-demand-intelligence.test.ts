import { describe, expect, it } from "vitest";
import {
  atsTenantIdentity, buildCompanyDemandIntelligence, classifySourceRelationship, interpretStoredDemand,
  resolveObservationCompany, type CanonicalCompanyReference, type StoredDiscoveryObservation,
} from "../../domain/discovery-company-intelligence";

const base: StoredDiscoveryObservation = {
  id: "o1", identity: "stable-1", title: "Apprentice Electrician", description: null,
  normalizedUrl: "https://careers.fly.test/jobs/1", domain: "careers.fly.test", sourceType: "COMPANY_CAREERS", platform: null,
  explicitCompanyId: null, level: "UNKNOWN", watchState: "STILL_OBSERVED", watchHealth: "HEALTHY",
  firstSeenAt: "2026-10-05T00:00:00.000Z", lastSeenAt: "2026-10-06T00:00:00.000Z", publishedAt: null, canonicalEvidence: false,
};
const company = (overrides: Partial<CanonicalCompanyReference> = {}): CanonicalCompanyReference => ({ id: "c1", name: "Fly Electric",
  normalizedNames: ["fly electric"], domains: ["fly.test"], verifiedAliases: ["fly electrical"], hasContactIntelligence: false, ...overrides });

describe("Discovery Intelligence 1.2 company + demand interpretation", () => {
  it("resolves an exact canonical domain and an existing verified alias", () => {
    expect(resolveObservationCompany(base, [company()])).toMatchObject({ state: "RESOLVED_CANONICAL", canonicalCompanyId: "c1", reasons: ["EXACT_CANONICAL_DOMAIN"] });
    const alias = resolveObservationCompany({ ...base, domain: "jobs.other.test", normalizedUrl: "https://jobs.other.test/1", title: "Opening - Fly Electrical" }, [company({ domains: [] })]);
    expect(alias).toMatchObject({ state: "RESOLVED_CANONICAL", canonicalCompanyId: "c1", reasons: ["EXACT_ALIAS"] });
  });

  it("extracts ATS tenants without treating the ATS platform as the employer", () => {
    expect(atsTenantIdentity("https://jobs.lever.co/titan-electric/42", "jobs.lever.co")).toBe("Titan Electric");
    expect(atsTenantIdentity("https://apply.workable.com/edge-electric/j/42", "apply.workable.com")).toBe("Edge Electric");
    const result = resolveObservationCompany({ ...base, domain: "jobs.lever.co", normalizedUrl: "https://jobs.lever.co/titan-electric/42", platform: "LEVER", sourceType: "ATS_PUBLIC_BOARD" }, []);
    expect(result).toMatchObject({ state: "IDENTIFIED_NOT_CANONICAL", observedCompany: "Titan Electric", reasons: ["ATS_TENANT"] });
    expect(result.observedCompany).not.toBe("Lever");
  });

  it("uses company-owned career domains, title identity and explicit provider identity conservatively", () => {
    expect(resolveObservationCompany({ ...base, domain: "burnettspecialists.com", normalizedUrl: "https://burnettspecialists.com/jobs", title: "Electrician Staffing | Burnett Specialists", sourceType: "STAFFING_JOB_BOARD" }, []).observedCompany).toBe("Burnett Specialists");
    expect(resolveObservationCompany({ ...base, domain: "jobs.other.test", normalizedUrl: "https://jobs.other.test/1", title: "Apprentice Electrician - Edge Electric" }, []).reasons).toContain("EXPLICIT_TITLE_COMPANY");
    expect(resolveObservationCompany({ ...base, domain: "indeed.com", normalizedUrl: "https://indeed.com/jobs/1", description: "Rinvio is hiring Apprentice Electricians." }, [])).toMatchObject({ state: "POSSIBLE_MATCH", confidence: "WEAK" });
  });

  it("never treats aggregators as employers and keeps canonical matches from snippets reviewable", () => {
    const observed = { ...base, domain: "indeed.com", normalizedUrl: "https://indeed.com/jobs/1", description: "Fly Electric is hiring Apprentice Electricians." };
    expect(classifySourceRelationship(observed)).toBe("AGGREGATOR_SOURCE");
    expect(resolveObservationCompany(observed, [company()])).toMatchObject({ state: "POSSIBLE_MATCH", canonicalCompanyId: null, possibleCanonicalCompanyIds: ["c1"] });
  });

  it("derives ambiguity and unresolved states with reason provenance", () => {
    const duplicate = company({ id: "c2", name: "Fly Electric Texas", domains: [], normalizedNames: ["fly electric"], verifiedAliases: [] });
    expect(resolveObservationCompany({ ...base, domain: "jobs.other.test", normalizedUrl: "https://jobs.other.test/1", title: "Opening - Fly Electric" }, [company({ domains: [] }), duplicate])).toMatchObject({ state: "AMBIGUOUS", reasons: ["MULTIPLE_CONFLICTING_HINTS"] });
    expect(resolveObservationCompany({ ...base, domain: "indeed.com", normalizedUrl: "https://indeed.com/jobs", title: "Electrician jobs" }, [])).toMatchObject({ state: "UNRESOLVED", confidence: "UNKNOWN", reasons: ["NO_SUPPORTING_IDENTITY"] });
  });

  it("preserves UNKNOWN facts and never infers commercial authority or manpower acceptance", () => {
    const demand = interpretStoredDemand({ ...base, title: "$35/hr Electrician", description: null });
    expect(demand).toMatchObject({ level: "UNKNOWN", location: null, headcount: null, project: null, status: "NEEDS_REVIEW", externalManpowerAcceptance: "UNKNOWN", buyerAuthority: "UNKNOWN" });
  });

  it("extracts only stored demand facts and classifies source relationships", () => {
    const demand = interpretStoredDemand({ ...base, title: "Apprentice Electrician - Houston, TX", description: "5-6 years of experience. Must have TDLR. $22-$28 per hour. Data center project." });
    expect(demand).toMatchObject({ profession: "ELECTRICAL", occupation: "APPRENTICE_ELECTRICIAN", level: "APPRENTICE", location: "Houston, TX", pay: "$22-$28 per hour", experience: "5-6 years of experience", project: "Data center project" });
    expect(demand.credentials).toContain("TDLR");
    expect(classifySourceRelationship({ domain: "jobs.staffing.test", platform: null, sourceType: "STAFFING_JOB_BOARD" })).toBe("STAFFING_AGENCY_SOURCE");
    expect(classifySourceRelationship({ domain: "jobs.lever.co", platform: "LEVER", sourceType: "ATS_PUBLIC_BOARD" })).toBe("ATS_SOURCE");
  });

  it("groups by company without cross-query or baseline/second-check inflation", () => {
    const duplicateCheck = { ...base, id: "o2", watchState: "BASELINE" };
    const secondPosting = { ...base, id: "o3", identity: "stable-2", normalizedUrl: "https://careers.fly.test/jobs/2", title: "Electrical Helper", domain: "other.fly.test" };
    const result = buildCompanyDemandIntelligence([base, duplicateCheck, secondPosting], [company()]);
    expect(result.observations).toHaveLength(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ observationCount: 2, sourceCount: 1, corroboration: "1" });
  });

  it("does not auto-create companies, promote demand, or invoke matching", () => {
    const result = buildCompanyDemandIntelligence([{ ...base, domain: "jobs.lever.co", normalizedUrl: "https://jobs.lever.co/unknown-tenant/1", platform: "LEVER", sourceType: "ATS_PUBLIC_BOARD" }], []);
    expect(result.observations[0].resolution.canonicalCompanyId).toBeNull();
    expect(result.observations[0].demand.status).toBe("NEEDS_REVIEW");
    expect(Object.keys(result.observations[0])).not.toContain("matching");
  });
});
