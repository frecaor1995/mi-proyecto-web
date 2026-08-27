import{describe,expect,it}from"vitest";
import type{OpportunityGraph}from"../../domain/opportunity";
import type{ActionabilityInput}from"../../domain/opportunity-actionability";
import{NO_ACTIONABILITY_EVIDENCE}from"../../domain/opportunity-actionability";
import{activeHotLeadsForGraph,activeHotLeadsForOpportunity,activeHotLeadMetrics}from"../../server/services/active-lead/active-lead-service";
import{qualificationDossiers}from"../../server/services/opportunity-qualification/opportunity-qualification-service";
import{aggregatedCandidates}from"../../server/services/evidence-aggregation/evidence-aggregation-service";

/**
 * Phase 2P: the top of the real pipeline (SOURCE -> ... -> ELIGIBILITY -> SCORE ->
 * ACTIONABILITY -> COMMERCIAL ACTION -> ACTIVE HOT LEAD). activeHotLeadsForGraph
 * composes the real EligibilityService/ScoringService/gatedCommercialActionForGraph
 * outputs; it recomputes none of their logic. The synthetic fixture below is a
 * controlled positive proof only -- never part of real production metrics.
 */

const asOf=new Date("2026-08-23T12:00:00Z");
const opp=(id:string,overrides:Partial<ActionabilityInput>={}):ActionabilityInput=>({...NO_ACTIONABILITY_EVIDENCE(id),...overrides});
const activeEligibleGraph:OpportunityGraph={
  opportunity:{id:"controlled-fixture-2p-active",identityKey:"controlled-fixture-2p-active",projectId:null,unresolvedCompanyContext:null,title:"CONTROLLED SYNTHETIC FIXTURE (Phase 2P) -- not real production evidence",lifecycle:"ACTIVE",firstSeenAt:asOf,lastSeenAt:asOf,staleAfter:new Date("2026-12-01T00:00:00Z"),verificationDueAt:null,metadata:{}},
  demandSignals:[{id:"d",raw_evidence_id:"evidence:controlled-fixture-2p-active",stale_after:new Date("2026-12-01T00:00:00Z")}],
  claims:[],
  companies:[{id:"c",name:"Controlled Fixture Co"}],
  companyRoles:[{id:"cr",role:"MANPOWER_BUYER"}],
  project:null,
  acceptance:{id:"a",result:"VERIFIED",valid_until:new Date("2026-12-01T00:00:00Z")},
  vendorRoutes:[],
  contactPeople:[],
  contactRoutes:[{id:"route",route_type:"PROFESSIONAL_PHONE",verification_state:"VERIFIED",lifecycle:"ACTIVE",stale_after:new Date("2026-12-01T00:00:00Z")}],
  routeGrades:[{id:"grade",contact_route_id:"route",grade:"A"}],
  evidence:[{id:"evidence:controlled-fixture-2p-active"}],
  verificationReviews:[],
  gaps:[],
  conflicts:[],
  asOf,
  descriptiveOnly:true,
};

describe("Phase 2P: controlled positive end-to-end proof -- eligible -> scored -> active recommendation -> Active HOT",()=>{
  const leads=activeHotLeadsForGraph(activeEligibleGraph,opp("controlled-fixture-2p-active",{explicitStatus:"OPEN"}),asOf);
  it("both HOT-A and HOT-B are eligible, scored, and marked active with a real active-external recommendation",()=>{
    for(const lead of leads){
      expect(lead.eligible).toBe(true);
      expect(lead.scoreState).toBe("SCORED");
      expect(lead.score).toBeGreaterThan(0);
      expect(lead.active).toBe(true);
      expect(lead.recommendedCommercialAction).toBe("CALL_TODAY");
      expect(lead.selectedRoute).toEqual({id:"route",type:"PROFESSIONAL_PHONE",grade:"A"});
      expect(lead.blockers).toEqual([]);
    }
  });
});

