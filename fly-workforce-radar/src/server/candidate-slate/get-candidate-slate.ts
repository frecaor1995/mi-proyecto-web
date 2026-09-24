import "server-only";

import type { CandidateSlatePageData, CandidateSlateQualification } from "../../domain/candidate-slate";
import type { MatchOutcome } from "../../domain/matching-engine";
import type { WorkerDemandEngagement } from "../../domain/worker-demand-engagement";
import type { WorkerLifecycleStatus } from "../../domain/worker";
import { authorizeOperator, type AuthorizationResult } from "../auth/authorization";
import { getProductionSqlClient } from "../database/production-sql-client";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { assembleCandidateSlate, type CandidateSlateDemandRow, type CandidateSlateWorkerRow } from "./candidate-slate-read-model";

type Raw=Record<string,unknown>;
type Authorize=(permission:"matching_result.read"|"worker_engagement.read"|"worker_profile.read")=>Promise<AuthorizationResult>;
export interface CandidateSlateDeps { readonly client?:SqlClient|null; readonly authorize?:Authorize }
const str=(v:unknown)=>v==null?null:String(v), num=(v:unknown)=>v==null?null:Number(v), bool=(v:unknown)=>Boolean(v);
const date=(v:unknown)=>v==null?null:new Date(String(v));
const list=(v:unknown):string[]=>Array.isArray(v)?v.map(String):[];
const qualifications=(v:unknown):CandidateSlateQualification[]=>Array.isArray(v)?v.map((item)=>{const r=item as Raw;return{code:String(r.code),labelEn:String(r.labelEn??r.label_en??r.code),labelEs:String(r.labelEs??r.label_es??r.code),verificationState:String(r.verificationState??r.verification_state??"UNKNOWN")};}):[];

function engagement(r:Raw):WorkerDemandEngagement|null{
  if(r.engagement_id==null)return null;
  return{id:String(r.engagement_id),demandSignalId:String(r.demand_id),workerId:String(r.worker_id),opportunityId:str(r.engagement_opportunity_id),originatingMatchResultId:str(r.originating_match_result_id),selectionState:r.selection_state as WorkerDemandEngagement["selectionState"],contactState:r.contact_state as WorkerDemandEngagement["contactState"],responseState:r.response_state as WorkerDemandEngagement["responseState"],demandAvailabilityState:r.demand_availability_state as WorkerDemandEngagement["demandAvailabilityState"],availableFrom:date(r.available_from),availableUntil:date(r.available_until),compensationResolutionState:r.compensation_resolution_state as WorkerDemandEngagement["compensationResolutionState"],travelResolutionState:r.travel_resolution_state as WorkerDemandEngagement["travelResolutionState"],mobilizationState:r.mobilization_state as WorkerDemandEngagement["mobilizationState"],closedAt:date(r.closed_at),closureReason:r.closure_reason as WorkerDemandEngagement["closureReason"],createdByOperatorId:String(r.created_by_operator_id),updatedByActorType:r.updated_by_actor_type as WorkerDemandEngagement["updatedByActorType"],updatedByOperatorId:str(r.updated_by_operator_id),version:Number(r.version),createdAt:new Date(String(r.engagement_created_at)),updatedAt:new Date(String(r.engagement_updated_at))};
}

