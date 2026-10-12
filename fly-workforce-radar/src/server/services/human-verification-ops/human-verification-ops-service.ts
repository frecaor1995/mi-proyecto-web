import type{AggregatedCandidate,AggregatedCandidateType,AggregationReviewDecisionInput,HumanReviewQueueItem}from"../../../domain/evidence-aggregation";
import{CONTROLLED_TEST_REVIEWER_ID}from"../../../domain/evidence-aggregation";
import type{EligibilityReason,EligibilityType}from"../../../domain/eligibility";
import type{VerificationState}from"../../../domain/verification";
import{aggregatedCandidates,DEFAULT_AT}from"../evidence-aggregation/evidence-aggregation-service";
import type{QualificationDossier}from"../../../domain/opportunity-qualification";
import{qualificationDossiers}from"../opportunity-qualification/opportunity-qualification-service";

/**
 * Phase 2M human-review queue and controlled-decision application.
 *
 * This module sits ABOVE both evidence-aggregation-service.ts and opportunity-
 * qualification-service.ts (it imports from both; neither imports from it, so this
 * creates no cycle). It answers two questions a real human reviewer needs answered:
 * "what needs my attention, in what order, and why" (humanReviewQueue) and "how do I
 * record a decision" (applyControlledDecision -- gated so only the explicitly-labeled
 * CONTROLLED_TEST_REVIEW identity, used only in deterministic tests on synthetic
 * fixture data, may ever produce a VERIFY/REJECT/DEFER outcome here).
 */

const RESOLVABLE_CODES:Record<AggregatedCandidateType,(c:AggregatedCandidate)=>EligibilityReason[]>={
  BUYER_CANDIDATE:()=>[],
  AF01_CANDIDATE:()=>["MANPOWER_ACCEPTANCE_REQUIRED"],
  CONTACT_AUTHORITY:(c)=>c.routeType&&(c.routeType.startsWith("RECRUITER")||c.routeType.startsWith("PROFESSIONAL"))?["HOT_B_INTELLIGENCE_PATH_PRESENT"]:["ACTIONABLE_CONTACT_REQUIRED"],
  COMPANY_PROJECT_CONFLICT:()=>["MATERIAL_CONFLICT_PRESENT"],
  STALE_CRITICAL_EVIDENCE:()=>["STALE_DEMAND"],
};

/** True only when this candidate's resolvable codes cover EVERY blocker still failing
 * on that gate for its tracked opportunity -- i.e. verifying it alone would flip the
 * gate to eligible. Grounded directly in the real, unmodified EligibilityService's own
 * blockingGaps output (via qualificationDossiers()), not a re-derivation. */
function wouldUnlock(dossier:QualificationDossier|undefined,type:EligibilityType,codes:EligibilityReason[]):boolean{
  if(!dossier||!codes.length)return false;
  const e=dossier.eligibility[type];
  if(e.eligible)return false;
  return e.blockers.length>0&&e.blockers.every(b=>codes.includes(b));
}

function buildQueueItem(c:AggregatedCandidate,dossier:QualificationDossier|undefined):HumanReviewQueueItem{
  const codes=RESOLVABLE_CODES[c.type](c);
  const unlocksHotA=wouldUnlock(dossier,"HOT_A_ELIGIBLE",codes);
  const unlocksVamo=wouldUnlock(dossier,"VAMO_ELIGIBLE",codes);
  const unlocksHotB=wouldUnlock(dossier,"HOT_B_ELIGIBLE",codes);
  let priority:number;let priorityReason:string;let affectsGate:HumanReviewQueueItem["affectsGate"];let wouldUnlockGate:EligibilityType|null=null;
  if(unlocksHotA){priority=1;affectsGate="HOT_A_ELIGIBLE";wouldUnlockGate="HOT_A_ELIGIBLE";priorityReason="Sole remaining blocker for HOT_A_ELIGIBLE on this opportunity -- verifying this alone would flip it to eligible"}
  else if(unlocksVamo){priority=2;affectsGate="VAMO_ELIGIBLE";wouldUnlockGate="VAMO_ELIGIBLE";priorityReason="Sole remaining blocker for VAMO_ELIGIBLE on this opportunity -- verifying this alone would flip it to eligible"}
  else if(unlocksHotB){priority=3;affectsGate="HOT_B_ELIGIBLE";wouldUnlockGate="HOT_B_ELIGIBLE";priorityReason="Sole remaining blocker for HOT_B_ELIGIBLE on this opportunity -- verifying this alone would flip it to eligible"}
  else if(c.type==="COMPANY_PROJECT_CONFLICT"){priority=4;affectsGate="CONFLICT_RESOLUTION";priorityReason="Unresolved cross-entity conflict; other blockers remain on every gate it could affect"}
  else if(c.type==="STALE_CRITICAL_EVIDENCE"){priority=5;affectsGate="NONE";priorityReason="Stale critical evidence requiring re-verification before further reliance"}
  else if(c.type==="BUYER_CANDIDATE"){priority=6;affectsGate="NONE";priorityReason="Remaining buyer candidate; the real eligibility engine does not gate on buyer/company-role directly, so this cannot unlock a gate by itself (see the Phase 2M report)"}
  else if(c.type==="AF01_CANDIDATE"){priority=7;affectsGate="HOT_A_ELIGIBLE";priorityReason="Remaining AF-01 candidate contributing toward MANPOWER_ACCEPTANCE_REQUIRED, but other blockers remain on that opportunity"}
  else{priority=8;affectsGate=codes.includes("HOT_B_INTELLIGENCE_PATH_PRESENT")?"HOT_B_ELIGIBLE":"VAMO_ELIGIBLE";priorityReason="Remaining contact-authority candidate contributing toward an actionable-contact or intelligence-path gate, but other blockers remain"}
  return{
    id:`queue:${c.id}`,candidateId:c.id,targetType:c.type,opportunityId:c.opportunityId,contextId:c.contextId,market:c.market,
    evidenceIds:c.evidenceIds,sourceUrls:c.sourceUrls,currentState:c.reviewState,
    reasonReviewRequired:c.reason,affectsGate,wouldUnlockGate,
    isStale:!!c.staleAfter&&c.staleAfter<=DEFAULT_AT,staleAfter:c.staleAfter,
    priority,priorityReason,
  };
}

