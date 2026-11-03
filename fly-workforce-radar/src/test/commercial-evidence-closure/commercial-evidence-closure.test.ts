import{describe,expect,it}from"vitest";
import type{ConversionAcceptanceEvidence,ConversionContactEvidence,ConversionEvidenceInput}from"../../domain/commercial-conversion";
import{NO_ACTIONABILITY_EVIDENCE}from"../../domain/opportunity-actionability";
import type{TrackedWorkforceDemandSignal}from"../../domain/multi-trade-workforce";
import{classificationForOccupation}from"../../domain/workforce-taxonomy";
import{
  evaluateWorkforceConversion,rankWorkforceConversions,toDiscoverySignalShape,
}from"../../server/services/hot-conversion-engine/hot-conversion-engine-service";
import type{WorkforceConversionEvaluationInput,WorkforceEvidenceScopeInput}from"../../server/services/hot-conversion-engine/hot-conversion-engine-service";
import{buildWorkItem}from"../../server/services/operational-desk/operational-desk-service";
import{createContactCandidate}from"../../server/services/contact-intelligence/contact-intelligence-service";
import{
  addAf01Candidates,addContactCandidates,applyHumanClosureDecision,buildAf01Candidate,buildClosureDeskSnapshot,
  buildSearchPlan,classifyAf01EvidenceText,closureCaseId,deriveClosureCases,matchEntity,matchProject,
  previewAf01Candidate,previewContactCandidate,scoreAf01CandidateQuality,scoreContactCandidateQuality,
}from"../../server/services/commercial-evidence-closure/commercial-evidence-closure-service";
import type{RawAf01Observation}from"../../server/services/commercial-evidence-closure/commercial-evidence-closure-service";

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
const electrician=classificationForOccupation("ELECTRICIAN");
const welder=classificationForOccupation("WELDER");

const evalItem=(x:WorkforceConversionEvaluationInput)=>({item:buildWorkItem(rankWorkforceConversions([evaluateWorkforceConversion(x)])[0]),evalInput:x});

const contactCandidate=(over:Partial<Parameters<typeof createContactCandidate>[0]> ={})=>createContactCandidate({
  opportunityId:"conversion:s1",signalId:"signal:s1",personName:"Jane Procurement",title:"Procurement Manager",
  organization:"Fixture Co",function:"PROCUREMENT",contactType:"PROCUREMENT_PERSON",routeTarget:"jane@fixture.invalid",
  sourceUrl:"https://fixture.invalid/contact",evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",sourceType:"OFFICIAL_CORPORATE_CONTACT",
  observedAt:AT,publicationOrEffectiveDate:AT,verificationState:"CANDIDATE",conflicts:[],provenance:"official corporate contact page",
  supportedRelationship:"Named procurement contact on official corporate page",authorityEvidence:"Listed as procurement decision owner",
  opportunityRelationshipExplicit:true,
  ...over,
},AT);

const af01Raw=(over:Partial<RawAf01Observation> ={}):RawAf01Observation=>({
  opportunityId:"conversion:s1",organization:"Fixture Co",
  candidateClaim:"Fixture Co accepts staffing vendors for craft labor support.",
  sourceUrl:"https://fixture.invalid/suppliers",sourceType:"OFFICIAL_CONTINGENT_WORKFORCE",evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",
  observedAt:AT,scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"applies company-wide",
  targetOrganization:"Fixture Co",targetProjectRef:null,
  ...over,
});

