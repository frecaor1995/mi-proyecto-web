import type { CompanyAliasRecord, CompanyRecord, CompanyResolution, CompanyRoleAssignment, CompanyRoleRecord } from "../../../domain/company";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { CompanyRepository, ResolutionAuditInput } from "./company-repository";

interface CompanyRow { id: string; legal_name: string | null; common_name: string | null; normalized_legal_name: string | null; normalized_common_name: string | null; merged_into_company_id: string | null; first_seen_at: string | Date | null; last_seen_at: string | Date | null }
interface AliasRow { id: string; company_id: string; alias: string; normalized_alias: string; verification_state: CompanyAliasRecord["verificationState"]; evidence_id: string | null; first_seen_at: string | Date; last_seen_at: string | Date; superseded_by_alias_id: string | null }
interface ResolutionRow { id: string; observed_text: string; normalized_text: string | null; result: CompanyResolution["result"]; method: CompanyResolution["method"]; candidate_company_id: string | null; candidate_company_ids: string[]; reason: string; claim_id: string | null; evidence_id: string | null }
interface RoleRow { id: string; company_id: string; role: CompanyRoleRecord["role"]; opportunity_id: string | null; project_id: string | null; demand_signal_id: string | null; raw_evidence_id: string; claim_id: string | null; assertion_kind: CompanyRoleRecord["assertionKind"]; verification_state: CompanyRoleRecord["verificationState"]; role_basis: CompanyRoleRecord["basis"]; asserted_by: string; first_seen_at: string | Date; last_seen_at: string | Date; role_metadata: Record<string, unknown> }

const companyColumns = "id, legal_name, common_name, normalized_legal_name, normalized_common_name, merged_into_company_id, first_seen_at, last_seen_at";
const aliasColumns = "id, company_id, alias, normalized_alias, verification_state, evidence_id, first_seen_at, last_seen_at, superseded_by_alias_id";
const roleColumns = "id, company_id, role, opportunity_id, project_id, demand_signal_id, raw_evidence_id, claim_id, assertion_kind, verification_state, role_basis, asserted_by, first_seen_at, last_seen_at, role_metadata";
const date = (value: string | Date | null) => value === null ? null : new Date(value);
const company = (row: CompanyRow): CompanyRecord => ({ id: row.id, legalName: row.legal_name, commonName: row.common_name, normalizedLegalName: row.normalized_legal_name, normalizedCommonName: row.normalized_common_name, mergedIntoCompanyId: row.merged_into_company_id, firstSeenAt: date(row.first_seen_at), lastSeenAt: date(row.last_seen_at) });
const alias = (row: AliasRow): CompanyAliasRecord => ({ id: row.id, companyId: row.company_id, alias: row.alias, normalizedAlias: row.normalized_alias, verificationState: row.verification_state, evidenceId: row.evidence_id, firstSeenAt: new Date(row.first_seen_at), lastSeenAt: new Date(row.last_seen_at), supersededByAliasId: row.superseded_by_alias_id });
function role(row: RoleRow): CompanyRoleRecord {
  const context = row.demand_signal_id ? { type: "DEMAND_SIGNAL" as const, id: row.demand_signal_id } : row.project_id ? { type: "PROJECT" as const, id: row.project_id } : { type: "OPPORTUNITY" as const, id: row.opportunity_id! };
  return { id: row.id, companyId: row.company_id, role: row.role, context, evidenceId: row.raw_evidence_id, claimId: row.claim_id, assertionKind: row.assertion_kind, verificationState: row.verification_state, basis: row.role_basis, actor: row.asserted_by, observedAt: new Date(row.first_seen_at), firstSeenAt: new Date(row.first_seen_at), lastSeenAt: new Date(row.last_seen_at), metadata: row.role_metadata };
}

