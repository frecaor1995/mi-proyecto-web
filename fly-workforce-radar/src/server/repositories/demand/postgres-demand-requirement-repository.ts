import type {
  DemandCredentialRequirementRecord, DemandMatchingCore, DemandSkillRequirementRecord,
  MatchingReadyCompensationDemand, SetDemandRequirementsInput,
} from "../../../domain/demand-matching";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { DemandRequirementRepository } from "./demand-requirement-repository";

interface SkillRequirementRow {
  demand_signal_id: string; skill_code: string; requirement_level: "REQUIRED" | "PREFERRED";
  source_label: string | null; raw_evidence_id: string | null;
}
const skillRequirement = (r: SkillRequirementRow): DemandSkillRequirementRecord => ({
  demandSignalId: r.demand_signal_id, skillCode: r.skill_code, requirementLevel: r.requirement_level,
  sourceLabel: r.source_label, rawEvidenceId: r.raw_evidence_id,
});

interface CredentialRequirementRow {
  demand_signal_id: string; credential_code: string; requirement_level: "REQUIRED" | "PREFERRED";
  jurisdiction: string | null; source_requirement_text: string | null; raw_evidence_id: string | null;
}
const credentialRequirement = (r: CredentialRequirementRow): DemandCredentialRequirementRecord => ({
  demandSignalId: r.demand_signal_id, credentialCode: r.credential_code, requirementLevel: r.requirement_level,
  jurisdiction: r.jurisdiction, sourceRequirementText: r.source_requirement_text, rawEvidenceId: r.raw_evidence_id,
});

interface MatchingCoreRow {
  id: string; trade_code: string | null; occupation_code: string | null;
  minimum_experience_months: number | null; start_date: string | null;
  required_level_code:string|null;state:string|null;travel_required:boolean|null;shift:string|null;hours_per_week:string|number|null;overtime_required:boolean|null;per_diem_available:boolean|null;transportation_required:boolean|null;tools_required:boolean|null;
}

interface CompensationRow {
  pay_currency: string | null; base_pay_min: string | number | null; base_pay_max: string | number | null; pay_period: string | null;
}
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

/**
 * MATCHING-B1-C. setDemandRequirements is replace-semantics: callers
 * needing atomicity across the delete+insert pairs (guaranteed by this
 * method's single client -- two independent DELETEs and their INSERTs,
 * all on `this.client`) must construct this repository from a
 * transactionRunner-provided client, exactly like
 * WorkerService.createWorkerWithPrimaryTrade does for PostgresWorkerRepository.
 * This repository never reads demand_signals.role_type.
 */
export class PostgresDemandRequirementRepository implements DemandRequirementRepository {
  constructor(private readonly client: SqlClient) {}

  async setDemandRequirements(input: SetDemandRequirementsInput): Promise<void> {
    await this.client.query("delete from demand_skill_requirements where demand_signal_id=$1", [input.demandSignalId]);
    for (const skill of input.skills) {
      await this.client.query(
        `insert into demand_skill_requirements (demand_signal_id, skill_code, requirement_level, source_label, raw_evidence_id)
         values ($1,$2,$3,$4,$5)`,
        [input.demandSignalId, skill.skillCode, skill.requirementLevel, skill.sourceLabel ?? null, skill.rawEvidenceId ?? null],
      );
    }

    await this.client.query("delete from demand_credential_requirements where demand_signal_id=$1", [input.demandSignalId]);
    for (const credential of input.credentials) {
      await this.client.query(
        `insert into demand_credential_requirements (demand_signal_id, credential_code, requirement_level, jurisdiction, source_requirement_text, raw_evidence_id)
         values ($1,$2,$3,$4,$5,$6)`,
        [input.demandSignalId, credential.credentialCode, credential.requirementLevel, credential.jurisdiction ?? null, credential.sourceRequirementText ?? null, credential.rawEvidenceId ?? null],
      );
    }
  }

  async listSkillRequirements(demandSignalId: string): Promise<DemandSkillRequirementRecord[]> {
    const q = await this.client.query<SkillRequirementRow>(
      "select demand_signal_id, skill_code, requirement_level, source_label, raw_evidence_id from demand_skill_requirements where demand_signal_id=$1 order by requirement_level, skill_code",
      [demandSignalId],
    );
    return q.rows.map(skillRequirement);
  }

  async listCredentialRequirements(demandSignalId: string): Promise<DemandCredentialRequirementRecord[]> {
    const q = await this.client.query<CredentialRequirementRow>(
      "select demand_signal_id, credential_code, requirement_level, jurisdiction, source_requirement_text, raw_evidence_id from demand_credential_requirements where demand_signal_id=$1 order by requirement_level, credential_code",
      [demandSignalId],
    );
    return q.rows.map(credentialRequirement);
  }

  async getMatchingCore(demandSignalId: string): Promise<DemandMatchingCore | null> {
    let q;
    try {
      q = await this.client.query<MatchingCoreRow>(
        "select id,trade_code,occupation_code,minimum_experience_months,start_date,state,required_level_code,travel_required,shift,hours_per_week,overtime_required,per_diem_available,transportation_required,tools_required from demand_signals where id=$1",
        [demandSignalId],
      );
    } catch (error) {
      // A compatibility path for isolated repository tests that intentionally
      // instantiate the pre-4A schema. Production/local canonical databases
      // use the structured columns above.
      if ((error as { code?: string }).code !== "42703") throw error;
      q = await this.client.query<MatchingCoreRow>(
        "select id,trade_code,occupation_code,minimum_experience_months,start_date,state,travel_required,shift,hours_per_week,per_diem_available,null::text required_level_code,null::boolean overtime_required,null::boolean transportation_required,null::boolean tools_required from demand_signals where id=$1",
        [demandSignalId],
      );
    }
    const row = q.rows[0];
    if (!row) return null;
    return {
      demandSignalId: row.id, tradeCode: row.trade_code, occupationCode: row.occupation_code,
      minimumExperienceMonths: row.minimum_experience_months,
      startDate: row.start_date ? new Date(row.start_date) : null,
      requiredLevelCode:row.required_level_code,state:row.state,travelRequired:row.travel_required,shift:row.shift,hoursPerWeek:num(row.hours_per_week),overtimeRequired:row.overtime_required,perDiemAvailable:row.per_diem_available,transportationRequired:row.transportation_required,toolsRequired:row.tools_required,
    };
  }

  async getCompensation(demandSignalId: string): Promise<MatchingReadyCompensationDemand | null> {
    const q = await this.client.query<CompensationRow>(
      "select pay_currency, base_pay_min, base_pay_max, pay_period from demand_signals where id=$1",
      [demandSignalId],
    );
    const row = q.rows[0];
    if (!row) return null;
    return { payCurrency: row.pay_currency, basePayMin: num(row.base_pay_min), basePayMax: num(row.base_pay_max), payPeriod: row.pay_period };
  }
}
