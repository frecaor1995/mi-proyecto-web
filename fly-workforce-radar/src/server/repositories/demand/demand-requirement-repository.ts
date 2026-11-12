import type {
  DemandCredentialRequirementRecord, DemandMatchingCore, DemandSkillRequirementRecord,
  MatchingReadyCompensationDemand, SetDemandRequirementsInput,
} from "../../../domain/demand-matching";

/**
 * MATCHING-B1-C repository surface over the published demand_skill_requirements/
 * demand_credential_requirements tables and the MATCHING-B1-B minimum-readiness
 * columns on demand_signals (trade_code/occupation_code/minimum_experience_months/
 * start_date). Never reads role_type -- that column stays legacy/display-only.
 */
export interface DemandRequirementRepository {
  /** Replace semantics: the demand's requirement rows end up exactly matching
   * `input` -- rows not present in `input` are removed, not left stale. */
  setDemandRequirements(input: SetDemandRequirementsInput): Promise<void>;
  listSkillRequirements(demandSignalId: string): Promise<DemandSkillRequirementRecord[]>;
  listCredentialRequirements(demandSignalId: string): Promise<DemandCredentialRequirementRecord[]>;
  getMatchingCore(demandSignalId: string): Promise<DemandMatchingCore | null>;
  /** Reads the pre-existing base demand_signals compensation columns only
   * (pay_currency/base_pay_min/base_pay_max/pay_period). Never role_type. */
  getCompensation(demandSignalId: string): Promise<MatchingReadyCompensationDemand | null>;
}
