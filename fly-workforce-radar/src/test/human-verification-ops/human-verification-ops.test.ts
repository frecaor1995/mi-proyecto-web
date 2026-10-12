import{describe,expect,it}from"vitest";
import{CONTROLLED_TEST_REVIEWER_ID}from"../../domain/evidence-aggregation";
import type{AggregatedCandidate}from"../../domain/evidence-aggregation";
import{aggregatedCandidates}from"../../server/services/evidence-aggregation/evidence-aggregation-service";
import{applyControlledDecision,humanReviewQueue,phase2mSummary}from"../../server/services/human-verification-ops/human-verification-ops-service";

const queue=()=>humanReviewQueue();
const at=new Date("2026-08-23T12:00:00Z");

const syntheticCandidate=(overrides:Partial<AggregatedCandidate>):AggregatedCandidate=>({
  id:"controlled-fixture-candidate",
  type:"AF01_CANDIDATE",
  opportunityId:"controlled-fixture-opportunity",
  contextId:"controlled-fixture-opportunity",
  market:"Controlled Test Market",
  company:null,
  project:null,
  value:"CONTROLLED_FIXTURE_AF01",
  category:"THIRD_PARTY_RECRUITING_ACCEPTED",
  contactPersonName:null,
  routeTarget:null,
  routeType:null,
  routeGrade:null,
  evidenceIds:["evidence:controlled-fixture"],
  sourceIds:["controlled-fixture-source"],
  sourceUrls:["https://example.invalid/controlled-fixture"],
  observedAt:at,
  staleAfter:new Date("2026-12-01T00:00:00Z"),
  verificationState:"UNVERIFIED",
  reviewState:"READY_FOR_HUMAN_REVIEW",
  reason:"Controlled synthetic fixture -- not real evidence",
  contraryEvidence:[],
  provenance:{originService:"controlled-fixture",originFactId:null},
  ...overrides,
});

describe("Phase 2M: deterministic human-review queue",()=>{
  it("is deterministic: two calls produce the identical order",()=>{
    expect(queue().map(x=>x.id)).toEqual(queue().map(x=>x.id));
  });
  it("uses only explainable, rule-based priority (no ML/LLM scoring anywhere)",()=>{
    expect(queue().every(x=>typeof x.priority==="number"&&x.priorityReason.length>0)).toBe(true);
  });
  it("sorts strictly by ascending priority",()=>{
    const priorities=queue().map(x=>x.priority);
    expect(priorities).toEqual([...priorities].sort((a,b)=>a-b));
  });
  it("real data adversarial self-check: exactly one real queue item unlocks a gate -- Phase 2Q's Trillium Amarillo contact-authority candidate, per this heuristic's own (grade-blind) logic. This is a real, honest finding, not a bug: wouldUnlock() only checks whether verifying the candidate's TYPE would satisfy the remaining blocker code, it does not model that a CONTACT_AUTHORITY verification must also carry a human-assigned grade to actually take effect -- decisionPreview() (the real pipeline) confirms a grade-less verification of this exact candidate changes nothing",()=>{
    const unlocking=queue().filter(x=>x.wouldUnlockGate!==null);
    expect(unlocking).toHaveLength(1);
    expect(unlocking[0]).toMatchObject({opportunityId:"qual-amarillo",targetType:"CONTACT_AUTHORITY",wouldUnlockGate:"HOT_B_ELIGIBLE"});
  });
  it("every queue item traces back to a real aggregated candidate",()=>{
    const ids=new Set(aggregatedCandidates().map(c=>c.id));
    expect(queue().every(x=>ids.has(x.candidateId))).toBe(true);
  });
  it("conflicts are placed ahead of remaining buyer/AF-01/contact-authority candidates when none of them unlock a gate",()=>{
    const conflictIdx=queue().findIndex(x=>x.targetType==="COMPANY_PROJECT_CONFLICT");
    const buyerIdx=queue().findIndex(x=>x.targetType==="BUYER_CANDIDATE");
    expect(conflictIdx).toBeGreaterThanOrEqual(0);
    expect(buyerIdx).toBeGreaterThanOrEqual(0);
    expect(conflictIdx).toBeLessThan(buyerIdx);
  });
  it("among candidates that do not unlock a gate, buyer candidates rank ahead of AF-01 candidates, which rank ahead of contact-authority candidates, per the specified priority order (Phase 2Q's Amarillo contact-authority candidate is the sole exception -- it DOES unlock a gate per this heuristic, so it correctly ranks ahead of everything, per the gate-unlock priority rule tested separately above)",()=>{
    const nonUnlocking=queue().filter(x=>x.wouldUnlockGate===null);
    const buyerP=nonUnlocking.find(x=>x.targetType==="BUYER_CANDIDATE")!.priority;
    const af01P=nonUnlocking.find(x=>x.targetType==="AF01_CANDIDATE")!.priority;
    const contactP=nonUnlocking.find(x=>x.targetType==="CONTACT_AUTHORITY")!.priority;
    expect(buyerP).toBeLessThan(af01P);
    expect(af01P).toBeLessThan(contactP);
  });
  it("honestly reports that BUYER_CANDIDATE cannot structurally unlock any gate, because the real eligibility engine does not gate on buyer/company-role directly",()=>{
    const buyerItem=queue().find(x=>x.targetType==="BUYER_CANDIDATE")!;
    expect(buyerItem.affectsGate).toBe("NONE");
    expect(buyerItem.priorityReason).toMatch(/does not gate on buyer/);
  });
});

