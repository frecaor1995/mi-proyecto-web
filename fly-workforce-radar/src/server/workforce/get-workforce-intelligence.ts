import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { getProductionSqlClient } from "../database/production-sql-client";
import { authorizeOperator } from "../auth/authorization";
import { credentialExpirationBand,deriveWorkerReadiness,type WorkerIntelligenceFacts,type WorkerLevelCode,type ShiftCode,type ExplicitState,type PerDiemState,type ToolsState,type WorkerConsentPurpose,type WorkerConsentState } from "../../domain/workforce-intelligence";
import type { VerificationState } from "../../domain/verification";

type Raw=Record<string,unknown>;
const date=(v:unknown)=>v==null?null:new Date(String(v));
const text=(v:unknown)=>v==null?null:String(v);
const json=(v:unknown):Raw[]=>Array.isArray(v)?v as Raw[]:[];

export interface WorkforceIntelligenceSummary{
  readonly workerId:string;readonly level:WorkerLevelCode|null;readonly levelVerification:VerificationState|null;
  readonly credentialCount:number;readonly verifiedCredentialCount:number;readonly nearestExpiration:string|null;readonly expirationBand:string;
  readonly readiness:"READY"|"NEEDS_ATTENTION"|"BLOCKED";readonly blockers:readonly string[];
}

const FACTS_SQL=`select w.id worker_id,
  (select jsonb_build_object('tradeCode',x.trade_code,'occupationCode',x.occupation_code,'verificationState',x.verification_state) from worker_trade_occupations x where x.worker_id=w.id order by (x.role_designation='PRIMARY') desc,x.created_at limit 1) canonical_assignment,
  (select jsonb_build_object('code',x.level_code,'verificationState',x.verification_state) from worker_level_assignments x where x.worker_id=w.id order by x.effective_at desc,x.created_at desc limit 1) level,
  coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'credentialCode',x.credential_code,'jurisdiction',x.jurisdiction,'verificationState',x.verification_state,'expiresAt',x.expires_at,'lifecycleStatus',x.lifecycle_status) order by x.expires_at nulls last,x.credential_code) from worker_credentials x where x.worker_id=w.id and x.lifecycle_status<>'SUPERSEDED'),'[]') credentials,
  (select jsonb_build_object('inStateTravel',coalesce(x.in_state_travel_state,'UNKNOWN'),'outOfStateTravel',coalesce(x.out_of_state_travel_state,'UNKNOWN'),'relocation',coalesce(x.relocation_state,'UNKNOWN')) from worker_locations x where x.worker_id=w.id order by x.effective_at desc,x.created_at desc limit 1) mobility,
  (select jsonb_build_object('perDiem',x.per_diem_state,'transportation',x.transportation_state,'tools',x.tools_state,'maximumHoursPerWeek',x.maximum_hours_per_week,'overtime',x.overtime_state,'verificationState',x.verification_state) from worker_work_conditions x where x.worker_id=w.id order by x.effective_at desc,x.created_at desc limit 1) conditions,
  coalesce((select jsonb_agg(jsonb_build_object('code',x.shift_code,'verificationState',x.verification_state) order by x.shift_code) from worker_shift_capabilities x where x.worker_id=w.id),'[]') shifts,
  coalesce((select jsonb_agg(jsonb_build_object('purpose',x.purpose,'state',x.state,'effectiveAt',x.effective_at) order by x.purpose) from (select distinct on(purpose)* from worker_consents where worker_id=w.id order by purpose,effective_at desc,created_at desc)x),'[]') consents,
  coalesce((select jsonb_agg(jsonb_build_object('documentType',x.document_type,'readinessState',x.readiness_state,'expiresAt',x.expires_at,'verificationState',x.verification_state) order by x.document_type) from (select distinct on(document_type)* from worker_document_readiness where worker_id=w.id order by document_type,effective_at desc,created_at desc)x),'[]') documents,
  w.lifecycle_status,w.profile_verification_state,
  (select a.status from worker_availability a where a.worker_id=w.id order by a.effective_at desc,a.created_at desc limit 1) availability_status
from workforce_workers w where w.id=any($1::uuid[])`;