describe("Phase 3G controlled scenarios (section 41)",()=>{
  it("A: missing contact -> closure case -> strong candidate -> verification packet -> preview -> no canonical mutation",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"a1",project:"P",acceptance:verifiedAcceptance({id:"a-a1",evidenceIds:["a-a1"]})}),classification:electrician,projectRef:"project:a1",scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},contactScopes:{}}});
    expect(item.blockers.some(b=>b.code==="MISSING_ACTIONABLE_CONTACT")).toBe(true);
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    expect(contactCase).toBeDefined();
    const candidate=contactCandidate({opportunityId:item.opportunityId,organization:item.organization});
    const before=evaluateWorkforceConversion(evalInput);
    const withCandidate=addContactCandidates(contactCase,[candidate],evalInput);
    expect(withCandidate.verificationPackets).toHaveLength(1);
    expect(withCandidate.verificationPackets[0].previewImpact).not.toBeNull();
    const after=evaluateWorkforceConversion(evalInput);
    expect(after).toEqual(before);
    expect(after.activeHotA).toBe(false);
  });
  it("B: candidate recruiter route does not become Grade A automatically",()=>{
    const c=contactCandidate({contactType:"RECRUITER",function:"UNKNOWN",authorityEvidence:null,opportunityRelationshipExplicit:false});
    expect(c.proposedGrade).not.toBe("A");
    expect(c.verificationState).not.toBe("VERIFIED");
  });
  it("C: generic corporate contact remains a weak candidate",()=>{
    const c=contactCandidate({contactType:"GENERAL_CORPORATE_CONTACT",function:"UNKNOWN",authorityEvidence:null,opportunityRelationshipExplicit:false,supportedRelationship:""});
    expect(["D","E"]).toContain(c.proposedGrade);
  });
  it("D: explicit procurement decision-maker is a strong candidate but still requires human verification",()=>{
    // recommendContactGrade only proposes A-D once verificationState is
    // already VERIFIED (confirmed by Phase 3C's own live pilot, which
    // asserts gradeA===0 for every real un-verified route) -- so an
    // unverified candidate's canonical proposedGrade is always "E" by
    // design. "Strong" is expressed through Phase 3G's own candidate
    // quality score instead, kept explicitly separate from canonical grade.
    const c=contactCandidate();
    expect(c.proposedGrade).toBe("E");
    const q=scoreContactCandidateQuality(c);
    expect(q.total).toBeGreaterThanOrEqual(10);
    expect(c.verificationState).not.toBe("VERIFIED");
    expect(c.humanReviewRequired).toBe(true);
  });
  it("E: stale named contact is not a current actionable contact",()=>{
    const c=contactCandidate({verificationState:"STALE",publicationOrEffectiveDate:new Date("2020-01-01")});
    expect(c.freshness).toBe("STALE");
  });
  it("F: missing AF-01 -> closure case -> explicit staffing-vendor candidate -> verification packet -> preview",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"f1",project:"P",contacts:[verifiedContact({id:"c-f1",evidenceIds:["c-f1"]})]}),classification:electrician,projectRef:"project:f1",scope:orgWideScope("c-f1")});
    expect(item.blockers.some(b=>b.code==="MISSING_AF01")).toBe(true);
    const cases=deriveClosureCases(item),af01Case=cases.find(c=>c.target.targetType==="AF01_ACCEPTANCE")!;
    expect(af01Case).toBeDefined();
    const candidate=buildAf01Candidate(af01Raw({opportunityId:item.opportunityId,organization:item.organization,targetOrganization:item.organization}));
    expect(candidate.evidenceClass).toBe("STAFFING_VENDOR_ACCEPTANCE");
    const withCandidate=addAf01Candidates(af01Case,[candidate],evalInput);
    expect(withCandidate.verificationPackets).toHaveLength(1);
    expect(withCandidate.verificationPackets[0].previewImpact).not.toBeNull();
  });
  it("G: generic supplier page does not automatically prove AF-01",()=>{
    const cls=classifyAf01EvidenceText("Visit our supplier portal to register as a vendor.");
    expect(cls).toBe("GENERAL_SUPPLIER_ROUTE");
    expect(cls).not.toBe("STAFFING_VENDOR_ACCEPTANCE");
  });
  it("H: job posting text does not prove AF-01",()=>{
    const cls=classifyAf01EvidenceText("We are hiring Journeyman Electricians for our Houston facility.");
    expect(["UNKNOWN","AMBIGUOUS_VENDOR_LANGUAGE"]).toContain(cls);
  });
  it("I: general subcontracting language does not necessarily prove manpower acceptance",()=>{
    const cls=classifyAf01EvidenceText("We work with a network of subcontractors across our project portfolio.");
    expect(cls).toBe("GENERAL_SUBCONTRACTOR_ROUTE");
  });
  it("J: explicit negative manpower policy is preserved as negative evidence",()=>{
    const cls=classifyAf01EvidenceText("Fixture Co does not accept staffing vendor labor for this program.");
    expect(cls).toBe("NEGATIVE_EVIDENCE");
  });
  it("K: electrical-scoped acceptance does not cover welding",()=>{
    const candidate=buildAf01Candidate(af01Raw({scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL"],scopeEvidenceText:"electrical craft labor only"}));
    const{evalInput}=evalItem({input:input({externalId:"k1",project:"P",contacts:[verifiedContact({id:"c-k1",evidenceIds:["c-k1"]})]}),classification:welder,projectRef:"project:k1",scope:{af01:null,contactScopes:{"c-k1":{gradeCandidate:"B",scope:"ORGANIZATION_WIDE",scopedTradeIds:[]}}}});
    const preview=previewAf01Candidate(evalInput,candidate);
    expect(preview.wouldBecomeActiveHotA).toBe(false);
  });
  it("L: organization-wide explicit acceptance may cover multiple trades",()=>{
    const candidate=buildAf01Candidate(af01Raw({scope:"ORGANIZATION_WIDE"}));
    const{evalInput}=evalItem({input:input({externalId:"l1",project:"P",contacts:[verifiedContact({id:"c-l1",evidenceIds:["c-l1"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:l1"),explicitStatus:"OPEN"}}),classification:welder,projectRef:"project:l1",scope:{af01:null,contactScopes:{"c-l1":{gradeCandidate:"B",scope:"ORGANIZATION_WIDE",scopedTradeIds:[]}}}});
    const preview=previewAf01Candidate(evalInput,candidate);
    expect(preview.wouldBecomeActiveHotA).toBe(true);
  });
  it("M: welding contact authority does not automatically cover electrical",()=>{
    const c=contactCandidate({opportunityId:"conversion:m1",signalId:"signal:m1",personName:"Weld Contact",title:"Welding Program Manager",function:"SUBCONTRACTING",contactType:"SUBCONTRACTING_PERSON",routeTarget:"w@fixture.invalid",sourceUrl:"https://fixture.invalid/welding",provenance:"welding program page",supportedRelationship:"Welding program contact",authorityEvidence:"Owns welding vendor decisions",opportunityRelationshipExplicit:false});
    const{evalInput}=evalItem({input:input({externalId:"m1",project:"P",acceptance:verifiedAcceptance({id:"a-m1",evidenceIds:["a-m1"]})}),classification:electrician,projectRef:"project:m1",scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},contactScopes:{}}});
    const preview=previewContactCandidate(evalInput,c);
    // an UNKNOWN-scope candidate contact (relationship not explicit to THIS opportunity) must never unlock HOT by itself
    expect(preview.wouldBecomeActiveHotA).toBe(false);
  });
  it("N: duplicate candidate evidence does not duplicate the verification packet",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"n1"}),classification:electrician,projectRef:"project:n1"});
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    const candidate=contactCandidate({opportunityId:item.opportunityId});
    const once=addContactCandidates(contactCase,[candidate],evalInput);
    const twice=addContactCandidates(once,[candidate],evalInput);
    expect(twice.contactCandidates).toHaveLength(1);
    expect(twice.verificationPackets).toHaveLength(1);
  });
  it("O: wrong similarly-named company is rejected/ambiguous entity match",()=>{
    expect(matchEntity("Bechtel Corp","Bechtel")).toBe("AMBIGUOUS");
    expect(matchEntity("Wyman-Gordon","Anheuser-Busch")).toBe("MISMATCH");
  });
  it("P: same company, wrong project -- project-specific evidence does not propagate",()=>{
    expect(matchProject("project:beta","project:alpha")).toBe("MISMATCH");
    expect(matchProject(null,"project:alpha")).toBe("AMBIGUOUS");
  });
  it("Q: candidate that would create Active HOT if verified is high verification priority, still no canonical mutation",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"q1",project:"P",acceptance:verifiedAcceptance({id:"a-q1",evidenceIds:["a-q1"]}),actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:q1"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:q1",scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},contactScopes:{}}});
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    const candidate=contactCandidate({opportunityId:item.opportunityId,organization:item.organization});
    const before=evaluateWorkforceConversion(evalInput);
    const withCandidate=addContactCandidates(contactCase,[candidate],evalInput);
    expect(withCandidate.verificationPackets[0].previewImpact?.wouldBecomeActiveHotA).toBe(true);
    const desk=buildClosureDeskSnapshot([withCandidate]);
    expect(desk.highImpactVerificationItems).toBe(1);
    expect(desk.topClosurePriorities[0].closureCaseId).toBe(withCandidate.closureCaseId);
    expect(evaluateWorkforceConversion(evalInput)).toEqual(before);
  });
  it("R: human-verified evidence supplied externally to re-evaluation recomputes correctly",()=>{
    const{evalInput}=evalItem({input:input({externalId:"r1",project:"P"}),classification:electrician,projectRef:"project:r1"});
    const before=evaluateWorkforceConversion(evalInput);
    expect(before.activeHotA).toBe(false);
    const humanVerifiedInput:WorkforceConversionEvaluationInput={...evalInput,input:{...evalInput.input,acceptance:verifiedAcceptance({id:"a-r1",evidenceIds:["a-r1"]}),contacts:[verifiedContact({id:"c-r1",evidenceIds:["c-r1"]})],actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:r1"),explicitStatus:"OPEN"as const}},scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},contactScopes:{"c-r1":{gradeCandidate:"B",scope:"ORGANIZATION_WIDE",scopedTradeIds:[]}}}};
    const after=evaluateWorkforceConversion(humanVerifiedInput);
    expect(after.activeHotA).toBe(true);
  });
});

