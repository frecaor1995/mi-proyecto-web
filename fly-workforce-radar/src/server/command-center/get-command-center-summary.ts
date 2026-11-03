import { assembleCommandCenterSummary, type CommandCenterSummary } from "../read-models/command-center";
import { assembleCommercialActionItem, type CommercialActionItem } from "../read-models/commercial-action";
import type { MetricValue } from "../read-models/shared";
import { knownMetric, unavailableMetric, unknownMetric } from "../read-models/shared";
import { checkWorkforceDatabaseConnectionHealth, CONNECTION_HEALTH_TO_CAPABILITY } from "../database/connection-health";
import { loadOpenHumanVerificationWorkload } from "../human-verification-desk/get-human-verification-desk";
import { loadOperationalRadar, type OperationalRadarSummary } from "../opportunity-operations/get-operational-radar-summary";
import type { OperationalResult } from "../opportunity-operations/get-opportunity-operational-result";
import { DEMO_TITLE_PREFIX } from "./get-workforce-overview";

const NEXT_COMMERCIAL_ACTIONS_LIMIT = 10;

/**
 * A commercial-action recommendation with the opportunity it belongs to. The company is only the canonical
 * opportunity_companies link (OperationalResult.companyId/companyName); an unresolved company text is never
 * promoted to a company here.
 */
export type CommandCenterRecommendation = CommercialActionItem & {
  readonly title: string | null;
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly isDemo: boolean;
};

/** DEMO counts kept apart from the real Command Center metrics (same "DEMO LOCAL" title rule as the overview). */
export interface CommandCenterDemoMetrics { readonly hot: number; readonly nearReady: number; readonly prioritized: number; readonly opportunities: number }

const isDemoItem = (item: OperationalResult) => (item.title ?? "").toUpperCase().startsWith(DEMO_TITLE_PREFIX);
const hotOf = (items: readonly OperationalResult[]) => items.filter((i) => i.classification === "HOT").length;
const nearReadyOf = (items: readonly OperationalResult[]) => items.filter((i) => i.classification === "NEAR_READY").length;
const prioritizedOf = (items: readonly OperationalResult[]) => items.filter((i) => i.gatedAction.gate === "ACTIVE").length;
const TIER_ORDER: Record<string, number> = { HOT: 0, NEAR_READY: 1, WATCH: 2, NOT_ACTIONABLE: 3 };

/**
 * Real per-opportunity Commercial Action results already exist on every
 * evaluated operational-radar item (see OperationalResult.commercialActionResult,
 * the exact, unmodified CommercialActionService.assess() output) -- this
 * reuses assembleCommercialActionItem() (the existing read-model assembler)
 * directly rather than building a second commercial-action engine or a
 * second read-model mapping. Only opportunities with a real next step
 * (action !== WAIT) are worth surfacing here; WAIT means "nothing to do
 * yet," which the panel's own empty state already communicates honestly.
 */
function nextCommercialActionsFrom(items: readonly OperationalResult[] | null, asOf: Date): readonly CommandCenterRecommendation[] {
  if (!items) return [];
  return items
    .filter((item) => item.commercialActionResult.action !== "WAIT")
    .sort((a, b) => (TIER_ORDER[a.classification] ?? 9) - (TIER_ORDER[b.classification] ?? 9))
    .slice(0, NEXT_COMMERCIAL_ACTIONS_LIMIT)
    .map((item) => ({ ...assembleCommercialActionItem(item.commercialActionResult, asOf), title: item.title, companyId: item.companyId, companyName: item.companyName, isDemo: isDemoItem(item) }));
}

/**
 * HOT/Near Ready/prioritized-action counts now come from the same canonical,
 * read-only cross-opportunity operational radar (see
 * get-operational-radar-summary.ts) that backs Opportunity Detail, the
 * opportunity list, and /hot /near-ready -- never a second aggregation. They
 * stay UNKNOWN whenever the radar itself is unavailable/errored, OR when its
 * own coverage is incomplete (evaluatedCount < totalOpportunities): a
 * partial scan must never present as a truthful total. ZERO from a
 * complete-coverage scan is a real, reportable zero, not UNKNOWN.
 */
