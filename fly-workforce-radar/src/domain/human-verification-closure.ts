import type { ExternalManpowerCategory } from "./database";
import type { HumanAnswerDisposition, HumanAuthorityLevel, HumanCommercialMechanism, HumanVerificationScope, HumanVerificationTaskStatus } from "./human-verification";

export const HUMAN_VERIFICATION_CLOSURE_RULE_VERSION = "human-verification-closure@1.0.0";

/**
 * Operator-facing narrative classification only (section "controlled response
 * classes" A-G) -- never persisted as a new canonical enum. Derived purely
 * from the existing certified HumanAnswerDisposition/HumanCommercialMechanism/
 * reachedHuman vocabulary, so it can never diverge from canonical truth.
 */
export const RESPONSE_CLASS_LABELS = [
  "AFFIRMATIVE_SUPPLEMENTAL_MANPOWER", "MSP_OR_VMS_ROUTE", "FULL_SCOPE_SUBCONTRACT_ONLY",
  "DIRECT_HIRE_ONLY", "REFERRED", "INSUFFICIENT_AUTHORITY_OR_UNKNOWN", "NO_SUBSTANTIVE_RESPONSE",
] as const;
export type ResponseClassLabel = (typeof RESPONSE_CLASS_LABELS)[number];

export interface ClassifyResponseInput {
  readonly reachedHuman: boolean;
  readonly answerDisposition?: HumanAnswerDisposition | null;
  readonly commercialMechanism?: HumanCommercialMechanism | null;
}

/** Pure, deterministic narrative classification -- for display/audit only, never a canonical write decision by itself. */
export function classifyResponse(input: ClassifyResponseInput): ResponseClassLabel {
  if (!input.reachedHuman) return "NO_SUBSTANTIVE_RESPONSE";
  if (input.answerDisposition === "REFERRAL") return "REFERRED";
  if (input.answerDisposition !== "AFFIRMATIVE" && input.answerDisposition !== "NEGATIVE") return "INSUFFICIENT_AUTHORITY_OR_UNKNOWN";
  if (input.commercialMechanism === "FULL_SCOPE_SUBCONTRACTORS_ONLY") return "FULL_SCOPE_SUBCONTRACT_ONLY";
  if (input.commercialMechanism === "DIRECT_HIRE_INTERNAL_ONLY" || input.commercialMechanism === "NO_EXTERNAL_MANPOWER") return "DIRECT_HIRE_ONLY";
  if (input.commercialMechanism === "MSP_OR_STAFFING_PROGRAM") return input.answerDisposition === "AFFIRMATIVE" ? "MSP_OR_VMS_ROUTE" : "DIRECT_HIRE_ONLY";
  if (input.answerDisposition === "AFFIRMATIVE" && (input.commercialMechanism === "DIRECT_EXTERNAL_MANPOWER" || input.commercialMechanism === "WORKFORCE_PARTNER_OR_SUBVENDOR")) return "AFFIRMATIVE_SUPPLEMENTAL_MANPOWER";
  return "INSUFFICIENT_AUTHORITY_OR_UNKNOWN";
}

/**
 * The ONLY mechanisms that represent a real, qualifying external/supplemental
 * manpower relationship, mapped to the frozen canonical ExternalManpowerCategory
 * vocabulary (database.ts) -- a deliberately narrower, different vocabulary
 * than HumanCommercialMechanism (10 values). RECRUITING_ONLY and PAYROLL_ONLY
 * are excluded on purpose: a recruiter placing direct hires, or a payroll-only
 * arrangement, is not evidence of accepting externally-supplied supplemental
 * labor -- see AF01 STRICT EXAMPLES in the 3I-B3 mandate.
 */
const QUALIFYING_MECHANISM_TO_CATEGORY: Readonly<Partial<Record<HumanCommercialMechanism, ExternalManpowerCategory>>> = {
  DIRECT_EXTERNAL_MANPOWER: "SUPPLEMENTAL_LABOR_ACCEPTED",
  MSP_OR_STAFFING_PROGRAM: "STAFFING_VENDOR_ACCEPTED",
  WORKFORCE_PARTNER_OR_SUBVENDOR: "LABOR_SUBCONTRACTING_ACCEPTED",
};

/** The negative claims created from a NEGATIVE disposition are always recorded against this general category -- the category enum only names acceptance types, so a blanket "no external manpower" negative is anchored to the broadest one. Never used to derive a positive result. */
const NEGATIVE_CLAIM_CATEGORY: ExternalManpowerCategory = "SUPPLEMENTAL_LABOR_ACCEPTED";

const SUFFICIENT_AUTHORITY_LEVELS: ReadonlySet<HumanAuthorityLevel> = new Set(["DECISION_PATH_AUTHORITY", "AUTHORIZED_COMPANY_AUTHORITY"]);

export function hasSufficientAuthority(level: HumanAuthorityLevel): boolean {
  return SUFFICIENT_AUTHORITY_LEVELS.has(level);
}

