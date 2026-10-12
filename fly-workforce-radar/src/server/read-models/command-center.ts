import type { MetricValue, ReadModelCapabilityState } from "./shared";
import { unknownMetric } from "./shared";

/**
 * Semantic metric identity -- UI-2R removed the baked English display label
 * this used to carry (I18N-0 confirmed issue #1). Presentation localizes
 * each kind to a label in the future UI layer; this boundary never decides
 * display language.
 */
export const COMMAND_CENTER_METRIC_KINDS = [
  "HOT_OPPORTUNITIES", "NEAR_READY_OPPORTUNITIES", "VERIFICATION_WORK", "ACTIONABLE_ROUTES",
  "STALE_EVIDENCE", "CONFLICTS", "BLOCKED_ITEMS", "PRIORITIZED_ACTIONS",
] as const;
export type CommandCenterMetricKind = (typeof COMMAND_CENTER_METRIC_KINDS)[number];

export interface CommandCenterMetric {
  readonly kind: CommandCenterMetricKind;
  readonly value: MetricValue;
}

/**
 * Command Center attention surface. No assembler in the canonical backend
 * currently aggregates these counts across opportunities -- the closest
 * precedent, operational-desk-service.ts's DailyDeskCounts, operates on a
 * WorkforceConversionDossier list this boundary is not yet wired to (see
 * UI-2 research). Every metric therefore defaults to UNKNOWN unless the
 * caller supplies an already-computed value; this function performs no
 * aggregation of its own and fabricates nothing.
 */
export interface CommandCenterSummary {
  readonly asOf: string;
  readonly hotCount: CommandCenterMetric;
  readonly nearReadyCount: CommandCenterMetric;
  readonly verificationWorkCount: CommandCenterMetric;
  readonly actionableRoutesCount: CommandCenterMetric;
  readonly staleEvidenceCount: CommandCenterMetric;
  readonly conflictCount: CommandCenterMetric;
  readonly blockedCount: CommandCenterMetric;
  readonly prioritizedActionCount: CommandCenterMetric;
  readonly sourceHealthCapability: ReadModelCapabilityState;
  readonly dataConnectionCapability: ReadModelCapabilityState;
}

export interface CommandCenterSummaryInput {
  readonly asOf: Date;
  readonly hotCount?: MetricValue;
  readonly nearReadyCount?: MetricValue;
  readonly verificationWorkCount?: MetricValue;
  readonly actionableRoutesCount?: MetricValue;
  readonly staleEvidenceCount?: MetricValue;
  readonly conflictCount?: MetricValue;
  readonly blockedCount?: MetricValue;
  readonly prioritizedActionCount?: MetricValue;
  readonly sourceHealthCapability?: ReadModelCapabilityState;
  readonly dataConnectionCapability?: ReadModelCapabilityState;
}

export function assembleCommandCenterSummary(input: CommandCenterSummaryInput): CommandCenterSummary {
  const metric = (kind: CommandCenterMetricKind, value: MetricValue | undefined): CommandCenterMetric => ({ kind, value: value ?? unknownMetric() });
  return {
    asOf: input.asOf.toISOString(),
    hotCount: metric("HOT_OPPORTUNITIES", input.hotCount),
    nearReadyCount: metric("NEAR_READY_OPPORTUNITIES", input.nearReadyCount),
    verificationWorkCount: metric("VERIFICATION_WORK", input.verificationWorkCount),
    actionableRoutesCount: metric("ACTIONABLE_ROUTES", input.actionableRoutesCount),
    staleEvidenceCount: metric("STALE_EVIDENCE", input.staleEvidenceCount),
    conflictCount: metric("CONFLICTS", input.conflictCount),
    blockedCount: metric("BLOCKED_ITEMS", input.blockedCount),
    prioritizedActionCount: metric("PRIORITIZED_ACTIONS", input.prioritizedActionCount),
    sourceHealthCapability: input.sourceHealthCapability ?? "UNKNOWN",
    dataConnectionCapability: input.dataConnectionCapability ?? "UNAVAILABLE",
  };
}
