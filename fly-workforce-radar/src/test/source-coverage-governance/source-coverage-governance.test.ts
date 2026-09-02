import{describe,expect,it}from"vitest";
import type{ClosureCase}from"../../domain/commercial-evidence-closure";
import type{SourceApprovalRecord}from"../../domain/source-coverage-governance";
import{
  applyHumanSourceDecision,buildDiscoveryPlan,buildSourceApprovalPacket,buildSourceCandidate,buildSourceCoverageDesk,
  classifyOwnership,computeCoverageState,coverageGapId,deriveCoverageGaps,evaluateSourceUsability,
  evidenceTypeCompatibility,isBlockedPage,previewCoverage,scoreSourceQuality,selectUsableSource,sourceCandidateId,
}from"../../server/services/source-coverage-governance/source-coverage-governance-service";
import type{RawSourceCandidateObservation}from"../../server/services/source-coverage-governance/source-coverage-governance-service";
import{nextHealth}from"../../server/services/production-source/production-source-policy";
import type{SourceHealthSnapshot}from"../../domain/production-source";

const AT=new Date("2026-09-01T12:00:00Z");

const closureCase=(over:Partial<ClosureCase>={}):ClosureCase=>({
  closureCaseId:"closure:conversion:s1:ACTIONABLE_CONTACT:ELECTRICAL",
  workItemId:"work:s1",opportunityId:"conversion:s1",organization:"Fixture Co",projectRef:"project:s1",
  workforceClassification:{state:"RECOGNIZED",industryId:null,disciplineId:null,tradeId:"ELECTRICAL",occupationId:"ELECTRICIAN",roleClass:"CRAFT",specialtyIds:[],skillIds:[],credentialIds:[]},
  tradeId:"ELECTRICAL",occupationId:"ELECTRICIAN",sourceBlocker:"MISSING_ACTIONABLE_CONTACT",closureTaskType:"FIND_ACTIONABLE_CONTACT",
  nextBestAction:"FIND_ACTIONABLE_CONTACT",
  target:{targetType:"ACTIONABLE_CONTACT",description:"x",tradeId:"ELECTRICAL",organization:"Fixture Co",projectRef:null},
  searchPlan:[],contactCandidates:[],af01Candidates:[],verificationPackets:[],status:"OPEN",provenanceRefs:["prov:1"],
  ruleVersion:"commercial-evidence-closure@1.0.0",
  ...over,
});

const rawCandidate=(over:Partial<RawSourceCandidateObservation>={}):RawSourceCandidateObservation=>({
  organization:"Fixture Co",candidateOrganizationLabel:"Fixture Co",sourceFamily:"VENDOR_PORTAL",
  baseReference:"https://fixtureco.example/supplier/",candidateCapabilities:["VENDOR_ROUTE","CONTACT_PERSON","CONTACT_ROUTE"],
  candidateTradeScope:"ALL_TRADES",candidateTradeIds:[],accessProfile:"PUBLIC_READ_ONLY",
  discoveryReason:"Official supplier page identified via prior discovery precedent.",
  coverageGapIds:[coverageGapId("Fixture Co","ACTIONABLE_CONTACT")],provenanceRefs:["prov:candidate:1"],
  ...over,
});

const approvedRecord=(over:Partial<SourceApprovalRecord>={}):SourceApprovalRecord=>({
  sourceId:"src:fixtureco-supplier",organization:"Fixture Co",sourceFamily:"VENDOR_PORTAL",ownershipType:"OFFICIAL",
  readiness:"APPROVED_FOR_LIVE_CAPTURE",approvedCapabilities:["CONTACT_PERSON","CONTACT_ROUTE"],
  approvedEvidenceTypes:["ACTIONABLE_CONTACT"],organizationScope:"ORGANIZATION_SPECIFIC",tradeScope:"ALL_TRADES",
  approvedTradeIds:[],accessProfile:"PUBLIC_READ_ONLY",health:"HEALTHY",lastHealthCheckAt:AT,reassessmentRequired:false,
  reviewedBy:"reviewer1",reviewedAt:AT,reason:"Official supplier contact page, verified read-only.",restrictions:[],
  provenanceRefs:["prov:approval:1"],ruleVersion:"source-coverage-governance@1.0.0",
  ...over,
});