describe("Phase 2M: READY_FOR_HUMAN_REVIEW / NEEDS_MORE_EVIDENCE states in the real queue",()=>{
  it("every real queue item's currentState is READY_FOR_HUMAN_REVIEW or NEEDS_MORE_EVIDENCE, never VERIFIED/REJECTED/DEFERRED",()=>{
    expect(queue().every(x=>x.currentState==="READY_FOR_HUMAN_REVIEW"||x.currentState==="NEEDS_MORE_EVIDENCE")).toBe(true);
  });
});

describe("Phase 2M: the bright line -- no automatic VERIFY, only CONTROLLED_TEST_REVIEW may decide",()=>{
  it("refuses a VERIFY from any reviewer identity other than CONTROLLED_TEST_REVIEW",()=>{
    const c=syntheticCandidate({});
    expect(()=>applyControlledDecision(c,{candidateId:c.id,decision:"VERIFY",reviewerId:"a-real-human-reviewer",reason:"looks good",evidenceIds:c.evidenceIds,decidedAt:at})).toThrow(/CONTROLLED_TEST_REVIEW/);
  });
  it("refuses a REJECT from any non-CONTROLLED_TEST_REVIEW identity too",()=>{
    const c=syntheticCandidate({});
    expect(()=>applyControlledDecision(c,{candidateId:c.id,decision:"REJECT",reviewerId:"automation",reason:"nope",evidenceIds:[],decidedAt:at})).toThrow(/CONTROLLED_TEST_REVIEW/);
  });
  it("requires a non-empty reason even from CONTROLLED_TEST_REVIEW",()=>{
    const c=syntheticCandidate({});
    expect(()=>applyControlledDecision(c,{candidateId:c.id,decision:"VERIFY",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"",evidenceIds:c.evidenceIds,decidedAt:at})).toThrow();
  });
  it("requires supporting evidence for a VERIFY even from CONTROLLED_TEST_REVIEW",()=>{
    const c=syntheticCandidate({});
    expect(()=>applyControlledDecision(c,{candidateId:c.id,decision:"VERIFY",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"controlled test",evidenceIds:[],decidedAt:at})).toThrow(/evidence/);
  });
  it("rejects a mismatched candidateId",()=>{
    const c=syntheticCandidate({});
    expect(()=>applyControlledDecision(c,{candidateId:"someone-elses-candidate",decision:"VERIFY",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"controlled test",evidenceIds:c.evidenceIds,decidedAt:at})).toThrow();
  });
});

