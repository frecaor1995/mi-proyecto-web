import { describe, expect, it } from "vitest";
import { COMPANY_ATS_CATALOG } from "../../domain/company-ats-catalog";
import { PLATFORM_ACCESS, REVIEW_TIMEBOX_MINUTES, activeRouteFor, effectivePolicy, externalIdFromUrl, platformFromUrl, reviewTimeboxState } from "../../domain/ats-capture-readiness";
import { toAssistedPosting, validateAssistedPosting, type AssistedPostingInput } from "../../domain/assisted-posting-capture";

const NOW = new Date("2026-10-09T15:00:00Z");
const WALKER_URL = "https://phg.tbe.taleo.net/phg04/ats/careers/v2/requisition.jsp?org=WP3X5Q&cws=37&rid=441";
const target = (key: string) => COMPANY_ATS_CATALOG.find((t) => t.key === key)!;
const walker: AssistedPostingInput = {
  url: WALKER_URL, company: "Walker Engineering", title: "Apprentice Electrician", city: "Houston", state: "TX", salary: null,
  experience: "Minimum 1 year of commercial electrical experience; no inexperienced electricians", licenses: "TDLR apprentice or journeyman license",
  observedOn: "2026-10-09", summary: "Full-time apprentice electrician for commercial construction in Houston (operator summary).", provenance: "ASSISTED_MANUAL", dataClass: "REAL", emailAlert: null,
};

describe("Recipe 2.0 — platform access matrix", () => {
  it("covers every required platform, grants no platform-wide ALLOW and keeps browser/POST platforms restricted", () => {
    const platforms = PLATFORM_ACCESS.map((p) => p.platform);
    for (const p of ["GREENHOUSE", "LEVER", "WORKABLE", "SMARTRECRUITERS", "JAZZHR", "ICIMS", "TALEO_BUSINESS_EDITION", "ORACLE_TALEO", "WORKDAY", "UKG_PRO", "ORACLE_RECRUITING_CLOUD", "APPLICANTPRO"]) expect(platforms).toContain(p);
    for (const t of COMPANY_ATS_CATALOG) expect(PLATFORM_ACCESS.some((p) => p.platform === t.ats)).toBe(true);
    expect(PLATFORM_ACCESS.filter((p) => p.authorization === "CONFIRMED")).toEqual([]);
    expect(PLATFORM_ACCESS.filter((p) => ["WORKDAY", "UKG_PRO", "ORACLE_RECRUITING_CLOUD", "APPLICANTPRO"].includes(p.platform)).every((p) => p.authorization === "RESTRICTED" && p.preferredRoute === "SPECIAL")).toBe(true);
  });
  it("derives the effective policy per source and keeps the owner decisions of Strike, Enterprise, FSG and Trillium", () => {
    const allowed = new Set(["strike.applytojob.com"]);
    expect(effectivePolicy(target("strike"), allowed, NOW).policy).toBe("AUTOMATED_CAPTURE_ALLOWED");
    expect(effectivePolicy(target("strike"), new Set(), NOW).policy).toBe("REVIEW_REQUIRED"); // the platform alone never allows
    expect(effectivePolicy(target("trillium"), allowed, NOW).policy).toBe("BLOCKED_TERMS");
    expect(effectivePolicy(target("fsg"), allowed, NOW).policy).toBe("BLOCKED_PENDING_PERMISSION");
    expect(effectivePolicy(target("enterprise"), allowed, NOW).policy).toBe("REVIEW_TIMEBOX_EXPIRED");
    // Recipe 2.2: Taleo BE has automatic preference, which grants nothing — without an ALLOW the active route is assisted
    expect(effectivePolicy(target("walker"), allowed, NOW).policy).toBe("REVIEW_REQUIRED");
    expect(activeRouteFor(effectivePolicy(target("walker"), allowed, NOW).policy)).toBe("ASSISTED_CAPTURE");
    expect(activeRouteFor(effectivePolicy(target("strike"), allowed, NOW).policy)).toBe("AUTOMATED_CAPTURE");
    expect(effectivePolicy(target("rosendin"), allowed, NOW).policy).toBe("RESTRICTED_PLATFORM");
    expect(COMPANY_ATS_CATALOG.every((t) => effectivePolicy(t, allowed, NOW).assistedCaptureAvailable)).toBe(true);
  });
  it("applies the 10-minute identification target and 60-minute review timebox without turning expiry into ALLOW or a ban", () => {
    expect(reviewTimeboxState(null, NOW).state).toBe("NOT_STARTED");
    expect(reviewTimeboxState({ startedAt: "2026-10-09T14:30:00Z", atsIdentifiedAt: "2026-10-09T14:35:00Z", decidedAt: null }, NOW)).toMatchObject({ state: "IN_REVIEW", minutesElapsed: 30, atsIdentificationOnTarget: true });
    expect(reviewTimeboxState({ startedAt: "2026-10-09T13:00:00Z", atsIdentifiedAt: "2026-10-09T13:25:00Z", decidedAt: null }, NOW)).toMatchObject({ state: "REVIEW_TIMEBOX_EXPIRED", atsIdentificationOnTarget: false });
    expect(reviewTimeboxState({ startedAt: "2026-10-09T13:00:00Z", atsIdentifiedAt: null, decidedAt: "2026-10-09T13:40:00Z" }, NOW).state).toBe("DECIDED");
    expect(REVIEW_TIMEBOX_MINUTES).toBe(60);
    const expired = { ...target("walker"), accessReview: { startedAt: "2026-10-09T10:00:00Z", atsIdentifiedAt: null, decidedAt: null } };
    expect(effectivePolicy(expired, new Set(), NOW).policy).toBe("REVIEW_TIMEBOX_EXPIRED");
  });
  it("reads platform and external posting ID from the URL only", () => {
    expect(platformFromUrl(WALKER_URL)).toBe("TALEO_BUSINESS_EDITION");
    expect(externalIdFromUrl(WALKER_URL)).toBe("441");
    expect(externalIdFromUrl("https://careers-fsg.icims.com/jobs/2524/service-apprentice-electrician/job?in_iframe=1")).toBe("2524");
    expect(externalIdFromUrl("https://strike.applytojob.com/apply/CL0yzwQIx2/Apprentice-Electrician")).toBe("CL0yzwQIx2");
    expect(externalIdFromUrl("https://www.example.com/careers/electrician")).toBeNull();
  });
  it("records the three commercial priorities without confirming contacts or needs", () => {
    expect(COMPANY_ATS_CATALOG.filter((t) => t.commercialPriority).map((t) => [t.key, t.commercialPriority!.rank, t.commercialPriority!.focus]).sort((a, b) => Number(a[1]) - Number(b[1])))
      .toEqual([["enterprise", 1, "INVESTIGATE_EXTERNAL_STAFFING"], ["walker", 2, "WORKFORCE_SOURCE_B2B_UNCONFIRMED"], ["fsg", 3, "SECONDARY_POSSIBLE_CLIENT"]]);
    expect(target("walker").commercialPriority!.note).toMatch(/not external-labor requests/);
  });
});

