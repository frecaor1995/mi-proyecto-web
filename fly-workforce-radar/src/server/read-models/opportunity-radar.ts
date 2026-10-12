import type { OpportunityRecord } from "@/domain/opportunity";
import type { CompanyRecord, CompanyRoleRecord } from "@/domain/company";
import type { AcceptanceEvaluation } from "@/domain/manpower-acceptance";
import type { ContactRouteRecord } from "@/domain/contact";
import type { VendorPathCandidate } from "@/domain/buyer-vendor-intelligence";
import type { EligibilityResult } from "@/domain/eligibility";
import type { TradeId, OccupationId } from "@/domain/workforce-taxonomy";
import type { ProvenanceRef, ReadModelCurrentness, ReadModelTrustState, ScopeDescriptor } from "./shared";
import { UNKNOWN_SCOPE, currentnessFromStaleAfter, mapCandidateEvidenceState, mapDatabaseVerificationState, mapManpowerAcceptanceTrustState, toProvenanceRefs } from "./shared";

/**
 * External manpower acceptance (AF01), read-model shaped. Deliberately
 * excludes AcceptanceEvaluation.explanation (a raw Record<string,unknown>
 * internal blob) and ignoredClaimIds -- only what an operator needs to trust
 * the row crosses the boundary.
 */
export interface ExternalManpowerAcceptanceView {
  readonly result: string;
  readonly accepted: boolean | null;
  readonly trustState: ReadModelTrustState;
  readonly currentness: ReadModelCurrentness;
  readonly qualifyingCategories: readonly string[];
  readonly provenanceRefs: readonly ProvenanceRef[];
  readonly reason: string;
}

export function assembleExternalManpowerAcceptanceView(evaluation: AcceptanceEvaluation, asOf: Date): ExternalManpowerAcceptanceView {
  const accepted = evaluation.result === "VERIFIED_POSITIVE" ? true : evaluation.result === "VERIFIED_NEGATIVE" ? false : null;
  return {
    result: evaluation.result,
    accepted,
    trustState: mapManpowerAcceptanceTrustState(evaluation.result),
    currentness: currentnessFromStaleAfter(asOf, evaluation.validUntil),
    qualifyingCategories: evaluation.qualifyingCategories,
    provenanceRefs: toProvenanceRefs({ evidenceIds: evaluation.supportingEvidenceIds, claimIds: evaluation.supportingClaimIds }),
    reason: evaluation.reason,
  };
}

export interface OpportunityRadarItem {
  readonly opportunityId: string;
  readonly identityKey: string;
  readonly title: string | null;
  readonly companyName: string | null;
  readonly companyVerificationState: ReadModelTrustState;
  readonly projectRef: string | null;
  readonly location: string | null;
  readonly tradeId: TradeId | null;
  readonly occupationId: OccupationId | null;
  readonly lifecycle: string;
  readonly externalManpowerAcceptance: ExternalManpowerAcceptanceView | null;
  readonly vendorRouteState: ReadModelTrustState | null;
  readonly bestContactRouteGrade: string | null;
  readonly readiness: { readonly eligible: boolean; readonly eligibilityType: string; readonly blockingGaps: readonly string[] } | null;
  readonly currentness: ReadModelCurrentness;
  readonly verificationState: ReadModelTrustState;
  readonly scope: ScopeDescriptor;
  readonly provenanceRefs: readonly ProvenanceRef[];
}

export interface OpportunityRadarAssemblyInput {
  readonly opportunity: OpportunityRecord;
  readonly company?: CompanyRecord | null;
  readonly companyRole?: CompanyRoleRecord | null;
  readonly acceptance?: AcceptanceEvaluation | null;
  readonly bestContactRoute?: ContactRouteRecord | null;
  readonly vendorRoute?: VendorPathCandidate | null;
  readonly eligibility?: EligibilityResult | null;
  readonly tradeId?: TradeId | null;
  readonly occupationId?: OccupationId | null;
  readonly location?: string | null;
  readonly asOf: Date;
}

/**
 * Row assembler for a dense operator table (UI-2 section 11). Every field
 * traces to a real domain type; anything the backend cannot yet supply
 * (location, trade, occupation on an opportunity itself -- see UI-2 research
 * finding 2, there is no canonical Project entity to resolve these from)
 * stays an explicit optional input rather than a fabricated default.
 */
export function assembleOpportunityRadarItem(input: OpportunityRadarAssemblyInput): OpportunityRadarItem {
  const { opportunity, company, companyRole, acceptance, bestContactRoute, vendorRoute, eligibility, asOf } = input;

  const acceptanceView = acceptance ? assembleExternalManpowerAcceptanceView(acceptance, asOf) : null;

  const scope: ScopeDescriptor = opportunity.projectId
    ? { ...UNKNOWN_SCOPE, kind: "PROJECT", projectId: opportunity.projectId }
    : company
      ? { ...UNKNOWN_SCOPE, kind: "COMPANY", companyId: company.id }
      : UNKNOWN_SCOPE;

  const blockingGaps = eligibility?.blockingGaps ?? [];
  const verificationState: ReadModelTrustState = blockingGaps.includes("HUMAN_VERIFICATION_REQUIRED")
    ? "HUMAN_VERIFICATION_REQUIRED"
    : blockingGaps.includes("MATERIAL_CONFLICT_PRESENT")
      ? "CONFLICT"
      : companyRole
        ? mapDatabaseVerificationState(companyRole.verificationState)
        : "UNVERIFIED";

  const provenanceRefs = toProvenanceRefs({
    evidenceIds: [companyRole?.evidenceId ?? null, ...(acceptanceView?.provenanceRefs.map((ref) => ref.evidenceId) ?? [])],
    claimIds: [companyRole?.claimId ?? null],
  });

  return {
    opportunityId: opportunity.id,
    identityKey: opportunity.identityKey,
    title: opportunity.title,
    companyName: company?.commonName ?? company?.legalName ?? null,
    companyVerificationState: companyRole ? mapDatabaseVerificationState(companyRole.verificationState) : "UNVERIFIED",
    projectRef: opportunity.projectId,
    location: input.location ?? null,
    tradeId: input.tradeId ?? null,
    occupationId: input.occupationId ?? null,
    lifecycle: opportunity.lifecycle,
    externalManpowerAcceptance: acceptanceView,
    vendorRouteState: vendorRoute ? mapCandidateEvidenceState(vendorRoute.state) : null,
    bestContactRouteGrade: bestContactRoute?.routeGrade ?? null,
    readiness: eligibility ? { eligible: eligibility.eligible, eligibilityType: eligibility.eligibilityType, blockingGaps: eligibility.blockingGaps } : null,
    currentness: currentnessFromStaleAfter(asOf, opportunity.staleAfter),
    verificationState,
    scope,
    provenanceRefs,
  };
}
