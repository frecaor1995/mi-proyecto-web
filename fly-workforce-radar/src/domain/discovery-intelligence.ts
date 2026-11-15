import { createHash } from "node:crypto";

export const DISCOVERY_STRATEGIES = [
  "AGGREGATOR_SEARCH", "STAFFING_AGENCY_WATCH", "ATS_CAREER_DISCOVERY", "SPECIALIZED_TRADE_SOURCE",
  "PROJECT_WORKFORCE_DISCOVERY", "CONTRACTOR_REGISTRY", "APPRENTICESHIP_SCHOOL", "PUBLIC_COMMUNITY", "WORKER_REFERRAL",
] as const;
export type DiscoveryStrategy = (typeof DISCOVERY_STRATEGIES)[number];
export type AutomationPolicy = "AUTOMATABLE" | "PARTIALLY_AUTOMATABLE" | "MANUAL_FIRST" | "NOT_APPROPRIATE_FOR_AUTOMATION";
export type WatchTier = "A" | "B" | "C";
export type ObservationState = "BASELINE" | "NEW" | "STILL_OBSERVED" | "NO_LONGER_OBSERVED";
export type EvidenceLevel = "APPRENTICE" | "HELPER" | "APPRENTICE_OR_JOURNEYMAN" | "JOURNEYMAN" | "UNKNOWN";

export interface DiscoveryRecipe {
  readonly key: string; readonly version: number; readonly name: string; readonly strategy: DiscoveryStrategy;
  readonly profession: string; readonly geography: string; readonly queryTemplates: readonly string[];
  readonly executionBudget: number; readonly reuseWindowHours: number; readonly cadenceHours: number | null;
}

const ACCEPTANCE_TERMS = [
  "apprentice electrician", "electrical apprentice", "electrician helper", "electrical helper", "experienced apprentice",
  "commercial apprentice", "service apprentice", "wireman apprentice", "will train", "entry level",
] as const;

const query = (term: string, source: string) => `\"${term}\" ${source} (Houston OR Texas)`;
export const DISCOVERY_ACCEPTANCE_RECIPES: readonly DiscoveryRecipe[] = [
  {
    key: "electrical-entry-staffing-texas", version: 1, name: "Electrical entry-level · staffing · Texas",
    strategy: "STAFFING_AGENCY_WATCH", profession: "ELECTRICAL", geography: "HOUSTON_TEXAS",
    queryTemplates: ACCEPTANCE_TERMS.map((term) => query(term, "(staffing OR personnel OR workforce OR recruiting)")),
    executionBudget: 5, reuseWindowHours: 24, cadenceHours: 24,
  },
  {
    key: "electrical-entry-ats-texas", version: 1, name: "Electrical entry-level · ATS/careers · Texas",
    strategy: "ATS_CAREER_DISCOVERY", profession: "ELECTRICAL", geography: "HOUSTON_TEXAS",
    queryTemplates: ACCEPTANCE_TERMS.map((term) => query(term, "(site:jobs.lever.co OR site:apply.workable.com OR site:icims.com OR site:myworkdayjobs.com OR site:greenhouse.io OR site:paylocity.com)")),
    executionBudget: 5, reuseWindowHours: 48, cadenceHours: 48,
  },
];

export function classifyElectricalLevel(text: string): EvidenceLevel {
  const value = text.toLowerCase();
  if (/\b(?:apprentice\s*\/\s*journeyman|apprentice\s+or\s+journeyman|journeyman\s+or\s+apprentice)\b/.test(value)) return "APPRENTICE_OR_JOURNEYMAN";
  if (/\bjourneyman(?: electrician)? (?:required|license required)|\blicensed journeyman\b/.test(value)) return "JOURNEYMAN";
  if (/\b(?:electrician helper|electrical helper)\b/.test(value)) return "HELPER";
  if (/\b(?:experienced |commercial |service |wireman )?apprentice(?: electrician)?\b|\belectrical apprentice\b|\bwill train\b|\bentry level\b/.test(value)) return "APPRENTICE";
  return "UNKNOWN";
}

