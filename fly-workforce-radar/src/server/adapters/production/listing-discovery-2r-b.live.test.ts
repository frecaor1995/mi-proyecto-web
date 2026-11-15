import{randomUUID}from"node:crypto";
import{describe,expect,it}from"vitest";
import type{ProductionCaptureRequest}from"../../../domain/production-source";
import type{PublicTransport}from"../../../domain/production-capture";
import{runListingDiscovery}from"../../services/discovery/listing-discovery-service";
import{BECHTEL_LISTING_URL,BechtelListingDiscoveryAdapter}from"./bechtel-listing-adapter";
import{IBEW716_CW_CE_JOB_CALLS_URL,IBEW716_JOURNEYMAN_JOB_CALLS_URL,IBEW716_TELEDATA_JOB_CALLS_URL,Ibew716JobCallAdapter}from"./ibew716-job-call-adapter";
import{STRIKE_LISTING_URL,StrikeListingDiscoveryAdapter}from"./strike-listing-adapter";
import{TRILLIUM_LISTING_URL,TrilliumListingDiscoveryAdapter}from"./trillium-listing-adapter";

const observedAt=new Date();
const request=(source:string):ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:source,cursor:null,policyDecisionId:randomUUID(),asOf:observedAt});
const transport:PublicTransport={get:async url=>{
  const response=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/2R-B (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});
  return{status:response.status,url:response.url,contentType:response.headers.get("content-type"),body:await response.text(),headers:Object.fromEntries(response.headers.entries())};
}};

interface SuccessfulSourceScan{
  status:"SUCCESS";
  source:string;
  entryPoint:string;
  listingsObserved:number;
  electricalListings:number;
  newDemandSignals:number;
  duplicates:number;
  trackedPromotions:number;
  electricalRows:unknown[];
}

interface FailedSourceScan{
  status:"FAILED";
  source:string;
  entryPoint:string;
  error:string;
}

type SourceScanReport=SuccessfulSourceScan|FailedSourceScan;

const failedSourceScans=(reports:readonly SourceScanReport[]):FailedSourceScan[]=>
  reports.filter((report):report is FailedSourceScan=>report.status==="FAILED");

describe("Phase 2R-B live validation result semantics (pure; no network)",()=>{
  const success=(source:string,electricalListings=0):SuccessfulSourceScan=>({status:"SUCCESS",source,entryPoint:`https://example.test/${source}`,listingsObserved:0,electricalListings,newDemandSignals:0,duplicates:0,trackedPromotions:0,electricalRows:[]});
  const failed=(source:string,error:string):FailedSourceScan=>({status:"FAILED",source,entryPoint:`https://example.test/${source}`,error});

  it("accepts a successfully fetched and parsed source with zero electrical results",()=>expect(failedSourceScans([success("zero-results")])).toEqual([]));
  it("classifies a failed fetch as FAILED",()=>expect(failedSourceScans([failed("fetch","network failure")])).toEqual([failed("fetch","network failure")]));
  it("classifies a failed parse as FAILED",()=>expect(failedSourceScans([failed("parse","parser failure")])).toEqual([failed("parse","parser failure")]));
  it("preserves the failed-source diagnostics in a mixed result set",()=>expect(failedSourceScans([success("ok",2),failed("bad","HTTP 503")])).toEqual([failed("bad","HTTP 503")]));
  it("cannot satisfy the required success criterion when every source fails",()=>expect(failedSourceScans([failed("one","DNS failure"),failed("two","HTTP 429")])).toHaveLength(2));
});

describe("Phase 2R-B live listing discovery (manual only; excluded from CI)",()=>{
  it("scans only compliance-approved public listing entry points",async()=>{
    const sources=[
      {key:"ibew716-journeyman",url:IBEW716_JOURNEYMAN_JOB_CALLS_URL,adapter:new Ibew716JobCallAdapter(transport,IBEW716_JOURNEYMAN_JOB_CALLS_URL)},
      {key:"ibew716-cw-ce",url:IBEW716_CW_CE_JOB_CALLS_URL,adapter:new Ibew716JobCallAdapter(transport,IBEW716_CW_CE_JOB_CALLS_URL)},
      {key:"ibew716-teledata",url:IBEW716_TELEDATA_JOB_CALLS_URL,adapter:new Ibew716JobCallAdapter(transport,IBEW716_TELEDATA_JOB_CALLS_URL)},
      {key:"strike",url:STRIKE_LISTING_URL,adapter:new StrikeListingDiscoveryAdapter(transport)},
      {key:"trillium",url:TRILLIUM_LISTING_URL,adapter:new TrilliumListingDiscoveryAdapter(transport)},
      {key:"bechtel",url:BECHTEL_LISTING_URL,adapter:new BechtelListingDiscoveryAdapter(transport)}
    ];
    const reports:SourceScanReport[]=[];
    for(const source of sources){
      try{
        const capture=await source.adapter.capturePage(request(source.key));
        const run=runListingDiscovery(capture.observations,{sourceKey:source.key,observedAt,listingUrl:source.url});
        reports.push({status:"SUCCESS",source:source.key,entryPoint:source.url,listingsObserved:run.listingsObserved,electricalListings:run.electricalListings,newDemandSignals:run.newSignals,duplicates:run.duplicatesSuppressed,trackedPromotions:run.opportunities.length,electricalRows:capture.observations.filter(o=>o.facts.explicitElectricalRole===true).map(o=>({externalId:o.externalId,title:o.title,contractor:o.organization,location:o.location,sourceUrl:o.sourceUrl,facts:o.facts}))});
      }catch(error){reports.push({status:"FAILED",source:source.key,entryPoint:source.url,error:error instanceof Error?error.message:String(error)})}
    }
    console.log("PHASE_2R_B_LIVE_REPORT="+JSON.stringify({observedAt:observedAt.toISOString(),reports}));
    expect(reports).toHaveLength(sources.length);
    // A successful parse with zero listings/electrical rows is valid. A fetch,
    // HTTP, access or parser exception is not: diagnostics are retained above,
    // then the overall manual live validation fails with the affected sources.
    expect(failedSourceScans(reports)).toEqual([]);
  },120_000);
});
