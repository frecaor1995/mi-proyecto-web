import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { postingEvidenceChanges, type ComparedPostingField, type PostingReviewDecision } from "../../domain/posting-workflow";
import { CLOSING_LINK_CATEGORIES, LINK_ISSUE_CATEGORIES, decodeLinkNote, encodeLinkNote, type LinkIssueCategory } from "../../domain/ats-url-hygiene";
import { classifyPostingLevel, type PostingLevelClass } from "../../domain/posting-level";

/**
 * Recipe 2.1 step 1 — "verify the posting": an operator opens the official posting and records whether it exists and
 * matches what was registered. Stored append-only in discovery_signal_reviews (VERIFIED / NEEDS_REVIEW / REJECTED; a
 * verification needs a note). It never resolves a company, verifies demand or promotes anything: those stay separate
 * governed decisions in the company → demand → promotion workbench.
 *
 * Decisions are per observation (candidate). A re-observed posting (same identity, new date) is linked to its earlier
 * observations, whose decisions stay visible as immutable history but never count as the current verification:
 * every new observation requires its own review, and only the latest observation of a posting can be reviewed.
 */
export const POSTING_REVIEW_DECISIONS: readonly PostingReviewDecision[] = ["VERIFIED", "NEEDS_REVIEW", "REJECTED"];

export class PostingVerificationError extends Error {
  constructor(readonly code: "invalid" | "noteRequired" | "notRecipePosting" | "supersededObservation" | "notEnoughToClose" | "categoryNotForVerified") { super(code); }
}

export interface PostingDecisionRecord { readonly decision: string; readonly note: string | null; readonly linkCategory: LinkIssueCategory | null; readonly decidedAt: string; readonly decidedBy: string | null }

export interface UrlCorrectionRecord { readonly previousCandidateId: string; readonly previousUrl: string; readonly reason: string; readonly rule: string | null }

export interface LinkedObservation {
  readonly candidateId: string;
  readonly observationId: string;
  readonly capturedAt: string;
  readonly observedOn: string | null;
  readonly sourceUrl: string;
  readonly urlCorrection: UrlCorrectionRecord | null;
  readonly current: boolean;
  readonly latest: boolean;
  readonly postingDecision: string | null;
  readonly companyOutcome: string | null;
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly demandDecision: string | null;
}

export interface RecordedPosting {
  readonly candidateId: string;
  readonly evidenceId: string;
  readonly identity: string | null;
  readonly normalizedUrl: string;
  readonly sourceUrl: string;
  readonly provenance: "AUTOMATED_HTTP" | "ASSISTED_MANUAL" | "EMAIL_ALERT";
  readonly dataClass: "REAL" | "DEMO";
  readonly employerName: string | null;
  readonly title: string | null;
  readonly location: string | null;
  readonly experience: string | null;
  readonly licenses: readonly string[];
  readonly compensation: string | null;
  readonly externalPostingId: string | null;
  readonly observedOn: string | null;
  readonly recordedAt: string;
  readonly summary: string | null;
  readonly emailAlert: { readonly sender: string; readonly receivedOn: string; readonly alertReference: string } | null;
  /** Posting decisions recorded for THIS observation (newest first). Only these can make it verified. */
  readonly verifications: readonly PostingDecisionRecord[];
  /** Every observation of the same posting identity, oldest first, with its own decisions (immutable history). */
  readonly linkedObservations: readonly LinkedObservation[];
  /** True when a newer observation of the same posting exists: this one is history and cannot be reviewed. */
  readonly superseded: boolean;
  /** Fields that differ from the previous observation (null when this is the first observation). */
  readonly changesFromPrevious: readonly ComparedPostingField[] | null;
  /** Set when this observation records a corrected official URL for an earlier observation (Recipe 2.2). */
  readonly urlCorrection: UrlCorrectionRecord | null;
  /** Level from what the posting states (not from the word "Apprentice" alone). */
  readonly levelClass: PostingLevelClass;
}

const str = (value: unknown) => (value == null || value === "" ? null : String(value));
const iso = (value: string | Date) => new Date(value).toISOString();
const correctionOf = (value: unknown): UrlCorrectionRecord | null => {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  return c.previousCandidateId ? { previousCandidateId: String(c.previousCandidateId), previousUrl: String(c.previousUrl ?? ""), reason: String(c.reason ?? ""), rule: str(c.rule) } : null;
};

