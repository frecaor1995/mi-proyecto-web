import type { AccessClassification } from "./database";

export const SOURCE_TYPES = [
  "JOB_BOARD",
  "CORPORATE_CAREERS",
  "STAFFING_BOARD",
  "SUPPLIER_PORTAL",
  "CORPORATE_WEBSITE",
  "NEWS_PRESS",
  "PUBLIC_RECORD",
  "PUBLIC_SOCIAL",
  "SEARCH_RESULT",
  "OTHER",
] as const;

export const CAPTURE_METHODS = [
  "MANUAL",
  "HTTP_FETCH",
  "API",
  "RSS",
  "HEADLESS_RENDER",
  "CSV_IMPORT",
  "PARTNER_FEED",
] as const;

export const CAPTURE_POLICY_DECISIONS = ["ALLOWED", "DENIED", "REVIEW_REQUIRED"] as const;
export const CAPTURE_POLICY_RESULTS = ["ALLOW", "DENY", "REVIEW_REQUIRED"] as const;
export const COMPLIANCE_REVIEW_STATUSES = [
  "NOT_REVIEWED",
  "APPROVED",
  "RESTRICTED",
  "REVIEW_REQUIRED",
  "UNKNOWN",
] as const;
export const SOURCE_HEALTH_STATUSES = ["HEALTHY", "DEGRADED", "BLOCKED", "UNKNOWN"] as const;
export const TECHNICAL_ACCESS_STATES = [
  "ACCESSIBLE",
  "CONDITIONAL",
  "RESTRICTED",
  "UNKNOWN",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];
export type CapturePolicyDecisionValue = (typeof CAPTURE_POLICY_DECISIONS)[number];
export type CapturePolicyResultValue = (typeof CAPTURE_POLICY_RESULTS)[number];
export type ComplianceReviewStatus = (typeof COMPLIANCE_REVIEW_STATUSES)[number];
export type SourceHealthStatus = (typeof SOURCE_HEALTH_STATUSES)[number];
export type TechnicalAccessState = (typeof TECHNICAL_ACCESS_STATES)[number];

export interface SourceRecord {
  id: string;
  name: string;
  sourceType: string | null;
  domain: string | null;
  baseUrl: string | null;
  accessClassification: AccessClassification;
  enabled: boolean;
  requiresAuth: boolean | null;
  paywalled: boolean | null;
  robotsReviewStatus: ComplianceReviewStatus;
  robotsReviewNotes: string | null;
  tosReviewStatus: ComplianceReviewStatus;
  tosReviewNotes: string | null;
  lastComplianceReviewAt: Date | null;
  nextComplianceReviewDueAt: Date | null;
  healthStatus: SourceHealthStatus;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  sourceMetadata: Record<string, unknown>;
}

export interface CreateSourceInput {
  name: string;
  sourceType?: SourceType | string;
  domain?: string;
  baseUrl?: string;
  accessClassification?: AccessClassification;
  enabled?: boolean;
  requiresAuth?: boolean;
  paywalled?: boolean;
  robotsReviewStatus?: ComplianceReviewStatus;
  robotsReviewNotes?: string;
  tosReviewStatus?: ComplianceReviewStatus;
  tosReviewNotes?: string;
  lastComplianceReviewAt?: Date;
  nextComplianceReviewDueAt?: Date;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  sourceMetadata?: Record<string, unknown>;
}

export interface CapturePolicyDecisionRecord {
  id: string;
  sourceId: string;
  captureMethod: CaptureMethod;
  decision: CapturePolicyDecisionValue;
  reason: string;
  reviewedAt: Date;
  reviewedBy: string;
  validUntil: Date | null;
  reviewDueAt: Date | null;
  policyVersion: string;
  supersedesDecisionId: string | null;
  notes: string | null;
}

export interface RecordCapturePolicyDecisionInput {
  sourceId: string;
  captureMethod: CaptureMethod;
  decision: CapturePolicyDecisionValue;
  reason: string;
  reviewedAt: Date;
  reviewedBy: string;
  validUntil?: Date;
  reviewDueAt?: Date;
  policyVersion: string;
  supersedesDecisionId?: string;
  notes?: string;
}

export interface SourceYieldMeasurementInput {
  sourceId: string;
  opportunitiesObserved?: number;
  validatedSignals?: number;
  verifiedContacts?: number;
  buyerRoutesFound?: number;
  hotACount?: number;
  hotBCount?: number;
  noiseCount?: number;
  lastMeasurementAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CapturePolicyEvaluation {
  result: CapturePolicyResultValue;
  reason: string;
  technicalAccess: TechnicalAccessState;
  decisionId: string | null;
}
