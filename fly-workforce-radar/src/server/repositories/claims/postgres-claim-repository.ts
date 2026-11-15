import type { ClaimRecord, ClaimStateAuditRecord, ClaimStateTransition, ClaimSubject } from "../../../domain/claims";
import type { VerificationState } from "../../../domain/database";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { ClaimRepository, PersistClaimInput } from "./claim-repository";

const subjectColumns: Record<ClaimSubject["type"], string> = {
  SOURCE: "source_id", RAW_EVIDENCE: "raw_evidence_subject_id", DEMAND_SIGNAL: "demand_signal_id",
  COMPANY: "company_id", PROJECT: "project_id", VENDOR_ROUTE: "vendor_route_id",
  CONTACT_PERSON: "contact_person_id", CONTACT_ROUTE: "contact_route_id",
  DEMAND_CLUSTER: "demand_cluster_id", OPPORTUNITY: "opportunity_id",
};

interface ClaimRow {
  id: string;
  subject_type: ClaimSubject["type"];
  source_id: string | null;
  raw_evidence_subject_id: string | null;
  demand_signal_id: string | null;
  company_id: string | null;
  project_id: string | null;
  vendor_route_id: string | null;
  contact_person_id: string | null;
  contact_route_id: string | null;
  demand_cluster_id: string | null;
  opportunity_id: string | null;
  predicate: ClaimRecord["predicate"];
  external_manpower_category: ClaimRecord["externalManpowerCategory"];
  claim_value: ClaimRecord["value"];
  assertion_kind: ClaimRecord["assertionKind"];
  verification_state: VerificationState;
  asserted_at: string | Date;
  asserted_by: string | null;
  verified_at: string | Date | null;
  verification_actor_reference: string | null;
  stale_after: string | Date | null;
  verification_due_at: string | Date | null;
  notes: string | null;
  audit_metadata: Record<string, unknown>;
  claim_identity_key: string;
}

interface AuditRow {
  id: string; claim_id: string; prior_state: VerificationState; new_state: VerificationState;
  actor: string; transitioned_at: string | Date; reason: string; evidence_id: string | null;
  metadata: Record<string, unknown>;
}

const claimColumns = `
  id, subject_type, source_id, raw_evidence_subject_id, demand_signal_id,
  company_id, project_id, vendor_route_id, contact_person_id, contact_route_id,
  demand_cluster_id, opportunity_id, predicate, external_manpower_category,
  claim_value, assertion_kind, verification_state, asserted_at, asserted_by,
  verified_at, verification_actor_reference, stale_after, verification_due_at,
  notes, audit_metadata, claim_identity_key
`;
const toDate = (value: string | Date | null) => value === null ? null : new Date(value);

function mapClaim(row: ClaimRow): ClaimRecord {
  const subjectColumn = subjectColumns[row.subject_type] as keyof ClaimRow;
  return {
    id: row.id, identityKey: row.claim_identity_key,
    subject: { type: row.subject_type, id: row[subjectColumn] as string },
    predicate: row.predicate, value: row.claim_value, assertionKind: row.assertion_kind,
    verificationState: row.verification_state,
    externalManpowerCategory: row.external_manpower_category,
    assertedAt: new Date(row.asserted_at), assertedBy: row.asserted_by,
    verifiedAt: toDate(row.verified_at), verificationActorReference: row.verification_actor_reference,
    staleAfter: toDate(row.stale_after), verificationDueAt: toDate(row.verification_due_at),
    notes: row.notes, metadata: row.audit_metadata,
  };
}

export class PostgresClaimRepository implements ClaimRepository {
  constructor(private readonly client: SqlClient) {}

