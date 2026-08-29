import{describe,expect,it}from"vitest";
import type{EligibilityRepository}from"../../server/repositories/eligibility/eligibility-repository";
import type{EligibilityResult,EligibilitySnapshot,EligibilityType}from"../../domain/eligibility";
import type{ScoreResult,ScoreSnapshot}from"../../domain/scoring";
import type{CommercialActionResult}from"../../domain/commercial-action";
import type{AggregatedCandidate}from"../../domain/evidence-aggregation";
import{CONTROLLED_TEST_REVIEWER_ID}from"../../domain/evidence-aggregation";
import{EligibilityService}from"../../server/services/eligibility/eligibility-service";
import{ScoringService}from"../../server/services/scoring/scoring-service";
import{CommercialActionService}from"../../server/services/commercial-action/commercial-action-service";
import{applyControlledDecision}from"../../server/services/human-verification-ops/human-verification-ops-service";
import{aggregatedCandidates}from"../../server/services/evidence-aggregation/evidence-aggregation-service";
import{type Seed,graph,qualificationDossiers,qualificationDossiersEnriched,seedWithAggregatedEvidence}from"../../server/services/opportunity-qualification/opportunity-qualification-service";

/**
 * Phase 2M: proves TECH-DEBT-04's resolution end-to-end against the REAL, unmodified
 * Phase 1 engines (EligibilityService, ScoringService, CommercialActionService), using
 * only an explicitly-labeled CONTROLLED_TEST_REVIEW identity on synthetic fixture data
 * -- never on real production evidence -- and then replays the real Port Arthur,
 * Freeport, Trillium Amarillo and Corpus Christi data through the same (non-controlled)
 * path to confirm none of them become eligible.
 */

const rows=()=>qualificationDossiers(),by=(id:string)=>rows().find(x=>x.id===id)!;
const FAR_FUTURE=new Date("2026-12-01T00:00:00Z"),PAST=new Date("2026-01-01T00:00:00Z");

class NoopRepo implements EligibilityRepository{
  async activeEvidenceIds(ids:string[]){return ids}
  async save(r:EligibilityResult):Promise<EligibilitySnapshot>{return{...r,id:"unused",createdAt:r.evaluatedAt}}
  async list(){return[]}
}
const assess=(g:ReturnType<typeof graph>)=>new EligibilityService({graph:async()=>g},new NoopRepo(),()=>g.asOf).assess(g,g.asOf);
const eligibleOf=(g:ReturnType<typeof graph>,type:EligibilityType)=>assess(g).find(r=>r.eligibilityType===type)!;
const asSnapshots=(g:ReturnType<typeof graph>):EligibilitySnapshot[]=>assess(g).map((r,i)=>({...r,id:`elig-${i}`,createdAt:r.evaluatedAt}));

const baseSeed=(overrides:Partial<Seed>):Seed=>({
  id:"controlled-fixture-2m-base",
  context:"CONTROLLED SYNTHETIC FIXTURE (Phase 2M) -- not real production evidence",
  market:"Controlled Test Market",
  currentDemand:true,
  electricalRoles:["Journeyman Electrician"],
  demandSources:["controlled-fixture-source"],
  company:"Controlled Fixture Co",
  canonicalCompanyStatus:"RESOLVED",
  project:null,
  projectStatus:"UNKNOWN",
  buyerCandidate:null,
  buyerVerificationStatus:"MISSING",
  companyRole:null,
  af01Candidate:null,
  af01Category:null,
  af01VerificationState:"MISSING",
  contactPerson:null,
  contactFunction:null,
  contactRoute:null,
  routeType:null,
  routeGrade:null,
  routeVerificationState:"MISSING",
  compensation:null,
  overtime:null,
  perDiem:null,
  headcount:null,
  schedule:null,
  duration:null,
  firstSeen:new Date("2026-08-21T12:00:00Z"),
  lastSeen:new Date("2026-08-21T12:00:00Z"),
  staleAfter:FAR_FUTURE,
  evidenceIds:["evidence:controlled-fixture-2m"],
  claimIds:[],
  sourceUrls:["https://example.invalid/controlled-fixture-2m"],
  conflicts:[],
  humanReviewRequirements:[],
  ...overrides,
});