function facts(r:Raw):WorkerIntelligenceFacts{
  const a=r.canonical_assignment as Raw|null;
  const l=r.level as Raw|null;
  const m=r.mobility as Raw|null;
  const c=r.conditions as Raw|null;
  return{
    canonicalAssignment:a?{tradeCode:String(a.tradeCode),occupationCode:String(a.occupationCode),verificationState:String(a.verificationState) as VerificationState}:null,
    level:l?{code:String(l.code) as WorkerLevelCode,verificationState:String(l.verificationState) as VerificationState}:null,
    credentials:json(r.credentials).map(x=>({id:String(x.id),credentialCode:String(x.credentialCode),jurisdiction:text(x.jurisdiction),verificationState:String(x.verificationState) as VerificationState,expiresAt:date(x.expiresAt),lifecycleStatus:String(x.lifecycleStatus) as "CURRENT"|"SUPERSEDED"|"REVOKED"|"UNKNOWN"})),
    mobility:m?{inStateTravel:String(m.inStateTravel) as ExplicitState,outOfStateTravel:String(m.outOfStateTravel) as ExplicitState,relocation:String(m.relocation) as ExplicitState}:null,
    conditions:c?{perDiem:String(c.perDiem) as PerDiemState,transportation:String(c.transportation) as ExplicitState,tools:String(c.tools) as ToolsState,maximumHoursPerWeek:c.maximumHoursPerWeek==null?null:Number(c.maximumHoursPerWeek),overtime:String(c.overtime) as ExplicitState,verificationState:String(c.verificationState) as VerificationState}:null,
    shifts:json(r.shifts).map(x=>({code:String(x.code) as ShiftCode,verificationState:String(x.verificationState) as VerificationState})),
    consents:json(r.consents).map(x=>({purpose:String(x.purpose) as WorkerConsentPurpose,state:String(x.state) as WorkerConsentState,effectiveAt:new Date(String(x.effectiveAt))})),
    documents:json(r.documents).map(x=>({documentType:String(x.documentType),readinessState:String(x.readinessState) as "KNOWN"|"VERIFIED"|"MISSING"|"EXPIRED"|"REQUIRES_VERIFICATION"|"UNKNOWN",expiresAt:date(x.expiresAt),verificationState:String(x.verificationState) as VerificationState})),
  };
}

async function authorizedClient(client?:SqlClient|null){
  const auth=await authorizeOperator("worker_profile.read");
  if(auth.state!=="AUTHORIZED")return null;
  return client===undefined?getProductionSqlClient():client;
}

export async function getWorkerIntelligenceFacts(workerId:string,client?:SqlClient|null):Promise<WorkerIntelligenceFacts|null>{
  const db=await authorizedClient(client);if(!db)return null;
  const row=(await db.query<Raw>(FACTS_SQL,[[workerId]])).rows[0];return row?facts(row):null;
}

export async function getWorkforceIntelligenceSummaries(workerIds:readonly string[],client?:SqlClient|null):Promise<ReadonlyMap<string,WorkforceIntelligenceSummary>>{
  const map=new Map<string,WorkforceIntelligenceSummary>();if(!workerIds.length)return map;
  const db=await authorizedClient(client);if(!db)return map;
  const rows=(await db.query<Raw>(FACTS_SQL,[workerIds])).rows;
  for(const row of rows){
    const f=facts(row),exp=f.credentials.map(x=>x.expiresAt).filter((x):x is Date=>x!==null).sort((a,b)=>a.getTime()-b.getTime())[0]??null;
    const readiness=deriveWorkerReadiness({lifecycle:String(row.lifecycle_status),profileVerificationState:String(row.profile_verification_state),availability:text(row.availability_status),facts:f});
    map.set(String(row.worker_id),{workerId:String(row.worker_id),level:f.level?.code??null,levelVerification:f.level?.verificationState??null,credentialCount:f.credentials.length,verifiedCredentialCount:f.credentials.filter(x=>x.verificationState==="VERIFIED").length,nearestExpiration:exp?.toISOString().slice(0,10)??null,expirationBand:credentialExpirationBand(exp),readiness:readiness.state,blockers:readiness.blockers});
  }
  return map;
}
