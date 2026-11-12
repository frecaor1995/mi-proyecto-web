import type {
  CompanyAliasRecord,
  CompanyRecord,
  CompanyResolution,
  CompanyResolutionMethod,
  CompanyResolutionResult,
  CompanyRoleAssignment,
  CompanyRoleRecord,
} from "../../../domain/company";

export interface ResolutionAuditInput {
  observedText: string;
  normalizedText: string | null;
  result: CompanyResolutionResult;
  method: CompanyResolutionMethod;
  companyId: string | null;
  candidateCompanyIds: string[];
  actor: string;
  at: Date;
  evidenceId?: string | null;
  claimId?: string | null;
  reason: string;
  confidenceMetadata?: Record<string, unknown>;
  supersedesResolutionId?: string | null;
}

export interface CompanyEnumerationQuery { search: string; asOf: Date; limit: number; offset: number }
export interface CompanyEnumerationEntry {
  company: CompanyRecord;
  relatedOpportunityCount: number;
  contactRouteCount: number;
  hasVerifiedContactRoute: boolean;
  latestManpowerResult: string | null;
  pendingVerificationCount: number;
}

export interface CompanyRepository {
  /** UI-7 addition, mirrors OpportunityRepository.enumerate() (added for UI-4): canonical repositories could resolve a company by name/alias but could not enumerate or load one by its own id. */
  enumerate(input: CompanyEnumerationQuery): Promise<{ items: CompanyEnumerationEntry[]; total: number }>;
  /** UI-7 addition -- no by-id lookup existed on this repository before. */
  getById(id: string): Promise<CompanyRecord | null>;
  findByNormalizedName(normalized: string): Promise<CompanyRecord[]>;
  findByVerifiedAlias(normalized: string): Promise<CompanyRecord[]>;
  createCompany(input: { legalName?: string | null; commonName?: string | null; normalized: string; observedAt: Date }): Promise<CompanyRecord>;
  recordResolution(input: ResolutionAuditInput): Promise<CompanyResolution>;
  createAlias(input: { companyId: string; alias: string; normalizedAlias: string; evidenceId?: string | null; verificationState?: "UNVERIFIED" | "VERIFIED"; actor: string; at: Date; reason: string }): Promise<CompanyAliasRecord>;
  reassignAlias(input: { aliasId: string; newCompanyId: string; actor: string; at: Date; evidenceId?: string | null; reason: string }): Promise<CompanyAliasRecord>;
  merge(input: { sourceCompanyId: string; targetCompanyId: string; actor: string; at: Date; evidenceId?: string | null; reason: string }): Promise<string>;
  assignRole(input: CompanyRoleAssignment): Promise<CompanyRoleRecord>;
  listRoles(companyId: string): Promise<CompanyRoleRecord[]>;
  linkRoleEvidence(roleId: string, evidenceId: string, actor: string): Promise<void>;
}
