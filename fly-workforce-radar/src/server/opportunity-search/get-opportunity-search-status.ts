import { DEFAULT_RADAR_CADENCE_HOURS, type OpportunitySearchProfile } from "../../domain/opportunity-search";
import { getProductionSqlClient } from "../database/production-sql-client";
import { PostgresCompanyDiscoveryRepository, type OpportunitySearchRunSummary } from "../company-discovery/discovery-repository";

export interface OpportunitySearchStatus {
  readonly available: boolean;
  readonly automaticEnabled: boolean;
  readonly cadenceHours: number;
  readonly nextRunAt: string | null;
  readonly runs: readonly OpportunitySearchRunSummary[];
}

export async function getOpportunitySearchStatus(): Promise<OpportunitySearchStatus> {
  const client = getProductionSqlClient();
  if (!client) return { available: false, automaticEnabled: false, cadenceHours: DEFAULT_RADAR_CADENCE_HOURS, nextRunAt: null, runs: [] };
  try {
    const repository = new PostgresCompanyDiscoveryRepository(client);
    const [profiles, runs] = await Promise.all([repository.dueProfiles(new Date("9999-12-31T23:59:59Z")), repository.recentOpportunityRuns(5)]);
    const enabled = profiles.filter((profile: OpportunitySearchProfile) => profile.enabled);
    return { available: true, automaticEnabled: enabled.length > 0, cadenceHours: enabled[0]?.cadenceHours ?? DEFAULT_RADAR_CADENCE_HOURS,
      nextRunAt: enabled.map((profile) => profile.nextRunAt).sort()[0] ?? null, runs };
  } catch {
    return { available: false, automaticEnabled: false, cadenceHours: DEFAULT_RADAR_CADENCE_HOURS, nextRunAt: null, runs: [] };
  }
}
