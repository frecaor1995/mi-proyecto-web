import type { SourceRecord } from "@/domain/source";
import type { ReadModelCapabilityState, ReadModelCurrentness } from "./shared";
import { currentnessFromLastObserved } from "./shared";

const HEALTH_TO_CAPABILITY: Record<string, ReadModelCapabilityState> = {
  HEALTHY: "OPERATIONAL",
  DEGRADED: "PARTIAL",
  BLOCKED: "UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
};

/**
 * `executionMode` is a fixed literal, not a mapped field -- a structural
 * guarantee that this contract can never claim continuous/autonomous
 * monitoring the backend does not perform. Ingestion today is adapter/script
 * driven (UI-2 research finding 1: src/server/adapters/production). See
 * UI-2 section 16.
 */
export interface SourceHealthSummary {
  readonly sourceId: string;
  readonly name: string;
  readonly sourceType: string | null;
  readonly capabilityState: ReadModelCapabilityState;
  readonly lastSuccessfulObservationAt: string | null;
  readonly currentness: ReadModelCurrentness;
  readonly executionMode: "ADAPTER_SCRIPT_DRIVEN";
  readonly healthStatus: string;
}

export function assembleSourceHealthSummary(source: SourceRecord, asOf: Date): SourceHealthSummary {
  return {
    sourceId: source.id,
    name: source.name,
    sourceType: source.sourceType,
    capabilityState: source.enabled ? (HEALTH_TO_CAPABILITY[source.healthStatus] ?? "UNKNOWN") : "PLANNED",
    lastSuccessfulObservationAt: source.lastSeenAt ? source.lastSeenAt.toISOString() : null,
    currentness: currentnessFromLastObserved(asOf, source.lastSeenAt),
    executionMode: "ADAPTER_SCRIPT_DRIVEN",
    healthStatus: source.healthStatus,
  };
}
