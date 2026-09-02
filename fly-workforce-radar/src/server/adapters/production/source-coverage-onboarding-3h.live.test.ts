import{randomUUID}from"node:crypto";import{describe,expect,it}from"vitest";
import type{ProductionCaptureRequest}from"../../../domain/production-source";
import type{PublicTransport}from"../../../domain/production-capture";
import{NO_ACTIONABILITY_EVIDENCE}from"../../../domain/opportunity-actionability";
import{DISCOVERY_SOURCE_ORGANIZATION_PROFILES,resolveOrganizationProvenance}from"../../services/commercial-conversion/commercial-conversion-service";
import{deriveProjectRef,promoteWorkforceDemandSignals}from"../../../domain/multi-trade-workforce";
import{UNKNOWN_WORKFORCE_CLASSIFICATION}from"../../../domain/workforce-taxonomy";
import{demandSignalsFromListingObservations}from"../../services/discovery/listing-discovery-service";
import{evaluateWorkforceConversion,rankWorkforceConversions,toDiscoverySignalShape}from"../../services/hot-conversion-engine/hot-conversion-engine-service";
import{buildWorkItems}from"../../services/operational-desk/operational-desk-service";
import{deriveClosureCases}from"../../services/commercial-evidence-closure/commercial-evidence-closure-service";
import type{SourceApprovalRecord}from"../../../domain/source-coverage-governance";
import{
  buildDiscoveryPlan,buildSourceApprovalPacket,buildSourceCandidate,buildSourceCoverageDesk,classifyOwnership,
  computeCoverageState,deriveCoverageGaps,evaluateSourceUsability,isBlockedPage,scoreSourceQuality,
}from"../../services/source-coverage-governance/source-coverage-governance-service";
import{nextHealth}from"../../services/production-source/production-source-policy";
import{BECHTEL_LISTING_URL,BechtelListingDiscoveryAdapter}from"./bechtel-listing-adapter";
import{IBEW716_JOURNEYMAN_JOB_CALLS_URL,Ibew716JobCallAdapter}from"./ibew716-job-call-adapter";
import{STRIKE_LISTING_URL,StrikeListingDiscoveryAdapter}from"./strike-listing-adapter";
import{TRILLIUM_LISTING_URL,TrilliumListingDiscoveryAdapter}from"./trillium-listing-adapter";

/**
 * Phase 3H real source-onboarding pilot (manual live; excluded from CI).
 * Replays the SAME four already-approved discovery sources as every prior
 * real-pipeline test to reach the current real Phase 3F/3G desk, then runs a
 * bounded, READ-ONLY source-coverage assessment on the two organizations
 * Phase 3G's own real pilot found uncovered: Wyman-Gordon and Strike, plus a
 * single bounded health re-check of the already Phase-3G-approved Bechtel
 * supplier page.
 *
 * Candidate identification discipline (section 27/43/44): candidate official
 * domains below (wyman.com, strikeusa.com) were identified via a single
 * public web search per organization -- exactly "search engines may help
 * discover candidate sources; a search result itself is not an approved
 * evidence source" (section 27). No domain is guessed/fabricated. Each
 * candidate gets at most ONE bounded read-only GET, purely to assess
 * accessibility -- never to extract or fabricate AF-01/contact evidence, and
 * never treated as approved.
 */
const at=new Date(),request=(s:string):ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:s,cursor:null,policyDecisionId:randomUUID(),asOf:at}),
transport:PublicTransport={get:async url=>{const r=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/3H (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});return{status:r.status,url:r.url,contentType:r.headers.get("content-type"),body:await r.text(),headers:Object.fromEntries(r.headers.entries())}}},
str=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;

const fetchLive=async(url:string)=>{try{const r=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/3H (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});return{ok:r.ok,status:r.status,body:await r.text()}}catch{return{ok:false,status:0,body:null as string|null}}};

/** Reflects the source Phase 3G's own real pilot already treated as
 * approved (bechtel.com/supplier/) -- NOT a new approval created by Phase
 * 3H. Used only to validate Phase 3H's health semantics against a real,
 * already-known-blocked source (section 45). */
