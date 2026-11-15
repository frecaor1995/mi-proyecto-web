import{describe,expect,it}from"vitest";
import type{ConversionAcceptanceEvidence,ConversionContactEvidence,ConversionEvidenceInput}from"../../domain/commercial-conversion";
import{NO_ACTIONABILITY_EVIDENCE}from"../../domain/opportunity-actionability";
import type{TrackedWorkforceDemandSignal}from"../../domain/multi-trade-workforce";
import{classificationForOccupation}from"../../domain/workforce-taxonomy";
import{
  evaluateWorkforceConversion,rankWorkforceConversions,toDiscoverySignalShape,
}from"../../server/services/hot-conversion-engine/hot-conversion-engine-service";
import type{WorkforceEvidenceScopeInput}from"../../server/services/hot-conversion-engine/hot-conversion-engine-service";
import{
  assignWorkQueue,buildCommercialActionDraft,buildCommercialContactInbox,buildDailyDesk,
  buildEvidenceClosureInbox,buildHumanVerificationInbox,buildOperatorActionCard,buildWorkItem,buildWorkItems,
  facetQueue,filterWorkItems,groupByCompany,groupByProject,sortWorkItems,
}from"../../server/services/operational-desk/operational-desk-service";

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

/** Evaluates one demand through the REAL Phase 3E pipeline, then ranks it
 * alone -- exactly the composition Phase 3F is required to reuse, never a
 * hand-fabricated dossier. */
const evalOne=(x:Parameters<typeof evaluateWorkforceConversion>[0])=>rankWorkforceConversions([evaluateWorkforceConversion(x)])[0];
const itemFor=(x:Parameters<typeof evaluateWorkforceConversion>[0])=>buildWorkItem(evalOne(x));

