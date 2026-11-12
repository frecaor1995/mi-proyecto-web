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
import{evaluateWorkforceConversion,rankWorkforceConversions,toDiscoverySignalShape}from"../../services/hot-conversion-engine/hot-conversion-engine-service";
import{
  buildCommercialContactInbox,buildDailyDesk,buildEvidenceClosureInbox,buildHumanVerificationInbox,
  buildWorkItems,
}from"../../services/operational-desk/operational-desk-service";
import{BECHTEL_LISTING_URL,BechtelListingDiscoveryAdapter}from"./bechtel-listing-adapter";
import{IBEW716_JOURNEYMAN_JOB_CALLS_URL,Ibew716JobCallAdapter}from"./ibew716-job-call-adapter";
import{STRIKE_LISTING_URL,StrikeListingDiscoveryAdapter}from"./strike-listing-adapter";
import{TRILLIUM_LISTING_URL,TrilliumListingDiscoveryAdapter}from"./trillium-listing-adapter";

/**
 * Phase 3F real desk validation (manual live; excluded from CI). Replays
 * the SAME four already-approved sources Phase 3B/3D/3X/3E use -- no new
 * source access. Builds the real, current operational desk from real Phase
 * 3E conversion dossiers for every real workforce opportunity (electrical
 * and non-electrical). Zero READY_FOR_COMMERCIAL_CONTACT is an accepted,
 * honestly-reported outcome (mirrors Phase 3E's own zero-HOT finding):
 * this desk never manufactures readiness that canonical HOT truth does not
 * support.
 */
const at=new Date(),request=(s:string):ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:s,cursor:null,policyDecisionId:randomUUID(),asOf:at}),
transport:PublicTransport={get:async url=>{const r=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/3F (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});return{status:r.status,url:r.url,contentType:r.headers.get("content-type"),body:await r.text(),headers:Object.fromEntries(r.headers.entries())}}},
str=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;

describe("Phase 3F real operational desk (manual live; excluded from CI)",()=>{it("builds the current real daily desk from every real opportunity, electrical and non-electrical",async()=>{
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

  const dossiers=allInputs.map(({input,classification})=>evaluateWorkforceConversion({
    input,classification,
    projectRef:deriveProjectRef({project:str(input.project),opportunityId:input.signal.externalId}),
  }));
  const ranked=rankWorkforceConversions(dossiers);
  const{items,duplicatesSuppressed}=buildWorkItems(ranked);
  const desk=buildDailyDesk(items,5);

  const electricalItems=items.filter(i=>i.tradeId==="ELECTRICAL"),nonElectricalItems=items.filter(i=>i.tradeId!==null&&i.tradeId!=="ELECTRICAL");
  const humanVerificationInbox=buildHumanVerificationInbox(items),evidenceClosureInbox=buildEvidenceClosureInbox(items),contactInbox=buildCommercialContactInbox(items);

  const report={
    failures,
    realOpportunities:items.length,
    electrical:electricalItems.length,
    nonElectrical:nonElectricalItems.length,
    tradeFamilies:[...new Set(items.map(i=>i.tradeId).filter((t):t is NonNullable<typeof t>=>!!t))].sort(),
    workItems:items.length,
    uniqueWorkItems:items.length,
    duplicateWorkItemsSuppressed:duplicatesSuppressed,
    dailyDesk:{
      TODAYS_COMMERCIAL_DESK:desk.counts,
      totalWorkItems:desk.totalWorkItems,
      top5:desk.topPriorities,
      dominantBlockers:desk.dominantBlockers,
      tradesRepresented:desk.tradesRepresented,
    },
    humanVerificationInboxCount:humanVerificationInbox.length,
    evidenceClosureInboxCount:evidenceClosureInbox.length,
    commercialContactInboxCount:contactInbox.length,
    activeHot:items.filter(i=>i.activeHot).length,
    hotA:items.filter(i=>i.hotA).length,
    hotB:items.filter(i=>i.hotB).length,
    eligible:items.filter(i=>i.eligible).length,
  };
  console.log("PHASE_3F_LIVE_REPORT="+JSON.stringify(report));

  expect(failures).toEqual([]);
  // The desk must never report READY without canonical Active HOT support.
  expect(items.filter(i=>i.workQueue==="READY_FOR_COMMERCIAL_CONTACT").every(i=>i.activeHot)).toBe(true);
  // Desk evaluation must be pure/reproducible from the same canonical dossiers.
  const rebuilt=buildWorkItems(ranked).items;
  expect(rebuilt.map(i=>i.workQueue)).toEqual(items.map(i=>i.workQueue));
},120000)});
