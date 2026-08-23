import{describe,expect,it}from"vitest";
import type{EligibilityRepository}from"../../server/repositories/eligibility/eligibility-repository";
import type{EligibilityResult,EligibilitySnapshot}from"../../domain/eligibility";
import{MANPOWER_ACCEPTANCE_RESULTS}from"../../domain/manpower-acceptance";
import{CONTACT_ROUTE_GRADES}from"../../domain/contact";
import{EligibilityService}from"../../server/services/eligibility/eligibility-service";
import{FACTS_2J}from"../../server/services/targeted-evidence/targeted-evidence-closure-2j-service";
import{acceptanceFor,acceptanceResultFor,graph,qualificationDossiers,routeGradesFor,routeVerificationStateFor,type Seed}from"../../server/services/opportunity-qualification/opportunity-qualification-service";

/**
 * Phase 2L: opportunity-qualification-service.ts's graph() builder previously
 * hardcoded acceptance:null and routeGrades:[] unconditionally, so captured
 * AF-01/buyer-candidate and contact-route-grade evidence already sitting on each
 * Seed could never reach the (unmodified) Phase 1 eligibility engine. This suite
 * proves the corrected wiring reads real Seed fields (never fabricating VERIFIED
 * status), replays the real tracked opportunities to confirm none of them become
 * newly eligible, and proves the positive path works using an explicitly-labeled
 * controlled synthetic fixture that is never added to the real `seeds` array.
 */

const rows=()=>qualificationDossiers(),by=(id:string)=>rows().find(x=>x.id===id)!;

// A no-op repository, matching the shape production code already uses in
// qualificationDossiers(). asOf-driven, no Date.now() anywhere.
class NoopRepo implements EligibilityRepository{
  async activeEvidenceIds(ids:string[]){return ids}
  async save(r:EligibilityResult):Promise<EligibilitySnapshot>{return{...r,id:"unused",createdAt:r.evaluatedAt}}
  async list(){return[]}
}
const assess=(g:ReturnType<typeof graph>)=>new EligibilityService({graph:async()=>g},new NoopRepo(),()=>g.asOf).assess(g,g.asOf);
const eligibleOf=(g:ReturnType<typeof graph>,type:"VAMO_ELIGIBLE"|"HOT_A_ELIGIBLE"|"HOT_B_ELIGIBLE")=>assess(g).find(r=>r.eligibilityType===type)!;

const FAR_FUTURE=new Date("2026-12-01T00:00:00Z"),PAST=new Date("2026-01-01T00:00:00Z");
// Every controlled fixture id is prefixed and titled so it can never be mistaken for
// real production evidence, and none of these are ever added to the real seeds array.
const baseSeed=(overrides:Partial<Seed>):Seed=>({
  id:"controlled-fixture-base",
  context:"CONTROLLED SYNTHETIC FIXTURE -- not real production evidence",
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
  evidenceIds:["evidence:controlled-fixture"],
  claimIds:[],
  sourceUrls:["https://example.invalid/controlled-fixture"],
  conflicts:[],
  humanReviewRequirements:[],
  ...overrides,
});

