import type { BurdenComponent, BurdenProfileScope, BurdenProfileScopeLevel } from "../../../domain/burden-profile";
import { assertValidEconomicValueShape } from "../../../domain/commercial-economics-persistence";
import type { BurdenProfileVersionRecord, CreateBurdenProfileVersionInput } from "../../../domain/commercial-economics-persistence";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { BurdenProfileRepository } from "./burden-profile-repository";

type Row = Record<string, unknown>;
const columns = "id,scope_level,jurisdiction,trade_id,occupation_id,company_id,scenario_id,components,rule_version,asserted_by,evaluated_at,supersedes_burden_profile_id,created_at";

function validateComponents(components: readonly BurdenComponent[]): void {
  components.forEach((component, index) => assertValidEconomicValueShape(component.rate, `components[${index}].rate`));
}

function record(row: Row): BurdenProfileVersionRecord {
  return {
    id: String(row.id),
    scope: {
      level: row.scope_level as BurdenProfileScopeLevel,
      jurisdiction: row.jurisdiction ? String(row.jurisdiction) : null,
      tradeId: row.trade_id as BurdenProfileScope["tradeId"],
      occupationId: row.occupation_id as BurdenProfileScope["occupationId"],
      companyId: row.company_id ? String(row.company_id) : null,
      scenarioId: row.scenario_id ? String(row.scenario_id) : null,
    },
    components: row.components as BurdenComponent[],
    ruleVersion: String(row.rule_version),
    assertedBy: row.asserted_by ? String(row.asserted_by) : null,
    evaluatedAt: new Date(String(row.evaluated_at)),
    supersedesBurdenProfileId: row.supersedes_burden_profile_id ? String(row.supersedes_burden_profile_id) : null,
    createdAt: new Date(String(row.created_at)),
  };
}

/** Scope columns compared with IS NOT DISTINCT FROM so null-vs-null counts as a match (a PLATFORM_DEFAULT scope has every column null). */
const SCOPE_MATCH = "scope_level=$1 and jurisdiction is not distinct from $2 and trade_id is not distinct from $3 and occupation_id is not distinct from $4 and company_id is not distinct from $5 and scenario_id is not distinct from $6";
function scopeParams(scope: BurdenProfileScope): unknown[] {
  return [scope.level, scope.jurisdiction, scope.tradeId, scope.occupationId, scope.companyId, scope.scenarioId];
}

export class PostgresBurdenProfileRepository implements BurdenProfileRepository {
  constructor(private readonly client: SqlClient) {}

  async createVersion(input: CreateBurdenProfileVersionInput): Promise<BurdenProfileVersionRecord> {
    validateComponents(input.components);
    const result = await this.client.query<Row>(
      `insert into burden_profile_versions(scope_level,jurisdiction,trade_id,occupation_id,company_id,scenario_id,components,rule_version,asserted_by,evaluated_at,supersedes_burden_profile_id)
       values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11) returning ${columns}`,
      [
        input.scope.level, input.scope.jurisdiction, input.scope.tradeId, input.scope.occupationId,
        input.scope.companyId, input.scope.scenarioId, JSON.stringify(input.components),
        input.ruleVersion, input.assertedBy, input.evaluatedAt.toISOString(), input.supersedesBurdenProfileId,
      ],
    );
    return record(result.rows[0]);
  }

  async getById(id: string): Promise<BurdenProfileVersionRecord | null> {
    const result = await this.client.query<Row>(`select ${columns} from burden_profile_versions where id=$1`, [id]);
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async getCurrentForScope(scope: BurdenProfileScope): Promise<BurdenProfileVersionRecord | null> {
    const result = await this.client.query<Row>(
      `select ${columns} from burden_profile_versions v
        where ${SCOPE_MATCH}
          and not exists(select 1 from burden_profile_versions newer where newer.supersedes_burden_profile_id=v.id)
        order by v.evaluated_at desc, v.created_at desc, v.id desc limit 1`,
      scopeParams(scope),
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async listHistoryForScope(scope: BurdenProfileScope): Promise<BurdenProfileVersionRecord[]> {
    const result = await this.client.query<Row>(
      `select ${columns} from burden_profile_versions where ${SCOPE_MATCH} order by evaluated_at, created_at, id`,
      scopeParams(scope),
    );
    return result.rows.map(record);
  }
}