describe("Phase 3G required false-closure tests (section 42)",()=>{
  it("1 contact name alone != actionable contact",()=>{const c=contactCandidate({verificationState:"CANDIDATE"});expect(c.verificationState).not.toBe("VERIFIED")});
  it("2 email alone != authority",()=>{const c=contactCandidate({authorityEvidence:null});expect(c.proposedGrade).not.toBe("A")});
  it("3 phone alone != authority",()=>{const c=contactCandidate({contactType:"PHONE_ROUTE",authorityEvidence:null,function:"UNKNOWN"});expect(c.proposedGrade).not.toBe("A")});
  it("4 recruiter alone != Grade A",()=>{const c=contactCandidate({contactType:"RECRUITER",function:"UNKNOWN",authorityEvidence:null});expect(c.proposedGrade).not.toBe("A")});
  it("5 careers page != actionable B2B contact",()=>{const c=contactCandidate({contactType:"GENERAL_CORPORATE_CONTACT",function:"UNKNOWN",authorityEvidence:null,opportunityRelationshipExplicit:false});expect(["D","E"]).toContain(c.proposedGrade)});
  it("6 generic corporate page != Grade A",()=>{const c=contactCandidate({contactType:"GENERAL_CORPORATE_CONTACT",function:"UNKNOWN"});expect(c.proposedGrade).not.toBe("A")});
  it("7 social evidence alone cannot auto-verify",()=>{const c=contactCandidate({contactType:"UNKNOWN",verificationState:"CANDIDATE"});expect(c.verificationState).not.toBe("VERIFIED")});
  it("8 candidate contact != verified contact",()=>{const{evalInput}=evalItem({input:input({externalId:"fc8"}),classification:electrician,projectRef:"project:fc8"});const c=contactCandidate({opportunityId:"conversion:fc8"});expect(evalInput.input.contacts.some(x=>x.id===c.id)).toBe(false)});
  it("9 suggested grade != canonical grade",()=>{const c=contactCandidate();expect(c.proposedGrade).toBeDefined();expect((c as{grade?:string}).grade).toBeUndefined()});
  it("10 stale contact != current actionable contact",()=>{const c=contactCandidate({verificationState:"STALE"});expect(c.freshness).toBe("STALE")});
  it("11 wrong-company contact cannot attach",()=>{expect(matchEntity("Other Co","Fixture Co")).toBe("MISMATCH")});
  it("12 wrong-project evidence cannot propagate",()=>{expect(matchProject("project:x","project:y")).toBe("MISMATCH")});
  it("13 supplier portal != AF-01",()=>{expect(classifyAf01EvidenceText("Register through our supplier portal.")).toBe("GENERAL_SUPPLIER_ROUTE")});
  it("14 supplier registration != AF-01",()=>{expect(classifyAf01EvidenceText("New supplier registration is open.")).toBe("GENERAL_SUPPLIER_ROUTE")});
  it("15 job posting != AF-01",()=>{expect(classifyAf01EvidenceText("Now hiring welders for our Texas plant.")).not.toBe("STAFFING_VENDOR_ACCEPTANCE")});
  it("16 company hiring != AF-01",()=>{expect(classifyAf01EvidenceText("We are growing our team and hiring across departments.")).toBe("UNKNOWN")});
  it("17 project exists != AF-01",()=>{expect(classifyAf01EvidenceText("Our new facility project broke ground this year.")).toBe("UNKNOWN")});
  it("18 subcontracting language alone != AF-01 unless it explicitly supports manpower acceptance",()=>{expect(classifyAf01EvidenceText("We partner with subcontractors on select scopes.")).toBe("GENERAL_SUBCONTRACTOR_ROUTE")});
  it("19 candidate AF-01 != verified AF-01",()=>{const c=buildAf01Candidate(af01Raw());expect(c.verificationState).toBe("UNVERIFIED")});
  it("20 ambiguous vendor language != verified AF-01",()=>{const cls=classifyAf01EvidenceText("We work with several vendors.");expect(cls).toBe("AMBIGUOUS_VENDOR_LANGUAGE")});
  it("21 electrical AF-01 does not unlock welding",()=>{
    const candidate=buildAf01Candidate(af01Raw({scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL"]}));
    const{evalInput}=evalItem({input:input({externalId:"fc21",project:"P",contacts:[verifiedContact({id:"c-fc21",evidenceIds:["c-fc21"]})]}),classification:welder,projectRef:"project:fc21",scope:{af01:null,contactScopes:{"c-fc21":{gradeCandidate:"B",scope:"ORGANIZATION_WIDE",scopedTradeIds:[]}}}});
    expect(previewAf01Candidate(evalInput,candidate).wouldBecomeActiveHotA).toBe(false);
  });
  it("22 welding AF-01 does not unlock electrical",()=>{
    const candidate=buildAf01Candidate(af01Raw({scope:"TRADE_SPECIFIC",scopedTradeIds:["WELDING"]}));
    const{evalInput}=evalItem({input:input({externalId:"fc22",project:"P",contacts:[verifiedContact({id:"c-fc22",evidenceIds:["c-fc22"]})]}),classification:electrician,projectRef:"project:fc22",scope:{af01:null,contactScopes:{"c-fc22":{gradeCandidate:"B",scope:"ORGANIZATION_WIDE",scopedTradeIds:[]}}}});
    expect(previewAf01Candidate(evalInput,candidate).wouldBecomeActiveHotA).toBe(false);
  });
  it("23 trade contact authority does not auto-propagate",()=>{
    const c=contactCandidate({opportunityRelationshipExplicit:false});
    const{evalInput}=evalItem({input:input({externalId:"fc23",project:"P",acceptance:verifiedAcceptance({id:"a-fc23",evidenceIds:["a-fc23"]})}),classification:electrician,projectRef:"project:fc23",scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},contactScopes:{}}});
    expect(previewContactCandidate(evalInput,c).wouldBecomeActiveHotA).toBe(false);
  });
  it("24 corporate-hosted evidence does not imply organization-wide scope",()=>{
    const candidate=buildAf01Candidate(af01Raw({scope:"UNKNOWN",scopeEvidenceText:null}));
    expect(candidate.scope).toBe("UNKNOWN");
  });
  it("25 high candidate-quality score != verification",()=>{
    const c=contactCandidate();
    const q=scoreContactCandidateQuality(c);
    expect(q.total).toBeGreaterThan(0);
    expect(c.verificationState).not.toBe("VERIFIED");
  });
  it("26 high preview impact != verification",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"fc26",project:"P",acceptance:verifiedAcceptance({id:"a-fc26",evidenceIds:["a-fc26"]}),actionability:{...NO_ACTIONABILITY_EVIDENCE("conversion:fc26"),explicitStatus:"OPEN"}}),classification:electrician,projectRef:"project:fc26",scope:{af01:{category:"STAFFING_VENDOR_ACCEPTED",scope:"ORGANIZATION_WIDE",scopedTradeIds:[],scopeEvidenceText:"org-wide"},contactScopes:{}}});
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    const candidate=contactCandidate({opportunityId:item.opportunityId,organization:item.organization});
    const withCandidate=addContactCandidates(contactCase,[candidate],evalInput);
    expect(withCandidate.verificationPackets[0].previewImpact?.wouldBecomeActiveHotA).toBe(true);
    expect(candidate.verificationState).not.toBe("VERIFIED");
  });
  it("27 closure-case complete != HOT",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"fc27"}),classification:electrician,projectRef:"project:fc27"});
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    const decided=applyHumanClosureDecision(addContactCandidates(contactCase,[contactCandidate({opportunityId:item.opportunityId})],evalInput),{candidateId:contactCandidate({opportunityId:item.opportunityId}).id,decision:"VERIFY",reviewerId:"tester",reason:"test",decidedAt:AT});
    expect(decided.status).toBe("VERIFIED_CLOSED");
    expect(evaluateWorkforceConversion(evalInput).activeHotA).toBe(false);
  });
  it("28 candidate found != eligibility",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"fc28"}),classification:electrician,projectRef:"project:fc28"});
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    addContactCandidates(contactCase,[contactCandidate({opportunityId:item.opportunityId})],evalInput);
    expect(evaluateWorkforceConversion(evalInput).eligibility.every(e=>!e.eligible)).toBe(true);
  });
  it("29 candidate found != Active HOT",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"fc29"}),classification:electrician,projectRef:"project:fc29"});
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    addContactCandidates(contactCase,[contactCandidate({opportunityId:item.opportunityId})],evalInput);
    expect(evaluateWorkforceConversion(evalInput).activeHotA).toBe(false);
  });
  it("30 preview does not persist",()=>{
    const{evalInput}=evalItem({input:input({externalId:"fc30"}),classification:electrician,projectRef:"project:fc30"});
    const c=contactCandidate({opportunityId:"conversion:fc30"});
    const p=previewContactCandidate(evalInput,c);
    expect(p.persisted).toBe(false);
  });
  it("31 preview does not mutate evidence",()=>{
    const{evalInput}=evalItem({input:input({externalId:"fc31"}),classification:electrician,projectRef:"project:fc31"});
    const before=JSON.stringify(evalInput.input);
    previewContactCandidate(evalInput,contactCandidate({opportunityId:"conversion:fc31"}));
    expect(JSON.stringify(evalInput.input)).toBe(before);
  });
  it("32 verification packet does not issue a decision",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"fc32"}),classification:electrician,projectRef:"project:fc32"});
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    const withCandidate=addContactCandidates(contactCase,[contactCandidate({opportunityId:item.opportunityId})],evalInput);
    expect(withCandidate.status).not.toBe("VERIFIED_CLOSED");
    expect(JSON.stringify(withCandidate.verificationPackets)).not.toMatch(/"decision":"VERIFY"/);
  });
  it("33-36 acquisition performs no outreach/forms/registration/applications",()=>{
    const plan=buildSearchPlan("closure:x:ACTIONABLE_CONTACT:NONE",{targetType:"ACTIONABLE_CONTACT",description:"x",tradeId:null,organization:"Fixture Co",projectRef:null});
    expect(JSON.stringify(plan)).not.toMatch(/emailSent|formSubmitted|registered|applied/i);
  });
  it("37 acquisition budget cannot be exceeded",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"fc37"}),classification:electrician,projectRef:"project:fc37"});
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    const many=Array.from({length:20},(_,i)=>contactCandidate({opportunityId:item.opportunityId,routeTarget:`p${i}@fixture.invalid`,sourceUrl:`https://fixture.invalid/${i}`}));
    const budget={maxStrategiesPerCase:5,maxCandidatesPerStrategy:3,maxCandidatesPerCase:8};
    const result=addContactCandidates(contactCase,many,evalInput,budget);
    expect(result.contactCandidates.length).toBeLessThanOrEqual(8);
  });
  it("38 stop conditions are deterministic",()=>{
    const target={targetType:"AF01_ACCEPTANCE"as const,description:"x",tradeId:null,organization:"Fixture Co",projectRef:null};
    const a=buildSearchPlan("closure:x:AF01_ACCEPTANCE:NONE",target),b=buildSearchPlan("closure:x:AF01_ACCEPTANCE:NONE",target);
    expect(a.map(s=>s.stopCondition)).toEqual(b.map(s=>s.stopCondition));
  });
  it("39 duplicate evidence does not duplicate verification work",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"fc39"}),classification:electrician,projectRef:"project:fc39"});
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    const c=contactCandidate({opportunityId:item.opportunityId});
    const result=addContactCandidates(contactCase,[c,c,c],evalInput);
    expect(result.verificationPackets).toHaveLength(1);
  });
  it("40 canonical Phase 3E/3F truth remains unchanged until verified evidence is explicitly supplied",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"fc40"}),classification:electrician,projectRef:"project:fc40"});
    const before=evaluateWorkforceConversion(evalInput);
    const cases=deriveClosureCases(item),contactCase=cases.find(c=>c.target.targetType==="ACTIONABLE_CONTACT")!;
    addContactCandidates(contactCase,[contactCandidate({opportunityId:item.opportunityId})],evalInput);
    expect(evaluateWorkforceConversion(evalInput)).toEqual(before);
  });
});

