import type { BurdenProfileVersionRecord, CommercialTermsVersionRecord } from "../../domain/commercial-economics-persistence";
import { getProductionSqlClient } from "../database/production-sql-client";
import { PostgresBurdenProfileRepository } from "../repositories/burden-profile/postgres-burden-profile-repository";
import { PostgresCommercialTermsRepository } from "../repositories/commercial-terms/postgres-commercial-terms-repository";
import { PostgresEconomicsScenarioRepository } from "../repositories/economics-scenario/postgres-economics-scenario-repository";
import { assembleOpportunityEconomicsDetail, type OpportunityEconomicsDetail } from "../read-models/economics";

/**
 * Phase 4H. I/O loader: fetches the certified 4C persisted economics
 * (scenario snapshots + their referenced commercial-terms/burden-profile
 * versions) for one opportunity, then hands the plain data to the pure
 * read-model assembler. Returns null when the database is not configured or
 * on any query failure -- callers must present this as "economics
 * unavailable," never fabricate a result.
 */
export async function loadOpportunityEconomics(opportunityId: string): Promise<OpportunityEconomicsDetail | null> {
  const client = getProductionSqlClient();
  if (!client) return null;

  const economicsScenarioRepository = new PostgresEconomicsScenarioRepository(client);
  const commercialTermsRepository = new PostgresCommercialTermsRepository(client);
  const burdenProfileRepository = new PostgresBurdenProfileRepository(client);

  const snapshots = await economicsScenarioRepository.listByOpportunity(opportunityId);

  const commercialTermsIds = [...new Set(snapshots.map((s) => s.commercialTermsVersionId).filter((id): id is string => id !== null))];
  const burdenProfileIds = [...new Set(snapshots.map((s) => s.burdenProfileVersionId).filter((id): id is string => id !== null))];

  const [commercialTermsVersions, burdenProfileVersions] = await Promise.all([
    Promise.all(commercialTermsIds.map((id) => commercialTermsRepository.getById(id))),
    Promise.all(burdenProfileIds.map((id) => burdenProfileRepository.getById(id))),
  ]);

  const commercialTermsById = new Map<string, CommercialTermsVersionRecord>();
  for (const version of commercialTermsVersions) if (version) commercialTermsById.set(version.id, version);
  const burdenProfileById = new Map<string, BurdenProfileVersionRecord>();
  for (const version of burdenProfileVersions) if (version) burdenProfileById.set(version.id, version);

  return assembleOpportunityEconomicsDetail(opportunityId, snapshots, commercialTermsById, burdenProfileById);
}