export function identifyAtsPlatform(url: string): string | null {
  const host = new URL(url).hostname.toLowerCase();
  const patterns: readonly [RegExp, string][] = [
    [/greenhouse\.io$/, "GREENHOUSE"], [/jobs\.lever\.co$/, "LEVER"], [/workable\.com$/, "WORKABLE"],
    [/icims\.com$/, "ICIMS"], [/taleo\.net$/, "TALEO"], [/myworkdayjobs\.com$|workdayjobs\.com$/, "WORKDAY"], [/paylocity\.com$/, "PAYLOCITY"],
  ];
  return patterns.find(([pattern]) => pattern.test(host))?.[1] ?? null;
}

export function observationIdentity(input: { normalizedUrl: string; sourceId: string; externalPostingId?: string | null; contentHash?: string | null }): string {
  const strongest = input.externalPostingId?.trim() ? `external:${input.externalPostingId.trim()}`
    : input.contentHash?.trim() ? `hash:${input.contentHash.trim().toLowerCase()}` : `url:${input.normalizedUrl}`;
  return createHash("sha256").update(`${input.sourceId}|${strongest}`).digest("hex");
}

export interface PreviousObservation { readonly identity: string; readonly firstSeenAt: string; readonly lastSeenAt: string }
export interface ObservedPosting { readonly identity: string; readonly normalizedUrl: string; readonly publishedAt: string | null }
export interface WatchDiff { readonly identity: string; readonly normalizedUrl: string; readonly state: ObservationState; readonly firstSeenAt: string; readonly lastSeenAt: string; readonly publishedAt: string | null }

export function diffWatchSnapshot(previous: readonly PreviousObservation[], current: readonly ObservedPosting[], capturedAt: string, baseline: boolean): readonly WatchDiff[] {
  const before = new Map(previous.map((item) => [item.identity, item]));
  const now = new Map(current.map((item) => [item.identity, item]));
  const observed = current.map((item): WatchDiff => {
    const old = before.get(item.identity);
    return { ...item, state: baseline ? "BASELINE" : old ? "STILL_OBSERVED" : "NEW", firstSeenAt: old?.firstSeenAt ?? capturedAt, lastSeenAt: capturedAt };
  });
  const missing = previous.filter((item) => !now.has(item.identity)).map((item): WatchDiff => ({
    identity: item.identity, normalizedUrl: "", state: "NO_LONGER_OBSERVED", firstSeenAt: item.firstSeenAt,
    lastSeenAt: item.lastSeenAt, publishedAt: null,
  }));
  return [...observed, ...missing];
}

export function nextWatchAt(from: Date, tier: WatchTier, configuredHours?: number): Date {
  const hours = configuredHours ?? ({ A: 24, B: 168, C: 720 } as const)[tier];
  return new Date(from.getTime() + hours * 3_600_000);
}

export function shouldReuseQuery(input: { previousCompletedAt: string | null; now: string; reuseWindowHours: number; explicitRefresh?: boolean; configurationChanged?: boolean; recoveringFailure?: boolean }) {
  if (input.explicitRefresh || input.configurationChanged || input.recoveringFailure || !input.previousCompletedAt) return { reuse: false, reason: null } as const;
  const age = Date.parse(input.now) - Date.parse(input.previousCompletedAt);
  const reuse = Number.isFinite(age) && age >= 0 && age < input.reuseWindowHours * 3_600_000;
  return { reuse, reason: reuse ? "RECENT_IDENTICAL_RECIPE_QUERY" : null } as const;
}

export interface SpeedEndpoints { publishedAt: string | null; firstSeenAt: string; reviewedAt: string | null; firstCommercialActionAt: string | null; firstConversationAt: string | null }
const hoursBetween = (start: string | null, end: string | null) => start && end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 3_600_000) : null;
export function speedMetrics(value: SpeedEndpoints) {
  return {
    detectionLatencyHours: hoursBetween(value.publishedAt, value.firstSeenAt),
    reviewLatencyHours: hoursBetween(value.firstSeenAt, value.reviewedAt),
    timeToFirstTouchHours: hoursBetween(value.firstSeenAt, value.firstCommercialActionAt),
    timeToConversationHours: hoursBetween(value.firstSeenAt, value.firstConversationAt),
  };
}

export function productMetrics(input: { benchmarkCount: number | null; benchmarkDetected: number | null; reviewedCount: number; usefulCount: number }) {
  return {
    benchmarkCoverage: input.benchmarkCount && input.benchmarkDetected !== null ? input.benchmarkDetected / input.benchmarkCount : null,
    usefulSignalYield: input.reviewedCount > 0 ? input.usefulCount / input.reviewedCount : null,
  };
}
