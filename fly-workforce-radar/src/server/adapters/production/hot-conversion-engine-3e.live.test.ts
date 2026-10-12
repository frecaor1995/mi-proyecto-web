import{randomUUID}from"node:crypto";import{describe,expect,it}from"vitest";
import type{ConversionEvidenceInput}from"../../../domain/commercial-conversion";
import type{ProductionCaptureRequest}from"../../../domain/production-source";
import type{PublicTransport}from"../../../domain/production-capture";
import{NO_ACTIONABILITY_EVIDENCE}from"../../../domain/opportunity-actionability";
import{DISCOVERY_SOURCE_ORGANIZATION_PROFILES,resolveOrganizationProvenance}from"../../services/commercial-conversion/commercial-conversion-service";
import{deriveProjectRef,promoteWorkforceDemandSignals}from"../../../domain/multi-trade-workforce";
import{UNKNOWN_WORKFORCE_CLASSIFICATION}from"../../../domain/workforce-taxonomy";
import type{WorkforceClassification}from"../../../domain/workforce-taxonomy";
import{demandSignalsFromListingObservations}from"../../services/discovery/listing-discovery-service";
import{evaluateWorkforceConversion,previewWorkforceConversion,toDiscoverySignalShape}from"../../services/hot-conversion-engine/hot-conversion-engine-service";
import{BECHTEL_LISTING_URL,BechtelListingDiscoveryAdapter}from"./bechtel-listing-adapter";
import{IBEW716_JOURNEYMAN_JOB_CALLS_URL,Ibew716JobCallAdapter}from"./ibew716-job-call-adapter";
import{STRIKE_LISTING_URL,StrikeListingDiscoveryAdapter}from"./strike-listing-adapter";
import{TRILLIUM_LISTING_URL,TrilliumListingDiscoveryAdapter}from"./trillium-listing-adapter";

/**
 * Phase 3E real-pipeline validation (manual live; excluded from CI). Replays
 * the SAME four already-approved sources Phase 3B/3D/3X use -- no new
 * source access. Every raw candidate row (not just the electrical-promoted
 * subset) is run through Phase 3X's generalized workforce promoter, then
 * through the Phase 3E gate/blocker/readiness engine on top of the REAL,
 * unmodified convertDiscoverySignal pipeline. Zero HOT is an accepted,
 * honestly-reported outcome (Phase 3E section 35): none of these real rows
 * currently carry AF-01 or verified-contact evidence, exactly as Phase 3D
 * already found, so 0/0 HOT-A/B is the correct result here -- what Phase 3E
 * adds is a real, per-opportunity, gate-by-gate explanation of why.
 */
const at=new Date(),request=(s:string):ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:s,cursor:null,policyDecisionId:randomUUID(),asOf:at}),
transport:PublicTransport={get:async url=>{const r=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/3E (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});return{status:r.status,url:r.url,contentType:r.headers.get("content-type"),body:await r.text(),headers:Object.fromEntries(r.headers.entries())}}},
str=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;