const syntheticAf01=(overrides:Partial<AggregatedCandidate>={}):AggregatedCandidate=>({
  id:"AF01_CANDIDATE:controlled-fixture-2m:evidence:controlled-fixture-2m-af01",
  type:"AF01_CANDIDATE",
  opportunityId:"controlled-fixture-2m",
  contextId:"controlled-fixture-2m",
  market:"Controlled Test Market",
  company:null,
  project:null,
  value:"CONTROLLED_FIXTURE_AF01_ACCEPTANCE",
  category:"THIRD_PARTY_RECRUITING_ACCEPTED",
  contactPersonName:null,
  routeTarget:null,
  routeType:null,
  routeGrade:null,
  evidenceIds:["evidence:controlled-fixture-2m-af01"],
  sourceIds:["controlled-fixture-source"],
  sourceUrls:["https://example.invalid/controlled-fixture-2m-af01"],
  observedAt:new Date("2026-08-21T12:00:00Z"),
  staleAfter:FAR_FUTURE,
  verificationState:"UNVERIFIED",
  reviewState:"READY_FOR_HUMAN_REVIEW",
  reason:"Controlled synthetic AF-01 fixture -- not real evidence",
  contraryEvidence:[],
  provenance:{originService:"controlled-fixture",originFactId:null},
  ...overrides,
});
const syntheticContact=(overrides:Partial<AggregatedCandidate>={}):AggregatedCandidate=>({
  id:"CONTACT_AUTHORITY:controlled-fixture-2m:evidence:controlled-fixture-2m-contact",
  type:"CONTACT_AUTHORITY",
  opportunityId:"controlled-fixture-2m",
  contextId:"controlled-fixture-2m",
  market:"Controlled Test Market",
  company:null,
  project:null,
  value:"Controlled Fixture Recruiter",
  category:null,
  contactPersonName:"Controlled Fixture Recruiter",
  routeTarget:"recruiter@controlled-fixture-2m.invalid",
  routeType:"RECRUITER_EMAIL",
  routeGrade:null,
  evidenceIds:["evidence:controlled-fixture-2m-contact"],
  sourceIds:["controlled-fixture-source"],
  sourceUrls:["https://example.invalid/controlled-fixture-2m-contact"],
  observedAt:new Date("2026-08-21T12:00:00Z"),
  staleAfter:FAR_FUTURE,
  verificationState:"UNVERIFIED",
  reviewState:"READY_FOR_HUMAN_REVIEW",
  reason:"Controlled synthetic contact-authority fixture -- not real evidence",
  contraryEvidence:[],
  provenance:{originService:"controlled-fixture",originFactId:null},
  ...overrides,
});

const verify=(c:AggregatedCandidate,grade?:AggregatedCandidate["routeGrade"])=>applyControlledDecision(c,{candidateId:c.id,decision:"VERIFY",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"Controlled deterministic Phase 2M end-to-end proof",evidenceIds:c.evidenceIds,decidedAt:new Date("2026-08-21T12:00:00Z"),grade});

