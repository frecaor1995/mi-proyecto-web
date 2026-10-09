/**
 * Recipe 2.1 daily operation: where each recorded posting is in
 * Register → Review → Verify → Possible client → Contact → Follow-up, and the next safe human action.
 * Pure and evidence-only: every stage comes from a stored human decision; nothing advances by itself.
 */

export type PostingReviewDecision = "VERIFIED" | "NEEDS_REVIEW" | "REJECTED";
export type CompanyOutcome = "LINK" | "CREATE" | "DEFER" | "REJECT_MATCH" | "UNSUPPORTED" | "NOT_ACTIONABLE" | "KEEP_UNRESOLVED";
export type DemandDecision = "VERIFY" | "REJECT" | "DEFER";

export interface PostingDecisions {
  readonly postingReview: PostingReviewDecision | null;
  readonly companyOutcome: CompanyOutcome | null;
  readonly companyId: string | null;
  readonly demandDecision: DemandDecision | null;
}

export type PostingNextAction =
  | "VERIFY_POSTING" | "RECHECK_POSTING" | "CONFIRM_COMPANY" | "DECIDE_DEMAND" | "EVALUATE_CLIENT_AND_CONTACT"
  | "CLOSED_POSTING_REJECTED" | "CLOSED_COMPANY_UNSUPPORTED" | "CLOSED_NO_DOCUMENTED_DEMAND" | "SUPERSEDED_BY_NEWER_OBSERVATION";

export type PostingStage = "REGISTERED" | "POSTING_VERIFIED" | "COMPANY_CONFIRMED" | "DEMAND_VERIFIED" | "CLOSED" | "SUPERSEDED";

const CLOSING_COMPANY: readonly CompanyOutcome[] = ["UNSUPPORTED", "NOT_ACTIONABLE"];

/**
 * Decisions are per observation: a re-observed posting (same identity, new date) starts again at REGISTERED and an
 * earlier observation's verification never counts for the new one (`superseded` marks the older observations).
 */
export function postingProgress(d: PostingDecisions, options: { readonly superseded?: boolean } = {}): { readonly stage: PostingStage; readonly next: PostingNextAction; readonly open: boolean } {
  if (options.superseded) return { stage: "SUPERSEDED", next: "SUPERSEDED_BY_NEWER_OBSERVATION", open: false };
  if (d.postingReview === "REJECTED") return { stage: "CLOSED", next: "CLOSED_POSTING_REJECTED", open: false };
  if (d.postingReview !== "VERIFIED") return { stage: "REGISTERED", next: d.postingReview === "NEEDS_REVIEW" ? "RECHECK_POSTING" : "VERIFY_POSTING", open: true };
  if (!d.companyId) {
    if (d.companyOutcome && CLOSING_COMPANY.includes(d.companyOutcome)) return { stage: "CLOSED", next: "CLOSED_COMPANY_UNSUPPORTED", open: false };
    return { stage: "POSTING_VERIFIED", next: "CONFIRM_COMPANY", open: true };
  }
  if (d.demandDecision === "REJECT") return { stage: "CLOSED", next: "CLOSED_NO_DOCUMENTED_DEMAND", open: false };
  if (d.demandDecision !== "VERIFY") return { stage: "COMPANY_CONFIRMED", next: "DECIDE_DEMAND", open: true };
  return { stage: "DEMAND_VERIFIED", next: "EVALUATE_CLIENT_AND_CONTACT", open: true };
}

/** Earlier stages first, then the oldest observation: the posting that most needs a human today. */
const ORDER: readonly PostingNextAction[] = ["VERIFY_POSTING", "RECHECK_POSTING", "CONFIRM_COMPANY", "DECIDE_DEMAND", "EVALUATE_CLIENT_AND_CONTACT"];
export function nextPostingToWork<T extends { readonly next: PostingNextAction; readonly capturedAt: string }>(items: readonly T[]): T | null {
  return [...items].filter((item) => ORDER.includes(item.next))
    .sort((a, b) => ORDER.indexOf(a.next) - ORDER.indexOf(b.next) || a.capturedAt.localeCompare(b.capturedAt))[0] ?? null;
}

export const asPostingReview = (value: unknown): PostingReviewDecision | null => (value === "VERIFIED" || value === "NEEDS_REVIEW" || value === "REJECTED" ? value : null);
export const asCompanyOutcome = (value: unknown): CompanyOutcome | null =>
  (["LINK", "CREATE", "DEFER", "REJECT_MATCH", "UNSUPPORTED", "NOT_ACTIONABLE", "KEEP_UNRESOLVED"] as const).find((o) => o === value) ?? null;
export const asDemandDecision = (value: unknown): DemandDecision | null => (value === "VERIFY" || value === "REJECT" || value === "DEFER" ? value : null);

/** Fields compared between consecutive observations of the same posting; any difference is shown to the reviewer. */
export const COMPARED_POSTING_FIELDS = ["title", "employerName", "location", "experience", "licenses", "compensation", "evidenceExcerpt", "externalPostingId"] as const;
export type ComparedPostingField = (typeof COMPARED_POSTING_FIELDS)[number];
export function postingEvidenceChanges(previous: Readonly<Record<string, unknown>>, current: Readonly<Record<string, unknown>>): readonly ComparedPostingField[] {
  const norm = (value: unknown) => JSON.stringify(Array.isArray(value) ? value.map(String) : value ?? null);
  return COMPARED_POSTING_FIELDS.filter((field) => norm(previous[field]) !== norm(current[field]));
}

/** Calendar day (YYYY-MM-DD) of an instant in the Houston operating timezone. */
export const houstonDay = (value: string | Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

/**
 * Daily goal (Recipe 2.2): NEW real postings registered on `day` — a posting identity counts only on the day of its
 * first observation. Re-observations, corrected links and DEMO records never count; duplicates create no observation.
 */
export function newPostingsRegisteredOn<T extends { readonly identity: string; readonly recordedAt: string; readonly dataClass: string }>(observations: readonly T[], day: string): readonly T[] {
  const first = new Map<string, T>();
  for (const o of [...observations].filter((x) => x.dataClass !== "DEMO").sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) if (!first.has(o.identity)) first.set(o.identity, o);
  return [...first.values()].filter((o) => houstonDay(o.recordedAt) === day);
}