async function decisionsFor(db: SqlClient, candidateId: string) {
  return (await db.query<{ decision: string; note: string | null; decided_at: string | Date; display: string | null }>(
    `select r.decision,r.note,r.decided_at,coalesce(o.display_name,o.email) display from discovery_signal_reviews r
       left join workforce_operators o on o.id=r.decided_by_operator_id
      where r.candidate_id=$1 and r.decision<>'PROMOTED' order by r.decided_at desc,r.id desc`, [candidateId])).rows
    .map((r) => { const decoded = decodeLinkNote(r.note); return { decision: r.decision, note: decoded.note, linkCategory: decoded.category, decidedAt: iso(r.decided_at), decidedBy: r.display }; });
}

/** The posting exactly as recorded (canonical evidence of a Recipe 1.1/2.x candidate), its own decisions and its linked observations. */
export async function loadRecordedPosting(db: SqlClient, candidateId: string): Promise<RecordedPosting | null> {
  const row = (await db.query<{ evidence_id: string; source_url: string; captured_at: string | Date; metadata: Record<string, unknown>; normalized_candidate_url: string; excerpt: string | null }>(
    `select e.id evidence_id,e.source_url,e.captured_at,e.metadata,c.normalized_candidate_url,c.provider_description excerpt
       from company_discovery_candidates c join raw_evidence e on e.id=c.canonical_evidence_id
      where c.id=$1 and e.metadata->>'recipe11'='true'`, [candidateId])).rows[0];
  if (!row) return null;
  const metadata = row.metadata ?? {};
  const posting = (metadata.posting ?? {}) as Record<string, unknown>;
  const alert = metadata.emailAlert && typeof metadata.emailAlert === "object" ? metadata.emailAlert as Record<string, unknown> : null;
  const identity = str(metadata.postingIdentity);
  const linkedRows = identity ? (await db.query<{ candidate_id: string; observation_id: string; captured_at: string | Date; observed_on: string | null; posting: Record<string, unknown> | null; source_url: string; url_correction: unknown;
    posting_decision: string | null; company_outcome: string | null; company_id: string | null; company_name: string | null; demand_decision: string | null }>(
    `select o.candidate_id,o.id observation_id,o.captured_at,e.metadata->>'observedOn' observed_on,e.metadata->'posting' posting,e.source_url,e.metadata->'urlCorrection' url_correction,rv.decision posting_decision,
       ca.outcome company_outcome,ca.company_id,ca.company_name,dm.decision demand_decision
       from discovery_watch_observations o join raw_evidence e on e.id=o.evidence_id
       left join lateral(select r.decision from discovery_signal_reviews r where r.candidate_id=o.candidate_id and r.decision<>'PROMOTED' order by r.decided_at desc,r.id desc limit 1) rv on true
       left join lateral(select coalesce(a.confidence_metadata->>'operatorOutcome',a.result::text) outcome,a.candidate_company_id company_id,coalesce(co.common_name,co.legal_name) company_name
         from company_resolution_audits a left join companies co on co.id=a.candidate_company_id where a.discovery_watch_observation_id=o.id order by a.resolved_at desc,a.created_at desc,a.id desc limit 1) ca on true
       left join lateral(select h.decision::text decision from discovery_observation_demand_signals x join human_verification_decisions h on h.target_type='DEMAND_SIGNAL' and h.target_id=x.demand_signal_id
         where x.discovery_watch_observation_id=o.id order by h.decided_at desc,h.created_at desc limit 1) dm on true
      where o.observation_identity=$1 and o.candidate_id is not null order by o.captured_at,e.created_at,o.id`, [identity])).rows : [];
  const lastIndex = linkedRows.length - 1;
  const linkedObservations: LinkedObservation[] = linkedRows.map((r, index) => ({
    candidateId: r.candidate_id, observationId: r.observation_id, capturedAt: iso(r.captured_at), observedOn: r.observed_on, sourceUrl: r.source_url, urlCorrection: correctionOf(r.url_correction),
    current: r.candidate_id === candidateId, latest: index === lastIndex,
    postingDecision: r.posting_decision, companyOutcome: r.company_outcome, companyId: r.company_id, companyName: r.company_name, demandDecision: r.demand_decision,
  }));
  const currentIndex = linkedRows.findIndex((r) => r.candidate_id === candidateId);
  const previous = currentIndex > 0 ? linkedRows[currentIndex - 1].posting ?? {} : null;
  return {
    candidateId, evidenceId: row.evidence_id, identity, normalizedUrl: row.normalized_candidate_url, sourceUrl: row.source_url,
    provenance: metadata.provenance === "ASSISTED_MANUAL" || metadata.provenance === "EMAIL_ALERT" ? metadata.provenance : "AUTOMATED_HTTP",
    dataClass: metadata.dataClass === "DEMO" ? "DEMO" : "REAL",
    employerName: str(posting.employerName), title: str(posting.title), location: str(posting.location), experience: str(posting.experience),
    licenses: Array.isArray(posting.licenses) ? posting.licenses.map(String) : [], compensation: str(posting.compensation), externalPostingId: str(posting.externalPostingId),
    observedOn: str(metadata.observedOn), recordedAt: iso(String(metadata.recordedAt ?? row.captured_at)),
    summary: str(posting.evidenceExcerpt) ?? str(row.excerpt),
    emailAlert: alert ? { sender: String(alert.sender ?? ""), receivedOn: String(alert.receivedOn ?? ""), alertReference: String(alert.alertReference ?? "") } : null,
    verifications: await decisionsFor(db, candidateId),
    linkedObservations, superseded: currentIndex >= 0 && currentIndex < lastIndex,
    changesFromPrevious: previous ? postingEvidenceChanges(previous, posting) : null,
    urlCorrection: correctionOf(metadata.urlCorrection),
    levelClass: classifyPostingLevel({ title: str(posting.title), experience: str(posting.experience), licenses: Array.isArray(posting.licenses) ? posting.licenses.map(String) : null }),
  };
}