function radarMetric(summary: OperationalRadarSummary | null, count: (s: OperationalRadarSummary) => number): MetricValue {
  if (!summary) return unknownMetric();
  if (!summary.coverageComplete) return unavailableMetric("OPERATIONAL_RADAR_COVERAGE_INCOMPLETE");
  return knownMetric(count(summary));
}

/**
 * UI-3's presentation adapter (phase section 11), now wired to the metrics
 * that have a truthful, comprehensively-evaluable source:
 *
 * - dataConnectionCapability: a real `select 1` against the configured
 *   Workforce Postgres database (see connection-health.ts).
 * - verificationWorkCount: a count of human_verification_tasks that are not
 *   yet closed, reusing the domain's own terminal-state definition (see
 *   get-human-verification-desk.ts).
 * - hotCount / nearReadyCount / prioritizedActionCount: from the canonical
 *   operational radar (see radarMetric above).
 *
 * Stale-evidence/conflict/blocked/actionable-route counts stay UNKNOWN on
 * purpose: each would require either a canonical rule that does not exist
 * yet (evidence has no STALE status -- domain/evidence.ts only defines
 * ACTIVE/SUPERSEDED/INVALID) or a new ad hoc aggregate query duplicating
 * classification logic that only exists today as a per-opportunity
 * computation inside loadGraph() (see the accompanying report's findings on
 * conflicts/blocked items/actionable routes). When a real, truthful source
 * for those exists, only this function's body changes.
 */
export interface CommandCenterPageData {
  readonly summary: CommandCenterSummary;
  /** REAL opportunities only. */
  readonly commercialActions: readonly CommandCenterRecommendation[];
  /** DEMO opportunities, shown apart and never counted as real. */
  readonly demoCommercialActions: readonly CommandCenterRecommendation[];
  readonly demo: CommandCenterDemoMetrics | null;
}

/**
 * Fetches connection health, verification workload, and the operational
 * radar exactly once and derives both the summary metrics and the "next
 * commercial actions" list from that single radar result -- avoids running
 * the N+1 per-opportunity evaluation twice for one page render.
 */
export async function getCommandCenterPageData(asOf: Date): Promise<CommandCenterPageData> {
  const [connectionHealth, verificationWorkload, radar] = await Promise.all([
    checkWorkforceDatabaseConnectionHealth(),
    loadOpenHumanVerificationWorkload(),
    loadOperationalRadar(asOf),
  ]);
  const radarSummary = radar.state === "READY" ? radar.summary : null;
  // HOT / Near Ready / prioritized actions count REAL opportunities only; DEMO ones are reported apart.
  const realItems = radarSummary ? radarSummary.items.filter((i) => !isDemoItem(i)) : null;
  const demoItems = radarSummary ? radarSummary.items.filter(isDemoItem) : null;
  const summary = assembleCommandCenterSummary({
    asOf,
    dataConnectionCapability: CONNECTION_HEALTH_TO_CAPABILITY[connectionHealth],
    verificationWorkCount: verificationWorkload.state === "READY" ? knownMetric(verificationWorkload.openCount) : unavailableMetric(verificationWorkload.reason),
    hotCount: radarMetric(radarSummary, () => hotOf(realItems ?? [])),
    nearReadyCount: radarMetric(radarSummary, () => nearReadyOf(realItems ?? [])),
    prioritizedActionCount: radarMetric(radarSummary, () => prioritizedOf(realItems ?? [])),
  });
  return {
    summary,
    commercialActions: nextCommercialActionsFrom(realItems, asOf),
    demoCommercialActions: nextCommercialActionsFrom(demoItems, asOf),
    demo: demoItems ? { hot: hotOf(demoItems), nearReady: nearReadyOf(demoItems), prioritized: prioritizedOf(demoItems), opportunities: demoItems.length } : null,
  };
}

/** Thin backward-compatible wrapper -- prefer getCommandCenterPageData for a page render (avoids fetching the radar twice). */
export async function getCommandCenterSummary(asOf: Date): Promise<CommandCenterSummary> {
  return (await getCommandCenterPageData(asOf)).summary;
}
