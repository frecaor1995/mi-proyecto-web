import type { ClaimCandidate } from "./claims";
import type { VerificationTargetType } from "./verification";
import type { OccupationId, TradeId } from "./workforce-taxonomy";

export const HUMAN_VERIFICATION_TASK_STATUSES = [
  "OPEN", "ASSIGNED", "ATTEMPTED", "AWAITING_RESPONSE", "FOLLOW_UP_REQUIRED",
  "READY_FOR_ASSESSMENT", "READY_FOR_APPROVAL", "COMPLETED",
  "CANCELLED", "DUPLICATE", "UNRESOLVABLE",
] as const;
export const TERMINAL_HUMAN_VERIFICATION_TASK_STATUSES = ["COMPLETED", "CANCELLED", "DUPLICATE", "UNRESOLVABLE"] as const;
export const HUMAN_VERIFICATION_QUESTION_TYPES = [
  "CLAIM_CONFIRMATION", "BLOCKER_RESOLUTION", "CONTACT_ROUTE", "CONTACT_AUTHORITY",
  "MANPOWER_ACCEPTANCE", "RELATIONSHIP", "QUALIFICATION_REQUIREMENT", "OTHER",
] as const;
export const HUMAN_INTERACTION_METHODS = ["PHONE", "EMAIL", "IN_PERSON", "VIDEO", "OTHER"] as const;
export const HUMAN_INTERACTION_DIRECTIONS = ["OUTBOUND", "INBOUND"] as const;
export const HUMAN_INTERACTION_OUTCOMES = [
  "NO_ANSWER", "VOICEMAIL_LEFT", "WRONG_NUMBER", "EMAIL_SENT", "EMAIL_BOUNCED",
  "RECEPTION_REACHED", "TRANSFERRED", "REFERRAL_RECEIVED", "DECISION_MAKER_REACHED",
  "EMAIL_RESPONSE_RECEIVED", "CONVERSATION_COMPLETED", "DECLINED_TO_ANSWER",
] as const;
export const SUBSTANTIVE_HUMAN_INTERACTION_OUTCOMES = [
  "DECISION_MAKER_REACHED", "EMAIL_RESPONSE_RECEIVED", "CONVERSATION_COMPLETED", "DECLINED_TO_ANSWER",
] as const;
export const HUMAN_ANSWER_DISPOSITIONS = [
  "AFFIRMATIVE", "NEGATIVE", "REFERRAL", "CONFIDENTIAL_NO_DISCLOSURE",
  "UNKNOWN_DONT_KNOW", "QUALIFIED_OR_CONDITIONAL", "OTHER",
] as const;
export const HUMAN_COMMERCIAL_MECHANISMS = [
  "DIRECT_EXTERNAL_MANPOWER", "MSP_OR_STAFFING_PROGRAM", "FULL_SCOPE_SUBCONTRACTORS_ONLY",
  "DIRECT_HIRE_INTERNAL_ONLY", "NO_EXTERNAL_MANPOWER", "WORKFORCE_PARTNER_OR_SUBVENDOR",
  "RECRUITING_ONLY", "PAYROLL_ONLY", "OTHER_MECHANISM", "MECHANISM_UNKNOWN",
] as const;
export const HUMAN_AUTHORITY_LEVELS = [
  "UNKNOWN", "ROUTING_ONLY", "SUBJECT_MATTER_INFORMED", "PROCESS_PARTICIPANT",
  "DECISION_PATH_AUTHORITY", "AUTHORIZED_COMPANY_AUTHORITY",
] as const;
export const HUMAN_ASSESSMENT_APPROVAL_STATES = [
  "PROPOSED", "HUMAN_REVIEW_REQUIRED", "APPROVED", "REJECTED", "NEEDS_MORE_EVIDENCE", "SUPERSEDED",
] as const;
export const HUMAN_ACTOR_KINDS = ["HUMAN", "SOFTWARE"] as const;
export const HUMAN_VERIFICATION_TASK_EVENT_TYPES = [
  "CREATED", "STATE_CHANGED", "ASSIGNED", "DUE_DATE_CHANGED", "FOLLOW_UP_CREATED", "MATERIAL_CHANGE",
] as const;

export type HumanVerificationTaskStatus = (typeof HUMAN_VERIFICATION_TASK_STATUSES)[number];
export type HumanVerificationQuestionType = (typeof HUMAN_VERIFICATION_QUESTION_TYPES)[number];
export type HumanInteractionMethod = (typeof HUMAN_INTERACTION_METHODS)[number];
export type HumanInteractionDirection = (typeof HUMAN_INTERACTION_DIRECTIONS)[number];
export type HumanInteractionOutcome = (typeof HUMAN_INTERACTION_OUTCOMES)[number];
export type HumanAnswerDisposition = (typeof HUMAN_ANSWER_DISPOSITIONS)[number];
export type HumanCommercialMechanism = (typeof HUMAN_COMMERCIAL_MECHANISMS)[number];
export type HumanAuthorityLevel = (typeof HUMAN_AUTHORITY_LEVELS)[number];
export type HumanAssessmentApprovalState = (typeof HUMAN_ASSESSMENT_APPROVAL_STATES)[number];
export type HumanActorKind = (typeof HUMAN_ACTOR_KINDS)[number];
export type HumanVerificationTaskEventType = (typeof HUMAN_VERIFICATION_TASK_EVENT_TYPES)[number];