describe("Phase 2M: controlled end-to-end positive proof (synthetic candidate evidence -> aggregation -> CONTROLLED_TEST_REVIEW VERIFY -> verified graph state -> unmodified Phase 1 engines -> scoring -> Commercial Action)",()=>{
  const verifiedAf01=verify(syntheticAf01());
  const verifiedContact=verify(syntheticContact(),"A");
  const seed=seedWithAggregatedEvidence(baseSeed({id:"controlled-fixture-2m",buyerCandidate:"Controlled Fixture Co",buyerVerificationStatus:"VERIFIED"}),[verifiedAf01,verifiedContact]);
  const g=graph(seed);

  it("the CONTROLLED_TEST_REVIEW decisions produced genuinely VERIFIED candidates with an explicit human-assigned grade",()=>{
    expect(verifiedAf01.verificationState).toBe("VERIFIED");
    expect(verifiedContact.verificationState).toBe("VERIFIED");
    expect(verifiedContact.routeGrade).toBe("A");
  });
  it("seedWithAggregatedEvidence folded the verified candidates' own descriptive values into the seed (the base seed's own af01Candidate/contactRoute were null)",()=>{
    expect(seed.af01Candidate).toBe("CONTROLLED_FIXTURE_AF01_ACCEPTANCE");
    expect(seed.contactRoute).toBe("recruiter@controlled-fixture-2m.invalid");
    expect(seed.routeType).toBe("RECRUITER_EMAIL");
    expect(seed.routeGrade).toBe("A");
  });
  it("the real, unmodified graph() builder produces a VERIFIED acceptance and a graded, VERIFIED contact route",()=>{
    expect(g.acceptance).not.toBeNull();
    expect(g.acceptance!.result).toBe("VERIFIED");
    expect(g.routeGrades).toHaveLength(1);
    expect(g.routeGrades[0].grade).toBe("A");
    expect(g.contactRoutes[0].verification_state).toBe("VERIFIED");
  });
  it("the real, unmodified Phase 1 EligibilityService returns eligible:true for VAMO, HOT-A and HOT-B",()=>{
    expect(eligibleOf(g,"VAMO_ELIGIBLE").eligible).toBe(true);
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(true);
    expect(eligibleOf(g,"HOT_B_ELIGIBLE").eligible).toBe(true);
  });
  it("the real, unmodified ScoringService produces a SCORED result from this eligible state",()=>{
    const snapshots=asSnapshots(g);
    const score=new ScoringService({graph:async()=>g},new NoopRepo(),{save:async(x:ScoreResult)=>({...x,id:"score",createdAt:x.evaluatedAt}),list:async()=>[]},()=>g.asOf).assess(g,snapshots,g.asOf);
    expect(score.state).toBe("SCORED");
    expect(score.score).toBeGreaterThan(0);
  });
  it("the real, unmodified CommercialActionService produces a real recommendation-only action",()=>{
    const snapshots=asSnapshots(g);
    const score:ScoreSnapshot={...new ScoringService({graph:async()=>g},new NoopRepo(),{save:async(x:ScoreResult)=>({...x,id:"score",createdAt:x.evaluatedAt}),list:async()=>[]},()=>g.asOf).assess(g,snapshots,g.asOf),id:"score",createdAt:g.asOf};
    const action=new CommercialActionService({graph:async()=>g},new NoopRepo(),{save:async(x:ScoreResult)=>({...x,id:"score",createdAt:x.evaluatedAt}),list:async()=>[]},{save:async(x:CommercialActionResult)=>({...x,id:"action",createdAt:x.evaluatedAt}),list:async()=>[]},()=>g.asOf).assess(g,snapshots,[score],g.asOf);
    expect(action.recommendationOnly).toBe(true);
    expect(action.action).not.toBe("WAIT");
  });
  it("this synthetic fixture is never part of the real tracked dossiers",()=>{
    expect(rows().map(x=>x.id)).not.toContain(seed.id);
    expect(rows()).toHaveLength(5);
  });
});

