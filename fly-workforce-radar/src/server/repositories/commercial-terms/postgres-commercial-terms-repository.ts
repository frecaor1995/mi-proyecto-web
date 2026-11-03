import { assertValidEconomicValueShape } from "../../../domain/commercial-economics-persistence";
import type { CommercialContextType, CommercialTermsVersionRecord, CreateCommercialTermsVersionInput } from "../../../domain/commercial-economics-persistence";
import type { CommercialTermsContract } from "../../../domain/commercial-terms";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { CommercialTermsRepository } from "./commercial-terms-repository";

type Row = Record<string, unknown>;
const columns = "id,context_type,company_id,opportunity_id,terms,supporting_claim_ids,supporting_evidence_ids,rule_version,asserted_by,evaluated_at,supersedes_commercial_terms_id,created_at";

function validateTerms(terms: CommercialTermsContract): void {
  assertValidEconomicValueShape(terms.billRate, "terms.billRate");
  assertValidEconomicValueShape(terms.overtimeBillBasis, "terms.overtimeBillBasis");
  assertValidEconomicValueShape(terms.reimbursablePerDiem, "terms.reimbursablePerDiem");
  assertValidEconomicValueShape(terms.perDiemMarkup, "terms.perDiemMarkup");
  assertValidEconomicValueShape(terms.paymentTerms, "terms.paymentTerms");
  assertValidEconomicValueShape(terms.billingCadence, "terms.billingCadence");
}

function record(row: Row): CommercialTermsVersionRecord {
  return {
    id: String(row.id),
    contextType: row.context_type as CommercialContextType,
    companyId: row.company_id ? String(row.company_id) : null,
    opportunityId: row.opportunity_id ? String(row.opportunity_id) : null,
    terms: row.terms as CommercialTermsContract,
    supportingClaimIds: Array.isArray(row.supporting_claim_ids) ? row.supporting_claim_ids.map(String) : [],
    supportingEvidenceIds: Array.isArray(row.supporting_evidence_ids) ? row.supporting_evidence_ids.map(String) : [],
    ruleVersion: String(row.rule_version),
    assertedBy: row.asserted_by ? String(row.asserted_by) : null,
    evaluatedAt: new Date(String(row.evaluated_at)),
    supersedesCommercialTermsId: row.supersedes_commercial_terms_id ? String(row.supersedes_commercial_terms_id) : null,
    createdAt: new Date(String(row.created_at)),
  };
}

export class PostgresCommercialTermsRepository implements CommercialTermsRepository {
  constructor(private readonly client: SqlClient) {}

  async createVersion(input: CreateCommercialTermsVersionInput): Promise<CommercialTermsVersionRecord> {
    validateTerms(input.terms);
    const result = await this.client.query<Row>(
      `insert into commercial_terms_versions(context_type,company_id,opportunity_id,terms,supporting_claim_ids,supporting_evidence_ids,rule_version,asserted_by,evaluated_at,supersedes_commercial_terms_id)
       values($1,$2,$3,$4::jsonb,$5::uuid[],$6::uuid[],$7,$8,$9,$10) returning ${columns}`,
      [
        input.contextType, input.companyId, input.opportunityId, JSON.stringify(input.terms),
        input.supportingClaimIds, input.supportingEvidenceIds, input.ruleVersion, input.assertedBy,
        input.evaluatedAt.toISOString(), input.supersedesCommercialTermsId,
      ],
    );
    return record(result.rows[0]);
  }

  async getCurrent(contextType: CommercialContextType, contextId: string): Promise<CommercialTermsVersionRecord | null> {
    const contextColumn = contextType === "COMPANY" ? "company_id" : "opportunity_id";
    const result = await this.client.query<Row>(
      `select ${columns} from commercial_terms_versions v
        where v.context_type=$1 and v.${contextColumn}=$2
          and not exists(select 1 from commercial_terms_versions newer where newer.supersedes_commercial_terms_id=v.id)
        order by v.evaluated_at desc, v.created_at desc, v.id desc limit 1`,
      [contextType, contextId],
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async listHistory(contextType: CommercialContextType, contextId: string): Promise<CommercialTermsVersionRecord[]> {
    const contextColumn = contextType === "COMPANY" ? "company_id" : "opportunity_id";
    const result = await this.client.query<Row>(
      `select ${columns} from commercial_terms_versions where context_type=$1 and ${contextColumn}=$2 order by evaluated_at, created_at, id`,
      [contextType, contextId],
    );
    return result.rows.map(record);
  }

  async getById(id: string): Promise<CommercialTermsVersionRecord | null> {
    const result = await this.client.query<Row>(`select ${columns} from commercial_terms_versions where id=$1`, [id]);
    return result.rows[0] ? record(result.rows[0]) : null;
  }
}