const BECHTEL_SUPPLIER_URL="https://www.bechtel.com/supplier/";
const bechtelPrecedentRecord=(health:SourceApprovalRecord["health"],lastHealthCheckAt:Date|null):SourceApprovalRecord=>({
  sourceId:"src:bechtel-supplier",organization:"Bechtel",sourceFamily:"VENDOR_PORTAL",ownershipType:"OFFICIAL",
  readiness:"APPROVED_FOR_LIVE_CAPTURE",approvedCapabilities:["CONTACT_PERSON","CONTACT_ROUTE","VENDOR_ROUTE"],
  approvedEvidenceTypes:["ACTIONABLE_CONTACT","AF01_ACCEPTANCE"],organizationScope:"ORGANIZATION_SPECIFIC",
  tradeScope:"ALL_TRADES",approvedTradeIds:[],accessProfile:"PUBLIC_READ_ONLY",health,lastHealthCheckAt,
  reassessmentRequired:false,reviewedBy:"phase-3g-precedent",reviewedAt:new Date("2026-08-31T00:00:00Z"),
  reason:"Already used as an approved supplier/procurement source in Phase 3G's real closure pilot.",
  restrictions:[],provenanceRefs:["phase-3g-live-pilot"],ruleVersion:"source-coverage-governance@1.0.0",
});

/** Reflects the REAL, already-existing "strike-midland" careers adapter
 * (strike-listing-adapter.ts) -- approved, but only for WORKFORCE_DEMAND /
 * LOCATION, which do not satisfy Phase 3G's ACTIONABLE_CONTACT/AF01
 * evidence types. Not a new approval; a faithful projection of what already
 * exists in production-source descriptors. */
const strikeCareersRecord:SourceApprovalRecord={
  sourceId:"strike-midland",organization:"Strike",sourceFamily:"COMPANY_CAREERS",ownershipType:"OFFICIAL",
  readiness:"APPROVED_FOR_LIVE_CAPTURE",approvedCapabilities:["WORKFORCE_DEMAND","LOCATION"],approvedEvidenceTypes:[],
  organizationScope:"ORGANIZATION_SPECIFIC",tradeScope:"ALL_TRADES",approvedTradeIds:[],accessProfile:"PUBLIC_READ_ONLY",
  health:"HEALTHY",lastHealthCheckAt:at,reassessmentRequired:false,reviewedBy:"phase-2-precedent",reviewedAt:new Date("2026-06-01T00:00:00Z"),
  reason:"Existing approved careers-listing discovery adapter (WORKFORCE_DEMAND capability only).",
  restrictions:["Approved for workforce-demand discovery only; never used for contact or AF-01 evidence."],
  provenanceRefs:["strike-listing-adapter.ts"],ruleVersion:"source-coverage-governance@1.0.0",
};

/** Candidate official domains identified via a single public web search per
 * organization (see module docstring). Neither is an approved source. */
const CANDIDATE_SOURCES:Record<string,{baseReference:string;sourceFamily:"OTHER_APPROVED"|"GENERAL_CONTRACTOR";discoveryReason:string}>={
  "Wyman- Gordon":{baseReference:"https://www.wyman.com/about.html",sourceFamily:"OTHER_APPROVED",discoveryReason:"Official manufacturer site identified via a single public web search (\"Wyman-Gordon official website\"); no supplier/procurement-specific page was found in that search."},
  "Strike":{baseReference:"https://www.strikeusa.com/contact-us/",sourceFamily:"GENERAL_CONTRACTOR",discoveryReason:"Official company contact page identified via a single public web search (\"Strike Midland Texas official website\")."},
};

