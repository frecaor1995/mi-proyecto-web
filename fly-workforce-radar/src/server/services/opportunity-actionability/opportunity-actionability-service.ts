import type{OpportunityGraph}from"../../../domain/opportunity";import type{EligibilityResult,EligibilitySnapshot,EligibilityType}from"../../../domain/eligibility";import type{ScoreSnapshot}from"../../../domain/scoring";import type{EligibilityRepository}from"../../repositories/eligibility/eligibility-repository";import type{ScoringRepository}from"../../repositories/scoring/scoring-repository";import type{CommercialActionRepository}from"../../repositories/commercial-action/commercial-action-repository";import{EligibilityService}from"../eligibility/eligibility-service";import{ScoringService}from"../scoring/scoring-service";import{CommercialActionService}from"../commercial-action/commercial-action-service";import{graph,qualificationSeed}from"../opportunity-qualification/opportunity-qualification-service";
import type{ActionabilityDeadlineEvidence,ActionabilityInput,ActionabilityResult,GatedCommercialActionResult}from"../../../domain/opportunity-actionability";import{ACTIONABILITY_RULE_VERSION,ACTIVE_EXTERNAL_ACTIONS,CLOSING_SOON_WINDOW_DAYS,EXPLICIT_TERMINAL_STATUSES,NO_ACTIONABILITY_EVIDENCE,OPEN_COMPATIBLE_STATES}from"../../../domain/opportunity-actionability";

/**
 * Phase 2O. Adds OPPORTUNITY_ACTIONABILITY as a layer strictly ABOVE the existing
 * eligibility/scoring/commercial-action pipeline: it reads their REAL, unmodified
 * output and never feeds anything back into them. eligibility-service.ts,
 * scoring-service.ts, commercial-action-service.ts and opportunity-qualification-
 * service.ts are untouched by this phase -- this file only imports from them, the
 * same read-only relationship decision-preview-service.ts already established.
 *
 * assessActionability() is a pure function of (ActionabilityInput, asOf): it never
 * infers status from evidence staleness, page unavailability, or absence of a
 * deadline. Every real production Seed today (see REAL_ACTIONABILITY_EVIDENCE)
 * carries NO_ACTIONABILITY_EVIDENCE, because no real captured evidence anywhere in
 * this codebase states an explicit status or an extracted deadline for any of the
 * four tracked opportunities -- so every one of them honestly evaluates to
 * UNKNOWN. That is a finding, not a placeholder to be "corrected" by inventing a
 * deadline; only genuinely observed evidence may ever populate an
 * ActionabilityInput's deadlines/explicitStatus fields.
 */

export function assessActionability(input:ActionabilityInput,asOf:Date,evaluatedAt:Date=asOf):ActionabilityResult{
  const knownDeadlines=[...input.deadlines].filter(d=>d.observedAt<=asOf).sort((a,b)=>a.observedAt.getTime()-b.observedAt.getTime());
  const governing=knownDeadlines.at(-1)??null;
  const superseded=knownDeadlines.slice(0,-1).map((d:ActionabilityDeadlineEvidence)=>({date:d.date,kind:d.kind,evidenceIds:d.evidenceIds}));
  const evidenceIds=[...new Set([...input.evidenceIds,...knownDeadlines.flatMap(d=>d.evidenceIds)])];
  const base={opportunityId:input.opportunityId,ruleVersion:ACTIONABILITY_RULE_VERSION,evaluatedAt,asOf,evidenceIds,governingDeadline:governing?{date:governing.date,kind:governing.kind,evidenceIds:governing.evidenceIds}:null,supersededDeadlines:superseded,explicitStatus:input.explicitStatus};
  const make=(state:ActionabilityResult["state"],blockers:string[],explanation:string):ActionabilityResult=>({...base,state,blockers,explanation});

  if(input.explicitStatus&&(EXPLICIT_TERMINAL_STATUSES as readonly string[]).includes(input.explicitStatus)){
    const status=input.explicitStatus as ActionabilityResult["state"];
    return make(status,[],`Explicit ${status} status observation is authoritative and overrides any deadline computation`);
  }

  const explicitOpenFresh=input.explicitStatus==="OPEN"&&(!input.explicitStatusFreshUntil||input.explicitStatusFreshUntil>=asOf);
  const explicitOpenStale=input.explicitStatus==="OPEN"&&!!input.explicitStatusFreshUntil&&input.explicitStatusFreshUntil<asOf;
  const hasEvidence=!!governing||explicitOpenFresh||explicitOpenStale||!!input.startDate;

  if(!hasEvidence){
    return make("UNKNOWN",["NO_ACTIONABILITY_EVIDENCE"],"No explicit status, deadline, or start-date evidence exists for this opportunity; absence of evidence is never treated as OPEN");
  }
  if(input.startDate&&asOf<input.startDate){
    return make("OPENING_SOON",[],`Start date ${input.startDate.toISOString()} has not yet arrived`);
  }
  if(explicitOpenStale&&!governing){
    return make("STALE_STATUS",["EXPLICIT_STATUS_EVIDENCE_STALE"],"Explicit OPEN status observation is older than its own freshness window and no deadline evidence exists to re-derive currentness; not assumed still open");
  }
  if(governing){
    const windowStart=new Date(governing.date.getTime()-CLOSING_SOON_WINDOW_DAYS*86400000);
    if(asOf>=governing.date)return make("EXPIRED",["DEADLINE_PASSED"],`Governing ${governing.kind.toLowerCase()} deadline ${governing.date.toISOString()} has passed as of ${asOf.toISOString()}`);
    if(asOf>=windowStart)return make("CLOSING_SOON",[],`Governing ${governing.kind.toLowerCase()} deadline ${governing.date.toISOString()} is within the ${CLOSING_SOON_WINDOW_DAYS}-day closing-soon window`);
    return make("OPEN",[],`Governing ${governing.kind.toLowerCase()} deadline ${governing.date.toISOString()} has not yet arrived`);
  }
  return make("OPEN",[],explicitOpenFresh?"Explicit OPEN status observation is current and no deadline evidence exists to contradict it":"Start date has passed and no deadline or status evidence exists to contradict openness");
}

