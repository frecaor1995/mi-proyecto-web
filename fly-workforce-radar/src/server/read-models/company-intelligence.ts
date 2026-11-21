import type { CompanyRecord, CompanyResolution, CompanyRoleRecord } from "@/domain/company";
import type { ProvenanceRef, ReadModelCurrentness, ReadModelTrustState } from "./shared";
import { currentnessFromLastObserved, mapDatabaseVerificationState, toProvenanceRefs } from "./shared";

export interface CompanyRoleView {
  readonly role: string;
  readonly verificationState: ReadModelTrustState;
  readonly basis: string;
  readonly observedAt: string;
  readonly provenanceRefs: readonly ProvenanceRef[];
}

export interface CompanyIntelligenceProfile {
  readonly companyId: string;
  readonly displayName: string | null;
  readonly resolutionState: "RESOLVED_EXACT" | "RESOLVED_ALIAS" | "AMBIGUOUS" | "UNRESOLVED" | "UNKNOWN";
  readonly roles: readonly CompanyRoleView[];
  readonly currentness: ReadModelCurrentness;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly mergedIntoCompanyId: string | null;
}

export interface CompanyIntelligenceAssemblyInput {
  readonly company: CompanyRecord;
  readonly resolution?: CompanyResolution | null;
  readonly roles?: readonly CompanyRoleRecord[];
  readonly asOf: Date;
}

export function assembleCompanyIntelligenceProfile(input: CompanyIntelligenceAssemblyInput): CompanyIntelligenceProfile {
  const { company, resolution, roles = [], asOf } = input;
  return {
    companyId: company.id,
    displayName: company.commonName ?? company.legalName,
    resolutionState: resolution?.result ?? "UNKNOWN",
    roles: roles.map((role) => ({
      role: role.role,
      verificationState: mapDatabaseVerificationState(role.verificationState),
      basis: role.basis,
      observedAt: role.observedAt.toISOString(),
      provenanceRefs: toProvenanceRefs({ evidenceIds: [role.evidenceId], claimIds: [role.claimId ?? null] }),
    })),
    currentness: currentnessFromLastObserved(asOf, company.lastSeenAt),
    firstSeenAt: company.firstSeenAt ? company.firstSeenAt.toISOString() : null,
    lastSeenAt: company.lastSeenAt ? company.lastSeenAt.toISOString() : null,
    mergedIntoCompanyId: company.mergedIntoCompanyId,
  };
}
