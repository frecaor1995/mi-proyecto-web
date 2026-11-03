import type { MatchOutcome } from "../../../domain/matching-engine";
import type {
  EngagementAvailabilityState, EngagementClosureReason, EngagementContactOutcome, EngagementContactState,
  EngagementEventType, EngagementMobilizationState, EngagementResolutionState, EngagementResponseState,
  EngagementSelectionState, WorkerDemandEngagement, WorkerDemandEngagementEvent,
} from "../../../domain/worker-demand-engagement";
import type { WorkerLifecycleStatus } from "../../../domain/worker";

export interface CreateEngagementRecordInput {
  readonly demandSignalId: string; readonly workerId: string; readonly opportunityId: string | null;
  readonly originatingMatchResultId: string | null; readonly operatorId: string; readonly now: Date;
}
export interface EngagementProjectionPatch {
  readonly selectionState?: EngagementSelectionState; readonly contactState?: EngagementContactState;
  readonly responseState?: EngagementResponseState; readonly demandAvailabilityState?: EngagementAvailabilityState;
  readonly availableFrom?: Date | null; readonly availableUntil?: Date | null;
  readonly compensationResolutionState?: EngagementResolutionState; readonly travelResolutionState?: EngagementResolutionState;
  readonly mobilizationState?: EngagementMobilizationState; readonly closedAt?: Date | null;
  readonly closureReason?: EngagementClosureReason | null;
}
export interface AppendEngagementEventInput {
  readonly engagementId: string; readonly engagementVersion: number; readonly eventType: EngagementEventType;
  readonly actorType: "OPERATOR" | "SYSTEM"; readonly actorOperatorId: string | null; readonly occurredAt: Date;
  readonly stateDimension?: WorkerDemandEngagementEvent["stateDimension"]; readonly previousState?: string | null; readonly newState?: string | null;
  readonly workerContactRouteId?: string | null; readonly routeTypeSnapshot?: WorkerDemandEngagementEvent["routeTypeSnapshot"];
  readonly consentStateSnapshot?: WorkerDemandEngagementEvent["consentStateSnapshot"];
  readonly routeLifecycleSnapshot?: WorkerDemandEngagementEvent["routeLifecycleSnapshot"];
  readonly contactDirection?: "OUTBOUND" | "INBOUND" | null; readonly contactOutcome?: EngagementContactOutcome | null;
  readonly availableFrom?: Date | null; readonly availableUntil?: Date | null; readonly matchResultId?: string | null;
  readonly commandIdempotencyKeyId: string; readonly reasonCode?: string | null; readonly notes?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface ContactRouteFact { readonly id: string; readonly workerId: string; readonly routeType: "PHONE" | "EMAIL" | "SMS" | "OTHER"; readonly consentState: "GRANTED" | "REVOKED" | "UNKNOWN"; readonly lifecycleStatus: "ACTIVE" | "INACTIVE"; }
export interface CurrentMatchFact { readonly id: string; readonly outcome: MatchOutcome; readonly hardViolation: boolean; }
export interface EngagementContextFacts { readonly workerLifecycle: WorkerLifecycleStatus; readonly opportunityLifecycle: "ACTIVE" | "STALE" | "CLOSED" | "UNKNOWN" | null; readonly demandStartDate: Date | null; readonly currentMatch: CurrentMatchFact | null; readonly consentedContactOccurred: boolean; readonly currentContactConsentGranted: boolean; }

export interface WorkerDemandEngagementRepository {
  findById(id: string, forUpdate?: boolean): Promise<WorkerDemandEngagement | null>;
  findByPair(demandSignalId: string, workerId: string): Promise<WorkerDemandEngagement | null>;
  create(input: CreateEngagementRecordInput): Promise<WorkerDemandEngagement>;
  updateProjection(id: string, expectedVersion: number, patch: EngagementProjectionPatch, actorType: "OPERATOR" | "SYSTEM", operatorId: string | null, now: Date): Promise<WorkerDemandEngagement | null>;
  appendEvent(input: AppendEngagementEventInput): Promise<WorkerDemandEngagementEvent>;
  listEvents(engagementId: string): Promise<WorkerDemandEngagementEvent[]>;
  getContactRoute(id: string): Promise<ContactRouteFact | null>;
  getContextFacts(engagement: WorkerDemandEngagement): Promise<EngagementContextFacts | null>;
  getIdempotencyRecordId(key: string): Promise<string>;
}