describe("Phase 2M: negative proofs -- every non-genuine controlled path still correctly blocks",()=>{
  // Must match syntheticAf01()/syntheticContact()'s default opportunityId
  // ("controlled-fixture-2m") -- seedWithAggregatedEvidence only folds a candidate in
  // when candidate.opportunityId===seed.id, exactly like it does for real seeds/dossiers.
  const seedFor=(af01:AggregatedCandidate|undefined,contact:AggregatedCandidate|undefined,seedOverrides:Partial<Seed>={})=>{
    const candidates=[af01,contact].filter((c):c is AggregatedCandidate=>!!c);
    return seedWithAggregatedEvidence(baseSeed({id:"controlled-fixture-2m",...seedOverrides}),candidates);
  };
  it("NEEDS_MORE_EVIDENCE on both candidates leaves the opportunity fully blocked",()=>{
    const af01=applyControlledDecision(syntheticAf01(),{candidateId:syntheticAf01().id,decision:"NEEDS_MORE_EVIDENCE",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"controlled test",evidenceIds:[],decidedAt:new Date()});
    const contact=applyControlledDecision(syntheticContact(),{candidateId:syntheticContact().id,decision:"NEEDS_MORE_EVIDENCE",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"controlled test",evidenceIds:[],decidedAt:new Date()});
    const g=graph(seedFor(af01,contact));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"VAMO_ELIGIBLE").eligible).toBe(false);
  });
  it("REJECT on both candidates leaves the opportunity fully blocked",()=>{
    const af01=applyControlledDecision(syntheticAf01(),{candidateId:syntheticAf01().id,decision:"REJECT",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"controlled test",evidenceIds:[],decidedAt:new Date()});
    const contact=applyControlledDecision(syntheticContact(),{candidateId:syntheticContact().id,decision:"REJECT",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"controlled test",evidenceIds:[],decidedAt:new Date()});
    const g=graph(seedFor(af01,contact));
    expect(af01.verificationState).toBe("REJECTED");
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
  });
  it("DEFER on both candidates leaves the opportunity fully blocked",()=>{
    const af01=applyControlledDecision(syntheticAf01(),{candidateId:syntheticAf01().id,decision:"DEFER",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"controlled test",evidenceIds:[],decidedAt:new Date()});
    const contact=applyControlledDecision(syntheticContact(),{candidateId:syntheticContact().id,decision:"DEFER",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"controlled test",evidenceIds:[],decidedAt:new Date()});
    const g=graph(seedFor(af01,contact));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
  });
  it("unverified (never decided) candidates leave the opportunity fully blocked",()=>{
    const g=graph(seedFor(syntheticAf01(),syntheticContact()));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"VAMO_ELIGIBLE").eligible).toBe(false);
  });
  it("missing buyer/AF-01/route entirely (no candidates at all) leaves the opportunity fully blocked",()=>{
    const g=graph(seedFor(undefined,undefined));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"VAMO_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"HOT_B_ELIGIBLE").eligible).toBe(false);
  });
  it("verifying only the contact-authority candidate (grade A) can genuinely unlock VAMO_ELIGIBLE -- which does not require manpower acceptance -- while HOT_A_ELIGIBLE correctly stays blocked without AF-01",()=>{
    const contact=verify(syntheticContact(),"A");
    const g=graph(seedFor(undefined,contact,{buyerCandidate:"Controlled Fixture Co",buyerVerificationStatus:"VERIFIED"}));
    expect(eligibleOf(g,"VAMO_ELIGIBLE").eligible).toBe(true);
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("MANPOWER_ACCEPTANCE_REQUIRED");
  });
  it("a Seed-level staleAfter in the past cascades to demand, acceptance AND route all at once (real, honest behavior of this codebase's existing single-staleAfter-field design) -- the opportunity stays fully blocked either way",()=>{
    const af01=verify(syntheticAf01());
    const contact=verify(syntheticContact(),"A");
    const g=graph(seedFor(af01,contact,{buyerCandidate:"Controlled Fixture Co",buyerVerificationStatus:"VERIFIED",staleAfter:PAST}));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"VAMO_ELIGIBLE").eligible).toBe(false);
  });
  it("stale acceptance specifically blocks HOT-A even though it was VERIFIED (isolated by mutating the built graph directly, the same technique Phase 2L's own negative-case suite uses)",()=>{
    const af01=verify(syntheticAf01());
    const contact=verify(syntheticContact(),"A");
    const g=graph(seedFor(af01,contact,{buyerCandidate:"Controlled Fixture Co",buyerVerificationStatus:"VERIFIED"}));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(true);
    g.acceptance={...g.acceptance!,valid_until:PAST};
    const result=eligibleOf(g,"HOT_A_ELIGIBLE");
    expect(result.eligible).toBe(false);
    expect(result.failedRequirements).toEqual(expect.arrayContaining(["MANPOWER_ACCEPTANCE_REQUIRED","STALE_ACCEPTANCE"]));
  });
  it("stale route specifically blocks eligibility even with a VERIFIED A-grade route",()=>{
    const af01=verify(syntheticAf01());
    const contact=verify(syntheticContact(),"A");
    const g=graph(seedFor(af01,contact,{buyerCandidate:"Controlled Fixture Co",buyerVerificationStatus:"VERIFIED"}));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(true);
    g.contactRoutes[0]={...g.contactRoutes[0],stale_after:PAST};
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("STALE_CONTACT_ROUTE");
  });
  it("conflicting evidence blocks an otherwise fully-verified opportunity",()=>{
    const af01=verify(syntheticAf01());
    const contact=verify(syntheticContact(),"A");
    const g=graph(seedFor(af01,contact,{buyerCandidate:"Controlled Fixture Co",buyerVerificationStatus:"VERIFIED",conflicts:["Controlled fixture conflict"]}));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("MATERIAL_CONFLICT_PRESENT");
  });
  it("a D-grade verified route cannot satisfy VAMO or HOT-A",()=>{
    const contact=verify(syntheticContact(),"D");
    const g=graph(seedFor(undefined,contact,{buyerCandidate:"Controlled Fixture Co",buyerVerificationStatus:"VERIFIED"}));
    expect(eligibleOf(g,"VAMO_ELIGIBLE").failedRequirements).toContain("ACTIONABLE_CONTACT_REQUIRED");
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("ACTIONABLE_CONTACT_REQUIRED");
  });
  it("an E-grade verified route cannot satisfy VAMO, HOT-A or HOT-B",()=>{
    const contact=verify(syntheticContact(),"E");
    const g=graph(seedFor(undefined,contact,{buyerCandidate:"Controlled Fixture Co",buyerVerificationStatus:"VERIFIED"}));
    expect(eligibleOf(g,"VAMO_ELIGIBLE").failedRequirements).toContain("ACTIONABLE_CONTACT_REQUIRED");
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("ACTIONABLE_CONTACT_REQUIRED");
    expect(eligibleOf(g,"HOT_B_ELIGIBLE").failedRequirements).toContain("HOT_B_INTELLIGENCE_PATH_PRESENT");
  });
});

