import type { MatchOutcome } from "./matching-engine";
import type { WorkerLifecycleStatus } from "./worker";

export const ENGAGEMENT_SELECTION_STATES = ["REVIEWING", "SHORTLISTED", "SELECTED", "NOT_SELECTED"] as const;
export type EngagementSelectionState = (typeof ENGAGEMENT_SELECTION_STATES)[number];
export const ENGAGEMENT_CONTACT_STATES = ["NOT_STARTED", "PLANNED", "ATTEMPTED", "AWAITING_RESPONSE", "RESPONSE_RECEIVED", "BLOCKED"] as const;
export type EngagementContactState = (typeof ENGAGEMENT_CONTACT_STATES)[number];
export const ENGAGEMENT_RESPONSE_STATES = ["UNKNOWN", "NO_RESPONSE", "NEEDS_INFORMATION", "INTERESTED", "NOT_INTERESTED"] as const;
export type EngagementResponseState = (typeof ENGAGEMENT_RESPONSE_STATES)[number];
export const ENGAGEMENT_AVAILABILITY_STATES = ["UNKNOWN", "CONFIRMED_AVAILABLE", "CONFIRMED_UNAVAILABLE"] as const;
export type EngagementAvailabilityState = (typeof ENGAGEMENT_AVAILABILITY_STATES)[number];
export const ENGAGEMENT_RESOLUTION_STATES = ["UNKNOWN", "NOT_REQUIRED", "COMPATIBLE", "ACCEPTED_CONFLICT", "UNRESOLVED_CONFLICT"] as const;
export type EngagementResolutionState = (typeof ENGAGEMENT_RESOLUTION_STATES)[number];
export const ENGAGEMENT_MOBILIZATION_STATES = ["NOT_READY", "CANDIDATE", "REVIEW_REQUIRED"] as const;
export type EngagementMobilizationState = (typeof ENGAGEMENT_MOBILIZATION_STATES)[number];
export const ENGAGEMENT_CLOSURE_REASONS = ["NOT_SELECTED", "WORKER_DECLINED", "WORKER_UNAVAILABLE", "WORKER_INACTIVE", "WORKER_ARCHIVED", "DEMAND_TERMINAL", "OTHER"] as const;
export type EngagementClosureReason = (typeof ENGAGEMENT_CLOSURE_REASONS)[number];
export const ENGAGEMENT_EVENT_TYPES = ["ENGAGEMENT_CREATED", "REVIEW_STARTED", "SELECTION_CHANGED", "CONTACT_PLANNED", "CONTACT_ATTEMPT_RECORDED", "RESPONSE_RECORDED", "DEMAND_AVAILABILITY_CHANGED", "RESOLUTIONS_CHANGED", "MOBILIZATION_CHANGED", "MATCH_REVIEW_REQUIRED", "WORKER_LIFECYCLE_REVIEW_REQUIRED", "ENGAGEMENT_CLOSED", "ENGAGEMENT_REOPENED"] as const;
export type EngagementEventType = (typeof ENGAGEMENT_EVENT_TYPES)[number];
export type EngagementContactOutcome = "NO_ANSWER" | "VOICEMAIL_LEFT" | "MESSAGE_SENT" | "EMAIL_SENT" | "WRONG_ROUTE" | "CONVERSATION_COMPLETED" | "RESPONSE_RECEIVED";

export interface WorkerDemandEngagement {
  readonly id: string; readonly demandSignalId: string; readonly workerId: string; readonly opportunityId: string | null;
  readonly originatingMatchResultId: string | null; readonly selectionState: EngagementSelectionState; readonly contactState: EngagementContactState;
  readonly responseState: EngagementResponseState; readonly demandAvailabilityState: EngagementAvailabilityState;
  readonly availableFrom: Date | null; readonly availableUntil: Date | null;
  readonly compensationResolutionState: EngagementResolutionState; readonly travelResolutionState: EngagementResolutionState;
  readonly mobilizationState: EngagementMobilizationState; readonly closedAt: Date | null; readonly closureReason: EngagementClosureReason | null;
  readonly createdByOperatorId: string; readonly updatedByActorType: "OPERATOR" | "SYSTEM"; readonly updatedByOperatorId: string | null;
  readonly version: number; readonly createdAt: Date; readonly updatedAt: Date;
}

