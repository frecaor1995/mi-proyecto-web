import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OBSOLETE_URL_EXPLANATION, decodeLinkNote, detectObsoleteAtsUrl, encodeLinkNote } from "../../domain/ats-url-hygiene";
import { classifyPostingLevel, matchingLevelFor, requiredExperienceYears } from "../../domain/posting-level";
import { supplierAnswerEffect, validateSupplierAnswer, type RecordedSupplierAnswer, type SupplierAnswerInput } from "../../domain/external-supplier-answer";
import { newPostingsRegisteredOn } from "../../domain/posting-workflow";
import { COMPANY_ATS_CATALOG, OWNER_SEEN_ENTRY_POSTINGS, classifyCommercialSignals } from "../../domain/company-ats-catalog";
import { PLATFORM_ACCESS, activeRouteFor, effectivePolicy } from "../../domain/ats-capture-readiness";
import { toAssistedPosting, validateAssistedPosting } from "../../domain/assisted-posting-capture";

const OLD_441 = "https://phg.tbe.taleo.net/phg04/ats/careers/v2/requisition.jsp?org=WP3X5Q&cws=37&rid=441";
const NEW_441 = "https://phg.tbe.taleo.net/phg04/ats/careers/v2/viewRequisition?org=WP3X5Q&cws=37&rid=441";
const NOW = new Date("2026-10-09T15:00:00Z");

