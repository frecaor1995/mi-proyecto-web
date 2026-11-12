import type { FactKind } from "./project-signal-contract";
import type { SupplierAnswer } from "./external-supplier-answer";

/**
 * Staffing commercial intelligence — demand classification and explainable priority per company (pure).
 *
 * EXPLICIT    a documented, human-verified request for workers or suppliers (a staff request recorded in follow-up,
 *             or a verified inbound request).
 * INFERRED    evidence that suggests a possible need: verified postings, verified hiring demand, a linked project with a
 *             documented status, verified operational pain.
 * INSUFFICIENT_EVIDENCE  no basis to conclude there is demand for external staff.
 *
 * Mandatory rules: a direct-hire posting is not a request to Fly; an award does not confirm a labor shortage; the number
 * of workers is never derived from the number of postings; unknown fields stay unknown. A priority is not a promise.
 */

export type DemandClass = "EXPLICIT" | "INFERRED" | "INSUFFICIENT_EVIDENCE";
export type PriorityTier = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";

export interface ExplicitRequestEvidence {
  readonly kind: "STAFF_REQUEST" | "VERIFIED_INBOUND_REQUEST";
  readonly evidenceRef: string;
  readonly date: string;
  /** Headcount only when the request itself states it. */
  readonly headcount: number | null;
  readonly role: string | null;
}
export interface PostingEvidence {
  readonly identity: string;
  readonly title: string | null;
  readonly location: string | null;
  readonly observedAt: string;
  readonly postingVerified: boolean;
  readonly demandVerified: boolean;
  readonly directHire: boolean;
  readonly experience: string | null;
  readonly licenses: readonly string[];
  readonly compensation: string | null;
  readonly levelClass: string;
}
export interface ProjectEvidence {
  readonly evidenceId: string;
  readonly projectName: string | null;
  readonly stage: string;
  readonly contractStatus: { readonly value: string | null; readonly kind: FactKind };
  readonly startDate: { readonly value: string | null; readonly kind: FactKind };
  readonly duration: { readonly value: string | null; readonly kind: FactKind };
  readonly location: string | null;
  readonly trades: readonly string[];
  readonly observedAt: string;
  readonly linkConfirmed: boolean;
}
export interface PainEvidence { readonly type: string; readonly verified: boolean; readonly observedAt: string; readonly summary: string }

export interface CompanyStaffingEvidence {
  readonly explicitRequests: readonly ExplicitRequestEvidence[];
  readonly postings: readonly PostingEvidence[];
  readonly projects: readonly ProjectEvidence[];
  readonly pains: readonly PainEvidence[];
}

export type RequirementKey = "trade" | "headcount" | "experience" | "licenses" | "location" | "start" | "duration" | "pay" | "hiringType" | "supplierAvailability";
export interface Requirement { readonly value: string | null; readonly origin: "EXPLICIT_REQUEST" | "VERIFIED_POSTING" | "PROJECT_OFFICIAL" | "PROJECT_ESTIMATED" | "SUPPLIER_ANSWER" | "UNKNOWN" }

export interface DemandAssessment {
  readonly demandClass: DemandClass;
  readonly reasons: readonly string[];
  /** Rule notes that must be shown next to the classification (e.g. direct hire ≠ request to Fly). */
  readonly ruleNotes: readonly ("DIRECT_HIRE_NOT_A_REQUEST" | "AWARD_NOT_SHORTAGE" | "HEADCOUNT_NOT_FROM_POSTINGS")[];
  readonly requirements: Readonly<Record<RequirementKey, Requirement>>;
}

const unknown: Requirement = { value: null, origin: "UNKNOWN" };

