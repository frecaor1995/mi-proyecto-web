import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canonicalHeadcount, classifyDiscoveryQuantity, talentGap } from "../../domain/discovery-quantity";
import { COMPANY_REVIEW_OUTCOMES, DEMAND_REVIEW_OUTCOMES } from "../../server/discovery-review/discovery-review-workflow";
import { loadDiscoveryReviewCase } from "../../server/discovery-review/discovery-review-workflow";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

const root=process.cwd();
const source=(path:string)=>readFile(`${root}/${path}`,"utf8");

describe("Phase 1.3 R1 transactional review contract",()=>{
  it("offers every authorized company-review outcome without creating a parallel taxonomy",()=>{
    expect(COMPANY_REVIEW_OUTCOMES).toEqual(["LINK","CREATE","DEFER","REJECT_MATCH","UNSUPPORTED","NOT_ACTIONABLE","KEEP_UNRESOLVED"]);
  });
  it("offers verify, reject and defer as distinct demand decisions",()=>expect(DEMAND_REVIEW_OUTCOMES).toEqual(["VERIFY","REJECT","DEFER"]));
  it("keeps aggregate counts out of canonical headcount even after human demand verification",()=>{
    const aggregate=classifyDiscoveryQuantity({title:"47 apprentice electrician jobs in Austin",domain:"indeed.com"});
    expect(aggregate.type).toBe("AGGREGATE_MARKET_COUNT");expect(canonicalHeadcount(aggregate,true)).toBeNull();
  });
  it("keeps posting and ambiguous quantities out of canonical headcount",()=>{
    expect(canonicalHeadcount(classifyDiscoveryQuantity({title:"Contractor has 8 openings",domain:"example.com"}),true)).toBeNull();
    expect(canonicalHeadcount(classifyDiscoveryQuantity({title:"Hiring several electricians",domain:"example.com"}),true)).toBeNull();
  });
  it("allows only explicit employer headcount plus a human verification",()=>{
    const explicit=classifyDiscoveryQuantity({title:"Contractor needs 14 electricians for the project",domain:"contractor.example"});
    expect(canonicalHeadcount(explicit,false)).toBeNull();expect(canonicalHeadcount(explicit,true)).toBe(14);
  });
  it("keeps Talent Gap unknown when canonical headcount is unknown",()=>expect(talentGap(null,9)).toEqual({needed:null,viable:9,gap:null,coverageRatio:null}));
  it("calculates Talent Gap only from explicit supported headcount",()=>expect(talentGap(14,9)).toEqual({needed:14,viable:9,gap:5,coverageRatio:9/14}));
  it("enforces server-side operator authorization on all three mutations",async()=>{
    const actions=await source("src/server/discovery-review/actions.ts");
    expect(actions.match(/authorizeOperator\("human_verification\.write"\)/g)).toHaveLength(3);
    expect(actions).toContain("getProductionTransactionRunner");
  });
  it("uses append-only audits, human decisions and the canonical junction",async()=>{
    const workflow=await source("src/server/discovery-review/discovery-review-workflow.ts");
    expect(workflow).toContain("insert into company_resolution_audits");
    expect(workflow).toContain("insert into human_verification_decisions");
    expect(workflow).toContain("insert into discovery_observation_demand_signals");
    expect(workflow).not.toMatch(/update company_resolution_audits|delete from company_resolution_audits/i);
  });
  it("guards company creation and review repetition with deterministic locks and lookup",async()=>{
    const workflow=await source("src/server/discovery-review/discovery-review-workflow.ts");
    expect(workflow).toContain("discovery-company-review:");
    expect(workflow).toContain("normalized_common_name=$1");
    expect(workflow).toContain("replayed: true");
  });
  it("prevents duplicate demand and junction creation",async()=>{
    const workflow=await source("src/server/discovery-review/discovery-review-workflow.ts");
    expect(workflow).toContain("discovery-demand-review:");
    expect(workflow).toContain("select demand_signal_id from discovery_observation_demand_signals");
    expect(workflow).toContain("discovery-observation:");
  });
  it("keeps promotion separate and reuses an existing promoted opportunity",async()=>{
    const actions=await source("src/server/discovery-review/actions.ts");
    expect(actions).toContain("if(item.opportunity_id)return item.opportunity_id");
    expect(actions).toContain("new OpportunityService(new PostgresOpportunityRepository(client)).create");
    expect(actions).not.toMatch(/recordDemandReview[\s\S]{0,300}OpportunityService/);
  });
  it("requires explicit UI confirmation for interpretive actions",async()=>{
    const ui=await source("src/components/discovery-review/discovery-review-workbench.tsx");
    expect(ui.match(/type=\"checkbox\" required/g)).toHaveLength(3);
    expect(ui).toContain("Aggregate source count — not confirmed employer headcount.");
  });
  it("surfaces Contact Intelligence without inferring authority or running research",async()=>{
    const ui=await source("src/components/discovery-review/discovery-review-workbench.tsx");
    expect(ui).toContain("Contact Intelligence");expect(ui).toContain("NOT YET AVAILABLE");
    const actions=await source("src/server/discovery-review/actions.ts");expect(actions).not.toMatch(/Brave|providerStatuses|buyer authority/i);
  });
  it("updates the queue from persisted company and demand decisions",async()=>{
    const readModel=await source("src/server/discovery-intelligence/get-discovery-intelligence.ts");
    expect(readModel).toContain("company_review_outcome");expect(readModel).toContain("demand_review_decision");expect(readModel).toContain("DEMAND REVIEW REQUIRED");expect(readModel).toContain("DEMAND VERIFIED");
  });
  it("resolves a queue candidate through canonical candidate → observation → run lineage",async()=>{
    const candidateId="11111111-1111-4111-8111-111111111111",observationId="22222222-2222-4222-8222-222222222222";
    const client:SqlClient={query:async<T>(sql:string)=>({rows:(sql.includes("from discovery_watch_observations o")?[{observation_id:observationId,candidate_id:candidateId,title:"$31-$58/hr Electrician jobs",description:"Northstar Electric is currently hiring apprentice electricians in El Paso",normalized_url:"https://example.test/job",source_domain:"example.test",source_id:"33333333-3333-4333-8333-333333333333",evidence_id:null,observed_company:null,observation_identity:"synthetic-identity",observation_state:"NEW",source_type:"OTHER_APPROVED_PUBLIC_SOURCE",platform:null,health_status:"HEALTHY",first_seen_at:"2026-01-01T00:00:00Z",last_seen_at:"2026-01-02T00:00:00Z",published_at:null,metadata:{}}]:[]) as T[]})};
    const review=await loadDiscoveryReviewCase(client,candidateId);
    expect(review).toMatchObject({candidateId,observationId,observedCompany:"Northstar Electric",profession:"ELECTRICAL",level:"APPRENTICE"});
    expect(review?.quantity.type).toBe("NOT_A_WORKFORCE_QUANTITY");
  });
  it("routes the queue candidate into the existing contextual page and mounts the workbench",async()=>{
    const queue=await source("src/app/radar/intelligence/page.tsx"),detail=await source("src/app/radar/[id]/page.tsx"),workflow=await source("src/server/discovery-review/discovery-review-workflow.ts");
    expect(queue).toContain('href={`/radar/${item.candidateId}`}');
    expect(detail).toContain("loadDiscoveryReviewCase(client, s.candidateId)");
    expect(detail).toContain("<DiscoveryReviewWorkbench review={phase13Review} locale={locale}");
    expect(workflow).toContain("join company_discovery_runs r on r.id=c.run_id");
    expect(workflow).not.toContain("c.target_text");expect(workflow).not.toContain("c.correlation_metadata");
  });
  it("disables legacy mutation controls only for governed Phase 1.3 cases",async()=>{
    const detail=await source("src/app/radar/[id]/page.tsx");
    expect(detail).toContain("phase13Review ?");expect(detail).toContain("legacy signal-verification controls are disabled");
    expect(detail).toContain(': s.status === "PROMOTED"');expect(detail).toContain("<SignalReviewForm");
    expect(detail).toContain("can be promoted only from the Phase 1.3 workbench");
  });
  it("preserves buyer authority and external manpower acceptance as unknown",async()=>{
    const workflow=await source("src/server/discovery-review/discovery-review-workflow.ts");
    expect(workflow).not.toMatch(/buyer_authority|manpower_acceptance_evaluations|external_manpower/i);
  });
});