const OPPORTUNITY_SQL=`select o.id,o.title,o.lifecycle,p.name project,coalesce(p.location_text,nullif(concat_ws(', ',p.city,p.state),'')) location,coalesce(c.common_name,c.legal_name,o.unresolved_company_context) customer
from opportunities o left join projects p on p.id=o.project_id left join companies c on c.id=p.owner_company_id where o.id=$1`;
const DEMANDS_SQL=`select d.id demand_id,d.trade_code,wt.label_en trade_label_en,wt.label_es trade_label_es,d.occupation_code,wo.label_en occupation_label_en,wo.label_es occupation_label_es,d.headcount_estimate,d.start_date,coalesce(d.unresolved_project_context,nullif(concat_ws(', ',d.city,d.state),'')) location
from opportunity_demand_signals od join demand_signals d on d.id=od.demand_signal_id left join workforce_trades wt on wt.code=d.trade_code left join workforce_occupations wo on wo.code=d.occupation_code where od.opportunity_id=$1 order by d.created_at,d.id`;
const WORKERS_SQL=`select d.id demand_id,w.id worker_id,w.display_name,w.lifecycle_status,
  wto.trade_code,wt.label_en trade_label_en,wt.label_es trade_label_es,wto.occupation_code,wo.label_en occupation_label_en,wo.label_es occupation_label_es,wto.experience_months,
  mr.id match_result_id,mr.outcome,mr.evaluated_at,
  coalesce((select array_agg(distinct mc.reason_code order by mc.reason_code) from worker_demand_match_criteria mc where mc.match_result_id=mr.id and mc.state in ('VIOLATED','UNKNOWN','SATISFIED_WITH_LIMITATION')),'{}') match_reasons,
  exists(select 1 from worker_demand_match_criteria mc where mc.match_result_id=mr.id and mc.importance='HARD' and mc.state='VIOLATED') hard_violation,
  e.id engagement_id,e.opportunity_id engagement_opportunity_id,e.originating_match_result_id,e.selection_state,e.contact_state,e.response_state,e.demand_availability_state,e.available_from,e.available_until,e.compensation_resolution_state,e.travel_resolution_state,e.mobilization_state,e.closed_at,e.closure_reason,e.created_by_operator_id,e.updated_by_actor_type,e.updated_by_operator_id,e.version,e.created_at engagement_created_at,e.updated_at engagement_updated_at,
  exists(select 1 from worker_demand_engagement_events ev where ev.engagement_id=e.id and ev.event_type='CONTACT_ATTEMPT_RECORDED' and ev.consent_state_snapshot='GRANTED' and ev.route_lifecycle_snapshot='ACTIVE') valid_consented_contact,
  coalesce((select cr.consent_state='GRANTED' and cr.lifecycle_status='ACTIVE' from worker_demand_engagement_events ev join worker_contact_routes cr on cr.id=ev.worker_contact_route_id where ev.engagement_id=e.id and ev.event_type='CONTACT_ATTEMPT_RECORDED' order by ev.engagement_version desc limit 1),false) consent_still_granted,
  coalesce((select jsonb_agg(jsonb_build_object('code',ws.skill_code,'labelEn',s.label_en,'labelEs',s.label_es,'verificationState',ws.verification_state) order by s.label_en) from worker_skills ws join workforce_skills s on s.code=ws.skill_code join demand_skill_requirements dsr on dsr.demand_signal_id=d.id and dsr.skill_code=ws.skill_code where ws.worker_id=w.id),'[]') skills,
  coalesce((select jsonb_agg(jsonb_build_object('code',wc.credential_code,'labelEn',c.label_en,'labelEs',c.label_es,'verificationState',wc.verification_state) order by c.label_en) from worker_credentials wc join workforce_credentials c on c.code=wc.credential_code join demand_credential_requirements dcr on dcr.demand_signal_id=d.id and dcr.credential_code=wc.credential_code where wc.worker_id=w.id),'[]') credentials,
  o.lifecycle opportunity_lifecycle
from opportunity_demand_signals od join demand_signals d on d.id=od.demand_signal_id join opportunities o on o.id=od.opportunity_id
join workforce_workers w on exists(select 1 from worker_demand_match_results x where x.demand_signal_id=d.id and x.worker_id=w.id and x.superseded_at is null) or exists(select 1 from worker_demand_engagements x where x.demand_signal_id=d.id and x.worker_id=w.id)
left join worker_demand_match_results mr on mr.demand_signal_id=d.id and mr.worker_id=w.id and mr.superseded_at is null
left join worker_demand_engagements e on e.demand_signal_id=d.id and e.worker_id=w.id
left join lateral(select x.* from worker_trade_occupations x where x.worker_id=w.id order by (x.trade_code=d.trade_code and x.occupation_code=d.occupation_code) desc,(x.role_designation='PRIMARY') desc,x.created_at limit 1) wto on true
left join workforce_trades wt on wt.code=wto.trade_code left join workforce_occupations wo on wo.code=wto.occupation_code
where od.opportunity_id=$1 order by d.id,w.display_name,w.id`;

export async function getCandidateSlate(opportunityId:string,deps:CandidateSlateDeps={}):Promise<CandidateSlatePageData>{
  const authorize=deps.authorize??((permission)=>authorizeOperator(permission));
  const auth=await Promise.all([authorize("matching_result.read"),authorize("worker_engagement.read"),authorize("worker_profile.read")]);
  if(auth.some(result=>result.state!=="AUTHORIZED"))return{state:"RESTRICTED",slate:null};
  const client=deps.client===undefined?getProductionSqlClient():deps.client;
  if(!client)return{state:"UNAVAILABLE",slate:null};
  try{
    const [opportunityResult,demandResult,workerResult]=await Promise.all([client.query<Raw>(OPPORTUNITY_SQL,[opportunityId]),client.query<Raw>(DEMANDS_SQL,[opportunityId]),client.query<Raw>(WORKERS_SQL,[opportunityId])]);
    const o=opportunityResult.rows[0];if(!o)return{state:"NOT_FOUND",slate:null};
    const demands:CandidateSlateDemandRow[]=demandResult.rows.map(r=>({demandId:String(r.demand_id),tradeCode:str(r.trade_code),tradeLabelEn:str(r.trade_label_en),tradeLabelEs:str(r.trade_label_es),occupationCode:str(r.occupation_code),occupationLabelEn:str(r.occupation_label_en),occupationLabelEs:str(r.occupation_label_es),requestedHeadcount:num(r.headcount_estimate),startDate:str(r.start_date)?.slice(0,10)??null,location:str(r.location)}));
    const workers:CandidateSlateWorkerRow[]=workerResult.rows.map(r=>({demandId:String(r.demand_id),workerId:String(r.worker_id),displayName:String(r.display_name),lifecycle:r.lifecycle_status as WorkerLifecycleStatus,tradeCode:str(r.trade_code),tradeLabelEn:str(r.trade_label_en),tradeLabelEs:str(r.trade_label_es),occupationCode:str(r.occupation_code),occupationLabelEn:str(r.occupation_label_en),occupationLabelEs:str(r.occupation_label_es),experienceMonths:num(r.experience_months),skills:qualifications(r.skills),credentials:qualifications(r.credentials),matchOutcome:r.outcome==null?null:r.outcome as MatchOutcome,matchReasons:list(r.match_reasons),matchEvaluatedAt:str(r.evaluated_at),hardViolation:bool(r.hard_violation),engagement:engagement(r),validConsentedContactOccurred:bool(r.valid_consented_contact),consentStillGranted:bool(r.consent_still_granted),demandActionable:r.opportunity_lifecycle==="ACTIVE"}));
    return{state:"READY",slate:assembleCandidateSlate({opportunityId:String(o.id),opportunityTitle:str(o.title),customer:str(o.customer),project:str(o.project),location:str(o.location),demands,workers})};
  }catch{return{state:"ERROR",slate:null};}
}