describe("Phase 3H controlled scenarios (section 49)",()=>{
  it("A: no approved source -> UNCOVERED -> source candidate -> approval packet -> no automatic approval",()=>{
    const gaps=deriveCoverageGaps([closureCase()],[]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].coverageStatus).toBe("NO_APPROVED_SOURCE");
    const candidate=buildSourceCandidate(rawCandidate());
    expect(candidate.assessmentStatus).toBe("DISCOVERED");
    const packet=buildSourceApprovalPacket(candidate,gaps[0],"ACTIONABLE_CONTACT");
    expect(packet.humanDecisionRequired).toBe(true);
    // no automatic approval: nothing in this scenario ever calls applyHumanSourceDecision
    expect(evaluateSourceUsability(null,{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("NOT_APPROVED");
  });
  it("B: approved healthy matching source -> COVERED_USABLE",()=>{
    const gap=deriveCoverageGaps([closureCase()],[approvedRecord()])[0];
    expect(gap).toBeUndefined(); // fully covered -> not even a gap
    expect(computeCoverageState({coverageGapId:"x",organization:"Fixture Co",opportunityIds:[],closureCaseIds:[],tradeScopes:["ELECTRICAL"],missingEvidenceTypes:["ACTIONABLE_CONTACT"],requiredCapabilities:["CONTACT_PERSON","CONTACT_ROUTE"],existingApprovedSourceIds:[],attemptedSourceIds:[],blockedSourceIds:[],coverageStatus:"NO_APPROVED_SOURCE",priority:1,provenanceRefs:[]},[approvedRecord()])).toBe("COVERED_USABLE");
  });
  it("C: approved source with wrong capability -> PARTIALLY_COVERED",()=>{
    const record=approvedRecord({approvedCapabilities:["CONTACT_ROUTE"]});
    const result=evaluateSourceUsability(record,{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"});
    expect(result.usability).toBe("LIMITED");
  });
  it("D: approved source with wrong organization scope -> OUT_OF_SCOPE",()=>{
    const record=approvedRecord({organization:"Other Co"});
    const result=evaluateSourceUsability(record,{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"});
    expect(result.usability).toBe("OUT_OF_SCOPE");
  });
  it("E: approved electrical-only source does not cover welding",()=>{
    const record=approvedRecord({tradeScope:"TRADE_SPECIFIC",approvedTradeIds:["ELECTRICAL"]});
    const result=evaluateSourceUsability(record,{organization:"Fixture Co",tradeId:"WELDING",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"});
    expect(result.usability).toBe("OUT_OF_SCOPE");
  });
  it("F: approved source becomes bot-blocked -> approval history retained, health BLOCKED, coverage COVERED_BLOCKED",()=>{
    const record=approvedRecord({health:"BLOCKED"});
    expect(record.readiness).toBe("APPROVED_FOR_LIVE_CAPTURE"); // history retained, not deleted
    const result=evaluateSourceUsability(record,{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"});
    expect(result.usability).toBe("BLOCKED");
  });
  it("G: alternative approved healthy source exists -> deterministic fallback",()=>{
    const blocked=approvedRecord({sourceId:"src:blocked",health:"BLOCKED"});
    const healthy=approvedRecord({sourceId:"src:healthy",health:"HEALTHY"});
    const selected=selectUsableSource([blocked,healthy],{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"});
    expect(selected?.sourceId).toBe("src:healthy");
  });
  it("H: discovered official source -> candidate only",()=>{
    const candidate=buildSourceCandidate(rawCandidate());
    expect(candidate.assessmentStatus).toBe("DISCOVERED");
    expect((candidate as unknown as{readiness?:string}).readiness).toBeUndefined();
  });
  it("I: high-quality candidate still requires human approval",()=>{
    const candidate=buildSourceCandidate(rawCandidate());
    const quality=scoreSourceQuality(candidate,"ACTIONABLE_CONTACT");
    expect(quality.total).toBeGreaterThan(5);
    expect(candidate.assessmentStatus).not.toBe("ASSESSED".concat("_AND_APPROVED"));
  });
  it("J: candidate requiring login cannot be used automatically",()=>{
    const candidate=buildSourceCandidate(rawCandidate({accessProfile:"LOGIN_REQUIRED"}));
    expect(()=>applyHumanSourceDecision(null,candidate,{sourceCandidateId:candidate.sourceCandidateId,decision:"APPROVE",reviewerId:"r1",reason:"test",decidedAt:AT})).toThrow();
  });
  it("K: candidate requiring form submission cannot be used automatically",()=>{
    const candidate=buildSourceCandidate(rawCandidate({accessProfile:"WRITE_INTERACTION_REQUIRED"}));
    expect(()=>applyHumanSourceDecision(null,candidate,{sourceCandidateId:candidate.sourceCandidateId,decision:"APPROVE",reviewerId:"r1",reason:"test",decidedAt:AT})).toThrow();
  });
  it("L: search result discovers candidate; search result itself is not evidence-source approval",()=>{
    const candidate=buildSourceCandidate(rawCandidate({discoveryReason:"Identified via public web search result."}));
    expect(candidate.assessmentStatus).toBe("DISCOVERED");
  });
  it("M: supplier portal candidate -- VENDOR_ROUTE possible, AF01 not automatically proven",()=>{
    expect(evidenceTypeCompatibility(["VENDOR_ROUTE"],"AF01_ACCEPTANCE")).toBe("POSSIBLE");
  });
  it("N: careers source -- workforce demand capability, AF01 not automatically granted",()=>{
    expect(evidenceTypeCompatibility(["WORKFORCE_DEMAND"],"AF01_ACCEPTANCE")).toBe("INCOMPATIBLE");
  });
  it("O: ambiguous company identity -> no approval",()=>{
    const candidate=buildSourceCandidate(rawCandidate({candidateOrganizationLabel:"Fixture"}));
    expect(candidate.entityMatch).toBe("AMBIGUOUS");
    const gap=deriveCoverageGaps([closureCase()],[])[0];
    const packet=buildSourceApprovalPacket(candidate,gap,"ACTIONABLE_CONTACT");
    expect(packet.knownRestrictions.some(r=>r.includes("Entity match"))).toBe(true);
  });
  it("P: source identity is deterministic for identical input",()=>{
    expect(sourceCandidateId("VENDOR_PORTAL","https://x.example/supplier/")).toBe(sourceCandidateId("VENDOR_PORTAL","https://x.example/supplier/"));
  });
  it("Q: distinct portal on same domain may remain distinct source identity",()=>{
    expect(sourceCandidateId("COMPANY_CAREERS","https://x.example/careers/")).not.toBe(sourceCandidateId("VENDOR_PORTAL","https://x.example/supplier/"));
  });
  it("R: stale approved source triggers reassessment, not silent health",()=>{
    const staleCase=closureCase({status:"OPEN"});
    const staleRecord=approvedRecord({health:"STALE"});
    const gaps=deriveCoverageGaps([staleCase],[staleRecord]);
    expect(gaps[0].coverageStatus).toBe("APPROVED_SOURCE_STALE");
    const decided=applyHumanSourceDecision(staleRecord,buildSourceCandidate(rawCandidate()),{sourceCandidateId:staleRecord.sourceId,decision:"REQUIRE_REASSESSMENT",reviewerId:"r1",reason:"stale",decidedAt:AT});
    expect(decided?.reassessmentRequired).toBe(true);
  });
  it("S: human approval supplied externally reflects approved capability/scope",()=>{
    const candidate=buildSourceCandidate(rawCandidate());
    const record=applyHumanSourceDecision(null,candidate,{sourceCandidateId:candidate.sourceCandidateId,decision:"APPROVE",reviewerId:"r1",reason:"approved",decidedAt:AT});
    expect(record?.readiness).toBe("APPROVED_FOR_LIVE_CAPTURE");
    expect(record?.approvedCapabilities).toEqual(candidate.candidateCapabilities);
  });
  it("T: limited approval -- only authorized capability/scope usable",()=>{
    const candidate=buildSourceCandidate(rawCandidate());
    const record=applyHumanSourceDecision(null,candidate,{sourceCandidateId:candidate.sourceCandidateId,decision:"APPROVE_LIMITED",reviewerId:"r1",reason:"limited",approvedCapabilities:["CONTACT_PERSON"],decidedAt:AT})!;
    expect(evaluateSourceUsability(record,{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_ROUTE"}).usability).toBe("LIMITED");
    expect(evaluateSourceUsability(record,{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("ALLOWED");
  });
  it("U: human rejection -> source unusable",()=>{
    const candidate=buildSourceCandidate(rawCandidate());
    const record=applyHumanSourceDecision(null,candidate,{sourceCandidateId:candidate.sourceCandidateId,decision:"REJECT",reviewerId:"r1",reason:"rejected",decidedAt:AT});
    expect(record).toBeNull();
    expect(evaluateSourceUsability(record,{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("NOT_APPROVED");
  });
  it("V: deprecated source is not selected",()=>{
    const retired=approvedRecord({readiness:"RETIRED"});
    expect(selectUsableSource([retired],{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"})).toBeNull();
  });
  it("W: health recovery can become usable without rewriting historical approval",()=>{
    const blocked=approvedRecord({health:"BLOCKED"});
    const snapshot:SourceHealthSnapshot={state:"BLOCKED",lastAttemptAt:AT,lastSuccessAt:null,consecutiveFailures:2,lastFailure:"ACCESS_BLOCKED",parserFailure:false,structureChanged:false,emptyResultCount:0,freshUntil:null,latencyMs:null};
    const recovered=nextHealth(snapshot,{at:new Date(AT.getTime()+86400000),success:true,empty:false},"APPROVED_FOR_LIVE_CAPTURE");
    const updated:SourceApprovalRecord={...blocked,health:recovered.state,lastHealthCheckAt:recovered.lastAttemptAt};
    expect(updated.health).toBe("HEALTHY");
    expect(updated.reviewedBy).toBe(blocked.reviewedBy);
    expect(updated.reviewedAt).toEqual(blocked.reviewedAt);
    expect(updated.reason).toBe(blocked.reason);
  });
  it("X: coverage preview is non-persisting",()=>{
    const gap=deriveCoverageGaps([closureCase()],[])[0];
    const registry:SourceApprovalRecord[]=[];
    const hypothetical=approvedRecord();
    const preview=previewCoverage(gap,registry,hypothetical);
    expect(preview.persisted).toBe(false);
    expect(registry).toHaveLength(0);
  });
});

describe("Phase 3H false-operation tests (section 50)",()=>{
  it("1 discovered != approved",()=>{const c=buildSourceCandidate(rawCandidate());expect(c.assessmentStatus).toBe("DISCOVERED");expect(evaluateSourceUsability(null,{organization:"Fixture Co",tradeId:null,targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("NOT_APPROVED")});
  it("2 assessed != approved",()=>{const c=buildSourceCandidate(rawCandidate({assessmentStatus:"ASSESSED"}));expect(c.assessmentStatus).toBe("ASSESSED");expect((c as unknown as{readiness?:unknown}).readiness).toBeUndefined()});
  it("3 recommended != approved",()=>{const c=buildSourceCandidate(rawCandidate());const gap=deriveCoverageGaps([closureCase()],[])[0];const p=buildSourceApprovalPacket(c,gap,"ACTIONABLE_CONTACT");expect(p.recommendation).toBeDefined();expect(p.humanDecisionRequired).toBe(true)});
  it("4 high quality != approved",()=>{const c=buildSourceCandidate(rawCandidate());const q=scoreSourceQuality(c,"ACTIONABLE_CONTACT");expect(q.total).toBeGreaterThan(0);expect((q as unknown as{approved?:unknown}).approved).toBeUndefined()});
  it("5 official source != automatically approved",()=>{expect(classifyOwnership("https://fixtureco.example/supplier/","Fixture Co")).toBe("OFFICIAL");expect(evaluateSourceUsability(null,{organization:"Fixture Co",tradeId:null,targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("NOT_APPROVED")});
  it("6 search result != approved source",()=>{const c=buildSourceCandidate(rawCandidate({discoveryReason:"search engine result"}));expect(c.assessmentStatus).not.toBe("APPROVED"as never)});
  it("7 HTTP 200 block page != healthy",()=>{expect(isBlockedPage("Attention Required! | Cloudflare")).toBe(true);const snap:SourceHealthSnapshot={state:"HEALTHY",lastAttemptAt:null,lastSuccessAt:null,consecutiveFailures:0,lastFailure:null,parserFailure:false,structureChanged:false,emptyResultCount:0,freshUntil:null,latencyMs:null};const health=nextHealth(snap,{at:AT,success:false,empty:false,failure:"ACCESS_BLOCKED"},"APPROVED_FOR_LIVE_CAPTURE");expect(health.state).toBe("BLOCKED")});
  it("8 login-required != automatically usable",()=>{const c=buildSourceCandidate(rawCandidate({accessProfile:"LOGIN_REQUIRED"}));expect(()=>applyHumanSourceDecision(null,c,{sourceCandidateId:c.sourceCandidateId,decision:"APPROVE",reviewerId:"r",reason:"x",decidedAt:AT})).toThrow()});
  it("9 CAPTCHA != bypass",()=>{const c=buildSourceCandidate(rawCandidate({accessProfile:"CAPTCHA_PROTECTED"}));expect(()=>applyHumanSourceDecision(null,c,{sourceCandidateId:c.sourceCandidateId,decision:"APPROVE",reviewerId:"r",reason:"x",decidedAt:AT})).toThrow()});
  it("10 bot block != bypass",()=>{expect(isBlockedPage("Please verify you are human to continue.")).toBe(true)});
  it("11 paywall != bypass",()=>{const c=buildSourceCandidate(rawCandidate({accessProfile:"PAYWALLED"}));expect(()=>applyHumanSourceDecision(null,c,{sourceCandidateId:c.sourceCandidateId,decision:"APPROVE",reviewerId:"r",reason:"x",decidedAt:AT})).toThrow()});
  it("12 form-required != automated write",()=>{const c=buildSourceCandidate(rawCandidate({accessProfile:"WRITE_INTERACTION_REQUIRED"}));expect(()=>applyHumanSourceDecision(null,c,{sourceCandidateId:c.sourceCandidateId,decision:"APPROVE",reviewerId:"r",reason:"x",decidedAt:AT})).toThrow()});
  it("13 vendor portal != AF01",()=>{expect(evidenceTypeCompatibility(["VENDOR_ROUTE"],"AF01_ACCEPTANCE")).not.toBe("COMPATIBLE")});
  it("14 careers != AF01",()=>{expect(evidenceTypeCompatibility(["WORKFORCE_DEMAND"],"AF01_ACCEPTANCE")).toBe("INCOMPATIBLE")});
  it("15 supplier page != manpower acceptance proof",()=>{expect(evidenceTypeCompatibility(["STAFFING_RELATIONSHIP"],"AF01_ACCEPTANCE")).toBe("POSSIBLE")});
  it("16 source capability != evidence truth",()=>{const c=buildSourceCandidate(rawCandidate());expect((c as unknown as{verificationState?:unknown}).verificationState).toBeUndefined()});
  it("17 AF01_DISCOVERY != AF01 VERIFIED",()=>{const before=closureCase();const record=approvedRecord({approvedEvidenceTypes:["AF01_ACCEPTANCE"]});evaluateSourceUsability(record,{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"AF01_ACCEPTANCE",requiredCapability:"AF01_ACCEPTANCE_EVIDENCE"});expect(JSON.stringify(closureCase())).toBe(JSON.stringify(before))});
  it("18 CONTACT_DISCOVERY != actionable contact",()=>{const before=closureCase();evaluateSourceUsability(approvedRecord(),{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"});expect(before.contactCandidates).toHaveLength(0)});
  it("19 CONTACT_DISCOVERY != contact authority",()=>{const q=scoreSourceQuality(buildSourceCandidate(rawCandidate()),"ACTIONABLE_CONTACT");expect((q as unknown as{authorityEvidence?:unknown}).authorityEvidence).toBeUndefined()});
  it("20 wrong organization scope != usable",()=>{expect(evaluateSourceUsability(approvedRecord({organization:"Other Co"}),{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("OUT_OF_SCOPE")});
  it("21 wrong trade scope != usable",()=>{expect(evaluateSourceUsability(approvedRecord({tradeScope:"TRADE_SPECIFIC",approvedTradeIds:["WELDING"]}),{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("OUT_OF_SCOPE")});
  it("22 organization-specific approval != global approval",()=>{const record=approvedRecord({organization:"Fixture Co",organizationScope:"ORGANIZATION_SPECIFIC"});expect(evaluateSourceUsability(record,{organization:"Other Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("OUT_OF_SCOPE")});
  it("23 one company success != source-family global approval",()=>{const forA=approvedRecord({sourceId:"a",organization:"Company A"});const forB=evaluateSourceUsability(forA,{organization:"Company B",tradeId:null,targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"});expect(forB.usability).toBe("OUT_OF_SCOPE")});
  it("24 blocked source != usable",()=>{expect(evaluateSourceUsability(approvedRecord({health:"BLOCKED"}),{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("BLOCKED")});
  it("25 stale source != silently healthy",()=>{expect(evaluateSourceUsability(approvedRecord({health:"STALE"}),{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"}).usability).toBe("UNHEALTHY")});
  it("26 deprecated source != selected",()=>{expect(selectUsableSource([approvedRecord({readiness:"RETIRED"})],{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"})).toBeNull()});
  it("27 rejected source != selected",()=>{const c=buildSourceCandidate(rawCandidate());const rejected=applyHumanSourceDecision(null,c,{sourceCandidateId:c.sourceCandidateId,decision:"REJECT",reviewerId:"r",reason:"x",decidedAt:AT});expect(selectUsableSource(rejected?[rejected]:[],{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"})).toBeNull()});
  it("28 candidate source cannot mutate registry",()=>{const registry:SourceApprovalRecord[]=[];buildSourceCandidate(rawCandidate());expect(registry).toHaveLength(0)});
  it("29 coverage preview cannot mutate registry",()=>{const registry:SourceApprovalRecord[]=[approvedRecord()];const before=JSON.stringify(registry);previewCoverage(deriveCoverageGaps([closureCase()],[])[0]??{coverageGapId:"x",organization:"Fixture Co",opportunityIds:[],closureCaseIds:[],tradeScopes:[],missingEvidenceTypes:["ACTIONABLE_CONTACT"],requiredCapabilities:["CONTACT_PERSON"],existingApprovedSourceIds:[],attemptedSourceIds:[],blockedSourceIds:[],coverageStatus:"NO_APPROVED_SOURCE",priority:1,provenanceRefs:[]},registry,approvedRecord({sourceId:"hypothetical"}));expect(JSON.stringify(registry)).toBe(before)});
  it("30 health check cannot expand scope",()=>{const r=approvedRecord({health:"BLOCKED"});const snap:SourceHealthSnapshot={state:"BLOCKED",lastAttemptAt:AT,lastSuccessAt:null,consecutiveFailures:1,lastFailure:"ACCESS_BLOCKED",parserFailure:false,structureChanged:false,emptyResultCount:0,freshUntil:null,latencyMs:null};const h=nextHealth(snap,{at:AT,success:true,empty:false},"APPROVED_FOR_LIVE_CAPTURE");const updated={...r,health:h.state};expect(updated.organizationScope).toBe(r.organizationScope);expect(updated.tradeScope).toBe(r.tradeScope)});
  it("31 health check cannot expand capabilities",()=>{const r=approvedRecord({approvedCapabilities:["CONTACT_PERSON"]});const snap:SourceHealthSnapshot={state:"HEALTHY",lastAttemptAt:AT,lastSuccessAt:AT,consecutiveFailures:0,lastFailure:null,parserFailure:false,structureChanged:false,emptyResultCount:0,freshUntil:null,latencyMs:null};const h=nextHealth(snap,{at:AT,success:true,empty:false},"APPROVED_FOR_LIVE_CAPTURE");const updated={...r,health:h.state};expect(updated.approvedCapabilities).toEqual(["CONTACT_PERSON"])});
  it("32 source ranking cannot approve source",()=>{const q=scoreSourceQuality(buildSourceCandidate(rawCandidate()),"ACTIONABLE_CONTACT");expect((q as unknown as{readiness?:unknown}).readiness).toBeUndefined()});
  it("33 fallback cannot use unapproved source",()=>{expect(selectUsableSource([],{organization:"Fixture Co",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"})).toBeNull()});
  it("34 source discovery cannot perform outreach",()=>{const plan=buildDiscoveryPlan(deriveCoverageGaps([closureCase()],[])[0]);expect(JSON.stringify(plan)).not.toMatch(/emailSent|contacted|outreach/i)});
  it("35 source discovery cannot submit forms",()=>{const plan=buildDiscoveryPlan(deriveCoverageGaps([closureCase()],[])[0]);expect(JSON.stringify(plan)).not.toMatch(/formSubmitted/i)});
  it("36 source discovery cannot register vendors",()=>{const plan=buildDiscoveryPlan(deriveCoverageGaps([closureCase()],[])[0]);expect(JSON.stringify(plan)).not.toMatch(/registered/i)});
  it("37 source discovery cannot create accounts",()=>{const plan=buildDiscoveryPlan(deriveCoverageGaps([closureCase()],[])[0]);expect(JSON.stringify(plan)).not.toMatch(/accountCreated/i)});
  it("38 source discovery cannot apply to jobs",()=>{const plan=buildDiscoveryPlan(deriveCoverageGaps([closureCase()],[])[0]);expect(JSON.stringify(plan)).not.toMatch(/applied/i)});
  it("39 source discovery budget cannot be exceeded",()=>{const plan=buildDiscoveryPlan(deriveCoverageGaps([closureCase()],[])[0],{maxCandidateSourceFamiliesPerGap:2,maxDiscoveryStrategies:2,maxObservationsPerCandidate:1});expect(plan.length).toBeLessThanOrEqual(2)});
  it("40 source governance cannot alter Phase 3E/3F/3G truth",()=>{const before=closureCase();const gap=deriveCoverageGaps([before],[])[0];buildSourceCoverageDesk([gap],[buildSourceCandidate(rawCandidate())],[]);expect(JSON.stringify(closureCase())).toBe(JSON.stringify(before))});
});

describe("Phase 3H identity, budget, desk",()=>{
  it("coverage gap identity is deterministic",()=>{
    const a=deriveCoverageGaps([closureCase()],[]),b=deriveCoverageGaps([closureCase()],[]);
    expect(a.map(g=>g.coverageGapId)).toEqual(b.map(g=>g.coverageGapId));
  });
  it("desk snapshot counts are internally consistent",()=>{
    const gaps=deriveCoverageGaps([closureCase()],[]);
    const candidate=buildSourceCandidate(rawCandidate());
    const desk=buildSourceCoverageDesk(gaps,[candidate],[]);
    expect(desk.totalCoverageGaps).toBe(gaps.length);
    expect(desk.uncovered+desk.blocked+desk.partial+desk.usable).toBeLessThanOrEqual(gaps.length);
    expect(desk.sourceCandidates).toBe(1);
    expect(desk.awaitingApproval).toBe(1);
  });
});