const noopEligibility:EligibilityRepository={async activeEvidenceIds(ids){return ids},async save(r:EligibilityResult):Promise<EligibilitySnapshot>{return{...r,id:"unused",createdAt:r.evaluatedAt}},async list(){return[]}};
const noopScoring:ScoringRepository={async save(r){return{...r,id:"unused",createdAt:r.evaluatedAt}},async list(){return[]}};
const noopActions:CommercialActionRepository={async save(r){return{...r,id:"unused",createdAt:r.evaluatedAt}},async list(){return[]}};

/**
 * Runs the REAL eligibility -> scoring -> commercial-action pipeline against a
 * graph, then gates the resulting recommendation with actionability. This never
 * rewrites eligibility: `underlyingAction` is exactly what CommercialActionService
 * produced. Only the derived `activeRecommendation`/`gate`/`countsAsActive*`
 * fields differ from calling that pipeline directly.
 */
export function gatedCommercialActionForGraph(g:OpportunityGraph,actionabilityInput:ActionabilityInput,asOf:Date):GatedCommercialActionResult{
  const eligibility=new EligibilityService({graph:async()=>g},noopEligibility,()=>asOf).assess(g,asOf);
  const snapshots:EligibilitySnapshot[]=eligibility.map(r=>({...r,id:`${r.opportunityId}:${r.eligibilityType}`,createdAt:asOf}));
  const byType=Object.fromEntries(eligibility.map(r=>[r.eligibilityType,r.eligible]))as Record<EligibilityType,boolean>;
  const score=new ScoringService({graph:async()=>g},noopEligibility,noopScoring,()=>asOf).assess(g,snapshots,asOf);
  const scoreSnapshot:ScoreSnapshot={...score,id:`${g.opportunity.id}:score`,createdAt:asOf};
  const action=new CommercialActionService({graph:async()=>g},noopEligibility,noopScoring,noopActions,()=>asOf).assess(g,snapshots,[scoreSnapshot],asOf);
  const actionability=assessActionability(actionabilityInput,asOf);
  const openCompatible=OPEN_COMPATIBLE_STATES.has(actionability.state);

  const gate:GatedCommercialActionResult["gate"]=!ACTIVE_EXTERNAL_ACTIONS.has(action.action)?"NOT_ACTIVE_EXTERNAL":openCompatible?"ACTIVE":"BLOCKED_BY_ACTIONABILITY";
  const activeRecommendation:GatedCommercialActionResult["activeRecommendation"]=gate==="BLOCKED_BY_ACTIONABILITY"?"TECHNICALLY_ELIGIBLE_BUT_NOT_CURRENTLY_ACTIONABLE":action.action;
  const explanation=gate==="BLOCKED_BY_ACTIONABILITY"?`${action.action} is blocked: opportunity actionability is ${actionability.state}, not one of ${[...OPEN_COMPATIBLE_STATES].join("/")}`:gate==="ACTIVE"?`${action.action} is active: opportunity actionability is ${actionability.state}`:`${action.action} is an internal/verification action, unaffected by actionability gating`;

  return{
    opportunityId:g.opportunity.id,
    underlyingAction:action.action,
    actionability,
    gate,
    activeRecommendation,
    countsAsActiveHotA:byType.HOT_A_ELIGIBLE&&openCompatible,
    countsAsActiveHotB:byType.HOT_B_ELIGIBLE&&openCompatible,
    explanation,
  };
}

/** Convenience over a real tracked Seed by id. Returns undefined for an unknown
 * opportunityId, matching qualificationSeed()'s own contract. */
