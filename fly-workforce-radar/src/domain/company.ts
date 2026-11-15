import type { AssertionKind, CompanyRole, VerificationState } from "./database";

export const COMPANY_RESOLUTION_RESULTS = [
  "RESOLVED_EXACT", "RESOLVED_ALIAS", "AMBIGUOUS", "UNRESOLVED",
] as const;
export const COMPANY_RESOLUTION_METHODS = [
  "NORMALIZED_NAME", "VERIFIED_ALIAS", "MANUAL_OVERRIDE", "NO_MATCH", "PLACEHOLDER_REJECTED",
] as const;

export type CompanyResolutionResult = (typeof COMPANY_RESOLUTION_RESULTS)[number];
export type CompanyResolutionMethod = (typeof COMPANY_RESOLUTION_METHODS)[number];

export interface CompanyRecord {
  id: string;
  legalName: string | null;
  commonName: string | null;
  normalizedLegalName: string | null;
  normalizedCommonName: string | null;
  mergedIntoCompanyId: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface CompanyAliasRecord {
  id: string;
  companyId: string;
  alias: string;
  normalizedAlias: string;
  verificationState: VerificationState;
  evidenceId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  supersededByAliasId: string | null;
}

export interface CompanyResolution {
  id: string;
  observedText: string;
  normalizedText: string | null;
  result: CompanyResolutionResult;
  method: CompanyResolutionMethod;
  companyId: string | null;
  candidateCompanyIds: string[];
  reason: string;
  claimId: string | null;
  evidenceId: string | null;
}

export type RoleContext =
  | { type: "DEMAND_SIGNAL"; id: string }
  | { type: "PROJECT"; id: string }
  | { type: "OPPORTUNITY"; id: string };

export type CompanyRoleBasis =
  | "EXPLICIT_EMPLOYER"
  | "EXPLICIT_STAFFING_PUBLISHER"
  | "EXPLICIT_CONTEXTUAL_ROLE"
  | "JOB_PUBLISHER_ONLY"
  | "SUPPLIER_PORTAL_ONLY";

export interface CompanyRoleAssignment {
  companyId: string;
  role: CompanyRole;
  context: RoleContext;
  evidenceId: string;
  claimId?: string | null;
  assertionKind: AssertionKind;
  verificationState?: VerificationState;
  basis: CompanyRoleBasis;
  actor: string;
  observedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CompanyRoleRecord extends CompanyRoleAssignment {
  id: string;
  verificationState: VerificationState;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
