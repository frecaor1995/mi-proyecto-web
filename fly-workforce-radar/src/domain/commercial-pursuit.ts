import type { ActionableRoute } from "./buyer-intelligence";
import type { DemandMatchCounts } from "./matching-results";

/**
 * Phase 3A — commercial pursuit (pure domain).
 *
 * Three concepts stay separate and are never inferred from one another:
 *   DEMAND  — evidence that an organization needs labor (pain signals, demand signals).
 *   PURSUIT — what Fly is doing about it (owner, route, offer hypothesis, activities, next action).
 *   RESULT  — what Fly learned from real human interaction (outcomes, staff requests, results).
 * A job posting, project, permit or worker report is labor-demand evidence; it is NOT evidence that the
 * organization buys external labor, NOT a conversation and NOT a staff request.
 * Humans perform every contact; this module only interprets what humans recorded. Nothing here sends anything.
 */
export const COMMERCIAL_PURSUIT_RULE_VERSION = "commercial-pursuit@1.0.0";

export const PAIN_TYPES = ["OPEN_ROLES_PERSISTENT", "JOB_REPOSTED", "STAFFING_AGENCY_BACKLOG", "WORKER_REFERRAL", "WORKFORCE_EXIT", "PROJECT_LOAD",
  "PERMIT_LOAD", "ABSENCE_COVERAGE", "INBOUND_REQUEST", "OTHER", "UNKNOWN"] as const;
export type PainType = (typeof PAIN_TYPES)[number];
export const ASSERTION_BASES = ["OBSERVED", "REPORTED", "INFERRED"] as const;
export type AssertionBasis = (typeof ASSERTION_BASES)[number];
export const PAIN_STATUSES = ["UNVERIFIED", "VERIFIED", "REJECTED"] as const;
export type PainStatus = (typeof PAIN_STATUSES)[number];
export const CONFIDENCES = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const PAIN_SOURCE_KINDS = ["PUBLIC_SOURCE", "WORKER_REPORT", "HUMAN_INTERACTION", "OPERATOR_OBSERVATION", "DEMAND_SIGNAL"] as const;
export type PainSourceKind = (typeof PAIN_SOURCE_KINDS)[number];

