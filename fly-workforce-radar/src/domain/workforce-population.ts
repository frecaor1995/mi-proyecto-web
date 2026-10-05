/** Canonical local/demo boundary already used by the Workforce experience. */
export const DEMO_LOCAL_PREFIX = "DEMO LOCAL";
const DEMO_TOKEN = /\bdemo\b/i;

export type WorkerPopulation = "REAL" | "DEMO_LOCAL";
export type MatchingWorkerUniverse = "REAL" | "ALL";

export function isDemoLocalLabel(label: string | null | undefined): boolean {
  return DEMO_TOKEN.test(label ?? "");
}

export function workerPopulation(displayName: string): WorkerPopulation {
  return isDemoLocalLabel(displayName) ? "DEMO_LOCAL" : "REAL";
}

/** Explicit DEMO LOCAL opportunities keep their established all-worker demo behavior. */
export function matchingUniverseForOpportunity(title: string | null | undefined): MatchingWorkerUniverse {
  return isDemoLocalLabel(title) ? "ALL" : "REAL";
}

export function isWorkerEligibleForOpportunity(workerDisplayName: string, opportunityTitle: string | null | undefined): boolean {
  return matchingUniverseForOpportunity(opportunityTitle) === "ALL" || workerPopulation(workerDisplayName) === "REAL";
}