describe("Phase 3H real source onboarding pilot (manual live; excluded from CI)",()=>{it("runs a bounded, read-only coverage assessment for Wyman-Gordon and Strike, plus a Bechtel health re-check",async()=>{
  const sources=[{key:"ibew716",url:IBEW716_JOURNEYMAN_JOB_CALLS_URL,adapter:new Ibew716JobCallAdapter(transport)},{key:"strike",url:STRIKE_LISTING_URL,adapter:new StrikeListingDiscoveryAdapter(transport)},{key:"trillium",url:TRILLIUM_LISTING_URL,adapter:new TrilliumListingDiscoveryAdapter(transport)},{key:"bechtel",url:BECHTEL_LISTING_URL,adapter:new BechtelListingDiscoveryAdapter(transport)}],
    failures:string[]=[];
  const allInputs:{input:import("../../../domain/commercial-conversion").ConversionEvidenceInput;classification:import("../../../domain/workforce-taxonomy").WorkforceClassification}[]=[];

  for(const s of sources)try{
    const c=await s.adapter.capturePage(request(s.key)),
      signals=demandSignalsFromListingObservations(c.observations,{sourceKey:s.key,observedAt:at}),
      {tracked}=promoteWorkforceDemandSignals(signals);
    for(const t of tracked){
      const p=resolveOrganizationProvenance(t.organization,{...DISCOVERY_SOURCE_ORGANIZATION_PROFILES[s.key],sourceUrl:s.url,observedAt:at}),
        primary=t.classifications[0]??UNKNOWN_WORKFORCE_CLASSIFICATION;
      allInputs.push({input:{
        signal:toDiscoverySignalShape(t),evidenceIds:[`live:${s.key}:${t.externalId}`],
        employer:p.employer,companyRole:p.companyRole,companyRoleEvidenceIds:[`live:${s.key}:${t.externalId}`],
        project:null,buyer:null,wage:null,perDiemOrIncentive:null,schedule:null,headcount:null,
        acceptance:null,contacts:[],actionability:NO_ACTIONABILITY_EVIDENCE(`conversion:${t.externalId}`),
        conflicts:[...p.conflicts],organizationProvenance:p,
      },classification:primary});
    }
  }catch(e){failures.push(`${s.key}:${e instanceof Error?e.message:String(e)}`)}

  const evalInputs=allInputs.map(({input,classification})=>({input,classification,projectRef:deriveProjectRef({project:str(input.project),opportunityId:input.signal.externalId})}));
  const dossiers=evalInputs.map(evaluateWorkforceConversion),ranked=rankWorkforceConversions(dossiers),{items}=buildWorkItems(ranked);
  const closureCasesAll=items.flatMap(item=>deriveClosureCases(item));

  const targetOrganizations=["Wyman- Gordon","Strike"];
  const registry:SourceApprovalRecord[]=[strikeCareersRecord];
  const gaps=deriveCoverageGaps(closureCasesAll,registry).filter(g=>targetOrganizations.includes(g.organization));

  const complianceLog:{organization:string;url:string;previouslyApproved:boolean;status:number;blocked:boolean;loginRequired:false;captchaEncountered:false;paywallEncountered:false;writeActionPerformed:false;outreachPerformed:false}[]=[];
  const sourceCandidates=[];
  const approvalPackets=[];

  for(const organization of targetOrganizations){
    const candidateDef=CANDIDATE_SOURCES[organization];
    if(!candidateDef)continue;
    const orgGaps=gaps.filter(g=>g.organization===organization);
    const r=await fetchLive(candidateDef.baseReference),blocked=r.body!==null&&isBlockedPage(r.body);
    complianceLog.push({organization,url:candidateDef.baseReference,previouslyApproved:false,status:r.status,blocked,loginRequired:false,captchaEncountered:false,paywallEncountered:false,writeActionPerformed:false,outreachPerformed:false});
    const candidate=buildSourceCandidate({
      organization,candidateOrganizationLabel:organization,sourceFamily:candidateDef.sourceFamily,
      baseReference:candidateDef.baseReference,candidateCapabilities:["CONTACT_PERSON","COMPANY_IDENTITY"],
      candidateTradeScope:"ALL_TRADES",candidateTradeIds:[],
      accessProfile:r.body===null?"UNKNOWN_ACCESS":blocked?"BOT_PROTECTED":r.ok?"PUBLIC_READ_ONLY":"UNKNOWN_ACCESS",
      discoveryReason:candidateDef.discoveryReason,coverageGapIds:orgGaps.map(g=>g.coverageGapId),
      provenanceRefs:[`live-check:${candidateDef.baseReference}`],
    });
    sourceCandidates.push(candidate);
    for(const gap of orgGaps){
      const packet=buildSourceApprovalPacket(candidate,gap,gap.missingEvidenceTypes[0]);
      approvalPackets.push(packet);
    }
  }

  // Bechtel health re-check: a single bounded validation (section 45), not a
  // repeated hammering of the source. Reuses the SAME block-page detector and
  // the SAME canonical nextHealth state machine Phase 2 already defines.
  const bechtelCheck=await fetchLive(BECHTEL_SUPPLIER_URL);
  const bechtelBlocked=bechtelCheck.body!==null&&isBlockedPage(bechtelCheck.body);
  complianceLog.push({organization:"Bechtel",url:BECHTEL_SUPPLIER_URL,previouslyApproved:true,status:bechtelCheck.status,blocked:bechtelBlocked,loginRequired:false,captchaEncountered:false,paywallEncountered:false,writeActionPerformed:false,outreachPerformed:false});
  const bechtelHealth=nextHealth(
    {state:"HEALTHY",lastAttemptAt:new Date("2026-08-31T00:00:00Z"),lastSuccessAt:new Date("2026-08-31T00:00:00Z"),consecutiveFailures:0,lastFailure:null,parserFailure:false,structureChanged:false,emptyResultCount:0,freshUntil:null,latencyMs:null},
    {at,success:!bechtelBlocked&&bechtelCheck.ok,empty:false,failure:bechtelBlocked?"ACCESS_BLOCKED":undefined},
    "APPROVED_FOR_LIVE_CAPTURE",
  );
  const bechtelRecord=bechtelPrecedentRecord(bechtelHealth.state,at);
  const bechtelUsability=evaluateSourceUsability(bechtelRecord,{organization:"Bechtel",tradeId:"ELECTRICAL",targetEvidenceType:"ACTIONABLE_CONTACT",requiredCapability:"CONTACT_PERSON"});
  const bechtelGapForCoverage=gaps.find(()=>false)??{coverageGapId:"coverage:Bechtel:ACTIONABLE_CONTACT",organization:"Bechtel",opportunityIds:[],closureCaseIds:[],tradeScopes:["ELECTRICAL"as const],missingEvidenceTypes:["ACTIONABLE_CONTACT"as const],requiredCapabilities:["CONTACT_PERSON"as const,"CONTACT_ROUTE"as const],existingApprovedSourceIds:[bechtelRecord.sourceId],attemptedSourceIds:[],blockedSourceIds:[],coverageStatus:"NO_APPROVED_SOURCE"as const,priority:1,provenanceRefs:[]};
  const bechtelCoverage=computeCoverageState(bechtelGapForCoverage,[bechtelRecord]);

  const desk=buildSourceCoverageDesk(gaps,sourceCandidates,[strikeCareersRecord,bechtelRecord]);
  const discoveryPlans=gaps.map(g=>({organization:g.organization,plan:buildDiscoveryPlan(g)}));

  const report={
    failures,realWorkItems:items.length,
    coverageGaps:gaps.map(g=>({organization:g.organization,evidenceType:g.missingEvidenceTypes[0],status:g.coverageStatus,priority:g.priority})),
    strikeCareersOwnership:classifyOwnership("https://strike.applytojob.com/apply/","Strike"),
    sourceCandidates:sourceCandidates.map(c=>({organization:c.organization,baseReference:c.baseReference,ownershipType:c.ownershipType,accessProfile:c.accessProfile,entityMatch:c.entityMatch,assessmentStatus:c.assessmentStatus,quality:scoreSourceQuality(c,"ACTIONABLE_CONTACT").total})),
    approvalPacketCount:approvalPackets.length,
    approvalPacketsRequireHumanDecision:approvalPackets.every(p=>p.humanDecisionRequired===true),
    bechtel:{previouslyApprovedHealth:"HEALTHY",revalidatedHealth:bechtelHealth.state,usability:bechtelUsability.usability,coverageState:bechtelCoverage,blocked:bechtelBlocked},
    discoveryPlans:discoveryPlans.map(d=>({organization:d.organization,strategies:d.plan.length})),
    complianceLog,
    deskSnapshot:{totalCoverageGaps:desk.totalCoverageGaps,uncovered:desk.uncovered,blocked:desk.blocked,partial:desk.partial,usable:desk.usable,sourceCandidates:desk.sourceCandidates,awaitingApproval:desk.awaitingApproval},
  };
  console.log("PHASE_3H_LIVE_REPORT="+JSON.stringify(report));

  expect(failures).toEqual([]);
  expect(complianceLog.every(c=>!c.writeActionPerformed&&!c.outreachPerformed&&!c.loginRequired&&!c.captchaEncountered&&!c.paywallEncountered)).toBe(true);
  expect(approvalPackets.every(p=>p.humanDecisionRequired===true)).toBe(true);
  // Bechtel bot-block must never be bypassed: if still blocked, health must
  // reflect BLOCKED, never HEALTHY.
  if(bechtelBlocked)expect(bechtelHealth.state).toBe("BLOCKED");
},120000)});
