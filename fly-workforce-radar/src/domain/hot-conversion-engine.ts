/**
 * Phase 3E Multi-Trade HOT Conversion Engine.
 *
 * This module defines NO new decision logic for eligibility, scoring,
 * commercial action, or Active HOT. Those remain exactly what
 * EligibilityService / ScoringService / CommercialActionService /
 * opportunity-actionability-service (via commercial-conversion-service.ts's
 * convertDiscoverySignal) already compute -- this file only gives that real
 * output a gate-by-gate, trade-agnostic EXPLANATION: which conceptual gate
 * passed or failed, why, what blocks it, and what the smallest legitimate
 * next step is. Every field here is read from the canonical
 * CommercialConversionDossier plus the Phase 3X WorkforceClassification;
 * nothing is recomputed or overridden.
 */
import type{ActionabilityState}from"./opportunity-actionability";
import type{CommercialAction}from"./commercial-action";
import type{TradeId,WorkforceClassification,WorkforceRoleClass}from"./workforce-taxonomy";

export const HOT_CONVERSION_ENGINE_RULE_VERSION="hot-conversion-engine@1.0.0";

export const CONVERSION_GATE_IDS=["G1_WORKFORCE_DEMAND","G2_WORKFORCE_CLASSIFICATION","G3_ORGANIZATION_RESOLUTION","G4_PROJECT_RELATIONSHIP_CONTEXT","G5_EXTERNAL_MANPOWER_ACCEPTANCE","G6_BUYER_VENDOR_ROUTE","G7_ACTIONABLE_CONTACT","G8_TEMPORAL_ACTIONABILITY","G9_HUMAN_VERIFICATION_CONFLICT_SAFETY","G10_ELIGIBILITY","G11_SCORE","G12_COMMERCIAL_ACTION","G13_ACTIVE_HOT"]as const;
export type ConversionGateId=(typeof CONVERSION_GATE_IDS)[number];

export const GATE_STATES=["PASS","FAIL","BLOCKED","UNKNOWN","NOT_REQUIRED"]as const;
export type GateState=(typeof GATE_STATES)[number];

export interface ConversionGateResult{
  gateId:ConversionGateId;
  state:GateState;
  reason:string;
  evidenceIds:string[];
  provenance:string;
  verificationRequirement:string;
  currentnessRequirement:string;
  blockingEffect:boolean;
  recommendedNextAction:string;
}

/** Reuses EligibilityReason / ActiveHotLead.blockers vocabulary wherever an
 * existing code already means the same thing (see hot-conversion-engine-
 * service.ts's mapping). Codes below with no canonical counterpart are the
 * only genuinely new Phase 3E vocabulary: the AF-01/contact SCOPE blockers
 * (Phase 3X introduced scope, but never a blocker code for it) and the
 * workforce-classification gate (new in Phase 3E). */
export const CONVERSION_BLOCKERS=[
  "MISSING_WORKFORCE_CLASSIFICATION","MISSING_WORKFORCE_DEMAND","STALE_DEMAND",
  "MISSING_ORGANIZATION","MISSING_PROJECT_RELATIONSHIP",
  "MISSING_AF01","AF01_UNVERIFIED","AF01_STALE","AF01_CONFLICT","AF01_SCOPE_UNSUPPORTED",
  "MISSING_VENDOR_ROUTE",
  "MISSING_ACTIONABLE_CONTACT","CONTACT_UNVERIFIED","CONTACT_STALE","CONTACT_AUTHORITY_UNKNOWN","CONTACT_AUTHORITY_SCOPE_UNSUPPORTED",
  "TEMPORAL_UNKNOWN","TEMPORAL_EXPIRED","TEMPORAL_CLOSED","TEMPORAL_CANCELLED","TEMPORAL_TERMINATED",
  "BLOCKING_CONFLICT","HUMAN_VERIFICATION_REQUIRED",
  "NOT_ELIGIBLE","NOT_SCORABLE",
]as const;
export type ConversionBlockerCode=(typeof CONVERSION_BLOCKERS)[number];

export interface PrioritizedBlocker{
  code:ConversionBlockerCode;
  rank:number;
  couldChangeEligibility:boolean;
  couldChangeActiveHot:boolean;
  evidenceRealisticallyObtainable:boolean;
  isUpstreamOfOtherBlockers:boolean;
  commercialValueScore:number;
  reason:string;
}

