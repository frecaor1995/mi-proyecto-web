import type { DemandSignal } from "@/domain/demand-signal";
import type { ReadModelCurrentness } from "./shared";
import { currentnessFromLastObserved } from "./shared";

/**
 * A raw demand observation, never presented as a verified opportunity --
 * `isVerifiedOpportunity` is a literal `false`, a structural guarantee (not
 * just a convention) that a signal can never masquerade as qualified
 * commercial intelligence. See UI-2 section 15.
 */
export interface SignalItem {
  readonly id: string;
  readonly title: string | null;
  readonly organization: string | null;
  readonly location: string | null;
  readonly project: string | null;
  readonly tier: string;
  readonly reasons: readonly string[];
  readonly currentness: ReadModelCurrentness;
  readonly sourceUrl: string;
  readonly isVerifiedOpportunity: false;
}

export function assembleSignalItem(signal: DemandSignal, asOf: Date): SignalItem {
  return {
    id: signal.id,
    title: signal.title,
    organization: signal.organization,
    location: signal.location,
    project: signal.project,
    tier: signal.tier,
    reasons: signal.reasons,
    currentness: currentnessFromLastObserved(asOf, signal.observedAt),
    sourceUrl: signal.sourceUrl,
    isVerifiedOpportunity: false,
  };
}
