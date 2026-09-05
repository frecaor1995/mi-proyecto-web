import type { OpportunityRadarItem } from "./opportunity-radar";
import type { ProvenanceRef, ReadModelCapabilityState } from "./shared";

/**
 * Detail-view contract for a future UI-5 opportunity page. UI-2 defines the
 * shape only -- it does not implement the detail UI (section 12) and does
 * not fetch evidence/verification data on its own. Nested sections carry
 * explicit id references rather than embedded read models, so this contract
 * stays cheap to construct today and can be filled in incrementally without
 * a breaking shape change.
 */
export interface OpportunityIntelligenceDetail {
  readonly overview: OpportunityRadarItem;
  readonly workforceDemand: { readonly capabilityState: ReadModelCapabilityState; readonly summary: string | null };
  readonly commercialRoute: { readonly capabilityState: ReadModelCapabilityState; readonly vendorRouteId: string | null; readonly bestContactRouteId: string | null };
  readonly externalManpowerAcceptance: OpportunityRadarItem["externalManpowerAcceptance"];
  readonly qualificationRoute: { readonly capabilityState: ReadModelCapabilityState; readonly requirementIds: readonly string[] };
  readonly evidenceRefs: readonly ProvenanceRef[];
  readonly conflictSummaries: readonly string[];
  readonly humanVerificationTaskIds: readonly string[];
  readonly nextCommercialActionId: string | null;
  readonly technicalMetadata: { readonly ruleVersions: Readonly<Record<string, string>> };
}

export interface OpportunityIntelligenceDetailInput {
  readonly overview: OpportunityRadarItem;
  readonly workforceDemandSummary?: string | null;
  readonly vendorRouteId?: string | null;
  readonly bestContactRouteId?: string | null;
  readonly qualificationRequirementIds?: readonly string[];
  readonly conflictSummaries?: readonly string[];
  readonly humanVerificationTaskIds?: readonly string[];
  readonly nextCommercialActionId?: string | null;
  readonly ruleVersions?: Readonly<Record<string, string>>;
}

export function assembleOpportunityIntelligenceDetail(input: OpportunityIntelligenceDetailInput): OpportunityIntelligenceDetail {
  return {
    overview: input.overview,
    workforceDemand: {
      capabilityState: input.workforceDemandSummary ? "PARTIAL" : "UNAVAILABLE",
      summary: input.workforceDemandSummary ?? null,
    },
    commercialRoute: {
      capabilityState: input.vendorRouteId || input.bestContactRouteId ? "PARTIAL" : "UNAVAILABLE",
      vendorRouteId: input.vendorRouteId ?? null,
      bestContactRouteId: input.bestContactRouteId ?? null,
    },
    externalManpowerAcceptance: input.overview.externalManpowerAcceptance,
    qualificationRoute: {
      capabilityState: (input.qualificationRequirementIds?.length ?? 0) > 0 ? "PARTIAL" : "UNAVAILABLE",
      requirementIds: input.qualificationRequirementIds ?? [],
    },
    evidenceRefs: input.overview.provenanceRefs,
    conflictSummaries: input.conflictSummaries ?? [],
    humanVerificationTaskIds: input.humanVerificationTaskIds ?? [],
    nextCommercialActionId: input.nextCommercialActionId ?? null,
    technicalMetadata: { ruleVersions: input.ruleVersions ?? {} },
  };
}
