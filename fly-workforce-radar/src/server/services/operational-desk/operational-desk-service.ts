/**
 * Phase 3F Multi-Trade Operational Commercial Desk composition.
 *
 * Composes, never reimplements: hot-conversion-engine-service.ts's
 * evaluateWorkforceConversion / rankWorkforceConversions (Phase 3E), which
 * itself composes the REAL eligibility/scoring/commercial-action/
 * actionability/Active HOT pipeline. This file only reorganizes that
 * already-computed truth into deterministic operator queues, cards, and
 * inboxes. It never mutates a dossier, never re-derives eligibility/HOT,
 * and never issues a human decision.
 */
import type{NextBestAction,PrioritizedBlocker,RankedWorkforceConversion,WorkforceConversionDossier}from"../../../domain/hot-conversion-engine";
import type{
  CommercialActionDraft,CommercialContactInboxItem,CompanyGroup,DailyDeskCounts,DailyDeskSummary,
  EvidenceClosureInboxItem,HumanVerificationInboxItem,OperatorActionCard,ProjectGroup,
  WorkItemFacets,WorkItemSortKey,WorkQueue,WorkforceOperationalItem,
}from"../../../domain/operational-desk";
import{OPERATIONAL_DESK_RULE_VERSION}from"../../../domain/operational-desk";

/* ------------------------------------------------------------------------ */
/* Queue assignment (deterministic, reuses Phase 3E's own vocabulary)       */
/* ------------------------------------------------------------------------ */

const VERIFY_NEXT_ACTIONS=new Set<NextBestAction>(["VERIFY_AF01","VERIFY_CONTACT","VERIFY_CONTACT_AUTHORITY","VERIFY_TEMPORAL_STATUS","VERIFY_PROJECT_RELATIONSHIP","RESOLVE_CONFLICT"]);
const FIND_NEXT_ACTIONS=new Set<NextBestAction>(["FIND_AF01_EVIDENCE","FIND_ACTIONABLE_CONTACT","COMPLETE_VENDOR_REGISTRATION_RESEARCH"]);

/** Broader than opportunity-actionability.ts's own EXPLICIT_TERMINAL_STATUSES
 * (CLOSED/AWARDED/CANCELLED/TERMINATED): Phase 3F's INACTIVE queue must also
 * catch EXPIRED (a computed, not explicitly-observed, terminal state) --
 * Phase 3F section 14 explicitly lists CLOSED/CANCELLED/EXPIRED together.
 * This is purely a queue-labeling grouping, not a change to Phase 3E/3D's
 * own actionability state machine. */
const INACTIVE_TEMPORAL_STATES=new Set(["CLOSED","AWARDED","CANCELLED","TERMINATED","EXPIRED"]);

/**
 * Priority order: Active HOT first (never bypassable), then terminal/inactive
 * temporal state, then unresolved conflicts (verification work per Phase 3F
 * section 10), then Phase 3E's own next-best-action (never re-derived --
 * only relabeled into an operator queue). NEAR_READY is reserved for the
 * case Phase 3E's own readiness already calls NEAR_READY *and* more than
 * one blocker remains: with a single dominant blocker, naming its specific
 * VERIFY/FIND action is more useful to the operator than the aggregate
 * label (Phase 3F section 35 scenario I); with two, the aggregate view is
 * shown instead (scenario E). Readiness itself is never redefined.
 */
export function assignWorkQueue(d:WorkforceConversionDossier):{queue:WorkQueue;reason:string}{
  if(d.activeHotA||d.activeHotB)return{queue:"READY_FOR_COMMERCIAL_CONTACT",reason:`Active ${d.activeHotA?"HOT-A":"HOT-B"}: canonical eligibility, actionability, and commercial action all support immediate contact.`};
  if(INACTIVE_TEMPORAL_STATES.has(d.temporalState))return{queue:"INACTIVE",reason:`Actionability state is ${d.temporalState}; this opportunity is terminal and not currently workable.`};
  if(d.readiness==="CONFLICTING")return{queue:"VERIFY_CRITICAL_EVIDENCE",reason:"An unresolved material conflict blocks commercial truth; human resolution is required before anything else."};

  const base:{queue:WorkQueue;reason:string}=
    VERIFY_NEXT_ACTIONS.has(d.nextBestAction)?{queue:"VERIFY_CRITICAL_EVIDENCE",reason:`Candidate evidence exists; verifying it (${d.nextBestAction}) could change eligibility or Active HOT.`}:
    FIND_NEXT_ACTIONS.has(d.nextBestAction)?{queue:"FIND_MISSING_EVIDENCE",reason:`Required evidence does not yet exist; ${d.nextBestAction} is the smallest legitimate next step.`}:
    d.nextBestAction==="MONITOR_FOR_NEW_EVIDENCE"?{queue:"MONITOR",reason:"No evidence-gathering action is realistically available right now; this opportunity should be revisited if new evidence appears."}:
    {queue:"NO_ACTION",reason:"No blocker exists that operator time would materially advance right now."};

  if(d.readiness==="NEAR_READY"&&d.blockers.length>=2&&(base.queue==="VERIFY_CRITICAL_EVIDENCE"||base.queue==="FIND_MISSING_EVIDENCE")){
    return{queue:"NEAR_READY",reason:`${base.reason} Only ${d.distanceToHot.blockingGatesRemaining} blocking gate(s) remain.`};
  }
  return base;
}

