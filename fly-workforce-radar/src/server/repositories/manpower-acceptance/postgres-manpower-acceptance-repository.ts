import { normalizeManpowerAcceptanceResult } from "../../../domain/manpower-acceptance";
import type { AcceptanceClaimObservation, AcceptanceContext, AcceptanceEvaluation, PersistedManpowerAcceptanceResult } from "../../../domain/manpower-acceptance";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { ManpowerAcceptanceRepository, SaveAcceptanceEvaluation } from "./manpower-acceptance-repository";

interface ObservationRow {
  id: string; external_manpower_category: AcceptanceClaimObservation["category"];
  assertion_kind: AcceptanceClaimObservation["assertionKind"];
  verification_state: AcceptanceClaimObservation["verificationState"];
  claim_value: { accepted?: unknown } | null; stale_after: string | Date | null;
  evidence_ids: string[];
}
interface EvaluationRow {
  id: string; company_id: string; project_id: string | null; opportunity_id: string | null;
  result: PersistedManpowerAcceptanceResult;
  qualifying_categories: AcceptanceEvaluation["qualifyingCategories"] | string;
  supporting_claim_ids: string[]; supporting_evidence_ids: string[]; ignored_claim_ids: string[];
  evaluated_at: string | Date; rule_version: string; valid_until: string | Date | null;
  reason: string; explanation: Record<string, unknown>;
}
const evaluationColumns = "id, company_id, project_id, opportunity_id, result, qualifying_categories, supporting_claim_ids, supporting_evidence_ids, ignored_claim_ids, evaluated_at, rule_version, valid_until, reason, explanation";
const pgArray = (values: string[]) => `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
const decodedCategories = (value: EvaluationRow["qualifying_categories"]): AcceptanceEvaluation["qualifyingCategories"] =>
  typeof value === "string"
    ? value.slice(1, -1).split(",").filter(Boolean) as AcceptanceEvaluation["qualifyingCategories"]
    : value;
function evaluation(row: EvaluationRow): AcceptanceEvaluation {
  const context = row.project_id ? { type: "PROJECT" as const, id: row.project_id } : row.opportunity_id ? { type: "OPPORTUNITY" as const, id: row.opportunity_id } : null;
  return { id: row.id, companyId: row.company_id, context, result: normalizeManpowerAcceptanceResult(row.result), qualifyingCategories: decodedCategories(row.qualifying_categories), supportingClaimIds: row.supporting_claim_ids, supportingEvidenceIds: row.supporting_evidence_ids, ignoredClaimIds: row.ignored_claim_ids, evaluatedAt: new Date(row.evaluated_at), ruleVersion: row.rule_version, validUntil: row.valid_until === null ? null : new Date(row.valid_until), reason: row.reason, explanation: row.explanation };
}

export class PostgresManpowerAcceptanceRepository implements ManpowerAcceptanceRepository {
  constructor(private readonly client: SqlClient) {}
  async listClaimObservations(companyId: string, context?: AcceptanceContext | null) {
    const result = await this.client.query<ObservationRow>(
      `select c.id, c.external_manpower_category, c.assertion_kind, c.verification_state,
              c.claim_value, c.stale_after,
              coalesce(array(
                select evidence_id from (
                  select c.supporting_evidence_id as evidence_id where c.supporting_evidence_id is not null
                  union select el.evidence_id from evidence_links el where el.claim_id = c.id
                ) linked
                where (select ese.status from evidence_status_events ese
                        where ese.evidence_id = linked.evidence_id
                        order by ese.recorded_at desc, ese.id desc limit 1) = 'ACTIVE'
              ), '{}'::uuid[]) as evidence_ids
         from claims c
        where c.subject_type = 'COMPANY' and c.company_id = $1
          and c.external_manpower_category is not null
          and ($2::text is null
            or c.audit_metadata->>'contextType' is null
            or (c.audit_metadata->>'contextType' = $2 and c.audit_metadata->>'contextId' = $3))
        order by c.asserted_at, c.id`,
      [companyId, context?.type ?? null, context?.id ?? null],
    );
    return result.rows.map((row): AcceptanceClaimObservation => ({
      claimId: row.id, category: row.external_manpower_category,
      assertionKind: row.assertion_kind, verificationState: row.verification_state,
      accepted: typeof row.claim_value?.accepted === "boolean" ? row.claim_value.accepted : null,
      staleAfter: row.stale_after === null ? null : new Date(row.stale_after),
      evidenceIds: row.evidence_ids, hasActiveEvidence: row.evidence_ids.length > 0,
    }));
  }
  async saveEvaluation(input: SaveAcceptanceEvaluation) {
    const projectId = input.context?.type === "PROJECT" ? input.context.id : null;
    const opportunityId = input.context?.type === "OPPORTUNITY" ? input.context.id : null;
    const result = await this.client.query<EvaluationRow>(
      `insert into manpower_acceptance_evaluations (
         company_id, project_id, opportunity_id, result, qualifying_categories,
         supporting_claim_ids, supporting_evidence_ids, ignored_claim_ids,
         evaluated_at, rule_version, valid_until, reason, explanation
       ) values ($1,$2,$3,$4,$5::external_manpower_category[],$6::uuid[],$7::uuid[],$8::uuid[],$9,$10,$11,$12,$13::jsonb)
       returning ${evaluationColumns}`,
      [input.companyId, projectId, opportunityId, input.result,
        pgArray(input.qualifyingCategories), pgArray(input.supportingClaimIds), pgArray(input.supportingEvidenceIds),
        pgArray(input.ignoredClaimIds), input.evaluatedAt.toISOString(), input.ruleVersion,
        input.validUntil?.toISOString() ?? null, input.reason, JSON.stringify(input.explanation)],
    );
    return evaluation(result.rows[0]);
  }
  async listEvaluations(companyId: string) {
    const result = await this.client.query<EvaluationRow>(
      `select ${evaluationColumns} from manpower_acceptance_evaluations
        where company_id = $1 order by evaluated_at, created_at, id`, [companyId],
    );
    return result.rows.map(evaluation);
  }
}
