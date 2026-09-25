import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mobilizationBlockers, canTransitionContact, canTransitionSelection } from "../../domain/worker-demand-engagement";
import type { ServerSession } from "../../server/auth/session";
import { transactionRunnerOnClient } from "../../server/database/transaction";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresWorkerDemandEngagementRepository } from "../../server/repositories/engagement/postgres-worker-demand-engagement-repository";
import { executeWorkerDemandEngagementCommand, readWorkerDemandEngagement, type EngagementCommand } from "../../server/services/engagement/worker-demand-engagement-service";

type EngagementStep = EngagementCommand extends infer Command
  ? Command extends { engagementId: string; expectedVersion: number }
    ? Omit<Command, "engagementId" | "expectedVersion">
    : never
  : never;

const EXCLUDED = new Set([
  "20260913133740_discovery_mvp_a0_durable_runs.sql", "20260913135341_discovery_mvp_a_candidates.sql",
  "20260914024442_discovery_mvp_b_r1_destination_policy_state.sql", "20260914094253_canonical_multi_profession_demand.sql",
  "20260915024424_security_rls_b0_r1_public_routine_defaults.sql", "20260915024716_security_rls_b0_r1_global_routine_defaults.sql",
  "20260925011609_opportunity_radar_search_automation.sql", "20260925021527_radar_query_kind_schema_compatibility.sql",
]);
const AUTH = "b5c00000-0000-4000-8000-000000000001";

