import { DISCOVERY_GEOGRAPHIES, DISCOVERY_TRADE_CATEGORIES, SIGNAL_CATEGORIES } from "../../domain/discovery-coverage";
import { getProductionSqlClient } from "../database/production-sql-client";
import type { ProviderQuota } from "../company-discovery/brave-search-provider";
import {
  PostgresCompanyDiscoveryRepository, type CoverageCell, type CycleQueryLogEntry, type CycleRunSummary, type MultiTradeProfile,
} from "../company-discovery/discovery-repository";

export interface DiscoveryRefreshStatus {
  readonly available: boolean;
  readonly providerConfigured: boolean;
  /** The scheduled endpoint only runs when invoked with the cron secret; locally nothing invokes it by itself. */
  readonly schedulerSecretConfigured: boolean;
  readonly profile: MultiTradeProfile | null;
  /** The configured next run time has passed without a scheduled execution. */
  readonly nextRunOverdue: boolean;
  /** True only with evidence of an autonomous scheduler: repeated successful scheduled cycles on consecutive windows, the latest one recent. */
  readonly automaticConfirmed: boolean;
  readonly lastManualCycle: CycleRunSummary | null;
  /** Last quota the provider itself reported in its rate-limit headers (null until a cycle has observed it). */
  readonly providerQuota: ProviderQuota | null;
  readonly lastScheduledCycle: CycleRunSummary | null;
  readonly lastSuccessfulRefreshAt: string | null;
  readonly latestCycle: CycleRunSummary | null;
  readonly latestQueries: readonly CycleQueryLogEntry[];
  readonly coverage: readonly CoverageCell[];
  readonly geographyLastSearched: ReadonlyMap<string, string | null>;
  readonly gaps: number;
  readonly totalCells: number;
}

const EMPTY: DiscoveryRefreshStatus = {
  available: false, providerConfigured: false, schedulerSecretConfigured: false, profile: null, nextRunOverdue: false, automaticConfirmed: false, lastManualCycle: null, providerQuota: null, lastScheduledCycle: null, lastSuccessfulRefreshAt: null,
  latestCycle: null, latestQueries: [], coverage: [], geographyLastSearched: new Map(), gaps: DISCOVERY_TRADE_CATEGORIES.length * SIGNAL_CATEGORIES.length,
  totalCells: DISCOVERY_TRADE_CATEGORIES.length * SIGNAL_CATEGORIES.length,
};

const GRACE_MS = 3 * 60 * 60 * 1000;

/**
 * A configured schedule is not proof of automatic refresh. It is confirmed only when at least two successful
 * SCHEDULED cycles ran one cadence apart (within a grace period) and the latest one is itself recent.
 */
export function automaticExecutionConfirmed(cycles: readonly Pick<CycleRunSummary, "trigger" | "status" | "startedAt">[], cadenceHours: number | null, now: number): boolean {
  if (!cadenceHours) return false;
  const cadence = cadenceHours * 60 * 60 * 1000;
  const scheduled = cycles.filter((cycle) => cycle.trigger === "SCHEDULED" && (cycle.status === "COMPLETED" || cycle.status === "PARTIAL"))
    .map((cycle) => Date.parse(cycle.startedAt)).sort((a, b) => b - a);
  if (scheduled.length < 2 || now - scheduled[0] > cadence + GRACE_MS) return false;
  const gap = scheduled[0] - scheduled[1];
  return gap >= cadence - GRACE_MS && gap <= cadence + GRACE_MS;
}

export async function getDiscoveryRefreshStatus(): Promise<DiscoveryRefreshStatus> {
  const providerConfigured = Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim());
  const schedulerSecretConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const client = getProductionSqlClient();
  if (!client) return { ...EMPTY, providerConfigured, schedulerSecretConfigured };
  try {
    const repository = new PostgresCompanyDiscoveryRepository(client);
    const [profile, lastScheduledCycle, cycles, coverage, geographyLastSearched, lastSuccess, quota] = await Promise.all([
      repository.multiTradeProfile(), repository.lastScheduledCycle(), repository.recentCycles(20), repository.coverageCells(),
      repository.geographyCoverage(),
      client.query<{ completed_at: string | Date | null }>("select max(completed_at) completed_at from company_discovery_runs where status in ('COMPLETED','PARTIAL')"),
      client.query<{ quota: ProviderQuota | null }>(
        `select correlation_metadata->'providerQuota' as quota from company_discovery_runs
          where search_request ? 'cycle' and jsonb_typeof(correlation_metadata->'providerQuota') = 'object' order by started_at desc limit 1`),
    ]);
    const latestCycle = cycles[0] ?? null;
    const latestQueries = latestCycle ? await repository.cycleQueryLog(latestCycle.id) : [];
    const searchedCells = new Set(coverage.filter((cell) => cell.searches > 0).map((cell) => `${cell.tradeCategory}:${cell.signalCategory}`));
    const totalCells = DISCOVERY_TRADE_CATEGORIES.length * SIGNAL_CATEGORIES.length;
    const lastCompleted = lastSuccess.rows[0]?.completed_at;
    return {
      available: true, providerConfigured, schedulerSecretConfigured, profile, lastScheduledCycle,
      nextRunOverdue: Boolean(profile?.enabled && Date.parse(profile.nextRunAt) < Date.now()),
      lastManualCycle: cycles.find((cycle) => cycle.trigger === "MANUAL") ?? null,
      providerQuota: quota.rows[0]?.quota ?? null,
      automaticConfirmed: automaticExecutionConfirmed(cycles, profile?.enabled ? profile.cadenceHours : null, Date.now()), latestCycle, latestQueries, coverage,
      geographyLastSearched: new Map(DISCOVERY_GEOGRAPHIES.map((geo) => [geo.id, geographyLastSearched.get(geo.id) ?? null])),
      lastSuccessfulRefreshAt: lastCompleted ? new Date(lastCompleted).toISOString() : null,
      gaps: totalCells - searchedCells.size, totalCells,
    };
  } catch {
    return { ...EMPTY, providerConfigured, schedulerSecretConfigured };
  }
}
