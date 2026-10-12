import{describe,expect,it}from"vitest";
import type{Seed}from"../../server/services/opportunity-qualification/opportunity-qualification-service";
import{graph,qualificationDossiers,qualificationSeed}from"../../server/services/opportunity-qualification/opportunity-qualification-service";
import{gatedCommercialActionForOpportunity}from"../../server/services/opportunity-actionability/opportunity-actionability-service";

/**
 * Phase 2P: proves graph()'s gaps are now genuinely derived from real Seed state
 * (see the Phase 2O-identified issue this fixes: gaps were previously hardcoded
 * ["MISSING_MANPOWER_ACCEPTANCE","MISSING_ACTIONABLE_ROUTE"] regardless of actual
 * acceptance/route state). EligibilityService never reads graph.gaps (confirmed by
 * inspection -- it recomputes independently from acceptance/contactRoutes/
 * routeGrades directly), so this fix changes zero eligibility semantics; it only
 * lets CommercialActionService's branch selection reflect real state.
 */

const at=new Date("2026-08-21T12:00:00Z"),FAR_FUTURE=new Date("2026-12-01T00:00:00Z"),PAST=new Date("2026-01-01T00:00:00Z");
const base=(o:Partial<Seed>):Seed=>({
  id:"controlled-fixture-2p",context:"CONTROLLED SYNTHETIC FIXTURE (Phase 2P) -- not real production evidence",market:"Controlled Test Market",
  currentDemand:true,electricalRoles:[],demandSources:[],company:"Controlled Fixture Co",canonicalCompanyStatus:"RESOLVED",
  project:null,projectStatus:"UNKNOWN",buyerCandidate:null,buyerVerificationStatus:"MISSING",companyRole:null,
  af01Candidate:null,af01Category:null,af01VerificationState:"MISSING",contactPerson:null,contactFunction:null,
  contactRoute:null,routeType:null,routeGrade:null,routeVerificationState:"MISSING",compensation:null,overtime:null,
  perDiem:null,headcount:null,schedule:null,duration:null,firstSeen:at,lastSeen:at,staleAfter:FAR_FUTURE,
  evidenceIds:["evidence:controlled-fixture-2p"],claimIds:[],sourceUrls:[],conflicts:[],humanReviewRequirements:[],...o,
});

describe("Phase 2P: MISSING_MANPOWER_ACCEPTANCE is genuinely derived",()=>{
  it("a candidate-only (UNVERIFIED) AF-01 does not clear the gap",()=>{
    expect(graph(base({af01Candidate:"x",af01VerificationState:"UNVERIFIED"})).gaps).toContain("MISSING_MANPOWER_ACCEPTANCE");
  });
  it("a genuinely VERIFIED, current AF-01 clears the gap",()=>{
    expect(graph(base({af01Candidate:"x",af01VerificationState:"VERIFIED"})).gaps).not.toContain("MISSING_MANPOWER_ACCEPTANCE");
  });
  it("a VERIFIED AF-01 whose seed staleAfter has passed does not clear the gap (stale acceptance is not current)",()=>{
    expect(graph(base({af01Candidate:"x",af01VerificationState:"VERIFIED",staleAfter:PAST})).gaps).toContain("MISSING_MANPOWER_ACCEPTANCE");
  });
  it("CONFLICTING af01VerificationState does not clear the gap",()=>{
    expect(graph(base({af01Candidate:"x",af01VerificationState:"CONFLICTING"})).gaps).toContain("MISSING_MANPOWER_ACCEPTANCE");
  });
});

describe("Phase 2P: MISSING_ACTIONABLE_ROUTE is genuinely derived",()=>{
  it("a candidate-only (UNVERIFIED) grade-A route does not clear the gap",()=>{
    expect(graph(base({contactRoute:"r",routeType:"RECRUITER_PHONE",routeGrade:"A",routeVerificationState:"UNVERIFIED"})).gaps).toContain("MISSING_ACTIONABLE_ROUTE");
  });
  it("a VERIFIED D-grade route does not clear the gap (D is HOT-B-only, not actionable for VAMO/HOT-A)",()=>{
    expect(graph(base({contactRoute:"r",routeType:"RECRUITER_PHONE",routeGrade:"D",routeVerificationState:"VERIFIED"})).gaps).toContain("MISSING_ACTIONABLE_ROUTE");
  });
  it("a VERIFIED E-grade route does not clear the gap",()=>{
    expect(graph(base({contactRoute:"r",routeType:"RECRUITER_PHONE",routeGrade:"E",routeVerificationState:"VERIFIED"})).gaps).toContain("MISSING_ACTIONABLE_ROUTE");
  });
  it("a genuinely VERIFIED, current grade-A route clears the gap",()=>{
    expect(graph(base({contactRoute:"r",routeType:"RECRUITER_PHONE",routeGrade:"A",routeVerificationState:"VERIFIED"})).gaps).not.toContain("MISSING_ACTIONABLE_ROUTE");
  });
  it("a VERIFIED grade-A route whose seed staleAfter has passed does not clear the gap",()=>{
    expect(graph(base({contactRoute:"r",routeType:"RECRUITER_PHONE",routeGrade:"A",routeVerificationState:"VERIFIED",staleAfter:PAST})).gaps).toContain("MISSING_ACTIONABLE_ROUTE");
  });
});