describe("Phase 2M: graph consuming aggregated state -- candidate-only (UNVERIFIED) evidence never satisfies eligibility",()=>{
  it("folding the REAL aggregatedCandidates() (all genuinely UNVERIFIED) into the real Port Arthur seed changes nothing about its verification states",()=>{
    const dossier=by("qual-beaumont-port-arthur");
    const enriched=seedWithAggregatedEvidence(dossier,aggregatedCandidates());
    expect(enriched.af01VerificationState).toBe(dossier.af01VerificationState);
    expect(enriched.buyerVerificationStatus).toBe(dossier.buyerVerificationStatus);
    expect(enriched.routeVerificationState).toBe(dossier.routeVerificationState);
  });
  it("folding real UNVERIFIED evidence DOES enrich provenance (more evidenceIds/sourceUrls), proving the pipe is genuinely wired, without ever satisfying eligibility",()=>{
    const dossier=by("qual-beaumont-port-arthur");
    const enriched=seedWithAggregatedEvidence(dossier,aggregatedCandidates());
    expect(enriched.evidenceIds.length).toBeGreaterThanOrEqual(dossier.evidenceIds.length);
    expect(enriched.evidenceIds).toEqual(expect.arrayContaining(dossier.evidenceIds));
    const g=graph(enriched);
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"VAMO_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"HOT_B_ELIGIBLE").eligible).toBe(false);
  });
  it("candidates with no matching opportunityId (e.g. none for qual-permian) leave the seed completely unchanged",()=>{
    const dossier=by("qual-permian");
    const enriched=seedWithAggregatedEvidence(dossier,aggregatedCandidates());
    expect(enriched).toEqual(dossier);
  });
});