  async createOrGet(input: PersistClaimInput): Promise<ClaimRecord> {
    const candidate = input.candidate;
    const subjectColumn = subjectColumns[candidate.subject.type];
    const result = await this.client.query<ClaimRow>(
      `insert into claims (
         subject_type, ${subjectColumn}, predicate, external_manpower_category,
         claim_value, assertion_kind, verification_state, asserted_at, asserted_by,
         supporting_evidence_id, stale_after, verification_due_at, notes,
         audit_metadata, claim_identity_key
       ) values ($1, $2, $3, $4, $5::jsonb, $6, 'UNVERIFIED', $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
       on conflict (claim_identity_key) where claim_identity_key is not null do nothing
       returning ${claimColumns}`,
      [candidate.subject.type, candidate.subject.id, candidate.predicate,
        candidate.externalManpowerCategory ?? null, JSON.stringify(candidate.value),
        candidate.assertionKind, (candidate.assertedAt ?? new Date()).toISOString(),
        candidate.assertedBy ?? null, input.initialEvidenceId,
        candidate.staleAfter?.toISOString() ?? null,
        candidate.verificationDueAt?.toISOString() ?? null, candidate.notes ?? null,
        JSON.stringify(candidate.metadata ?? {}), input.identityKey],
    );
    if (result.rows[0]) return mapClaim(result.rows[0]);
    const existing = await this.client.query<ClaimRow>(
      `select ${claimColumns} from claims where claim_identity_key = $1`, [input.identityKey],
    );
    if (!existing.rows[0]) throw new Error("Claim identity conflict could not be resolved");
    return mapClaim(existing.rows[0]);
  }

  async getById(id: string): Promise<ClaimRecord | null> {
    const result = await this.client.query<ClaimRow>(`select ${claimColumns} from claims where id = $1`, [id]);
    return result.rows[0] ? mapClaim(result.rows[0]) : null;
  }

  async listBySubject(subject: ClaimSubject, currentAt?: Date): Promise<ClaimRecord[]> {
    const column = subjectColumns[subject.type];
    const result = await this.client.query<ClaimRow>(
      `select ${claimColumns} from claims
        where subject_type = $1 and ${column} = $2
          and ($3::timestamptz is null or (
            verification_state not in ('REJECTED', 'STALE')
            and (stale_after is null or stale_after > $3::timestamptz)
          )) order by asserted_at, id`,
      [subject.type, subject.id, currentAt?.toISOString() ?? null],
    );
    return result.rows.map(mapClaim);
  }

  async hasEvidence(claimId: string, evidenceId?: string): Promise<boolean> {
    const result = await this.client.query<{ present: boolean }>(
      `select exists (
         select 1 from claims c where c.id = $1
          and ($2::uuid is null or c.supporting_evidence_id = $2)
          and c.supporting_evidence_id is not null
         union all
         select 1 from evidence_links el where el.claim_id = $1
          and ($2::uuid is null or el.evidence_id = $2)
       ) as present`, [claimId, evidenceId ?? null],
    );
    return result.rows[0]?.present ?? false;
  }

  async transition(input: ClaimStateTransition): Promise<ClaimRecord> {
    const result = await this.client.query<ClaimRow>(
      `with prior as (select verification_state from claims where id = $1),
       changed as (
         update claims set verification_state = $2,
           verified_at = case when $2 = 'VERIFIED' then $4 else verified_at end,
           verification_actor_reference = case when $2 = 'VERIFIED' then $3 else verification_actor_reference end,
           updated_at = $4
         where id = $1 and verification_state <> $2 returning *
       ), audited as (
         insert into claim_state_transitions (
           claim_id, prior_state, new_state, actor, transitioned_at, reason, evidence_id, metadata
         ) select $1, prior.verification_state, $2, $3, $4, $5, $6, $7::jsonb
             from prior, changed returning id
       ) select ${claimColumns} from changed`,
      [input.claimId, input.newState, input.actor, input.at.toISOString(), input.reason,
        input.evidenceId ?? null, JSON.stringify(input.metadata ?? {})],
    );
    if (!result.rows[0]) throw new Error("Claim not found or already in requested state");
    return mapClaim(result.rows[0]);
  }

  async listTransitions(claimId: string): Promise<ClaimStateAuditRecord[]> {
    const result = await this.client.query<AuditRow>(
      `select id, claim_id, prior_state, new_state, actor, transitioned_at, reason,
              evidence_id, metadata from claim_state_transitions
        where claim_id = $1 order by transitioned_at, id`, [claimId],
    );
    return result.rows.map((row) => ({
      id: row.id, claimId: row.claim_id, priorState: row.prior_state,
      newState: row.new_state, actor: row.actor, transitionedAt: new Date(row.transitioned_at),
      reason: row.reason, evidenceId: row.evidence_id, metadata: row.metadata,
    }));
  }

  async listStaleCandidates(at: Date): Promise<string[]> {
    const result = await this.client.query<{ id: string }>(
      `select id from claims where stale_after <= $1
        and verification_state not in ('REJECTED', 'STALE') order by stale_after, id`,
      [at.toISOString()],
    );
    return result.rows.map((row) => row.id);
  }
}
