import "server-only";

import type { WorkerDemandEngagement, WorkerDemandEngagementEvent } from "../../domain/worker-demand-engagement";
import { authorizeOperator } from "../auth/authorization";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { getProductionSqlClient, getProductionTransactionRunner } from "../database/production-sql-client";
import { PostgresWorkerDemandEngagementRepository } from "../repositories/engagement/postgres-worker-demand-engagement-repository";
import { PostgresOperatorRepository } from "../repositories/operator/postgres-operator-repository";
import { PostgresWorkerRepository } from "../repositories/worker/postgres-worker-repository";
import { readWorkerDemandEngagement } from "../services/engagement/worker-demand-engagement-service";

export interface EngagementContactChoice { readonly id:string; readonly routeType:string; readonly target:string; readonly preferred:boolean }
export interface WorkerEngagementUiPermissions { readonly canRead:boolean; readonly canWrite:boolean; readonly canReadContact:boolean; readonly canExecuteContact:boolean }
export interface WorkerDemandEngagementUi {
  readonly state:"NOT_STARTED"|"READY"|"RESTRICTED"|"UNAVAILABLE";
  readonly permissions:WorkerEngagementUiPermissions;
  readonly engagement:WorkerDemandEngagement|null;
  readonly history:readonly WorkerDemandEngagementEvent[];
  readonly contactChoices:readonly EngagementContactChoice[];
  readonly currentMatchResultId:string|null;
  readonly warnings:readonly string[];
}

export interface EngagementUiDeps { readonly client:SqlClient; readonly transactionRunner:NonNullable<ReturnType<typeof getProductionTransactionRunner>>; readonly operatorRepository:PostgresOperatorRepository }

async function allowed(permission:"worker_engagement.read"|"worker_engagement.write"|"worker_contact.read"|"worker_contact.execute", deps:EngagementUiDeps){
  return (await authorizeOperator(permission,{repository:deps.operatorRepository})).state==="AUTHORIZED";
}

export async function getWorkerDemandEngagementUi(demandSignalId:string,workerId:string,deps?:EngagementUiDeps):Promise<WorkerDemandEngagementUi>{
  const client=deps?.client??getProductionSqlClient(),runner=deps?.transactionRunner??getProductionTransactionRunner();
  if(!client||!runner)return{state:"UNAVAILABLE",permissions:{canRead:false,canWrite:false,canReadContact:false,canExecuteContact:false},engagement:null,history:[],contactChoices:[],currentMatchResultId:null,warnings:[]};
  const operatorRepository=deps?.operatorRepository??new PostgresOperatorRepository(client);
  const resolved={client,transactionRunner:runner,operatorRepository};
  const [canRead,canWrite,canReadContact,canExecuteContact]=await Promise.all([
    allowed("worker_engagement.read",resolved),allowed("worker_engagement.write",resolved),allowed("worker_contact.read",resolved),allowed("worker_contact.execute",resolved),
  ]);
  const permissions={canRead,canWrite,canReadContact,canExecuteContact};
  if(!canRead)return{state:"RESTRICTED",permissions,engagement:null,history:[],contactChoices:[],currentMatchResultId:null,warnings:[]};
  const repository=new PostgresWorkerDemandEngagementRepository(client);
  const engagement=await repository.findByPair(demandSignalId,workerId);
  const match=await client.query<{id:string;outcome:string}>("select id,outcome from worker_demand_match_results where demand_signal_id=$1 and worker_id=$2 and superseded_at is null limit 1",[demandSignalId,workerId]);
  if(!engagement)return{state:"NOT_STARTED",permissions,engagement:null,history:[],contactChoices:[],currentMatchResultId:match.rows[0]?.id??null,warnings:match.rows[0]?.outcome==="NO_MATCH"?["CURRENT_MATCH_NOT_VIABLE"]:[]};
  const read=await readWorkerDemandEngagement(engagement.id,{transactionRunner:runner,operatorRepository});
  if(read.kind!=="FOUND")return{state:"RESTRICTED",permissions,engagement:null,history:[],contactChoices:[],currentMatchResultId:match.rows[0]?.id??null,warnings:[]};
  const choices=canReadContact?(await new PostgresWorkerRepository(client).listContactRoutes(workerId))
    .filter(route=>route.lifecycleStatus==="ACTIVE"&&route.consentState==="GRANTED")
    .map(route=>({id:route.id,routeType:route.routeType,target:route.target,preferred:route.preferred})):[];
  const context=await repository.getContextFacts(read.engagement);
  const warnings:string[]=[];
  if(context?.workerLifecycle!=="ACTIVE")warnings.push("WORKER_LIFECYCLE_REVIEW_REQUIRED");
  if(context?.opportunityLifecycle!=="ACTIVE")warnings.push("OPPORTUNITY_NOT_ACTIONABLE");
  if(!context?.currentMatch||["NO_MATCH","INSUFFICIENT_DATA"].includes(context.currentMatch.outcome)||context.currentMatch.hardViolation)warnings.push("MATCH_REVIEW_REQUIRED");
  return{state:"READY",permissions,engagement:read.engagement,history:read.events,contactChoices:choices,currentMatchResultId:match.rows[0]?.id??null,warnings};
}
