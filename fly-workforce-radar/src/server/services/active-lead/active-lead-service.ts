import type{OpportunityGraph}from"../../../domain/opportunity";import type{EligibilityRepository}from"../../repositories/eligibility/eligibility-repository";import type{ScoringRepository}from"../../repositories/scoring/scoring-repository";import type{EligibilityResult,EligibilitySnapshot}from"../../../domain/eligibility";import type{ActiveHotLead}from"../../../domain/active-lead";import{HOT_TYPES}from"../../../domain/active-lead";import type{ActionabilityInput}from"../../../domain/opportunity-actionability";import{OPEN_COMPATIBLE_STATES,ACTIVE_EXTERNAL_ACTIONS,NO_ACTIONABILITY_EVIDENCE}from"../../../domain/opportunity-actionability";import{EligibilityService}from"../eligibility/eligibility-service";import{ScoringService}from"../scoring/scoring-service";import{gatedCommercialActionForGraph,REAL_ACTIONABILITY_EVIDENCE}from"../opportunity-actionability/opportunity-actionability-service";import{graph,qualificationSeed}from"../opportunity-qualification/opportunity-qualification-service";

/**
 * Phase 2P. Composes the REAL EligibilityService, ScoringService and
 * gatedCommercialActionForGraph (itself composed from CommercialActionService and
 * opportunity-actionability-service) outputs into one operational ActiveHotLead
 * record. No eligibility/score/action/actionability logic is reimplemented here --
 * this file only reads and assembles.
 */

const noopEligibility:EligibilityRepository={async activeEvidenceIds(ids){return ids},async save(r:EligibilityResult):Promise<EligibilitySnapshot>{return{...r,id:"unused",createdAt:r.evaluatedAt}},async list(){return[]}};
const noopScoring:ScoringRepository={async save(r){return{...r,id:"unused",createdAt:r.evaluatedAt}},async list(){return[]}};
const HOT_ELIGIBILITY_TYPE={HOT_A:"HOT_A_ELIGIBLE",HOT_B:"HOT_B_ELIGIBLE"}as const;
const OPEN_ROUTE_GRADES=new Set(["A","B","C","D"]);

function selectedRouteFor(g:OpportunityGraph):{id:string;type:string;grade:string}|null{
  const grades=new Map(g.routeGrades.map(x=>[String(x.contact_route_id),String(x.grade)]));
  const best=g.contactRoutes.find(r=>OPEN_ROUTE_GRADES.has(grades.get(String(r.id))??""));
  return best?{id:String(best.id),type:String(best.route_type),grade:grades.get(String(best.id))??"E"}:null;
}

export function activeHotLeadsForGraph(g:OpportunityGraph,actionabilityInput:ActionabilityInput,asOf:Date):ActiveHotLead[]{
  const eligibility=new EligibilityService({graph:async()=>g},noopEligibility,()=>asOf).assess(g,asOf);
  const snapshots:EligibilitySnapshot[]=eligibility.map(r=>({...r,id:`${r.opportunityId}:${r.eligibilityType}`,createdAt:asOf}));
  const score=new ScoringService({graph:async()=>g},noopEligibility,noopScoring,()=>asOf).assess(g,snapshots,asOf);
  const gated=gatedCommercialActionForGraph(g,actionabilityInput,asOf);
  const route=selectedRouteFor(g);

  return HOT_TYPES.map((hotType):ActiveHotLead=>{
    const eligibilityType=HOT_ELIGIBILITY_TYPE[hotType];
    const result=eligibility.find(r=>r.eligibilityType===eligibilityType)!;
    const countedForThisType=hotType==="HOT_A"?gated.countsAsActiveHotA:gated.countsAsActiveHotB;
    const active=result.eligible&&countedForThisType&&ACTIVE_EXTERNAL_ACTIONS.has(gated.underlyingAction);
    const temporalBlock=result.eligible&&!OPEN_COMPATIBLE_STATES.has(gated.actionability.state);
    return{
      opportunityId:g.opportunity.id,
      hotType,
      eligible:result.eligible,
      eligibilityBlockers:result.blockingGaps,
      eligibilityType,
      scoreState:score.state,
      score:score.score,
      actionabilityState:gated.actionability.state,
      active,
      selectedRoute:route,
      acceptanceId:g.acceptance?String(g.acceptance.id):null,
      buyerCompanyProjectContext:{company:g.companies[0]?String(g.companies[0].name):null,buyerCandidate:g.companyRoles[0]?String(g.companyRoles[0].role):null,project:g.project?String(g.project.name):null},
      evidenceIds:result.reviewedIdentifiers.evidenceIds,
      blockers:[...result.blockingGaps,...(temporalBlock?["ACTIONABILITY_NOT_OPEN"]:[])],
      recommendedCommercialAction:gated.activeRecommendation,
      evaluatedAt:asOf,
      asOf,
    };
  });
}