describe("Phase 3E real workforce conversion evaluation (manual live; excluded from CI)",()=>{it("evaluates every current real opportunity, electrical and non-electrical, through the same gate engine",async()=>{
  const sources=[{key:"ibew716",url:IBEW716_JOURNEYMAN_JOB_CALLS_URL,adapter:new Ibew716JobCallAdapter(transport)},{key:"strike",url:STRIKE_LISTING_URL,adapter:new StrikeListingDiscoveryAdapter(transport)},{key:"trillium",url:TRILLIUM_LISTING_URL,adapter:new TrilliumListingDiscoveryAdapter(transport)},{key:"bechtel",url:BECHTEL_LISTING_URL,adapter:new BechtelListingDiscoveryAdapter(transport)}],
    failures:string[]=[],allInputs:{input:ConversionEvidenceInput;classification:WorkforceClassification}[]=[];

  for(const s of sources)try{
    const c=await s.adapter.capturePage(request(s.key)),
      signals=demandSignalsFromListingObservations(c.observations,{sourceKey:s.key,observedAt:at}),
      {tracked}=promoteWorkforceDemandSignals(signals);
    for(const t of tracked){
      const p=resolveOrganizationProvenance(t.organization,{...DISCOVERY_SOURCE_ORGANIZATION_PROFILES[s.key],sourceUrl:s.url,observedAt:at}),
        primary=t.classifications[0]??UNKNOWN_WORKFORCE_CLASSIFICATION;
      const input:ConversionEvidenceInput={
        signal:toDiscoverySignalShape(t),evidenceIds:[`live:${s.key}:${t.externalId}`],
        employer:p.employer,companyRole:p.companyRole,companyRoleEvidenceIds:[`live:${s.key}:${t.externalId}`],
        project:null,buyer:null,wage:null,perDiemOrIncentive:null,schedule:null,headcount:null,
        acceptance:null,contacts:[],actionability:NO_ACTIONABILITY_EVIDENCE(`conversion:${t.externalId}`),
        conflicts:[...p.conflicts],organizationProvenance:p,
      };
      allInputs.push({input,classification:primary});
    }
  }catch(e){failures.push(`${s.key}:${e instanceof Error?e.message:String(e)}`)}

  const dossiers=allInputs.map(({input,classification})=>({
    disciplineId:classification.disciplineId,
    dossier:evaluateWorkforceConversion({
      input,classification,
      projectRef:deriveProjectRef({project:str(input.project),opportunityId:input.signal.externalId}),
    }),
  }));

  const electrical=dossiers.filter(x=>x.disciplineId==="ELECTRICAL"),nonElectrical=dossiers.filter(x=>x.disciplineId!=="ELECTRICAL"&&x.disciplineId!==null);
  const summarize=(rows:typeof dossiers)=>({
    count:rows.length,
    hotA:rows.filter(x=>x.dossier.activeHotA).length,
    hotB:rows.filter(x=>x.dossier.activeHotB).length,
    eligibleAny:rows.filter(x=>x.dossier.eligibility.some(e=>e.eligible)).length,
    topBlockers:[...new Set(rows.flatMap(x=>x.dossier.blockers.slice(0,1).map(b=>b.code)))].sort(),
  });

  const allGates=dossiers.flatMap(x=>x.dossier.gates);
  const gateStats={
    total:allGates.length,
    pass:allGates.filter(g=>g.state==="PASS").length,
    fail:allGates.filter(g=>g.state==="FAIL").length,
    blocked:allGates.filter(g=>g.state==="BLOCKED").length,
    unknown:allGates.filter(g=>g.state==="UNKNOWN").length,
    notRequired:allGates.filter(g=>g.state==="NOT_REQUIRED").length,
  };
  const af01Stats={verified:dossiers.filter(x=>x.dossier.af01State==="VERIFIED").length,missing:dossiers.filter(x=>x.dossier.af01State==="MISSING").length,scopeBlocked:dossiers.filter(x=>x.dossier.blockers.some(b=>b.code==="AF01_SCOPE_UNSUPPORTED")).length};
  const contactStats={actionable:dossiers.filter(x=>x.dossier.contactState==="VERIFIED").length,scopeBlocked:dossiers.filter(x=>x.dossier.blockers.some(b=>b.code==="CONTACT_AUTHORITY_SCOPE_UNSUPPORTED")).length};
  const temporalStats={open:dossiers.filter(x=>x.dossier.temporalState==="OPEN"||x.dossier.temporalState==="OPENING_SOON"||x.dossier.temporalState==="CLOSING_SOON").length,unknown:dossiers.filter(x=>x.dossier.temporalState==="UNKNOWN").length,inactive:dossiers.filter(x=>["EXPIRED","CLOSED","AWARDED","CANCELLED","TERMINATED"].includes(x.dossier.temporalState)).length};
  const eligibilityStats={eligible:dossiers.filter(x=>x.dossier.eligibility.some(e=>e.eligible)).length,notEligible:dossiers.filter(x=>x.dossier.eligibility.every(e=>!e.eligible)).length,scorable:dossiers.filter(x=>x.dossier.score.state==="SCORED").length,notScorable:dossiers.filter(x=>x.dossier.score.state==="NOT_SCORABLE").length};
  const closureStats={totalTasks:dossiers.reduce((n,x)=>n+x.dossier.closurePlan.length,0),humanVerificationItems:dossiers.reduce((n,x)=>n+x.dossier.humanVerificationItemCount,0)};

  const previewTarget=allInputs.find(x=>x.classification.disciplineId==="ELECTRICAL")??allInputs[0];
  const preview=previewTarget?previewWorkforceConversion({input:previewTarget.input,classification:previewTarget.classification,projectRef:deriveProjectRef({project:str(previewTarget.input.project),opportunityId:previewTarget.input.signal.externalId})},{explicitStatus:"OPEN"}):null;

  const report={
    failures,
    realWorkforceOpportunities:dossiers.length,
    realElectricalOpportunities:electrical.length,
    realNonElectricalOpportunities:nonElectrical.length,
    supportedTradesRepresentedLive:[...new Set(dossiers.map(x=>x.disciplineId).filter((x):x is NonNullable<typeof x>=>!!x))].sort(),
    electrical:summarize(electrical),
    nonElectrical:summarize(nonElectrical),
    sampleNonElectrical:nonElectrical.slice(0,10).map(x=>({disciplineId:x.disciplineId,opportunityId:x.dossier.opportunityId,readiness:x.dossier.readiness,nextBestAction:x.dossier.nextBestAction,topBlocker:x.dossier.blockers[0]?.code??null})),
    gateStats,af01Stats,contactStats,temporalStats,eligibilityStats,closureStats,
    realDecisionPreview:preview?{
      opportunityId:preview.before.opportunityId,
      hypotheticalChange:"explicitStatus: null -> OPEN",
      before:{temporalState:preview.before.temporalState,readiness:preview.before.readiness,activeHotA:preview.before.activeHotA,activeHotB:preview.before.activeHotB,blockers:preview.before.blockers.map(b=>b.code)},
      after:{temporalState:preview.after.temporalState,readiness:preview.after.readiness,activeHotA:preview.after.activeHotA,activeHotB:preview.after.activeHotB,blockers:preview.after.blockers.map(b=>b.code)},
      remainingBlockers:preview.after.blockers.map(b=>b.code),
      eligibilityChanged:JSON.stringify(preview.before.eligibility)!==JSON.stringify(preview.after.eligibility),
      scoreChanged:preview.before.score.score!==preview.after.score.score,
      commercialActionChanged:preview.before.commercialAction!==preview.after.commercialAction,
      activeHotChanged:preview.before.activeHotA!==preview.after.activeHotA||preview.before.activeHotB!==preview.after.activeHotB,
      persisted:preview.persisted,
    }:null,
  };
  console.log("PHASE_3E_LIVE_REPORT="+JSON.stringify(report));

  expect(failures).toEqual([]);
  expect(dossiers.every(x=>x.dossier.activeHotA===false||x.dossier.eligibility.some(e=>e.eligibilityType==="HOT_A_ELIGIBLE"&&e.eligible))).toBe(true);
  expect(dossiers.every(x=>!x.dossier.gates.some(g=>g.recommendedNextAction==="READY_FOR_COMMERCIAL_CONTACT")||x.dossier.activeHotA||x.dossier.activeHotB)).toBe(true);
  if(preview){
    expect(preview.persisted).toBe(false);
    expect(preview.after.activeHotA||preview.after.activeHotB).toBe(false);
  }
},120000)});