export function classifyStaffingDemand(e: CompanyStaffingEvidence, supplierAnswer: SupplierAnswer | null): DemandAssessment {
  const reasons: string[] = [];
  const verifiedPostings = e.postings.filter((p) => p.postingVerified);
  const demandVerified = e.postings.filter((p) => p.demandVerified);
  const linkedProjects = e.projects.filter((p) => p.linkConfirmed);
  const verifiedPains = e.pains.filter((p) => p.verified);
  if (e.explicitRequests.length) reasons.push(`EXPLICIT_REQUEST:${e.explicitRequests.length}`);
  if (verifiedPostings.length) reasons.push(`VERIFIED_POSTINGS:${verifiedPostings.length}`);
  if (demandVerified.length) reasons.push(`VERIFIED_HIRING_DEMAND:${demandVerified.length}`);
  if (linkedProjects.length) reasons.push(`LINKED_PROJECTS:${linkedProjects.length}`);
  if (verifiedPains.length) reasons.push(`VERIFIED_PAIN:${verifiedPains.length}`);
  const demandClass: DemandClass = e.explicitRequests.length ? "EXPLICIT"
    : verifiedPostings.length || demandVerified.length || linkedProjects.length || verifiedPains.length ? "INFERRED" : "INSUFFICIENT_EVIDENCE";

  const ruleNotes: DemandAssessment["ruleNotes"][number][] = [];
  if (e.postings.some((p) => p.directHire)) ruleNotes.push("DIRECT_HIRE_NOT_A_REQUEST");
  if (e.projects.some((p) => p.stage === "AWARDEE")) ruleNotes.push("AWARD_NOT_SHORTAGE");
  if (e.postings.length) ruleNotes.push("HEADCOUNT_NOT_FROM_POSTINGS");

  const request = e.explicitRequests.find((r) => r.headcount !== null) ?? null;
  const posting = verifiedPostings[0] ?? null;
  const project = linkedProjects[0] ?? null;
  const fromProject = (f: { value: string | null; kind: FactKind } | undefined): Requirement =>
    f?.value ? { value: f.value, origin: f.kind === "OFFICIAL" ? "PROJECT_OFFICIAL" : "PROJECT_ESTIMATED" } : unknown;
  const requirements: Record<RequirementKey, Requirement> = {
    trade: e.explicitRequests[0]?.role ? { value: e.explicitRequests[0].role, origin: "EXPLICIT_REQUEST" } : posting?.title ? { value: posting.title, origin: "VERIFIED_POSTING" }
      : project?.trades.length ? { value: project.trades.join(", "), origin: "PROJECT_ESTIMATED" } : unknown,
    // never from the number of postings: only a request that states it
    headcount: request ? { value: String(request.headcount), origin: "EXPLICIT_REQUEST" } : unknown,
    experience: posting?.experience ? { value: posting.experience, origin: "VERIFIED_POSTING" } : unknown,
    licenses: posting?.licenses.length ? { value: posting.licenses.join(" · "), origin: "VERIFIED_POSTING" } : unknown,
    location: posting?.location ? { value: posting.location, origin: "VERIFIED_POSTING" } : project?.location ? { value: project.location, origin: "PROJECT_ESTIMATED" } : unknown,
    start: fromProject(project?.startDate),
    duration: fromProject(project?.duration),
    pay: posting?.compensation ? { value: posting.compensation, origin: "VERIFIED_POSTING" } : unknown,
    hiringType: posting?.directHire ? { value: "DIRECT_HIRE", origin: "VERIFIED_POSTING" } : unknown,
    supplierAvailability: supplierAnswer && supplierAnswer !== "NOT_INVESTIGATED" ? { value: supplierAnswer, origin: "SUPPLIER_ANSWER" } : unknown,
  };
  return { demandClass, reasons, ruleNotes, requirements };
}

export interface PriorityInput {
  readonly demand: DemandAssessment;
  readonly evidence: CompanyStaffingEvidence;
  readonly supplierAnswer: SupplierAnswer | null;
  readonly supplierAnswerHasEvidence: boolean;
  readonly manpowerAcceptance: "VERIFIED_POSITIVE" | "VERIFIED_NEGATIVE" | "OTHER" | null;
  readonly verifiableContacts: number;
  /** Active real workers in the trades involved (aggregate only, never names). */
  readonly networkWorkers: number;
  readonly lastEvidenceAt: string | null;
  readonly now: Date;
}

export type PriorityFactor = "NEED" | "ACTIVE_PROJECT" | "RECENT_VERIFIED_POSTINGS" | "REPETITION" | "NETWORK_FIT" | "SUPPLIER_ACCEPTANCE" | "VERIFIABLE_CONTACT" | "FRESHNESS";
export type NextStaffingAction =
  | "RUN_MATCHING_AND_PRESENT" | "VERIFY_POSTING" | "CONFIRM_PROJECT_LINK" | "ASK_EXTERNAL_SUPPLIERS" | "FIND_BUYER" | "CONTACT_COMPANY"
  | "COLLECT_EVIDENCE" | "FOLLOW_UP_NO_RESPONSE" | "DEPRIORITIZE_OWN_AGENCY";

export interface StaffingPriority {
  readonly tier: PriorityTier;
  readonly confirmed: readonly PriorityFactor[];
  readonly inferences: readonly PriorityFactor[];
  readonly missing: readonly PriorityFactor[];
  readonly negatives: readonly ("SUPPLIER_NO" | "OWN_AGENCY_ONLY" | "MANPOWER_NEGATIVE")[];
  readonly nextAction: NextStaffingAction;
}

const DAY = 86_400_000;