export const ACCESS_CHANNELS = ["CALL", "EMAIL", "WORKER_REFERRAL", "EXISTING_RELATIONSHIP", "JOBSITE_VISIT", "DISTRIBUTOR_REFERRAL", "INBOUND", "MEETING", "OTHER"] as const;
export type AccessChannel = (typeof ACCESS_CHANNELS)[number];
export const ACTIVITY_TYPES = ["PURSUIT_STARTED", "OUTREACH", "MEETING", "FOLLOW_UP", "STAFF_REQUEST_RECEIVED", "PROPOSAL_SENT", "CANDIDATES_PRESENTED",
  "RESULT", "NEXT_ACTION_UPDATE", "NOTE"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const OUTCOMES = ["NO_ANSWER", "VOICEMAIL", "GATEKEEPER", "WRONG_PERSON", "REFERRED_TO_OTHER_PERSON", "CALL_BACK", "CONVERSATION",
  "ACCEPTS_EXTERNAL_LABOR", "DOES_NOT_ACCEPT_EXTERNAL_LABOR", "NO_CURRENT_NEED", "VENDOR_REGISTRATION_REQUIRED", "STAFF_REQUEST", "NOT_INTERESTED", "OTHER"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const RESULTS = ["WON", "LOST", "NO_DECISION"] as const;
export type PursuitResult = (typeof RESULTS)[number];
/** Messages/approaches being TESTED. They are hypotheses, never contractual promises (no guarantees, fees or policies). */
export const OFFER_HYPOTHESES = ["STAFFING_SUBCONTRACTOR", "ABSENCE_COVERAGE", "SMALL_TRIAL_CREW", "TEMP_TO_HIRE", "EVALUATED_ELECTRICIANS", "BILINGUAL_CREW", "OTHER"] as const;
export type OfferHypothesis = (typeof OFFER_HYPOTHESES)[number];
export type HandlesExternalWorkforce = "YES" | "NO" | "UNKNOWN";

/** Commercial progression. PLACEMENT, timesheets, invoicing and payment are deliberately absent (Phase 5). */
export const PIPELINE_STAGES = ["SIGNAL", "ROUTE_IDENTIFIED", "FIRST_TOUCH", "CONVERSATION", "STAFF_REQUEST", "PROPOSAL", "PRESENTATION", "RESULT"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
const STAGE_RANK: Record<PipelineStage, number> = Object.fromEntries(PIPELINE_STAGES.map((stage, index) => [stage, index + 1])) as Record<PipelineStage, number>;
export const stageRank = (stage: PipelineStage) => STAGE_RANK[stage];

export interface ActivityRecord {
  readonly id: string;
  readonly activityType: ActivityType;
  readonly accessChannel: AccessChannel | null;
  readonly outcome: Outcome | null;
  readonly result: PursuitResult | null;
  readonly handlesExternalWorkforce: HandlesExternalWorkforce;
  readonly performedAt: string;
  readonly recordedAt: string;
  readonly nextAction: string | null;
  readonly nextActionDue: string | null;
  readonly nextActionOwnerOperatorId: string | null;
  readonly offerHypothesis: OfferHypothesis | null;
  readonly contactName: string | null;
  readonly referredName: string | null;
  readonly referredDepartment: string | null;
  readonly staffRequestDemandSignalId: string | null;
}

/** Outcomes in which a human engaged in a commercial exchange (not merely answered or routed the call). */
const CONVERSATION_OUTCOMES: readonly Outcome[] = ["CONVERSATION", "ACCEPTS_EXTERNAL_LABOR", "DOES_NOT_ACCEPT_EXTERNAL_LABOR", "NO_CURRENT_NEED",
  "VENDOR_REGISTRATION_REQUIRED", "STAFF_REQUEST", "NOT_INTERESTED"];
const CONTACT_TYPES: readonly ActivityType[] = ["OUTREACH", "MEETING", "FOLLOW_UP"];

/** The stage a single recorded human activity demonstrates (null: the activity proves no human stage). */
export function stageOfActivity(activity: Pick<ActivityRecord, "activityType" | "outcome">): PipelineStage | null {
  switch (activity.activityType) {
    case "STAFF_REQUEST_RECEIVED": return "STAFF_REQUEST";
    case "PROPOSAL_SENT": return "PROPOSAL";
    case "CANDIDATES_PRESENTED": return "PRESENTATION";
    case "RESULT": return "RESULT";
    case "OUTREACH": case "MEETING": case "FOLLOW_UP":
      if (activity.outcome === "STAFF_REQUEST") return "STAFF_REQUEST";
      return activity.outcome && CONVERSATION_OUTCOMES.includes(activity.outcome) ? "CONVERSATION" : "FIRST_TOUCH";
    default: return null; // PURSUIT_STARTED, NEXT_ACTION_UPDATE, NOTE: intent and bookkeeping, not progress
  }
}

export type PursuitStatus = "NOT_PURSUED" | "ACTIVE" | "CLOSED";
export interface PipelineState {
  readonly status: PursuitStatus;
  readonly currentStage: PipelineStage;
  /** Furthest stage evidenced before any result — a lost opportunity still shows how far it progressed. */
  readonly maxStageReached: PipelineStage;
  readonly result: PursuitResult | null;
  readonly stageEvidence: Readonly<Partial<Record<PipelineStage, string>>>;
}

/**
 * Stages 1–2 come from system evidence (a verified demand signal exists; an actionable route exists). Stages 3+ come
 * ONLY from human-recorded activity — a contact found by web search never advances the pipeline.
 */
export function derivePipeline(input: { readonly activities: readonly ActivityRecord[]; readonly routeIdentified: boolean }): PipelineState {
  const ordered = [...input.activities].sort((a, b) => a.performedAt.localeCompare(b.performedAt) || a.recordedAt.localeCompare(b.recordedAt));
  const evidence: Partial<Record<PipelineStage, string>> = { SIGNAL: "opportunity" };
  let max: PipelineStage = "SIGNAL";
  if (input.routeIdentified) { max = "ROUTE_IDENTIFIED"; evidence.ROUTE_IDENTIFIED = "contact-intelligence-route"; }
  let result: PursuitResult | null = null;
  for (const activity of ordered) {
    const stage = stageOfActivity(activity);
    if (!stage) continue;
    if (stage === "RESULT") { result = activity.result; evidence.RESULT = activity.id; continue; }
    if (!evidence[stage]) evidence[stage] = activity.id;
    if (stageRank(stage) > stageRank(max)) max = stage;
  }
  const pursued = ordered.length > 0;
  return { status: result ? "CLOSED" : pursued ? "ACTIVE" : "NOT_PURSUED", currentStage: result ? "RESULT" : max, maxStageReached: max, result, stageEvidence: evidence };
}

export interface NextActionState { readonly action: string; readonly due: string; readonly ownerOperatorId: string; readonly overdue: boolean; readonly sourceActivityId: string }
/** The most recently recorded next action; none once a result closes the pursuit. */
export function currentNextAction(activities: readonly ActivityRecord[], today: string): NextActionState | null {
  const ordered = [...activities].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.performedAt.localeCompare(a.performedAt));
  if (ordered.some((a) => a.activityType === "RESULT")) return null;
  const latest = ordered.find((a) => a.nextAction && a.nextActionDue && a.nextActionOwnerOperatorId);
  return latest ? { action: latest.nextAction!, due: latest.nextActionDue!, ownerOperatorId: latest.nextActionOwnerOperatorId!, overdue: latest.nextActionDue! < today, sourceActivityId: latest.id } : null;
}

// ---------------------------------------------------------------------------------------------------------
// Validation (mirrors the database checks so errors are shown before the write)

export interface ActivityInput {
  readonly activityType: ActivityType;
  readonly accessChannel: AccessChannel | null;
  readonly outcome: Outcome | null;
  readonly result: PursuitResult | null;
  readonly performedAt: string;
  readonly nextAction: string | null;
  readonly nextActionDue: string | null;
  readonly nextActionOwnerOperatorId: string | null;
  readonly referredName: string | null;
  readonly referredDepartment: string | null;
  readonly hasStaffRequest: boolean;
  readonly offerHypothesis: OfferHypothesis | null;
}

export function validateActivity(input: ActivityInput, pipeline: PipelineState): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  if (!ACTIVITY_TYPES.includes(input.activityType)) errors.activityType = "invalid";
  if (pipeline.status === "CLOSED") errors.activityType = "pursuitClosed";
  if (input.accessChannel && !ACCESS_CHANNELS.includes(input.accessChannel)) errors.accessChannel = "invalid";
  if (input.outcome && !OUTCOMES.includes(input.outcome)) errors.outcome = "invalid";
  if (input.offerHypothesis && !OFFER_HYPOTHESES.includes(input.offerHypothesis)) errors.offerHypothesis = "invalid";
  if (CONTACT_TYPES.includes(input.activityType)) {
    if (!input.accessChannel) errors.accessChannel = "required";
    if (!input.outcome) errors.outcome = "required";
  }
  if ((input.activityType === "RESULT") !== Boolean(input.result)) errors.result = input.activityType === "RESULT" ? "required" : "onlyForResult";
  if (input.result && !RESULTS.includes(input.result)) errors.result = "invalid";
  if (Number.isNaN(Date.parse(input.performedAt))) errors.performedAt = "invalidDate";
  const needsNext = !["RESULT", "NOTE"].includes(input.activityType);
  const anyNext = Boolean(input.nextAction || input.nextActionDue || input.nextActionOwnerOperatorId);
  if (needsNext || anyNext) {
    if (!input.nextAction?.trim()) errors.nextAction = "required";
    if (!input.nextActionDue || Number.isNaN(Date.parse(`${input.nextActionDue}T00:00:00Z`))) errors.nextActionDue = "required";
    if (!input.nextActionOwnerOperatorId) errors.nextActionOwner = "required";
  }
  if (input.outcome === "REFERRED_TO_OTHER_PERSON" && !input.referredName?.trim() && !input.referredDepartment?.trim()) errors.referredName = "required";
  const staffRequest = input.outcome === "STAFF_REQUEST" || input.activityType === "STAFF_REQUEST_RECEIVED";
  if (staffRequest && !input.hasStaffRequest) errors.staffRequest = "required";
  if (!staffRequest && input.hasStaffRequest) errors.staffRequest = "onlyForStaffRequest";
  return errors;
}

// ---------------------------------------------------------------------------------------------------------
// DEMAND: pain evidence

export interface PainSignalRecord {
  readonly id: string;
  readonly painType: PainType;
  readonly assertionBasis: AssertionBasis;
  readonly status: PainStatus;
  readonly confidence: Confidence;
  readonly summary: string;
  readonly sourceKind: PainSourceKind;
  readonly sourceUrl: string | null;
  readonly observedAt: string | null;
  readonly recordedAt: string;
  readonly supersedesId: string | null;
  readonly reportedByWorkerId: string | null;
  readonly consentUseIntelligence: boolean | null;
  readonly consentIdentifyWorker: boolean | null;
  readonly supervisorName: string | null;
  readonly supervisorTitle: string | null;
}

/** Latest record of each supersession chain (append-only history keeps every earlier assertion). */
export function currentPainSignals<T extends Pick<PainSignalRecord, "id" | "supersedesId">>(signals: readonly T[]): readonly T[] {
  const superseded = new Set(signals.map((s) => s.supersedesId).filter((id): id is string => Boolean(id)));
  return signals.filter((s) => !superseded.has(s.id));
}

/** Whether a pain assertion may be used commercially, and whether the referring worker may be named to the prospect. */
export function referralVisibility(signal: Pick<PainSignalRecord, "painType" | "consentUseIntelligence" | "consentIdentifyWorker" | "status">) {
  if (signal.painType !== "WORKER_REFERRAL") return { usableCommercially: signal.status !== "REJECTED", mayNameWorkerToProspect: false };
  const use = signal.consentUseIntelligence === true;
  return { usableCommercially: use && signal.status !== "REJECTED", mayNameWorkerToProspect: use && signal.consentIdentifyWorker === true };
}

export type PainLevel = "NONE" | "INFERRED" | "REPORTED" | "OBSERVED" | "VERIFIED";
export interface PainSummary { readonly level: PainLevel; readonly types: readonly PainType[]; readonly usable: number; readonly withheld: number; readonly rejected: number }
/** PAIN: how strong is the evidence of a current labor need. Levels, not a score. */
export function painSummary(signals: readonly PainSignalRecord[]): PainSummary {
  const current = currentPainSignals(signals);
  const usable = current.filter((s) => referralVisibility(s).usableCommercially);
  const rank: Record<PainLevel, number> = { NONE: 0, INFERRED: 1, REPORTED: 2, OBSERVED: 3, VERIFIED: 4 };
  let level: PainLevel = "NONE";
  for (const s of usable) {
    const l: PainLevel = s.status === "VERIFIED" ? "VERIFIED" : s.assertionBasis;
    if (rank[l] > rank[level]) level = l;
  }
  return {
    level, types: [...new Set(usable.map((s) => s.painType))], usable: usable.length,
    withheld: current.filter((s) => s.painType === "WORKER_REFERRAL" && s.consentUseIntelligence !== true).length,
    rejected: current.filter((s) => s.status === "REJECTED").length,
  };
}

// ---------------------------------------------------------------------------------------------------------
// ACCESS / FIT

export type AccessFactor = "DEPARTMENTAL_ROUTE" | "NAMED_CONTACT" | "ATTRIBUTABLE_CHANNEL" | "WORKER_REFERRAL" | "EXISTING_RELATIONSHIP" | "HUMAN_CONVERSATION" | "CONFIRMED_COMMERCIAL_RESPONSIBILITY";
export type AccessLevel = "NONE" | "ROUTE" | "NAMED" | "RELATIONSHIP";
export interface AccessSummary { readonly level: AccessLevel; readonly factors: readonly AccessFactor[] }
/** ACCESS: how strong is Fly's route to a relevant human. Factors are listed; the level only orders them. */
export function accessSummary(input: {
  readonly route: Pick<ActionableRoute, "person" | "phoneClass" | "department" | "departmentEvidence" | "responsibility"> | null;
  readonly commercialContactNamed: boolean;
  readonly activities: readonly ActivityRecord[];
  readonly usableWorkerReferral: boolean;
}): AccessSummary {
  const factors: AccessFactor[] = [];
  const route = input.route;
  if (route && (route.departmentEvidence || route.phoneClass !== "E_NOT_FOUND")) factors.push("DEPARTMENTAL_ROUTE");
  if (route?.person || input.commercialContactNamed) factors.push("NAMED_CONTACT");
  if (route && ["A_DIRECT", "B_EXTENSION"].includes(route.phoneClass) && route.person) factors.push("ATTRIBUTABLE_CHANNEL");
  if (input.usableWorkerReferral) factors.push("WORKER_REFERRAL");
  if (input.activities.some((a) => a.accessChannel === "EXISTING_RELATIONSHIP")) factors.push("EXISTING_RELATIONSHIP");
  if (input.activities.some((a) => stageOfActivity(a) && ["CONVERSATION", "STAFF_REQUEST"].includes(stageOfActivity(a)!))) factors.push("HUMAN_CONVERSATION");
  if (route?.responsibility?.kind === "HUMAN" || input.activities.some((a) => a.handlesExternalWorkforce === "YES")) factors.push("CONFIRMED_COMMERCIAL_RESPONSIBILITY");
  const level: AccessLevel = factors.some((f) => ["EXISTING_RELATIONSHIP", "HUMAN_CONVERSATION", "CONFIRMED_COMMERCIAL_RESPONSIBILITY"].includes(f)) ? "RELATIONSHIP"
    : factors.some((f) => ["NAMED_CONTACT", "ATTRIBUTABLE_CHANNEL", "WORKER_REFERRAL"].includes(f)) ? "NAMED"
    : factors.length ? "ROUTE" : "NONE";
  return { level, factors };
}

export type FitLevel = "UNKNOWN" | "NOT_EVALUATED" | "COVERABLE" | "PARTIAL" | "NOT_COVERED";
export interface FitSummary { readonly level: FitLevel; readonly requested: number | null; readonly strong: number; readonly possible: number }
/**
 * FIT: can the existing workforce potentially cover a STRUCTURED staff request, per the existing matching results.
 * Without a staff request FIT is UNKNOWN — it is never estimated from general workforce size.
 */
export function fitSummary(staffRequests: readonly { readonly headcount: number | null; readonly counts: DemandMatchCounts | null }[]): FitSummary {
  if (!staffRequests.length) return { level: "UNKNOWN", requested: null, strong: 0, possible: 0 };
  const evaluated = staffRequests.filter((r) => r.counts);
  if (!evaluated.length) return { level: "NOT_EVALUATED", requested: sumKnown(staffRequests.map((r) => r.headcount)), strong: 0, possible: 0 };
  const strong = evaluated.reduce((n, r) => n + r.counts!.STRONG_MATCH, 0);
  const possible = evaluated.reduce((n, r) => n + r.counts!.POSSIBLE_MATCH, 0);
  const requested = sumKnown(staffRequests.map((r) => r.headcount));
  const level: FitLevel = strong === 0 && possible === 0 ? "NOT_COVERED" : requested !== null && strong >= requested ? "COVERABLE" : "PARTIAL";
  return { level, requested, strong, possible };
}
const sumKnown = (values: readonly (number | null)[]) => (values.every((v) => v !== null) ? values.reduce<number>((n, v) => n + (v ?? 0), 0) : null);

// ---------------------------------------------------------------------------------------------------------
// Commercial truth: the four facts never inferred from one another

export interface CommercialTruth {
  readonly laborDemandEvidence: boolean;
  readonly externalLaborPurchasing: "CONFIRMED" | "DECLINED" | "VENDOR_REGISTRATION_REQUIRED" | "UNKNOWN";
  readonly conversationConfirmed: boolean;
  readonly staffRequest: boolean;
}
export function commercialTruth(input: { readonly painUsable: number; readonly demandSignals: number; readonly activities: readonly ActivityRecord[] }): CommercialTruth {
  const outcomes = [...input.activities].sort((a, b) => b.performedAt.localeCompare(a.performedAt)).map((a) => a.outcome);
  const purchasing = outcomes.find((o) => o === "ACCEPTS_EXTERNAL_LABOR" || o === "DOES_NOT_ACCEPT_EXTERNAL_LABOR" || o === "VENDOR_REGISTRATION_REQUIRED" || o === "STAFF_REQUEST");
  // An explicit request to Fly for people is itself human evidence of buying external labor from Fly.
  const requested = input.activities.some((a) => Boolean(a.staffRequestDemandSignalId));
  return {
    laborDemandEvidence: input.painUsable > 0 || input.demandSignals > 0,
    externalLaborPurchasing: requested || purchasing === "ACCEPTS_EXTERNAL_LABOR" || purchasing === "STAFF_REQUEST" ? "CONFIRMED"
      : purchasing === "DOES_NOT_ACCEPT_EXTERNAL_LABOR" ? "DECLINED" : purchasing === "VENDOR_REGISTRATION_REQUIRED" ? "VENDOR_REGISTRATION_REQUIRED" : "UNKNOWN",
    conversationConfirmed: input.activities.some((a) => { const s = stageOfActivity(a); return s !== null && s !== "FIRST_TOUCH" && s !== "RESULT"; }),
    staffRequest: input.activities.some((a) => Boolean(a.staffRequestDemandSignalId)),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Commercial learning (data collection for the 30-day window; no weighting, no automatic source pausing)

export interface LearningCounts {
  readonly pursued: number;
  readonly firstTouches: number;
  readonly conversations: number;
  readonly externalLaborConfirmed: number;
  readonly staffRequests: number;
  readonly proposals: number;
  readonly presentations: number;
  readonly results: Readonly<Record<PursuitResult, number>>;
  readonly byChannel: Readonly<Record<string, { readonly touches: number; readonly conversations: number; readonly staffRequests: number }>>;
  readonly byOutcome: Readonly<Record<string, number>>;
  readonly byOffer: Readonly<Record<string, { readonly opportunities: number; readonly conversations: number; readonly staffRequests: number }>>;
  readonly nextActions: { readonly open: number; readonly overdue: number };
}
export function learningCounts(pursuits: readonly { readonly activities: readonly ActivityRecord[] }[], window: { readonly from: string; readonly to: string }, today: string): LearningCounts {
  const inWindow = (a: ActivityRecord) => a.performedAt.slice(0, 10) >= window.from && a.performedAt.slice(0, 10) <= window.to;
  const results: Record<PursuitResult, number> = { WON: 0, LOST: 0, NO_DECISION: 0 };
  const byChannel: Record<string, { touches: number; conversations: number; staffRequests: number }> = {};
  const byOutcome: Record<string, number> = {};
  const byOffer: Record<string, { opportunities: number; conversations: number; staffRequests: number }> = {};
  let pursued = 0, firstTouches = 0, conversations = 0, externalLaborConfirmed = 0, staffRequests = 0, proposals = 0, presentations = 0, open = 0, overdue = 0;
  for (const pursuit of pursuits) {
    const acts = pursuit.activities.filter(inWindow);
    if (!acts.length) continue;
    pursued += 1;
    const stages = acts.map(stageOfActivity);
    if (stages.some((s) => s && s !== "RESULT")) firstTouches += 1;
    const conversed = stages.some((s) => s === "CONVERSATION" || s === "STAFF_REQUEST");
    if (conversed) conversations += 1;
    if (acts.some((a) => a.outcome === "ACCEPTS_EXTERNAL_LABOR" || a.handlesExternalWorkforce === "YES")) externalLaborConfirmed += 1;
    const requested = acts.some((a) => a.staffRequestDemandSignalId);
    if (requested) staffRequests += 1;
    if (stages.includes("PROPOSAL")) proposals += 1;
    if (stages.includes("PRESENTATION")) presentations += 1;
    for (const a of acts) {
      if (a.result) results[a.result] += 1;
      if (a.outcome) byOutcome[a.outcome] = (byOutcome[a.outcome] ?? 0) + 1;
      if (a.accessChannel && CONTACT_TYPES.includes(a.activityType)) {
        const c = byChannel[a.accessChannel] ??= { touches: 0, conversations: 0, staffRequests: 0 };
        c.touches += 1;
        const s = stageOfActivity(a);
        if (s === "CONVERSATION" || s === "STAFF_REQUEST") c.conversations += 1;
        if (s === "STAFF_REQUEST") c.staffRequests += 1;
      }
    }
    for (const offer of new Set(acts.map((a) => a.offerHypothesis).filter((o): o is OfferHypothesis => Boolean(o)))) {
      const o = byOffer[offer] ??= { opportunities: 0, conversations: 0, staffRequests: 0 };
      o.opportunities += 1; if (conversed) o.conversations += 1; if (requested) o.staffRequests += 1;
    }
    const next = currentNextAction(pursuit.activities, today);
    if (next) { open += 1; if (next.overdue) overdue += 1; }
  }
  return { pursued, firstTouches, conversations, externalLaborConfirmed, staffRequests, proposals, presentations, results, byChannel, byOutcome, byOffer, nextActions: { open, overdue } };
}
