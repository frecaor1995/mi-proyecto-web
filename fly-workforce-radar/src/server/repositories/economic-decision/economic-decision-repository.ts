import type { CreateEconomicDecisionInput, EconomicDecisionRecord } from "../../../domain/economic-decision";

export interface EconomicDecisionRepository {
  create(input: CreateEconomicDecisionInput): Promise<EconomicDecisionRecord>;
  getById(id: string): Promise<EconomicDecisionRecord | null>;
  getCurrent(opportunityId: string): Promise<EconomicDecisionRecord | null>;
  listHistory(opportunityId: string): Promise<EconomicDecisionRecord[]>;
}
