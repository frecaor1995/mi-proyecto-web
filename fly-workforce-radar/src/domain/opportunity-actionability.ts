import type{CommercialAction}from"./commercial-action";

/**
 * Phase 2O. Separates two concepts this codebase's existing temporal fields
 * (staleAfter/freshUntil) conflate: EVIDENCE_FRESHNESS ("can I still rely on this
 * observation") and OPPORTUNITY_ACTIONABILITY ("can Fly still realistically take
 * commercial action on this opportunity now"). A captured RFP can remain fresh,
 * fully-provenanced evidence of a real buyer/AF-01/contact relationship while the
 * underlying solicitation itself is closed, awarded, cancelled, or expired.
 */
export const ACTIONABILITY_STATES=[
  "OPEN","OPENING_SOON","CLOSING_SOON",
  "EXPIRED","CLOSED","AWARDED","CANCELLED","TERMINATED",
  "UNKNOWN","STALE_STATUS","NOT_APPLICABLE",
]as const;
export type ActionabilityState=(typeof ACTIONABILITY_STATES)[number];

/** States compatible with an active, external commercial pursuit. Every other
 * state -- including UNKNOWN -- must NOT unlock an active recommendation; absence
 * of evidence is never treated as evidence of openness. */
export const OPEN_COMPATIBLE_STATES:ReadonlySet<ActionabilityState>=new Set(["OPEN","OPENING_SOON","CLOSING_SOON"]);

/** Terminal statuses: once observed, they are not re-opened by newer evidence in
 * this rule version, and they are never overridden by a deadline computation --
 * an explicit CLOSED/AWARDED/CANCELLED/TERMINATED observation always wins over a
 * still-future deadline. */
export const EXPLICIT_TERMINAL_STATUSES=["CLOSED","AWARDED","CANCELLED","TERMINATED"]as const;
export type ExplicitTerminalStatus=(typeof EXPLICIT_TERMINAL_STATUSES)[number];

export const ACTIONABILITY_RULE_VERSION="opportunity-actionability@1.0.0";
/** Explicit, versioned, deterministic urgency window -- not ML-derived. */
export const CLOSING_SOON_WINDOW_DAYS=3;

export interface ActionabilityDeadlineEvidence{
  /** ORIGINAL is the first captured deadline; AMENDMENT is a later, superseding
   * observation of a revised/extended/reopened deadline for the same solicitation.
   * Never inferred -- both kinds must come from real observed evidence. */
  kind:"ORIGINAL"|"AMENDMENT";
  date:Date;
  /** When this deadline observation was itself captured. Governs which deadline is
   * authoritative "as of" a given historical asOf (see assessActionability). */
  observedAt:Date;
  evidenceIds:string[];
}

export interface ActionabilityInput{
  opportunityId:string;
  /** Only ever set from an explicit, real status observation (a posting marked
   * "closed", an award notice, a cancellation notice). Never inferred from page
   * unavailability, HTTP errors, or absence of a deadline. */
  explicitStatus:ExplicitTerminalStatus|"OPEN"|null;
  /** If explicitStatus is "OPEN", the evidence backing it is only trusted through
   * this point; past it, without fresher confirmation, state degrades to
   * STALE_STATUS rather than being assumed to still be true indefinitely. Ignored
   * for terminal statuses, which do not expire. */
  explicitStatusFreshUntil:Date|null;
  /** Zero or more deadline observations for the same opportunity/solicitation.
   * The one with the latest observedAt at or before asOf governs; earlier ones are
   * preserved (never destroyed) as supersededDeadlines for audit. */
  deadlines:ActionabilityDeadlineEvidence[];
  /** When a solicitation/posting is known not to open until a future date. */
  startDate:Date|null;
  evidenceIds:string[];
}

export const NO_ACTIONABILITY_EVIDENCE=(opportunityId:string):ActionabilityInput=>({opportunityId,explicitStatus:null,explicitStatusFreshUntil:null,deadlines:[],startDate:null,evidenceIds:[]});

export interface ActionabilityResult{
  opportunityId:string;
  state:ActionabilityState;
  ruleVersion:string;
  evaluatedAt:Date;
  asOf:Date;
  governingDeadline:{date:Date;kind:"ORIGINAL"|"AMENDMENT";evidenceIds:string[]}|null;
  /** Prior deadline observations superseded by governingDeadline, preserved --
   * never destructively overwritten -- for audit and historical reconstruction. */
  supersededDeadlines:{date:Date;kind:"ORIGINAL"|"AMENDMENT";evidenceIds:string[]}[];
  explicitStatus:string|null;
  blockers:string[];
  explanation:string;
  evidenceIds:string[];
}

/** Actions a reviewer or automated flow could execute directly against an external
 * party right now. An expired/closed/unknown-actionability opportunity must not
 * surface one of these as its active recommendation. */
export const ACTIVE_EXTERNAL_ACTIONS:ReadonlySet<CommercialAction>=new Set(["CALL_TODAY","EMAIL_TODAY","CONTACT_RECRUITER","REGISTER_AS_VENDOR"]);
/** Internal research/verification actions remain legitimate regardless of
 * actionability -- resolving a conflict or verifying manpower acceptance on an
 * expired solicitation still has real commercial-intelligence value. */
export const INTERNAL_ACTIONS:ReadonlySet<CommercialAction>=new Set(["VERIFY_CONTACT","VERIFY_MANPOWER_ACCEPTANCE","RESEARCH_PROJECT","RESOLVE_CONFLICT","WAIT"]);

export type ActiveRecommendation=CommercialAction|"TECHNICALLY_ELIGIBLE_BUT_NOT_CURRENTLY_ACTIONABLE";

export interface GatedCommercialActionResult{
  opportunityId:string;
  /** The REAL, unmodified CommercialActionService result. Never rewritten. */
  underlyingAction:CommercialAction;
  actionability:ActionabilityResult;
  gate:"ACTIVE"|"BLOCKED_BY_ACTIONABILITY"|"NOT_ACTIVE_EXTERNAL";
  /** null only when gate is BLOCKED_BY_ACTIONABILITY and there is genuinely no
   * safe active recommendation to surface. */
  activeRecommendation:ActiveRecommendation|null;
  countsAsActiveHotA:boolean;
  countsAsActiveHotB:boolean;
  explanation:string;
}
