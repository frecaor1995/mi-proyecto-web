import type { CapturedPayload } from "./evidence";
import type { CaptureMethod, CapturePolicyResultValue, SourceRecord } from "./source";

export const NORMALIZED_ROLE_TYPES = [
  "APPRENTICE_ELECTRICIAN",
  "ELECTRICIAN",
  "JOURNEYMAN_ELECTRICIAN",
  "INDUSTRIAL_ELECTRICIAN",
  "E_AND_I",
  "INSTRUMENTATION",
  "ELECTRICAL_TECHNICIAN",
  "FOREMAN",
  "GENERAL_FOREMAN",
  "SUPERINTENDENT",
  "OTHER",
] as const;

export const INGESTION_STATUSES = [
  "POLICY_DENIED",
  "REVIEW_REQUIRED",
  "CAPTURE_FAILED",
  "PARSE_FAILED",
  "VALIDATION_FAILED",
  "SUCCESS",
] as const;

export type NormalizedRoleType = (typeof NORMALIZED_ROLE_TYPES)[number];
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

export interface CaptureAdapterRequest {
  source: SourceRecord;
  target: string;
  method: CaptureMethod;
}

export interface CapturedResource {
  sourceUrl: string;
  capturedAt: Date;
  payload: CapturedPayload;
  contentType?: string;
  httpMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CaptureAdapter {
  readonly id: string;
  supports(method: CaptureMethod): boolean;
  capture(request: CaptureAdapterRequest): Promise<CapturedResource>;
}

export interface NormalizedDemandSignal {
  externalPostingId: string | null;
  originalTitle: string;
  roleType: NormalizedRoleType;
  unresolvedPublisherName: string | null;
  publisherType: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  payCurrency: string | null;
  basePayMin: number | null;
  basePayMax: number | null;
  payPeriod: string | null;
  overtimeAvailable: boolean | null;
  overtimeTerms: string | null;
  perDiemAvailable: boolean | null;
  perDiemAmount: number | null;
  perDiemFrequency: string | null;
  schedule: string | null;
  headcountEstimate: number | null;
  publishedAt: Date | null;
  sourceCompensationText: string | null;
  metadata: Record<string, unknown>;
}

export interface DemandSignalParser {
  readonly id: string;
  readonly version: string;
  parse(resource: CapturedResource): NormalizedDemandSignal;
}

export interface IngestionRequest {
  sourceId: string;
  target: string;
  method: CaptureMethod;
  adapter: CaptureAdapter;
  parser: DemandSignalParser;
}

export interface IngestionOutcome {
  status: IngestionStatus;
  auditId: string;
  evidenceId: string | null;
  demandSignalId: string | null;
  reason: string | null;
}

export interface IngestionAttemptRecord {
  sourceId: string;
  requestedMethod: CaptureMethod;
  policyResult: CapturePolicyResultValue;
  policyDecisionId: string | null;
  adapterId: string;
  requestedTarget: string;
  status: IngestionStatus;
  startedAt: Date;
  endedAt: Date;
  rawEvidenceId: string | null;
  demandSignalId: string | null;
  externalPostingId: string | null;
  sourceIdentityKey: string | null;
  failureReason: string | null;
  parserVersion: string;
  metadata?: Record<string, unknown>;
}

export interface PersistDemandSignalInput {
  sourceId: string;
  rawEvidenceId: string;
  sourceIdentityKey: string;
  parserVersion: string;
  observedAt: Date;
  signal: NormalizedDemandSignal;
}
