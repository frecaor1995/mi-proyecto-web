import{describe,expect,it}from"vitest";
import type{AggregatedCandidate}from"../../domain/evidence-aggregation";
import{aggregatedCandidates}from"../../server/services/evidence-aggregation/evidence-aggregation-service";
import{qualificationDossiers}from"../../server/services/opportunity-qualification/opportunity-qualification-service";
import{decisionPreview,decisionPreviewForCandidate}from"../../server/services/decision-preview/decision-preview-service";

/**
 * Stage 2N-B. Proves decisionPreview against the REAL, unmodified Phase 1 engines:
 * a controlled synthetic fixture shows the preview correctly detects a real gate
 * flip (positive case), and every real production candidate is replayed through the
 * same code path as an adversarial self-check that no real candidate is silently
 * mis-scored as changing an outcome it does not.
 */

const at=new Date("2026-08-23T12:00:00Z");
const syntheticVerifiedRecruiterContact:AggregatedCandidate={
  id:"controlled-fixture-permian-contact",type:"CONTACT_AUTHORITY",opportunityId:"qual-permian",contextId:"qual-permian",
  market:"Permian Basin",company:"Strike",project:null,value:"Test Recruiter, 555-0100",category:null,
  contactPersonName:"Test Recruiter",routeTarget:"555-0100",routeType:"RECRUITER_PHONE",routeGrade:"B",
  evidenceIds:["evidence:controlled-fixture-permian-contact"],sourceIds:["controlled-fixture-source"],
  sourceUrls:["https://example.invalid/controlled-fixture"],observedAt:at,staleAfter:new Date("2026-12-01T00:00:00Z"),
  verificationState:"UNVERIFIED",reviewState:"READY_FOR_HUMAN_REVIEW",
  reason:"Controlled synthetic fixture -- not real evidence",contraryEvidence:[],
  provenance:{originService:"controlled-fixture",originFactId:null},
};

describe("Stage 2N-B: decisionPreview",()=>{
  it("returns undefined for a candidate with no tracked opportunityId",()=>{
    expect(decisionPreview({...syntheticVerifiedRecruiterContact,opportunityId:null})).toBeUndefined();
  });
  it("returns undefined for a candidate whose opportunityId is not a real Seed",()=>{
    expect(decisionPreview({...syntheticVerifiedRecruiterContact,opportunityId:"not-a-real-opportunity"})).toBeUndefined();
  });
  it("decisionPreviewForCandidate returns undefined for an unknown candidateId",()=>{
    expect(decisionPreviewForCandidate("no-such-candidate")).toBeUndefined();
  });
  it("current always matches the real qualificationDossiers() eligibility for that opportunity -- grounded in the same pipeline, not a re-derivation",()=>{
    const dossier=qualificationDossiers().find(d=>d.id==="qual-permian")!;
    const result=decisionPreview(syntheticVerifiedRecruiterContact)!;
    expect(result.current.eligibility).toEqual({
      VAMO_ELIGIBLE:dossier.eligibility.VAMO_ELIGIBLE.eligible,
      HOT_A_ELIGIBLE:dossier.eligibility.HOT_A_ELIGIBLE.eligible,
      HOT_B_ELIGIBLE:dossier.eligibility.HOT_B_ELIGIBLE.eligible,
    });
  });
  it("positive case: verifying a graded recruiter-phone contact on a seed with no other blockers flips VAMO and HOT-B eligible and produces a real score",()=>{
    const result=decisionPreview(syntheticVerifiedRecruiterContact)!;
    expect(result.current.eligibility).toEqual({VAMO_ELIGIBLE:false,HOT_A_ELIGIBLE:false,HOT_B_ELIGIBLE:false});
    expect(result.ifVerified.eligibility).toEqual({VAMO_ELIGIBLE:true,HOT_A_ELIGIBLE:false,HOT_B_ELIGIBLE:true});
    expect(result.current.score).toBeNull();
    // 48, not 46: Phase 2P fixed contactPeople (previously hardcoded empty on every
    // Seed-derived graph) to genuinely populate from a verified contact person, so
    // COMMERCIAL_SPECIFICITY's named-contact +2 can now actually apply.
    expect(result.ifVerified.score).toBe(48);
    expect(result.changed).toBe(true);
  });
  it("the hypothetical VERIFIED candidate passed in is never mutated or returned VERIFIED back to the caller",()=>{
    decisionPreview(syntheticVerifiedRecruiterContact);
    expect(syntheticVerifiedRecruiterContact.verificationState).toBe("UNVERIFIED");
  });
  it("real data adversarial self-check: verifying any real production candidate never changes the projected outcome, because a real unresolved conflict or missing evidence still blocks every path",()=>{
    const results=aggregatedCandidates()
      .filter((c):c is AggregatedCandidate&{opportunityId:string}=>c.opportunityId!==null)
      .map(c=>decisionPreview(c)!);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r=>r.changed===false)).toBe(true);
  });
  it("every real candidate resolves to a real tracked Seed",()=>{
    const ids=new Set(qualificationDossiers().map(d=>d.id));
    const withOpportunity=aggregatedCandidates().filter(c=>c.opportunityId!==null);
    expect(withOpportunity.every(c=>ids.has(c.opportunityId!))).toBe(true);
    expect(withOpportunity.every(c=>decisionPreviewForCandidate(c.id)!==undefined)).toBe(true);
  });
});