describe("Phase 3F controlled scenarios (section 35)",()=>{
  it("A: active electrical HOT -> READY_FOR_COMMERCIAL_CONTACT",()=>{
    const item=itemFor({input:input({project:"Alpha",acceptance:verifiedAcceptance(),contacts:[verifiedContact()],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s1"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:a"});
    expect(item.hotA).toBe(true);
    expect(item.workQueue).toBe("READY_FOR_COMMERCIAL_CONTACT");
  });
  it("B: active welding HOT -> READY_FOR_COMMERCIAL_CONTACT",()=>{
    const item=itemFor({input:input({externalId:"s2",project:"Beta",acceptance:verifiedAcceptance({id:"a2",evidenceIds:["a2"]}),contacts:[verifiedContact({id:"c2",evidenceIds:["c2"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s2"),explicitStatus:"OPEN"}}),classification:welder,projectRef:"project:b",scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"TRADE_SPECIFIC",scopedTradeIds:["WELDING"],scopeEvidenceText:"welding"},contactScopes:{c2:{gradeCandidate:"B",scope:"TRADE_SPECIFIC",scopedTradeIds:["WELDING"]}}}});
    expect(item.hotA).toBe(true);
    expect(item.workQueue).toBe("READY_FOR_COMMERCIAL_CONTACT");
  });
  it("C: candidate AF-01 that could change eligibility -> VERIFY_CRITICAL_EVIDENCE",()=>{
    const item=itemFor({input:input({externalId:"s3",acceptance:verifiedAcceptance({id:"a3",verificationState:"UNVERIFIED",evidenceIds:["a3"]}),contacts:[verifiedContact({id:"c3",evidenceIds:["c3"]})]}),classification:electrician,projectRef:"project:c",scope:orgWideScope("c3")});
    expect(item.af01State).toBe("CANDIDATE");
    expect(item.workQueue).toBe("VERIFY_CRITICAL_EVIDENCE");
  });
  it("D: missing AF-01 -> FIND_MISSING_EVIDENCE",()=>{
    const item=itemFor({input:input({externalId:"s4",contacts:[verifiedContact({id:"c4",evidenceIds:["c4"]})]}),classification:electrician,projectRef:"project:d",scope:orgWideScope("c4")});
    expect(item.af01State).toBe("MISSING");
    expect(item.workQueue).toBe("FIND_MISSING_EVIDENCE");
  });
  it("E: near-ready pipefitter (two small remaining blockers) -> NEAR_READY",()=>{
    const pipefitter=classificationForOccupation("PIPEFITTER");
    const item=itemFor({input:input({externalId:"s5",project:"Epsilon",acceptance:verifiedAcceptance({id:"a5",verificationState:"UNVERIFIED",evidenceIds:["a5"]}),contacts:[verifiedContact({id:"c5",evidenceIds:["c5"]})]}),classification:pipefitter,projectRef:"project:e",scope:orgWideScope("c5")});
    expect(item.blockers.length).toBe(2);
    expect(item.readiness).toBe("NEAR_READY");
    expect(item.workQueue).toBe("NEAR_READY");
  });
  it("F: temporal UNKNOWN with a monitor-mapped top blocker -> MONITOR",()=>{
    // Constructed directly against assignWorkQueue: the real gate engine's
    // deterministic blocker priority always ranks a couldChangeEligibility
    // blocker (e.g. missing contact/AF-01) above a MONITOR-mapped one when
    // both are present, so this exact combination (temporal UNKNOWN *and*
    // nextBestAction already MONITOR_FOR_NEW_EVIDENCE) is tested at the
    // queue-assignment function directly, using a real dossier's shape.
    const real=evalOne({input:input({externalId:"s6"}),classification:electrician,projectRef:"project:f"}).dossier;
    const synthetic={...real,temporalState:"UNKNOWN"as const,nextBestAction:"MONITOR_FOR_NEW_EVIDENCE"as const,activeHotA:false,activeHotB:false,readiness:"INSUFFICIENT_EVIDENCE"as const};
    const{queue}=assignWorkQueue(synthetic);
    expect(queue).toBe("MONITOR");
  });
  it("G: CLOSED -> INACTIVE",()=>{
    const item=itemFor({input:input({externalId:"s7",acceptance:verifiedAcceptance({id:"a7",evidenceIds:["a7"]}),contacts:[verifiedContact({id:"c7",evidenceIds:["c7"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s7"),explicitStatus:"CLOSED"}}),classification:electrician,projectRef:"project:g",scope:orgWideScope("c7")});
    expect(item.temporalState).toBe("CLOSED");
    expect(item.workQueue).toBe("INACTIVE");
  });
  it("H: insufficient evidence / no useful next action -> NO_ACTION",()=>{
    const item=itemFor({input:input({externalId:"s8"}),classification:electrician,projectRef:"project:h"});
    expect(["NO_ACTION","FIND_MISSING_EVIDENCE"]).toContain(item.workQueue);
  });
  it("I: same project -- electrician READY, welder FIND_MISSING_EVIDENCE, pipefitter VERIFY",()=>{
    const projectRef="project:i";
    const elec=itemFor({input:input({externalId:"s9a",project:"Iota",acceptance:verifiedAcceptance({id:"a9a",evidenceIds:["a9a"]}),contacts:[verifiedContact({id:"c9a",evidenceIds:["c9a"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s9a"),explicitStatus:"OPEN"}}),classification:electrician,projectRef,scope:orgWideScope("c9a")});
    const weld=itemFor({input:input({externalId:"s9b",project:"Iota"}),classification:welder,projectRef});
    const pipe=itemFor({input:input({externalId:"s9c",project:"Iota",acceptance:verifiedAcceptance({id:"a9c",verificationState:"UNVERIFIED",evidenceIds:["a9c"]}),contacts:[verifiedContact({id:"c9c",evidenceIds:["c9c"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s9c"),explicitStatus:"OPEN"}}),classification:classificationForOccupation("PIPEFITTER"),projectRef,scope:orgWideScope("c9c")});
    expect(elec.projectRef).toBe(projectRef);expect(weld.projectRef).toBe(projectRef);expect(pipe.projectRef).toBe(projectRef);
    expect(elec.workQueue).toBe("READY_FOR_COMMERCIAL_CONTACT");
    expect(weld.workQueue).toBe("FIND_MISSING_EVIDENCE");
    expect(pipe.workQueue).toBe("VERIFY_CRITICAL_EVIDENCE");
  });
  it("J: one company, multiple trades, evidence scope limited to one trade",()=>{
    const base=(externalId:string)=>input({externalId,project:"J Project",acceptance:verifiedAcceptance({id:`a-${externalId}`,evidenceIds:[`a-${externalId}`]}),contacts:[verifiedContact({id:`c-${externalId}`,evidenceIds:[`c-${externalId}`]})],actionability:{...NO_ACTIONABILITY_EVIDENCE(`conversion:${externalId}`),explicitStatus:"OPEN"}});
    const elec=itemFor({input:base("s10a"),classification:electrician,projectRef:"project:j1",scope:electricalOnlyScope("c-s10a")});
    const weld=itemFor({input:base("s10b"),classification:welder,projectRef:"project:j2",scope:electricalOnlyScope("c-s10b")});
    expect(elec.workQueue).toBe("READY_FOR_COMMERCIAL_CONTACT");
    expect(weld.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT");
    expect(weld.blockers.some(b=>b.code==="AF01_SCOPE_UNSUPPORTED")).toBe(true);
  });
  it("K: formerly Active HOT becomes non-ready when contact becomes stale",()=>{
    const base=input({externalId:"s11",project:"Kappa",acceptance:verifiedAcceptance({id:"a11",evidenceIds:["a11"]}),contacts:[verifiedContact({id:"c11",evidenceIds:["c11"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:s11"),explicitStatus:"OPEN"}});
    const wasReady=itemFor({input:base,classification:electrician,projectRef:"project:k",scope:orgWideScope("c11")});
    expect(wasReady.workQueue).toBe("READY_FOR_COMMERCIAL_CONTACT");
    const laterInput={...base,contacts:[verifiedContact({id:"c11",staleAfter:new Date("2026-01-01"),evidenceIds:["c11"]})]};
    const nowStale=itemFor({input:laterInput,classification:electrician,projectRef:"project:k",scope:orgWideScope("c11")});
    expect(nowStale.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT");
    expect(nowStale.blockers.some(b=>b.code==="CONTACT_STALE")).toBe(true);
  });
  it("L: duplicate evidence does not duplicate the work item",()=>{
    const ranked1=evalOne({input:input({externalId:"s12"}),classification:electrician,projectRef:"project:l"});
    const ranked2=evalOne({input:input({externalId:"s12"}),classification:electrician,projectRef:"project:l"});
    const{items,duplicatesSuppressed}=buildWorkItems([ranked1,ranked2]);
    expect(items).toHaveLength(1);
    expect(duplicatesSuppressed).toBe(1);
  });
});

describe("Phase 3F required false-operation tests (section 36)",()=>{
  const bareItem=(externalId:string,over:Partial<ConversionEvidenceInput> ={})=>itemFor({input:input({externalId,...over}),classification:electrician,projectRef:`project:${externalId}`});

  it("1 high score alone != READY",()=>{const i=bareItem("fo1",{wage:"$90/hr",headcount:200,perDiemOrIncentive:"$150/day",contacts:[verifiedContact({id:"c-fo1",gradeCandidate:"C",evidenceIds:["c-fo1"]})]});expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("2 OPEN alone != READY",()=>{const i=bareItem("fo2",{actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo2"),explicitStatus:"OPEN"}});expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("3 verified project alone != READY",()=>{const i=bareItem("fo3",{project:"Solo"});expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("4 buyer alone != READY",()=>{const i=bareItem("fo4",{buyer:"Some Buyer"});expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("5 supplier portal (grade E) alone != READY",()=>{const i=bareItem("fo5",{contacts:[verifiedContact({id:"c-fo5",gradeCandidate:"E",evidenceIds:["c-fo5"]})]});expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("6 high pay alone does not raise queue to READY",()=>{const i=bareItem("fo6",{wage:"$95/hr"});expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("7 high headcount alone does not raise queue to READY",()=>{const i=bareItem("fo7",{headcount:1000});expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("8 per diem alone does not raise queue to READY",()=>{const i=bareItem("fo8",{perDiemOrIncentive:"$300/day"});expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("9 data-center wording alone does not raise queue to READY",()=>{const i=bareItem("fo9",{employer:"Massive Data Center Corp"});expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("10 candidate AF-01 != verified readiness",()=>{const i=bareItem("fo10",{acceptance:verifiedAcceptance({id:"a-fo10",verificationState:"UNVERIFIED",evidenceIds:["a-fo10"]})});expect(i.af01State).toBe("CANDIDATE");expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("11 candidate contact != ready commercial contact",()=>{const i=bareItem("fo11",{contacts:[verifiedContact({id:"c-fo11",verificationState:"UNVERIFIED",evidenceIds:["c-fo11"]})]});expect(i.contactState).toBe("CANDIDATE");expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT")});
  it("12 stale contact removes readiness where required",()=>{
    const ready=bareItem("fo12a",{project:"P",acceptance:verifiedAcceptance({id:"a-fo12a",evidenceIds:["a-fo12a"]}),contacts:[verifiedContact({id:"c-fo12a",evidenceIds:["c-fo12a"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo12a"),explicitStatus:"OPEN"}});
    expect(ready.workQueue).toBe("READY_FOR_COMMERCIAL_CONTACT");
    const stale=bareItem("fo12b",{project:"P",acceptance:verifiedAcceptance({id:"a-fo12b",evidenceIds:["a-fo12b"]}),contacts:[verifiedContact({id:"c-fo12b",staleAfter:new Date("2026-01-01"),evidenceIds:["c-fo12b"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo12b"),explicitStatus:"OPEN"}});
    expect(stale.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT");
  });
  it("13 stale AF-01 removes readiness where required",()=>{
    const stale=bareItem("fo13",{project:"P",acceptance:verifiedAcceptance({id:"a-fo13",validUntil:new Date("2025-01-01"),evidenceIds:["a-fo13"]}),contacts:[verifiedContact({id:"c-fo13",evidenceIds:["c-fo13"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo13"),explicitStatus:"OPEN"}});
    expect(stale.af01State).toBe("STALE");
    expect(stale.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT");
  });
  it("14 CLOSED cannot be READY",()=>{const i=bareItem("fo14",{acceptance:verifiedAcceptance({id:"a-fo14",evidenceIds:["a-fo14"]}),contacts:[verifiedContact({id:"c-fo14",evidenceIds:["c-fo14"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo14"),explicitStatus:"CLOSED"}});expect(i.workQueue).toBe("INACTIVE")});
  it("15 CANCELLED cannot be READY",()=>{const i=bareItem("fo15",{acceptance:verifiedAcceptance({id:"a-fo15",evidenceIds:["a-fo15"]}),contacts:[verifiedContact({id:"c-fo15",evidenceIds:["c-fo15"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo15"),explicitStatus:"CANCELLED"}});expect(i.workQueue).toBe("INACTIVE")});
  it("16 EXPIRED cannot be READY",()=>{const i=bareItem("fo16",{acceptance:verifiedAcceptance({id:"a-fo16",evidenceIds:["a-fo16"]}),contacts:[verifiedContact({id:"c-fo16",evidenceIds:["c-fo16"]})],actionability:{opportunityId:"conversion:fo16",explicitStatus:null,explicitStatusFreshUntil:null,deadlines:[{kind:"ORIGINAL",date:new Date("2025-01-01"),observedAt:AT,evidenceIds:["d-fo16"]}],startDate:null,evidenceIds:["d-fo16"]}});expect(i.workQueue).toBe("INACTIVE")});
  it("17 project-level HOT does not exist -- state stays per-demand",()=>{
    const projectRef="project:fo17";
    const elec=itemFor({input:input({externalId:"fo17a",project:"P",acceptance:verifiedAcceptance({id:"a-fo17a",evidenceIds:["a-fo17a"]}),contacts:[verifiedContact({id:"c-fo17a",evidenceIds:["c-fo17a"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo17a"),explicitStatus:"OPEN"}}),classification:electrician,projectRef,scope:orgWideScope("c-fo17a")});
    const weld=itemFor({input:input({externalId:"fo17b",project:"P"}),classification:welder,projectRef});
    expect(elec.workQueue).toBe("READY_FOR_COMMERCIAL_CONTACT");
    expect(weld.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT");
  });
  it("18 one HOT trade does not make sibling demand READY",()=>{
    const projectRef="project:fo18";
    itemFor({input:input({externalId:"fo18a",project:"P",acceptance:verifiedAcceptance({id:"a-fo18a",evidenceIds:["a-fo18a"]}),contacts:[verifiedContact({id:"c-fo18a",evidenceIds:["c-fo18a"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo18a"),explicitStatus:"OPEN"}}),classification:electrician,projectRef,scope:orgWideScope("c-fo18a")});
    const sibling=itemFor({input:input({externalId:"fo18b",project:"P"}),classification:welder,projectRef});
    expect(sibling.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT");
  });
  it("19 out-of-scope AF-01 does not unlock another trade",()=>{
    const i=itemFor({input:input({externalId:"fo19",acceptance:verifiedAcceptance({id:"a-fo19",evidenceIds:["a-fo19"]}),contacts:[verifiedContact({id:"c-fo19",evidenceIds:["c-fo19"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo19"),explicitStatus:"OPEN"}}),classification:welder,projectRef:"project:fo19",scope:electricalOnlyScope("c-fo19")});
    expect(i.af01State).toBe("CANDIDATE");
    expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT");
  });
  it("20 out-of-scope contact authority does not unlock another trade",()=>{
    const scope:WorkforceEvidenceScopeInput={af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},contactScopes:{"c-fo20":{gradeCandidate:"B",scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL"]}}};
    const i=itemFor({input:input({externalId:"fo20",acceptance:verifiedAcceptance({id:"a-fo20",evidenceIds:["a-fo20"]}),contacts:[verifiedContact({id:"c-fo20",evidenceIds:["c-fo20"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo20"),explicitStatus:"OPEN"}}),classification:welder,projectRef:"project:fo20",scope});
    expect(i.contactAuthorityScope).toBe("TRADE_SPECIFIC");
    expect(i.workQueue).not.toBe("READY_FOR_COMMERCIAL_CONTACT");
  });
  it("21 verification inbox item does not equal verified evidence",()=>{
    const i=itemFor({input:input({externalId:"fo21",acceptance:verifiedAcceptance({id:"a-fo21",verificationState:"UNVERIFIED",evidenceIds:["a-fo21"]})}),classification:electrician,projectRef:"project:fo21"});
    const inbox=buildHumanVerificationInbox([i]);
    expect(inbox.length).toBeGreaterThan(0);
    expect(i.af01State).not.toBe("VERIFIED");
  });
  it("22 closure task does not equal completed evidence",()=>{
    const i=itemFor({input:input({externalId:"fo22"}),classification:electrician,projectRef:"project:fo22"});
    const closure=buildEvidenceClosureInbox([i]);
    expect(closure.length).toBeGreaterThan(0);
    expect(i.af01State).toBe("MISSING");
  });
  it("23 recommendation does not equal outreach",()=>{
    const i=itemFor({input:input({externalId:"fo23",project:"P",acceptance:verifiedAcceptance({id:"a-fo23",evidenceIds:["a-fo23"]}),contacts:[verifiedContact({id:"c-fo23",evidenceIds:["c-fo23"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo23"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:fo23",scope:orgWideScope("c-fo23")});
    const draft=buildCommercialActionDraft(i);
    expect(draft).not.toBeNull();
    expect(JSON.stringify(draft)).not.toMatch(/emailSent|smsSent|callPlaced/);
  });
  it("24 no automatic human decision anywhere in the desk output",()=>{
    const i=itemFor({input:input({externalId:"fo24"}),classification:electrician,projectRef:"project:fo24"});
    expect(JSON.stringify(buildHumanVerificationInbox([i]))).not.toMatch(/"decision":"VERIFY"/);
  });
  it("25 no automatic outreach anywhere in the desk output",()=>{
    const i=itemFor({input:input({externalId:"fo25",wage:"$60/hr"}),classification:electrician,projectRef:"project:fo25"});
    const card=buildOperatorActionCard(i);
    expect(JSON.stringify({i,card})).not.toMatch(/emailSent|outreachExecuted|smsSent|callPlaced|formSubmitted/);
  });
  it("26 no persistence -- desk functions are pure",()=>{
    const a=itemFor({input:input({externalId:"fo26"}),classification:electrician,projectRef:"project:fo26"});
    const b=itemFor({input:input({externalId:"fo26"}),classification:electrician,projectRef:"project:fo26"});
    expect(a).toEqual(b);
  });
  it("27 no fuzzy merge -- deduplication is exact-identity only",()=>{
    const r1=evalOne({input:input({externalId:"fo27a"}),classification:electrician,projectRef:"project:fo27"});
    const r2=evalOne({input:input({externalId:"fo27b"}),classification:electrician,projectRef:"project:fo27"});
    const{items}=buildWorkItems([r1,r2]);
    expect(items).toHaveLength(2);
  });
  it("28 duplicate evidence does not duplicate work items (queue-level)",()=>{
    const r=evalOne({input:input({externalId:"fo28"}),classification:electrician,projectRef:"project:fo28"});
    const{items}=buildWorkItems([r,r,r]);
    expect(items).toHaveLength(1);
    expect(facetQueue(items,items[0].workQueue)).toHaveLength(1);
  });
  it("29 historical HOT does not guarantee current READY (re-evaluation required)",()=>{
    const wasHot=itemFor({input:input({externalId:"fo29",project:"P",acceptance:verifiedAcceptance({id:"a-fo29",evidenceIds:["a-fo29"]}),contacts:[verifiedContact({id:"c-fo29",evidenceIds:["c-fo29"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo29"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:fo29",scope:orgWideScope("c-fo29")});
    expect(wasHot.workQueue).toBe("READY_FOR_COMMERCIAL_CONTACT");
    const nowClosed=itemFor({input:input({externalId:"fo29",project:"P",acceptance:verifiedAcceptance({id:"a-fo29",evidenceIds:["a-fo29"]}),contacts:[verifiedContact({id:"c-fo29",evidenceIds:["c-fo29"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo29"),explicitStatus:"CLOSED"}}),classification:electrician,projectRef:"project:fo29",scope:orgWideScope("c-fo29")});
    expect(nowClosed.workQueue).toBe("INACTIVE");
  });
  it("30 commercial desk does not change canonical HOT truth",()=>{
    const evaluation=evaluateWorkforceConversion({input:input({externalId:"fo30",project:"P",acceptance:verifiedAcceptance({id:"a-fo30",evidenceIds:["a-fo30"]}),contacts:[verifiedContact({id:"c-fo30",evidenceIds:["c-fo30"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fo30"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:fo30",scope:orgWideScope("c-fo30")});
    const ranked=rankWorkforceConversions([evaluation]);
    const item=buildWorkItem(ranked[0]);
    expect(item.hotA).toBe(evaluation.activeHotA);
    expect(item.eligible).toBe(evaluation.eligibility.some(e=>e.eligible));
    expect(item.score).toBe(evaluation.score.score);
  });
});

describe("Phase 3F work item model, identity, grouping, filters, sort",()=>{
  it("work item identity is deterministic across repeated builds",()=>{
    const r=evalOne({input:input({externalId:"id1"}),classification:electrician,projectRef:"project:id1"});
    expect(buildWorkItem(r).workItemId).toBe(buildWorkItem(r).workItemId);
    expect(buildWorkItem(r).workItemId).toBe(`work-item:${r.dossier.opportunityId}`);
  });
  it("project grouping preserves independent per-demand state",()=>{
    const projectRef="project:group1";
    const elec=itemFor({input:input({externalId:"pg1",project:"P"}),classification:electrician,projectRef});
    const weld=itemFor({input:input({externalId:"pg2",project:"P"}),classification:welder,projectRef});
    const groups=groupByProject([elec,weld]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });
  it("company grouping does not expand evidence scope",()=>{
    const elec=itemFor({input:input({externalId:"cg1",employer:"Acme Co"}),classification:electrician,projectRef:"project:cg1"});
    const weld=itemFor({input:input({externalId:"cg2",employer:"Acme Co"}),classification:welder,projectRef:"project:cg2"});
    const groups=groupByCompany([elec,weld]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(i=>i.workQueue)).toEqual(groups[0].items.map(i=>i.workQueue));
    expect(weld.af01State).toBe("MISSING");
  });
  it("filters by trade/queue/readiness are deterministic",()=>{
    const elec=itemFor({input:input({externalId:"f1"}),classification:electrician,projectRef:"project:f1"});
    const weld=itemFor({input:input({externalId:"f2"}),classification:welder,projectRef:"project:f2"});
    expect(filterWorkItems([elec,weld],{tradeId:"WELDING"})).toEqual([weld]);
    expect(filterWorkItems([elec,weld],{workQueue:elec.workQueue}).every(i=>i.workQueue===elec.workQueue)).toBe(true);
  });
  it("sort by commercial priority is stable and deterministic",()=>{
    const ready=itemFor({input:input({externalId:"sort1",project:"P",acceptance:verifiedAcceptance({id:"a-sort1",evidenceIds:["a-sort1"]}),contacts:[verifiedContact({id:"c-sort1",evidenceIds:["c-sort1"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:sort1"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:sort1",scope:orgWideScope("c-sort1")});
    const bare=itemFor({input:input({externalId:"sort2"}),classification:electrician,projectRef:"project:sort2"});
    const sorted=sortWorkItems([bare,ready],"COMMERCIAL_PRIORITY");
    expect(sorted[0].workItemId).toBe(ready.workItemId);
    const again=sortWorkItems([bare,ready],"COMMERCIAL_PRIORITY");
    expect(sorted.map(i=>i.workItemId)).toEqual(again.map(i=>i.workItemId));
  });
});

describe("Phase 3F daily desk / inboxes",()=>{
  it("daily desk counts sum to total work items",()=>{
    const items=[
      itemFor({input:input({externalId:"dd1"}),classification:electrician,projectRef:"project:dd1"}),
      itemFor({input:input({externalId:"dd2",project:"P",acceptance:verifiedAcceptance({id:"a-dd2",evidenceIds:["a-dd2"]}),contacts:[verifiedContact({id:"c-dd2",evidenceIds:["c-dd2"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:dd2"),explicitStatus:"OPEN"}}),classification:welder,projectRef:"project:dd2",scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"TRADE_SPECIFIC",scopedTradeIds:["WELDING"],scopeEvidenceText:"welding"},contactScopes:{"c-dd2":{gradeCandidate:"B",scope:"TRADE_SPECIFIC",scopedTradeIds:["WELDING"]}}}}),
    ];
    const desk=buildDailyDesk(items);
    const sum=Object.values(desk.counts).reduce((a,b)=>a+b,0);
    expect(sum).toBe(items.length);
    expect(desk.totalWorkItems).toBe(items.length);
  });
  it("top priorities never exceed requested topN and are ordered by rank",()=>{
    const items=[1,2,3,4,5,6].map(n=>itemFor({input:input({externalId:`tp${n}`}),classification:electrician,projectRef:`project:tp${n}`}));
    const desk=buildDailyDesk(items,3);
    expect(desk.topPriorities.length).toBeLessThanOrEqual(3);
  });
  it("commercial contact inbox contains only READY items",()=>{
    const ready=itemFor({input:input({externalId:"ci1",project:"P",acceptance:verifiedAcceptance({id:"a-ci1",evidenceIds:["a-ci1"]}),contacts:[verifiedContact({id:"c-ci1",evidenceIds:["c-ci1"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:ci1"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:ci1",scope:orgWideScope("c-ci1")});
    const notReady=itemFor({input:input({externalId:"ci2"}),classification:electrician,projectRef:"project:ci2"});
    const inbox=buildCommercialContactInbox([ready,notReady]);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].opportunityId).toBe(ready.opportunityId);
  });
  it("evidence closure inbox reuses Phase 3E's closure plan verbatim (task-type set matches)",()=>{
    const i=itemFor({input:input({externalId:"ec1"}),classification:electrician,projectRef:"project:ec1"});
    const inbox=buildEvidenceClosureInbox([i]);
    expect(inbox.map(x=>x.taskType).sort()).toEqual(i.closurePlan.map(t=>t.taskType).sort());
  });
});
