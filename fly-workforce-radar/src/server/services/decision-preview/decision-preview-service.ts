import type{OpportunityGraph}from"../../../domain/opportunity";import type{EligibilityResult,EligibilitySnapshot,EligibilityType}from"../../../domain/eligibility";import type{ScoreSnapshot}from"../../../domain/scoring";import type{CommercialAction}from"../../../domain/commercial-action";import type{AggregatedCandidate}from"../../../domain/evidence-aggregation";import type{EligibilityRepository}from"../../repositories/eligibility/eligibility-repository";import type{ScoringRepository}from"../../repositories/scoring/scoring-repository";import type{CommercialActionRepository}from"../../repositories/commercial-action/commercial-action-repository";import{EligibilityService}from"../eligibility/eligibility-service";import{ScoringService}from"../scoring/scoring-service";import{CommercialActionService}from"../commercial-action/commercial-action-service";import{graph,qualificationSeed,seedWithAggregatedEvidence}from"../opportunity-qualification/opportunity-qualification-service";import{aggregatedCandidates,DEFAULT_AT}from"../evidence-aggregation/evidence-aggregation-service";

/**
 * Stage 2N-B. Answers the question a human reviewer actually has in front of a
 * human-verification-ops-service queue item: "if I verify THIS candidate, what
 * downstream outcome changes?" -- across eligibility, score, and commercial action,
 * not just the single gate humanReviewQueue's wouldUnlock() already checks.
 *
 * This runs the REAL, unmodified graph()/EligibilityService/ScoringService/
 * CommercialActionService pipeline twice against the real Seed returned by
 * qualificationSeed(candidate.opportunityId): once as-is, and once enriched via the
 * real (already-tested) seedWithAggregatedEvidence() with a copy of the candidate
 * whose verificationState is forced to "VERIFIED" for the duration of this call only.
 * That hypothetical candidate is never returned, stored, or passed to
 * human-verification-ops-service's applyControlledDecision -- previewing a decision
 * and recording one remain entirely separate, and recording one is still gated to the
 * CONTROLLED_TEST_REVIEW identity on synthetic fixture data.
 */

const noopEligibility:EligibilityRepository={async activeEvidenceIds(ids){return ids},async save(r:EligibilityResult):Promise<EligibilitySnapshot>{return{...r,id:"unused",createdAt:r.evaluatedAt}},async list(){return[]}};
const noopScoring:ScoringRepository={async save(r){return{...r,id:"unused",createdAt:r.evaluatedAt}},async list(){return[]}};
const noopActions:CommercialActionRepository={async save(r){return{...r,id:"unused",createdAt:r.evaluatedAt}},async list(){return[]}};

export interface DecisionPreviewOutcome{eligibility:Record<EligibilityType,boolean>;score:number|null;action:CommercialAction}
export interface DecisionPreviewResult{opportunityId:string;candidateId:string;candidateType:AggregatedCandidate["type"];current:DecisionPreviewOutcome;ifVerified:DecisionPreviewOutcome;changed:boolean;explanation:string}

function outcomeFor(g:OpportunityGraph,asOf:Date):DecisionPreviewOutcome{
  const eligibility=new EligibilityService({graph:async()=>g},noopEligibility,()=>asOf).assess(g,asOf);
  const snapshots:EligibilitySnapshot[]=eligibility.map(r=>({...r,id:`${r.opportunityId}:${r.eligibilityType}`,createdAt:asOf}));
  const score=new ScoringService({graph:async()=>g},noopEligibility,noopScoring,()=>asOf).assess(g,snapshots,asOf);
  const scoreSnapshot:ScoreSnapshot={...score,id:`${g.opportunity.id}:score`,createdAt:asOf};
  const action=new CommercialActionService({graph:async()=>g},noopEligibility,noopScoring,noopActions,()=>asOf).assess(g,snapshots,[scoreSnapshot],asOf);
  return{eligibility:Object.fromEntries(eligibility.map(r=>[r.eligibilityType,r.eligible]))as Record<EligibilityType,boolean>,score:score.score,action:action.action};
}

export function decisionPreview(candidate:AggregatedCandidate,asOf:Date=DEFAULT_AT):DecisionPreviewResult|undefined{
  if(!candidate.opportunityId)return undefined;
  const seed=qualificationSeed(candidate.opportunityId);
  if(!seed)return undefined;
  const current=outcomeFor(graph(seed),asOf);
  const hypothetical:AggregatedCandidate={...candidate,verificationState:"VERIFIED"};
  const ifVerified=outcomeFor(graph(seedWithAggregatedEvidence(seed,[hypothetical])),asOf);
  const changed=JSON.stringify(current)!==JSON.stringify(ifVerified);
  const fmt=(o:DecisionPreviewOutcome)=>`action ${o.action}, score ${o.score??"NOT_SCORABLE"}`;
  return{
    opportunityId:seed.id,
    candidateId:candidate.id,
    candidateType:candidate.type,
    current,
    ifVerified,
    changed,
    explanation:changed?`Verifying this ${candidate.type} candidate would change the projected outcome: ${fmt(current)} -> ${fmt(ifVerified)}`:`Verifying this ${candidate.type} candidate would not change the projected outcome (${fmt(current)}); other gaps still block`,
  };
}

export function decisionPreviewForCandidate(candidateId:string,asOf:Date=DEFAULT_AT):DecisionPreviewResult|undefined{
  const candidate=aggregatedCandidates(asOf).find(c=>c.id===candidateId);
  return candidate?decisionPreview(candidate,asOf):undefined;
}