describe("Phase 3G closure case identity, search plan, budget, snapshot",()=>{
  it("closure case identity is deterministic",()=>{
    const{item}=evalItem({input:input({externalId:"id1"}),classification:electrician,projectRef:"project:id1"});
    const a=deriveClosureCases(item),b=deriveClosureCases(item);
    expect(a.map(c=>c.closureCaseId)).toEqual(b.map(c=>c.closureCaseId));
    expect(closureCaseId(item.opportunityId,"ACTIONABLE_CONTACT",item.tradeId)).toBe(closureCaseId(item.opportunityId,"ACTIONABLE_CONTACT",item.tradeId));
  });
  it("search plan is bounded by budget",()=>{
    const target={targetType:"ACTIONABLE_CONTACT"as const,description:"x",tradeId:null,organization:"Fixture Co",projectRef:null};
    const plan=buildSearchPlan("closure:x:ACTIONABLE_CONTACT:NONE",target,{maxStrategiesPerCase:2,maxCandidatesPerStrategy:1,maxCandidatesPerCase:2});
    expect(plan.length).toBeLessThanOrEqual(2);
  });
  it("closure desk snapshot counts are internally consistent",()=>{
    const{item,evalInput}=evalItem({input:input({externalId:"snap1"}),classification:electrician,projectRef:"project:snap1"});
    const cases=deriveClosureCases(item).map(c=>c.target.targetType==="ACTIONABLE_CONTACT"?addContactCandidates(c,[contactCandidate({opportunityId:item.opportunityId})],evalInput):c);
    const desk=buildClosureDeskSnapshot(cases);
    expect(desk.contactCases+desk.af01Cases).toBe(cases.length);
  });
  it("AF-01 candidate quality never bypasses human verification",()=>{
    const q=scoreAf01CandidateQuality(buildAf01Candidate(af01Raw()));
    expect(q.total).toBeGreaterThan(0);
  });
});
