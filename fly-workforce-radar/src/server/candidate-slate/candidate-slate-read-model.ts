import type {
  CandidateSlate, CandidateSlateDemand, CandidateSlateGroup, CandidateSlateQualification, CandidateSlateWorker,
} from "../../domain/candidate-slate";
import type { MatchOutcome } from "../../domain/matching-engine";
import { mobilizationBlockers, type WorkerDemandEngagement } from "../../domain/worker-demand-engagement";
import type { WorkerLifecycleStatus } from "../../domain/worker";

export interface CandidateSlateDemandRow {
  readonly demandId:string; readonly tradeCode:string|null; readonly tradeLabelEn:string|null; readonly tradeLabelEs:string|null;
  readonly occupationCode:string|null; readonly occupationLabelEn:string|null; readonly occupationLabelEs:string|null;
  readonly requestedHeadcount:number|null; readonly startDate:string|null; readonly location:string|null;
}
export interface CandidateSlateWorkerRow {
  readonly demandId:string; readonly workerId:string; readonly displayName:string; readonly lifecycle:WorkerLifecycleStatus;
  readonly tradeCode:string|null; readonly tradeLabelEn:string|null; readonly tradeLabelEs:string|null;
  readonly occupationCode:string|null; readonly occupationLabelEn:string|null; readonly occupationLabelEs:string|null;
  readonly experienceMonths:number|null; readonly skills:readonly CandidateSlateQualification[]; readonly credentials:readonly CandidateSlateQualification[];
  readonly matchOutcome:MatchOutcome|null; readonly matchReasons:readonly string[]; readonly matchEvaluatedAt:string|null; readonly hardViolation:boolean;
  readonly engagement:WorkerDemandEngagement|null; readonly validConsentedContactOccurred:boolean; readonly consentStillGranted:boolean;
  readonly demandActionable:boolean;
}
export interface CandidateSlateSource {
  readonly opportunityId:string; readonly opportunityTitle:string|null; readonly customer:string|null;
  readonly project:string|null; readonly location:string|null; readonly demands:readonly CandidateSlateDemandRow[]; readonly workers:readonly CandidateSlateWorkerRow[];
}

const viable = (outcome: MatchOutcome|null) => outcome === "STRONG_MATCH" || outcome === "POSSIBLE_MATCH";
const resolved = (state:string|null) => state === "NOT_REQUIRED" || state === "COMPATIBLE" || state === "ACCEPTED_CONFLICT";

export function classifyCandidateSlateWorker(row: CandidateSlateWorkerRow, demand: CandidateSlateDemandRow): Pick<CandidateSlateWorker,"blockers"|"group"|"nextAction"> {
  const e=row.engagement;
  if(!e){
    const blockers=viable(row.matchOutcome)?[]:[row.matchOutcome === "INSUFFICIENT_DATA" ? "CURRENT_MATCH_INSUFFICIENT_DATA" : "CURRENT_MATCH_NOT_VIABLE"];
    return {blockers,group:blockers.length?"BLOCKED":"IN_PROGRESS",nextAction:blockers.length?"RESOLVE_MATCH":"START_ENGAGEMENT"};
  }
  const blockers=mobilizationBlockers({
    engagementOpen:e.closedAt===null,selectionState:e.selectionState,workerLifecycle:row.lifecycle,
    validConsentedContactOccurred:row.validConsentedContactOccurred,consentStillGranted:row.consentStillGranted,
    responseState:e.responseState,availabilityState:e.demandAvailabilityState,
    availabilitySatisfiesStart:e.availableFrom!==null&&(!demand.startDate||e.availableFrom.toISOString().slice(0,10)<=demand.startDate),
    demandActionable:row.demandActionable,currentMatchOutcome:row.matchOutcome,hardViolation:row.hardViolation,
    compensationResolution:e.compensationResolutionState,travelResolution:e.travelResolutionState,
  });
  if(e.mobilizationState==="CANDIDATE") return blockers.length
    ? {blockers,group:"BLOCKED",nextAction:"RECONCILE_SAFEGUARDS"}
    : {blockers:[],group:"CANDIDATE",nextAction:"READY_FOR_HANDOFF"};
  const terminalBlocker=blockers.some(b=>["CURRENT_MATCH_NOT_VIABLE","HARD_MATCH_VIOLATION","WORKER_NOT_ACTIVE","ENGAGEMENT_CLOSED","DEMAND_NOT_ACTIONABLE"].includes(b));
  const group:CandidateSlateGroup=terminalBlocker?"BLOCKED":e.selectionState==="SELECTED"||e.selectionState==="SHORTLISTED"?"SELECTED":"IN_PROGRESS";
  let nextAction="REVIEW_ENGAGEMENT";
  if(e.selectionState!=="SELECTED")nextAction="SELECT_WORKER";
  else if(!row.validConsentedContactOccurred||!row.consentStillGranted)nextAction="COMPLETE_CONSENTED_CONTACT";
  else if(e.responseState!=="INTERESTED")nextAction="RECORD_WORKER_RESPONSE";
  else if(e.demandAvailabilityState!=="CONFIRMED_AVAILABLE")nextAction="CONFIRM_OPPORTUNITY_AVAILABILITY";
  else if(!resolved(e.compensationResolutionState)||!resolved(e.travelResolutionState))nextAction="RESOLVE_COMPENSATION_TRAVEL";
  else nextAction="ESTABLISH_CANDIDATE";
  return {blockers,group,nextAction};
}

