import type { CreateEconomicsScenarioSnapshotInput, EconomicsScenarioSnapshotRecord } from "../../../domain/commercial-economics-persistence";
import type { ScenarioLabel } from "../../../domain/commercial-economics";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { EconomicsScenarioRepository } from "./economics-scenario-repository";

type Row = Record<string, unknown>;
const columns = "id,opportunity_id,scenario_label,commercial_terms_version_id,burden_profile_version_id,basis,result,rule_version,asserted_by,evaluated_at,as_of,supersedes_scenario_id,created_at";

function record(row: Row): EconomicsScenarioSnapshotRecord {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    scenarioLabel: row.scenario_label as ScenarioLabel,
    commercialTermsVersionId: row.commercial_terms_version_id ? String(row.commercial_terms_version_id) : null,
    burdenProfileVersionId: row.burden_profile_version_id ? String(row.burden_profile_version_id) : null,
    basis: row.basis as Record<string, unknown>,
    result: row.result as Record<string, unknown>,
    ruleVersion: String(row.rule_version),
    assertedBy: row.asserted_by ? String(row.asserted_by) : null,
    evaluatedAt: new Date(String(row.evaluated_at)),
    asOf: new Date(String(row.as_of)),
    supersedesScenarioId: row.supersedes_scenario_id ? String(row.supersedes_scenario_id) : null,
    createdAt: new Date(String(row.created_at)),
  };
}

export class PostgresEconomicsScenarioRepository implements EconomicsScenarioRepository {
  constructor(private readonly client: SqlClient) {}

  async createSnapshot(input: CreateEconomicsScenarioSnapshotInput): Promise<EconomicsScenarioSnapshotRecord> {
    const result = await this.client.query<Row>(
      `insert into economics_scenario_snapshots(opportunity_id,scenario_label,commercial_terms_version_id,burden_profile_version_id,basis,result,rule_version,asserted_by,evaluated_at,as_of,supersedes_scenario_id)
       values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11) returning ${columns}`,
      [
        input.opportunityId, input.scenarioLabel, input.commercialTermsVersionId, input.burdenProfileVersionId,
        JSON.stringify(input.basis), JSON.stringify(input.result), input.ruleVersion, input.assertedBy,
        input.evaluatedAt.toISOString(), input.asOf.toISOString(), input.supersedesScenarioId,
      ],
    );
    return record(result.rows[0]);
  }

  async getById(id: string): Promise<EconomicsScenarioSnapshotRecord | null> {
    const result = await this.client.query<Row>(`select ${columns} from economics_scenario_snapshots where id=$1`, [id]);
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async listByOpportunity(opportunityId: string): Promise<EconomicsScenarioSnapshotRecord[]> {
    const result = await this.client.query<Row>(
      `select ${columns} from economics_scenario_snapshots where opportunity_id=$1 order by evaluated_at, created_at, id`,
      [opportunityId],
    );
    return result.rows.map(record);
  }
}
