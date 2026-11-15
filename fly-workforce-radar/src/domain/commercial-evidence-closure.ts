/**
 * Phase 3G Commercial Evidence Closure & Contact Intelligence.
 *
 * This module defines NO new eligibility/HOT/contact-grade/AF-01 truth.
 * It is an orchestration layer: given a Phase 3F work item's real blocker,
 * it defines an explicit evidence target, a bounded deterministic search
 * plan, and a place to attach candidate evidence -- built from Phase 3A's
 * CandidateCommercialEvidence conventions and Phase 3C's ContactCandidateEvidence
 * (recommendContactGrade) directly, never a re-implementation of either.
 * Candidate evidence never self-verifies; every packet ends at a human
 * decision point that already exists (VERIFY/REJECT/NEEDS_MORE_EVIDENCE/DEFER).
 */
import type{EvidenceVerificationState}from"./commercial-conversion";
import type{EvidenceSourceType,EvidenceTier}from"./commercial-evidence-acquisition";
import type{ContactCandidateEvidence}from"./contact-intelligence";
import type{ConversionBlockerCode,NextBestAction}from"./hot-conversion-engine";
import type{OccupationId,TradeId,WorkforceClassification}from"./workforce-taxonomy";

export const COMMERCIAL_EVIDENCE_CLOSURE_RULE_VERSION="commercial-evidence-closure@1.0.0";

export const CLOSURE_CASE_STATES=["OPEN","CANDIDATE_FOUND","AWAITING_HUMAN_VERIFICATION","VERIFIED_CLOSED","REJECTED","NEEDS_MORE_EVIDENCE","DEFERRED","UNRESOLVED"]as const;
export type ClosureCaseState=(typeof CLOSURE_CASE_STATES)[number];

export const CLOSURE_TARGET_TYPES=["ACTIONABLE_CONTACT","AF01_ACCEPTANCE"]as const;
export type ClosureTargetType=(typeof CLOSURE_TARGET_TYPES)[number];

/** Only the blocker codes Phase 3G currently operationalizes (section 6:
 * contact-first, then AF-01). Other blocker types are left to a future,
 * explicitly-authorized extension -- not duplicated or half-built here. */
export const CONTACT_CLOSURE_BLOCKERS:readonly ConversionBlockerCode[]=["MISSING_ACTIONABLE_CONTACT","CONTACT_UNVERIFIED","CONTACT_STALE","CONTACT_AUTHORITY_UNKNOWN","CONTACT_AUTHORITY_SCOPE_UNSUPPORTED"];
export const AF01_CLOSURE_BLOCKERS:readonly ConversionBlockerCode[]=["MISSING_AF01","AF01_UNVERIFIED","AF01_STALE","AF01_SCOPE_UNSUPPORTED"];

/**
 * Candidate-evidence classification for AF-01 (Phase 3G section 15). This is
 * deliberately a DIFFERENT, narrower vocabulary than the frozen, canonical
 * ExternalManpowerCategory (database.ts) -- it exists only to grade how
 * strong a not-yet-verified claim is, before any human ever maps it onto a
 * canonical category. STRONG_AF01_CLASSES below is the only place that
 * distinction is used, and only for verification-queue prioritization.
 */
export const AF01_EVIDENCE_CLASSES=["EXPLICIT_MANPOWER_ACCEPTANCE","STAFFING_VENDOR_ACCEPTANCE","CONTINGENT_LABOR_ACCEPTANCE","CRAFT_LABOR_SUPPLIER_ACCEPTANCE","WORKFORCE_SUBCONTRACTING_ACCEPTANCE","THIRD_PARTY_LABOR_ACCEPTANCE","GENERAL_SUPPLIER_ROUTE","GENERAL_SUBCONTRACTOR_ROUTE","AMBIGUOUS_VENDOR_LANGUAGE","NEGATIVE_EVIDENCE","UNKNOWN"]as const;
export type Af01EvidenceClass=(typeof AF01_EVIDENCE_CLASSES)[number];
export const STRONG_AF01_CLASSES:ReadonlySet<Af01EvidenceClass>=new Set(["EXPLICIT_MANPOWER_ACCEPTANCE","STAFFING_VENDOR_ACCEPTANCE","CONTINGENT_LABOR_ACCEPTANCE","CRAFT_LABOR_SUPPLIER_ACCEPTANCE","WORKFORCE_SUBCONTRACTING_ACCEPTANCE","THIRD_PARTY_LABOR_ACCEPTANCE"]);

/** Mirrors Phase 3X's AcceptanceEvidenceScope/ContactAuthorityScope vocabulary
 * for candidate (pre-verification) evidence -- reused, not redefined. */
export const EVIDENCE_SCOPE_STATES=["ORGANIZATION_WIDE","TRADE_SPECIFIC","MULTI_TRADE","UNKNOWN"]as const;
export type EvidenceScopeState=(typeof EVIDENCE_SCOPE_STATES)[number];

export const ENTITY_MATCH_STATES=["MATCH","AMBIGUOUS","MISMATCH"]as const;
export type EntityMatchState=(typeof ENTITY_MATCH_STATES)[number];

