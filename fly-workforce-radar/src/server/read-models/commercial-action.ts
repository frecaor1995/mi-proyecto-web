import type { CommercialActionResult } from "@/domain/commercial-action";
import type { ProvenanceRef, ReadModelCurrentness } from "./shared";
import { currentnessFromLastObserved, toProvenanceRefs } from "./shared";

/**
 * `recommendationOnly` is a literal `true`, mirroring the domain's own field
 * of the same name -- a structural guarantee that this read model can never
 * represent an executed communication. See UI-2 section 17: CALL / EMAIL /
 * VERIFY / RESEARCH / WAIT remain operator instructions, never actions this
 * boundary takes on anyone's behalf.
 */
export interface CommercialActionItem {
  readonly opportunityId: string;
  readonly recommendation: string;
  readonly whyNow: string;
  readonly blockers: readonly string[];
  readonly supportingRoute: { readonly type: string; readonly grade: string } | null;
  readonly provenanceRefs: readonly ProvenanceRef[];
  readonly canonicalReadiness: { readonly eligibleTypes: readonly string[]; readonly scoreState: string | null; readonly score: number | null };
  readonly currentness: ReadModelCurrentness;
  readonly recommendationOnly: true;
}

export function assembleCommercialActionItem(result: CommercialActionResult, asOf: Date): CommercialActionItem {
  return {
    opportunityId: result.opportunityId,
    recommendation: result.action,
    whyNow: result.explanation,
    blockers: result.gaps,
    supportingRoute: result.supportingRoute ? { type: result.supportingRoute.type, grade: result.supportingRoute.grade } : null,
    provenanceRefs: toProvenanceRefs({ evidenceIds: result.evidenceIds, claimIds: result.claimIds }),
    canonicalReadiness: {
      eligibleTypes: result.eligibilityBasis.eligibleTypes,
      scoreState: result.scoreBasis.state,
      score: result.scoreBasis.score,
    },
    currentness: currentnessFromLastObserved(asOf, result.asOf),
    recommendationOnly: true,
  };
}
