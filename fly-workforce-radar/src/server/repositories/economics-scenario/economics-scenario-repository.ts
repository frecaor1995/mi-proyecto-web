import type { CreateEconomicsScenarioSnapshotInput, EconomicsScenarioSnapshotRecord } from "../../../domain/commercial-economics-persistence";

export interface EconomicsScenarioRepository {
  createSnapshot(input: CreateEconomicsScenarioSnapshotInput): Promise<EconomicsScenarioSnapshotRecord>;
  getById(id: string): Promise<EconomicsScenarioSnapshotRecord | null>;
  listByOpportunity(opportunityId: string): Promise<EconomicsScenarioSnapshotRecord[]>;
}