export class PostgresCompanyRepository implements CompanyRepository {
  constructor(private readonly client: SqlClient) {}
  async findByNormalizedName(normalized: string) {
    const result = await this.client.query<CompanyRow>(`select ${companyColumns} from companies where merged_into_company_id is null and (normalized_legal_name = $1 or normalized_common_name = $1) order by id`, [normalized]);
    return result.rows.map(company);
  }
  async findByVerifiedAlias(normalized: string) {
    const result = await this.client.query<CompanyRow>(`select distinct ${companyColumns.split(", ").map((item) => `c.${item}`).join(", ")} from company_aliases a join companies c on c.id = a.company_id where a.normalized_alias = $1 and a.verification_state = 'VERIFIED' and a.superseded_by_alias_id is null and c.merged_into_company_id is null order by c.id`, [normalized]);
    return result.rows.map(company);
  }
  async createCompany(input: { legalName?: string | null; commonName?: string | null; normalized: string; observedAt: Date }) {
    const result = await this.client.query<CompanyRow>(`insert into companies (legal_name, common_name, normalized_legal_name, normalized_common_name, first_seen_at, last_seen_at) values ($1, $2, $3, $3, $4, $4) returning ${companyColumns}`, [input.legalName ?? null, input.commonName ?? null, input.normalized, input.observedAt.toISOString()]);
    return company(result.rows[0]);
  }
  async recordResolution(input: ResolutionAuditInput) {
    const result = await this.client.query<ResolutionRow>(`insert into company_resolution_audits (observed_text, normalized_text, result, method, candidate_company_id, candidate_company_ids, actor, resolved_at, evidence_id, claim_id, reason, confidence_metadata, supersedes_resolution_id) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13) returning id, observed_text, normalized_text, result, method, candidate_company_id, candidate_company_ids, reason, claim_id, evidence_id`, [input.observedText, input.normalizedText, input.result, input.method, input.companyId, JSON.stringify(input.candidateCompanyIds), input.actor, input.at.toISOString(), input.evidenceId ?? null, input.claimId ?? null, input.reason, JSON.stringify(input.confidenceMetadata ?? {}), input.supersedesResolutionId ?? null]);
    const row = result.rows[0];
    return { id: row.id, observedText: row.observed_text, normalizedText: row.normalized_text, result: row.result, method: row.method, companyId: row.candidate_company_id, candidateCompanyIds: row.candidate_company_ids, reason: row.reason, claimId: row.claim_id, evidenceId: row.evidence_id };
  }
  async createAlias(input: { companyId: string; alias: string; normalizedAlias: string; evidenceId?: string | null; verificationState?: "UNVERIFIED" | "VERIFIED"; actor: string; at: Date; reason: string }) {
    const result = await this.client.query<AliasRow>(`with created as (insert into company_aliases (company_id, alias, normalized_alias, original_observed_alias, verification_state, evidence_id, first_seen_at, last_seen_at) values ($1,$2,$3,$2,$4,$5,$6,$6) returning *), event as (insert into company_alias_assignment_events (alias_id, new_company_id, actor, recorded_at, evidence_id, reason) select id, company_id, $7, $6, evidence_id, $8 from created) select ${aliasColumns} from created`, [input.companyId, input.alias, input.normalizedAlias, input.verificationState ?? "UNVERIFIED", input.evidenceId ?? null, input.at.toISOString(), input.actor, input.reason]);
    return alias(result.rows[0]);
  }
  async reassignAlias(input: { aliasId: string; newCompanyId: string; actor: string; at: Date; evidenceId?: string | null; reason: string }) {
    const result = await this.client.query<AliasRow>(`with old as (select * from company_aliases where id = $1), created as (insert into company_aliases (company_id, alias, normalized_alias, original_observed_alias, verification_state, evidence_id, first_seen_at, last_seen_at, alias_metadata) select $2, alias, normalized_alias, original_observed_alias, 'VERIFIED', $5, $4, $4, jsonb_build_object('reassignedFromAliasId', id) from old returning *), superseded as (update company_aliases set superseded_by_alias_id = (select id from created) where id = $1), event as (insert into company_alias_assignment_events (alias_id, prior_company_id, new_company_id, actor, recorded_at, evidence_id, reason) select created.id, old.company_id, created.company_id, $3, $4, $5, $6 from created, old) select ${aliasColumns} from created`, [input.aliasId, input.newCompanyId, input.actor, input.at.toISOString(), input.evidenceId ?? null, input.reason]);
    if (!result.rows[0]) throw new Error("Alias not found");
    return alias(result.rows[0]);
  }
  async merge(input: { sourceCompanyId: string; targetCompanyId: string; actor: string; at: Date; evidenceId?: string | null; reason: string }) {
    const result = await this.client.query<{ id: string }>(`with decision as (insert into company_merge_decisions (source_company_id, target_company_id, actor, decided_at, evidence_id, reason) values ($1,$2,$3,$4,$5,$6) returning id), merged as (update companies set merged_into_company_id = $2, merge_metadata = merge_metadata || jsonb_build_object('mergeDecisionId', (select id from decision)), updated_at = $4 where id = $1 and merged_into_company_id is null) select id from decision`, [input.sourceCompanyId, input.targetCompanyId, input.actor, input.at.toISOString(), input.evidenceId ?? null, input.reason]);
    return result.rows[0].id;
  }
  async assignRole(input: CompanyRoleAssignment) {
    const contextColumn = input.context.type === "DEMAND_SIGNAL" ? "demand_signal_id" : input.context.type === "PROJECT" ? "project_id" : "opportunity_id";
    const result = await this.client.query<RoleRow>(`insert into company_roles (company_id, role, ${contextColumn}, raw_evidence_id, claim_id, assertion_kind, verification_state, asserted_by, first_seen_at, last_seen_at, role_basis, role_metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11::jsonb) on conflict (company_id, role, coalesce(opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(demand_signal_id, '00000000-0000-0000-0000-000000000000'::uuid), assertion_kind) do update set last_seen_at = excluded.last_seen_at, updated_at = excluded.last_seen_at returning ${roleColumns}`, [input.companyId, input.role, input.context.id, input.evidenceId, input.claimId ?? null, input.assertionKind, input.verificationState ?? "UNVERIFIED", input.actor, input.observedAt.toISOString(), input.basis, JSON.stringify(input.metadata ?? {})]);
    return role(result.rows[0]);
  }
  async listRoles(companyId: string) {
    const result = await this.client.query<RoleRow>(`select ${roleColumns} from company_roles where company_id = $1 order by first_seen_at, id`, [companyId]);
    return result.rows.map(role);
  }
  async linkRoleEvidence(roleId: string, evidenceId: string, actor: string) {
    await this.client.query(`insert into evidence_links (evidence_id, link_type, company_role_id, created_by) values ($1, 'SUPPORTS', $2, $3) on conflict (evidence_id, company_role_id, link_type) where company_role_id is not null do nothing`, [evidenceId, roleId, actor]);
  }
}
