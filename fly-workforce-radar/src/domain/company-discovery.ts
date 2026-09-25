export const COMPANY_DISCOVERY_TRIGGER_KINDS = ["MANUAL", "SCHEDULED"] as const;
export type CompanyDiscoveryTriggerKind = (typeof COMPANY_DISCOVERY_TRIGGER_KINDS)[number];

export const COMPANY_DISCOVERY_TARGET_RESOLUTION_STATES = [
  "UNRESOLVED",
  "MATCHED_EXISTING",
  "AMBIGUOUS",
  "CONFIRMED",
] as const;
export type CompanyDiscoveryTargetResolutionState =
  (typeof COMPANY_DISCOVERY_TARGET_RESOLUTION_STATES)[number];

export const COMPANY_DISCOVERY_RUN_STATUSES = ["SEARCHING", "COMPLETED", "PARTIAL", "FAILED"] as const;
export type CompanyDiscoveryRunStatus = (typeof COMPANY_DISCOVERY_RUN_STATUSES)[number];

export const COMPANY_DISCOVERY_SOURCE_STATUSES = ["SELECTED", "SEARCHING", "COMPLETED", "FAILED", "SKIPPED"] as const;
export type CompanyDiscoverySourceStatus = (typeof COMPANY_DISCOVERY_SOURCE_STATUSES)[number];

export const DISCOVERY_QUERY_KINDS = [
  "EXACT_COMPANY", "PROJECTS", "ELECTRICAL_HIRING", "WORKFORCE",
  "CONSTRUCTION", "PROCUREMENT", "TEXAS", "DISCOVERED_LOCATION",
  "KEYWORD", "TRADE_PROFESSION", "LOCATION", "COMBINED",
] as const;
export type DiscoveryQueryKind = (typeof DISCOVERY_QUERY_KINDS)[number];

export interface DiscoveryCandidate {
  readonly id?: string;
  readonly queryKind: DiscoveryQueryKind;
  readonly title: string;
  readonly url: string;
  readonly normalizedUrl: string;
  readonly domain: string;
  /** Provider metadata only. Never canonical evidence. */
  readonly providerDescription: string | null;
  readonly relevanceReason: string;
  readonly providerRank: number;
  readonly evidenceCaptured: boolean;
  readonly canonicalEvidenceId?: string | null;
  readonly duplicate: boolean;
  readonly correlatedCompanyId: string | null;
  readonly correlatedProjectId: string | null;
  readonly correlatedOpportunityId: string | null;
  readonly humanReviewRequired: boolean;
  readonly destinationPolicyDecision?: "ALLOWED" | "DENIED" | "REVIEW_REQUIRED";
  readonly processingReason?: string;
  readonly destinationCaptureFailed?: boolean;
  readonly operationalClassification?: "HOT" | "NEAR_READY" | "WATCH" | "NEEDS_REVIEW" | null;
  readonly previouslySeen?: boolean;
  readonly discoveredAt?: string;
}

export type DiscoveryExecutionState =
  | "SEARCHING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "NOT_CONFIGURED"
  | "UNAUTHORIZED";

export interface CompanyDiscoveryResult {
  readonly state: DiscoveryExecutionState;
  readonly runId: string | null;
  readonly target: string;
  readonly status: CompanyDiscoveryRunStatus | null;
  readonly sourceCount: number;
  readonly findingsCount: number;
  readonly evidenceCount: number;
  readonly duplicatesSuppressedCount: number;
  readonly opportunitiesCreatedCount: number;
  readonly opportunitiesUpdatedCount: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly targetResolutionState: CompanyDiscoveryTargetResolutionState;
  readonly candidates: readonly DiscoveryCandidate[];
  readonly failureCode: string | null;
}

const RUN_TRANSITIONS: Readonly<Record<CompanyDiscoveryRunStatus, readonly CompanyDiscoveryRunStatus[]>> = {
  SEARCHING: ["COMPLETED", "PARTIAL", "FAILED"],
  COMPLETED: [],
  PARTIAL: [],
  FAILED: [],
};

const SOURCE_TRANSITIONS: Readonly<Record<CompanyDiscoverySourceStatus, readonly CompanyDiscoverySourceStatus[]>> = {
  SELECTED: ["SEARCHING", "FAILED", "SKIPPED"],
  SEARCHING: ["COMPLETED", "FAILED", "SKIPPED"],
  COMPLETED: [],
  FAILED: [],
  SKIPPED: [],
};

export function canTransitionDiscoveryRun(from: CompanyDiscoveryRunStatus, to: CompanyDiscoveryRunStatus): boolean {
  return from === to || RUN_TRANSITIONS[from].includes(to);
}

export function canTransitionDiscoverySource(from: CompanyDiscoverySourceStatus, to: CompanyDiscoverySourceStatus): boolean {
  return from === to || SOURCE_TRANSITIONS[from].includes(to);
}

export function normalizeDiscoveryTarget(target: string): string {
  return target.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}
