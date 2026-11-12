import type { HumanAuthorityLevel, HumanAnswerDisposition, HumanCommercialMechanism, HumanInteractionMethod, HumanVerificationScope, HumanVerificationTask } from "./human-verification";
import type { PersistedManpowerAcceptanceResult } from "./manpower-acceptance";
import type { VerificationTargetType } from "./verification";
import type { OccupationId, TradeId } from "./workforce-taxonomy";

export const HUMAN_VERIFICATION_NEEDS = [
  "MISSING_ACTIONABLE_CONTACT", "EXTERNAL_MANPOWER_ACCEPTANCE_UNKNOWN", "EXTERNAL_MANPOWER_ACCEPTANCE_CONFLICT",
  "BUYER_AUTHORITY_UNKNOWN", "CONTACT_AUTHORITY_UNKNOWN", "VENDOR_ROUTE_UNKNOWN", "RELATIONSHIP_UNVERIFIED",
  "PROJECT_COMPANY_LINK_UNVERIFIED", "WORKFORCE_PARTNER_RELATIONSHIP_UNVERIFIED", "QUALIFICATION_REQUIREMENT_UNKNOWN",
  "QUALIFICATION_ROUTE_UNKNOWN", "STALE_COMMERCIAL_EVIDENCE", "HUMAN_CONFIRMATION_REQUIRED",
] as const;
export const HUMAN_VERIFICATION_PLANNING_DISPOSITIONS = [
  "READY", "NOT_READY", "NEEDS_TARGET_RESOLUTION", "NEEDS_CONTACT_ROUTE", "PUBLIC_RESEARCH_REQUIRED",
  "DUPLICATE_OPEN_TASK", "ALREADY_RESOLVED", "NOT_HUMAN_VERIFICATION_PROBLEM", "PROHIBITED_OUTREACH",
] as const;
export const HUMAN_VERIFICATION_PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export const HUMAN_VERIFICATION_NEXT_ACTIONS = ["CALL", "EMAIL", "FIND_BETTER_ROUTE", "VERIFY_DEPARTMENT", "PUBLIC_RESEARCH_FIRST", "WAIT_FOR_RESPONSE"] as const;

export type HumanVerificationNeed = (typeof HUMAN_VERIFICATION_NEEDS)[number];
export type HumanVerificationPlanningDisposition = (typeof HUMAN_VERIFICATION_PLANNING_DISPOSITIONS)[number];
export type HumanVerificationPriority = (typeof HUMAN_VERIFICATION_PRIORITIES)[number];
export type HumanVerificationNextAction = (typeof HUMAN_VERIFICATION_NEXT_ACTIONS)[number];

export interface VerificationSourceBasis { evidenceId: string; claimId?: string | null; sourceUrl?: string | null; sourceLabel?: string | null; observedAt?: string | null; current: boolean; scope?: HumanVerificationScope; summary: string }
export interface VerificationConflictSide { statement: string; evidenceIds: string[]; observedAt?: string | null; scope: HumanVerificationScope }
export interface VerificationPlanningContact { personId?: string | null; name?: string | null; title?: string | null; department?: string | null; routeId?: string | null; routeType?: string | null; routeTarget?: string | null; routeVerificationState?: string | null; routeCurrent?: boolean; preferredMethod?: HumanInteractionMethod | null }
export interface HumanVerificationPlanningInput {
  need: HumanVerificationNeed; companyId?: string | null; companyName?: string | null; opportunityId?: string | null;
  opportunityTitle?: string | null; projectId?: string | null; projectName?: string | null; claimId?: string | null;
  targetType?: VerificationTargetType; targetId?: string | null; blockerCode?: string | null; tradeId?: TradeId | null;
  occupationId?: OccupationId | null; scope: HumanVerificationScope; sourceBasis: VerificationSourceBasis[];
  conflicts?: VerificationConflictSide[]; contact?: VerificationPlanningContact | null; currentAf01Result?: PersistedManpowerAcceptanceResult | null;
  currentAf01Scope?: HumanVerificationScope | null;
  currentAf01ValidUntil?: Date | null; governedStateResolved?: boolean; publicEvidenceExhausted: boolean;
  internalSoftwareDefect?: boolean; prohibitedOutreach?: boolean; commerciallyMaterial: boolean; nearHotEligibility?: boolean;
  urgentTemporalWindow?: boolean; staleOrConflicting?: boolean; createdBy: string; assignedOperatorId?: string | null; dueAt?: Date | null;
}
export interface HumanVerificationPacket {
  task: { id: string | null; status: string; createdAt: string | null; dueAt: string | null; assignedOperatorId: string | null; verificationObjective: string };
  target: { companyId: string; companyName: string | null; projectId: string | null; projectName: string | null; opportunityId: string | null; opportunityTitle: string | null; tradeId: TradeId | null; occupationId: OccupationId | null; person: VerificationPlanningContact | null };
  whyThisMatters: { blocker: string; commercialQuestion: string; currentCanonicalState: string; publicEvidenceInsufficientReason: string };
  question: { primary: string; followUp: string | null };
  expectedClassifications: { answerDispositions: HumanAnswerDisposition[]; commercialMechanisms: HumanCommercialMechanism[] };
  authorityRequired: { minimumLevel: HumanAuthorityLevel; evidenceToCapture: string[]; warning: string };
  scopeToConfirm: HumanVerificationScope;
  possibleEffects: string[]; sourceBasis: VerificationSourceBasis[]; conflicts: VerificationConflictSide[];
  doNotClaim: string[]; safetyPrivacy: string[]; nextAction: HumanVerificationNextAction;
}
export interface HumanVerificationPlan {
  verificationRequired: boolean; disposition: HumanVerificationPlanningDisposition; priority: HumanVerificationPriority;
  readinessToExecute: boolean; missingPrerequisites: string[]; blocker: string; targetType: VerificationTargetType | null;
  targetId: string | null; packet: HumanVerificationPacket | null; task: HumanVerificationTask | null; created: boolean;
}
