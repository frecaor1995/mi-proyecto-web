import{describe,expect,it}from"vitest";
import type{ConversionAcceptanceEvidence,ConversionContactEvidence,ConversionEvidenceInput}from"../../domain/commercial-conversion";
import{NO_ACTIONABILITY_EVIDENCE}from"../../domain/opportunity-actionability";
import type{TrackedWorkforceDemandSignal}from"../../domain/multi-trade-workforce";
import{classificationForOccupation}from"../../domain/workforce-taxonomy";
import type{WorkforceClassification}from"../../domain/workforce-taxonomy";
import{
  evaluateWorkforceConversion,previewWorkforceConversion,rankWorkforceConversions,toDiscoverySignalShape,
}from"../../server/services/hot-conversion-engine/hot-conversion-engine-service";
import type{WorkforceEvidenceScopeInput}from"../../server/services/hot-conversion-engine/hot-conversion-engine-service";

const AT=new Date("2026-08-31T12:00:00Z");

const wfSignal=(over:Partial<TrackedWorkforceDemandSignal>&{externalId:string}):TrackedWorkforceDemandSignal=>({
  trackedId:`tracked:${over.externalId}`,signalId:`signal:${over.externalId}`,
  sourceKey:"fixture",sourceUrl:`https://fixture.invalid/${over.externalId}`,title:"Electrician",
  organization:"Fixture Co",location:"Houston, TX",classifications:[],roleMatches:[],tier:"STANDARD",
  observedAt:AT,reasons:[],ruleVersion:"fixture",...over,
});

const input=(over:Partial<ConversionEvidenceInput>&{externalId?:string}={}):ConversionEvidenceInput=>{
  const externalId=over.externalId??"s1";
  return{
    signal:toDiscoverySignalShape(wfSignal({externalId})),
    evidenceIds:["e1"],employer:"Fixture Co",companyRole:"PROBABLE_END_EMPLOYER",companyRoleEvidenceIds:["e1"],
    project:null,buyer:null,wage:null,perDiemOrIncentive:null,schedule:null,headcount:null,
    acceptance:null,contacts:[],actionability:NO_ACTIONABILITY_EVIDENCE(`conversion:${externalId}`),conflicts:[],
    ...over,
  };
};

