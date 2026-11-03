import { describe, expect, it } from "vitest";
import type { HumanAuthorityLevel, HumanCommercialMechanism, HumanVerificationScope } from "../../domain/human-verification";
import {
  classifyResponse, desiredResponseTaskStatus, evaluateCanonicalClosure, hasSufficientAuthority,
  hasSufficientScope, planTaskStatusHops,
} from "../../domain/human-verification-closure";
import { HUMAN_VERIFICATION_TASK_TRANSITIONS } from "../../server/services/human-verification/human-verification-service";

const scopedProject: HumanVerificationScope = { companyScope: "UNKNOWN", projectId: "project-1" };
const scopedCompanywide: HumanVerificationScope = { companyScope: "COMPANYWIDE" };
const bareUnknown: HumanVerificationScope = { companyScope: "UNKNOWN" };
const authoritative: HumanAuthorityLevel = "DECISION_PATH_AUTHORITY";
const insufficient: HumanAuthorityLevel = "ROUTING_ONLY";

describe("3I-B3 AF01 non-negotiable invariants", () => {
  it("13. a referral does NOT produce positive AF01", () => {
    const decision = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "REFERRAL", authorityLevel: authoritative, commercialMechanism: null, scope: scopedProject });
    expect(decision.qualifies).toBe(false);
    expect(decision.accepted).toBeNull();
  });

  it("14/15. no-response and voicemail do NOT produce positive AF01 (not reached at all)", () => {
    const decision = evaluateCanonicalClosure({ reachedHuman: false, answerDisposition: "OTHER", authorityLevel: authoritative, commercialMechanism: "DIRECT_EXTERNAL_MANPOWER", scope: scopedCompanywide });
    expect(decision.qualifies).toBe(false);
  });

  it("16. email-sent-only does NOT produce positive AF01 (not reached)", () => {
    const decision = evaluateCanonicalClosure({ reachedHuman: false, answerDisposition: "AFFIRMATIVE", authorityLevel: authoritative, commercialMechanism: "DIRECT_EXTERNAL_MANPOWER", scope: scopedCompanywide });
    expect(decision.qualifies).toBe(false);
  });

  it("17. direct-hire-only does NOT produce positive AF01 -- it is valid NEGATIVE intelligence instead", () => {
    const decision = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "NEGATIVE", authorityLevel: authoritative, commercialMechanism: "DIRECT_HIRE_INTERNAL_ONLY", scope: scopedCompanywide });
    expect(decision.qualifies).toBe(true);
    expect(decision.accepted).toBe(false);
  });

  it("18. full-scope-subcontract-only does NOT produce positive AF01 for supplemental labor", () => {
    const affirmativeAttempt = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "AFFIRMATIVE", authorityLevel: authoritative, commercialMechanism: "FULL_SCOPE_SUBCONTRACTORS_ONLY", scope: scopedCompanywide });
    expect(affirmativeAttempt.qualifies).toBe(false);
    expect(affirmativeAttempt.accepted).toBeNull();
  });

  it("19. insufficient-authority response does NOT produce positive AF01, even with an otherwise-qualifying affirmative answer", () => {
    const decision = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "AFFIRMATIVE", authorityLevel: insufficient, commercialMechanism: "DIRECT_EXTERNAL_MANPOWER", scope: scopedCompanywide });
    expect(decision.qualifies).toBe(false);
  });

  it("20. MSP/VMS classification alone does NOT automatically produce positive AF01 -- only an authoritative AFFIRMATIVE through it does", () => {
    const bareMsp = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "QUALIFIED_OR_CONDITIONAL", authorityLevel: authoritative, commercialMechanism: "MSP_OR_STAFFING_PROGRAM", scope: scopedCompanywide });
    expect(bareMsp.qualifies).toBe(false);
    const confirmedMsp = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "AFFIRMATIVE", authorityLevel: authoritative, commercialMechanism: "MSP_OR_STAFFING_PROGRAM", scope: scopedCompanywide });
    expect(confirmedMsp.qualifies).toBe(true);
    expect(confirmedMsp.category).toBe("STAFFING_VENDOR_ACCEPTED");
  });

  it("recruiting-only and payroll-only never qualify as accepted external manpower", () => {
    for (const mechanism of ["RECRUITING_ONLY", "PAYROLL_ONLY", "OTHER_MECHANISM", "MECHANISM_UNKNOWN"] as HumanCommercialMechanism[]) {
      const decision = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "AFFIRMATIVE", authorityLevel: authoritative, commercialMechanism: mechanism, scope: scopedCompanywide });
      expect(decision.qualifies, `${mechanism} must not qualify`).toBe(false);
    }
  });

  it("21. a qualifying scoped/authoritative YES follows the canonical rule and identifies the correct category", () => {
    const decision = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "AFFIRMATIVE", authorityLevel: "AUTHORIZED_COMPANY_AUTHORITY", commercialMechanism: "DIRECT_EXTERNAL_MANPOWER", scope: scopedProject });
    expect(decision).toMatchObject({ qualifies: true, accepted: true, category: "SUPPLEMENTAL_LABOR_ACCEPTED" });
  });

  it("22. scope does not broaden silently -- a bare unknown scope with no anchor never qualifies, regardless of how strong the answer is", () => {
    const decision = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "AFFIRMATIVE", authorityLevel: "AUTHORIZED_COMPANY_AUTHORITY", commercialMechanism: "DIRECT_EXTERNAL_MANPOWER", scope: bareUnknown });
    expect(decision.qualifies).toBe(false);
    expect(hasSufficientScope(bareUnknown)).toBe(false);
    expect(hasSufficientScope(scopedProject)).toBe(true);
    expect(hasSufficientScope(scopedCompanywide)).toBe(true);
  });

  it("does not know / unknown disposition never qualifies", () => {
    const decision = evaluateCanonicalClosure({ reachedHuman: true, answerDisposition: "UNKNOWN_DONT_KNOW", authorityLevel: authoritative, commercialMechanism: "DIRECT_EXTERNAL_MANPOWER", scope: scopedCompanywide });
    expect(decision.qualifies).toBe(false);
  });

  it("hasSufficientAuthority draws the line at DECISION_PATH_AUTHORITY and above", () => {
    expect(hasSufficientAuthority("AUTHORIZED_COMPANY_AUTHORITY")).toBe(true);
    expect(hasSufficientAuthority("DECISION_PATH_AUTHORITY")).toBe(true);
    expect(hasSufficientAuthority("PROCESS_PARTICIPANT")).toBe(false);
    expect(hasSufficientAuthority("SUBJECT_MATTER_INFORMED")).toBe(false);
    expect(hasSufficientAuthority("ROUTING_ONLY")).toBe(false);
    expect(hasSufficientAuthority("UNKNOWN")).toBe(false);
  });
});