export interface ClosureTarget{
  targetType:ClosureTargetType;
  description:string;
  tradeId:TradeId|null;
  organization:string|null;
  projectRef:string|null;
}

export interface AF01CandidateEvidence{
  id:string;
  opportunityId:string;
  organization:string|null;
  evidenceClass:Af01EvidenceClass;
  candidateClaim:string;
  sourceUrl:string;
  sourceType:EvidenceSourceType;
  evidenceTier:EvidenceTier;
  observedAt:Date;
  scope:EvidenceScopeState;
  scopedTradeIds:TradeId[];
  scopeEvidenceText:string|null;
  entityMatch:EntityMatchState;
  projectMatch:EntityMatchState|"NOT_APPLICABLE";
  verificationState:EvidenceVerificationState;
  conflicts:string[];
  provenance:string;
}

export interface SearchStrategy{
  strategyId:string;
  closureCaseId:string;
  evidenceType:ClosureTargetType;
  organization:string|null;
  projectRef:string|null;
  tradeId:TradeId|null;
  occupationId:OccupationId|null;
  queryIntent:string;
  preferredSourceClasses:readonly EvidenceSourceType[];
  priority:number;
  stopCondition:string;
}

export interface AcquisitionBudget{
  maxStrategiesPerCase:number;
  maxCandidatesPerStrategy:number;
  maxCandidatesPerCase:number;
}
/** Deliberately small. Rationale (Phase 3G section 24): this is a bounded
 * evidence-closure aid, not a crawler -- five ordered strategies per case is
 * enough to exhaust the realistic official-source hierarchy (section 21)
 * without runaway acquisition; three candidates per strategy and eight per
 * case keep a human verification packet reviewable in one sitting. */
export const DEFAULT_ACQUISITION_BUDGET:AcquisitionBudget={maxStrategiesPerCase:5,maxCandidatesPerStrategy:3,maxCandidatesPerCase:8};

export interface CandidateQuality{
  sourceAuthority:number;
  directness:number;
  specificity:number;
  currentness:number;
  entityMatch:number;
  scopeRelevance:number;
  authorityRelevance:number;
  total:number;
}

export interface PreviewImpact{
  changed:boolean;
  wouldBecomeActiveHotA:boolean;
  wouldBecomeActiveHotB:boolean;
  eligibilityChanged:boolean;
  remainingBlockerCountAfter:number;
  persisted:false;
}

export const HUMAN_DECISION_OPTIONS=["VERIFY","REJECT","NEEDS_MORE_EVIDENCE","DEFER"]as const;
export type HumanDecisionOption=(typeof HUMAN_DECISION_OPTIONS)[number];

export interface VerificationPacket{
  verificationItemId:string;
  closureCaseId:string;
  opportunityId:string;
  organization:string|null;
  tradeId:TradeId|null;
  candidateEvidenceType:ClosureTargetType;
  candidateId:string;
  candidateValue:string;
  candidateScope:EvidenceScopeState;
  candidateGrade:string|null;
  candidateQuality:CandidateQuality;
  sourceUrl:string;
  provenance:string;
  whyItMatters:string;
  affectedCanonicalGate:string[];
  previewImpact:PreviewImpact|null;
  humanDecisionRequired:readonly HumanDecisionOption[];
}

export interface ClosureCase{
  closureCaseId:string;
  workItemId:string;
  opportunityId:string;
  organization:string|null;
  projectRef:string;
  workforceClassification:WorkforceClassification;
  tradeId:TradeId|null;
  occupationId:OccupationId|null;
  sourceBlocker:ConversionBlockerCode;
  closureTaskType:string;
  nextBestAction:NextBestAction;
  target:ClosureTarget;
  searchPlan:SearchStrategy[];
  contactCandidates:ContactCandidateEvidence[];
  af01Candidates:AF01CandidateEvidence[];
  verificationPackets:VerificationPacket[];
  status:ClosureCaseState;
  provenanceRefs:string[];
  ruleVersion:string;
}

export interface ClosurePriorityItem{
  closureCaseId:string;
  organization:string|null;
  tradeId:TradeId|null;
  status:ClosureCaseState;
  reason:string;
}

export interface ClosureDeskSnapshot{
  openClosureCases:number;
  contactCases:number;
  af01Cases:number;
  candidateFound:number;
  awaitingVerification:number;
  unresolved:number;
  negativeEvidence:number;
  highImpactVerificationItems:number;
  topClosurePriorities:ClosurePriorityItem[];
  ruleVersion:string;
}

/** A human decision supplied EXTERNALLY (never invented inside Phase 3G).
 * Mirrors the VERIFY/REJECT/NEEDS_MORE_EVIDENCE/DEFER vocabulary already
 * canonical elsewhere (e.g. human-verification-ops-service.ts's
 * AggregationReviewDecisionInput). */
export interface ClosureHumanDecisionInput{
  candidateId:string;
  decision:HumanDecisionOption;
  reviewerId:string;
  reason:string;
  decidedAt:Date;
}