export interface WorkerDemandEngagementEvent {
  readonly id: string; readonly engagementId: string; readonly engagementVersion: number; readonly eventType: EngagementEventType;
  readonly actorType: "OPERATOR" | "SYSTEM"; readonly actorOperatorId: string | null; readonly occurredAt: Date;
  readonly stateDimension: "SELECTION" | "CONTACT" | "RESPONSE" | "AVAILABILITY" | "RESOLUTIONS" | "MOBILIZATION" | "ENGAGEMENT" | null;
  readonly previousState: string | null; readonly newState: string | null; readonly workerContactRouteId: string | null;
  readonly routeTypeSnapshot: "PHONE" | "EMAIL" | "SMS" | "OTHER" | null; readonly consentStateSnapshot: "GRANTED" | "REVOKED" | "UNKNOWN" | null;
  readonly routeLifecycleSnapshot: "ACTIVE" | "INACTIVE" | null; readonly contactDirection: "OUTBOUND" | "INBOUND" | null;
  readonly contactOutcome: EngagementContactOutcome | null; readonly availableFrom: Date | null; readonly availableUntil: Date | null;
  readonly matchResultId: string | null; readonly commandIdempotencyKeyId: string; readonly reasonCode: string | null;
  readonly notes: string | null; readonly metadata: Readonly<Record<string, unknown>>; readonly createdAt: Date;
}

const selectionTransitions: Readonly<Record<EngagementSelectionState, readonly EngagementSelectionState[]>> = {
  REVIEWING: ["SHORTLISTED", "SELECTED", "NOT_SELECTED"], SHORTLISTED: ["REVIEWING", "SELECTED", "NOT_SELECTED"],
  SELECTED: ["NOT_SELECTED"], NOT_SELECTED: ["REVIEWING"],
};
const contactTransitions: Readonly<Record<EngagementContactState, readonly EngagementContactState[]>> = {
  NOT_STARTED: ["PLANNED", "ATTEMPTED", "BLOCKED"], PLANNED: ["ATTEMPTED", "BLOCKED"],
  ATTEMPTED: ["AWAITING_RESPONSE", "RESPONSE_RECEIVED", "PLANNED", "BLOCKED"],
  AWAITING_RESPONSE: ["ATTEMPTED", "RESPONSE_RECEIVED", "BLOCKED"], RESPONSE_RECEIVED: ["PLANNED", "ATTEMPTED", "BLOCKED"], BLOCKED: ["PLANNED"],
};
export const canTransitionSelection = (from: EngagementSelectionState, to: EngagementSelectionState) => selectionTransitions[from].includes(to);
export const canTransitionContact = (from: EngagementContactState, to: EngagementContactState) => contactTransitions[from].includes(to);

export interface MobilizationFacts {
  readonly engagementOpen: boolean; readonly selectionState: EngagementSelectionState; readonly workerLifecycle: WorkerLifecycleStatus;
  readonly validConsentedContactOccurred: boolean; readonly consentStillGranted: boolean; readonly responseState: EngagementResponseState;
  readonly availabilityState: EngagementAvailabilityState; readonly availabilitySatisfiesStart: boolean; readonly demandActionable: boolean;
  readonly currentMatchOutcome: MatchOutcome | null; readonly hardViolation: boolean;
  readonly compensationResolution: EngagementResolutionState; readonly travelResolution: EngagementResolutionState;
}
export function mobilizationBlockers(facts: MobilizationFacts): string[] {
  const blockers: string[] = [];
  if (!facts.engagementOpen) blockers.push("ENGAGEMENT_CLOSED");
  if (facts.selectionState !== "SELECTED") blockers.push("WORKER_NOT_SELECTED");
  if (facts.workerLifecycle !== "ACTIVE") blockers.push("WORKER_NOT_ACTIVE");
  if (!facts.validConsentedContactOccurred || !facts.consentStillGranted) blockers.push("CONSENTED_CONTACT_REQUIRED");
  if (facts.responseState !== "INTERESTED") blockers.push("WORKER_INTEREST_REQUIRED");
  if (facts.availabilityState !== "CONFIRMED_AVAILABLE" || !facts.availabilitySatisfiesStart) blockers.push("DEMAND_AVAILABILITY_REQUIRED");
  if (!facts.demandActionable) blockers.push("DEMAND_NOT_ACTIONABLE");
  if (facts.currentMatchOutcome === null || facts.currentMatchOutcome === "NO_MATCH" || facts.currentMatchOutcome === "INSUFFICIENT_DATA") blockers.push("CURRENT_MATCH_NOT_VIABLE");
  if (facts.hardViolation) blockers.push("HARD_MATCH_VIOLATION");
  if (!["NOT_REQUIRED", "COMPATIBLE", "ACCEPTED_CONFLICT"].includes(facts.compensationResolution)) blockers.push("COMPENSATION_UNRESOLVED");
  if (!["NOT_REQUIRED", "COMPATIBLE", "ACCEPTED_CONFLICT"].includes(facts.travelResolution)) blockers.push("TRAVEL_UNRESOLVED");
  return blockers;
}
export const requiresMobilizationReview = (outcome: MatchOutcome | null, hardViolation: boolean, workerLifecycle: WorkerLifecycleStatus, demandActionable: boolean) =>
  outcome === null || outcome === "NO_MATCH" || outcome === "INSUFFICIENT_DATA" || hardViolation || workerLifecycle !== "ACTIVE" || !demandActionable;
