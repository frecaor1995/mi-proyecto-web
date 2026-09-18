import type { VerificationState } from "./verification";

/**
 * WORKFORCE-TALENT-A3 domain types over the A2-B canonical worker schema.
 * Mirrors the certified design exactly: the root stays a thin identity
 * anchor, every other concern (trade/occupation, skills, credentials,
 * availability, location, work history, contact, compensation) lives in its
 * own normalized shape here, one-to-one with its table.
 *
 * UNKNOWN discipline (mandatory, see A2-A/A3 authorization): "no row exists"
 * must never collapse into a negative fact. `Fact<T>` makes that explicit at
 * the type level -- a caller can never accidentally treat `null` as "known
 * false" the way an ordinary nullable field would silently allow.
 */
export type Fact<T> = { readonly state: "KNOWN"; readonly value: T } | { readonly state: "UNKNOWN" };
export const knownFact = <T>(value: T): Fact<T> => ({ state: "KNOWN", value });
export const unknownFact = <T>(): Fact<T> => ({ state: "UNKNOWN" });

/**
 * Permission-gated slot in the canonical read model. Distinct from `Fact`:
 * `Fact.UNKNOWN` means "no such data exists"; `REDACTED` means "data may
 * exist, but this caller isn't authorized to see it." Collapsing the two
 * into the same shape (or into `null`) would make it impossible for a
 * caller to tell "this worker has no compensation expectation on file" from
 * "you don't have worker_compensation.read" -- exactly the ambiguity this
 * type exists to prevent.
 */
export type PermissionGated<T> = { readonly access: "GRANTED"; readonly value: T } | { readonly access: "REDACTED" };
export const granted = <T>(value: T): PermissionGated<T> => ({ access: "GRANTED", value });
export const redacted = <T>(): PermissionGated<T> => ({ access: "REDACTED" });

export const WORKER_LIFECYCLE_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export type WorkerLifecycleStatus = (typeof WORKER_LIFECYCLE_STATUSES)[number];

export const WORKER_SOURCES_OF_RECORD = ["SELF_REGISTERED", "SOURCED", "IMPORTED", "UNKNOWN"] as const;
export type WorkerSourceOfRecord = (typeof WORKER_SOURCES_OF_RECORD)[number];

export const WORKER_ROLE_DESIGNATIONS = ["PRIMARY", "SECONDARY"] as const;
export type WorkerRoleDesignation = (typeof WORKER_ROLE_DESIGNATIONS)[number];

export const WORKER_AVAILABILITY_STATUSES = ["AVAILABLE", "COMMITTED", "UNAVAILABLE", "UNKNOWN"] as const;
export type WorkerAvailabilityStatus = (typeof WORKER_AVAILABILITY_STATUSES)[number];

export const WORKER_FACT_SOURCES = ["SELF_REPORTED", "OPERATOR_ENTERED", "INFERRED"] as const;
export type WorkerFactSource = (typeof WORKER_FACT_SOURCES)[number];

export const WORKER_CONTACT_ROUTE_TYPES = ["PHONE", "EMAIL", "SMS", "OTHER"] as const;
export type WorkerContactRouteType = (typeof WORKER_CONTACT_ROUTE_TYPES)[number];

export const WORKER_CONSENT_STATES = ["GRANTED", "REVOKED", "UNKNOWN"] as const;
export type WorkerConsentState = (typeof WORKER_CONSENT_STATES)[number];

export const WORKER_CONTACT_LIFECYCLE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type WorkerContactLifecycleStatus = (typeof WORKER_CONTACT_LIFECYCLE_STATUSES)[number];

export const WORKER_COMPENSATION_RATE_TYPES = ["HOURLY", "DAILY", "SALARY", "PROJECT"] as const;
export type WorkerCompensationRateType = (typeof WORKER_COMPENSATION_RATE_TYPES)[number];

/* -------------------------------------------------------------------- */
/* workforce_workers                                                     */
/* -------------------------------------------------------------------- */

