import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPANY_ATS_CATALOG, OWNER_SEEN_ENTRY_POSTINGS, SUPPLEMENTARY_LOCAL_TARGETS, classifyCommercialSignals, type PostingObservationEvidence } from "../../domain/company-ats-catalog";
import { ATS_EXTRACTION_METHODS, captureReadiness, readinessMatrix } from "../../domain/ats-capture-readiness";

const count = <T>(items: readonly T[], key: (t: T) => string) => items.reduce<Record<string, number>>((acc, t) => ({ ...acc, [key(t)]: (acc[key(t)] ?? 0) + 1 }), {});

describe("Recipe 1.1 v2 — Stage 2: owner catalog of 30 companies", () => {
  it("holds the owner's 30 targets with unique keys, ranks 1–30 and traceable evidence", () => {
    expect(COMPANY_ATS_CATALOG).toHaveLength(30);
    expect(new Set(COMPANY_ATS_CATALOG.map((t) => t.key)).size).toBe(30);
    expect(COMPANY_ATS_CATALOG.map((t) => t.ownerRank).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(COMPANY_ATS_CATALOG.every((t) => t.evidence.includes("Owner catalog 2026-10-07") && t.verifiedAt === "2026-10-07")).toBe(true);
  });
  it("matches the owner's summary sheet by status, wave and role", () => {
    expect(count(COMPANY_ATS_CATALOG, (t) => t.status)).toEqual({ VERIFIED: 9, PARTIAL: 3, UNCONFIRMED: 13, BLOCKED: 3, NO_FEED: 2 });
    expect(count(COMPANY_ATS_CATALOG, (t) => `W${t.wave}`)).toEqual({ W1: 10, W2: 11, W3: 9 });
    expect(COMPANY_ATS_CATALOG.filter((t) => t.pilot).map((t) => t.key)).toEqual(["strike"]);
    expect(COMPANY_ATS_CATALOG.filter((t) => t.roles.includes("POSSIBLE_CLIENT"))).toHaveLength(18);
    expect(COMPANY_ATS_CATALOG.filter((t) => t.roles[0] === "COMPETITOR")).toHaveLength(8);
    expect(COMPANY_ATS_CATALOG.filter((t) => t.roles.includes("WORKFORCE_SOURCE"))).toHaveLength(4);
  });
  it("never presents an inferred slug/URL or an unidentified ATS as verified", () => {
    const inferred = COMPANY_ATS_CATALOG.filter((t) => t.identifierBasis === "INFERRED");
    expect(inferred.length).toBeGreaterThan(0);
    expect(inferred.every((t) => t.status !== "VERIFIED")).toBe(true);
    expect(COMPANY_ATS_CATALOG.filter((t) => t.ats === "UNKNOWN" && t.atsIdentifier)).toEqual([]);
    expect(COMPANY_ATS_CATALOG.filter((t) => t.identifierBasis === "NONE" && t.atsIdentifier)).toEqual([]);
    const zachry = COMPANY_ATS_CATALOG.find((t) => t.key === "zachry")!;
    expect(zachry).toMatchObject({ ats: "UNKNOWN", atsIdentifier: null, status: "UNCONFIRMED" });
    expect(zachry.localEvidence?.atsIdentifier).toBe("CX_1029"); // kept as local evidence, not promoted
    expect(zachry.conflicts.length).toBe(1);
  });
  it("keeps the JazzHR board slug distinct from the individual posting ID and records the Houston discrepancy", () => {
    const strike = COMPANY_ATS_CATALOG.find((t) => t.key === "strike")!;
    expect(strike).toMatchObject({ ats: "JAZZHR", atsIdentifier: "strike", jobsUrl: "https://strike.applytojob.com/apply", wave: 1, pilot: true });
    expect(strike.conflicts.join(" ")).toMatch(/Houston/);
  });
  it("stays multi-profession and keeps agencies distinct from possible clients", () => {
    const trades = new Set(COMPANY_ATS_CATALOG.flatMap((t) => t.trades));
    for (const trade of ["ELECTRICAL", "HVAC", "PLUMBING", "INDUSTRIAL", "OIL_GAS", "MULTI_TRADE"]) expect(trades).toContain(trade);
    expect(new Set(COMPANY_ATS_CATALOG.map((t) => t.companyType))).toEqual(new Set(["ELECTRICAL_CONTRACTOR", "MECHANICAL_CONTRACTOR", "INDUSTRIAL_CONTRACTOR", "OIL_GAS_DRILLING", "CONSTRUCTION_STAFFING"]));
    expect(COMPANY_ATS_CATALOG.find((t) => t.key === "kodiak")!.roles).toEqual(["WORKFORCE_SOURCE"]); // captive agency: does not buy from Fly
  });
  it("preserves the 18 previously catalogued targets separately and never shows owner-seen postings as captures", () => {
    expect(SUPPLEMENTARY_LOCAL_TARGETS).toHaveLength(18);
    expect(SUPPLEMENTARY_LOCAL_TARGETS.filter((s) => COMPANY_ATS_CATALOG.some((t) => t.key === s.key))).toEqual([]);
    expect(SUPPLEMENTARY_LOCAL_TARGETS.find((s) => s.key === "clayton")?.ownerNote).toMatch(/no longer a staffing firm/);
    expect(OWNER_SEEN_ENTRY_POSTINGS).toHaveLength(14);
    expect(OWNER_SEEN_ENTRY_POSTINGS.every((p) => ["SEEN_IN_RESEARCH_NOT_CAPTURED", "POSSIBLY_EXPIRED", "HUMAN_REVIEW_REFERENCE_NOT_CAPTURED"].includes(p.state))).toBe(true);
    // FSG: both references kept as antecedents, never merged into one posting
    const fsg = OWNER_SEEN_ENTRY_POSTINGS.filter((p) => p.company === "fsg" && p.title === "Service Apprentice Electrician");
    expect(fsg.map((p) => p.url)).toEqual(["https://careers-fsg.icims.com/jobs/2080/service-apprentice-electrician/job", "https://careers-fsg.icims.com/jobs/2524/service-apprentice-electrician/job?in_iframe=1"]);
    expect(fsg[1]).toMatchObject({ reference: "2026-2524 (URL job id 2524)", pay: "$18–$25/h", state: "HUMAN_REVIEW_REFERENCE_NOT_CAPTURED" });
    expect(OWNER_SEEN_ENTRY_POSTINGS.every((p) => COMPANY_ATS_CATALOG.some((t) => t.key === p.company))).toBe(true);
  });
});

describe("Recipe 1.1 v2 — Stage 3: ATS readiness matrix (no requests)", () => {
  const allowed = new Set(["strike.applytojob.com"]);
  const matrix = readinessMatrix(COMPANY_ATS_CATALOG, allowed);
  it("marks only the source with a persisted ALLOW and an implemented method as READY", () => {
    expect(matrix.filter((r) => r.capability === "READY").map((r) => r.key)).toEqual(["strike"]);
    expect(matrix[0].key).toBe("strike"); // the pilot leads wave 1
    expect(captureReadiness(COMPANY_ATS_CATALOG.find((t) => t.key === "strike")!, new Set()).capability).toBe("NEEDS_VERIFICATION");
  });
  it("blocks wave 2 browser/POST platforms and wave 3 robots/403/no-feed sources", () => {
    expect(matrix.filter((r) => r.wave === 2).every((r) => r.capability === "BLOCKED")).toBe(true);
    for (const key of ["fls", "marathon", "trs", "mmr", "cupertino", "laborfinders", "zachry"]) expect(matrix.find((r) => r.key === key)!.capability).toBe("BLOCKED");
  });
  it("lists exactly what each wave-1 source still needs", () => {
    const enterprise = matrix.find((r) => r.key === "enterprise")!;
    expect(enterprise.capability).toBe("NEEDS_VERIFICATION");
    expect(enterprise.missing).toEqual(["persisted current HTTP_FETCH ALLOW for apply.workable.com", "extraction mapper built from a real, authorized sample (fixture)"]);
    expect(matrix.find((r) => r.key === "ies")!.missing[0]).toMatch(/PARTIAL/);
    // Only the owner's terms decision blocks a wave-1 source; favorable robots evidence is kept, not overridden.
    expect(matrix.filter((r) => r.wave === 1 && r.capability === "BLOCKED").map((r) => r.key)).toEqual(["fsg", "trillium"]);
    expect(matrix.find((r) => r.key === "fsg")!.missing[0]).toMatch(/BLOCKED_PENDING_PERMISSION/);
    expect(matrix.find((r) => r.key === "trillium")!.missing[0]).toMatch(/BLOCKED_TERMS/);
    expect(COMPANY_ATS_CATALOG.find((t) => t.key === "trillium")!.accessDecision).toMatchObject({ decision: "BLOCKED_TERMS", decidedBy: "OWNER", favorableEvidenceKept: expect.stringContaining("robots.txt") });
  });
  it("has an extraction method for every platform in the catalog and implements only JazzHR", () => {
    for (const t of COMPANY_ATS_CATALOG) expect(ATS_EXTRACTION_METHODS[t.ats]).toBeDefined();
    expect(Object.entries(ATS_EXTRACTION_METHODS).filter(([, m]) => m.implemented).map(([k]) => k)).toEqual(["JAZZHR"]);
  });
  it("prepares integrations without any network call in catalog, readiness or matrix code", () => {
    for (const file of ["src/domain/company-ats-catalog.ts", "src/domain/ats-capture-readiness.ts", "src/server/discovery-intelligence/ats-readiness.ts"]) {
      expect(readFileSync(resolve(process.cwd(), file), "utf8"), file).not.toMatch(/\bfetch\(|https?\.request|axios|undici|puppeteer|playwright/);
    }
    // the capture module has exactly one network call site, inside SafePublicTransport (only used when an operator runs an authorized capture)
    const capture = readFileSync(resolve(process.cwd(), "src/server/discovery-intelligence/individual-posting-capture.ts"), "utf8");
    expect(capture.match(/await fetch\(/g)?.length).toBe(1); // the single global network call (all other fetch( are the injected transport interface)
    expect(capture).toMatch(/class SafePublicTransport implements CaptureTransport \{[\s\S]*?async fetch\(input: string\) \{[\s\S]*?const response = await fetch\(target, \{ redirect: "manual"/);
  });
});

describe("Recipe 1.1 v2 — Stage 4: commercial signals backed by evidence", () => {
  const obs = (id: string, title: string, at: string, relationship: PostingObservationEvidence["relationship"] = "DIRECT_HIRE_POSTING"): PostingObservationEvidence =>
    ({ postingIdentity: id, title, observedAt: `${at}T12:00:00Z`, evidenceId: `ev-${id}-${at}`, relationship });
  const base = { companyType: "ELECTRICAL_CONTRACTOR" as const, companyTypeEvidence: "catalog:walker", explicitExternalNeed: null };

  it("never claims a three-week repetition from a first observation or from fewer than 14 days", () => {
    expect(classifyCommercialSignals({ ...base, observations: [obs("a", "Journeyman Electrician", "2026-10-08")] })).toMatchObject({ classification: "INSUFFICIENT_EVIDENCE", reasons: [] });
    // three ISO weeks touched (Sun W39, Mon W40, Mon W41) but only 8 days apart
    const short = classifyCommercialSignals({ ...base, observations: [obs("a", "Journeyman Electrician", "2026-09-27"), obs("a", "Journeyman Electrician", "2026-09-28"), obs("a", "Journeyman Electrician", "2026-10-05")] });
    expect(short.reasons.map((r) => r.signal)).not.toContain("REPEATED_THREE_WEEKS");
    const long = classifyCommercialSignals({ ...base, observations: [obs("a", "Journeyman Electrician", "2026-09-21"), obs("a", "Journeyman Electrician", "2026-09-28"), obs("a", "Journeyman Electrician", "2026-10-05")] });
    expect(long.reasons.find((r) => r.signal === "REPEATED_THREE_WEEKS")?.evidence).toEqual(["ev-a-2026-09-21", "ev-a-2026-09-28", "ev-a-2026-10-05"]);
  });
  it("counts distinct postings for concentration — never workers, never duplicates of one posting", () => {
    const dup = classifyCommercialSignals({ ...base, observations: [obs("a", "Electrician", "2026-10-06"), obs("a", "Electrician", "2026-10-07"), obs("b", "Electrician", "2026-10-07")] });
    expect(dup.reasons.map((r) => r.signal)).not.toContain("SIMULTANEOUS_CONCENTRATION");
    const three = classifyCommercialSignals({ ...base, observations: [obs("a", "Electrician", "2026-10-06"), obs("b", "Electrician", "2026-10-07"), obs("c", "Electrician", "2026-10-08")] });
    expect(three.reasons.find((r) => r.signal === "SIMULTANEOUS_CONCENTRATION")?.reason).toMatch(/postings, not workers/);
    expect(three).toMatchObject({ distinctPostings: 3, workersRequired: null, clientConfirmed: false });
  });
  it("treats direct-hire postings alone as labor demand only, not vendor acceptance", () => {
    const result = classifyCommercialSignals({ ...base, observations: [obs("a", "Journeyman Electrician", "2026-10-08")] });
    expect(result.note).toMatch(/not acceptance of external vendors/);
    expect(result.clientConfirmed).toBe(false);
  });
  it("requires an evidence reference for the staffing type and for an explicit external need", () => {
    expect(classifyCommercialSignals({ ...base, companyType: "CONSTRUCTION_STAFFING", companyTypeEvidence: null, observations: [] }).reasons).toEqual([]);
    expect(classifyCommercialSignals({ ...base, observations: [], explicitExternalNeed: { text: "We use staffing partners for shutdowns", evidenceId: " " } }).reasons).toEqual([]);
    const need = classifyCommercialSignals({ ...base, observations: [], explicitExternalNeed: { text: "We use staffing partners for shutdowns", evidenceId: "ev-1" } });
    expect(need).toMatchObject({ classification: "POSIBLE_CLIENTE", clientConfirmed: false, reasons: [{ signal: "EXPLICIT_EXTERNAL_NEED", evidence: ["ev-1"] }] });
  });
  it("attaches evidence to every signal and keeps every result unconfirmed", () => {
    const all = classifyCommercialSignals({ companyType: "CONSTRUCTION_STAFFING", companyTypeEvidence: "catalog:tradesmen", explicitExternalNeed: { text: "Client requests 6 helpers", evidenceId: "ev-x" },
      observations: [obs("h", "Electrical Helper", "2026-09-21", "STAFFING_POSTING"), obs("h", "Electrical Helper", "2026-09-28", "STAFFING_POSTING"), obs("h", "Electrical Helper", "2026-10-05", "STAFFING_POSTING"),
        obs("i", "Apprentice Electrician", "2026-10-04", "STAFFING_POSTING"), obs("j", "Electrician", "2026-10-03", "STAFFING_POSTING")] });
    expect(all.reasons.map((r) => r.signal)).toEqual(["STAFFING_AGENCY", "REPEATED_THREE_WEEKS", "SIMULTANEOUS_CONCENTRATION", "APPRENTICE_HELPER_DEMAND", "EXPLICIT_EXTERNAL_NEED"]);
    expect(all.reasons.every((r) => r.evidence.length > 0 && r.reason.length > 0)).toBe(true);
    expect(all.clientConfirmed).toBe(false);
    expect(all.workersRequired).toBeNull(); // "6 helpers" in a text never becomes a headcount
  });
});
