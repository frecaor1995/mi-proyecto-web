import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { projectSignalContentHash, validateProjectSignalPayload } from "../../domain/project-signal-contract";
import { classifyStaffingDemand, staffingPriority, type CompanyStaffingEvidence, type PostingEvidence, type PriorityInput } from "../../domain/staffing-demand";

const NOW = new Date("2026-10-10T15:00:00Z");
const fixture = async () => JSON.parse(await readFile(resolve(process.cwd(), "src/test/fixtures/staffing/project-signal-demo.json"), "utf8"));
const record = (overrides: Record<string, unknown> = {}) => ({
  sourceSystem: "fixture", sourceRecordId: "R-1", observedAt: "2026-10-10T12:00:00Z", officialSourceUrl: "https://example.org/notice/1", dataClass: "REAL",
  company: { name: "Example Electric", role: "ELECTRICAL_CONTRACTOR", stage: "AWARDEE" }, project: { name: "Plant expansion", city: "Houston", state: "TX" }, ...overrides,
});
const payload = (records: unknown[]) => ({ contract: "fly.project-signal", contractVersion: "1.0.0", producer: { system: "fixture" }, records });

describe("fly.project-signal v1 — validation", () => {
  it("accepts the DEMO fixture and keeps missing facts UNKNOWN", async () => {
    const v = validateProjectSignalPayload(await fixture());
    expect(v.state).toBe("VALID"); // absent facts become UNKNOWN; the estimate states its basis
    const r = v.records[0].record!;
    expect(r).toMatchObject({ dataClass: "DEMO", company: { name: "DEMO LOCAL Contractor", stage: "AWARDEE" } });
    expect(r.duration).toEqual({ value: null, kind: "UNKNOWN", evidenceRef: null });
    expect(r.project.county).toEqual({ value: null, kind: "UNKNOWN", evidenceRef: null });
    expect(r.project.name).toMatchObject({ value: "DEMO LOCAL Houston Substation Retrofit", kind: "OFFICIAL" }); // bare value + official source
    expect(r.startDate).toMatchObject({ value: "2026-11-15", kind: "ESTIMATED" });
  });
  it("rejects unsupported contracts and versions as a whole", () => {
    expect(validateProjectSignalPayload({ ...payload([record()]), contract: "other" }).state).toBe("REJECTED");
    expect(validateProjectSignalPayload({ ...payload([record()]), contractVersion: "2.0.0" }).errors).toContain("contractVersion 2.0.0 is not supported (major 1 only)");
    expect(validateProjectSignalPayload({ ...payload([]) }).errors).toContain("records must be a non-empty array");
    expect(validateProjectSignalPayload("not an object").state).toBe("REJECTED");
  });
  it("rejects bad records individually with explicit errors, never filling gaps", () => {
    const v = validateProjectSignalPayload(payload([
      record(), record({ sourceRecordId: "R-2", officialSourceUrl: null, contractStatus: { value: "Awarded", kind: "OFFICIAL" } }),
      record({ sourceRecordId: "R-3", startDate: { value: "2026-11-01", kind: "UNKNOWN" } }), record({ sourceRecordId: "R-4", dataClass: "DEMO" }),
      record({ sourceRecordId: "R-5", company: { name: "DEMO LOCAL X" } }), record({ sourceRecordId: "R-6", startDate: "2026-12-01", endDate: "2026-11-01" }),
    ]));
    expect(v.records.map((r) => r.state)).toEqual(["VALID", "REJECTED", "REJECTED", "REJECTED", "REJECTED", "REJECTED"]);
    expect(v.records[1].errors).toContain("contractStatus: OFFICIAL needs an evidenceRef or the record's officialSourceUrl");
    expect(v.records[2].errors).toContain("startDate: a value cannot be UNKNOWN");
    expect(v.records[3].errors).toContain("DEMO records must name the company 'DEMO LOCAL …'");
    expect(v.records[4].errors).toContain("REAL records cannot use a 'DEMO LOCAL' company");
    expect(v.records[5].errors).toContain("endDate is before startDate");
    expect(v.state).toBe("VALID_WITH_WARNINGS");
  });
  it("marks bare values without an official source as estimates and flags repeated identifiers", () => {
    const v = validateProjectSignalPayload(payload([record({ officialSourceUrl: null, startDate: "2026-11-01" }), record({ sourceRecordId: "R-9" }), record({ sourceRecordId: "R-9" })]));
    expect(v.records[0].record!.startDate.kind).toBe("ESTIMATED");
    expect(v.records[0].warnings).toContain("startDate: bare value without official source, recorded as ESTIMATED");
    expect(v.records.slice(1).map((r) => r.state)).toEqual(["REJECTED", "REJECTED"]);
  });
  it("hashes content independently of key order", () => {
    const a = validateProjectSignalPayload(payload([record()])).records[0].record!;
    const b = validateProjectSignalPayload(payload([{ ...record(), company: { stage: "AWARDEE", role: "ELECTRICAL_CONTRACTOR", name: "Example Electric" } }])).records[0].record!;
    expect(projectSignalContentHash(a)).toBe(projectSignalContentHash(b));
  });
  it("contains no network or tender-discovery code", async () => {
    for (const file of ["src/domain/project-signal-contract.ts", "src/domain/staffing-demand.ts", "src/server/staffing-intelligence/project-signals.ts", "src/server/staffing-intelligence/get-staffing-intelligence.ts", "src/server/staffing-intelligence/actions.ts"]) {
      const source = await readFile(resolve(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|from ["']node:https?["']|axios|undici|SafePublicTransport|brave-search|tpwd/);
    }
  });
});

const posting = (o: Partial<PostingEvidence> = {}): PostingEvidence => ({ identity: "p1", title: "Apprentice Electrician", location: "Houston, TX", observedAt: "2026-10-08T12:00:00Z", postingVerified: true,
  demandVerified: false, directHire: true, experience: "1 year", licenses: ["TDLR"], compensation: null, levelClass: "MIXED_APPRENTICE_EXPERIENCED", ...o });
const empty: CompanyStaffingEvidence = { explicitRequests: [], postings: [], projects: [], pains: [] };
const project = { evidenceId: "e", projectName: "Plant", stage: "AWARDEE", contractStatus: { value: "Awarded", kind: "OFFICIAL" as const }, startDate: { value: null, kind: "UNKNOWN" as const },
  duration: { value: null, kind: "UNKNOWN" as const }, location: "Houston, TX", trades: ["Electrical"], observedAt: "2026-10-09T12:00:00Z", linkConfirmed: true };

describe("Demand classification — mandatory rules", () => {
  it("never treats direct-hire postings or awards as explicit demand", () => {
    const postings = classifyStaffingDemand({ ...empty, postings: [posting(), posting({ identity: "p2" }), posting({ identity: "p3" })] }, null);
    expect(postings.demandClass).toBe("INFERRED");
    expect(postings.ruleNotes).toEqual(expect.arrayContaining(["DIRECT_HIRE_NOT_A_REQUEST", "HEADCOUNT_NOT_FROM_POSTINGS"]));
    expect(postings.requirements.headcount).toEqual({ value: null, origin: "UNKNOWN" }); // 3 postings ≠ 3 workers
    const award = classifyStaffingDemand({ ...empty, projects: [project] }, null);
    expect(award).toMatchObject({ demandClass: "INFERRED", ruleNotes: ["AWARD_NOT_SHORTAGE"] });
  });
  it("requires verified evidence for an inference and a documented request for EXPLICIT", () => {
    expect(classifyStaffingDemand({ ...empty, postings: [posting({ postingVerified: false })] }, null).demandClass).toBe("INSUFFICIENT_EVIDENCE");
    expect(classifyStaffingDemand({ ...empty, projects: [{ ...project, linkConfirmed: false }] }, null).demandClass).toBe("INSUFFICIENT_EVIDENCE");
    expect(classifyStaffingDemand(empty, "YES").demandClass).toBe("INSUFFICIENT_EVIDENCE"); // accepting suppliers is not a request
    const explicit = classifyStaffingDemand({ ...empty, explicitRequests: [{ kind: "STAFF_REQUEST", evidenceRef: "a", date: "2026-10-09", headcount: 6, role: "Journeyman Electrician" }] }, "YES");
    expect(explicit.demandClass).toBe("EXPLICIT");
    expect(explicit.requirements.headcount).toEqual({ value: "6", origin: "EXPLICIT_REQUEST" });
    expect(explicit.requirements.supplierAvailability).toEqual({ value: "YES", origin: "SUPPLIER_ANSWER" });
  });
  it("keeps unknown requirements unknown and states their origin", () => {
    const d = classifyStaffingDemand({ ...empty, postings: [posting()], projects: [{ ...project, startDate: { value: "2026-11-15", kind: "ESTIMATED" } }] }, null);
    expect(d.requirements.start).toEqual({ value: "2026-11-15", origin: "PROJECT_ESTIMATED" });
    expect(d.requirements.pay).toEqual({ value: null, origin: "UNKNOWN" });
    expect(d.requirements.experience).toEqual({ value: "1 year", origin: "VERIFIED_POSTING" });
  });
});

describe("Commercial priority — explainable, never a promise", () => {
  const base = (o: Partial<PriorityInput> = {}): PriorityInput => {
    const evidence = o.evidence ?? { ...empty, postings: [posting()] };
    return { demand: classifyStaffingDemand(evidence, o.supplierAnswer ?? null), evidence, supplierAnswer: null, supplierAnswerHasEvidence: false, manpowerAcceptance: null,
      verifiableContacts: 0, networkWorkers: 31, lastEvidenceAt: "2026-10-08T12:00:00Z", now: NOW, ...o };
  };
  it("separates confirmed evidence, inferences, missing data and the next action", () => {
    const p = staffingPriority(base());
    expect(p.tier).toBe("LOW");
    expect(p.confirmed).toEqual(expect.arrayContaining(["RECENT_VERIFIED_POSTINGS", "FRESHNESS"]));
    expect(p.inferences).toEqual(expect.arrayContaining(["NEED", "NETWORK_FIT"]));
    expect(p.missing).toEqual(expect.arrayContaining(["SUPPLIER_ACCEPTANCE", "VERIFIABLE_CONTACT", "ACTIVE_PROJECT"]));
    expect(p.nextAction).toBe("FIND_BUYER");
  });
  it("raises with confirmed acceptance and contact, lowers only for own-agency or verified negatives, and keeps a NO company", () => {
    expect(staffingPriority(base({ supplierAnswer: "YES", supplierAnswerHasEvidence: true, verifiableContacts: 2 })).tier).toBe("HIGH");
    expect(staffingPriority(base({ supplierAnswer: "OWN_AGENCY_ONLY", verifiableContacts: 2 }))).toMatchObject({ tier: "LOW", nextAction: "DEPRIORITIZE_OWN_AGENCY" });
    expect(staffingPriority(base({ supplierAnswer: "NO", verifiableContacts: 2 })).negatives).toEqual(["SUPPLIER_NO"]);
    expect(staffingPriority(base({ supplierAnswer: "NO_RESPONSE", verifiableContacts: 1 })).nextAction).toBe("FOLLOW_UP_NO_RESPONSE");
  });
  it("returns INSUFFICIENT_DATA without evidence, and RUN_MATCHING only for a real request", () => {
    expect(staffingPriority(base({ evidence: empty }))).toMatchObject({ tier: "INSUFFICIENT_DATA", nextAction: "FIND_BUYER" });
    expect(staffingPriority(base({ evidence: { ...empty, postings: [posting({ postingVerified: false })] } })).nextAction).toBe("VERIFY_POSTING");
    const request = { ...empty, explicitRequests: [{ kind: "STAFF_REQUEST" as const, evidenceRef: "a", date: "2026-10-09", headcount: null, role: null }] };
    expect(staffingPriority(base({ evidence: request }))).toMatchObject({ tier: "HIGH", nextAction: "RUN_MATCHING_AND_PRESENT" });
  });
});
