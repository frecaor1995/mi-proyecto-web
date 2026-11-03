import{describe,expect,it}from"vitest";
import type{OpportunityGraph}from"../../domain/opportunity";
import type{ActionabilityInput}from"../../domain/opportunity-actionability";
import{NO_ACTIONABILITY_EVIDENCE,OPEN_COMPATIBLE_STATES}from"../../domain/opportunity-actionability";
import{assessActionability,gatedCommercialActionForGraph,gatedCommercialActionForOpportunity,radarActionabilityMetrics,REAL_ACTIONABILITY_EVIDENCE}from"../../server/services/opportunity-actionability/opportunity-actionability-service";
import{qualificationDossiers,qualificationSeed}from"../../server/services/opportunity-qualification/opportunity-qualification-service";
import{aggregatedCandidates}from"../../server/services/evidence-aggregation/evidence-aggregation-service";

/**
 * Phase 2O. Proves EVIDENCE_FRESHNESS and OPPORTUNITY_ACTIONABILITY are genuinely
 * distinct concepts, that the actionability gate never rewrites the real, unmodified
 * CommercialActionService recommendation, and that every real tracked opportunity
 * (Port Arthur, Permian/Strike) evaluates honestly against whatever evidence the
 * codebase actually captured -- not a fabricated scenario. Trillium Amarillo has no
 * `opportunityId` in any real fact (confirmed by audit), so it is tested directly
 * against assessActionability() rather than through a non-existent Seed.
 */

const asOf=new Date("2026-08-23T12:00:00Z");
const opp=(id:string,overrides:Partial<ActionabilityInput>={}):ActionabilityInput=>({...NO_ACTIONABILITY_EVIDENCE(id),...overrides});

describe("assessActionability: state vocabulary",()=>{
  it("no evidence at all -> UNKNOWN, and UNKNOWN is not open-compatible",()=>{
    const r=assessActionability(opp("x"),asOf);
    expect(r.state).toBe("UNKNOWN");
    expect(OPEN_COMPATIBLE_STATES.has(r.state)).toBe(false);
  });
  it("a page/source being unreachable is never itself evidence: absence still resolves to UNKNOWN, never EXPIRED or CLOSED",()=>{
    // NO_ACTIONABILITY_EVIDENCE is exactly what a 404/unreachable capture produces --
    // this service has no input path that accepts "fetch failed" as status evidence.
    const r=assessActionability(NO_ACTIONABILITY_EVIDENCE("unreachable-source"),asOf);
    expect(r.state).toBe("UNKNOWN");
  });
  it("future deadline -> OPEN",()=>{
    const r=assessActionability(opp("x",{deadlines:[{kind:"ORIGINAL",date:new Date("2026-12-01T00:00:00Z"),observedAt:asOf,evidenceIds:["evidence:deadline"]}]}),asOf);
    expect(r.state).toBe("OPEN");
    expect(r.governingDeadline?.date).toEqual(new Date("2026-12-01T00:00:00Z"));
  });
  it("deadline within the closing-soon window -> CLOSING_SOON",()=>{
    const r=assessActionability(opp("x",{deadlines:[{kind:"ORIGINAL",date:new Date("2026-08-25T00:00:00Z"),observedAt:asOf,evidenceIds:["evidence:deadline"]}]}),asOf);
    expect(r.state).toBe("CLOSING_SOON");
  });
  it("deadline already passed -> EXPIRED",()=>{
    const r=assessActionability(opp("x",{deadlines:[{kind:"ORIGINAL",date:new Date("2026-08-01T00:00:00Z"),observedAt:asOf,evidenceIds:["evidence:deadline"]}]}),asOf);
    expect(r.state).toBe("EXPIRED");
    expect(r.blockers).toContain("DEADLINE_PASSED");
  });
  it("start date in the future -> OPENING_SOON",()=>{
    const r=assessActionability(opp("x",{startDate:new Date("2026-09-01T00:00:00Z")}),asOf);
    expect(r.state).toBe("OPENING_SOON");
  });
  it.each(["CLOSED","AWARDED","CANCELLED","TERMINATED"]as const)("explicit %s status wins outright, even against a far-future deadline",(status)=>{
    const r=assessActionability(opp("x",{explicitStatus:status,deadlines:[{kind:"ORIGINAL",date:new Date("2027-01-01T00:00:00Z"),observedAt:asOf,evidenceIds:["evidence:deadline"]}]}),asOf);
    expect(r.state).toBe(status);
  });
  it("explicit OPEN status past its own freshness window, with no deadline to re-derive from -> STALE_STATUS, not assumed open",()=>{
    const r=assessActionability(opp("x",{explicitStatus:"OPEN",explicitStatusFreshUntil:new Date("2026-08-01T00:00:00Z")}),asOf);
    expect(r.state).toBe("STALE_STATUS");
  });
});

