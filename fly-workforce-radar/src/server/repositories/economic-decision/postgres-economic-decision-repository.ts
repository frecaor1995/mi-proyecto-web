import type { EconomicFactTier } from "../../../domain/economic-value";
import type { CreateEconomicDecisionInput, EconomicDecisionRecord, EconomicDisposition } from "../../../domain/economic-decision";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { EconomicDecisionRepository } from "./economic-decision-repository";

type Row = Record<string, unknown>;
const columns = "id,opportunity_id,scenario_snapshot_id,disposition,rationale,scenario_effective_certainty,scenario_blocking_reasons,rule_version,decided_by,decided_at,supersedes_decision_id,created_at";

function record(row: Row): EconomicDecisionRecord {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    scenarioSnapshotId: String(row.scenario_snapshot_id),
    disposition: row.disposition as EconomicDisposition,
    rationale: String(row.rationale),
    scenarioEffectiveCertainty: row.scenario_effective_certainty as EconomicFactTier,
    scenarioBlockingReasons: Array.isArray(row.scenario_blocking_reasons) ? row.scenario_blocking_reasons.map(String) : [],
    ruleVersion: String(row.rule_version),
    decidedBy: String(row.decided_by),
    decidedAt: new Date(String(row.decided_at)),
    supersedesDecisionId: row.supersedes_decision_id ? String(row.supersedes_decision_id) : null,
    createdAt: new Date(String(row.created_at)),
  };
}

export class PostgresEconomicDecisionRepository implements EconomicDecisionRepository {
  constructor(private readonly client: SqlClient) {}

  async create(input: CreateEconomicDecisionInput): Promise<EconomicDecisionRecord> {
    const result = await this.client.query<Row>(
      `insert into economic_decisions(opportunity_id,scenario_snapshot_id,disposition,rationale,scenario_effective_certainty,scenario_blocking_reasons,rule_version,decided_by,decided_at,supersedes_decision_id)
       values($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10) returning ${columns}`,
      [input.opportunityId, input.scenarioSnapshotId, input.disposition, input.rationale,
        input.scenarioEffectiveCertainty, [...input.scenarioBlockingReasons], input.ruleVersion,
        input.decidedBy, input.decidedAt.toISOString(), input.supersedesDecisionId],
    );
    return record(result.rows[0]);
  }

  async getById(id: string): Promise<EconomicDecisionRecord | null> {
    const result = await this.client.query<Row>(`select ${columns} from economic_decisions where id=$1`, [id]);
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async getCurrent(opportunityId: string): Promise<EconomicDecisionRecord | null> {
    const result = await this.client.query<Row>(
      `select ${columns} from economic_decisions d
       where d.opportunity_id=$1
         and not exists(select 1 from economic_decisions newer where newer.supersedes_decision_id=d.id)
       order by d.decided_at desc,d.created_at desc,d.id desc limit 1`,
      [opportunityId],
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async listHistory(opportunityId: string): Promise<EconomicDecisionRecord[]> {
    const result = await this.client.query<Row>(
      `select ${columns} from economic_decisions where opportunity_id=$1 order by decided_at,created_at,id`,
      [opportunityId],
    );
    return result.rows.map(record);
  }
}
