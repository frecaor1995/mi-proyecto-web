/**
 * Contact Intelligence — company contact desk (pure).
 *
 * 1. Corporate channels without a person: a published company phone or email (e.g. a branch office line), stored in
 *    contact_routes with the official source as evidence. It is never presented as a buyer's personal channel nor as a
 *    confirmed supplier channel.
 * 2. Company-level calls: recorded against the company (optionally the channel used), with a call outcome, an optional
 *    counterpart and the external-supplier answer. Never a fabricated contact candidate or opportunity.
 * 3. Company next actions: action, due date and owner.
 * DEMO records carry a durable is_demo marker and never count as real activity, conversion, request or result.
 */

export const CORPORATE_CHANNEL_TYPES = ["CORPORATE_PHONE", "OFFICE_PHONE", "CORPORATE_EMAIL", "PROCUREMENT_PHONE", "PROCUREMENT_EMAIL"] as const;
export type CorporateChannelType = (typeof CORPORATE_CHANNEL_TYPES)[number];
export const CALL_OUTCOMES = ["REACHED", "NO_ANSWER", "VOICEMAIL", "GATEKEEPER", "WRONG_NUMBER", "CALL_BACK_REQUESTED", "NOT_CALLED"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const CALL_SUPPLIER_ANSWERS = ["YES", "NO", "OWN_AGENCY_ONLY", "UNKNOWN", "NOT_ASKED"] as const;
export type CallSupplierAnswer = (typeof CALL_SUPPLIER_ANSWERS)[number];

export const DESK_LIMITS = { target: 200, sourceNote: 500, name: 200, role: 200, notes: 4000, action: 1000 } as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isPhoneType = (t: CorporateChannelType) => t.endsWith("_PHONE");
const trim = (v: string | null | undefined) => (v ?? "").trim();

/** US-oriented normalization: digits only, leading country code 1 kept explicit ("+1XXXXXXXXXX"). */
export function normalizeCorporatePhone(value: string): string | null {
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
export const normalizeCorporateEmail = (value: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null);

export interface CorporateChannelInput {
  readonly companyId: string;
  readonly routeType: string;
  readonly value: string;
  readonly sourceUrl: string;
  readonly observedOn: string;
  readonly locationLabel: string | null;
  readonly sourceNote: string | null;
}

export function validateCorporateChannel(input: CorporateChannelInput, now: Date): Record<string, string> {
  const errors: Record<string, string> = {};
  const type = CORPORATE_CHANNEL_TYPES.find((t) => t === input.routeType);
  if (!type) errors.routeType = "invalid";
  else if (isPhoneType(type) ? !normalizeCorporatePhone(input.value) : !normalizeCorporateEmail(input.value)) errors.value = isPhoneType(type) ? "invalidPhone" : "invalidEmail";
  try { if (new URL(input.sourceUrl).protocol !== "https:") errors.sourceUrl = "httpsRequired"; } catch { errors.sourceUrl = "httpsRequired"; }
  if (!DATE.test(input.observedOn)) errors.observedOn = "invalidDate";
  else if (input.observedOn > new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)) errors.observedOn = "future";
  if (trim(input.locationLabel).length > DESK_LIMITS.name) errors.locationLabel = "tooLong";
  if (trim(input.sourceNote).length > DESK_LIMITS.sourceNote) errors.sourceNote = "tooLong";
  return errors;
}

export interface CompanyCallInput {
  readonly companyId: string;
  readonly contactRouteId: string | null;
  readonly contactDate: string;
  readonly callOutcome: string;
  readonly supplierAnswer: string;
  readonly counterpartName: string | null;
  readonly counterpartRole: string | null;
  readonly notes: string | null;
  readonly isDemo: boolean;
}

export function validateCompanyCall(input: CompanyCallInput, now: Date): Record<string, string> {
  const errors: Record<string, string> = {};
  const outcome = CALL_OUTCOMES.find((o) => o === input.callOutcome);
  if (!outcome) errors.callOutcome = "invalid";
  if (!CALL_SUPPLIER_ANSWERS.includes(input.supplierAnswer as CallSupplierAnswer)) errors.supplierAnswer = "invalid";
  if (!DATE.test(input.contactDate)) errors.contactDate = "invalidDate";
  else if (input.contactDate > new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)) errors.contactDate = "future";
  // a real record is a call that happened: NOT_CALLED is only meaningful for an interface test (DEMO)
  if (!input.isDemo && outcome === "NOT_CALLED") errors.callOutcome = "notCalledOnlyForDemo";
  // an answer about suppliers needs someone who answered
  if (outcome && outcome !== "REACHED" && input.supplierAnswer !== "NOT_ASKED" && input.supplierAnswer !== "UNKNOWN") errors.supplierAnswer = "answerNeedsReachedCall";
  if (input.isDemo && !/\b(DEMO|PRUEBA|TEST)\b/i.test(trim(input.notes))) errors.notes = "demoNotesMustSayDemo";
  if (trim(input.counterpartName).length > DESK_LIMITS.name) errors.counterpartName = "tooLong";
  if (trim(input.counterpartRole).length > DESK_LIMITS.role) errors.counterpartRole = "tooLong";
  if (trim(input.notes).length > DESK_LIMITS.notes) errors.notes = "tooLong";
  return errors;
}

export interface NextActionInput {
  readonly companyId: string;
  readonly action: string;
  readonly dueDate: string;
  readonly ownerOperatorId: string;
  readonly isDemo: boolean;
}

export function validateNextAction(input: NextActionInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const action = trim(input.action);
  if (!action) errors.action = "required"; else if (action.length > DESK_LIMITS.action) errors.action = "tooLong";
  if (!DATE.test(input.dueDate)) errors.dueDate = "invalidDate";
  if (!/^[0-9a-f-]{36}$/i.test(input.ownerOperatorId)) errors.ownerOperatorId = "required";
  if (input.isDemo && !/\b(DEMO|PRUEBA|TEST)\b/i.test(action)) errors.action = "demoActionMustSayDemo";
  return errors;
}

/** Pending today = open and due on or before the given day. DEMO items are listed apart and never counted as real. */
export function isPendingOn(item: { readonly status: string; readonly dueDate: string }, day: string) {
  return item.status === "OPEN" && item.dueDate <= day;
}

/** Call answer → the Phase 2.2 supplier-answer vocabulary used by the staffing priority (UNKNOWN ≈ no clear answer). */
export function supplierAnswerFromCall(answer: CallSupplierAnswer): "YES" | "NO" | "OWN_AGENCY_ONLY" | "NO_RESPONSE" | null {
  return answer === "YES" || answer === "NO" || answer === "OWN_AGENCY_ONLY" ? answer : answer === "UNKNOWN" ? "NO_RESPONSE" : null;
}