export function assembleCandidateSlate(source:CandidateSlateSource):CandidateSlate{
  const demands:CandidateSlateDemand[]=source.demands.map(demand=>{
    const unique=new Map<string,CandidateSlateWorkerRow>();
    for(const row of source.workers)if(row.demandId===demand.demandId&&!unique.has(row.workerId))unique.set(row.workerId,row);
    const workers=[...unique.values()].map((row):CandidateSlateWorker=>{
      const state=classifyCandidateSlateWorker(row,demand),e=row.engagement;
      return {workerId:row.workerId,displayName:row.displayName,lifecycle:row.lifecycle,tradeCode:row.tradeCode,tradeLabelEn:row.tradeLabelEn,tradeLabelEs:row.tradeLabelEs,occupationCode:row.occupationCode,occupationLabelEn:row.occupationLabelEn,occupationLabelEs:row.occupationLabelEs,experienceMonths:row.experienceMonths,skills:row.skills,credentials:row.credentials,matchOutcome:row.matchOutcome,matchReasons:row.matchReasons,matchEvaluatedAt:row.matchEvaluatedAt,engagementId:e?.id??null,selectionState:e?.selectionState??null,contactState:e?.contactState??null,responseState:e?.responseState??null,availabilityState:e?.demandAvailabilityState??null,availableFrom:e?.availableFrom?.toISOString().slice(0,10)??null,availableUntil:e?.availableUntil?.toISOString().slice(0,10)??null,compensationState:e?.compensationResolutionState??null,travelState:e?.travelResolutionState??null,mobilizationState:e?.mobilizationState??null,...state};
    });
    const order:Record<CandidateSlateGroup,number>={CANDIDATE:0,SELECTED:1,IN_PROGRESS:2,BLOCKED:3};
    workers.sort((a,b)=>order[a.group]-order[b.group]||a.displayName.localeCompare(b.displayName));
    const candidateCount=workers.filter(w=>w.mobilizationState==="CANDIDATE").length;
    return {...demand,matchingCount:workers.filter(w=>viable(w.matchOutcome)).length,engagedCount:workers.filter(w=>w.engagementId!==null).length,selectedCount:workers.filter(w=>w.selectionState==="SELECTED").length,candidateCount,remainingPositions:demand.requestedHeadcount===null?null:Math.max(0,demand.requestedHeadcount-candidateCount),surplusCandidates:demand.requestedHeadcount===null?0:Math.max(0,candidateCount-demand.requestedHeadcount),workers};
  });
  return {opportunityId:source.opportunityId,opportunityTitle:source.opportunityTitle,customer:source.customer,project:source.project,location:source.location,demands};
}
