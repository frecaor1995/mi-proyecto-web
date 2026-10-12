import { createHash } from "node:crypto";
import {
  canTransitionContact, canTransitionSelection, mobilizationBlockers, requiresMobilizationReview,
  type EngagementAvailabilityState, type EngagementClosureReason, type EngagementContactOutcome,
  type EngagementResolutionState, type EngagementResponseState, type EngagementSelectionState,
  type WorkerDemandEngagement, type WorkerDemandEngagementEvent,
} from "../../../domain/worker-demand-engagement";
import { authorizeOperator } from "../../auth/authorization";
import type { ServerSession } from "../../auth/session";
import type { TransactionRunner } from "../../database/transaction";
import { PostgresWorkerDemandEngagementRepository } from "../../repositories/engagement/postgres-worker-demand-engagement-repository";
import type { AppendEngagementEventInput, EngagementProjectionPatch } from "../../repositories/engagement/worker-demand-engagement-repository";
import { PostgresIdempotencyRepository } from "../../repositories/idempotency/postgres-idempotency-repository";
import type { OperatorRepository } from "../../repositories/operator/operator-repository";

type Common = { readonly idempotencyKey:string; readonly expectedVersion:number; readonly engagementId:string; readonly notes?:string|null };
export type EngagementCommand =
  | {readonly action:"CREATE";readonly idempotencyKey:string;readonly demandSignalId:string;readonly workerId:string;readonly opportunityId:string;readonly originatingMatchResultId:string}
  | (Common & {readonly action:"START_REVIEW"})
  | (Common & {readonly action:"SET_SELECTION";readonly state:EngagementSelectionState;readonly matchResultId?:string|null})
  | (Common & {readonly action:"PLAN_CONTACT"})
  | (Common & {readonly action:"RECORD_CONTACT";readonly routeId:string;readonly outcome:EngagementContactOutcome;readonly matchResultId?:string|null})
  | (Common & {readonly action:"RECORD_RESPONSE";readonly state:EngagementResponseState})
  | (Common & {readonly action:"SET_AVAILABILITY";readonly state:EngagementAvailabilityState;readonly availableFrom?:Date|null;readonly availableUntil?:Date|null})
  | (Common & {readonly action:"SET_RESOLUTIONS";readonly compensation:EngagementResolutionState;readonly travel:EngagementResolutionState})
  | (Common & {readonly action:"ESTABLISH_CANDIDATE"})
  | (Common & {readonly action:"RECONCILE_SAFEGUARDS"})
  | (Common & {readonly action:"CLOSE";readonly reason:EngagementClosureReason})
  | (Common & {readonly action:"REOPEN"});

export type EngagementCommandOutcome =
  | {readonly kind:"EXECUTED"|"REPLAYED";readonly engagementId:string;readonly version:number}
  | {readonly kind:"REJECTED";readonly reason:string;readonly blockers?:readonly string[]};
export interface EngagementServiceDeps {readonly transactionRunner:TransactionRunner;readonly getSession?:()=>Promise<ServerSession|null>;readonly operatorRepository?:OperatorRepository|null;readonly clock?:()=>Date}
export type EngagementReadOutcome =
  | {readonly kind:"FOUND";readonly engagement:WorkerDemandEngagement;readonly events:readonly WorkerDemandEngagementEvent[]}
  | {readonly kind:"NOT_FOUND"|"UNAUTHENTICATED"|"UNAUTHORIZED"};
const canonicalize=(value:unknown):unknown=>{
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right)).map(([key,entry])=>[key,canonicalize(entry)]));
  return value;
};
const hash=(input:EngagementCommand)=>createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex");
const safeNotes=(notes:string|null|undefined)=>{const value=notes?.trim()||null;if(value&&value.length>1000)throw new Error("NOTES_TOO_LONG");return value;};
const actionable=(lifecycle:string|null)=>lifecycle==="ACTIVE";