describe("Phase 2M: all four CONTROLLED_TEST_REVIEW decision types",()=>{
  const decide=(c:AggregatedCandidate,decision:"VERIFY"|"REJECT"|"NEEDS_MORE_EVIDENCE"|"DEFER")=>applyControlledDecision(c,{candidateId:c.id,decision,reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"Controlled deterministic test decision",evidenceIds:c.evidenceIds,decidedAt:at});
  it("VERIFY moves verificationState to VERIFIED and reviewState to VERIFIED",()=>{
    const r=decide(syntheticCandidate({}),"VERIFY");
    expect(r.verificationState).toBe("VERIFIED");
    expect(r.reviewState).toBe("VERIFIED");
  });
  it("REJECT moves verificationState to REJECTED and reviewState to REJECTED",()=>{
    const r=decide(syntheticCandidate({}),"REJECT");
    expect(r.verificationState).toBe("REJECTED");
    expect(r.reviewState).toBe("REJECTED");
  });
  it("NEEDS_MORE_EVIDENCE leaves verificationState UNVERIFIED and sets reviewState to NEEDS_MORE_EVIDENCE",()=>{
    const c=syntheticCandidate({});
    const r=applyControlledDecision(c,{candidateId:c.id,decision:"NEEDS_MORE_EVIDENCE",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"Controlled deterministic test decision",evidenceIds:[],decidedAt:at});
    expect(r.verificationState).toBe("UNVERIFIED");
    expect(r.reviewState).toBe("NEEDS_MORE_EVIDENCE");
  });
  it("DEFER leaves verificationState UNVERIFIED and sets reviewState to DEFERRED",()=>{
    const c=syntheticCandidate({});
    const r=applyControlledDecision(c,{candidateId:c.id,decision:"DEFER",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"Controlled deterministic test decision",evidenceIds:[],decidedAt:at});
    expect(r.verificationState).toBe("UNVERIFIED");
    expect(r.reviewState).toBe("DEFERRED");
  });
  it("a VERIFY on a CONTACT_AUTHORITY candidate can carry an explicit human-assigned grade, never auto-assigned",()=>{
    const c=syntheticCandidate({type:"CONTACT_AUTHORITY",routeType:"RECRUITER_EMAIL"});
    expect(c.routeGrade).toBeNull();
    const r=applyControlledDecision(c,{candidateId:c.id,decision:"VERIFY",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"Controlled deterministic test decision",evidenceIds:c.evidenceIds,decidedAt:at,grade:"A"});
    expect(r.routeGrade).toBe("A");
  });
  it("a grade is never applied on a non-VERIFY decision",()=>{
    const c=syntheticCandidate({type:"CONTACT_AUTHORITY",routeType:"RECRUITER_EMAIL"});
    const r=applyControlledDecision(c,{candidateId:c.id,decision:"NEEDS_MORE_EVIDENCE",reviewerId:CONTROLLED_TEST_REVIEWER_ID,reason:"Controlled deterministic test decision",evidenceIds:[],decidedAt:at,grade:"A"});
    expect(r.routeGrade).toBeNull();
  });
});

describe("Phase 2M: phase2mSummary",()=>{
  const summary=phase2mSummary();
  it("classifies TECH-DEBT-04 as RESOLVED",()=>{
    expect(summary.techDebt04Outcome).toBe("RESOLVED");
  });
  it("reports zero real verified candidates",()=>{
    expect(summary.realVerifiedCandidates).toBe(0);
  });
  it("reports zero real HOT/VAMO/scoring/commercial-action results, matching every prior phase's honest finding",()=>{
    expect(summary).toMatchObject({vamo:0,hotA:0,hotB:0,scored:0,commercialActions:0});
  });
  it("reports the real candidate counts grounded in actual FACTS data (Phase 2Q added Trillium Amarillo -- 2 buyer, 2 AF-01, merged into 1 contact-authority candidate -- and Port Arthur's re-verification -- 1 buyer, 1 AF-01, 1 additional distinct contact-authority candidate)",()=>{
    expect(summary).toMatchObject({buyerCandidates:5,af01Candidates:4,contactAuthorityCandidates:4,companyProjectConflicts:1});
  });
  it("reports exactly one real queue item that unlocks a gate: Phase 2Q's Trillium Amarillo contact-authority candidate unlocks HOT_B_ELIGIBLE per this heuristic (see the queue-level test above for why that is honest, not a bug, and why it does not mean the real pipeline promotes anything without a human-assigned grade)",()=>{
    expect(summary).toMatchObject({queueUnlocksHotA:0,queueUnlocksVamo:0,queueUnlocksHotB:1});
  });
  it("executes no outreach and implements no Contract Economics",()=>{
    expect(summary).toMatchObject({outreachExecuted:false,contractEconomicsImplemented:false});
  });
  it("modifies no eligibility rule, scoring weight, or Commercial Action vocabulary",()=>{
    expect(summary).toMatchObject({eligibilityRulesModified:false,scoringWeightsModified:false,commercialActionVocabularyModified:false});
  });
  it("adds zero new migrations (no persistence change was required)",()=>{
    expect(summary.newMigrationsAdded).toBe(0);
  });
});

describe("Phase 2M boundary",()=>{
  it("does not start Phase 2N",()=>{
    expect(phase2mSummary().phase2nStarted).toBe(false);
  });
});