describe("Recipe 2.2 — obsolete ATS URL detection (no network)", () => {
  it("proposes viewRequisition for the old Taleo BE format, keeping org, cws and rid, without touching the original", () => {
    const finding = detectObsoleteAtsUrl(OLD_441);
    expect(finding).toEqual({ rule: "TALEO_BE_REQUISITION_JSP", platform: "TALEO_BUSINESS_EDITION", originalUrl: OLD_441, proposedUrl: NEW_441 });
    expect(detectObsoleteAtsUrl(NEW_441)).toBeNull();
    expect(detectObsoleteAtsUrl("https://phg.tbe.taleo.net/phg04/ats/careers/v2/requisition.jsp?org=WP3X5Q&cws=37")).toBeNull(); // no rid: nothing to propose
    expect(detectObsoleteAtsUrl("https://careers-fsg.icims.com/jobs/2524/job")).toBeNull();
    expect(detectObsoleteAtsUrl("http://phg.tbe.taleo.net/phg04/ats/careers/v2/requisition.jsp?org=A&cws=1&rid=2")).toBeNull();
    expect(OBSOLETE_URL_EXPLANATION.TALEO_BE_REQUISITION_JSP).toBe("404 causado por formato de URL obsoleto en el catálogo (requisition.jsp → viewRequisition); no se demostró que la vacante estuviera vencida");
  });
  it("is a pure pattern check: the module never fetches, redirects or imports network code", async () => {
    const source = await readFile(resolve(process.cwd(), "src/domain/ats-url-hygiene.ts"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|from ["']node:https?["']|require\(["'](?:node:)?https?["']\)|axios|undici|\bnew Request\(/);
  });
  it("keeps the link category apart from the note", () => {
    expect(encodeLinkNote("OBSOLETE_URL", "404 on old format")).toBe("[link:OBSOLETE_URL] 404 on old format");
    expect(decodeLinkNote("[link:ACCESS_ERROR] Taleo 404")).toEqual({ category: "ACCESS_ERROR", note: "Taleo 404" });
    expect(decodeLinkNote("Al abrir la URL oficial … error 404.")).toEqual({ category: null, note: "Al abrir la URL oficial … error 404." }); // decisions before 2.2
    expect(encodeLinkNote(null, "  ")).toBeNull();
  });
});

describe("Recipe 2.2 — job level from what the posting states", () => {
  it("classifies Walker 441 as mixed (apprentice with experience), not entry level", () => {
    const walker = { title: "Apprentice Electrician", experience: "Minimum 1 year of commercial electrical experience; inexperienced electricians not accepted", licenses: ["TDLR apprentice or journeyman license"] };
    expect(classifyPostingLevel(walker)).toBe("MIXED_APPRENTICE_EXPERIENCED");
    expect(matchingLevelFor("MIXED_APPRENTICE_EXPERIENCED", walker.title)).toBe("APPRENTICE_OR_JOURNEYMAN");
    expect(toAssistedPosting({ url: NEW_441, company: "Walker Engineering", title: walker.title, city: "Houston", state: "TX", salary: null, experience: walker.experience,
      licenses: walker.licenses.join(";"), observedOn: "2026-10-09", summary: "x", provenance: "ASSISTED_MANUAL", dataClass: "REAL", emailAlert: null }).posting).toMatchObject({ title: "Apprentice Electrician", professionalLevel: "APPRENTICE_OR_JOURNEYMAN" });
  });
  it("does not assume every 'Apprentice' is entry level, nor the opposite", () => {
    expect(classifyPostingLevel({ title: "Apprentice Electrician", experience: null, licenses: ["TDLR apprentice license"] })).toBe("ENTRY_LEVEL");
    expect(classifyPostingLevel({ title: "Apprentice Electrician", experience: "2+ years in commercial", licenses: null })).toBe("MIXED_APPRENTICE_EXPERIENCED");
    expect(classifyPostingLevel({ title: "Electrical Helper", experience: "No experience required", licenses: null })).toBe("ENTRY_LEVEL");
    expect(classifyPostingLevel({ title: "Apprentice Electrician", experience: null, licenses: "journeyman license" })).toBe("MIXED_APPRENTICE_EXPERIENCED");
    expect(classifyPostingLevel({ title: "Journeyman Electrician", experience: null })).toBe("EXPERIENCED");
    expect(classifyPostingLevel({ title: "Electrician", experience: null })).toBe("UNKNOWN");
    expect(requiredExperienceYears("minimum one year")).toBe(1);
    expect(requiredExperienceYears("no experience needed")).toBeNull();
    expect(classifyPostingLevel({ title: "Apprentice Electrician", experience: "No prior experience required; 1 year preferred", licenses: null })).toBe("ENTRY_LEVEL");
  });
  it("counts only entry-level postings as apprentice/helper demand", () => {
    const base = { companyType: "ELECTRICAL_CONTRACTOR" as const, companyTypeEvidence: "catalog:walker", explicitExternalNeed: null };
    const obs = (level: "ENTRY_LEVEL" | "MIXED_APPRENTICE_EXPERIENCED") => ({ postingIdentity: level, title: "Apprentice Electrician", observedAt: "2026-10-08T12:00:00Z", evidenceId: "e", relationship: "DIRECT_HIRE_POSTING" as const, level });
    expect(classifyCommercialSignals({ ...base, observations: [obs("MIXED_APPRENTICE_EXPERIENCED")] }).reasons.map((r) => r.signal)).not.toContain("APPRENTICE_HELPER_DEMAND");
    expect(classifyCommercialSignals({ ...base, observations: [obs("ENTRY_LEVEL")] }).reasons.map((r) => r.signal)).toContain("APPRENTICE_HELPER_DEMAND");
    expect(OWNER_SEEN_ENTRY_POSTINGS.find((p) => p.company === "walker")).toMatchObject({ levelRule: "MIXED", url: OLD_441, currentUrl: NEW_441 }); // original reference kept
  });
});

describe("Recipe 2.2 — URL correction input", () => {
  const input = { url: NEW_441, company: "Walker Engineering", title: "Apprentice Electrician", city: "Houston", state: "TX", salary: null, experience: null, licenses: null,
    observedOn: "2026-10-09", summary: "x", provenance: "ASSISTED_MANUAL" as const, dataClass: "REAL" as const, emailAlert: null };
  it("requires a reason and a valid earlier observation, and keeps the same posting identity from the URL", () => {
    expect(validateAssistedPosting({ ...input, correction: { previousCandidateId: "ec1863b0-bc5d-423f-bec6-6380178ca184", reason: " ", rule: "TALEO_BE_REQUISITION_JSP" } }, NOW)).toEqual({ correctionReason: "required" });
    expect(validateAssistedPosting({ ...input, correction: { previousCandidateId: "nope", reason: "ok", rule: null } }, NOW)).toEqual({ correction: "invalid" });
    expect(validateAssistedPosting({ ...input, correction: { previousCandidateId: "ec1863b0-bc5d-423f-bec6-6380178ca184", reason: OBSOLETE_URL_EXPLANATION.TALEO_BE_REQUISITION_JSP, rule: "TALEO_BE_REQUISITION_JSP" } }, NOW)).toEqual({});
    const oldPosting = toAssistedPosting({ ...input, url: OLD_441 }), newPosting = toAssistedPosting(input);
    expect([oldPosting.identitySource, oldPosting.posting.externalPostingId]).toEqual([newPosting.identitySource, newPosting.posting.externalPostingId]); // same rid=441 → same identity
    expect(oldPosting.posting.normalizedUrl).not.toBe(newPosting.posting.normalizedUrl);
  });
});

describe("Recipe 2.2 — daily goal of 5 counts only new real postings", () => {
  it("ignores re-observations, corrected links and DEMO records", () => {
    const rows = [
      { identity: "a", recordedAt: "2026-10-08T15:00:00Z", dataClass: "REAL" }, { identity: "a", recordedAt: "2026-10-09T15:00:00Z", dataClass: "REAL" }, // re-observed/corrected today
      { identity: "b", recordedAt: "2026-10-09T14:00:00Z", dataClass: "REAL" }, { identity: "c", recordedAt: "2026-10-09T16:00:00Z", dataClass: "DEMO" },
      { identity: "d", recordedAt: "2026-10-10T03:00:00Z", dataClass: "REAL" }, // 22:00 on Oct 9 in Houston
    ];
    expect(newPostingsRegisteredOn(rows, "2026-10-09").map((r) => r.identity)).toEqual(["b", "d"]);
  });
});

describe("Recipe 2.2 — external-supplier answer", () => {
  const answer: SupplierAnswerInput = { answer: "YES", catalogKey: "enterprise", companyId: null, companyName: "Enterprise Electrical", conversationDate: "2026-10-09", responderName: null, responderRole: "Operations",
    channel: "CALL", summary: "Said they use two labor suppliers for peaks.", evidenceReference: "Call log 2026-10-09 10:30", nextAction: "Send vendor packet" };
  it("validates who, when, how, what and the next action; YES needs a verifiable reference", () => {
    expect(validateSupplierAnswer(answer, NOW)).toEqual({});
    expect(validateSupplierAnswer({ ...answer, evidenceReference: null }, NOW)).toEqual({ evidenceReference: "requiredForYes" });
    expect(validateSupplierAnswer({ ...answer, answer: "NO", conversationDate: null, channel: null, summary: null }, NOW)).toMatchObject({ conversationDate: "required", channel: "required", summary: "required" });
    expect(validateSupplierAnswer({ ...answer, answer: "NOT_INVESTIGATED", conversationDate: null, channel: null, summary: null, evidenceReference: null }, NOW)).toEqual({});
    expect(validateSupplierAnswer({ ...answer, catalogKey: null, companyId: null }, NOW)).toEqual({ subject: "required" });
    expect(validateSupplierAnswer({ ...answer, nextAction: null }, NOW)).toEqual({ nextAction: "required" });
    expect(validateSupplierAnswer({ ...answer, answer: "MAYBE" }, NOW)).toEqual({ answer: "invalid" });
  });
  it("applies only to that company and never creates a client", () => {
    const recorded = (a: RecordedSupplierAnswer["answer"], evidenceReference: string | null = "ref"): RecordedSupplierAnswer => ({ ...answer, answer: a, evidenceReference, evidenceId: "e", recordedByOperatorId: "o", recordedBy: null, recordedAt: NOW.toISOString() });
    expect(supplierAnswerEffect(null)).toEqual({ state: "NOT_INVESTIGATED", commercialSignal: false, b2bPriority: "UNCHANGED", investigationOpen: true });
    expect(supplierAnswerEffect(recorded("YES"))).toEqual({ state: "YES", commercialSignal: true, b2bPriority: "RAISED_BY_EVIDENCE", investigationOpen: false });
    expect(supplierAnswerEffect(recorded("YES", null)).commercialSignal).toBe(false);
    expect(supplierAnswerEffect(recorded("NO"))).toMatchObject({ commercialSignal: false, b2bPriority: "UNCHANGED" }); // never removes the company
    expect(supplierAnswerEffect(recorded("OWN_AGENCY_ONLY")).b2bPriority).toBe("LOWERED_OWN_AGENCY");
    expect(supplierAnswerEffect(recorded("NO_RESPONSE")).investigationOpen).toBe(true);
    for (const a of ["YES", "NO", "OWN_AGENCY_ONLY", "NO_RESPONSE"] as const) expect(Object.keys(supplierAnswerEffect(recorded(a)))).not.toContain("client");
    const yes = classifyCommercialSignals({ companyType: "ELECTRICAL_CONTRACTOR", companyTypeEvidence: "catalog:enterprise", observations: [], explicitExternalNeed: { text: "External suppliers: YES", evidenceId: "e" } });
    expect(yes).toMatchObject({ classification: "POSIBLE_CLIENTE", clientConfirmed: false, workersRequired: null });
  });
});

describe("Recipe 2.2 — platform matrix and access decisions", () => {
  it("prefers automatic capture for the listed ATS without granting any access, and keeps the owner decisions", () => {
    for (const p of ["GREENHOUSE", "LEVER", "WORKABLE", "SMARTRECRUITERS", "JAZZHR", "ICIMS", "TALEO_BUSINESS_EDITION"]) expect(PLATFORM_ACCESS.find((x) => x.platform === p)?.preferredRoute).toBe("AUTOMATIC");
    for (const p of ["WORKDAY", "UKG_PRO", "ORACLE_RECRUITING_CLOUD", "APPLICANTPRO"]) expect(PLATFORM_ACCESS.find((x) => x.platform === p)).toMatchObject({ preferredRoute: "SPECIAL", authorization: "RESTRICTED" });
    expect(PLATFORM_ACCESS.filter((p) => p.authorization === "CONFIRMED")).toEqual([]);
    const target = (key: string) => COMPANY_ATS_CATALOG.find((t) => t.key === key)!;
    const none = new Set<string>(), strike = new Set(["strike.applytojob.com"]);
    expect(effectivePolicy(target("strike"), strike, NOW).policy).toBe("AUTOMATED_CAPTURE_ALLOWED");
    expect(effectivePolicy(target("strike"), none, NOW).policy).toBe("REVIEW_REQUIRED"); // the platform alone never allows
    expect(effectivePolicy(target("enterprise"), strike, NOW).policy).toBe("REVIEW_TIMEBOX_EXPIRED");
    expect(effectivePolicy(target("fsg"), strike, NOW).policy).toBe("BLOCKED_PENDING_PERMISSION");
    expect(effectivePolicy(target("trillium"), strike, NOW).policy).toBe("BLOCKED_TERMS");
    for (const t of COMPANY_ATS_CATALOG) {
      const policy = effectivePolicy(t, none, NOW).policy;
      expect(activeRouteFor(policy)).toBe("ASSISTED_CAPTURE"); // without an ALLOW every source continues by assisted capture
    }
  });
});
