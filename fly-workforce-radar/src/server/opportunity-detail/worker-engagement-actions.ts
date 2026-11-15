"use server";

import { revalidatePath } from "next/cache";
import type { EngagementCommand } from "../services/engagement/worker-demand-engagement-service";
import { executeWorkerDemandEngagementCommand } from "../services/engagement/worker-demand-engagement-service";
import { getProductionSqlClient,getProductionTransactionRunner } from "../database/production-sql-client";
import { PostgresOperatorRepository } from "../repositories/operator/postgres-operator-repository";

export interface WorkerEngagementActionState {readonly status:"READY"|"SUCCEEDED"|"REJECTED";readonly reason:string|null;readonly blockers:readonly string[]}
const text=(form:FormData,key:string)=>String(form.get(key)??"").trim();
const date=(value:string)=>value?new Date(`${value}T00:00:00.000Z`):null;
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function submitWorkerEngagementAction(_previous:WorkerEngagementActionState,form:FormData):Promise<WorkerEngagementActionState>{
  const client=getProductionSqlClient(),transactionRunner=getProductionTransactionRunner();
  if(!client||!transactionRunner)return{status:"REJECTED",reason:"SERVICE_UNAVAILABLE",blockers:[]};
  const action=text(form,"command") as EngagementCommand["action"],opportunityId=text(form,"opportunityId"),demandSignalId=text(form,"demandSignalId"),workerId=text(form,"workerId"),engagementId=text(form,"engagementId"),matchResultId=text(form,"matchResultId"),version=Number(text(form,"expectedVersion"));
  const allowed=new Set(["CREATE","SET_SELECTION","RECORD_CONTACT","RECORD_RESPONSE","SET_AVAILABILITY","SET_RESOLUTIONS","ESTABLISH_CANDIDATE","RECONCILE_SAFEGUARDS"]);
  if(!allowed.has(action)||![opportunityId,demandSignalId,workerId].every(uuid)||(action!=="CREATE"&&!uuid(engagementId))||(!uuid(matchResultId)&&action==="CREATE")||(!Number.isInteger(version)&&action!=="CREATE"))return{status:"REJECTED",reason:"INVALID_REQUEST",blockers:[]};
  const link=await client.query("select 1 from opportunity_demand_signals ods join worker_demand_match_results mr on mr.demand_signal_id=ods.demand_signal_id and mr.worker_id=$3 and mr.superseded_at is null where ods.opportunity_id=$1 and ods.demand_signal_id=$2 and ($4::uuid is null or mr.id=$4::uuid)",[opportunityId,demandSignalId,workerId,matchResultId||null]);
  if(link.rows.length===0)return{status:"REJECTED",reason:"LINKAGE_VALIDATION_FAILED",blockers:[]};
  const key=`b5d:${action}:${opportunityId}:${demandSignalId}:${workerId}:${engagementId||matchResultId}:${Number.isFinite(version)?version:0}:${text(form,"state")}:${text(form,"routeId")}`;
  const common={idempotencyKey:key,engagementId,expectedVersion:version,notes:text(form,"notes")||null};
  let command:EngagementCommand;
  switch(action){
    case"CREATE":command={action,idempotencyKey:key,demandSignalId,workerId,opportunityId,originatingMatchResultId:matchResultId};break;
    case"SET_SELECTION":command={...common,action,state:text(form,"state") as never,matchResultId};break;
    case"RECORD_CONTACT":command={...common,action,routeId:text(form,"routeId"),outcome:text(form,"outcome") as never,matchResultId};break;
    case"RECORD_RESPONSE":command={...common,action,state:text(form,"state") as never};break;
    case"SET_AVAILABILITY":command={...common,action,state:text(form,"state") as never,availableFrom:date(text(form,"availableFrom")),availableUntil:date(text(form,"availableUntil"))};break;
    case"SET_RESOLUTIONS":command={...common,action,compensation:text(form,"compensation") as never,travel:text(form,"travel") as never};break;
    case"ESTABLISH_CANDIDATE":case"RECONCILE_SAFEGUARDS":command={...common,action};break;
    default:return{status:"REJECTED",reason:"INVALID_REQUEST",blockers:[]};
  }
  const result=await executeWorkerDemandEngagementCommand(command,{transactionRunner,operatorRepository:new PostgresOperatorRepository(client)});
  if(result.kind==="REJECTED")return{status:"REJECTED",reason:result.reason,blockers:result.blockers??[]};
  revalidatePath(`/opportunities/${opportunityId}`);
  return{status:"SUCCEEDED",reason:null,blockers:[]};
}