/* ------------------------------------------------------------------------ */
/* Work item construction                                                   */
/* ------------------------------------------------------------------------ */

/** Deterministic: same opportunityId always produces the same workItemId.
 * No randomness, no clock read. */
function workItemIdFor(opportunityId:string):string{
  return`work-item:${opportunityId}`;
}

export function buildWorkItem(ranked:RankedWorkforceConversion):WorkforceOperationalItem{
  const d=ranked.dossier;
  const{queue,reason}=assignWorkQueue(d);
  const primaryBlocker:PrioritizedBlocker|null=d.blockers[0]??null;
  return{
    workItemId:workItemIdFor(d.opportunityId),
    opportunityId:d.opportunityId,
    projectRef:d.projectRef,
    organization:d.organization,
    occupationId:d.workforceClassification.occupationId,
    tradeId:d.tradeId,
    roleClass:d.roleClass,
    location:d.location,
    hotA:d.activeHotA,
    hotB:d.activeHotB,
    activeHot:d.activeHotA||d.activeHotB,
    eligible:d.eligibility.some(e=>e.eligible),
    score:d.score.score,
    readiness:d.readiness,
    distanceToHot:d.distanceToHot,
    blockers:d.blockers,
    primaryBlocker,
    nextBestAction:d.nextBestAction,
    closurePlan:d.closurePlan,
    buyerState:d.buyerState,
    vendorRouteState:d.vendorRouteState,
    af01State:d.af01State,
    af01Scope:d.af01Scope,
    contactState:d.contactState,
    contactGrade:d.contactGrade,
    contactAuthorityScope:d.contactAuthorityScope,
    temporalState:d.temporalState,
    conflicts:d.conflicts,
    humanVerificationItemCount:d.humanVerificationItemCount,
    commercialPriorityTier:ranked.priorityTier,
    commercialPriorityRank:ranked.rank,
    workQueue:queue,
    workReason:reason,
    provenanceRefs:d.provenanceSummary,
    ruleVersion:`${OPERATIONAL_DESK_RULE_VERSION}+${d.ruleVersion}`,
  };
}

/**
 * Builds work items from already-ranked dossiers, then deduplicates by
 * canonical opportunity identity (workItemId). No fuzzy merging: the first
 * occurrence in ranked order wins, later duplicates are counted and
 * dropped, never combined.
 */
export function buildWorkItems(ranked:readonly RankedWorkforceConversion[]):{items:WorkforceOperationalItem[];duplicatesSuppressed:number}{
  const seen=new Set<string>();
  const items:WorkforceOperationalItem[]=[];
  let duplicatesSuppressed=0;
  for(const r of ranked){
    const item=buildWorkItem(r);
    if(seen.has(item.workItemId)){duplicatesSuppressed++;continue}
    seen.add(item.workItemId);
    items.push(item);
  }
  return{items,duplicatesSuppressed};
}

/* ------------------------------------------------------------------------ */
/* Operator action card / daily desk                                        */
/* ------------------------------------------------------------------------ */

