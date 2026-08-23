import type{SourceFamily}from"./production-source";

/**
 * Phase 2K hardening/audit vocabulary. This file adds no capture, scoring or
 * scheduling behavior. It extends Phase 2J's PLATFORM_CLASSIFICATIONS bright line
 * (documented/intentionally-public vs merely browser-visible) down to the level of
 * an individual source, and adds the portfolio-value and market-coverage lenses
 * requested for this phase's audit. Every type here describes an audit finding,
 * never an approval: nothing in this file grants readiness or policy status by
 * itself, and nothing here replaces the existing production-source/targeted-evidence
 * domain vocabulary it is built on top of (production-source.ts, multi-source.ts,
 * commercial-intelligence.ts, targeted-evidence-closure.ts).
 */

export const ACCESS_LEGITIMACY_CATEGORIES=["PUBLIC_DOCUMENTED_ENDPOINT","PUBLIC_SERVER_RENDERED_PAGE","PUBLIC_STATIC_DOCUMENT","PUBLIC_FEED","PUBLIC_STRUCTURED_DATA","PUBLIC_BROWSER_PAGE","BROWSER_VISIBLE_UNDOCUMENTED_ENDPOINT","SESSION_DEPENDENT","AUTH_REQUIRED","BLOCKED","UNCLEAR"]as const;
export type AccessLegitimacyCategory=(typeof ACCESS_LEGITIMACY_CATEGORIES)[number];

/** Where a source's ACTIVATE/decision entry actually lives in the codebase today. */
export const SOURCE_ORIGINS=["PHASE_2B_STANDALONE_ADAPTER","PHASE_2C_MULTI_SOURCE","PHASE_2D_COMMERCIAL_INTELLIGENCE","PHASE_2F_HOT_EVIDENCE","PHASE_2H_TARGETED_EVIDENCE","PHASE_2I_TARGETED_EVIDENCE","PHASE_2J_TARGETED_EVIDENCE"]as const;
export type SourceOrigin=(typeof SOURCE_ORIGINS)[number];

export type SourceDecisionState="ACTIVATE"|"UNDER_REVIEW"|"DEFER"|"BLOCKED";

/**
 * Phase 2K's portfolio-value taxonomy. This extends (does not replace) the
 * PortfolioClass vocabulary already declared in domain/targeted-evidence-closure.ts:
 * HIGH_VALUE, LOW_YIELD, UNDER_REVIEW and BLOCKED are the same concepts reused
 * verbatim; SUPPORTING is the Phase 2K name for what targeted-evidence-closure.ts
 * called USEFUL (a source producing real but non-scarce evidence, e.g. demand-only);
 * RETIRED is the Phase 2K name for what targeted-evidence-closure.ts called STALE
 * (a historical posting confirmed gone). The rename exists only because this phase's
 * brief specified these exact six labels for the portfolio-value deliverable; the
 * meaning is unchanged and no existing PortfolioClass value on any Phase 2H/2J
 * TargetedSource record is altered by this file.
 */
export type Phase2kPortfolioValue="HIGH_VALUE"|"SUPPORTING"|"LOW_YIELD"|"UNDER_REVIEW"|"BLOCKED"|"RETIRED";

export interface SourceInventoryEntry{
  key:string;
  name:string;
  endpoint:string;
  family:SourceFamily|string;
  markets:string[];
  origin:SourceOrigin;
  decision:SourceDecisionState;
  accessLegitimacy:AccessLegitimacyCategory;
  legitimacyRationale:string;
  observedEvidenceCount:number;
  observedEvidenceLedgers:string[];
  closesScarceGap:boolean;
  portfolioValue:Phase2kPortfolioValue;
  portfolioRationale:string;
}

export type TechDebtResolutionOutcome="RESOLVED_COMPLIANT_ROUTE"|"RECLASSIFIED_UNDER_REVIEW"|"BLOCKED"|"RETIRED"|"UNRESOLVED_MANAGER_DECISION_REQUIRED";

export interface TechDebtResolution{
  id:string;
  title:string;
  investigatedAt:Date;
  findings:string[];
  outcome:TechDebtResolutionOutcome;
  rationale:string;
  historicalEvidencePreserved:boolean;
  downstreamAction:string;
}

export interface DuplicateInventoryGroup{endpoint:string;keys:string[];origins:SourceOrigin[]}

export interface SourceInventoryReconstruction{
  rawEntries:number;
  uniqueByEndpoint:number;
  duplicates:DuplicateInventoryGroup[];
  narrativeClaimed:number;
  narrativeAccurate:boolean;
  narrativeDiscrepancyReason:string|null;
}

export interface MarketCoverageEntry{
  market:string;
  sourcesTouching:number;
  observedEvidenceCount:number;
  evidenceClassesPresent:string[];
  evidenceClassesMissing:string[];
  largestGap:string;
}

export interface HotGapFinding{
  eligibilityType:"VAMO_ELIGIBLE"|"HOT_A_ELIGIBLE"|"HOT_B_ELIGIBLE";
  structuralBlockers:string[];
  blockerExplanations:string[];
  enrichmentGapsNotBlocking:string[];
  explanation:string;
}