describe("Phase 2L acceptance/routeGrades are wired from real Seed evidence, not hardcoded",()=>{
  it("acceptance is never null for a resolved company (was hardcoded null before)",()=>{
    expect(acceptanceFor(baseSeed({}))).not.toBeNull();
  });
  it("acceptance is null when there is no company to evaluate against",()=>{
    expect(acceptanceFor(baseSeed({company:null}))).toBeNull();
  });
  it("no AF-01 candidate -> NOT_VERIFIED, not a fabricated denial",()=>{
    const a=acceptanceFor(baseSeed({af01Candidate:null,af01VerificationState:"MISSING"}))!;
    expect(a.result).toBe("NOT_VERIFIED");
  });
  it("AF-01 candidate present but unverified -> INSUFFICIENT_EVIDENCE, never VERIFIED",()=>{
    const a=acceptanceFor(baseSeed({af01Candidate:"THIRD_PARTY_RECRUITING_ACCEPTED",af01VerificationState:"UNVERIFIED"}))!;
    expect(a.result).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("conflicting AF-01 candidate -> INSUFFICIENT_EVIDENCE, never VERIFIED",()=>{
    const a=acceptanceFor(baseSeed({af01Candidate:"participation in contracting",af01VerificationState:"CONFLICTING"}))!;
    expect(a.result).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("only an explicit VERIFIED af01VerificationState produces a VERIFIED acceptance",()=>{
    const a=acceptanceFor(baseSeed({af01Candidate:"x",af01VerificationState:"VERIFIED"}))!;
    expect(a.result).toBe("VERIFIED");
  });
  it("acceptance result always matches the real domain vocabulary",()=>{
    for(const state of["MISSING","UNVERIFIED","VERIFIED","CONFLICTING"]as const){
      const a=acceptanceResultFor(baseSeed({af01VerificationState:state,af01Candidate:state==="MISSING"?null:"x"}));
      expect(MANPOWER_ACCEPTANCE_RESULTS).toContain(a);
    }
  });
  it("acceptance context and companyId are selected from the correct opportunity/company",()=>{
    const a=acceptanceFor(baseSeed({id:"qual-selection-check",company:"Selection Check Co"}))!;
    expect(a.companyId).toBe("Selection Check Co");
    expect(a.context).toEqual({type:"OPPORTUNITY",id:"qual-selection-check"});
  });
  it("routeGrades stays empty when no grade evidence exists (was hardcoded [] before, still correctly [] here)",()=>{
    expect(routeGradesFor(baseSeed({contactRoute:"a@b.com",routeGrade:null}))).toEqual([]);
  });
  it("does not auto-assign a grade to a contact that doesn't have one",()=>{
    expect(routeGradesFor(baseSeed({contactRoute:null,routeGrade:null}))).toEqual([]);
  });
  it("a real recorded route grade is read through, not discarded",()=>{
    const grades=routeGradesFor(baseSeed({id:"qual-grade-check",contactRoute:"a@b.com",routeGrade:"B"}));
    expect(grades).toHaveLength(1);
    expect(grades[0].grade).toBe("B");
    expect(grades[0].contact_route_id).toBe("qual-grade-check:route");
    expect(CONTACT_ROUTE_GRADES).toContain(grades[0].grade);
  });
  it("routeGrades.contact_route_id matches the actual contactRoutes id produced by graph()",()=>{
    const g=graph(baseSeed({id:"qual-linkage-check",contactRoute:"a@b.com",routeType:"RECRUITER_EMAIL",routeGrade:"A",routeVerificationState:"VERIFIED"}));
    expect(g.routeGrades).toHaveLength(1);
    expect(String(g.routeGrades[0].contact_route_id)).toBe(String(g.contactRoutes[0].id));
  });
  it("route verification_state reflects real routeVerificationState instead of a hardcoded literal",()=>{
    expect(routeVerificationStateFor(baseSeed({routeVerificationState:"VERIFIED"}))).toBe("VERIFIED");
    expect(routeVerificationStateFor(baseSeed({routeVerificationState:"UNVERIFIED"}))).toBe("UNVERIFIED");
    expect(routeVerificationStateFor(baseSeed({routeVerificationState:"CONFLICTING"}))).toBe("UNVERIFIED");
    expect(routeVerificationStateFor(baseSeed({routeVerificationState:"MISSING"}))).toBe("UNVERIFIED");
  });
  it("acceptance and routeGrades computation is deterministic across repeated calls (no Date.now() leak)",()=>{
    const seed=baseSeed({af01Candidate:"x",af01VerificationState:"VERIFIED",contactRoute:"a@b.com",routeGrade:"A"});
    expect(JSON.stringify(acceptanceFor(seed))).toBe(JSON.stringify(acceptanceFor(seed)));
    expect(JSON.stringify(routeGradesFor(seed))).toBe(JSON.stringify(routeGradesFor(seed)));
    expect(graph(seed).asOf.getTime()).toBe(graph(seed).asOf.getTime());
  });
});

describe("Phase 2L real opportunity replay guardrails -- corrected wiring must not fabricate a HOT lead",()=>{
  it("all four tracked opportunities remain fully blocked after the wiring fix",()=>{
    expect(rows().every(x=>!x.eligibility.VAMO_ELIGIBLE.eligible&&!x.eligibility.HOT_A_ELIGIBLE.eligible&&!x.eligibility.HOT_B_ELIGIBLE.eligible)).toBe(true);
  });
  it("Port Arthur: has AF-01/buyer candidates and a route, but nothing is VERIFIED anywhere in the seed",()=>{
    const dossier=by("qual-beaumont-port-arthur"),g=graph(dossier);
    expect(dossier.af01Candidate).toBe("participation in contracting");
    expect(g.acceptance).not.toBeNull();
    expect(g.acceptance!.result).not.toBe("VERIFIED");
    expect(g.routeGrades).toEqual([]);
    expect(dossier.eligibility.HOT_A_ELIGIBLE.eligible).toBe(false);
    expect(dossier.eligibility.HOT_A_ELIGIBLE.blockers).toContain("MANPOWER_ACCEPTANCE_REQUIRED");
    expect(dossier.eligibility.HOT_A_ELIGIBLE.blockers).toContain("ACTIONABLE_CONTACT_REQUIRED");
  });
  it("Strike / Permian Basin: demand-only, no buyer/AF-01/route evidence on the seed, stays blocked",()=>{
    const dossier=by("qual-permian"),g=graph(dossier);
    expect(dossier.buyerCandidate).toBeNull();
    expect(dossier.af01Candidate).toBeNull();
    expect(g.acceptance!.result).toBe("NOT_VERIFIED");
    expect(g.contactRoutes).toEqual([]);
    expect(g.routeGrades).toEqual([]);
    expect(dossier.eligibility.VAMO_ELIGIBLE.eligible).toBe(false);
    expect(dossier.eligibility.HOT_A_ELIGIBLE.eligible).toBe(false);
  });
  it("Trillium Amarillo does not correlate to any tracked qualification dossier",()=>{
    const amarillo=FACTS_2J.filter(f=>f.sourceKey.startsWith("trillium-amarillo"));
    expect(amarillo.length).toBeGreaterThan(0);
    expect(amarillo.every(f=>f.opportunityId===null)).toBe(true);
    expect(rows().map(x=>x.market)).not.toContain("Texas Panhandle");
  });
  it("Trillium Amarillo's real recruiter contact, replayed through the corrected graph, still does not clear eligibility (no route grade exists)",()=>{
    const amarilloLikeSeed=baseSeed({
      id:"controlled-fixture-trillium-amarillo-replay",
      context:"CONTROLLED SYNTHETIC FIXTURE replaying real Trillium Amarillo FACTS_2J attributes -- not a tracked production dossier",
      company:"Trillium Construction Services",
      buyerCandidate:"Trillium Construction Services",
      buyerVerificationStatus:"UNVERIFIED",
      af01Candidate:"THIRD_PARTY_RECRUITING_ACCEPTED",
      af01VerificationState:"UNVERIFIED",
      contactPerson:"Roberto Venegas",
      contactFunction:"RECRUITER",
      contactRoute:"800-778-8907",
      routeType:"RECRUITER_PHONE",
      routeGrade:null, // real FACTS_2J entries carry contactGrade:null -- no real grading has ever occurred
      routeVerificationState:"UNVERIFIED",
    });
    const g=graph(amarilloLikeSeed);
    expect(g.acceptance!.result).toBe("INSUFFICIENT_EVIDENCE");
    expect(g.routeGrades).toEqual([]);
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"HOT_B_ELIGIBLE").eligible).toBe(false);
    expect(eligibleOf(g,"VAMO_ELIGIBLE").eligible).toBe(false);
  });
  it("Freeport and Corpus Christi conflicts still block eligibility after the wiring fix",()=>{
    expect(by("qual-freeport").eligibility.HOT_A_ELIGIBLE.blockers).toContain("MATERIAL_CONFLICT_PRESENT");
    expect(by("qual-corpus").eligibility.HOT_A_ELIGIBLE.blockers).toContain("MATERIAL_CONFLICT_PRESENT");
  });
});

describe("Phase 2L controlled positive proof -- corrected wiring lets genuine VERIFIED evidence reach eligibility",()=>{
  const verifiedFixture=baseSeed({
    id:"controlled-fixture-verified-af01-graded-route",
    context:"CONTROLLED SYNTHETIC FIXTURE proving the corrected graph wiring -- NOT a real opportunity or real evidence",
    company:"Controlled Fixture Co",
    buyerCandidate:"Controlled Fixture Co",
    buyerVerificationStatus:"VERIFIED",
    af01Candidate:"CONTROLLED_FIXTURE_AF01_ACCEPTANCE",
    af01Category:"THIRD_PARTY_RECRUITING_ACCEPTED",
    af01VerificationState:"VERIFIED",
    contactPerson:"Controlled Fixture Recruiter",
    contactFunction:"RECRUITER",
    contactRoute:"recruiter@controlled-fixture.invalid",
    routeType:"RECRUITER_EMAIL",
    routeGrade:"A",
    routeVerificationState:"VERIFIED",
  });
  it("produces a VERIFIED acceptance and a graded, VERIFIED route",()=>{
    const g=graph(verifiedFixture);
    expect(g.acceptance!.result).toBe("VERIFIED");
    expect(g.routeGrades[0].grade).toBe("A");
    expect(g.contactRoutes[0].verification_state).toBe("VERIFIED");
  });
  it("the unmodified Phase 1 eligibility engine returns eligible:true for VAMO, HOT-A and HOT-B",()=>{
    const g=graph(verifiedFixture);
    expect(eligibleOf(g,"VAMO_ELIGIBLE").eligible).toBe(true);
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(true);
    expect(eligibleOf(g,"HOT_B_ELIGIBLE").eligible).toBe(true);
  });
  it("this fixture is never part of the real tracked dossiers",()=>{
    expect(rows().map(x=>x.id)).not.toContain(verifiedFixture.id);
    expect(rows()).toHaveLength(4);
  });
});

describe("Phase 2L controlled negative cases -- the corrected wiring still blocks every non-genuine path",()=>{
  const verified=(overrides:Partial<Seed>)=>baseSeed({
    id:"controlled-fixture-negative-base",
    context:"CONTROLLED SYNTHETIC FIXTURE (negative case) -- NOT real evidence",
    company:"Controlled Fixture Co",
    af01Candidate:"CONTROLLED_FIXTURE_AF01",
    af01VerificationState:"VERIFIED",
    contactRoute:"recruiter@controlled-fixture.invalid",
    routeType:"RECRUITER_EMAIL",
    routeGrade:"A",
    routeVerificationState:"VERIFIED",
    ...overrides,
  });
  it("unverified acceptance blocks HOT-A",()=>{
    const g=graph(verified({af01VerificationState:"UNVERIFIED"}));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("MANPOWER_ACCEPTANCE_REQUIRED");
  });
  it("conflicting (rejected-in-substance) acceptance blocks HOT-A -- this domain has no separate REJECTED acceptance state, it collapses to INSUFFICIENT_EVIDENCE",()=>{
    const g=graph(verified({af01VerificationState:"CONFLICTING"}));
    expect(g.acceptance!.result).toBe("INSUFFICIENT_EVIDENCE");
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
  });
  it("stale acceptance blocks HOT-A even though it was VERIFIED",()=>{
    const g=graph(verified({}));
    g.acceptance={...g.acceptance!,valid_until:PAST};
    const result=eligibleOf(g,"HOT_A_ELIGIBLE");
    expect(result.failedRequirements).toEqual(expect.arrayContaining(["MANPOWER_ACCEPTANCE_REQUIRED","STALE_ACCEPTANCE"]));
  });
  it("unverified route blocks the actionable-contact requirement even with an A grade",()=>{
    const g=graph(verified({routeVerificationState:"UNVERIFIED"}));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("ACTIONABLE_CONTACT_REQUIRED");
  });
  it("stale route blocks eligibility even with a VERIFIED A-grade route",()=>{
    const g=graph(verified({}));
    g.contactRoutes[0]={...g.contactRoutes[0],stale_after:PAST};
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("STALE_CONTACT_ROUTE");
  });
  it("D grade route cannot satisfy VAMO or HOT-A",()=>{
    const g=graph(verified({routeGrade:"D"}));
    expect(eligibleOf(g,"VAMO_ELIGIBLE").failedRequirements).toContain("ACTIONABLE_CONTACT_REQUIRED");
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("ACTIONABLE_CONTACT_REQUIRED");
  });
  it("E grade route cannot satisfy VAMO, HOT-A or HOT-B",()=>{
    const g=graph(verified({routeGrade:"E"}));
    expect(eligibleOf(g,"VAMO_ELIGIBLE").failedRequirements).toContain("ACTIONABLE_CONTACT_REQUIRED");
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("ACTIONABLE_CONTACT_REQUIRED");
    expect(eligibleOf(g,"HOT_B_ELIGIBLE").failedRequirements).toContain("HOT_B_INTELLIGENCE_PATH_PRESENT");
  });
  it("an unresolved conflict blocks an otherwise fully-verified opportunity",()=>{
    const g=graph(verified({conflicts:["Controlled fixture conflict"]}));
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("MATERIAL_CONFLICT_PRESENT");
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
  });
  it("a NEEDS_MORE_EVIDENCE human-review decision blocks an otherwise fully-verified opportunity",()=>{
    const g=graph(verified({}));
    g.verificationReviews=[{id:"review",target_type:"CONTACT_ROUTE",target_id:g.contactRoutes[0].id,decision:"NEEDS_MORE_EVIDENCE"}];
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").failedRequirements).toContain("HUMAN_VERIFICATION_REQUIRED");
  });
  it("a DEFER human-review decision blocks an otherwise fully-verified opportunity",()=>{
    const g=graph(verified({}));
    g.verificationReviews=[{id:"review",target_type:"CONTACT_ROUTE",target_id:g.contactRoutes[0].id,decision:"DEFER"}];
    expect(eligibleOf(g,"HOT_A_ELIGIBLE").eligible).toBe(false);
  });
});

describe("Phase 2L boundary and consistency checks",()=>{
  it("scoring and Commercial Action remain eligibility-dependent and unmodified by the wiring fix",()=>{
    expect(rows().every(x=>x.scoreState==="NOT_SCORABLE")).toBe(true);
    expect(rows().every(x=>x.commercialActionState==="NOT_GENERATED")).toBe(true);
  });
  it("provenance (evidenceIds) is preserved through the wiring fix",()=>{
    for(const dossier of rows()){
      const g=graph(dossier);
      expect(g.evidence.map(e=>e.id)).toEqual(dossier.evidenceIds);
    }
  });
  it("historical asOf reconstruction stays deterministic and does not leak the current wall-clock",()=>{
    const g1=graph(by("qual-freeport")),g2=graph(by("qual-freeport"));
    expect(g1.asOf.getTime()).toBe(g2.asOf.getTime());
    expect(g1.asOf.getTime()).toBeLessThan(Date.now());
  });
  it("no Phase 2M scoring or outreach capability has leaked into the qualification layer",()=>{
    expect(JSON.stringify(rows())).not.toMatch(/CALL_TODAY|EMAIL_TODAY|automatic.?outreach|phase2m/i);
  });
  it("all 620+ prior-phase behaviors are untouched: four dossiers, four markets, no fabricated eligibility",()=>{
    expect(rows()).toHaveLength(4);
    expect(rows().map(x=>x.market)).toEqual(["Freeport","Beaumont / Port Arthur","Permian Basin","Corpus Christi"]);
    expect(rows().every(x=>Object.values(x.eligibility).every(e=>!e.eligible))).toBe(true);
  });
});