function evidenceNeededFor(item:WorkforceOperationalItem):string[]{
  const notes:Record<string,string>={
    MISSING_AF01:"Official evidence that the organization accepts supplemental/craft labor vendors for the relevant scope.",
    AF01_UNVERIFIED:"Human verification of existing candidate AF-01 acceptance evidence.",
    AF01_STALE:"A current re-verification of previously VERIFIED AF-01 acceptance (its validity window has passed).",
    AF01_CONFLICT:"New evidence resolving a prior AF-01 rejection.",
    AF01_SCOPE_UNSUPPORTED:`Evidence that the existing acceptance explicitly covers ${item.tradeId??"this trade"}.`,
    MISSING_ACTIONABLE_CONTACT:"A public procurement, vendor, or professional contact route.",
    CONTACT_UNVERIFIED:"Human verification of an existing candidate contact route.",
    CONTACT_STALE:"A current re-verification of a previously verified contact route.",
    CONTACT_AUTHORITY_UNKNOWN:"Evidence establishing this contact's decision-path authority.",
    CONTACT_AUTHORITY_SCOPE_UNSUPPORTED:`Evidence that this contact's authority explicitly covers ${item.tradeId??"this trade"}.`,
    TEMPORAL_UNKNOWN:"Explicit posting status or deadline evidence.",
    MISSING_PROJECT_RELATIONSHIP:"Explicit evidence naming the project this demand belongs to.",
    BLOCKING_CONFLICT:"Human resolution of the conflicting evidence.",
    HUMAN_VERIFICATION_REQUIRED:"A pending required human review must resolve to VERIFY.",
  };
  return item.primaryBlocker?[notes[item.primaryBlocker.code]??`Evidence resolving ${item.primaryBlocker.code}.`]:[];
}

export function buildOperatorActionCard(item:WorkforceOperationalItem):OperatorActionCard{
  return{
    workItemId:item.workItemId,
    project:item.projectRef,
    organization:item.organization,
    trade:item.tradeId,
    occupation:item.occupationId,
    location:item.location,
    status:item.readiness,
    hotA:item.hotA,
    hotB:item.hotB,
    active:item.activeHot,
    primaryBlocker:item.primaryBlocker?.code??null,
    nextBestAction:item.nextBestAction,
    why:item.workReason,
    evidenceNeeded:evidenceNeededFor(item),
    humanReviewRequired:item.humanVerificationItemCount>0,
    provenance:item.provenanceRefs,
  };
}

const EMPTY_COUNTS:DailyDeskCounts={READY_FOR_COMMERCIAL_CONTACT:0,VERIFY_CRITICAL_EVIDENCE:0,FIND_MISSING_EVIDENCE:0,NEAR_READY:0,MONITOR:0,INACTIVE:0,NO_ACTION:0};

export function buildDailyDesk(items:readonly WorkforceOperationalItem[],topN=5):DailyDeskSummary{
  const counts:DailyDeskCounts={...EMPTY_COUNTS};
  for(const item of items)counts[item.workQueue]++;
  const sorted=[...items].sort((a,b)=>a.commercialPriorityRank-b.commercialPriorityRank);
  const blockerCounts=new Map<string,number>();
  for(const item of items)if(item.primaryBlocker)blockerCounts.set(item.primaryBlocker.code,(blockerCounts.get(item.primaryBlocker.code)??0)+1);
  const dominantBlockers=[...blockerCounts.entries()].map(([code,count])=>({code,count})).sort((a,b)=>b.count-a.count||a.code.localeCompare(b.code));
  return{
    asOfNote:"Report output only; reflects the canonical dossiers supplied to this evaluation, not persisted state.",
    counts,
    totalWorkItems:items.length,
    topPriorities:sorted.slice(0,topN).map(buildOperatorActionCard),
    dominantBlockers,
    tradesRepresented:[...new Set(items.map(i=>i.tradeId).filter((t):t is NonNullable<typeof t>=>!!t))].sort(),
    ruleVersion:OPERATIONAL_DESK_RULE_VERSION,
  };
}

/* ------------------------------------------------------------------------ */
/* Inboxes                                                                   */
/* ------------------------------------------------------------------------ */