describe("Recipe 2.0 — assisted capture validation", () => {
  it("accepts the Walker 441 posting and invents nothing", () => {
    expect(validateAssistedPosting(walker, NOW)).toEqual({});
    const { posting, platform } = toAssistedPosting(walker);
    expect(platform).toBe("TALEO_BUSINESS_EDITION");
    expect(posting).toMatchObject({ externalPostingId: "441", employerName: "Walker Engineering", title: "Apprentice Electrician", location: "Houston, TX", profession: "ELECTRICAL APPRENTICE",
      professionalLevel: "APPRENTICE_OR_JOURNEYMAN", compensation: null, // Recipe 2.2: apprentice requiring experience = mixed level perDiem: null, postingDate: null, explicitEmployerHeadcount: null, relationship: "UNKNOWN", vendorAcceptance: "UNKNOWN",
      licenses: ["TDLR apprentice or journeyman license"], capturedAt: "2026-10-09T12:00:00.000Z" });
    expect(posting.normalizedUrl).toBe("https://phg.tbe.taleo.net/phg04/ats/careers/v2/requisition.jsp?cws=37&org=WP3X5Q&rid=441");
  });
  it("enforces URL, limits, dates, email-alert provenance and REAL/DEMO separation", () => {
    expect(validateAssistedPosting({ ...walker, url: "http://insecure.example/job" }, NOW).url).toBe("httpsPublicUrlRequired");
    expect(validateAssistedPosting({ ...walker, summary: "x".repeat(601) }, NOW).summary).toBe("tooLongUseOwnWords");
    expect(validateAssistedPosting({ ...walker, observedOn: "2026-10-20" }, NOW).observedOn).toBe("future");
    expect(validateAssistedPosting({ ...walker, state: "Texas" }, NOW).state).toBe("twoLetterState");
    expect(validateAssistedPosting({ ...walker, provenance: "EMAIL_ALERT" }, NOW)).toMatchObject({ emailSender: "required", emailAlertReference: "required" });
    expect(validateAssistedPosting({ ...walker, provenance: "EMAIL_ALERT", emailAlert: { sender: "Walker careers alerts", receivedOn: "2026-10-09", alertReference: "Houston electrical" } }, NOW)).toEqual({});
    expect(validateAssistedPosting({ ...walker, dataClass: "DEMO" }, NOW).dataClass).toBe("demoMustBeNamedDemoLocal");
    expect(validateAssistedPosting({ ...walker, company: "DEMO LOCAL Contractor" }, NOW).dataClass).toBe("realCannotBeDemoLocal");
  });
});
