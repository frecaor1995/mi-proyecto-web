import type {
  AssertionKind,
  ExternalManpowerCategory,
  VerificationState,
} from "./database";

export const CLAIM_SUBJECT_TYPES = [
  "SOURCE", "RAW_EVIDENCE", "DEMAND_SIGNAL", "COMPANY", "PROJECT",
  "VENDOR_ROUTE", "CONTACT_PERSON", "CONTACT_ROUTE", "DEMAND_CLUSTER", "OPPORTUNITY",
] as const;

export const CLAIM_PREDICATES = [
  "demand_role", "location", "compensation", "overtime_terms", "per_diem",
  "schedule", "headcount", "publisher_identity_text", "project_identity",
  "company_role", "vendor_route", "external_manpower_acceptance_category",
  "contact_identity", "contact_role", "source_recency_status", "demand_intensity_indicator",
  "contractor_project_participation", "commercial_ecosystem_relationship",
  "manpower_vendor_relationship", "workforce_partner_subvendor_relationship",
  "qualification_requirement",
] as const;

export type ClaimSubjectType = (typeof CLAIM_SUBJECT_TYPES)[number];
export type ClaimPredicate = (typeof CLAIM_PREDICATES)[number];
export type ClaimValue = null | boolean | number | string | ClaimValue[] | { [key: string]: ClaimValue };

export const QUALIFICATION_REQUIREMENT_TYPES = [
  "LICENSE", "GENERAL_LIABILITY", "WORKERS_COMPENSATION", "BONDING", "EMR_TRIR",
  "ISNETWORLD", "AVETTA", "PAYROLL_CAPACITY", "SAFETY_PROGRAM",
  "BACKGROUND_DRUG_SCREENING", "OTHER",
] as const;
export type QualificationRequirementType = (typeof QUALIFICATION_REQUIREMENT_TYPES)[number];
export interface QualificationRequirementValue {
  requirementType: QualificationRequirementType;
  requirementText: string;
  flySatisfaction: "UNKNOWN";
  scope?: Record<string, ClaimValue>;
}

export interface ClaimSubject {
  type: ClaimSubjectType;
  id: string;
}

export interface ClaimCandidate {
  subject: ClaimSubject;
  predicate: ClaimPredicate;
  value: ClaimValue;
  assertionKind: AssertionKind;
  externalManpowerCategory?: ExternalManpowerCategory | null;
  evidenceIds?: string[];
  assertedAt?: Date;
  assertedBy?: string;
  staleAfter?: Date | null;
  verificationDueAt?: Date | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ClaimRecord extends Required<Pick<ClaimCandidate, "subject" | "predicate" | "value" | "assertionKind">> {
  id: string;
  identityKey: string;
  verificationState: VerificationState;
  externalManpowerCategory: ExternalManpowerCategory | null;
  assertedAt: Date;
  assertedBy: string | null;
  verifiedAt: Date | null;
  verificationActorReference: string | null;
  staleAfter: Date | null;
  verificationDueAt: Date | null;
  notes: string | null;
  metadata: Record<string, unknown>;
}

export interface ClaimStateTransition {
  claimId: string;
  newState: VerificationState;
  actor: string;
  at: Date;
  reason: string;
  evidenceId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ClaimStateAuditRecord {
  id: string;
  claimId: string;
  priorState: VerificationState;
  newState: VerificationState;
  actor: string;
  transitionedAt: Date;
  reason: string;
  evidenceId: string | null;
  metadata: Record<string, unknown>;
}