const VERIFY_EVIDENCE_TYPE:Partial<Record<string,string>>={
  AF01_UNVERIFIED:"AF-01 external manpower acceptance",AF01_STALE:"AF-01 external manpower acceptance",AF01_CONFLICT:"AF-01 external manpower acceptance",
  CONTACT_UNVERIFIED:"Contact route",CONTACT_STALE:"Contact route",CONTACT_AUTHORITY_UNKNOWN:"Contact authority scope",
  HUMAN_VERIFICATION_REQUIRED:"Pending required review",BLOCKING_CONFLICT:"Conflicting evidence",
};
const DOWNSTREAM_GATES:Partial<Record<string,string[]>>={
  AF01_UNVERIFIED:["G5_EXTERNAL_MANPOWER_ACCEPTANCE","G10_ELIGIBILITY","G13_ACTIVE_HOT"],
  AF01_STALE:["G5_EXTERNAL_MANPOWER_ACCEPTANCE","G10_ELIGIBILITY","G13_ACTIVE_HOT"],
  AF01_CONFLICT:["G5_EXTERNAL_MANPOWER_ACCEPTANCE","G9_HUMAN_VERIFICATION_CONFLICT_SAFETY"],
  CONTACT_UNVERIFIED:["G7_ACTIONABLE_CONTACT","G10_ELIGIBILITY","G13_ACTIVE_HOT"],
  CONTACT_STALE:["G7_ACTIONABLE_CONTACT","G10_ELIGIBILITY","G13_ACTIVE_HOT"],
  CONTACT_AUTHORITY_UNKNOWN:["G7_ACTIONABLE_CONTACT"],
  HUMAN_VERIFICATION_REQUIRED:["G9_HUMAN_VERIFICATION_CONFLICT_SAFETY","G10_ELIGIBILITY"],
  BLOCKING_CONFLICT:["G9_HUMAN_VERIFICATION_CONFLICT_SAFETY","G10_ELIGIBILITY","G13_ACTIVE_HOT"],
};

/** Never issues a decision -- only surfaces what a human must decide on. */
export function buildHumanVerificationInbox(items:readonly WorkforceOperationalItem[]):HumanVerificationInboxItem[]{
  return items.flatMap(item=>item.blockers.filter(b=>b.code in VERIFY_EVIDENCE_TYPE).map((b):HumanVerificationInboxItem=>({
    workItemId:item.workItemId,opportunityId:item.opportunityId,tradeId:item.tradeId,blockerCode:b.code,
    evidenceType:VERIFY_EVIDENCE_TYPE[b.code]??b.code,candidateEvidenceSummary:b.reason,
    provenanceRefs:item.provenanceRefs,decisionOptions:["VERIFY","REJECT","NEEDS_MORE_EVIDENCE","DEFER"]as const,
    downstreamGatesAffected:DOWNSTREAM_GATES[b.code]??[],
  })));
}

const HUMAN_VERIFICATION_FOLLOWS=new Set(["FIND_AF01_EVIDENCE","VERIFY_AF01","FIND_ACTIONABLE_CONTACT","VERIFY_CONTACT","VERIFY_CONTACT_AUTHORITY","RESOLVE_CONFLICT"]);

/** Reuses Phase 3E's own closurePlan verbatim; adds no new task type. */
export function buildEvidenceClosureInbox(items:readonly WorkforceOperationalItem[]):EvidenceClosureInboxItem[]{
  return items.flatMap(item=>item.closurePlan.map((t):EvidenceClosureInboxItem=>({
    workItemId:item.workItemId,opportunityId:item.opportunityId,tradeId:item.tradeId,
    blockerCode:t.targetBlocker,taskType:t.taskType,priority:t.priority,
    reason:`Resolves ${t.targetBlocker} via ${t.taskType}.`,
    followedByHumanVerification:HUMAN_VERIFICATION_FOLLOWS.has(t.taskType),
  })));
}

export function buildCommercialContactInbox(items:readonly WorkforceOperationalItem[]):CommercialContactInboxItem[]{
  return items.filter(i=>i.workQueue==="READY_FOR_COMMERCIAL_CONTACT").map((item):CommercialContactInboxItem=>({
    workItemId:item.workItemId,opportunityId:item.opportunityId,organization:item.organization,projectRef:item.projectRef,
    tradeId:item.tradeId,occupationId:item.occupationId,buyerState:item.buyerState,vendorRouteState:item.vendorRouteState,
    contactState:item.contactState,contactGrade:item.contactGrade,contactAuthorityScope:item.contactAuthorityScope,
    af01State:item.af01State,temporalState:item.temporalState,recommendedCommercialAction:item.nextBestAction,
    provenanceRefs:item.provenanceRefs,
  }));
}

/** Optional (section 26). Never contains generated outreach copy; only
 * produced for items already legitimately READY. */