export async function readWorkerDemandEngagement(engagementId:string,deps:EngagementServiceDeps):Promise<EngagementReadOutcome>{
  const authorization=await authorizeOperator("worker_engagement.read",{getSession:deps.getSession,repository:deps.operatorRepository});
  if(authorization.state!=="AUTHORIZED")return{kind:authorization.state==="UNAUTHENTICATED"?"UNAUTHENTICATED":"UNAUTHORIZED"};
  return deps.transactionRunner(async client=>{
    const repository=new PostgresWorkerDemandEngagementRepository(client),engagement=await repository.findById(engagementId);
    if(!engagement)return{kind:"NOT_FOUND"};
    return{kind:"FOUND",engagement,events:await repository.listEvents(engagementId)};
  });
}

/** B5-C protected command boundary. It is the only application path allowed
 * to mutate the projection and it always appends the corresponding event in
 * the same connection-scoped transaction. */
export async function executeWorkerDemandEngagementCommand(input:EngagementCommand,deps:EngagementServiceDeps):Promise<EngagementCommandOutcome>{
  const authorization=await authorizeOperator("worker_engagement.write",{getSession:deps.getSession,repository:deps.operatorRepository});
  if(authorization.state!=="AUTHORIZED")return{kind:"REJECTED",reason:authorization.state==="UNAUTHENTICATED"?"UNAUTHENTICATED":"UNAUTHORIZED"};
  if(input.action==="RECORD_CONTACT"&&(!authorization.operator.permissions.includes("worker_contact.execute")||!authorization.operator.permissions.includes("worker_contact.read")))return{kind:"REJECTED",reason:"CONTACT_AUTHORITY_REQUIRED"};
  let notes:string|null;try{notes=safeNotes("notes" in input?input.notes:null);}catch{return{kind:"REJECTED",reason:"NOTES_TOO_LONG"};}
  const now=(deps.clock??(()=>new Date()))(),operatorId=authorization.operator.operatorId;
  return deps.transactionRunner(async client=>{
    const repository=new PostgresWorkerDemandEngagementRepository(client),idempotency=new PostgresIdempotencyRepository(client);
    const targetId=input.action==="CREATE"?input.demandSignalId:input.engagementId;
    const claim=await idempotency.claim({idempotencyKey:input.idempotencyKey,operatorId,action:`worker_engagement.${input.action.toLowerCase()}`,targetType:input.action==="CREATE"?"WORKER_DEMAND_PAIR":"WORKER_DEMAND_ENGAGEMENT",targetId,requestFingerprint:hash(input)});
    if(claim.outcome==="CONFLICT"||claim.outcome==="IN_PROGRESS")return{kind:"REJECTED",reason:"IDEMPOTENCY_CONFLICT"};
    if(claim.outcome==="REPLAY"){const stored=claim.result as EngagementCommandOutcome;return stored.kind==="EXECUTED"?{...stored,kind:"REPLAYED"}:stored;}
    const reject=async(reason:string,blockers?:readonly string[]):Promise<EngagementCommandOutcome>=>{const result={kind:"REJECTED",reason,...(blockers?{blockers}:{})} as const;await idempotency.complete(input.idempotencyKey,result);return result;};
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[input.action==="CREATE"?`worker-demand-engagement:${input.demandSignalId}:${input.workerId}`:`worker-demand-engagement-id:${input.engagementId}`]);
    const commandId=await repository.getIdempotencyRecordId(input.idempotencyKey);
    if(input.action==="CREATE"){
      const existing=await repository.findByPair(input.demandSignalId,input.workerId);
      if(existing){const rejected={kind:"REJECTED",reason:"ENGAGEMENT_ALREADY_EXISTS"} as const;await idempotency.complete(input.idempotencyKey,rejected);return rejected;}
      const created=await repository.create({demandSignalId:input.demandSignalId,workerId:input.workerId,opportunityId:input.opportunityId,originatingMatchResultId:input.originatingMatchResultId,operatorId,now});
      await repository.appendEvent({engagementId:created.id,engagementVersion:1,eventType:"ENGAGEMENT_CREATED",actorType:"OPERATOR",actorOperatorId:operatorId,occurredAt:now,stateDimension:"ENGAGEMENT",previousState:null,newState:"OPEN",matchResultId:input.originatingMatchResultId,commandIdempotencyKeyId:commandId});
      const result={kind:"EXECUTED",engagementId:created.id,version:1} as const;await idempotency.complete(input.idempotencyKey,result);return result;
    }
    const current=await repository.findById(input.engagementId,true);
    if(!current){const rejected={kind:"REJECTED",reason:"NOT_FOUND"} as const;await idempotency.complete(input.idempotencyKey,rejected);return rejected;}
    if(current.version!==input.expectedVersion){const rejected={kind:"REJECTED",reason:"CONCURRENCY_CONFLICT"} as const;await idempotency.complete(input.idempotencyKey,rejected);return rejected;}
    const facts=await repository.getContextFacts(current);if(!facts)throw new Error("Engagement context disappeared");
    if(current.closedAt&&input.action!=="REOPEN"){const rejected={kind:"REJECTED",reason:"ENGAGEMENT_CLOSED"} as const;await idempotency.complete(input.idempotencyKey,rejected);return rejected;}
    let patch:EngagementProjectionPatch={},event:Omit<AppendEngagementEventInput,"engagementId"|"engagementVersion"|"actorType"|"actorOperatorId"|"occurredAt"|"commandIdempotencyKeyId">;
    switch(input.action){
      case"START_REVIEW":event={eventType:"REVIEW_STARTED",stateDimension:"ENGAGEMENT",previousState:"OPEN",newState:"OPEN",notes};break;
      case"SET_SELECTION":if(!canTransitionSelection(current.selectionState,input.state))return reject("INVALID_SELECTION_TRANSITION");patch={selectionState:input.state};event={eventType:"SELECTION_CHANGED",stateDimension:"SELECTION",previousState:current.selectionState,newState:input.state,matchResultId:input.matchResultId??facts.currentMatch?.id??null,notes};break;
      case"PLAN_CONTACT":if(!canTransitionContact(current.contactState,"PLANNED"))return reject("INVALID_CONTACT_TRANSITION");patch={contactState:"PLANNED"};event={eventType:"CONTACT_PLANNED",stateDimension:"CONTACT",previousState:current.contactState,newState:"PLANNED",notes};break;
      case"RECORD_CONTACT":{
        if(facts.workerLifecycle!=="ACTIVE"||!actionable(facts.opportunityLifecycle))return reject("CONTACT_PREREQUISITE_FAILED");
        if(!["SHORTLISTED","SELECTED"].includes(current.selectionState))return reject("SELECTION_REQUIRED");
        const route=await repository.getContactRoute(input.routeId);if(!route||route.workerId!==current.workerId||route.lifecycleStatus!=="ACTIVE"||route.consentState!=="GRANTED")return reject("CONTACT_CONSENT_FAILED");
        const next=input.outcome==="RESPONSE_RECEIVED"||input.outcome==="CONVERSATION_COMPLETED"?"RESPONSE_RECEIVED":"AWAITING_RESPONSE";
        if(!canTransitionContact(current.contactState,"ATTEMPTED")&&current.contactState!=="ATTEMPTED")return reject("INVALID_CONTACT_TRANSITION");
        patch={contactState:next};event={eventType:"CONTACT_ATTEMPT_RECORDED",stateDimension:"CONTACT",previousState:current.contactState,newState:next,workerContactRouteId:route.id,routeTypeSnapshot:route.routeType,consentStateSnapshot:route.consentState,routeLifecycleSnapshot:route.lifecycleStatus,contactDirection:"OUTBOUND",contactOutcome:input.outcome,matchResultId:input.matchResultId??facts.currentMatch?.id??null,notes};break;
      }
      case"RECORD_RESPONSE":if(current.contactState!=="AWAITING_RESPONSE"&&current.contactState!=="RESPONSE_RECEIVED")return reject("CONTACT_REQUIRED");patch={contactState:"RESPONSE_RECEIVED",responseState:input.state};event={eventType:"RESPONSE_RECORDED",stateDimension:"RESPONSE",previousState:current.responseState,newState:input.state,contactDirection:"INBOUND",notes};break;
      case"SET_AVAILABILITY":if(input.state==="CONFIRMED_AVAILABLE"&&!input.availableFrom)return reject("AVAILABLE_FROM_REQUIRED");if(input.availableFrom&&input.availableUntil&&input.availableUntil<input.availableFrom)return reject("INVALID_AVAILABILITY_RANGE");patch={demandAvailabilityState:input.state,availableFrom:input.state==="UNKNOWN"?null:input.availableFrom??null,availableUntil:input.state==="UNKNOWN"?null:input.availableUntil??null};event={eventType:"DEMAND_AVAILABILITY_CHANGED",stateDimension:"AVAILABILITY",previousState:current.demandAvailabilityState,newState:input.state,availableFrom:patch.availableFrom,availableUntil:patch.availableUntil,notes};break;
      case"SET_RESOLUTIONS":patch={compensationResolutionState:input.compensation,travelResolutionState:input.travel};event={eventType:"RESOLUTIONS_CHANGED",stateDimension:"RESOLUTIONS",previousState:`${current.compensationResolutionState}/${current.travelResolutionState}`,newState:`${input.compensation}/${input.travel}`,notes};break;
      case"ESTABLISH_CANDIDATE":{
        const blockers=mobilizationBlockers({engagementOpen:true,selectionState:current.selectionState,workerLifecycle:facts.workerLifecycle,validConsentedContactOccurred:facts.consentedContactOccurred,consentStillGranted:facts.currentContactConsentGranted,responseState:current.responseState,availabilityState:current.demandAvailabilityState,availabilitySatisfiesStart:current.availableFrom!==null&&(!facts.demandStartDate||current.availableFrom<=facts.demandStartDate),demandActionable:actionable(facts.opportunityLifecycle),currentMatchOutcome:facts.currentMatch?.outcome??null,hardViolation:facts.currentMatch?.hardViolation??true,compensationResolution:current.compensationResolutionState,travelResolution:current.travelResolutionState});
        if(blockers.length)return reject("MOBILIZATION_BLOCKED",blockers);patch={mobilizationState:"CANDIDATE"};event={eventType:"MOBILIZATION_CHANGED",stateDimension:"MOBILIZATION",previousState:current.mobilizationState,newState:"CANDIDATE",matchResultId:facts.currentMatch?.id??null,notes};break;
      }
      case"RECONCILE_SAFEGUARDS":{
        const review=requiresMobilizationReview(facts.currentMatch?.outcome??null,facts.currentMatch?.hardViolation??true,facts.workerLifecycle,actionable(facts.opportunityLifecycle));
        if(!review)return reject("NO_REVIEW_REQUIRED");patch={mobilizationState:"REVIEW_REQUIRED",...(facts.currentContactConsentGranted?{}:{contactState:"BLOCKED"})};event={eventType:facts.workerLifecycle!=="ACTIVE"?"WORKER_LIFECYCLE_REVIEW_REQUIRED":"MATCH_REVIEW_REQUIRED",stateDimension:"MOBILIZATION",previousState:current.mobilizationState,newState:"REVIEW_REQUIRED",matchResultId:facts.currentMatch?.id??null,reasonCode:facts.workerLifecycle!=="ACTIVE"?`WORKER_${facts.workerLifecycle}`:facts.currentMatch?.outcome??"MATCH_MISSING",notes};break;
      }
      case"CLOSE":patch={closedAt:now,closureReason:input.reason,...(current.mobilizationState==="CANDIDATE"?{mobilizationState:"REVIEW_REQUIRED" as const}:{})};event={eventType:"ENGAGEMENT_CLOSED",stateDimension:"ENGAGEMENT",previousState:"OPEN",newState:"CLOSED",reasonCode:input.reason,notes};break;
      case"REOPEN":if(!current.closedAt||!actionable(facts.opportunityLifecycle)||facts.workerLifecycle!=="ACTIVE")return reject("REOPEN_PREREQUISITE_FAILED");patch={closedAt:null,closureReason:null,mobilizationState:"REVIEW_REQUIRED"};event={eventType:"ENGAGEMENT_REOPENED",stateDimension:"ENGAGEMENT",previousState:"CLOSED",newState:"OPEN",notes};break;
    }
    const updated=await repository.updateProjection(current.id,current.version,patch,"OPERATOR",operatorId,now);if(!updated)return reject("CONCURRENCY_CONFLICT");
    await repository.appendEvent({...event,engagementId:updated.id,engagementVersion:updated.version,actorType:"OPERATOR",actorOperatorId:operatorId,occurredAt:now,commandIdempotencyKeyId:commandId});
    const result={kind:"EXECUTED",engagementId:updated.id,version:updated.version} as const;await idempotency.complete(input.idempotencyKey,result);return result;
  });
}