describe("assessActionability: amendment / historical asOf reconstruction",()=>{
  const original={kind:"ORIGINAL"as const,date:new Date("2026-08-20T00:00:00Z"),observedAt:new Date("2026-08-01T00:00:00Z"),evidenceIds:["evidence:original-deadline"]};
  const amendment={kind:"AMENDMENT"as const,date:new Date("2026-09-15T00:00:00Z"),observedAt:new Date("2026-08-15T00:00:00Z"),evidenceIds:["evidence:amendment"]};
  const input=opp("amended-rfp",{deadlines:[original,amendment]});

  it("latest-observed deadline governs, and the earlier one is preserved (never destroyed) as superseded",()=>{
    const r=assessActionability(input,asOf);
    expect(r.governingDeadline).toEqual({date:amendment.date,kind:"AMENDMENT",evidenceIds:amendment.evidenceIds});
    expect(r.supersededDeadlines).toEqual([{date:original.date,kind:"ORIGINAL",evidenceIds:original.evidenceIds}]);
    expect(r.state).toBe("OPEN");
  });
  it("historical asOf before the amendment was observed sees only the original deadline -- later evidence does not rewrite the past",()=>{
    const beforeAmendmentObserved=new Date("2026-08-10T00:00:00Z");
    const r=assessActionability(input,beforeAmendmentObserved);
    expect(r.governingDeadline).toEqual({date:original.date,kind:"ORIGINAL",evidenceIds:original.evidenceIds});
    expect(r.supersededDeadlines).toEqual([]);
  });
  it("asOf before vs. after the same deadline is the only thing that changes state -- assessActionability is a pure function of asOf",()=>{
    const before=assessActionability(input,new Date("2026-09-01T00:00:00Z"));
    const after=assessActionability(input,new Date("2026-10-01T00:00:00Z"));
    expect(before.state).toBe("OPEN");
    expect(after.state).toBe("EXPIRED");
  });
});

describe("evidence freshness vs. actionability are independent axes",()=>{
  it("the same ActionabilityInput evaluated at two asOf dates straddling an unrelated evidence staleAfter cutoff produces the same actionability state -- staleAfter/freshUntil never enters this function",()=>{
    const staleAfterCutoff=new Date("2026-09-20T00:00:00Z"); // qual-permian's own staleAfter, unrelated to this input
    const input=opp("x",{explicitStatus:"OPEN"});
    const beforeCutoff=assessActionability(input,new Date("2026-09-01T00:00:00Z"));
    const afterCutoff=assessActionability(input,new Date("2026-09-25T00:00:00Z"));
    expect(beforeCutoff.state).toBe(afterCutoff.state);
    expect(staleAfterCutoff.getTime()).toBeGreaterThan(0); // documents which cutoff this test straddles
  });
});