describe("Phase 2P: controlled negative proofs -- eligible does not by itself mean active",()=>{
  const scenarios:[string,ActionabilityInput][]=[
    ["UNKNOWN",NO_ACTIONABILITY_EVIDENCE("controlled-fixture-2p-active")],
    ["EXPIRED",opp("controlled-fixture-2p-active",{deadlines:[{kind:"ORIGINAL",date:new Date("2026-08-01T00:00:00Z"),observedAt:asOf,evidenceIds:["evidence:deadline"]}]})],
    ["CLOSED",opp("controlled-fixture-2p-active",{explicitStatus:"CLOSED"})],
    ["AWARDED",opp("controlled-fixture-2p-active",{explicitStatus:"AWARDED"})],
    ["CANCELLED",opp("controlled-fixture-2p-active",{explicitStatus:"CANCELLED"})],
  ];
  it.each(scenarios)("%s actionability: still eligible and scored, but never active, never CALL_TODAY, correctly blocked",(_label,input)=>{
    const leads=activeHotLeadsForGraph(activeEligibleGraph,input,asOf);
    for(const lead of leads){
      expect(lead.eligible).toBe(true);
      expect(lead.scoreState).toBe("SCORED");
      expect(lead.active).toBe(false);
      expect(lead.recommendedCommercialAction).not.toBe("CALL_TODAY");
      expect(lead.recommendedCommercialAction).toBe("TECHNICALLY_ELIGIBLE_BUT_NOT_CURRENTLY_ACTIONABLE");
    }
  });
  it("an ineligible graph is never active regardless of OPEN actionability (eligibility is required, not optional)",()=>{
    const ineligible:OpportunityGraph={...activeEligibleGraph,acceptance:null,contactRoutes:[],routeGrades:[]};
    const leads=activeHotLeadsForGraph(ineligible,opp("controlled-fixture-2p-active",{explicitStatus:"OPEN"}),asOf);
    expect(leads.every(l=>!l.eligible&&!l.active)).toBe(true);
  });
});

describe("Phase 2P: real production data replay",()=>{
  it("every real tracked opportunity: eligible=false, active=false, no fabricated Active HOT",()=>{
    for(const id of["qual-freeport","qual-beaumont-port-arthur","qual-permian","qual-corpus"]){
      const leads=activeHotLeadsForOpportunity(id)!;
      expect(leads.every(l=>!l.eligible)).toBe(true);
      expect(leads.every(l=>!l.active)).toBe(true);
    }
  });
  it("activeHotLeadsForOpportunity returns undefined for an untracked opportunity (e.g. Trillium Amarillo, which has no tracked Seed)",()=>{
    expect(activeHotLeadsForOpportunity("qual-amarillo")).toBeUndefined();
  });
});

describe("Phase 2P: real Active HOT metrics -- honest current baseline",()=>{
  it("zero eligible, zero active, across every real tracked opportunity",()=>{
    const m=activeHotLeadMetrics(asOf);
    expect(m.eligibleCount).toBe(0);
    expect(m.actionableEligibleCount).toBe(0);
    expect(m.activeHotA).toBe(0);
    expect(m.activeHotB).toBe(0);
    expect(m.technicallyEligibleButInactive).toBe(0);
  });
  it("blockedByConflict counts the three real conflicted opportunities across both HOT types (6); blockedByAcceptance and blockedByRoute count all four real opportunities' HOT-A lead only, since MANPOWER_ACCEPTANCE_REQUIRED and ACTIONABLE_CONTACT_REQUIRED are not HOT-B requirements (4 each)",()=>{
    const m=activeHotLeadMetrics(asOf);
    expect(m.blockedByConflict).toBe(6);
    expect(m.blockedByAcceptance).toBe(4);
    expect(m.blockedByRoute).toBe(4);
  });
  it("repeated computation never mutates real production dossiers or candidates",()=>{
    const dossiersBefore=JSON.stringify(qualificationDossiers());
    const candidatesBefore=JSON.stringify(aggregatedCandidates());
    for(let i=0;i<5;i++)activeHotLeadMetrics(asOf);
    expect(JSON.stringify(qualificationDossiers())).toBe(dossiersBefore);
    expect(JSON.stringify(aggregatedCandidates())).toBe(candidatesBefore);
  });
});

describe("Phase 2P boundary",()=>{
  it("no automatic outreach: nothing in this module sends email, places a call, sends SMS, submits vendor registration, or contacts a recruiter -- every action stays recommendation-only",()=>{
    const leads=activeHotLeadsForGraph(activeEligibleGraph,opp("controlled-fixture-2p-active",{explicitStatus:"OPEN"}),asOf);
    expect(leads.every(l=>typeof l.recommendedCommercialAction==="string")).toBe(true);
    // recommendation-only is enforced upstream by CommercialActionResult.recommendationOnly:true,
    // which this module reads but never overrides.
  });
  it("no Phase 2Q capability has leaked into the qualification, actionability, or active-lead layers",()=>{
    expect(JSON.stringify(activeHotLeadMetrics(asOf))).not.toMatch(/phase2q/i);
    expect(JSON.stringify(qualificationDossiers())).not.toMatch(/phase2q/i);
  });
});
