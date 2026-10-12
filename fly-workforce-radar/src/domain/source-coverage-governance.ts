/**
 * Phase 3H Source Onboarding & Coverage Expansion.
 *
 * This module defines NO new eligibility/HOT/contact-grade/AF-01 truth and NO
 * parallel source-identity/health vocabulary. It is a governance layer that
 * sits ABOVE the existing, canonical source architecture:
 *  - SourceFamily / SourceCapability / SourceReadinessState / ProductionHealthState
 *    / SourceFailureClass (production-source.ts, Phase 2) are reused verbatim
 *    as the vocabulary for "what kind of source", "what it's good for", "is it
 *    turned on", and "is it currently healthy" -- never redefined here.
 *  - ClosureTargetType / EntityMatchState (commercial-evidence-closure.ts,
 *    Phase 3G) are reused verbatim for "which evidence type" and "does this
 *    organization match", never redefined here.
 *  - TradeId (workforce-taxonomy.ts) is reused verbatim for trade scope.
 *
 * What is genuinely new: a CoverageGap (derived only from real Phase 3G
 * closure cases), a SourceCandidate (assessment-only, never an approved
 * source), a SourceApprovalPacket (human-reviewable, never self-approving),
 * a SourceApprovalRecord (the actual in-code registry projection -- created
 * ONLY from an externally-supplied human decision), and the deterministic
 * usability/coverage-state logic Phase 3G needs to ask "can this source be
 * used for this closure case?"
 */
import type{ClosureTargetType,EntityMatchState}from"./commercial-evidence-closure";
import type{ProductionHealthState,SourceCapability,SourceFamily,SourceReadinessState}from"./production-source";
import type{TradeId}from"./workforce-taxonomy";

export const SOURCE_COVERAGE_GOVERNANCE_RULE_VERSION="source-coverage-governance@1.0.0";

/* ------------------------------------------------------------------------ */
/* Coverage gap (real operational/closure demand only)                      */
/* ------------------------------------------------------------------------ */

/** Distinct on purpose (section 7): NO_EVIDENCE_FOUND is a 3G search-result
 * concept, not a coverage-gap state -- a coverage gap is about whether a
 * USABLE SOURCE exists at all, not about what that source returned. */
export const COVERAGE_GAP_STATES=["NO_APPROVED_SOURCE","APPROVED_SOURCE_NO_CAPABILITY","APPROVED_SOURCE_BLOCKED","APPROVED_SOURCE_STALE","APPROVED_SOURCE_NO_EVIDENCE","PARTIAL_COVERAGE","SUFFICIENT_COVERAGE"]as const;
export type CoverageGapState=(typeof COVERAGE_GAP_STATES)[number];

export interface CoverageGap{
  coverageGapId:string;
  organization:string;
  opportunityIds:string[];
  closureCaseIds:string[];
  tradeScopes:TradeId[];
  missingEvidenceTypes:ClosureTargetType[];
  requiredCapabilities:SourceCapability[];
  existingApprovedSourceIds:string[];
  attemptedSourceIds:string[];
  blockedSourceIds:string[];
  coverageStatus:CoverageGapState;
  priority:number;
  provenanceRefs:string[];
}

/* ------------------------------------------------------------------------ */
/* Coverage state (matrix / desk level -- distinct from gap state)          */
/* ------------------------------------------------------------------------ */

export const COVERAGE_STATES=["COVERED_USABLE","COVERED_DEGRADED","COVERED_BLOCKED","PARTIALLY_COVERED","UNCOVERED","UNKNOWN"]as const;
export type CoverageState=(typeof COVERAGE_STATES)[number];

/* ------------------------------------------------------------------------ */
/* Source candidate (assessment-only -- never an approved source)          */
/* ------------------------------------------------------------------------ */

export const SOURCE_OWNERSHIP_TYPES=["OFFICIAL","GOVERNMENT","AUTHORITATIVE_THIRD_PARTY","PROFESSIONAL","AGGREGATOR","UNKNOWN"]as const;
export type SourceOwnershipType=(typeof SOURCE_OWNERSHIP_TYPES)[number];