export interface WorkerRecord {
  readonly id: string;
  readonly displayName: string;
  readonly lifecycleStatus: WorkerLifecycleStatus;
  readonly profileVerificationState: VerificationState;
  readonly verifiedAt: Date | null;
  readonly sourceOfRecord: WorkerSourceOfRecord;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateWorkerInput {
  readonly displayName: string;
  readonly sourceOfRecord: WorkerSourceOfRecord;
  readonly lifecycleStatus?: WorkerLifecycleStatus;
  readonly profileVerificationState?: VerificationState;
  readonly verifiedAt?: Date | null;
}

/**
 * Only fields the certified design allows to be mutated after creation.
 * lifecycleStatus is the underlying mechanism WorkerService.archiveWorker /
 * reactivateWorker use internally -- no action or UI ever sets it directly
 * through this generic patch; the narrow, transition-checked service
 * methods are the only sanctioned entry point (WORKFORCE-TALENT-A4-R10).
 */
export interface UpdateWorkerInput {
  readonly displayName?: string;
  readonly profileVerificationState?: VerificationState;
  readonly verifiedAt?: Date | null;
  readonly lastSeenAt?: Date;
  readonly lifecycleStatus?: WorkerLifecycleStatus;
}

export interface WorkerSearchFilter {
  readonly lifecycleStatus?: WorkerLifecycleStatus;
  readonly tradeCode?: string;
  readonly occupationCode?: string;
  readonly limit: number;
  readonly offset: number;
}

/* -------------------------------------------------------------------- */
/* worker_trade_occupations                                              */
/* -------------------------------------------------------------------- */

export interface WorkerTradeOccupationRecord {
  readonly workerId: string;
  readonly tradeCode: string;
  readonly occupationCode: string;
  readonly roleDesignation: WorkerRoleDesignation;
  readonly experienceMonths: number | null;
  readonly verificationState: VerificationState;
  readonly sourceEvidenceId: string | null;
  readonly createdAt: Date;
}

export interface AddWorkerTradeOccupationInput {
  readonly workerId: string;
  readonly tradeCode: string;
  readonly occupationCode: string;
  readonly roleDesignation: WorkerRoleDesignation;
  readonly experienceMonths?: number | null;
  readonly verificationState?: VerificationState;
  readonly sourceEvidenceId?: string | null;
}

/* -------------------------------------------------------------------- */
/* worker_skills                                                         */
/* -------------------------------------------------------------------- */

export interface WorkerSkillRecord {
  readonly workerId: string;
  readonly skillCode: string;
  readonly verificationState: VerificationState;
  readonly sourceEvidenceId: string | null;
  /** Never read by matching logic -- informational only. */
  readonly selfReportedNote: string | null;
  readonly createdAt: Date;
}

export interface AddWorkerSkillInput {
  readonly workerId: string;
  readonly skillCode: string;
  readonly verificationState?: VerificationState;
  readonly sourceEvidenceId?: string | null;
  readonly selfReportedNote?: string | null;
}

/* -------------------------------------------------------------------- */
/* worker_credentials                                                    */
/* -------------------------------------------------------------------- */

/**
 * The SAFE shape -- deliberately has no `rawIdentifier` field. This is the
 * only shape any worker read path (repository list, service, read model)
 * ever returns. Writing a raw identifier is still possible via
 * `AddWorkerCredentialInput`, matching the database's own column-level
 * split (INSERT/UPDATE may touch it, ordinary SELECT may not).
 */
export interface WorkerCredentialRecord {
  readonly workerId: string;
  readonly credentialCode: string;
  readonly verificationState: VerificationState;
  readonly verifiedAt: Date | null;
  readonly issuedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly issuingAuthority: string | null;
  readonly sourceEvidenceId: string | null;
  readonly createdAt: Date;
}

export interface AddWorkerCredentialInput {
  readonly workerId: string;
  readonly credentialCode: string;
  readonly verificationState?: VerificationState;
  readonly verifiedAt?: Date | null;
  readonly issuedAt?: Date | null;
  readonly expiresAt?: Date | null;
  readonly issuingAuthority?: string | null;
  /** Write-only. Never returned by any read method in this domain. */
  readonly rawIdentifier?: string | null;
  readonly sourceEvidenceId?: string | null;
}

export interface UpdateWorkerCredentialVerificationInput {
  readonly workerId: string;
  readonly credentialCode: string;
  readonly verificationState: VerificationState;
  readonly verifiedAt?: Date | null;
}

/* -------------------------------------------------------------------- */
/* worker_availability (append-only history)                             */
/* -------------------------------------------------------------------- */

export interface WorkerAvailabilityRecord {
  readonly id: string;
  readonly workerId: string;
  readonly status: WorkerAvailabilityStatus;
  readonly availableFrom: Date | null;
  readonly availableUntil: Date | null;
  readonly source: WorkerFactSource;
  readonly effectiveAt: Date;
  readonly verificationState: VerificationState;
  readonly createdAt: Date;
}

export interface AppendWorkerAvailabilityInput {
  readonly workerId: string;
  readonly status: WorkerAvailabilityStatus;
  readonly availableFrom?: Date | null;
  readonly availableUntil?: Date | null;
  readonly source: WorkerFactSource;
  readonly verificationState?: VerificationState;
}

/* -------------------------------------------------------------------- */
/* worker_locations (append-only, coarse only)                           */
/* -------------------------------------------------------------------- */

export interface WorkerLocationRecord {
  readonly id: string;
  readonly workerId: string;
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly travelWilling: boolean;
  readonly travelRadiusMiles: number | null;
  readonly relocationWilling: boolean;
  readonly effectiveAt: Date;
  readonly source: WorkerFactSource;
  readonly createdAt: Date;
}

export interface AppendWorkerLocationInput {
  readonly workerId: string;
  readonly city?: string | null;
  readonly region?: string | null;
  readonly country?: string | null;
  readonly travelWilling?: boolean;
  readonly travelRadiusMiles?: number | null;
  readonly relocationWilling?: boolean;
  readonly source: WorkerFactSource;
}

/* -------------------------------------------------------------------- */
/* worker_work_history                                                   */
/* -------------------------------------------------------------------- */

export interface WorkerWorkHistoryRecord {
  readonly id: string;
  readonly workerId: string;
  readonly employerLabel: string;
  readonly projectLabel: string | null;
  readonly occupationCode: string | null;
  readonly tradeCode: string | null;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly verificationState: VerificationState;
  readonly sourceEvidenceId: string | null;
  readonly createdAt: Date;
}

export interface AddWorkerWorkHistoryInput {
  readonly workerId: string;
  readonly employerLabel: string;
  readonly projectLabel?: string | null;
  readonly occupationCode?: string | null;
  readonly tradeCode?: string | null;
  readonly startDate?: Date | null;
  readonly endDate?: Date | null;
  readonly verificationState?: VerificationState;
  readonly sourceEvidenceId?: string | null;
}

export interface UpdateWorkerWorkHistoryInput {
  readonly id: string;
  readonly projectLabel?: string | null;
  readonly endDate?: Date | null;
  readonly verificationState?: VerificationState;
}

/* -------------------------------------------------------------------- */
/* worker_contact_routes (highest sensitivity)                           */
/* -------------------------------------------------------------------- */

export interface WorkerContactRouteRecord {
  readonly id: string;
  readonly workerId: string;
  readonly routeType: WorkerContactRouteType;
  readonly target: string;
  readonly preferred: boolean;
  readonly verificationState: VerificationState;
  readonly consentState: WorkerConsentState;
  readonly consentCapturedAt: Date | null;
  readonly consentSource: string | null;
  readonly lifecycleStatus: WorkerContactLifecycleStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AddWorkerContactRouteInput {
  readonly workerId: string;
  readonly routeType: WorkerContactRouteType;
  readonly target: string;
  readonly preferred?: boolean;
  /** A route may be created before consent is captured (default UNKNOWN) --
   * fail-closed means unusable for outreach until explicitly GRANTED, not
   * that a route cannot exist without immediate consent. */
  readonly consentState?: WorkerConsentState;
  readonly consentCapturedAt?: Date | null;
  readonly consentSource?: string | null;
}

export interface UpdateWorkerContactConsentInput {
  readonly id: string;
  readonly consentState: WorkerConsentState;
  readonly consentCapturedAt?: Date | null;
  readonly consentSource?: string | null;
}

/* -------------------------------------------------------------------- */
/* worker_compensation_expectations (append-only, separate permission)   */
/* -------------------------------------------------------------------- */

export interface WorkerCompensationExpectationRecord {
  readonly id: string;
  readonly workerId: string;
  readonly rateType: WorkerCompensationRateType;
  readonly rateMin: number | null;
  readonly ratePreferred: number | null;
  readonly currency: string;
  readonly perDiemRequired: boolean | null;
  readonly overtimeExpectation: string | null;
  readonly travelPayExpectation: string | null;
  readonly negotiable: boolean;
  readonly effectiveAt: Date;
  readonly createdAt: Date;
}

export interface AppendWorkerCompensationExpectationInput {
  readonly workerId: string;
  readonly rateType: WorkerCompensationRateType;
  readonly rateMin?: number | null;
  readonly ratePreferred?: number | null;
  readonly currency?: string;
  readonly perDiemRequired?: boolean | null;
  readonly overtimeExpectation?: string | null;
  readonly travelPayExpectation?: string | null;
  readonly negotiable?: boolean;
}

/* -------------------------------------------------------------------- */
/* Canonical worker profile read model                                   */
/* -------------------------------------------------------------------- */

export interface WorkerContactSummary {
  readonly routes: readonly WorkerContactRouteRecord[];
}

/**
 * The one shape UI/service callers should ever consume. Never a raw join --
 * assembled by the service layer from independently-authorized repository
 * calls. `contact` and `compensation` are `PermissionGated`; every other
 * field is visible to anyone holding `worker_profile.read` (the tier that
 * gates the profile call itself).
 */
export interface WorkerProfile {
  readonly worker: WorkerRecord;
  readonly tradeOccupations: readonly WorkerTradeOccupationRecord[];
  readonly skills: readonly WorkerSkillRecord[];
  readonly credentials: readonly WorkerCredentialRecord[];
  readonly currentAvailability: Fact<WorkerAvailabilityRecord>;
  readonly currentLocation: Fact<WorkerLocationRecord>;
  readonly workHistory: readonly WorkerWorkHistoryRecord[];
  readonly contact: PermissionGated<WorkerContactSummary>;
  readonly compensation: PermissionGated<readonly WorkerCompensationExpectationRecord[]>;
}

/* -------------------------------------------------------------------- */
/* Matching-ready input boundary (consumed by future MATCHING-B1 only)   */
/* -------------------------------------------------------------------- */

/**
 * Documented, not invented: fields future matching will need but this
 * schema does not yet represent. Always present on every DTO instance so a
 * matching engine can never mistake "this build has no known gaps" for "no
 * one has looked."
 */
export const MATCHING_INPUT_KNOWN_GAPS = [
  "WORKER_SHIFT_HOURS_CAPACITY_NOT_REPRESENTED",
  "DEMAND_CANONICAL_COMPENSATION_FIELD_MISSING",
] as const;
export type MatchingInputKnownGap = (typeof MATCHING_INPUT_KNOWN_GAPS)[number];

export interface MatchingReadyTradeOccupation {
  readonly tradeCode: string;
  readonly occupationCode: string;
  readonly roleDesignation: WorkerRoleDesignation;
  readonly experienceMonths: number | null;
}

export interface MatchingReadyCredential {
  readonly credentialCode: string;
  readonly verificationState: VerificationState;
  readonly expiresAt: Date | null;
}

export interface MatchingReadyAvailability {
  readonly status: WorkerAvailabilityStatus;
  readonly availableFrom: Date | null;
}

export interface MatchingReadyLocation {
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly travelWilling: boolean;
  readonly travelRadiusMiles: number | null;
  readonly relocationWilling: boolean;
}

export interface MatchingReadyCompensation {
  readonly rateType: WorkerCompensationRateType;
  readonly rateMin: number | null;
  readonly ratePreferred: number | null;
  readonly currency: string;
  readonly perDiemRequired: boolean | null;
}

/**
 * Pure, deterministic input for a future matching engine. No scoring, no
 * ranking, no STRONG_MATCH/POSSIBLE_MATCH/NO_MATCH/INSUFFICIENT_DATA
 * classification -- that logic belongs entirely to MATCHING-B1, not here.
 */
export interface MatchingReadyWorkerInput {
  readonly workerId: string;
  readonly tradeOccupations: readonly MatchingReadyTradeOccupation[];
  readonly skillCodes: readonly string[];
  readonly credentials: readonly MatchingReadyCredential[];
  readonly availability: Fact<MatchingReadyAvailability>;
  readonly location: Fact<MatchingReadyLocation>;
  readonly compensation: Fact<MatchingReadyCompensation>;
  readonly knownGaps: readonly MatchingInputKnownGap[];
}

/* -------------------------------------------------------------------- */
/* Errors                                                                 */
/* -------------------------------------------------------------------- */

/**
 * Deliberately carries only a fixed, PII-free `code` plus a static
 * developer-facing `detail` string that never interpolates a caller-
 * supplied value (name, phone, email, address, credential identifier).
 */
export class WorkerValidationError extends Error {
  constructor(readonly code: string, detail: string) {
    super(detail);
    this.name = "WorkerValidationError";
  }
}