export interface HumanVerificationScope {
  companyScope?: "COMPANYWIDE" | "DIVISION" | "SUBSIDIARY" | "UNKNOWN";
  divisionOrSubsidiary?: string;
  projectId?: string;
  geographicScope?: string;
  tradeId?: TradeId;
  occupationId?: OccupationId;
  commercialMechanism?: HumanCommercialMechanism;
  effectiveFrom?: string;
  effectiveUntil?: string;
  exclusions?: string[];
  exactText?: string;
}

export interface CreateHumanVerificationTaskInput {
  companyId: string;
  targetType: VerificationTargetType;
  targetId: string;
  verificationObjective: string;
  questionType: HumanVerificationQuestionType;
  primaryQuestion: string;
  createdBy: string;
  ruleVersion: string;
  opportunityId?: string | null;
  projectId?: string | null;
  claimId?: string | null;
  blockerCode?: string | null;
  contactPersonId?: string | null;
  contactRouteId?: string | null;
  followUpQuestion?: string | null;
  preferredMethod?: HumanInteractionMethod | null;
  assignedOperatorId?: string | null;
  dueAt?: Date | null;
  parentTaskId?: string | null;
  tradeId?: TradeId | null;
  occupationId?: OccupationId | null;
  scope: HumanVerificationScope;
  packetSnapshot?: Record<string, unknown>;
}
export interface HumanVerificationTask extends CreateHumanVerificationTaskInput {
  id: string;
  status: HumanVerificationTaskStatus;
  deduplicationKey: string;
  createdAt: Date;
  closedAt: Date | null;
}

export interface CreateHumanInteractionInput {
  verificationTaskId: string;
  interactionMethod: HumanInteractionMethod;
  interactionOutcome: HumanInteractionOutcome;
  attemptedAt: Date;
  operatorId: string;
  routeSnapshot: Record<string, unknown>;
  reachedHuman: boolean;
  contactRouteId?: string | null;
  contactPersonId?: string | null;
  direction?: HumanInteractionDirection | null;
  personNameSnapshot?: string | null;
  personTitleSnapshot?: string | null;
  departmentSnapshot?: string | null;
  companyRepresentedId?: string | null;
  companyRepresentedText?: string | null;
  responseVerbatim?: string | null;
  responseSummary?: string | null;
  effectiveDateStated?: Date | null;
  artifactStorageReference?: string | null;
  consentOrRecordingNote?: string | null;
  metadata?: Record<string, unknown>;
}
export interface HumanInteraction extends CreateHumanInteractionInput { id: string; createdAt: Date }

export interface CreateHumanResponseAssessmentInput {
  interactionId: string;
  answerDisposition: HumanAnswerDisposition;
  authorityLevel: HumanAuthorityLevel;
  authorityBasis: string;
  scope: HumanVerificationScope;
  confidence: number;
  assessedBy: string;
  assessorKind: HumanActorKind;
  assessedAt: Date;
  approvalState: HumanAssessmentApprovalState;
  ruleVersion: string;
  approvedBy?: string | null;
  commercialMechanism?: HumanCommercialMechanism | null;
  companyId?: string | null;
  projectId?: string | null;
  opportunityId?: string | null;
  tradeId?: TradeId | null;
  occupationId?: OccupationId | null;
  geographicScope?: string | null;
  effectiveFrom?: Date | null;
  effectiveUntil?: Date | null;
  supportedClaimCandidates?: ClaimCandidate[];
  unsupportedClaims?: string[];
  unresolvedClaims?: string[];
  proposedEvidenceId?: string | null;
  conflictIds?: string[];
  followUpRequired?: boolean;
  followUpTarget?: string | null;
  supersedesAssessmentId?: string | null;
  assessmentNotes?: string | null;
}
export interface HumanResponseAssessment extends CreateHumanResponseAssessmentInput { id: string; createdAt: Date }

export interface CreateHumanVerificationTaskEventInput {
  verificationTaskId: string;
  eventType: HumanVerificationTaskEventType;
  oldState: HumanVerificationTaskStatus | null;
  newState: HumanVerificationTaskStatus | null;
  reason: string;
  operatorId: string;
  occurredAt: Date;
  interactionId?: string | null;
  assessmentId?: string | null;
  evidenceIds?: string[];
  claimIds?: string[];
  metadata?: Record<string, unknown>;
}
export interface HumanVerificationTaskEvent extends CreateHumanVerificationTaskEventInput { id: string; createdAt: Date }

export const isSubstantiveHumanInteractionOutcome = (outcome: HumanInteractionOutcome) =>
  (SUBSTANTIVE_HUMAN_INTERACTION_OUTCOMES as readonly string[]).includes(outcome);