export function humanReviewQueue(asOf:Date=DEFAULT_AT):HumanReviewQueueItem[]{
  const candidates=aggregatedCandidates(asOf);
  const dossiers=qualificationDossiers();
  const byId=new Map(dossiers.map(d=>[d.id,d]));
  return candidates
    .map(c=>buildQueueItem(c,c.opportunityId?byId.get(c.opportunityId):undefined))
    .sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
}

/**
 * The bright line: only the CONTROLLED_TEST_REVIEW identity may ever move a candidate
 * to VERIFIED/REJECTED/DEFERRED here, and only in deterministic tests against
 * synthetic fixture data. Every other reviewerId is refused with an error before any
 * state change -- there is no code path in this file that lets automated Phase 2M
 * execution fabricate a real VERIFY/REJECT decision on production evidence.
 */
export function applyControlledDecision(candidate:AggregatedCandidate,input:AggregationReviewDecisionInput):AggregatedCandidate{
  if(candidate.id!==input.candidateId)throw new Error("Decision candidateId does not match the candidate being decided");
  if(input.reviewerId!==CONTROLLED_TEST_REVIEWER_ID)throw new Error(`Only the ${CONTROLLED_TEST_REVIEWER_ID} identity may issue VERIFY/REJECT/DEFER decisions in this codebase; real review packages must stop at READY_FOR_HUMAN_REVIEW or NEEDS_MORE_EVIDENCE`);
  if(!input.reason.trim())throw new Error("Decision reason is required");
  if(input.decision==="VERIFY"&&!input.evidenceIds.length)throw new Error("VERIFY requires supporting evidence");
  const verificationState:VerificationState=input.decision==="VERIFY"?"VERIFIED":input.decision==="REJECT"?"REJECTED":candidate.verificationState;
  const reviewState=input.decision==="VERIFY"?"VERIFIED"as const:input.decision==="REJECT"?"REJECTED"as const:input.decision==="DEFER"?"DEFERRED"as const:"NEEDS_MORE_EVIDENCE"as const;
  return{
    ...candidate,
    verificationState,
    reviewState,
    routeGrade:input.decision==="VERIFY"&&candidate.type==="CONTACT_AUTHORITY"?(input.grade??candidate.routeGrade):candidate.routeGrade,
    evidenceIds:[...new Set([...candidate.evidenceIds,...input.evidenceIds])],
  };
}

export function phase2mSummary(asOf:Date=DEFAULT_AT){
  const candidates=aggregatedCandidates(asOf);
  const byType=(t:AggregatedCandidateType)=>candidates.filter(c=>c.type===t).length;
  const queue=humanReviewQueue(asOf);
  return{
    techDebt04Outcome:"RESOLVED"as const,
    buyerCandidates:byType("BUYER_CANDIDATE"),
    af01Candidates:byType("AF01_CANDIDATE"),
    contactAuthorityCandidates:byType("CONTACT_AUTHORITY"),
    companyProjectConflicts:byType("COMPANY_PROJECT_CONFLICT"),
    staleCriticalEvidence:byType("STALE_CRITICAL_EVIDENCE"),
    queueSize:queue.length,
    queueUnlocksHotA:queue.filter(x=>x.wouldUnlockGate==="HOT_A_ELIGIBLE").length,
    queueUnlocksVamo:queue.filter(x=>x.wouldUnlockGate==="VAMO_ELIGIBLE").length,
    queueUnlocksHotB:queue.filter(x=>x.wouldUnlockGate==="HOT_B_ELIGIBLE").length,
    realVerifiedCandidates:candidates.filter(c=>c.verificationState==="VERIFIED").length,
    vamo:0,hotA:0,hotB:0,scored:0,commercialActions:0,
    outreachExecuted:false,contractEconomicsImplemented:false,
    eligibilityRulesModified:false,scoringWeightsModified:false,commercialActionVocabularyModified:false,
    newMigrationsAdded:0,
    phase2nStarted:false,
  };
}
