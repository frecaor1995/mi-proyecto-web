import type { HumanReviewQueueItem } from "@/domain/evidence-aggregation";
import type { HumanVerificationQuestionType } from "@/domain/human-verification";
import type { HumanVerificationPacket } from "@/domain/human-verification-planning";
import type { ProvenanceRef, ReadModelCapabilityState, ReadModelCurrentness, ScopeDescriptor } from "./shared";
import { currentnessFromStaleAfter, scopeFromHumanVerificationScope, toProvenanceRefs } from "./shared";

/**
 * Bridges two backend shapes that are not unified today (UI-2 research
 * finding 6): evidence-aggregation.ts's HumanReviewQueueItem, the only
 * backend type that supports a listable queue, and
 * human-verification-planning.ts's HumanVerificationPacket, the only backend
 * type carrying the rich packet fields (question, authorityRequired,
 * doNotClaim, ...). A queue row's packet is therefore optional here and
 * carries its own capabilityState until a backend phase unifies the two.
 */
export interface HumanVerificationQueueItem {
  readonly id: string;
  readonly targetType: string;
  readonly opportunityId: string | null;
  readonly reasonReviewRequired: string;
  readonly affectsGate: string;
  readonly wouldUnlockGate: string | null;
  readonly priority: number;
  readonly priorityReason: string;
  readonly currentness: ReadModelCurrentness;
  readonly provenanceRefs: readonly ProvenanceRef[];
  readonly packetCapabilityState: ReadModelCapabilityState;
}

export function assembleHumanVerificationQueueItem(item: HumanReviewQueueItem, asOf: Date, hasLinkedPacket = false): HumanVerificationQueueItem {
  return {
    id: item.id,
    targetType: item.targetType,
    opportunityId: item.opportunityId,
    reasonReviewRequired: item.reasonReviewRequired,
    affectsGate: item.affectsGate,
    wouldUnlockGate: item.wouldUnlockGate,
    priority: item.priority,
    priorityReason: item.priorityReason,
    currentness: item.isStale ? "STALE" : currentnessFromStaleAfter(asOf, item.staleAfter),
    provenanceRefs: toProvenanceRefs({ evidenceIds: item.evidenceIds, sourceUrls: item.sourceUrls }),
    packetCapabilityState: hasLinkedPacket ? "PARTIAL" : "UNAVAILABLE",
  };
}

export interface HumanVerificationPacketView {
  readonly taskId: string | null;
  readonly status: string;
  readonly dueAt: string | null;
  readonly target: { readonly companyId: string; readonly companyName: string | null; readonly projectId: string | null; readonly opportunityId: string | null };
  readonly whyThisMatters: string;
  /**
   * Canonical semantic question category (domain/human-verification.ts's
   * HumanVerificationQuestionType), sourced from the associated
   * HumanVerificationTask -- not embedded in HumanVerificationPacket itself.
   * `null` when the caller has not supplied it (e.g. no task is available
   * yet), never fabricated. Gives a future localization phase a stable
   * semantic hook alongside the existing generated `primaryQuestion` text,
   * without rewriting that text or touching any backend service.
   */
  readonly questionType: HumanVerificationQuestionType | null;
  readonly primaryQuestion: string;
  readonly followUpQuestion: string | null;
  readonly expectedClassifications: { readonly answerDispositions: readonly string[]; readonly commercialMechanisms: readonly string[] };
  readonly authorityRequired: { readonly minimumLevel: string; readonly warning: string };
  readonly scope: ScopeDescriptor;
  readonly sourceBasis: readonly { readonly summary: string; readonly current: boolean; readonly provenanceRef: ProvenanceRef }[];
  readonly conflicts: readonly { readonly statement: string; readonly evidenceRefs: readonly ProvenanceRef[] }[];
  readonly doNotClaim: readonly string[];
  readonly safetyPrivacy: readonly string[];
  readonly nextAction: string;
  readonly possibleEffects: readonly string[];
}

/** Read-only packet projection. Never records an interaction, assesses a response, or mutates AF01/score/eligibility/HOT -- see UI-2 section 13. */
export function assembleHumanVerificationPacketView(packet: HumanVerificationPacket, questionType: HumanVerificationQuestionType | null = null): HumanVerificationPacketView {
  return {
    taskId: packet.task.id,
    status: packet.task.status,
    dueAt: packet.task.dueAt,
    target: {
      companyId: packet.target.companyId,
      companyName: packet.target.companyName,
      projectId: packet.target.projectId,
      opportunityId: packet.target.opportunityId,
    },
    whyThisMatters: packet.whyThisMatters.blocker,
    questionType,
    primaryQuestion: packet.question.primary,
    followUpQuestion: packet.question.followUp,
    expectedClassifications: {
      answerDispositions: packet.expectedClassifications.answerDispositions,
      commercialMechanisms: packet.expectedClassifications.commercialMechanisms,
    },
    authorityRequired: { minimumLevel: packet.authorityRequired.minimumLevel, warning: packet.authorityRequired.warning },
    scope: scopeFromHumanVerificationScope(packet.scopeToConfirm),
    sourceBasis: packet.sourceBasis.map((basis) => ({
      summary: basis.summary,
      current: basis.current,
      provenanceRef: { evidenceId: basis.evidenceId, claimId: basis.claimId ?? null, sourceUrl: basis.sourceUrl ?? null },
    })),
    conflicts: packet.conflicts.map((conflict) => ({
      statement: conflict.statement,
      evidenceRefs: toProvenanceRefs({ evidenceIds: conflict.evidenceIds }),
    })),
    doNotClaim: packet.doNotClaim,
    safetyPrivacy: packet.safetyPrivacy,
    nextAction: packet.nextAction,
    possibleEffects: packet.possibleEffects,
  };
}
