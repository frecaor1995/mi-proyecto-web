import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommercialIntakeForm } from "../../components/commercial-intake/commercial-intake-form";
import { commercialIntakeCopy } from "../../components/commercial-intake/commercial-intake-copy";
import type { CommercialIntakeInput } from "../../domain/commercial-intake";
import type { OperatorRecord } from "../../domain/operator";
import { transactionRunnerOnClient } from "../../server/database/transaction";
import { PostgresCommercialIntakeRepository } from "../../server/repositories/commercial-intake/postgres-commercial-intake-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import type { OperatorRepository } from "../../server/repositories/operator/operator-repository";
import { PostgresDemandRequirementRepository } from "../../server/repositories/demand/postgres-demand-requirement-repository";
import { PostgresOpportunityRepository } from "../../server/repositories/opportunity/postgres-opportunity-repository";
import { CommercialIntakeService } from "../../server/services/commercial-intake/commercial-intake-service";
import { assembleOpportunityIntelligenceDetail } from "../../server/read-models/opportunity-detail";

const migrations=["20260817010000_canonical_model.sql","20260817020000_evidence_provenance.sql","20260817030000_source_registry_compliance.sql","20260817040000_controlled_ingestion.sql","20260817050000_claim_assertions.sql","20260817060000_company_resolution.sql","20260817070000_manpower_acceptance.sql","20260817080000_contacts_routes.sql","20260817090000_opportunity_graph.sql","20260817100000_human_verification.sql","20260915020000_workforce_shared_taxonomy_foundation.sql","20260918010000_matching_b1_demand_readiness.sql"];
const input:CommercialIntakeInput={idempotencyKey:"11111111-1111-4111-8111-111111111111",sourceType:"PHONE_CALL",sourceReference:null,evidenceSummary:"Synthetic Texas contractor requested twelve electricians for a future project.",customerName:"Synthetic Texas Contractor",opportunityTitle:"Synthetic Texas Electrical Workforce Request",projectName:"Synthetic Texas Project",city:"Austin",state:"TX",tradeCode:"ELECTRICAL",occupationCode:"ELECTRICIAN",headcount:12,minimumExperienceMonths:24,startDate:"2026-10-05",schedule:"Day shift",skills:[{code:"INDUSTRIAL_ELECTRICAL",level:"REQUIRED"}],credentials:[{code:"OSHA_10",level:"PREFERRED"}]};
const operator:OperatorRecord={id:"22222222-2222-4222-8222-222222222222",authUserId:"33333333-3333-4333-8333-333333333333",email:"operator@example.invalid",displayName:"Synthetic Operator",status:"ACTIVE",permissions:["demand_requirement.write"],createdAt:new Date(),updatedAt:new Date()};
const operatorRepository:OperatorRepository={findByAuthUserId:async()=>operator,getById:async()=>operator,create:async()=>operator};

