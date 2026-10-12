import type{EligibilityReason,EligibilityType}from"./eligibility";import type{ActionabilityState}from"./opportunity-actionability";import type{ActiveRecommendation}from"./opportunity-actionability";

/**
 * Phase 2P. The final, operational composition at the top of the real pipeline:
 * SOURCE -> ... -> ELIGIBILITY -> SCORE -> ACTIONABILITY -> COMMERCIAL ACTION ->
 * ACTIVE HOT LEAD. This type duplicates none of that logic -- every field here is
 * copied from the real EligibilityService/ScoringService/CommercialActionService/
 * opportunity-actionability-service outputs, composed, never recomputed.
 */
export const HOT_TYPES=["HOT_A","HOT_B"]as const;
export type HotType=(typeof HOT_TYPES)[number];

export interface ActiveHotLead{
  opportunityId:string;
  hotType:HotType;
  /** The real EligibilityService result for this specific type. */
  eligible:boolean;
  eligibilityBlockers:EligibilityReason[];
  eligibilityType:EligibilityType;
  scoreState:"SCORED"|"NOT_SCORABLE";
  score:number|null;
  actionabilityState:ActionabilityState;
  /** True only when eligible AND actionability is open-compatible AND the
   * underlying recommendation is a real active-external action. Everything else
   * (ineligible, or eligible-but-inactive) is false -- never fabricated true. */
  active:boolean;
  selectedRoute:{id:string;type:string;grade:string}|null;
  acceptanceId:string|null;
  buyerCompanyProjectContext:{company:string|null;buyerCandidate:string|null;project:string|null};
  evidenceIds:string[];
  blockers:string[];
  recommendedCommercialAction:ActiveRecommendation|null;
  evaluatedAt:Date;
  asOf:Date;
}