export function gatedCommercialActionForOpportunity(opportunityId:string,actionabilityInput:ActionabilityInput=NO_ACTIONABILITY_EVIDENCE(opportunityId),asOf:Date=new Date("2026-08-23T12:00:00Z")):GatedCommercialActionResult|undefined{
  const seed=qualificationSeed(opportunityId);
  if(!seed)return undefined;
  return gatedCommercialActionForGraph(graph(seed),actionabilityInput,asOf);
}

/**
 * The real, current actionability evidence for every tracked opportunity. Freeport,
 * Permian, and Corpus remain NO_ACTIONABILITY_EVIDENCE -- Phase 2O's audit found no
 * captured fact stating an explicit status or extracted deadline for them, and that
 * remains true.
 *
 * Beaumont/Port Arthur is the one exception, added in Phase 2Q: a scoped, targeted
 * re-fetch of the SAME already-approved Port Arthur RFP PDF (see FACTS_2Q in
 * targeted-evidence-facts.ts) surfaced a real, explicit procurement schedule --
 * submission deadline 4/22/26 2:00 PM -- that Phase 2H's original capture of the
 * same document did not extract. This is real primary evidence, not an assumption;
 * the buyer/AF-01/conflict state is untouched, since this re-verification found
 * nothing bearing on those.
 */
const TRACKED_OPPORTUNITY_IDS=["qual-freeport","qual-beaumont-port-arthur","qual-permian","qual-corpus","qual-amarillo"]as const;
const PORT_ARTHUR_RFP_DEADLINE:ActionabilityInput={
  opportunityId:"qual-beaumont-port-arthur",
  explicitStatus:null,
  explicitStatusFreshUntil:null,
  deadlines:[{kind:"ORIGINAL",date:new Date("2026-04-22T19:00:00Z"),observedAt:new Date("2026-08-27T12:00:00Z"),evidenceIds:["evidence:port-arthur-rfp-2026-01-2q-reverify"]}],
  startDate:null,
  evidenceIds:["evidence:port-arthur-rfp-2026-01-2q-reverify"],
};
export const REAL_ACTIONABILITY_EVIDENCE:Record<string,ActionabilityInput>=Object.fromEntries(TRACKED_OPPORTUNITY_IDS.map(id=>[id,id==="qual-beaumont-port-arthur"?PORT_ARTHUR_RFP_DEADLINE:NO_ACTIONABILITY_EVIDENCE(id)]));

export interface ActionabilityMetrics{
  asOf:Date;
  eligibleOpportunities:{VAMO_ELIGIBLE:number;HOT_A_ELIGIBLE:number;HOT_B_ELIGIBLE:number};
  activeActionableEligibleOpportunities:{VAMO_ELIGIBLE:number;HOT_A_ELIGIBLE:number;HOT_B_ELIGIBLE:number};
  activeHotA:number;
  activeHotB:number;
  technicallyEligibleButInactive:number;
  byState:Record<string,number>;
}

/** Separates raw eligibility counts from active-actionable-eligible counts across
 * every real tracked opportunity, using each one's real actionability evidence.
 * HOT_A_ELIGIBLE=true and ACTIONABILITY=EXPIRED must never be reported as an
 * ACTIVE HOT-A -- this is the metric this function exists to keep honest. */
export function radarActionabilityMetrics(asOf:Date=new Date("2026-08-23T12:00:00Z")):ActionabilityMetrics{
  const results=TRACKED_OPPORTUNITY_IDS.map(id=>{const seed=qualificationSeed(id);if(!seed)return null;const g=graph(seed);const eligibility=new EligibilityService({graph:async()=>g},noopEligibility,()=>asOf).assess(g,asOf);const gated=gatedCommercialActionForGraph(g,REAL_ACTIONABILITY_EVIDENCE[id]??NO_ACTIONABILITY_EVIDENCE(id),asOf);return{id,eligibility,gated}}).filter((x):x is NonNullable<typeof x>=>x!==null);

  const eligibleOpportunities={VAMO_ELIGIBLE:0,HOT_A_ELIGIBLE:0,HOT_B_ELIGIBLE:0};
  const activeActionableEligibleOpportunities={VAMO_ELIGIBLE:0,HOT_A_ELIGIBLE:0,HOT_B_ELIGIBLE:0};
  const byState:Record<string,number>={};
  let activeHotA=0,activeHotB=0,technicallyEligibleButInactive=0;

  for(const{eligibility,gated}of results){
    byState[gated.actionability.state]=(byState[gated.actionability.state]??0)+1;
    const openCompatible=OPEN_COMPATIBLE_STATES.has(gated.actionability.state);
    for(const r of eligibility){
      if(r.eligible){
        eligibleOpportunities[r.eligibilityType]++;
        if(openCompatible)activeActionableEligibleOpportunities[r.eligibilityType]++;
        else technicallyEligibleButInactive++;
      }
    }
    if(gated.countsAsActiveHotA)activeHotA++;
    if(gated.countsAsActiveHotB)activeHotB++;
  }
  return{asOf,eligibleOpportunities,activeActionableEligibleOpportunities,activeHotA,activeHotB,technicallyEligibleButInactive,byState};
}