export const NEXT_BEST_ACTIONS=["VERIFY_AF01","FIND_AF01_EVIDENCE","VERIFY_CONTACT","FIND_ACTIONABLE_CONTACT","VERIFY_CONTACT_AUTHORITY","VERIFY_TEMPORAL_STATUS","VERIFY_PROJECT_RELATIONSHIP","RESOLVE_CONFLICT","COMPLETE_VENDOR_REGISTRATION_RESEARCH","MONITOR_FOR_NEW_EVIDENCE","NO_ACTION","READY_FOR_COMMERCIAL_CONTACT"]as const;
export type NextBestAction=(typeof NEXT_BEST_ACTIONS)[number];

export const READINESS_STATES=["READY","NEAR_READY","BLOCKED","INSUFFICIENT_EVIDENCE","INACTIVE","CONFLICTING"]as const;
export type ReadinessState=(typeof READINESS_STATES)[number];

export const DISTANCE_TIERS=["AT_HOT","NEAR","FAR","INACTIVE"]as const;
export type DistanceTier=(typeof DISTANCE_TIERS)[number];

/** Deterministic, non-probabilistic. Never a percentage. */
export interface DistanceToHot{
  tier:DistanceTier;
  blockingGatesRemaining:number;
  criticalBlockers:ConversionBlockerCode[];
  nearestHotType:"HOT_A"|"HOT_B"|null;
}

export interface ClosureTask{
  id:string;
  taskType:string;
  targetBlocker:ConversionBlockerCode;
  priority:"HIGH"|"MEDIUM"|"LOW";
  alreadySatisfied:false;
}

export const AF01_EVIDENCE_SCOPES=["TRADE_SPECIFIC","CRAFT_SPECIFIC","PROJECT_SPECIFIC","BUSINESS_UNIT_SPECIFIC","ORGANIZATION_WIDE","UNKNOWN"]as const;
export type Af01EvidenceScopeState=(typeof AF01_EVIDENCE_SCOPES)[number];

export interface WorkforceConversionDossier{
  opportunityId:string;
  projectRef:string;
  organization:string|null;
  workforceClassification:WorkforceClassification;
  roleClass:WorkforceRoleClass;
  tradeId:TradeId|null;
  location:string|null;

  demandEvidenceIds:string[];
  projectEvidenceIds:string[];

  af01State:"MISSING"|"CANDIDATE"|"VERIFIED"|"STALE"|"REJECTED";
  af01Scope:Af01EvidenceScopeState|null;
  af01ScopeCoversTrade:boolean|null;

  buyerState:"VERIFIED"|"CANDIDATE"|"UNKNOWN";
  vendorRouteState:"PRESENT"|"UNKNOWN";

  contactState:"MISSING"|"CANDIDATE"|"VERIFIED"|"STALE";
  contactGrade:"A"|"B"|"C"|"D"|"E"|null;
  contactAuthorityScope:string|null;
  contactAuthorityScopeCoversTrade:boolean|null;

  temporalState:ActionabilityState;
  conflicts:string[];

  eligibility:{eligibilityType:string;eligible:boolean;blockingGaps:string[]}[];
  score:{state:string;score:number|null};
  commercialAction:CommercialAction;
  activeHotA:boolean;
  activeHotB:boolean;

  readiness:ReadinessState;
  distanceToHot:DistanceToHot;

  blockers:PrioritizedBlocker[];
  gates:ConversionGateResult[];
  nextBestAction:NextBestAction;
  closurePlan:ClosureTask[];

  humanVerificationItemCount:number;
  provenanceSummary:string[];
  ruleVersion:string;
}

export interface CommercialPriorityComponent{label:string;value:string}
export interface RankedWorkforceConversion{
  dossier:WorkforceConversionDossier;
  rank:number;
  priorityTier:"ACTIVE_HOT"|"ELIGIBLE_CURRENT"|"NEAR_READY"|"EVIDENCE_CLOSURE_VALUABLE"|"LOW_INFORMATION"|"INACTIVE";
  components:CommercialPriorityComponent[];
}