describe("MATCHING-B5-C canonical engagement foundation",()=>{
  let db:PGlite,client:SqlClient,operatorRepository:PostgresOperatorRepository,operatorId:string;
  let demandId:string,workerId:string,opportunityId:string,matchId:string,routeId:string;
  const session=():Promise<ServerSession>=>Promise.resolve({authUserId:AUTH,email:"b5c@example.com"});
  const execute=(input:EngagementCommand)=>executeWorkerDemandEngagementCommand(input,{transactionRunner:transactionRunnerOnClient(client),getSession:session,operatorRepository});

  beforeAll(async()=>{
    db=new PGlite();client=db as unknown as SqlClient;
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory=resolve(process.cwd(),"supabase/migrations");
    const files=(await readdir(directory)).filter(name=>name.endsWith(".sql")&&!EXCLUDED.has(name)).sort();
    for(const file of files)await db.exec(await readFile(resolve(directory,file),"utf8"));
    operatorRepository=new PostgresOperatorRepository(client);
    const operator=await operatorRepository.create({authUserId:AUTH,email:"b5c@example.com",permissions:["worker_engagement.read","worker_engagement.write","worker_contact.read","worker_contact.execute"]});operatorId=operator.id;
    workerId=(await db.query<{id:string}>(`insert into workforce_workers(display_name,source_of_record,lifecycle_status)values('B5-C MULTI-PROFESSION WORKER','IMPORTED','ACTIVE')returning id`)).rows[0].id;
    demandId=(await db.query<{id:string}>(`insert into demand_signals(title,role_type,start_date)values('B5-C pipefitter demand','OTHER','2026-10-01')returning id`)).rows[0].id;
    opportunityId=(await db.query<{id:string}>(`insert into opportunities(title,lifecycle,opportunity_identity_key)values('B5-C opportunity','ACTIVE','b5c-opportunity')returning id`)).rows[0].id;
    await db.query(`insert into opportunity_demand_signals(opportunity_id,demand_signal_id)values($1,$2)`,[opportunityId,demandId]);
    matchId=(await db.query<{id:string}>(`insert into worker_demand_match_results(demand_signal_id,worker_id,outcome,rule_version,evaluation_date,worker_input_fingerprint,demand_input_fingerprint,worker_lifecycle_status_at_evaluation)values($1,$2,'STRONG_MATCH','matching-b1-d-v1','2026-09-22','worker','demand','ACTIVE')returning id`,[demandId,workerId])).rows[0].id;
    routeId=(await db.query<{id:string}>(`insert into worker_contact_routes(worker_id,route_type,target,preferred,verification_state,consent_state,consent_captured_at,lifecycle_status)values($1,'PHONE','+1-555-0100',true,'VERIFIED','GRANTED','2026-09-22','ACTIVE')returning id`,[workerId])).rows[0].id;
  });
  afterAll(async()=>db.close());

  it("defines independent deterministic state machines",()=>{
    expect(canTransitionSelection("REVIEWING","SELECTED")).toBe(true);
    expect(canTransitionSelection("SELECTED","REVIEWING")).toBe(false);
    expect(canTransitionContact("NOT_STARTED","ATTEMPTED")).toBe(true);
    expect(canTransitionContact("BLOCKED","ATTEMPTED")).toBe(false);
    expect(mobilizationBlockers({engagementOpen:true,selectionState:"SELECTED",workerLifecycle:"ACTIVE",validConsentedContactOccurred:true,consentStillGranted:true,responseState:"INTERESTED",availabilityState:"CONFIRMED_AVAILABLE",availabilitySatisfiesStart:true,demandActionable:true,currentMatchOutcome:"STRONG_MATCH",hardViolation:false,compensationResolution:"COMPATIBLE",travelResolution:"NOT_REQUIRED"})).toEqual([]);
  });

  it("creates one canonical root and immutable version-one event",async()=>{
    const result=await execute({action:"CREATE",idempotencyKey:"b5c-create",demandSignalId:demandId,workerId,opportunityId,originatingMatchResultId:matchId});
    expect(result.kind).toBe("EXECUTED");if(result.kind!=="EXECUTED")throw new Error("setup failed");
    const repo=new PostgresWorkerDemandEngagementRepository(client),root=await repo.findById(result.engagementId),events=await repo.listEvents(result.engagementId);
    expect(root).toMatchObject({version:1,selectionState:"REVIEWING",contactState:"NOT_STARTED",mobilizationState:"NOT_READY"});
    expect(events.map(event=>event.eventType)).toEqual(["ENGAGEMENT_CREATED"]);
    await expect(db.query(`insert into worker_demand_engagements(demand_signal_id,worker_id,opportunity_id,created_by_operator_id,updated_by_operator_id)values($1,$2,$3,$4,$4)`,[demandId,workerId,opportunityId,operatorId])).rejects.toThrow();
    await expect(db.query(`delete from worker_demand_engagements where id=$1`,[result.engagementId])).rejects.toThrow();
    await expect(db.query(`update worker_demand_engagement_events set notes='rewrite' where engagement_id=$1`,[result.engagementId])).rejects.toThrow();
  });

  it("executes the complete commercial path, replays idempotently, and records no contact target",async()=>{
    const root=(await new PostgresWorkerDemandEngagementRepository(client).findByPair(demandId,workerId))!;
    let version=root.version;
    const step=async(command:EngagementStep)=>{const result=await execute({...command,engagementId:root.id,expectedVersion:version} as EngagementCommand);expect(result.kind).toBe("EXECUTED");if(result.kind!=="EXECUTED")throw new Error("engagement step failed");version=result.version;return result;};
    await step({action:"SET_SELECTION",idempotencyKey:"b5c-select",state:"SELECTED",matchResultId:matchId});
    const contact=await step({action:"RECORD_CONTACT",idempotencyKey:"b5c-contact",routeId,outcome:"CONVERSATION_COMPLETED",matchResultId:matchId});
    const replay=await execute({action:"RECORD_CONTACT",idempotencyKey:"b5c-contact",engagementId:root.id,expectedVersion:contact.version-1,routeId,outcome:"CONVERSATION_COMPLETED",matchResultId:matchId});
    expect(replay).toMatchObject({kind:"REPLAYED",version:contact.version});
    await step({action:"RECORD_RESPONSE",idempotencyKey:"b5c-response",state:"INTERESTED"});
    await step({action:"SET_AVAILABILITY",idempotencyKey:"b5c-availability",state:"CONFIRMED_AVAILABLE",availableFrom:new Date("2026-09-30")});
    await step({action:"SET_RESOLUTIONS",idempotencyKey:"b5c-resolutions",compensation:"COMPATIBLE",travel:"NOT_REQUIRED"});
    await step({action:"ESTABLISH_CANDIDATE",idempotencyKey:"b5c-candidate"});
    const repo=new PostgresWorkerDemandEngagementRepository(client),candidate=await repo.findById(root.id),events=await repo.listEvents(root.id);
    expect(candidate?.mobilizationState).toBe("CANDIDATE");expect(events).toHaveLength(version);
    const read=await readWorkerDemandEngagement(root.id,{transactionRunner:transactionRunnerOnClient(client),getSession:session,operatorRepository});expect(read.kind).toBe("FOUND");
    const serialized=JSON.stringify(events);expect(serialized).not.toContain("555-0100");expect(serialized).not.toContain("+1-");
  });

  it("round-trips B5 calendar dates exactly in America/Chicago, including DST, single-day, and nullable-until cases",async()=>{
    const originalTimezone=process.env.TZ;
    process.env.TZ="America/Chicago";
    try{
      const calendarWorker=(await db.query<{id:string}>(`insert into workforce_workers(display_name,source_of_record,lifecycle_status)values('B5-C CALENDAR DATE WORKER','IMPORTED','ACTIVE')returning id`)).rows[0].id;
      const calendarMatch=(await db.query<{id:string}>(`insert into worker_demand_match_results(demand_signal_id,worker_id,outcome,rule_version,evaluation_date,worker_input_fingerprint,demand_input_fingerprint,worker_lifecycle_status_at_evaluation)values($1,$2,'STRONG_MATCH','matching-b1-d-v1','2026-09-22','calendar-worker','calendar-demand','ACTIVE')returning id`,[demandId,calendarWorker])).rows[0].id;
      const created=await execute({action:"CREATE",idempotencyKey:"b5c-calendar-create",demandSignalId:demandId,workerId:calendarWorker,opportunityId,originatingMatchResultId:calendarMatch});
      expect(created.kind).toBe("EXECUTED");if(created.kind!=="EXECUTED")throw new Error("calendar setup failed");
      let version=created.version;
      const verify=async(key:string,from:string,until:string|null)=>{
        const beforeEvents=await db.query<{count:string}>(`select count(*)::text count from worker_demand_engagement_events where engagement_id=$1`,[created.engagementId]);
        const beforeCommands=await db.query<{count:string}>(`select count(*)::text count from command_idempotency_keys where target_id=$1 and action='worker_engagement.set_availability'`,[created.engagementId]);
        const result=await execute({action:"SET_AVAILABILITY",idempotencyKey:key,engagementId:created.engagementId,expectedVersion:version,state:"CONFIRMED_AVAILABLE",availableFrom:new Date(`${from}T00:00:00.000Z`),availableUntil:until?new Date(`${until}T00:00:00.000Z`):null});
        expect(result.kind).toBe("EXECUTED");if(result.kind!=="EXECUTED")throw new Error("calendar command failed");version=result.version;
        const projection=await db.query<{available_from:string;available_until:string|null}>(`select available_from::text,available_until::text from worker_demand_engagements where id=$1`,[created.engagementId]);
        const event=await db.query<{available_from:string;available_until:string|null}>(`select available_from::text,available_until::text from worker_demand_engagement_events where engagement_id=$1 and engagement_version=$2`,[created.engagementId,version]);
        expect(projection.rows[0]).toEqual({available_from:from,available_until:until});
        expect(event.rows[0]).toEqual({available_from:from,available_until:until});
        const read=await readWorkerDemandEngagement(created.engagementId,{transactionRunner:transactionRunnerOnClient(client),getSession:session,operatorRepository});
        expect(read.kind).toBe("FOUND");if(read.kind!=="FOUND")throw new Error("calendar read failed");
        expect(read.engagement.availableFrom?.toISOString().slice(0,10)).toBe(from);
        expect(read.engagement.availableUntil?.toISOString().slice(0,10)??null).toBe(until);
        expect(read.events.at(-1)?.availableFrom?.toISOString().slice(0,10)).toBe(from);
        expect(read.events.at(-1)?.availableUntil?.toISOString().slice(0,10)??null).toBe(until);
        const afterEvents=await db.query<{count:string}>(`select count(*)::text count from worker_demand_engagement_events where engagement_id=$1`,[created.engagementId]);
        const afterCommands=await db.query<{count:string}>(`select count(*)::text count from command_idempotency_keys where target_id=$1 and action='worker_engagement.set_availability'`,[created.engagementId]);
        expect(Number(afterEvents.rows[0].count)-Number(beforeEvents.rows[0].count)).toBe(1);
        expect(Number(afterCommands.rows[0].count)-Number(beforeCommands.rows[0].count)).toBe(1);
      };
      await verify("b5c-calendar-september","2026-09-28","2026-09-29");
      await verify("b5c-calendar-dst","2026-03-08","2026-03-09");
      await verify("b5c-calendar-single-day","2026-11-01","2026-11-01");
      await verify("b5c-calendar-null-until","2026-12-15",null);
    }finally{
      if(originalTimezone===undefined)delete process.env.TZ;else process.env.TZ=originalTimezone;
    }
  });

  it("fails closed for unknown consent without root/event mutation",async()=>{
    const secondWorker=(await db.query<{id:string}>(`insert into workforce_workers(display_name,source_of_record,lifecycle_status)values('B5-C WELDER','IMPORTED','ACTIVE')returning id`)).rows[0].id;
    const secondMatch=(await db.query<{id:string}>(`insert into worker_demand_match_results(demand_signal_id,worker_id,outcome,rule_version,evaluation_date,worker_input_fingerprint,demand_input_fingerprint,worker_lifecycle_status_at_evaluation)values($1,$2,'POSSIBLE_MATCH','matching-b1-d-v1','2026-09-22','worker-2','demand','ACTIVE')returning id`,[demandId,secondWorker])).rows[0].id;
    const unknownRoute=(await db.query<{id:string}>(`insert into worker_contact_routes(worker_id,route_type,target,consent_state,lifecycle_status)values($1,'EMAIL','private@example.com','UNKNOWN','ACTIVE')returning id`,[secondWorker])).rows[0].id;
    const created=await execute({action:"CREATE",idempotencyKey:"b5c-negative-create",demandSignalId:demandId,workerId:secondWorker,opportunityId,originatingMatchResultId:secondMatch});if(created.kind!=="EXECUTED")throw new Error("negative setup failed");
    const selected=await execute({action:"SET_SELECTION",idempotencyKey:"b5c-negative-select",engagementId:created.engagementId,expectedVersion:1,state:"SELECTED"});if(selected.kind!=="EXECUTED")throw new Error("negative select failed");
    const denied=await execute({action:"RECORD_CONTACT",idempotencyKey:"b5c-negative-contact",engagementId:created.engagementId,expectedVersion:2,routeId:unknownRoute,outcome:"NO_ANSWER"});
    expect(denied).toEqual({kind:"REJECTED",reason:"CONTACT_CONSENT_FAILED"});
    const repo=new PostgresWorkerDemandEngagementRepository(client);expect((await repo.findById(created.engagementId))?.version).toBe(2);expect(await repo.listEvents(created.engagementId)).toHaveLength(2);
    expect(await execute({action:"RECORD_CONTACT",idempotencyKey:"b5c-negative-contact",engagementId:created.engagementId,expectedVersion:2,routeId:unknownRoute,outcome:"NO_ANSWER"})).toEqual(denied);
  });

  it("preserves history and requires review after a NO_MATCH rerun or inactive lifecycle",async()=>{
    const repo=new PostgresWorkerDemandEngagementRepository(client),root=(await repo.findByPair(demandId,workerId))!;
    await db.query(`update worker_demand_match_results set superseded_at=now() where id=$1`,[matchId]);
    const noMatch=(await db.query<{id:string}>(`insert into worker_demand_match_results(demand_signal_id,worker_id,outcome,rule_version,evaluation_date,worker_input_fingerprint,demand_input_fingerprint,worker_lifecycle_status_at_evaluation)values($1,$2,'NO_MATCH','matching-b1-d-v1','2026-09-23','worker-rerun','demand','ACTIVE')returning id`,[demandId,workerId])).rows[0].id;
    const before=(await repo.listEvents(root.id)).length;
    const reconciled=await execute({action:"RECONCILE_SAFEGUARDS",idempotencyKey:"b5c-reconcile",engagementId:root.id,expectedVersion:root.version});expect(reconciled.kind).toBe("EXECUTED");
    const after=await repo.findById(root.id);expect(after?.mobilizationState).toBe("REVIEW_REQUIRED");expect((await repo.listEvents(root.id)).length).toBe(before+1);expect(after?.selectionState).toBe("SELECTED");
    expect((await repo.listEvents(root.id)).some(event=>event.matchResultId===noMatch)).toBe(true);
  });

  it("rejects stale optimistic versions without changing the projection or history",async()=>{
    const repo=new PostgresWorkerDemandEngagementRepository(client),root=(await repo.findByPair(demandId,workerId))!,before=(await repo.listEvents(root.id)).length;
    const stale=await execute({action:"START_REVIEW",idempotencyKey:"b5c-stale",engagementId:root.id,expectedVersion:root.version-1});
    expect(stale).toEqual({kind:"REJECTED",reason:"CONCURRENCY_CONFLICT"});
    expect((await repo.findById(root.id))?.version).toBe(root.version);expect(await repo.listEvents(root.id)).toHaveLength(before);
  });

  it("enables RLS and grants no browser-role privileges",async()=>{
    const security=await db.query<{relname:string;relrowsecurity:boolean}>(`select relname,relrowsecurity from pg_class where relname in('worker_demand_engagements','worker_demand_engagement_events') order by relname`);
    expect(security.rows).toHaveLength(2);expect(security.rows.every(row=>row.relrowsecurity)).toBe(true);
    const browser=await db.query<{count:string}>(`select count(*)::text count from information_schema.table_privileges where table_name in('worker_demand_engagements','worker_demand_engagement_events') and grantee in('anon','authenticated','PUBLIC')`);
    expect(browser.rows[0].count).toBe("0");
  });
});
