import { getProductionSqlClient } from "../database/production-sql-client";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresHumanVerificationDeskRepository } from "../repositories/human-verification-desk/postgres-human-verification-desk-repository";
import { assembleHumanVerificationDeskDetail,assembleHumanVerificationDeskItem,type HumanVerificationDeskDetail,type HumanVerificationDeskItem } from "../read-models/human-verification-desk";
export type VerificationQueueResult={readonly state:"READY";readonly items:readonly HumanVerificationDeskItem[];readonly total:number}|{readonly state:"UNAVAILABLE"|"ERROR";readonly items:readonly[];readonly total:null;readonly reason:string};
export type VerificationWorkloadResult={readonly state:"READY";readonly openCount:number}|{readonly state:"UNAVAILABLE"|"ERROR";readonly openCount:null;readonly reason:string};

/**
 * Open/pending count for the Command Center. Reuses the domain's own
 * terminal-state definition -- `closed_at is null` is the exact predicate a
 * DB check constraint (20260904010000_human_verification_domain.sql) already
 * enforces to equal "status not in (COMPLETED,CANCELLED,DUPLICATE,
 * UNRESOLVABLE)", so this counts the same set as
 * TERMINAL_HUMAN_VERIFICATION_TASK_STATUSES without re-encoding the status
 * list in a second place.
 */
export async function countOpenHumanVerificationTasks(client:SqlClient|null):Promise<VerificationWorkloadResult>{if(!client)return{state:"UNAVAILABLE",openCount:null,reason:"DATABASE_CONNECTION_UNAVAILABLE"};try{const result=await client.query<{open_count:string}>("select count(*)::text as open_count from human_verification_tasks where closed_at is null");return{state:"READY",openCount:Number(result.rows[0]?.open_count??0)}}catch{return{state:"ERROR",openCount:null,reason:"VERIFICATION_QUERY_FAILED"}}}
export function loadOpenHumanVerificationWorkload():Promise<VerificationWorkloadResult>{return countOpenHumanVerificationTasks(getProductionSqlClient())}
export type VerificationDetailResult={readonly state:"READY";readonly detail:HumanVerificationDeskDetail}|{readonly state:"UNAVAILABLE"|"NOT_FOUND"|"ERROR";readonly detail:null;readonly reason:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function loadVerificationQueue():Promise<VerificationQueueResult>{const client=getProductionSqlClient();if(!client)return{state:"UNAVAILABLE",items:[],total:null,reason:"DATABASE_CONNECTION_UNAVAILABLE"};try{const result=await new PostgresHumanVerificationDeskRepository(client).list(),asOf=new Date();return{state:"READY",items:result.items.map(x=>assembleHumanVerificationDeskItem(x,asOf)),total:result.total}}catch{return{state:"ERROR",items:[],total:null,reason:"VERIFICATION_QUERY_FAILED"}}}
export async function loadVerificationDetail(id:string):Promise<VerificationDetailResult>{if(!UUID.test(id))return{state:"NOT_FOUND",detail:null,reason:"INVALID_TASK_ID"};const client=getProductionSqlClient();if(!client)return{state:"UNAVAILABLE",detail:null,reason:"DATABASE_CONNECTION_UNAVAILABLE"};try{const record=await new PostgresHumanVerificationDeskRepository(client).get(id);return record?{state:"READY",detail:assembleHumanVerificationDeskDetail(record,new Date())}:{state:"NOT_FOUND",detail:null,reason:"TASK_NOT_FOUND"}}catch{return{state:"ERROR",detail:null,reason:"VERIFICATION_QUERY_FAILED"}}}
