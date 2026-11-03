/**
 * Recipe 2.2 — "Does the company use external suppliers or agencies to hire electrical staff?"
 *
 * A human answer recorded in the Phase 3A commercial flow. It is evidence about one company only:
 *  - YES backed by a verifiable reference can feed the EXPLICIT_EXTERNAL_NEED commercial signal (possible client);
 *  - NO never removes the company; OWN_AGENCY_ONLY lowers only that company's B2B priority;
 *  - NO_RESPONSE keeps the investigation open; NOT_INVESTIGATED is the state when nothing was asked yet.
 * No answer ever creates a client, an opportunity, a contact or a staff request.
 */

export const SUPPLIER_ANSWERS = ["YES", "NO", "OWN_AGENCY_ONLY", "NO_RESPONSE", "NOT_INVESTIGATED"] as const;
export type SupplierAnswer = (typeof SUPPLIER_ANSWERS)[number];
export const SUPPLIER_CHANNELS = ["CALL", "EMAIL", "MEETING", "JOBSITE_VISIT", "WORKER_REFERRAL", "INBOUND", "OTHER"] as const;
export type SupplierChannel = (typeof SUPPLIER_CHANNELS)[number];

export const SUPPLIER_ANSWER_LIMITS = { name: 200, role: 200, summary: 1000, evidence: 500, nextAction: 300 } as const;

export interface SupplierAnswerInput {
  readonly answer: string;
  /** Catalog key (e.g. "enterprise") and/or canonical company id; at least one is required. */
  readonly catalogKey: string | null;
  readonly companyId: string | null;
  readonly companyName: string;
  readonly conversationDate: string | null;
  readonly responderName: string | null;
  readonly responderRole: string | null;
  readonly channel: string | null;
  readonly summary: string | null;
  readonly evidenceReference: string | null;
  readonly nextAction: string | null;
}

export type SupplierAnswerErrors = Partial<Record<keyof SupplierAnswerInput | "subject", string>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const tooLong = (value: string | null, max: number) => Boolean(value && value.length > max);

export function validateSupplierAnswer(input: SupplierAnswerInput, now: Date): SupplierAnswerErrors {
  const errors: SupplierAnswerErrors = {};
  if (!SUPPLIER_ANSWERS.includes(input.answer as SupplierAnswer)) errors.answer = "invalid";
  if (!input.catalogKey && !input.companyId) errors.subject = "required";
  if (!input.companyName.trim()) errors.companyName = "required";
  if (input.answer !== "NOT_INVESTIGATED") {
    // something was actually asked: when, how and what was said must be recorded
    if (!input.conversationDate || !DATE.test(input.conversationDate)) errors.conversationDate = "required";
    else if (new Date(`${input.conversationDate}T00:00:00Z`).getTime() > now.getTime() + 86_400_000) errors.conversationDate = "future";
    if (!input.channel || !SUPPLIER_CHANNELS.includes(input.channel as SupplierChannel)) errors.channel = "required";
    if (!input.summary?.trim()) errors.summary = "required";
  }
  if (input.answer === "YES" && !input.evidenceReference?.trim()) errors.evidenceReference = "requiredForYes";
  if (!input.nextAction?.trim()) errors.nextAction = "required";
  if (tooLong(input.responderName, SUPPLIER_ANSWER_LIMITS.name)) errors.responderName = "tooLong";
  if (tooLong(input.responderRole, SUPPLIER_ANSWER_LIMITS.role)) errors.responderRole = "tooLong";
  if (tooLong(input.summary, SUPPLIER_ANSWER_LIMITS.summary)) errors.summary = "tooLong";
  if (tooLong(input.evidenceReference, SUPPLIER_ANSWER_LIMITS.evidence)) errors.evidenceReference = "tooLong";
  if (tooLong(input.nextAction, SUPPLIER_ANSWER_LIMITS.nextAction)) errors.nextAction = "tooLong";
  return errors;
}

export interface RecordedSupplierAnswer {
  readonly evidenceId: string;
  readonly answer: SupplierAnswer;
  readonly catalogKey: string | null;
  readonly companyId: string | null;
  readonly companyName: string;
  readonly conversationDate: string | null;
  readonly responderName: string | null;
  readonly responderRole: string | null;
  readonly channel: string | null;
  readonly summary: string | null;
  readonly evidenceReference: string | null;
  readonly nextAction: string | null;
  readonly recordedByOperatorId: string;
  readonly recordedBy: string | null;
  readonly recordedAt: string;
}

/** What the latest answer means for one company (never for any other company). */
export function supplierAnswerEffect(latest: RecordedSupplierAnswer | null): {
  readonly state: SupplierAnswer;
  readonly commercialSignal: boolean;
  readonly b2bPriority: "RAISED_BY_EVIDENCE" | "UNCHANGED" | "LOWERED_OWN_AGENCY";
  readonly investigationOpen: boolean;
} {
  if (!latest) return { state: "NOT_INVESTIGATED", commercialSignal: false, b2bPriority: "UNCHANGED", investigationOpen: true };
  switch (latest.answer) {
    case "YES": return { state: "YES", commercialSignal: Boolean(latest.evidenceReference?.trim()), b2bPriority: latest.evidenceReference?.trim() ? "RAISED_BY_EVIDENCE" : "UNCHANGED", investigationOpen: false };
    case "NO": return { state: "NO", commercialSignal: false, b2bPriority: "UNCHANGED", investigationOpen: false };
    case "OWN_AGENCY_ONLY": return { state: "OWN_AGENCY_ONLY", commercialSignal: false, b2bPriority: "LOWERED_OWN_AGENCY", investigationOpen: false };
    case "NO_RESPONSE": return { state: "NO_RESPONSE", commercialSignal: false, b2bPriority: "UNCHANGED", investigationOpen: true };
    default: return { state: "NOT_INVESTIGATED", commercialSignal: false, b2bPriority: "UNCHANGED", investigationOpen: true };
  }
}

/** Latest answer first: recorded order, then evidence id for a stable tie-break. */
export const latestSupplierAnswer = (answers: readonly RecordedSupplierAnswer[]) =>
  [...answers].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.evidenceId.localeCompare(a.evidenceId))[0] ?? null;