/** Explainable priority: a tier plus the factors behind it. Uses only available data; never proof of a future hire. */
export function staffingPriority(input: PriorityInput): StaffingPriority {
  const confirmed: PriorityFactor[] = [], inferences: PriorityFactor[] = [], missing: PriorityFactor[] = [];
  const negatives: StaffingPriority["negatives"][number][] = [];
  const { demand, evidence } = input;
  const recent = (iso: string) => input.now.getTime() - Date.parse(iso) <= 30 * DAY;

  if (demand.demandClass === "EXPLICIT") confirmed.push("NEED"); else if (demand.demandClass === "INFERRED") inferences.push("NEED"); else missing.push("NEED");
  const projects = evidence.projects.filter((p) => p.linkConfirmed && p.contractStatus.value);
  if (projects.some((p) => p.contractStatus.kind === "OFFICIAL")) confirmed.push("ACTIVE_PROJECT"); else if (projects.length) inferences.push("ACTIVE_PROJECT"); else missing.push("ACTIVE_PROJECT");
  const verified = evidence.postings.filter((p) => p.postingVerified);
  if (verified.some((p) => recent(p.observedAt))) confirmed.push("RECENT_VERIFIED_POSTINGS"); else if (evidence.postings.length) inferences.push("RECENT_VERIFIED_POSTINGS"); else missing.push("RECENT_VERIFIED_POSTINGS");
  const identities = new Set(evidence.postings.map((p) => p.identity));
  const span = evidence.postings.length ? Math.max(...evidence.postings.map((p) => Date.parse(p.observedAt))) - Math.min(...evidence.postings.map((p) => Date.parse(p.observedAt))) : 0;
  if (identities.size >= 2 || span >= 14 * DAY) inferences.push("REPETITION"); else missing.push("REPETITION");
  if (input.networkWorkers > 0 && demand.demandClass !== "INSUFFICIENT_EVIDENCE") inferences.push("NETWORK_FIT"); else missing.push("NETWORK_FIT");
  const supplierYes = input.supplierAnswer === "YES" && input.supplierAnswerHasEvidence;
  if (supplierYes || input.manpowerAcceptance === "VERIFIED_POSITIVE") confirmed.push("SUPPLIER_ACCEPTANCE");
  else missing.push("SUPPLIER_ACCEPTANCE");
  if (input.supplierAnswer === "NO") negatives.push("SUPPLIER_NO");
  if (input.supplierAnswer === "OWN_AGENCY_ONLY") negatives.push("OWN_AGENCY_ONLY");
  if (input.manpowerAcceptance === "VERIFIED_NEGATIVE") negatives.push("MANPOWER_NEGATIVE");
  if (input.verifiableContacts > 0) confirmed.push("VERIFIABLE_CONTACT"); else missing.push("VERIFIABLE_CONTACT");
  if (input.lastEvidenceAt && recent(input.lastEvidenceAt)) confirmed.push("FRESHNESS"); else missing.push("FRESHNESS");

  const acceptance = confirmed.includes("SUPPLIER_ACCEPTANCE");
  const contact = confirmed.includes("VERIFIABLE_CONTACT");
  let tier: PriorityTier;
  if (demand.demandClass === "EXPLICIT") tier = "HIGH";
  else if (demand.demandClass === "INFERRED") tier = acceptance && contact ? "HIGH" : acceptance || contact || confirmed.includes("ACTIVE_PROJECT") || inferences.includes("REPETITION") ? "MEDIUM" : "LOW";
  else tier = acceptance ? "LOW" : "INSUFFICIENT_DATA";
  // own agency only lowers this company's B2B priority one level (a NO keeps the company but never raises it)
  if (negatives.includes("OWN_AGENCY_ONLY") || negatives.includes("MANPOWER_NEGATIVE")) tier = tier === "HIGH" ? "MEDIUM" : tier === "MEDIUM" ? "LOW" : tier;

  const pendingPosting = evidence.postings.some((p) => !p.postingVerified);
  const pendingLink = evidence.projects.some((p) => !p.linkConfirmed);
  const nextAction: NextStaffingAction =
    demand.demandClass === "EXPLICIT" ? "RUN_MATCHING_AND_PRESENT"
    : negatives.includes("OWN_AGENCY_ONLY") ? "DEPRIORITIZE_OWN_AGENCY"
    : pendingPosting ? "VERIFY_POSTING"
    : pendingLink ? "CONFIRM_PROJECT_LINK"
    : input.supplierAnswer === "NO_RESPONSE" ? "FOLLOW_UP_NO_RESPONSE"
    : !input.supplierAnswer || input.supplierAnswer === "NOT_INVESTIGATED" ? (contact ? "ASK_EXTERNAL_SUPPLIERS" : "FIND_BUYER")
    : !contact ? "FIND_BUYER"
    : acceptance ? "CONTACT_COMPANY"
    : demand.demandClass === "INSUFFICIENT_EVIDENCE" ? "COLLECT_EVIDENCE" : "ASK_EXTERNAL_SUPPLIERS";
  return { tier, confirmed, inferences, missing, negatives, nextAction };
}

const TIER_ORDER: Record<PriorityTier, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, INSUFFICIENT_DATA: 3 };
export const comparePriority = (a: PriorityTier, b: PriorityTier) => TIER_ORDER[a] - TIER_ORDER[b];