export function activeHotLeadsForOpportunity(opportunityId:string,actionabilityInput:ActionabilityInput=NO_ACTIONABILITY_EVIDENCE(opportunityId),asOf:Date=new Date("2026-08-23T12:00:00Z")):ActiveHotLead[]|undefined{
  const seed=qualificationSeed(opportunityId);
  if(!seed)return undefined;
  return activeHotLeadsForGraph(graph(seed),actionabilityInput,asOf);
}

const TRACKED_OPPORTUNITY_IDS=["qual-freeport","qual-beaumont-port-arthur","qual-permian","qual-corpus","qual-amarillo"]as const;

export interface ActiveHotLeadMetrics{
  asOf:Date;
  eligibleCount:number;
  actionableEligibleCount:number;
  activeHotA:number;
  activeHotB:number;
  technicallyEligibleButInactive:number;
  unknownActionabilityEligible:number;
  blockedByAcceptance:number;
  blockedByRoute:number;
  blockedByConflict:number;
  blockedByTemporalStatus:number;
}

/** Real, current metrics across every tracked opportunity's real evidence. Every
 * count is descriptive of what actually exists today -- not a KPI target. */
export function activeHotLeadMetrics(asOf:Date=new Date("2026-08-23T12:00:00Z")):ActiveHotLeadMetrics{
  let eligibleCount=0,actionableEligibleCount=0,activeHotA=0,activeHotB=0,technicallyEligibleButInactive=0,unknownActionabilityEligible=0,blockedByAcceptance=0,blockedByRoute=0,blockedByConflict=0,blockedByTemporalStatus=0;
  for(const id of TRACKED_OPPORTUNITY_IDS){
    const leads=activeHotLeadsForOpportunity(id,REAL_ACTIONABILITY_EVIDENCE[id]??NO_ACTIONABILITY_EVIDENCE(id),asOf)!;
    for(const lead of leads){
      if(lead.eligible){
        eligibleCount++;
        if(lead.active)actionableEligibleCount++;
        else technicallyEligibleButInactive++;
        if(lead.actionabilityState==="UNKNOWN")unknownActionabilityEligible++;
        if(lead.blockers.includes("ACTIONABILITY_NOT_OPEN"))blockedByTemporalStatus++;
      }
      if(lead.active){if(lead.hotType==="HOT_A")activeHotA++;else activeHotB++;}
      if(lead.eligibilityBlockers.includes("MANPOWER_ACCEPTANCE_REQUIRED")||lead.eligibilityBlockers.includes("STALE_ACCEPTANCE"))blockedByAcceptance++;
      if(lead.eligibilityBlockers.includes("ACTIONABLE_CONTACT_REQUIRED")||lead.eligibilityBlockers.includes("STALE_CONTACT_ROUTE"))blockedByRoute++;
      if(lead.eligibilityBlockers.includes("MATERIAL_CONFLICT_PRESENT"))blockedByConflict++;
    }
  }
  return{asOf,eligibleCount,actionableEligibleCount,activeHotA,activeHotB,technicallyEligibleButInactive,unknownActionabilityEligible,blockedByAcceptance,blockedByRoute,blockedByConflict,blockedByTemporalStatus};
}