describe("gatedCommercialActionForGraph: the gate never rewrites the underlying recommendation",()=>{
  const activeEligibleGraph:OpportunityGraph={
    opportunity:{id:"synthetic-active",identityKey:"synthetic-active",projectId:null,unresolvedCompanyContext:null,title:"Synthetic active-eligible fixture",lifecycle:"ACTIVE",firstSeenAt:asOf,lastSeenAt:asOf,staleAfter:new Date("2026-12-01T00:00:00Z"),verificationDueAt:null,metadata:{}},
    demandSignals:[{id:"synthetic-active:demand",raw_evidence_id:"evidence:synthetic-active",stale_after:new Date("2026-12-01T00:00:00Z")}],
    claims:[],
    companies:[{id:"synthetic-active:company",name:"Synthetic Co"}],
    companyRoles:[],
    project:null,
    acceptance:{id:"synthetic-active:acceptance",result:"VERIFIED",valid_until:new Date("2026-12-01T00:00:00Z")},
    vendorRoutes:[],
    contactPeople:[],
    contactRoutes:[{id:"synthetic-active:route",route_type:"PROFESSIONAL_PHONE",verification_state:"VERIFIED",lifecycle:"ACTIVE",stale_after:new Date("2026-12-01T00:00:00Z")}],
    routeGrades:[{id:"synthetic-active:grade",contact_route_id:"synthetic-active:route",grade:"A"}],
    evidence:[{id:"evidence:synthetic-active"}],
    verificationReviews:[],
    gaps:[],
    conflicts:[],
    asOf,
    descriptiveOnly:true,
  };

  it("active eligible + OPEN actionability -> gate ACTIVE, active recommendation surfaces, counted as active HOT-A and HOT-B",()=>{
    const r=gatedCommercialActionForGraph(activeEligibleGraph,opp("synthetic-active",{explicitStatus:"OPEN"}),asOf);
    expect(r.underlyingAction).toBe("CALL_TODAY");
    expect(r.gate).toBe("ACTIVE");
    expect(r.activeRecommendation).toBe("CALL_TODAY");
    expect(r.countsAsActiveHotA).toBe(true);
    expect(r.countsAsActiveHotB).toBe(true);
  });
  it("technically eligible but EXPIRED -> underlyingAction is UNCHANGED (still CALL_TODAY), but gate blocks it and it is not counted as an active HOT lead",()=>{
    const r=gatedCommercialActionForGraph(activeEligibleGraph,opp("synthetic-active",{deadlines:[{kind:"ORIGINAL",date:new Date("2026-08-01T00:00:00Z"),observedAt:asOf,evidenceIds:["evidence:deadline"]}]}),asOf);
    expect(r.underlyingAction).toBe("CALL_TODAY");
    expect(r.actionability.state).toBe("EXPIRED");
    expect(r.gate).toBe("BLOCKED_BY_ACTIONABILITY");
    expect(r.activeRecommendation).toBe("TECHNICALLY_ELIGIBLE_BUT_NOT_CURRENTLY_ACTIONABLE");
    expect(r.countsAsActiveHotA).toBe(false);
    expect(r.countsAsActiveHotB).toBe(false);
  });
  it("technically eligible but UNKNOWN actionability is blocked the same way -- unknown is never treated as open",()=>{
    const r=gatedCommercialActionForGraph(activeEligibleGraph,NO_ACTIONABILITY_EVIDENCE("synthetic-active"),asOf);
    expect(r.underlyingAction).toBe("CALL_TODAY");
    expect(r.gate).toBe("BLOCKED_BY_ACTIONABILITY");
    expect(r.countsAsActiveHotA).toBe(false);
  });
});

