import { getProductionSqlClient } from "../database/production-sql-client";
import { assembleOpportunityEconomicDecisionDetail, type OpportunityEconomicDecisionDetail } from "../read-models/economic-decisions";
import type { EconomicDecisionRepository } from "../repositories/economic-decision/economic-decision-repository";
import { PostgresEconomicDecisionRepository } from "../repositories/economic-decision/postgres-economic-decision-repository";

/**
 * Read-only Phase 4K application boundary. Repository scoping is by canonical
 * opportunity id, matching the existing server-side opportunity/economics
 * loaders. This project currently has no separate tenant ownership model or
 * per-resource read permission to duplicate here.
 */
export async function readOpportunityEconomicDecisions(
  opportunityId: string,
  repository: EconomicDecisionRepository,
): Promise<OpportunityEconomicDecisionDetail> {
  const history = await repository.listHistory(opportunityId);
  return assembleOpportunityEconomicDecisionDetail(opportunityId, history);
}

/** Null means the database/read capability is unavailable; a valid opportunity
 * with no decision returns a non-null detail whose current is null and history
 * is empty. No UI or existing opportunity-detail read model consumes this yet. */
export async function loadOpportunityEconomicDecisions(opportunityId: string): Promise<OpportunityEconomicDecisionDetail | null> {
  const client = getProductionSqlClient();
  if (!client) return null;
  try {
    return await readOpportunityEconomicDecisions(opportunityId, new PostgresEconomicDecisionRepository(client));
  } catch {
    return null;
  }
}