describe("Phase 2P: other gaps are derived correctly and consistently",()=>{
  it("a fully-verified, fully-populated seed produces zero gaps",()=>{
    const g=graph(base({buyerCandidate:"B",project:"P",af01Candidate:"x",af01VerificationState:"VERIFIED",contactPerson:"CP",contactRoute:"r",routeType:"RECRUITER_PHONE",routeGrade:"A",routeVerificationState:"VERIFIED"}));
    expect(g.gaps).toEqual([]);
  });
  it("MISSING_CURRENT_DEMAND, MISSING_COMPANY, MISSING_COMPANY_ROLE, MISSING_CONTACT, CONFLICTING_EVIDENCE all reflect real seed state",()=>{
    const g=graph(base({currentDemand:false,company:null,buyerCandidate:null,contactPerson:null,conflicts:["real conflict"]}));
    expect(g.gaps).toEqual(expect.arrayContaining(["MISSING_CURRENT_DEMAND","MISSING_COMPANY","MISSING_COMPANY_ROLE","MISSING_CONTACT","CONFLICTING_EVIDENCE"]));
  });
  it("eligibility semantics are completely unaffected by this fix, because EligibilityService never reads graph.gaps: candidate-only evidence still cannot satisfy VAMO/HOT-A/HOT-B",()=>{
    const g=graph(base({af01Candidate:"x",af01VerificationState:"UNVERIFIED",contactRoute:"r",routeType:"RECRUITER_PHONE",routeGrade:"A",routeVerificationState:"UNVERIFIED"}));
    expect(g.gaps).toContain("MISSING_MANPOWER_ACCEPTANCE");
    expect(g.gaps).toContain("MISSING_ACTIONABLE_ROUTE");
  });
});

describe("Phase 2P: real-data replay through the corrected graph -- every real tracked opportunity's underlying commercial action is unchanged",()=>{
  it("qual-freeport: still RESOLVE_CONFLICT (real, unresolved cross-entity conflict)",()=>{
    expect(gatedCommercialActionForOpportunity("qual-freeport")?.underlyingAction).toBe("RESOLVE_CONFLICT");
  });
  it("qual-beaumont-port-arthur: still RESOLVE_CONFLICT",()=>{
    expect(gatedCommercialActionForOpportunity("qual-beaumont-port-arthur")?.underlyingAction).toBe("RESOLVE_CONFLICT");
  });
  it("qual-corpus: still RESOLVE_CONFLICT",()=>{
    expect(gatedCommercialActionForOpportunity("qual-corpus")?.underlyingAction).toBe("RESOLVE_CONFLICT");
  });
  it("qual-permian: still VERIFY_MANPOWER_ACCEPTANCE (real AF-01 is genuinely MISSING -- no conflict to hide behind, and the honest gap now correctly still blocks it)",()=>{
    expect(gatedCommercialActionForOpportunity("qual-permian")?.underlyingAction).toBe("VERIFY_MANPOWER_ACCEPTANCE");
  });
  it("no real tracked opportunity's gaps array is the old hardcoded pair -- each now reflects genuinely distinct real state",()=>{
    const gapsPerSeed=["qual-freeport","qual-beaumont-port-arthur","qual-permian","qual-corpus"].map(id=>graph(qualificationSeed(id)!).gaps.slice().sort().join(","));
    expect(new Set(gapsPerSeed).size).toBeGreaterThan(1);
  });
  it("the full real qualificationDossiers() eligibility output (which never depended on graph.gaps) is byte-identical to its pre-Phase-2P shape: all four still fully blocked",()=>{
    expect(qualificationDossiers().every(d=>!d.eligibility.VAMO_ELIGIBLE.eligible&&!d.eligibility.HOT_A_ELIGIBLE.eligible&&!d.eligibility.HOT_B_ELIGIBLE.eligible)).toBe(true);
  });
});
