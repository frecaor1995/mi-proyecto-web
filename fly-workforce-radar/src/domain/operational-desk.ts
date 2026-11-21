/**
 * Phase 3F Multi-Trade Operational Commercial Desk.
 *
 * This module defines NO new commercial truth. Every field here is read
 * from Phase 3E's WorkforceConversionDossier / RankedWorkforceConversion
 * (hot-conversion-engine.ts), which itself only reads the REAL, unmodified
 * eligibility/scoring/commercial-action/actionability/Active HOT output.
 * Phase 3F answers a different question than Phase 3E: not "is this
 * opportunity HOT," but "what should a human work on, in what order, and
 * why" -- a pure, deterministic re-organization of Phase 3E's own output
 * into operator-facing queues, cards, and inboxes.
 */
import type{ClosureTask,DistanceToHot,NextBestAction,PrioritizedBlocker,ReadinessState,RankedWorkforceConversion,WorkforceConversionDossier}from"./hot-conversion-engine";
import type{OccupationId,TradeId,WorkforceRoleClass}from"./workforce-taxonomy";

export const OPERATIONAL_DESK_RULE_VERSION="operational-desk@1.0.0";

export const WORK_QUEUES=["READY_FOR_COMMERCIAL_CONTACT","VERIFY_CRITICAL_EVIDENCE","FIND_MISSING_EVIDENCE","NEAR_READY","MONITOR","INACTIVE","NO_ACTION"]as const;
export type WorkQueue=(typeof WORK_QUEUES)[number];

/**
 * One operational representation per canonical opportunity/demand. Never a
 * second source of truth: every commercial-state field below is copied
 * verbatim from the WorkforceConversionDossier it was built from.
 */
export interface WorkforceOperationalItem{
  workItemId:string;
  opportunityId:string;
  projectRef:string;
  organization:string|null;

  occupationId:OccupationId|null;
  tradeId:TradeId|null;
  roleClass:WorkforceRoleClass;
  location:string|null;

  hotA:boolean;
  hotB:boolean;
  activeHot:boolean;
  eligible:boolean;
  score:number|null;
  readiness:ReadinessState;
  distanceToHot:DistanceToHot;

  blockers:PrioritizedBlocker[];
  primaryBlocker:PrioritizedBlocker|null;
  nextBestAction:NextBestAction;
  closurePlan:ClosureTask[];

  buyerState:WorkforceConversionDossier["buyerState"];
  vendorRouteState:WorkforceConversionDossier["vendorRouteState"];

  af01State:WorkforceConversionDossier["af01State"];
  af01Scope:WorkforceConversionDossier["af01Scope"];

  contactState:WorkforceConversionDossier["contactState"];
  contactGrade:WorkforceConversionDossier["contactGrade"];
  contactAuthorityScope:WorkforceConversionDossier["contactAuthorityScope"];

  temporalState:WorkforceConversionDossier["temporalState"];
  conflicts:string[];

  humanVerificationItemCount:number;

  commercialPriorityTier:RankedWorkforceConversion["priorityTier"];
  commercialPriorityRank:number;

  workQueue:WorkQueue;
  workReason:string;

  provenanceRefs:string[];
  ruleVersion:string;
}

export interface OperatorActionCard{
  workItemId:string;
  project:string|null;
  organization:string|null;
  trade:TradeId|null;
  occupation:OccupationId|null;
  location:string|null;
  status:ReadinessState;
  hotA:boolean;
  hotB:boolean;
  active:boolean;
  primaryBlocker:string|null;
  nextBestAction:NextBestAction;
  why:string;
  evidenceNeeded:string[];
  humanReviewRequired:boolean;
  provenance:string[];
}

export interface DailyDeskCounts{
  READY_FOR_COMMERCIAL_CONTACT:number;
  VERIFY_CRITICAL_EVIDENCE:number;
  FIND_MISSING_EVIDENCE:number;
  NEAR_READY:number;
  MONITOR:number;
  INACTIVE:number;
  NO_ACTION:number;
}

export interface DailyDeskSummary{
  asOfNote:string;
  counts:DailyDeskCounts;
  totalWorkItems:number;
  topPriorities:OperatorActionCard[];
  dominantBlockers:{code:string;count:number}[];
  tradesRepresented:TradeId[];
  ruleVersion:string;
}

export interface HumanVerificationInboxItem{
  workItemId:string;
  opportunityId:string;
  tradeId:TradeId|null;
  blockerCode:string;
  evidenceType:string;
  candidateEvidenceSummary:string;
  provenanceRefs:string[];
  decisionOptions:readonly["VERIFY","REJECT","NEEDS_MORE_EVIDENCE","DEFER"];
  downstreamGatesAffected:string[];
}

export interface EvidenceClosureInboxItem{
  workItemId:string;
  opportunityId:string;
  tradeId:TradeId|null;
  blockerCode:string;
  taskType:string;
  priority:"HIGH"|"MEDIUM"|"LOW";
  reason:string;
  followedByHumanVerification:boolean;
}

export interface CommercialContactInboxItem{
  workItemId:string;
  opportunityId:string;
  organization:string|null;
  projectRef:string;
  tradeId:TradeId|null;
  occupationId:OccupationId|null;
  buyerState:WorkforceConversionDossier["buyerState"];
  vendorRouteState:WorkforceConversionDossier["vendorRouteState"];
  contactState:WorkforceConversionDossier["contactState"];
  contactGrade:WorkforceConversionDossier["contactGrade"];
  contactAuthorityScope:WorkforceConversionDossier["contactAuthorityScope"];
  af01State:WorkforceConversionDossier["af01State"];
  temporalState:WorkforceConversionDossier["temporalState"];
  recommendedCommercialAction:string;
  provenanceRefs:string[];
}

/**
 * Optional (Phase 3F section 26). Preparation for a later human-controlled
 * workflow -- never sent, never contains generated outreach copy. Only
 * produced for items already in READY_FOR_COMMERCIAL_CONTACT.
 */
export interface CommercialActionDraft{
  actionType:string;
  opportunityId:string;
  contactRouteRef:string|null;
  objective:string;
  contextFacts:string[];
  evidenceRefs:string[];
  operatorWarnings:string[];
}

export interface WorkItemFacets{
  tradeId?:TradeId;
  occupationId?:OccupationId;
  roleClass?:WorkforceRoleClass;
  location?:string;
  organization?:string;
  projectRef?:string;
  hotA?:boolean;
  hotB?:boolean;
  activeHot?:boolean;
  eligible?:boolean;
  readiness?:ReadinessState;
  workQueue?:WorkQueue;
  blocker?:string;
  nextBestAction?:NextBestAction;
  temporalState?:WorkforceConversionDossier["temporalState"];
  contactGrade?:WorkforceConversionDossier["contactGrade"];
}

export const WORK_ITEM_SORT_KEYS=["COMMERCIAL_PRIORITY","DISTANCE_TO_HOT","BLOCKER_COUNT","TRADE","COMPANY","LOCATION"]as const;
export type WorkItemSortKey=(typeof WORK_ITEM_SORT_KEYS)[number];

export interface ProjectGroup{projectRef:string;items:WorkforceOperationalItem[]}
export interface CompanyGroup{organization:string;items:WorkforceOperationalItem[]}