describe("real production data: Port of Port Arthur RFP 2026-01 (qual-beaumont-port-arthur)",()=>{
  it("Phase 2Q: a scoped re-verification of the same already-approved RFP PDF surfaced a real, explicit submission deadline (4/22/26 2:00 PM) that Phase 2H's original capture did not extract -- REAL_ACTIONABILITY_EVIDENCE now carries it",()=>{
    const input=REAL_ACTIONABILITY_EVIDENCE["qual-beaumont-port-arthur"];
    expect(input.explicitStatus).toBeNull();
    expect(input.deadlines).toHaveLength(1);
    expect(input.deadlines[0].date).toEqual(new Date("2026-04-22T19:00:00Z"));
    expect(input.deadlines[0].evidenceIds).toEqual(["evidence:port-arthur-rfp-2026-01-2q-reverify"]);
  });
  it("historical asOf correctness: evaluated at this file's default asOf (2026-08-23), BEFORE the Phase 2Q re-verification was even observed (2026-08-27), the deadline evidence is correctly invisible and actionability is still UNKNOWN -- later evidence does not rewrite the past",()=>{
    const r=gatedCommercialActionForOpportunity("qual-beaumont-port-arthur");
    expect(r?.actionability.state).toBe("UNKNOWN");
  });
  it("evaluated at or after the Phase 2Q observation date, actionability honestly flips to EXPIRED given the real deadline evidence -- this is a finding from real re-verification, not an assumption",()=>{
    const todayOrLater=new Date("2026-08-27T12:00:00Z");
    const r=gatedCommercialActionForOpportunity("qual-beaumont-port-arthur",REAL_ACTIONABILITY_EVIDENCE["qual-beaumont-port-arthur"],todayOrLater);
    expect(r?.actionability.state).toBe("EXPIRED");
    expect(r?.actionability.governingDeadline?.date).toEqual(new Date("2026-04-22T19:00:00Z"));
  });
  it("today's real underlying commercial action for Port Arthur is STILL RESOLVE_CONFLICT (an internal action, driven by the unresolved ExxonMobil/Port-of-Port-Arthur identity conflict, which is checked before actionability) -- the new EXPIRED finding changes the temporal classification but not the recommendation, since it was never going to surface as an active external one anyway",()=>{
    const r=gatedCommercialActionForOpportunity("qual-beaumont-port-arthur");
    expect(r?.underlyingAction).toBe("RESOLVE_CONFLICT");
    expect(r?.gate).toBe("NOT_ACTIVE_EXTERNAL");
    expect(r?.activeRecommendation).toBe("RESOLVE_CONFLICT");
  });
  it("historical evidence (buyer candidate, AF-01 candidate, contact route, provenance) is completely untouched by actionability evaluation -- this module never writes to Seed",()=>{
    const before=qualificationSeed("qual-beaumont-port-arthur");
    gatedCommercialActionForOpportunity("qual-beaumont-port-arthur");
    gatedCommercialActionForOpportunity("qual-beaumont-port-arthur",{opportunityId:"qual-beaumont-port-arthur",explicitStatus:"CLOSED",explicitStatusFreshUntil:null,deadlines:[],startDate:null,evidenceIds:[]});
    const after=qualificationSeed("qual-beaumont-port-arthur");
    expect(after).toEqual(before);
    expect(after?.buyerCandidate).toBe("Port of Port Arthur");
    expect(after?.af01Candidate).toBe("participation in contracting");
  });
});

describe("real production data: Trillium Amarillo (Phase 2Q: now a real tracked opportunity, qual-amarillo)",()=>{
  it("gatedCommercialActionForOpportunity returns a real result now that qual-amarillo is tracked",()=>{
    expect(gatedCommercialActionForOpportunity("qual-amarillo")).toBeDefined();
  });
  it("gatedCommercialActionForOpportunity still returns undefined for a genuinely untracked opportunity id",()=>{
    expect(gatedCommercialActionForOpportunity("qual-does-not-exist")).toBeUndefined();
  });
  it("evaluated directly, real Trillium Amarillo evidence (no posting-status field, no deadline field in EvidenceFact, and a live re-check today confirms both postings are current but states no explicit OPEN/closed status) yields UNKNOWN -- uncertain posting currentness is reported honestly rather than fabricated as open",()=>{
    const r=assessActionability(NO_ACTIONABILITY_EVIDENCE("trillium-amarillo-journeyman-791374"),asOf);
    expect(r.state).toBe("UNKNOWN");
  });
  it("qual-amarillo's real actionability is UNKNOWN, matching the direct-evidence check above",()=>{
    expect(gatedCommercialActionForOpportunity("qual-amarillo")?.actionability.state).toBe("UNKNOWN");
  });
});

