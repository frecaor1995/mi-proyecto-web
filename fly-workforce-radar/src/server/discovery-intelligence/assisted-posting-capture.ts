import { postingIdentity } from "../../domain/individual-posting-capture";
import { toAssistedPosting, validateAssistedPosting, type AssistedPostingInput } from "../../domain/assisted-posting-capture";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresSourceRepository } from "../repositories/source/postgres-source-repository";
import { persistIndividualPosting } from "./individual-posting-capture";

/** Same operator-recorded evidence source used by Commercial Intake and Phase 3A (created only if missing). */
const MANUAL_SOURCE_NAME = "Fly Workforce Radar manual commercial intake";

export type AssistedOutcome = "CREATED" | "RE_OBSERVED" | "DUPLICATE";
export class AssistedCaptureValidationError extends Error {
  constructor(readonly errors: Readonly<Record<string, string>>) { super(`Invalid assisted posting: ${Object.keys(errors).join(", ")}`); }
}

async function manualSourceId(db: SqlClient, at: Date) {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [MANUAL_SOURCE_NAME]);
  const sources = new PostgresSourceRepository(db);
  const source = await sources.findByName(MANUAL_SOURCE_NAME) ?? await sources.create({
    name: MANUAL_SOURCE_NAME, sourceType: "OTHER", accessClassification: "RESTRICTED", enabled: true, requiresAuth: true, paywalled: false,
    sourceMetadata: { purpose: "operator-recorded inbound commercial evidence" }, firstSeenAt: at, lastSeenAt: at,
  });
  return source.id;
}

/**
 * Records one operator-observed posting (ASSISTED_MANUAL or EMAIL_ALERT) through the shared persistence:
 * raw_evidence (MANUAL) → discovery candidate → dated observation → Human Review. The URL is never visited.
 * Same posting identity and same observation date → DUPLICATE (nothing new). Same identity on a new date → a new dated
 * observation (RE_OBSERVED), which is what the three-week repetition rule needs. Every submission is audited as a run.
 */
export async function recordAssistedPosting(db: SqlClient, input: AssistedPostingInput, operatorId: string, now = new Date()) {
  const errors = validateAssistedPosting(input, now);
  if (Object.keys(errors).length) throw new AssistedCaptureValidationError(errors);
  const { posting, platform, identitySource } = toAssistedPosting(input);
  const identity = postingIdentity(identitySource, posting.externalPostingId, posting.normalizedUrl);
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`assisted:${identity}`]);
  const runMetadata = { recipe: "RECIPE_2_0", step: "ASSISTED_CAPTURE", provenance: input.provenance, dataClass: input.dataClass, postingIdentity: identity, urlVisited: false };
  const run = (await db.query<{ id: string }>(
    `insert into company_discovery_runs(requested_by_operator_id,trigger_kind,target_text,normalized_target_text,started_at,correlation_metadata)
     values($1,'MANUAL',$2,$3,$4,$5::jsonb) returning id`,
    [operatorId, String(posting.employerName).slice(0, 300), String(posting.employerName).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 300) || `assisted capture ${identity.slice(0, 16)}`, now.toISOString(), JSON.stringify(runMetadata)])).rows[0];
  const sameDay = (await db.query<{ candidate_id: string | null }>(
    "select candidate_id from discovery_watch_observations where observation_identity=$1 and captured_at::date=$2::date order by captured_at limit 1",
    [identity, posting.capturedAt])).rows[0];
  const seenBefore = Number((await db.query<{ n: string }>("select count(*) n from discovery_watch_observations where observation_identity=$1", [identity])).rows[0].n) > 0;
  const finish = async (outcome: AssistedOutcome, findings: number, extra: Record<string, unknown>) => {
    await db.query("update company_discovery_runs set status='COMPLETED', completed_at=$2, findings_count=$3, evidence_count=$3, correlation_metadata=correlation_metadata || $4::jsonb where id=$1",
      [run.id, now.toISOString(), findings, JSON.stringify({ assistedOutcome: outcome, ...extra })]);
  };
  if (sameDay) {
    await finish("DUPLICATE", 0, { duplicateOfCandidateId: sameDay.candidate_id });
    return { outcome: "DUPLICATE" as const, identity, runId: run.id, candidateId: sameDay.candidate_id, evidenceId: null, reviewHref: sameDay.candidate_id ? `/radar/${sameDay.candidate_id}` : null };
  }
  const persisted = await persistIndividualPosting(db, {
    posting, identitySource, sourceId: await manualSourceId(db, now), runId: run.id, contentType: "application/json", captureMethod: "MANUAL", extractorVersion: "assisted-capture@1",
    relevanceReason: input.provenance === "EMAIL_ALERT" ? "Email alert recorded by an operator (URL not visited)" : "Assisted capture recorded by an operator (URL not visited)",
    automationPolicy: "MANUAL_FIRST", allowedMethod: "MANUAL", policyReason: "Operator-recorded posting; the system never visits the URL",
    candidateTitle: `${posting.title} — ${posting.employerName} — ${posting.location}`,
    metadata: { provenance: input.provenance, dataClass: input.dataClass, platform, recordedByOperatorId: operatorId, recordedAt: now.toISOString(), observedOn: input.observedOn,
      operatorSummary: true, urlVisited: false, emailAlert: input.provenance === "EMAIL_ALERT" ? input.emailAlert : null, runId: run.id, recipe: "RECIPE_2_0" },
  });
  const outcome: AssistedOutcome = seenBefore ? "RE_OBSERVED" : "CREATED";
  await finish(outcome, 1, { candidateId: persisted.candidateId, evidenceId: persisted.evidenceId });
  return { outcome, identity, runId: run.id, candidateId: persisted.candidateId, evidenceId: persisted.evidenceId, reviewHref: persisted.reviewHref };
}
