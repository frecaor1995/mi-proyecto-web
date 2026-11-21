import { randomUUID } from "node:crypto";
import { readFile,readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect,test } from "vitest";
import type { ProductionSourceProfile } from "../../../domain/production-source";
import { ProductionCaptureIngestion } from "../../ingestion/production-capture-ingestion";
import { PostgresEvidenceRepository } from "../../repositories/evidence/postgres-evidence-repository";
import { PostgresIngestionRepository } from "../../repositories/ingestion/postgres-ingestion-repository";
import { PostgresProductionSourceRepository } from "../../repositories/production-source/postgres-production-source-repository";
import { EvidenceCaptureService } from "../../services/evidence/capture-evidence";
import { RosendinAdapter } from "./rosendin-adapter";
import { TpwdConstructionAdapter } from "./tpwd-adapter";
const live={get:async(url:string)=>{const r=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/2B controlled-public-smoke"}});return{status:r.status,url:r.url,contentType:r.headers.get("content-type"),body:await r.text(),headers:{"cache-control":r.headers.get("cache-control")??""}}}};
const profile=(sourceId:string,family:ProductionSourceProfile["family"]):ProductionSourceProfile=>({sourceId,family,tier:"DIRECT_CORPORATE",capabilities:family==="PROCUREMENT_PORTAL"?["PROJECT_EXISTENCE","VENDOR_ROUTE"]:["WORKFORCE_DEMAND"],methods:family==="PROCUREMENT_PORTAL"?["STATIC_HTML"]:["PUBLIC_JSON"],readiness:"APPROVED_FOR_LIVE_CAPTURE",schedule:{desiredCadenceMinutes:1440,minimumIntervalMinutes:60,freshnessTargetMinutes:2880,nextEligibleCapture:null,backoff:{initialMinutes:15,maximumMinutes:1440,multiplier:2},localRestrictions:[]},rateLimit:{requests:1,windowMinutes:1},identityVersion:"source@1",metadata:{controlledSmoke:true}});
test("controlled live captures persist real demand and non-demand provenance",async()=>{
 const db=new PGlite();
 try{
  for(const f of(await readdir(resolve(process.cwd(),"supabase/migrations"))).filter(x=>x.endsWith(".sql")).sort())await db.exec(await readFile(resolve(process.cwd(),"supabase/migrations",f),"utf8"));
  const er=new PostgresEvidenceRepository(db),service=new ProductionCaptureIngestion(new EvidenceCaptureService(er),new PostgresProductionSourceRepository(db),new PostgresIngestionRepository(db),er),results=[];
  for(const spec of[{name:"Rosendin",family:"COMPANY_CAREERS"as const,adapter:new RosendinAdapter(live)},{name:"TPWD",family:"PROCUREMENT_PORTAL"as const,adapter:new TpwdConstructionAdapter(live)}]){
   const sourceId=(await db.query<{id:string}>("insert into sources(name)values($1)returning id",[spec.name])).rows[0].id;
   const policyId=(await db.query<{id:string}>("insert into source_capture_policy_decisions(source_id,capture_method,decision,reason,reviewed_at,reviewed_by,policy_version)values($1,'HTTP_FETCH','ALLOWED','approved public endpoint',now(),'Phase 2B manager','2b-live')returning id",[sourceId])).rows[0].id;
   const executionId=randomUUID(),asOf=new Date(),out=await service.run(sourceId,spec.adapter,{executionId,requestedTarget:spec.adapter.descriptor.sourceId,cursor:null,policyDecisionId:policyId,asOf},profile(sourceId,spec.family),"ALLOW");
   if(out.status!=="SUCCESS")throw new Error(`${spec.name}: ${out.failure.classification}: ${out.failure.message}`);
   const audit=(await db.query<{observation_id:string;captured_target:string}>("select observation_id,captured_target from production_source_executions where id=$1",[executionId])).rows[0];
   results.push({source:spec.name,sourceId,executionId,evidenceId:out.evidence.id,observationId:audit.observation_id,demandSignalId:out.demandSignalId,adapter:spec.adapter.descriptor.adapterId,adapterVersion:spec.adapter.descriptor.version,parser:spec.adapter.descriptor.parser,capturedTarget:audit.captured_target,capturedAt:asOf.toISOString(),observations:out.observations.length});
  }
  expect(results[0].demandSignalId).toBeTruthy();expect(results[1].demandSignalId).toBeNull();console.log("PHASE_2B_LIVE_PROOF",JSON.stringify(results));
 }finally{await db.close()}
},60000);