export const SOURCE_ACCESS_PROFILES=["PUBLIC_READ_ONLY","LOGIN_REQUIRED","CAPTCHA_PROTECTED","PAYWALLED","BOT_PROTECTED","ROBOTS_RESTRICTED","WRITE_INTERACTION_REQUIRED","UNKNOWN_ACCESS"]as const;
export type SourceAccessProfile=(typeof SOURCE_ACCESS_PROFILES)[number];

/** Whether a source family applies to one company, a related group, or is a
 * platform usable across many unrelated organizations. Distinct from
 * ClosureTargetType's per-evidence EvidenceScopeState (Phase 3G) -- this is
 * about the SOURCE's reach, not one piece of evidence's claimed reach. */
export const SOURCE_ORGANIZATION_SCOPES=["GLOBAL_SOURCE_FAMILY","ORGANIZATION_SPECIFIC","ORGANIZATION_GROUP","UNKNOWN"]as const;
export type SourceOrganizationScope=(typeof SOURCE_ORGANIZATION_SCOPES)[number];

export const SOURCE_TRADE_SCOPES=["ALL_TRADES","TRADE_SPECIFIC","MULTI_TRADE","UNKNOWN"]as const;
export type SourceTradeScope=(typeof SOURCE_TRADE_SCOPES)[number];

export const SOURCE_ASSESSMENT_STATUSES=["DISCOVERED","UNDER_ASSESSMENT","ASSESSED"]as const;
export type SourceAssessmentStatus=(typeof SOURCE_ASSESSMENT_STATUSES)[number];

export interface SourceCandidate{
  sourceCandidateId:string;
  organization:string;
  organizationScope:SourceOrganizationScope;
  sourceFamily:SourceFamily;
  ownershipType:SourceOwnershipType;
  baseReference:string|null;
  candidateCapabilities:SourceCapability[];
  candidateEvidenceTypes:ClosureTargetType[];
  candidateTradeScope:SourceTradeScope;
  candidateTradeIds:TradeId[];
  accessProfile:SourceAccessProfile;
  discoveryReason:string;
  coverageGapIds:string[];
  provenanceRefs:string[];
  assessmentStatus:SourceAssessmentStatus;
  entityMatch:EntityMatchState;
}

/* ------------------------------------------------------------------------ */
/* Source quality (assessment/ranking only -- never verification)          */
/* ------------------------------------------------------------------------ */

export interface SourceQuality{
  authority:number;
  directness:number;
  specificity:number;
  currentness:number;
  stability:number;
  entityCertainty:number;
  commercialRelevance:number;
  total:number;
}

/* ------------------------------------------------------------------------ */
/* Deterministic, bounded source discovery plan                             */
/* ------------------------------------------------------------------------ */

export interface DiscoveryBudget{
  maxCandidateSourceFamiliesPerGap:number;
  maxDiscoveryStrategies:number;
  maxObservationsPerCandidate:number;
}
/** Small on purpose (section 28): source onboarding is a governed intake
 * process, not a crawler -- five candidate families and five strategies per
 * gap are enough to exhaust the realistic official-source hierarchy without
 * runaway discovery. */
export const DEFAULT_DISCOVERY_BUDGET:DiscoveryBudget={maxCandidateSourceFamiliesPerGap:5,maxDiscoveryStrategies:5,maxObservationsPerCandidate:3};

export interface DiscoveryStrategy{
  strategyId:string;
  coverageGapId:string;
  organization:string;
  queryIntent:string;
  preferredSourceFamilies:readonly SourceFamily[];
  priority:number;
  stopCondition:string;
}

/* ------------------------------------------------------------------------ */
/* Source approval packet (human-reviewable -- never self-approving)       */
/* ------------------------------------------------------------------------ */

export const SOURCE_APPROVAL_DECISION_OPTIONS=["APPROVE","APPROVE_LIMITED","REJECT","SUSPEND","DEPRECATE","REQUIRE_REASSESSMENT"]as const;
export type SourceApprovalDecisionOption=(typeof SOURCE_APPROVAL_DECISION_OPTIONS)[number];