/** A concrete scope anchor: an explicit companywide statement, or a real project/opportunity/trade tie -- never a bare, unexplained UNKNOWN. */
export function hasSufficientScope(scope: HumanVerificationScope): boolean {
  return scope.companyScope === "COMPANYWIDE" || scope.companyScope === "DIVISION" || scope.companyScope === "SUBSIDIARY"
    || !!scope.projectId || !!scope.tradeId || !!scope.geographicScope;
}

export interface CanonicalClosureDecision {
  readonly qualifies: boolean;
  readonly reason: string;
  readonly category: ExternalManpowerCategory | null;
  readonly accepted: boolean | null;
}

export interface EvaluateClosureInput {
  readonly reachedHuman: boolean;
  readonly answerDisposition: HumanAnswerDisposition;
  readonly authorityLevel: HumanAuthorityLevel;
  readonly commercialMechanism: HumanCommercialMechanism | null;
  readonly scope: HumanVerificationScope;
}

/**
 * The single narrow gate deciding whether a human response is authorized to
 * become canonical AF01 evidence at all. Returning qualifies:true does NOT by
 * itself set AF01 positive/negative -- it only authorizes a VERIFIED claim to
 * be recorded; ManpowerAcceptanceService.evaluate() (existing, untouched)
 * makes the actual result determination from ALL current claims, including
 * this one. This function is the one place every AF01 non-negotiable
 * invariant from the 3I-B3 mandate is enforced.
 */
export function evaluateCanonicalClosure(input: EvaluateClosureInput): CanonicalClosureDecision {
  if (!input.reachedHuman) return { qualifies: false, reason: "No substantive human response was obtained.", category: null, accepted: null };
  if (input.answerDisposition === "REFERRAL") return { qualifies: false, reason: "Referral preserved; not a qualifying answer.", category: null, accepted: null };
  if (input.answerDisposition !== "AFFIRMATIVE" && input.answerDisposition !== "NEGATIVE") {
    return { qualifies: false, reason: "Response disposition is not a qualifying affirmative or negative answer.", category: null, accepted: null };
  }
  if (!hasSufficientAuthority(input.authorityLevel)) {
    return { qualifies: false, reason: "Respondent authority is insufficient for canonical AF01 evidence.", category: null, accepted: null };
  }
  if (!hasSufficientScope(input.scope)) {
    return { qualifies: false, reason: "Scope is not sufficiently defined to record canonical evidence.", category: null, accepted: null };
  }
  if (input.answerDisposition === "NEGATIVE") {
    return { qualifies: true, reason: "Authoritative, scoped negative response.", category: NEGATIVE_CLAIM_CATEGORY, accepted: false };
  }
  const category = input.commercialMechanism ? QUALIFYING_MECHANISM_TO_CATEGORY[input.commercialMechanism] : undefined;
  if (!category) {
    return { qualifies: false, reason: "Commercial mechanism does not represent a qualifying external/supplemental manpower relationship.", category: null, accepted: null };
  }
  return { qualifies: true, reason: "Authoritative, scoped affirmative response identifying a qualifying external manpower relationship.", category, accepted: true };
}

/**
 * The task-status consequence of a captured response. This is a STATUS
 * decision only (queue/follow-up bookkeeping) -- completely independent of
 * evaluateCanonicalClosure's AF01 decision above. A qualifying AF01 response
 * still only reaches READY_FOR_ASSESSMENT here, never COMPLETED: closing the
 * task itself remains a separate, later, explicitly human step (see the
 * "no invalid shortcut from attempt made to verified positive" mandate).
 */
export function desiredResponseTaskStatus(reachedHuman: boolean, disposition: HumanAnswerDisposition | null): HumanVerificationTaskStatus {
  if (!reachedHuman) return "ATTEMPTED";
  if (disposition === "AFFIRMATIVE" || disposition === "NEGATIVE") return "READY_FOR_ASSESSMENT";
  return "FOLLOW_UP_REQUIRED";
}

/**
 * Plans the shortest sequence of INDIVIDUALLY-VALID hops (per the certified
 * transitions policy map, reused verbatim -- never redefined here) from the
 * task's current status to the desired one. Returns [] both when no hop is
 * needed (already there) and when no valid path exists at all -- callers
 * must distinguish those by comparing current !== desired themselves, since
 * "no valid path" is exactly the "invalid transition" case that must be
 * rejected, not silently treated as a no-op.
 */
export function planTaskStatusHops(
  current: HumanVerificationTaskStatus,
  desired: HumanVerificationTaskStatus,
  transitions: Readonly<Record<HumanVerificationTaskStatus, readonly HumanVerificationTaskStatus[]>>,
): HumanVerificationTaskStatus[] {
  if (current === desired) return [];
  if (transitions[current].includes(desired)) return [desired];
  if (transitions[current].includes("ATTEMPTED") && transitions.ATTEMPTED.includes(desired)) return ["ATTEMPTED", desired];
  return [];
}