describe("real production data: Strike Midland (qual-permian) -- demand-only adversarial case",()=>{
  it("actionability alone does not upgrade a weak lead: qual-permian's real underlying action stays VERIFY_MANPOWER_ACCEPTANCE (internal) whether actionability is UNKNOWN or explicitly OPEN",()=>{
    const unknown=gatedCommercialActionForOpportunity("qual-permian");
    const open=gatedCommercialActionForOpportunity("qual-permian",{opportunityId:"qual-permian",explicitStatus:"OPEN",explicitStatusFreshUntil:null,deadlines:[],startDate:null,evidenceIds:[]});
    expect(unknown?.underlyingAction).toBe("VERIFY_MANPOWER_ACCEPTANCE");
    expect(open?.underlyingAction).toBe("VERIFY_MANPOWER_ACCEPTANCE");
    expect(unknown?.gate).toBe("NOT_ACTIVE_EXTERNAL");
    expect(open?.gate).toBe("NOT_ACTIVE_EXTERNAL");
  });
  it("no buyer/AF-01 is fabricated by this module: qual-permian's real dossier still reports buyer MISSING and AF-01 MISSING",()=>{
    const dossier=qualificationDossiers().find(d=>d.id==="qual-permian")!;
    gatedCommercialActionForOpportunity("qual-permian");
    expect(dossier.buyerVerificationStatus).toBe("MISSING");
    expect(dossier.af01VerificationState).toBe("MISSING");
  });
});

describe("metrics separation across every real tracked opportunity",()=>{
  it("radarActionabilityMetrics reports the honest current baseline at this file's historical asOf (2026-08-23, before the Phase 2Q Port Arthur re-verification was observed): all five tracked opportunities are UNKNOWN actionability, and zero are counted as active HOT leads (none are currently eligible for anything anyway)",()=>{
    const m=radarActionabilityMetrics(asOf);
    expect(m.byState).toEqual({UNKNOWN:5});
    expect(m.activeHotA).toBe(0);
    expect(m.activeHotB).toBe(0);
    expect(m.technicallyEligibleButInactive).toBe(0);
    expect(m.eligibleOpportunities).toEqual({VAMO_ELIGIBLE:0,HOT_A_ELIGIBLE:0,HOT_B_ELIGIBLE:0});
  });
  it("repeated metric computation is deterministic and never mutates real production dossiers or candidates",()=>{
    const dossiersBefore=JSON.stringify(qualificationDossiers());
    const candidatesBefore=JSON.stringify(aggregatedCandidates());
    const first=radarActionabilityMetrics(asOf);
    for(let i=0;i<5;i++)radarActionabilityMetrics(asOf);
    const second=radarActionabilityMetrics(asOf);
    expect(second).toEqual(first);
    expect(JSON.stringify(qualificationDossiers())).toBe(dossiersBefore);
    expect(JSON.stringify(aggregatedCandidates())).toBe(candidatesBefore);
  });
});

describe("no policy drift",()=>{
  it("every real tracked opportunity still resolves through the real, unmodified qualificationDossiers() pipeline (eligibility/scoring rules untouched by this phase)",()=>{
    const ids=qualificationDossiers().map(d=>d.id).sort();
    expect(ids).toEqual(["qual-amarillo","qual-beaumont-port-arthur","qual-corpus","qual-freeport","qual-permian"]);
  });
});