export function buildCommercialActionDraft(item:WorkforceOperationalItem):CommercialActionDraft|null{
  if(item.workQueue!=="READY_FOR_COMMERCIAL_CONTACT")return null;
  const warnings:string[]=[];
  if(!item.contactGrade)warnings.push("No contact grade captured on this dossier; retrieve the target route from the underlying contact evidence record before contacting.");
  return{
    actionType:item.nextBestAction,
    opportunityId:item.opportunityId,
    contactRouteRef:item.contactGrade?`grade:${item.contactGrade}`:null,
    objective:"Human-reviewed commercial outreach preparation only; this object is not sent.",
    contextFacts:[item.organization?`Organization: ${item.organization}`:null,item.tradeId?`Trade: ${item.tradeId}`:null,item.location?`Location: ${item.location}`:null].filter((x):x is string=>!!x),
    evidenceRefs:item.provenanceRefs,
    operatorWarnings:warnings,
  };
}

/* ------------------------------------------------------------------------ */
/* Grouping, filtering, sorting                                             */
/* ------------------------------------------------------------------------ */

export function groupByProject(items:readonly WorkforceOperationalItem[]):ProjectGroup[]{
  const byProject=new Map<string,WorkforceOperationalItem[]>();
  for(const item of items){const list=byProject.get(item.projectRef)??[];list.push(item);byProject.set(item.projectRef,list)}
  return[...byProject.entries()].map(([projectRef,groupItems])=>({projectRef,items:groupItems})).sort((a,b)=>a.projectRef.localeCompare(b.projectRef));
}

export function groupByCompany(items:readonly WorkforceOperationalItem[]):CompanyGroup[]{
  const byOrg=new Map<string,WorkforceOperationalItem[]>();
  for(const item of items){
    if(!item.organization)continue;
    const list=byOrg.get(item.organization)??[];list.push(item);byOrg.set(item.organization,list);
  }
  return[...byOrg.entries()].map(([organization,groupItems])=>({organization,items:groupItems})).sort((a,b)=>a.organization.localeCompare(b.organization));
}

export function filterWorkItems(items:readonly WorkforceOperationalItem[],facets:WorkItemFacets):WorkforceOperationalItem[]{
  return items.filter(i=>
    (facets.tradeId===undefined||i.tradeId===facets.tradeId)&&
    (facets.occupationId===undefined||i.occupationId===facets.occupationId)&&
    (facets.roleClass===undefined||i.roleClass===facets.roleClass)&&
    (facets.location===undefined||i.location===facets.location)&&
    (facets.organization===undefined||i.organization===facets.organization)&&
    (facets.projectRef===undefined||i.projectRef===facets.projectRef)&&
    (facets.hotA===undefined||i.hotA===facets.hotA)&&
    (facets.hotB===undefined||i.hotB===facets.hotB)&&
    (facets.activeHot===undefined||i.activeHot===facets.activeHot)&&
    (facets.eligible===undefined||i.eligible===facets.eligible)&&
    (facets.readiness===undefined||i.readiness===facets.readiness)&&
    (facets.workQueue===undefined||i.workQueue===facets.workQueue)&&
    (facets.blocker===undefined||i.blockers.some(b=>b.code===facets.blocker))&&
    (facets.nextBestAction===undefined||i.nextBestAction===facets.nextBestAction)&&
    (facets.temporalState===undefined||i.temporalState===facets.temporalState)&&
    (facets.contactGrade===undefined||i.contactGrade===facets.contactGrade)
  );
}

export function sortWorkItems(items:readonly WorkforceOperationalItem[],key:WorkItemSortKey):WorkforceOperationalItem[]{
  const cmp:Record<WorkItemSortKey,(a:WorkforceOperationalItem,b:WorkforceOperationalItem)=>number>={
    COMMERCIAL_PRIORITY:(a,b)=>a.commercialPriorityRank-b.commercialPriorityRank,
    DISTANCE_TO_HOT:(a,b)=>a.distanceToHot.blockingGatesRemaining-b.distanceToHot.blockingGatesRemaining,
    BLOCKER_COUNT:(a,b)=>a.blockers.length-b.blockers.length,
    TRADE:(a,b)=>(a.tradeId??"").localeCompare(b.tradeId??""),
    COMPANY:(a,b)=>(a.organization??"").localeCompare(b.organization??""),
    LOCATION:(a,b)=>(a.location??"").localeCompare(b.location??""),
  };
  return[...items].sort((a,b)=>cmp[key](a,b)||a.workItemId.localeCompare(b.workItemId));
}

export function facetQueue(items:readonly WorkforceOperationalItem[],queue:WorkQueue):WorkforceOperationalItem[]{
  return items.filter(i=>i.workQueue===queue);
}