export interface SourceApprovalPacket{
  packetId:string;
  sourceCandidateId:string;
  coverageGapId:string;
  organization:string;
  sourceFamily:SourceFamily;
  ownershipType:SourceOwnershipType;
  baseReference:string|null;
  requestedCapabilities:SourceCapability[];
  requestedEvidenceTypes:ClosureTargetType[];
  organizationScope:SourceOrganizationScope;
  tradeScope:SourceTradeScope;
  accessProfile:SourceAccessProfile;
  accessTestResult:string;
  quality:SourceQuality;
  entityMatch:EntityMatchState;
  knownRestrictions:string[];
  knownRisks:string[];
  whyNeeded:string;
  recommendation:string;
  humanDecisionRequired:true;
}

/** A human decision supplied EXTERNALLY (never invented inside Phase 3H).
 * Mirrors Phase 3G's ClosureHumanDecisionInput discipline exactly. */
export interface SourceApprovalDecisionInput{
  sourceCandidateId:string;
  decision:SourceApprovalDecisionOption;
  reviewerId:string;
  reason:string;
  approvedCapabilities?:SourceCapability[];
  approvedEvidenceTypes?:ClosureTargetType[];
  approvedOrganizationScope?:SourceOrganizationScope;
  approvedTradeScope?:SourceTradeScope;
  approvedTradeIds?:TradeId[];
  decidedAt:Date;
}

/* ------------------------------------------------------------------------ */
/* Approved source registry projection (created ONLY from a human decision) */
/* ------------------------------------------------------------------------ */

export interface SourceApprovalRecord{
  sourceId:string;
  organization:string;
  sourceFamily:SourceFamily;
  ownershipType:SourceOwnershipType;
  readiness:SourceReadinessState;
  approvedCapabilities:SourceCapability[];
  approvedEvidenceTypes:ClosureTargetType[];
  organizationScope:SourceOrganizationScope;
  tradeScope:SourceTradeScope;
  approvedTradeIds:TradeId[];
  accessProfile:SourceAccessProfile;
  health:ProductionHealthState;
  lastHealthCheckAt:Date|null;
  reassessmentRequired:boolean;
  reviewedBy:string;
  reviewedAt:Date;
  reason:string;
  restrictions:string[];
  provenanceRefs:string[];
  ruleVersion:string;
}

/* ------------------------------------------------------------------------ */
/* 3G integration: deterministic usability answer                          */
/* ------------------------------------------------------------------------ */

export const SOURCE_USABILITY_STATES=["ALLOWED","LIMITED","NOT_APPROVED","OUT_OF_SCOPE","BLOCKED","UNHEALTHY","UNKNOWN"]as const;
export type SourceUsability=(typeof SOURCE_USABILITY_STATES)[number];

export interface SourceUsabilityQuery{
  organization:string;
  tradeId:TradeId|null;
  targetEvidenceType:ClosureTargetType;
  requiredCapability:SourceCapability;
}

export interface SourceUsabilityResult{
  usability:SourceUsability;
  reason:string;
}

/* ------------------------------------------------------------------------ */
/* Coverage preview (hypothetical, non-persisting)                          */
/* ------------------------------------------------------------------------ */

export interface CoveragePreviewResult{
  coverageGapId:string;
  before:CoverageState;
  after:CoverageState;
  changed:boolean;
  persisted:false;
}

/* ------------------------------------------------------------------------ */
/* Source coverage desk snapshot                                           */
/* ------------------------------------------------------------------------ */

export interface CoveragePriorityItem{
  coverageGapId:string;
  organization:string;
  coverageStatus:CoverageGapState;
  reason:string;
}

export interface BlockedSourceItem{
  sourceId:string;
  organization:string;
  health:ProductionHealthState;
}

export interface SourceCoverageDeskSnapshot{
  totalCoverageGaps:number;
  uncovered:number;
  blocked:number;
  partial:number;
  usable:number;
  sourceCandidates:number;
  awaitingApproval:number;
  reassessmentRequired:number;
  topOnboardingPriorities:CoveragePriorityItem[];
  topBlockedSources:BlockedSourceItem[];
  ruleVersion:string;
}