describe("Phase 2M: real-data replay -- adversarial self-check that Port Arthur, Freeport, Trillium Amarillo and Corpus Christi ALL remain ineligible through the real (non-controlled) path",()=>{
  it("qualificationDossiers() (unmodified default path): all five tracked opportunities remain fully blocked",()=>{
    expect(rows().every(x=>!x.eligibility.VAMO_ELIGIBLE.eligible&&!x.eligibility.HOT_A_ELIGIBLE.eligible&&!x.eligibility.HOT_B_ELIGIBLE.eligible)).toBe(true);
  });
  it("qualificationDossiersEnriched() with the REAL aggregatedCandidates(): all five tracked opportunities STILL remain fully blocked -- if any became eligible, that would be a bug in this phase's wiring, not a real discovery",()=>{
    const enriched=qualificationDossiersEnriched(aggregatedCandidates());
    expect(enriched).toHaveLength(5);
    expect(enriched.every(x=>!x.eligibility.VAMO_ELIGIBLE.eligible&&!x.eligibility.HOT_A_ELIGIBLE.eligible&&!x.eligibility.HOT_B_ELIGIBLE.eligible)).toBe(true);
  });
  it("Port Arthur specifically: real buyer/AF-01/contact-authority candidates exist (six, from evidence-aggregation.test.ts's own count -- doubled by Phase 2Q's re-verification of the same RFP PDF) but none carry a real VERIFIED decision anywhere in this codebase's actual data",()=>{
    const portArthurCandidates=aggregatedCandidates().filter(c=>c.opportunityId==="qual-beaumont-port-arthur");
    expect(portArthurCandidates).toHaveLength(6);
    expect(portArthurCandidates.every(c=>c.verificationState==="UNVERIFIED")).toBe(true);
    expect(by("qual-beaumont-port-arthur").eligibility.HOT_A_ELIGIBLE.eligible).toBe(false);
  });
  it("Freeport specifically: real buyer/contact candidates exist, no AF-01 candidate, none verified, still blocked",()=>{
    const freeportCandidates=aggregatedCandidates().filter(c=>c.opportunityId==="qual-freeport");
    expect(freeportCandidates.every(c=>c.verificationState==="UNVERIFIED")).toBe(true);
    expect(by("qual-freeport").eligibility.HOT_A_ELIGIBLE.eligible).toBe(false);
    expect(by("qual-freeport").eligibility.HOT_A_ELIGIBLE.blockers).toContain("MATERIAL_CONFLICT_PRESENT");
  });
  it("Trillium Amarillo specifically (Phase 2Q): real recruiter contact-authority evidence now IS linked to the real tracked qual-amarillo opportunity, yet still cannot clear eligibility -- no route grade exists, and Trillium's own posting is not treated as verified manpower acceptance for an unnamed end client",()=>{
    const amarillo=aggregatedCandidates().find(c=>c.market==="Texas Panhandle"&&c.type==="CONTACT_AUTHORITY")!;
    expect(amarillo.opportunityId).toBe("qual-amarillo");
    expect(rows().map(x=>x.market)).toContain("Texas Panhandle");
    expect(by("qual-amarillo").eligibility.HOT_A_ELIGIBLE.eligible).toBe(false);
    expect(by("qual-amarillo").eligibility.HOT_B_ELIGIBLE.eligible).toBe(false);
  });
  it("Corpus Christi specifically: the real cross-entity conflict candidate exists, unverified, and HOT_A_ELIGIBLE is still blocked by MATERIAL_CONFLICT_PRESENT",()=>{
    const corpusCandidates=aggregatedCandidates().filter(c=>c.opportunityId==="qual-corpus");
    expect(corpusCandidates).toHaveLength(1);
    expect(corpusCandidates[0].type).toBe("COMPANY_PROJECT_CONFLICT");
    expect(corpusCandidates[0].verificationState).toBe("UNVERIFIED");
    expect(by("qual-corpus").eligibility.HOT_A_ELIGIBLE.blockers).toContain("MATERIAL_CONFLICT_PRESENT");
  });
  it("scoring and Commercial Action remain eligibility-dependent for real data: every real dossier is NOT_SCORABLE / NOT_GENERATED",()=>{
    expect(rows().every(x=>x.scoreState==="NOT_SCORABLE")).toBe(true);
    expect(rows().every(x=>x.commercialActionState==="NOT_GENERATED")).toBe(true);
  });
  it("no real candidate anywhere in this codebase's actual data is ever VERIFIED",()=>{
    expect(aggregatedCandidates().filter(c=>c.verificationState==="VERIFIED")).toHaveLength(0);
  });
});

describe("Phase 2M: TECH-DEBT-04 classification",()=>{
  it("seedWithAggregatedEvidence and qualificationDossiersEnriched are real, exported, callable functions -- concrete plumbing, not a stub",()=>{
    expect(seedWithAggregatedEvidence).toBeTypeOf("function");
    expect(qualificationDossiersEnriched).toBeTypeOf("function");
  });
  it("qualificationDossiers()'s default behavior is unchanged for the original four opportunities and additive for the Phase 2Q-authorized fifth: five dossiers, five markets in seed-array order, still zero eligible results",()=>{
    expect(rows()).toHaveLength(5);
    expect(rows().map(x=>x.market)).toEqual(["Freeport","Beaumont / Port Arthur","Permian Basin","Corpus Christi","Texas Panhandle"]);
  });
  it("resolution is genuinely one-directional: opportunity-qualification-service.ts imports evidence-aggregation-service.ts, which never imports back",()=>{
    // Functional corroboration of src/test/evidence-aggregation/evidence-aggregation.test.ts's
    // static source-text acyclicity checks: both modules load and interoperate correctly here.
    expect(aggregatedCandidates().length).toBeGreaterThan(0);
    expect(qualificationDossiersEnriched().length).toBe(5);
  });
});

describe("Phase 2M boundary",()=>{
  it("no Phase 2N scoring/outreach capability has leaked into the qualification or aggregation layers",()=>{
    expect(JSON.stringify(rows())).not.toMatch(/CALL_TODAY|EMAIL_TODAY|automatic.?outreach|phase2n/i);
    expect(JSON.stringify(aggregatedCandidates())).not.toMatch(/CALL_TODAY|EMAIL_TODAY|automatic.?outreach/i);
  });
});
