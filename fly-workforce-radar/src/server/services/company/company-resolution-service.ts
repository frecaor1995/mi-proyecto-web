import type { ClaimRecord } from "../../../domain/claims";
import type { CompanyResolution, CompanyRoleAssignment, CompanyRoleRecord } from "../../../domain/company";
import type { CompanyRepository } from "../../repositories/company/company-repository";
import { isUnresolvedPlaceholder, normalizeCompanyName } from "./company-name-normalization";

export interface ResolveCompanyInput {
  observedText: string;
  actor?: string;
  at?: Date;
  evidenceId?: string | null;
  claimId?: string | null;
}

export class CompanyResolutionService {
  constructor(
    private readonly repository: CompanyRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async resolve(input: ResolveCompanyInput): Promise<CompanyResolution> {
    const actor = input.actor ?? "system:deterministic-company-resolver";
    const at = input.at ?? this.clock();
    const normalized = normalizeCompanyName(input.observedText);
    if (normalized === "" || isUnresolvedPlaceholder(input.observedText)) {
      return this.repository.recordResolution({
        ...input, actor, at, normalizedText: normalized || null,
        result: "UNRESOLVED", method: "PLACEHOLDER_REJECTED", companyId: null,
        candidateCompanyIds: [], reason: "Observed text is an unresolved or confidential placeholder",
      });
    }
    const exact = await this.repository.findByNormalizedName(normalized);
    if (exact.length === 1) {
      return this.repository.recordResolution({
        ...input, actor, at, normalizedText: normalized, result: "RESOLVED_EXACT",
        method: "NORMALIZED_NAME", companyId: exact[0].id,
        candidateCompanyIds: [exact[0].id], reason: "One active canonical normalized name matched",
      });
    }
    if (exact.length > 1) return this.ambiguous(input, actor, at, normalized, exact.map((item) => item.id), "Multiple canonical names matched");

    const aliases = await this.repository.findByVerifiedAlias(normalized);
    if (aliases.length === 1) {
      return this.repository.recordResolution({
        ...input, actor, at, normalizedText: normalized, result: "RESOLVED_ALIAS",
        method: "VERIFIED_ALIAS", companyId: aliases[0].id,
        candidateCompanyIds: [aliases[0].id], reason: "One active verified alias matched",
      });
    }
    if (aliases.length > 1) return this.ambiguous(input, actor, at, normalized, aliases.map((item) => item.id), "Conflicting verified aliases matched");
    return this.repository.recordResolution({
      ...input, actor, at, normalizedText: normalized, result: "UNRESOLVED",
      method: "NO_MATCH", companyId: null, candidateCompanyIds: [],
      reason: "No exact canonical name or verified alias matched",
    });
  }

  async resolvePublisherClaim(claim: ClaimRecord, evidenceId?: string): Promise<CompanyResolution> {
    if (claim.predicate !== "publisher_identity_text") throw new Error("Claim is not publisher identity text");
    if (claim.assertionKind === "UNKNOWN" || typeof claim.value !== "string") {
      return this.resolve({ observedText: "Unknown publisher", claimId: claim.id, evidenceId });
    }
    return this.resolve({ observedText: claim.value, claimId: claim.id, evidenceId });
  }

  async createCanonical(observedText: string, evidenceId: string, actor: string, at: Date = this.clock()) {
    if (isUnresolvedPlaceholder(observedText) || normalizeCompanyName(observedText) === "") {
      throw new Error("Unresolved placeholder text cannot create a canonical company");
    }
    return this.repository.createCompany({ commonName: observedText.trim(), normalized: normalizeCompanyName(observedText), observedAt: at });
  }

  async manualOverride(input: ResolveCompanyInput & { companyId: string; reason: string; supersedesResolutionId?: string }) {
    return this.repository.recordResolution({
      ...input, actor: input.actor ?? "human:resolver", at: input.at ?? this.clock(),
      normalizedText: normalizeCompanyName(input.observedText), result: "RESOLVED_EXACT",
      method: "MANUAL_OVERRIDE", companyId: input.companyId,
      candidateCompanyIds: [input.companyId], reason: input.reason,
      supersedesResolutionId: input.supersedesResolutionId,
    });
  }

  async assignRole(input: CompanyRoleAssignment): Promise<CompanyRoleRecord> {
    if (input.basis === "JOB_PUBLISHER_ONLY" || input.basis === "SUPPLIER_PORTAL_ONLY") {
      throw new Error(`${input.basis} cannot establish a company role`);
    }
    if (input.role === "EMPLOYER" && input.basis !== "EXPLICIT_EMPLOYER") {
      throw new Error("EMPLOYER requires explicit employer representation");
    }
    if (input.role === "STAFFING_SUPPLIER" && input.basis !== "EXPLICIT_STAFFING_PUBLISHER") {
      throw new Error("STAFFING_SUPPLIER requires explicit staffing publisher evidence");
    }
    if (!["EMPLOYER", "STAFFING_SUPPLIER"].includes(input.role) && input.basis !== "EXPLICIT_CONTEXTUAL_ROLE") {
      throw new Error(`${input.role} requires explicit contextual role evidence`);
    }
    if (input.verificationState === "VERIFIED") {
      throw new Error("Phase 1G does not automatically verify company roles");
    }
    const role = await this.repository.assignRole({ ...input, verificationState: "UNVERIFIED" });
    await this.repository.linkRoleEvidence(role.id, input.evidenceId, input.actor);
    return role;
  }

  private ambiguous(input: ResolveCompanyInput, actor: string, at: Date, normalizedText: string, candidates: string[], reason: string) {
    return this.repository.recordResolution({
      ...input, actor, at, normalizedText, result: "AMBIGUOUS", method: "NORMALIZED_NAME",
      companyId: null, candidateCompanyIds: candidates, reason,
    });
  }
}
