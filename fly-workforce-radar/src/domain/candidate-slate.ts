import type { MatchOutcome } from "./matching-engine";
import type {
  EngagementAvailabilityState, EngagementContactState, EngagementMobilizationState,
  EngagementResolutionState, EngagementResponseState, EngagementSelectionState,
} from "./worker-demand-engagement";
import type { WorkerLifecycleStatus } from "./worker";

export type CandidateSlateGroup = "CANDIDATE" | "SELECTED" | "IN_PROGRESS" | "BLOCKED";

export interface CandidateSlateQualification {
  readonly code: string;
  readonly labelEn: string;
  readonly labelEs: string;
  readonly verificationState: string;
}

export interface CandidateSlateWorker {
  readonly workerId: string;
  readonly displayName: string;
  readonly lifecycle: WorkerLifecycleStatus;
  readonly tradeCode: string | null;
  readonly tradeLabelEn: string | null;
  readonly tradeLabelEs: string | null;
  readonly occupationCode: string | null;
  readonly occupationLabelEn: string | null;
  readonly occupationLabelEs: string | null;
  readonly experienceMonths: number | null;
  readonly skills: readonly CandidateSlateQualification[];
  readonly credentials: readonly CandidateSlateQualification[];
  readonly matchOutcome: MatchOutcome | null;
  readonly matchReasons: readonly string[];
  readonly matchEvaluatedAt: string | null;
  readonly engagementId: string | null;
  readonly selectionState: EngagementSelectionState | null;
  readonly contactState: EngagementContactState | null;
  readonly responseState: EngagementResponseState | null;
  readonly availabilityState: EngagementAvailabilityState | null;
  readonly availableFrom: string | null;
  readonly availableUntil: string | null;
  readonly compensationState: EngagementResolutionState | null;
  readonly travelState: EngagementResolutionState | null;
  readonly mobilizationState: EngagementMobilizationState | null;
  readonly blockers: readonly string[];
  readonly group: CandidateSlateGroup;
  readonly nextAction: string;
}

export interface CandidateSlateDemand {
  readonly demandId: string;
  readonly tradeCode: string | null;
  readonly tradeLabelEn: string | null;
  readonly tradeLabelEs: string | null;
  readonly occupationCode: string | null;
  readonly occupationLabelEn: string | null;
  readonly occupationLabelEs: string | null;
  readonly requestedHeadcount: number | null;
  readonly startDate: string | null;
  readonly location: string | null;
  readonly matchingCount: number;
  readonly engagedCount: number;
  readonly selectedCount: number;
  readonly candidateCount: number;
  readonly remainingPositions: number | null;
  readonly surplusCandidates: number;
  readonly workers: readonly CandidateSlateWorker[];
}

export interface CandidateSlate {
  readonly opportunityId: string;
  readonly opportunityTitle: string | null;
  readonly customer: string | null;
  readonly project: string | null;
  readonly location: string | null;
  readonly demands: readonly CandidateSlateDemand[];
}

export type CandidateSlatePageData =
  | { readonly state: "READY"; readonly slate: CandidateSlate }
  | { readonly state: "NOT_FOUND" | "RESTRICTED" | "UNAVAILABLE" | "ERROR"; readonly slate: null };