const verifiedAcceptance=(over:Partial<ConversionAcceptanceEvidence> ={}):ConversionAcceptanceEvidence=>({
  id:"a1",category:"STAFFING_VENDOR_ACCEPTED",verificationState:"VERIFIED",accepted:true,
  observedAt:AT,validUntil:new Date("2027-01-01"),evidenceIds:["a1"],...over,
});
const verifiedContact=(over:Partial<ConversionContactEvidence> ={}):ConversionContactEvidence=>({
  id:"c1",organization:"Fixture Co",function:"PROCUREMENT",routeType:"PROCUREMENT_EMAIL",target:"p@fixture.invalid",
  gradeCandidate:"B",verificationState:"VERIFIED",observedAt:AT,staleAfter:new Date("2027-01-01"),evidenceIds:["c1"],...over,
});
const orgWideScope=(contactId="c1"):WorkforceEvidenceScopeInput=>({
  af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},
  contactScopes:{[contactId]:{gradeCandidate:"B",scope:"ORGANIZATION_WIDE",scopedTradeIds:[]}},
});
const electricalOnlyScope=(contactId="c1"):WorkforceEvidenceScopeInput=>({
  af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL"],scopeEvidenceText:"electrical only"},
  contactScopes:{[contactId]:{gradeCandidate:"B",scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL"]}},
});

const electrician=classificationForOccupation("ELECTRICIAN");
const welder=classificationForOccupation("WELDER");

describe("Phase 3E controlled complete paths (section 30)",()=>{
  it("A/B: ELECTRICIAN reaches ACTIVE HOT-A through the full gate stack",()=>{
    const d=evaluateWorkforceConversion({
      input:input({project:"Alpha",acceptance:verifiedAcceptance(),contacts:[verifiedContact()],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s1"),explicitStatus:"OPEN"}}),
      classification:electrician,projectRef:"project:alpha",scope:orgWideScope(),
    });
    expect(d.activeHotA).toBe(true);
    expect(d.readiness).toBe("READY");
    expect(d.distanceToHot.tier).toBe("AT_HOT");
    expect(d.nextBestAction).toBe("READY_FOR_COMMERCIAL_CONTACT");
  });
  it("B: WELDER reaches ACTIVE HOT-A through the SAME engine (no trade-specific HOT engine)",()=>{
    const d=evaluateWorkforceConversion({
      input:input({externalId:"s2",project:"Beta",acceptance:verifiedAcceptance({id:"a2",evidenceIds:["a2"]}),contacts:[verifiedContact({id:"c2",evidenceIds:["c2"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s2"),explicitStatus:"OPEN"}}),
      classification:welder,projectRef:"project:beta",
      scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"TRADE_SPECIFIC",scopedTradeIds:["WELDING"],scopeEvidenceText:"welding only"},contactScopes:{c2:{gradeCandidate:"B",scope:"TRADE_SPECIFIC",scopedTradeIds:["WELDING"]}}},
    });
    expect(d.activeHotA).toBe(true);
  });
  it("C: PIPEFITTER reaches HOT-B via a verified recruiter-path contact, without AF-01",()=>{
    const pipefitter=classificationForOccupation("PIPEFITTER");
    const d=evaluateWorkforceConversion({
      input:input({externalId:"s3",project:"Gamma",acceptance:null,contacts:[verifiedContact({id:"c3",routeType:"RECRUITER_EMAIL",gradeCandidate:"D",evidenceIds:["c3"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s3"),explicitStatus:"OPEN"}}),
      classification:pipefitter,projectRef:"project:gamma",
      scope:{af01:null,contactScopes:{c3:{gradeCandidate:"D",scope:"TRADE_SPECIFIC",scopedTradeIds:["PIPEFITTING"]}}},
    });
    expect(d.activeHotB).toBe(true);
    expect(d.activeHotA).toBe(false);
  });
});

describe("Phase 3E multi-trade controlled scenarios (section 28)",()=>{
  it("D: HVAC_TECHNICIAN blocked by missing AF-01",()=>{
    const d=evaluateWorkforceConversion({
      input:input({externalId:"s4",contacts:[verifiedContact({id:"c4",evidenceIds:["c4"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s4"),explicitStatus:"OPEN"}}),
      classification:classificationForOccupation("HVAC_TECHNICIAN"),projectRef:"project:delta",scope:orgWideScope("c4"),
    });
    expect(d.activeHotA).toBe(false);
    expect(d.blockers.some(b=>b.code==="MISSING_AF01")).toBe(true);
  });
  it("E: MILLWRIGHT blocked by contact authority scope",()=>{
    const d=evaluateWorkforceConversion({
      input:input({externalId:"s5",acceptance:verifiedAcceptance({id:"a5",evidenceIds:["a5"]}),contacts:[verifiedContact({id:"c5",evidenceIds:["c5"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s5"),explicitStatus:"OPEN"}}),
      classification:classificationForOccupation("MILLWRIGHT_CRAFT"),projectRef:"project:epsilon",
      scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},contactScopes:{c5:{gradeCandidate:"B",scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL"]}}},
    });
    expect(d.activeHotA).toBe(false);
    expect(d.blockers.some(b=>b.code==="CONTACT_AUTHORITY_SCOPE_UNSUPPORTED")).toBe(true);
  });
  it("F: FIBER_TECHNICIAN has UNKNOWN temporal status",()=>{
    const d=evaluateWorkforceConversion({
      input:input({externalId:"s6",acceptance:verifiedAcceptance({id:"a6",evidenceIds:["a6"]}),contacts:[verifiedContact({id:"c6",evidenceIds:["c6"]})]}),
      classification:classificationForOccupation("FIBER_TECHNICIAN"),projectRef:"project:zeta",scope:orgWideScope("c6"),
    });
    expect(d.temporalState).toBe("UNKNOWN");
    expect(d.activeHotA).toBe(false);
    expect(d.blockers.some(b=>b.code==="TEMPORAL_UNKNOWN")).toBe(true);
  });
  it("G: ELECTRICAL_SUPERINTENDENT keeps its SUPERVISION classification (not craft)",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"s7"}),classification:classificationForOccupation("ELECTRICAL_SUPERINTENDENT"),projectRef:"project:eta"});
    expect(d.roleClass).toBe("SUPERVISION");
    expect(d.workforceClassification.occupationId).toBe("ELECTRICAL_SUPERINTENDENT");
  });
  it("H: WELDING_ENGINEER is ENGINEERING, not WELDER craft",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"s8"}),classification:classificationForOccupation("WELDING_ENGINEER"),projectRef:"project:theta"});
    expect(d.roleClass).toBe("ENGINEERING");
    expect(d.workforceClassification.occupationId).not.toBe("WELDER");
  });
  it("I: same project -- electrician HOT-A, welder blocked, pipefitter a different state",()=>{
    const projectRef="project:iota";
    const elec=evaluateWorkforceConversion({input:input({externalId:"s9a",project:"Iota",acceptance:verifiedAcceptance({id:"a9a",evidenceIds:["a9a"]}),contacts:[verifiedContact({id:"c9a",evidenceIds:["c9a"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s9a"),explicitStatus:"OPEN"}}),classification:electrician,projectRef,scope:orgWideScope("c9a")});
    const weld=evaluateWorkforceConversion({input:input({externalId:"s9b",project:"Iota",acceptance:verifiedAcceptance({id:"a9b",evidenceIds:["a9b"]}),contacts:[verifiedContact({id:"c9b",evidenceIds:["c9b"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s9b"),explicitStatus:"OPEN"}}),classification:welder,projectRef,scope:electricalOnlyScope("c9b")});
    const pipe=evaluateWorkforceConversion({input:input({externalId:"s9c",project:"Iota"}),classification:classificationForOccupation("PIPEFITTER"),projectRef});
    expect(elec.projectRef).toBe(projectRef);
    expect(weld.projectRef).toBe(projectRef);
    expect(pipe.projectRef).toBe(projectRef);
    expect(elec.activeHotA).toBe(true);
    expect(weld.activeHotA).toBe(false);
    expect(weld.blockers.some(b=>b.code==="AF01_SCOPE_UNSUPPORTED")).toBe(true);
    expect(pipe.readiness).not.toBe("READY");
  });
  it("J: AF-01 electrical-only -- electrician passes scope, welder must block",()=>{
    const base=(externalId:string)=>input({externalId,acceptance:verifiedAcceptance({id:`a-${externalId}`,evidenceIds:[`a-${externalId}`]}),contacts:[verifiedContact({id:`c-${externalId}`,evidenceIds:[`c-${externalId}`]})],actionability:{...NO_ACTIONABILITY_EVIDENCE(`conversion:${externalId}`),explicitStatus:"OPEN"}});
    const elec=evaluateWorkforceConversion({input:base("s10a"),classification:electrician,projectRef:"project:j1",scope:electricalOnlyScope("c-s10a")});
    const weld=evaluateWorkforceConversion({input:base("s10b"),classification:welder,projectRef:"project:j2",scope:electricalOnlyScope("c-s10b")});
    expect(elec.af01ScopeCoversTrade).toBe(true);
    expect(weld.af01ScopeCoversTrade).toBe(false);
    expect(weld.activeHotA).toBe(false);
  });
  it("K: organization-wide craft acceptance covers multiple craft trades only when explicitly scoped",()=>{
    const multi:WorkforceEvidenceScopeInput={af01:{category:"CRAFT_LABOR_VENDOR_ACCEPTED",scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL","WELDING"],scopeEvidenceText:"electrical and welding"},contactScopes:{"c-s11a":{gradeCandidate:"B",scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL","WELDING"]},"c-s11b":{gradeCandidate:"B",scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL","WELDING"]}}};
    const base=(externalId:string)=>input({externalId,project:"K Project",acceptance:verifiedAcceptance({id:`a-${externalId}`,evidenceIds:[`a-${externalId}`]}),contacts:[verifiedContact({id:`c-${externalId}`,evidenceIds:[`c-${externalId}`]})],actionability:{...NO_ACTIONABILITY_EVIDENCE(`conversion:${externalId}`),explicitStatus:"OPEN"}});
    const elec=evaluateWorkforceConversion({input:base("s11a"),classification:electrician,projectRef:"project:k",scope:multi});
    const weld=evaluateWorkforceConversion({input:base("s11b"),classification:welder,projectRef:"project:k",scope:multi});
    expect(elec.activeHotA).toBe(true);
    expect(weld.activeHotA).toBe(true);
  });
  it("L: contact authority electrical-only must not unlock welding",()=>{
    const scope:WorkforceEvidenceScopeInput={af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},contactScopes:{"c-s12":{gradeCandidate:"B",scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL"]}}};
    const d=evaluateWorkforceConversion({input:input({externalId:"s12",acceptance:verifiedAcceptance({id:"a-s12",evidenceIds:["a-s12"]}),contacts:[verifiedContact({id:"c-s12",evidenceIds:["c-s12"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s12"),explicitStatus:"OPEN"}}),classification:welder,projectRef:"project:l",scope});
    expect(d.contactAuthorityScopeCoversTrade).toBe(false);
    expect(d.activeHotA).toBe(false);
  });
});

describe("Phase 3E required false-conversion tests (section 29)",()=>{
  const bare=(externalId:string,over:Partial<ConversionEvidenceInput> ={})=>input({externalId,...over});
  const evalBare=(externalId:string,over:Partial<ConversionEvidenceInput> ={},classification=electrician)=>evaluateWorkforceConversion({input:bare(externalId,over),classification,projectRef:`project:${externalId}`});

  it("1 demand alone != HOT",()=>{const d=evalBare("f1");expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("2 OPEN alone != HOT",()=>{const d=evalBare("f2",{actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:f2"),explicitStatus:"OPEN"}});expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("3 project verified alone != HOT",()=>{const d=evalBare("f3",{project:"Solo Project"});expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("4 buyer verified alone != HOT",()=>{const d=evalBare("f4",{buyer:"Some Buyer"});expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("5 supplier portal (grade E route) alone != HOT",()=>{const d=evalBare("f5",{contacts:[verifiedContact({id:"c-f5",gradeCandidate:"E",evidenceIds:["c-f5"]})]});expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("6 Grade C route alone != HOT-A (no AF-01)",()=>{const d=evalBare("f6",{contacts:[verifiedContact({id:"c-f6",gradeCandidate:"C",evidenceIds:["c-f6"]})]});expect(d.activeHotA).toBe(false)});
  it("7/28 high score != HOT when only weaker (VAMO) eligibility is satisfied",()=>{const d=evalBare("f7",{wage:"$45/hr",perDiemOrIncentive:"$150/day",headcount:100,schedule:"6x10",contacts:[verifiedContact({id:"c-f7",gradeCandidate:"C",evidenceIds:["c-f7"]})]});expect(d.score.score).not.toBeNull();expect(d.eligibility.find(e=>e.eligibilityType==="VAMO_ELIGIBLE")?.eligible).toBe(true);expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("8 high headcount != HOT",()=>{const d=evalBare("f8",{headcount:500});expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("9 high pay != HOT",()=>{const d=evalBare("f9",{wage:"$80/hr"});expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("10 per diem != HOT",()=>{const d=evalBare("f10",{perDiemOrIncentive:"$200/day"});expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("11 data-center employer wording != HOT",()=>{const d=evalBare("f11",{employer:"Big Data Center Co"});expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("12 recent posting != HOT",()=>{const d=evalBare("f12",{signal:toDiscoverySignalShape(wfSignal({externalId:"f12",observedAt:AT}))});expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("13 candidate AF01 != verified AF01",()=>{const d=evalBare("f13",{acceptance:verifiedAcceptance({id:"a-f13",verificationState:"UNVERIFIED",evidenceIds:["a-f13"]})});expect(d.af01State).toBe("CANDIDATE");expect(d.activeHotA).toBe(false)});
  it("14 stale AF01 does not satisfy current requirement",()=>{const d=evalBare("f14",{acceptance:verifiedAcceptance({id:"a-f14",validUntil:new Date("2025-01-01"),evidenceIds:["a-f14"]}),contacts:[verifiedContact({id:"c-f14",evidenceIds:["c-f14"]})]},electrician);expect(d.af01State).toBe("STALE");expect(d.activeHotA).toBe(false)});
  it("15 conflicting/rejected AF01 blocks",()=>{const d=evalBare("f15",{acceptance:verifiedAcceptance({id:"a-f15",verificationState:"REJECTED",accepted:false,evidenceIds:["a-f15"]})});expect(d.af01State).toBe("REJECTED");expect(d.blockers.some(b=>b.code==="AF01_CONFLICT")).toBe(true)});
  it("16 candidate contact != verified actionable contact",()=>{const d=evalBare("f16",{acceptance:verifiedAcceptance({id:"a-f16",evidenceIds:["a-f16"]}),contacts:[verifiedContact({id:"c-f16",verificationState:"UNVERIFIED",evidenceIds:["c-f16"]})]});expect(d.contactState).toBe("CANDIDATE");expect(d.activeHotA).toBe(false)});
  it("17 stale contact does not satisfy current actionable route",()=>{const d=evalBare("f17",{acceptance:verifiedAcceptance({id:"a-f17",evidenceIds:["a-f17"]}),contacts:[verifiedContact({id:"c-f17",staleAfter:new Date("2025-01-01"),evidenceIds:["c-f17"]})]});expect(d.blockers.some(b=>b.code==="CONTACT_STALE")).toBe(true);expect(d.activeHotA).toBe(false)});
  it("20 project OPEN != demand temporal OPEN",()=>{const d=evalBare("f20",{project:"Named Project"});expect(d.temporalState).toBe("UNKNOWN")});
  it("22 UNKNOWN temporal != OPEN",()=>{const d=evalBare("f22");expect(d.temporalState).toBe("UNKNOWN");expect(d.activeHotA||d.activeHotB).toBe(false)});
  it("23 CLOSED != Active HOT even with otherwise-complete evidence",()=>{
    const d=evaluateWorkforceConversion({input:bare("f23",{acceptance:verifiedAcceptance({id:"a-f23",evidenceIds:["a-f23"]}),contacts:[verifiedContact({id:"c-f23",evidenceIds:["c-f23"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:f23"),explicitStatus:"CLOSED"}}),classification:electrician,projectRef:"project:f23",scope:orgWideScope("c-f23")});
    expect(d.temporalState).toBe("CLOSED");expect(d.activeHotA||d.activeHotB).toBe(false);
  });
  it("24 CANCELLED != Active HOT",()=>{
    const d=evaluateWorkforceConversion({input:bare("f24",{acceptance:verifiedAcceptance({id:"a-f24",evidenceIds:["a-f24"]}),contacts:[verifiedContact({id:"c-f24",evidenceIds:["c-f24"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:f24"),explicitStatus:"CANCELLED"}}),classification:electrician,projectRef:"project:f24",scope:orgWideScope("c-f24")});
    expect(d.temporalState).toBe("CANCELLED");expect(d.activeHotA||d.activeHotB).toBe(false);
  });
  it("25 EXPIRED != Active HOT",()=>{
    const d=evaluateWorkforceConversion({input:bare("f25",{acceptance:verifiedAcceptance({id:"a-f25",evidenceIds:["a-f25"]}),contacts:[verifiedContact({id:"c-f25",evidenceIds:["c-f25"]})],actionability:{opportunityId:"conversion:f25",explicitStatus:null,explicitStatusFreshUntil:null,deadlines:[{kind:"ORIGINAL",date:new Date("2025-01-01"),observedAt:AT,evidenceIds:["d-f25"]}],startDate:null,evidenceIds:["d-f25"]}}),classification:electrician,projectRef:"project:f25",scope:orgWideScope("c-f25")});
    expect(d.temporalState).toBe("EXPIRED");expect(d.activeHotA||d.activeHotB).toBe(false);
  });
  it("26 human review item present != human approval",()=>{const d=evalBare("f26",{acceptance:verifiedAcceptance({id:"a-f26",verificationState:"UNVERIFIED",evidenceIds:["a-f26"]})});expect(d.humanVerificationItemCount).toBeGreaterThan(0);expect(d.activeHotA).toBe(false)});
  it("27/31 decision preview is never persisted",()=>{
    const p=previewWorkforceConversion({input:bare("f27"),classification:electrician,projectRef:"project:f27"},{explicitStatus:"OPEN"});
    expect(p.persisted).toBe(false);
  });
  it("29 commercial recommendation cannot bypass a blocked gate",()=>{
    const d=evalBare("f29",{wage:"$60/hr",contacts:[verifiedContact({id:"c-f29",evidenceIds:["c-f29"]})]});
    const g12=d.gates.find(g=>g.gateId==="G12_COMMERCIAL_ACTION")!;
    expect(d.activeHotA||d.activeHotB).toBe(false);
    expect(g12.blockingEffect).toBe(true);
  });
  it("30 no automatic outreach anywhere in the dossier",()=>{
    const d=evalBare("f30",{wage:"$60/hr"});
    expect(JSON.stringify(d)).not.toMatch(/emailSent|outreachExecuted|smsSent|callPlaced|formSubmitted/);
  });
});

describe("Phase 3E gate model, blockers, priority, readiness, distance-to-HOT",()=>{
  it("gates cover all 13 conceptual gate ids",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"g1"}),classification:electrician,projectRef:"project:g1"});
    expect(d.gates.map(g=>g.gateId)).toEqual(["G1_WORKFORCE_DEMAND","G2_WORKFORCE_CLASSIFICATION","G3_ORGANIZATION_RESOLUTION","G4_PROJECT_RELATIONSHIP_CONTEXT","G5_EXTERNAL_MANPOWER_ACCEPTANCE","G6_BUYER_VENDOR_ROUTE","G7_ACTIONABLE_CONTACT","G8_TEMPORAL_ACTIONABILITY","G9_HUMAN_VERIFICATION_CONFLICT_SAFETY","G10_ELIGIBILITY","G11_SCORE","G12_COMMERCIAL_ACTION","G13_ACTIVE_HOT"]);
  });
  it("missing workforce classification produces gate G2 UNKNOWN and a blocker",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"g2"}),classification:{state:"UNKNOWN",industryId:null,disciplineId:null,tradeId:null,occupationId:null,roleClass:"UNKNOWN",specialtyIds:[],skillIds:[],credentialIds:[]}as WorkforceClassification,projectRef:"project:g2"});
    expect(d.gates.find(g=>g.gateId==="G2_WORKFORCE_CLASSIFICATION")?.state).toBe("UNKNOWN");
    expect(d.blockers.some(b=>b.code==="MISSING_WORKFORCE_CLASSIFICATION")).toBe(true);
  });
  it("blockers are prioritized deterministically (eligibility/HOT-affecting first)",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"g3"}),classification:electrician,projectRef:"project:g3"});
    const again=evaluateWorkforceConversion({input:input({externalId:"g3"}),classification:electrician,projectRef:"project:g3"});
    expect(d.blockers.map(b=>b.code)).toEqual(again.blockers.map(b=>b.code));
    expect(d.blockers[0].couldChangeEligibility||d.blockers[0].couldChangeActiveHot).toBe(true);
  });
  it("distance-to-HOT is a bounded deterministic tier, never a percentage",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"g4"}),classification:electrician,projectRef:"project:g4"});
    expect(["AT_HOT","NEAR","FAR","INACTIVE"]).toContain(d.distanceToHot.tier);
    expect(typeof d.distanceToHot.blockingGatesRemaining).toBe("number");
  });
  it("closure plan is deterministic and idempotent (no duplicate task types)",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"g5"}),classification:electrician,projectRef:"project:g5"});
    const again=evaluateWorkforceConversion({input:input({externalId:"g5"}),classification:electrician,projectRef:"project:g5"});
    expect(d.closurePlan.map(t=>t.id)).toEqual(again.closurePlan.map(t=>t.id));
    expect(new Set(d.closurePlan.map(t=>t.id)).size).toBe(d.closurePlan.length);
  });
  it("readiness reflects zero-HOT correctly (BLOCKED/INSUFFICIENT_EVIDENCE, not fabricated READY)",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"g6"}),classification:electrician,projectRef:"project:g6"});
    expect(d.readiness).not.toBe("READY");
  });
  it("ranking never uses pay/headcount alone -- readiness/tier dominates",()=>{
    const richButBlocked=evaluateWorkforceConversion({input:input({externalId:"g7",wage:"$90/hr",headcount:999}),classification:electrician,projectRef:"project:g7"});
    const readyLowInfo=evaluateWorkforceConversion({input:input({externalId:"g8",project:"P",acceptance:verifiedAcceptance({id:"a-g8",evidenceIds:["a-g8"]}),contacts:[verifiedContact({id:"c-g8",evidenceIds:["c-g8"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:g8"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:g8",scope:orgWideScope("c-g8")});
    const ranked=rankWorkforceConversions([richButBlocked,readyLowInfo]);
    expect(ranked[0].dossier.opportunityId).toBe(readyLowInfo.opportunityId);
    expect(ranked[0].priorityTier).toBe("ACTIVE_HOT");
  });
});

describe("Phase 3E scoring/actionability/conflict/human-verification safety",()=>{
  it("scoring cannot rescue an ineligible opportunity",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"s-safety-1",wage:"$100/hr",perDiemOrIncentive:"$150/day",headcount:100}),classification:electrician,projectRef:"project:s1"});
    expect(d.eligibility.every(e=>!e.eligible)).toBe(true);
    expect(d.activeHotA||d.activeHotB).toBe(false);
  });
  it("blocking conflicts are surfaced, not silently dropped",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"s-safety-2",acceptance:verifiedAcceptance({id:"a-s2",evidenceIds:["a-s2"]}),contacts:[verifiedContact({id:"c-s2",evidenceIds:["c-s2"]})],conflicts:["conflicting employer identity"]}),classification:electrician,projectRef:"project:s2",scope:orgWideScope("c-s2")});
    expect(d.conflicts).toContain("conflicting employer identity");
    expect(d.blockers.some(b=>b.code==="BLOCKING_CONFLICT")).toBe(true);
    expect(d.activeHotA||d.activeHotB).toBe(false);
  });
  it("human verification items are generated but never auto-approved",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"s-safety-3"}),classification:electrician,projectRef:"project:s3"});
    expect(d.humanVerificationItemCount).toBeGreaterThan(0);
    expect(JSON.stringify(d)).not.toMatch(/"decision":"VERIFY"|autoVerified/);
  });
});

describe("Phase 3E evidence-closure planner reuse of Phase 3A-style tasks",()=>{
  it("does not generate a task for a requirement already satisfied",()=>{
    const d=evaluateWorkforceConversion({input:input({externalId:"cp1",acceptance:verifiedAcceptance({id:"a-cp1",evidenceIds:["a-cp1"]}),contacts:[verifiedContact({id:"c-cp1",evidenceIds:["c-cp1"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:cp1"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:cp1",scope:orgWideScope("c-cp1")});
    expect(d.closurePlan.some(t=>t.taskType==="FIND_AF01_EVIDENCE")).toBe(false);
    expect(d.closurePlan.some(t=>t.taskType==="FIND_ACTIONABLE_CONTACT")).toBe(false);
  });
});