export async function recordPostingVerification(db: SqlClient, input: { candidateId: string; decision: string; note: string | null; linkCategory?: string | null; operatorId: string; now: Date }) {
  const decision = POSTING_REVIEW_DECISIONS.find((d) => d === input.decision);
  if (!decision) throw new PostingVerificationError("invalid");
  const category = input.linkCategory ? LINK_ISSUE_CATEGORIES.find((c) => c === input.linkCategory) ?? null : null;
  if (input.linkCategory && !category) throw new PostingVerificationError("invalid");
  const text = input.note?.trim().slice(0, 1900) || null;
  if (decision === "VERIFIED" && !text) throw new PostingVerificationError("noteRequired");
  if (decision === "VERIFIED" && category) throw new PostingVerificationError("categoryNotForVerified");
  // A broken or old link is not proof that the posting is gone: closing needs the official page to say it was withdrawn.
  if (decision === "REJECTED" && (!category || !CLOSING_LINK_CATEGORIES.includes(category))) throw new PostingVerificationError("notEnoughToClose");
  const note = encodeLinkNote(category, text);
  const posting = await loadRecordedPosting(db, input.candidateId);
  if (!posting) throw new PostingVerificationError("notRecipePosting");
  if (posting.superseded) throw new PostingVerificationError("supersededObservation");
  const inserted = await db.query<{ id: string }>(
    "insert into discovery_signal_reviews(normalized_candidate_url,candidate_id,decision,note,decided_by_operator_id,decided_at) values($1,$2,$3,$4,$5,$6) returning id",
    [posting.normalizedUrl, input.candidateId, decision, note, input.operatorId, input.now.toISOString()]);
  return { reviewId: inserted.rows[0].id, decision };
}

/**
 * Recorded postings must have a current verification of THIS observation (latest decision VERIFIED) before company,
 * demand or promotion decisions; a superseded observation is never reviewable. Other observations are unaffected.
 */
export async function postingVerificationGate(db: SqlClient, candidateId: string): Promise<"NOT_RECORDED_POSTING" | "VERIFIED" | "PENDING" | "SUPERSEDED"> {
  const row = (await db.query<{ identity: string | null; decision: string | null; newer: boolean }>(
    `select e.metadata->>'postingIdentity' identity,
       (select r.decision from discovery_signal_reviews r where r.candidate_id=c.id and r.decision<>'PROMOTED' order by r.decided_at desc,r.id desc limit 1) decision,
       exists(select 1 from discovery_watch_observations mine join discovery_watch_observations other on other.observation_identity=mine.observation_identity
         join raw_evidence me on me.id=mine.evidence_id join raw_evidence oe on oe.id=other.evidence_id
         and (other.captured_at,oe.created_at,other.id)>(mine.captured_at,me.created_at,mine.id) where mine.candidate_id=c.id) newer
       from company_discovery_candidates c join raw_evidence e on e.id=c.canonical_evidence_id where c.id=$1 and e.metadata->>'recipe11'='true'`, [candidateId])).rows[0];
  if (!row) return "NOT_RECORDED_POSTING";
  if (row.newer) return "SUPERSEDED";
  return row.decision === "VERIFIED" ? "VERIFIED" : "PENDING";
}