describe("3I-B3 operator-facing response classification (narrative only, no canonical effect)", () => {
  it("classifies every strict example correctly", () => {
    expect(classifyResponse({ reachedHuman: false })).toBe("NO_SUBSTANTIVE_RESPONSE");
    expect(classifyResponse({ reachedHuman: true, answerDisposition: "REFERRAL" })).toBe("REFERRED");
    expect(classifyResponse({ reachedHuman: true, answerDisposition: "UNKNOWN_DONT_KNOW" })).toBe("INSUFFICIENT_AUTHORITY_OR_UNKNOWN");
    expect(classifyResponse({ reachedHuman: true, answerDisposition: "NEGATIVE", commercialMechanism: "DIRECT_HIRE_INTERNAL_ONLY" })).toBe("DIRECT_HIRE_ONLY");
    expect(classifyResponse({ reachedHuman: true, answerDisposition: "AFFIRMATIVE", commercialMechanism: "FULL_SCOPE_SUBCONTRACTORS_ONLY" })).toBe("FULL_SCOPE_SUBCONTRACT_ONLY");
    expect(classifyResponse({ reachedHuman: true, answerDisposition: "AFFIRMATIVE", commercialMechanism: "MSP_OR_STAFFING_PROGRAM" })).toBe("MSP_OR_VMS_ROUTE");
    expect(classifyResponse({ reachedHuman: true, answerDisposition: "AFFIRMATIVE", commercialMechanism: "DIRECT_EXTERNAL_MANPOWER" })).toBe("AFFIRMATIVE_SUPPLEMENTAL_MANPOWER");
  });
});

describe("3I-B3 task status transition planning (no invalid shortcuts)", () => {
  it("25/26. an invalid/unreachable transition plans no path -- caller must reject, not silently no-op", () => {
    expect(planTaskStatusHops("COMPLETED", "READY_FOR_ASSESSMENT", HUMAN_VERIFICATION_TASK_TRANSITIONS)).toEqual([]);
    expect(planTaskStatusHops("READY_FOR_APPROVAL", "READY_FOR_ASSESSMENT", HUMAN_VERIFICATION_TASK_TRANSITIONS)).toEqual([]);
  });

  it("never allows a direct jump from an initial state straight to a resolved/verified-positive-implying status", () => {
    expect(desiredResponseTaskStatus(true, "AFFIRMATIVE")).toBe("READY_FOR_ASSESSMENT");
    expect(HUMAN_VERIFICATION_TASK_TRANSITIONS.OPEN).not.toContain("COMPLETED");
    expect(planTaskStatusHops("OPEN", "READY_FOR_ASSESSMENT", HUMAN_VERIFICATION_TASK_TRANSITIONS)).toEqual(["ATTEMPTED", "READY_FOR_ASSESSMENT"]);
  });

  it("a non-substantive outcome always targets ATTEMPTED, reachable in at most one hop from OPEN/ASSIGNED", () => {
    expect(desiredResponseTaskStatus(false, null)).toBe("ATTEMPTED");
    expect(planTaskStatusHops("OPEN", "ATTEMPTED", HUMAN_VERIFICATION_TASK_TRANSITIONS)).toEqual(["ATTEMPTED"]);
    expect(planTaskStatusHops("ASSIGNED", "ATTEMPTED", HUMAN_VERIFICATION_TASK_TRANSITIONS)).toEqual(["ATTEMPTED"]);
    expect(planTaskStatusHops("ATTEMPTED", "ATTEMPTED", HUMAN_VERIFICATION_TASK_TRANSITIONS)).toEqual([]);
  });

  it("a referral or unknown-authority answer routes to FOLLOW_UP_REQUIRED", () => {
    expect(desiredResponseTaskStatus(true, "REFERRAL")).toBe("FOLLOW_UP_REQUIRED");
    expect(desiredResponseTaskStatus(true, "UNKNOWN_DONT_KNOW")).toBe("FOLLOW_UP_REQUIRED");
    expect(planTaskStatusHops("AWAITING_RESPONSE", "FOLLOW_UP_REQUIRED", HUMAN_VERIFICATION_TASK_TRANSITIONS)).toEqual(["FOLLOW_UP_REQUIRED"]);
  });
});
