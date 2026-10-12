import{randomUUID}from"node:crypto";
import{describe,expect,it}from"vitest";
import type{ConversionEvidenceInput}from"../../../domain/commercial-conversion";
import type{ProductionCaptureRequest}from"../../../domain/production-source";
import type{PublicTransport}from"../../../domain/production-capture";
import{NO_ACTIONABILITY_EVIDENCE}from"../../../domain/opportunity-actionability";
import{DISCOVERY_SOURCE_ORGANIZATION_PROFILES,convertDiscoverySignal,rankConversionCohort,resolveOrganizationProvenance}from"../../services/commercial-conversion/commercial-conversion-service";
import{runListingDiscovery}from"../../services/discovery/listing-discovery-service";
import{BECHTEL_LISTING_URL,BechtelListingDiscoveryAdapter}from"./bechtel-listing-adapter";
import{IBEW716_JOURNEYMAN_JOB_CALLS_URL,Ibew716JobCallAdapter}from"./ibew716-job-call-adapter";
import{STRIKE_LISTING_URL,StrikeListingDiscoveryAdapter}from"./strike-listing-adapter";
import{TRILLIUM_LISTING_URL,TrilliumListingDiscoveryAdapter}from"./trillium-listing-adapter";

const observedAt=new Date();
const request=(source:string):ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:source,cursor:null,policyDecisionId:randomUUID(),asOf:observedAt});
const transport:PublicTransport={get:async url=>{const response=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/2S (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});return{status:response.status,url:response.url,contentType:response.headers.get("content-type"),body:await response.text(),headers:Object.fromEntries(response.headers.entries())}}};
const str=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;
const num=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null;

describe("Phase 2S real commercial conversion replay (manual live; excluded from CI)",()=>{
  it("reconstructs current electrical signals and converts the priority cohort without fabricating gates",async()=>{
    const sources=[
      {key:"ibew716",url:IBEW716_JOURNEYMAN_JOB_CALLS_URL,adapter:new Ibew716JobCallAdapter(transport)},
      {key:"strike",url:STRIKE_LISTING_URL,adapter:new StrikeListingDiscoveryAdapter(transport)},
      {key:"trillium",url:TRILLIUM_LISTING_URL,adapter:new TrilliumListingDiscoveryAdapter(transport)},
      {key:"bechtel",url:BECHTEL_LISTING_URL,adapter:new BechtelListingDiscoveryAdapter(transport)},
    ];
    const failures:{source:string;entryPoint:string;error:string}[]=[],inputs:ConversionEvidenceInput[]=[];
    for(const source of sources){try{
      const capture=await source.adapter.capturePage(request(source.key));
      const run=runListingDiscovery(capture.observations,{sourceKey:source.key,observedAt,listingUrl:source.url});
      const byId=new Map(capture.observations.map(o=>[o.externalId,o]));
      for(const tracked of run.tracked){const o=byId.get(tracked.externalId)!;const evidenceId=`live:${source.key}:${tracked.externalId}`,profile=DISCOVERY_SOURCE_ORGANIZATION_PROFILES[source.key],organizationProvenance=resolveOrganizationProvenance(o.organization,{...profile,sourceUrl:source.url,observedAt});inputs.push({signal:tracked,evidenceIds:[evidenceId],employer:organizationProvenance.employer,companyRole:organizationProvenance.companyRole,companyRoleEvidenceIds:[evidenceId],project:str(o.facts.project),buyer:str(o.facts.buyer),wage:str(o.facts.wage),perDiemOrIncentive:str(o.facts.incentive),schedule:str(o.facts.schedule),headcount:num(o.facts.headcount),acceptance:null,contacts:[],actionability:NO_ACTIONABILITY_EVIDENCE(`conversion:${tracked.externalId}`),conflicts:[...organizationProvenance.conflicts],organizationProvenance})}
    }catch(error){failures.push({source:source.key,entryPoint:source.url,error:error instanceof Error?error.message:String(error)})}}
    const dossiers=inputs.map(convertDiscoverySignal),cohort=rankConversionCohort(inputs,5).map(x=>convertDiscoverySignal(x.input));
    const report={observedAt:observedAt.toISOString(),sourceFailures:failures,totalElectricalSignals:dossiers.length,prioritized:cohort.length,inventory:dossiers.map(d=>({source:d.sourceId,stableId:d.sourceExternalId,url:inputs.find(x=>x.signal.externalId===d.sourceExternalId)!.signal.sourceUrl,organizationBefore:d.sourceId==="ibew716"?d.organization:null,organizationAfter:d.organization,organizationEvidenceBasis:d.organizationProvenance?.basis??"UNKNOWN",organizationRole:d.companyRole,employer:d.employer,contractor:d.organizationProvenance?.contractor??null,staffingIntermediary:d.organizationProvenance?.staffingIntermediary??null,role:d.role,location:d.location,wage:d.economics.wage,perDiemOrIncentive:d.economics.perDiemOrIncentive,schedule:d.economics.schedule,headcount:d.economics.headcount,project:d.project,buyer:d.buyer,af01:d.acceptance?.verificationState??"UNKNOWN",contacts:d.contacts.length,temporal:d.temporalState,eligibility:Object.fromEntries(d.eligibility.map(e=>[e.eligibilityType,e.eligible])),score:d.score.state,commercialAction:d.commercialAction,verificationNeeds:d.verificationQueue.map(v=>v.kind),activeHot:d.activeHot.filter(h=>h.active).map(h=>h.hotType),priority:d.conversionPriority.score})),cohort:cohort.map(d=>({source:d.sourceId,stableId:d.sourceExternalId,organization:d.organization,role:d.role,priority:d.conversionPriority.score,blockers:d.conversionBlockers}))};
    console.log("PHASE_2S_LIVE_REPORT="+JSON.stringify(report));
    expect(failures).toEqual([]);expect(dossiers).toHaveLength(inputs.length);expect(dossiers.every(d=>d.activeHot.every(h=>!h.active))).toBe(true);
  },120_000);
});