describe("Commercial Intake evidence-to-demand vertical slice",()=>{
  let db:PGlite,client:SqlClient;
  beforeAll(async()=>{db=new PGlite();await db.exec("create role fly_workforce_runtime");for(const file of migrations)await db.exec(await readFile(resolve(process.cwd(),"supabase/migrations",file),"utf8"));client=db as unknown as SqlClient;});
  afterAll(async()=>db.close());

  it("fails closed for unauthenticated and unauthorized operators",async()=>{
    const runner=transactionRunnerOnClient(client);
    expect((await new CommercialIntakeService({transactionRunner:runner,getSession:async()=>null,operatorRepository}).activate(input)).kind).toBe("UNAUTHENTICATED");
    const denied={...operatorRepository,findByAuthUserId:async()=>({...operator,permissions:[]})};
    expect((await new CommercialIntakeService({transactionRunner:runner,getSession:async()=>({authUserId:operator.authUserId,email:operator.email}),operatorRepository:denied}).activate(input)).kind).toBe("UNAUTHORIZED");
  });

  it("atomically creates evidence, one canonical current demand, requirements, opportunity, and a matching-ready handoff",async()=>{
    const runner=transactionRunnerOnClient(client),repo=new PostgresCommercialIntakeRepository(client);
    const first=await runner(scoped=>new PostgresCommercialIntakeRepository(scoped).activate(input,operator.id,new Date("2026-09-24T12:00:00Z")));
    expect(first.replayed).toBe(false);expect(first.companyResolution).toBe("UNRESOLVED");
    const graph=await new PostgresOpportunityRepository(client).loadGraph(first.opportunityId,new Date("2026-09-24T12:00:01Z"));
    expect(graph.demandSignals).toHaveLength(1);expect(graph.evidence).toHaveLength(1);
    expect(graph.demandSignals[0]).toMatchObject({id:first.demandSignalId,trade_code:"ELECTRICAL",occupation_code:"ELECTRICIAN",headcount_estimate:12});
    expect(new Date(graph.demandSignals[0].start_date as string).toISOString().slice(0,10)).toBe("2026-10-05");
    const demandRepo=new PostgresDemandRequirementRepository(client);
    expect(await demandRepo.listSkillRequirements(first.demandSignalId)).toMatchObject([{skillCode:"INDUSTRIAL_ELECTRICAL",requirementLevel:"REQUIRED",rawEvidenceId:first.evidenceId}]);
    expect(await demandRepo.listCredentialRequirements(first.demandSignalId)).toMatchObject([{credentialCode:"OSHA_10",requirementLevel:"PREFERRED",rawEvidenceId:first.evidenceId}]);
    expect(await demandRepo.getMatchingCore(first.demandSignalId)).toMatchObject({tradeCode:"ELECTRICAL",occupationCode:"ELECTRICIAN",minimumExperienceMonths:24});
    const detail=assembleOpportunityIntelligenceDetail({...graph,gaps:[],conflicts:[]},new Date("2026-09-24T12:00:01Z"));
    expect(detail).toMatchObject({opportunityId:first.opportunityId,title:input.opportunityTitle});
    expect(detail.demand[0]).toMatchObject({id:first.demandSignalId,headcount:{state:"KNOWN",value:12}});
    const replay=await runner(scoped=>new PostgresCommercialIntakeRepository(scoped).activate(input,operator.id,new Date("2026-09-24T12:01:00Z")));
    expect(replay).toMatchObject({opportunityId:first.opportunityId,demandSignalId:first.demandSignalId,evidenceId:first.evidenceId,replayed:true});
    expect(Number((await client.query<{count:string}>("select count(*)::text count from demand_signals where source_identity_key like 'commercial-intake:%'")).rows[0].count)).toBe(1);
    expect(Number((await client.query<{count:string}>("select count(*)::text count from opportunities where id=$1",[first.opportunityId])).rows[0].count)).toBe(1);
    void repo;
  });

  it("returns clear validation failures before authorization or persistence",async()=>{
    const invalid={...input,headcount:0,evidenceSummary:"",tradeCode:""};
    const result=await new CommercialIntakeService({transactionRunner:transactionRunnerOnClient(client),getSession:async()=>null,operatorRepository}).activate(invalid);
    expect(result).toMatchObject({kind:"VALIDATION_ERROR",errors:{evidenceSummary:"required",tradeCode:"required",headcount:"positiveInteger"}});
  });

  it("renders canonical multi-profession controls and bilingual operator copy",()=>{
    const taxonomy={trades:[{code:"ELECTRICAL",labelEn:"Electrical",labelEs:"Electricidad"}],occupations:[{code:"ELECTRICIAN",tradeCode:"ELECTRICAL",labelEn:"Electrician",labelEs:"Electricista"}],skills:[{code:"INDUSTRIAL_ELECTRICAL",labelEn:"Industrial electrical",labelEs:"Electricidad industrial"}],credentials:[{code:"OSHA_10",labelEn:"OSHA 10",labelEs:"OSHA 10"}]};
    const en=renderToStaticMarkup(<CommercialIntakeForm locale="en-US" taxonomy={taxonomy} idempotencyKey={input.idempotencyKey}/>),es=renderToStaticMarkup(<CommercialIntakeForm locale="es-US" taxonomy={taxonomy} idempotencyKey={input.idempotencyKey}/>);
    expect(en).toContain("Activate opportunity");expect(en).toContain("Phone call");expect(es).toContain("Activar oportunidad");expect(es).toContain("Electricidad");
    expect(commercialIntakeCopy["es-US"].honest).toContain("hechos");
  });
});
