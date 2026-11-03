import{randomUUID}from"node:crypto";import{describe,expect,it}from"vitest";
import type{DemandSignal}from"../../../domain/demand-signal";
import type{ProductionCaptureRequest}from"../../../domain/production-source";
import type{PublicTransport}from"../../../domain/production-capture";
import{evaluateDemandSignalForTracking}from"../../../domain/discovery-promotion";
import{evaluateDemandSignalForWorkforceTracking}from"../../../domain/multi-trade-workforce";
import{demandSignalsFromListingObservations}from"../../services/discovery/listing-discovery-service";
import{BECHTEL_LISTING_URL,BechtelListingDiscoveryAdapter}from"./bechtel-listing-adapter";
import{IBEW716_JOURNEYMAN_JOB_CALLS_URL,Ibew716JobCallAdapter}from"./ibew716-job-call-adapter";
import{STRIKE_LISTING_URL,StrikeListingDiscoveryAdapter}from"./strike-listing-adapter";
import{TRILLIUM_LISTING_URL,TrilliumListingDiscoveryAdapter}from"./trillium-listing-adapter";

/**
 * Phase 3X real-electrical-replay validation (manual live; excluded from
 * CI). Replays the SAME four already-approved sources Phase 3B/3D use --
 * no new source access is opened to manufacture non-electrical examples
 * (Phase 3X section 26). For every raw candidate row observed:
 *
 *  - the frozen, electrical-only promoter (discovery-promotion.ts) and the
 *    new generalized multi-trade promoter (multi-trade-workforce.ts) must
 *    NEVER disagree in the direction of frozen=promoted,
 *    generalized=not-promoted -- that would be a real regression on the
 *    certified electrical pipeline;
 *  - it is fine, and expected, for the generalized promoter to additionally
 *    promote rows the electrical-only promoter correctly ignores, when
 *    those rows explicitly name a non-electrical Phase 3X occupation.
 */
const at=new Date(),request=(s:string):ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:s,cursor:null,policyDecisionId:randomUUID(),asOf:at}),
transport:PublicTransport={get:async url=>{const r=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/3X (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});return{status:r.status,url:r.url,contentType:r.headers.get("content-type"),body:await r.text(),headers:Object.fromEntries(r.headers.entries())}}};

describe("Phase 3X real electrical replay + non-electrical observation (manual live; excluded from CI)",()=>{it("never regresses the frozen electrical gate, and classifies any non-electrical rows the approved sources already expose",async()=>{
  const sources=[{key:"ibew716",url:IBEW716_JOURNEYMAN_JOB_CALLS_URL,adapter:new Ibew716JobCallAdapter(transport)},{key:"strike",url:STRIKE_LISTING_URL,adapter:new StrikeListingDiscoveryAdapter(transport)},{key:"trillium",url:TRILLIUM_LISTING_URL,adapter:new TrilliumListingDiscoveryAdapter(transport)},{key:"bechtel",url:BECHTEL_LISTING_URL,adapter:new BechtelListingDiscoveryAdapter(transport)}],
    failures:string[]=[];
  let total=0,electricalAgree=0,regressions=0,nonElectricalObserved=0;
  const regressionTitles:string[]=[],nonElectricalFindings:{title:string|null;occupations:string[]}[]=[];
  const allSignals:DemandSignal[]=[];

  for(const s of sources)try{
    const c=await s.adapter.capturePage(request(s.key)),
      signals=demandSignalsFromListingObservations(c.observations,{sourceKey:s.key,observedAt:at});
    allSignals.push(...signals);
  }catch(e){failures.push(`${s.key}:${e instanceof Error?e.message:String(e)}`)}

  for(const sig of allSignals){
    total++;
    const frozen=evaluateDemandSignalForTracking(sig),generalized=evaluateDemandSignalForWorkforceTracking(sig);
    if(frozen.promoted===generalized.promoted)electricalAgree++;
    if(frozen.promoted&&!generalized.promoted){regressions++;regressionTitles.push(String(sig.title))}
    const nonElectrical=generalized.classifications.filter(c=>c.disciplineId!=="ELECTRICAL");
    if(nonElectrical.length){nonElectricalObserved+=nonElectrical.length;nonElectricalFindings.push({title:sig.title,occupations:nonElectrical.map(c=>c.occupationId??"UNKNOWN")})}
  }

  const report={failures,realDossiersReplayed:total,electricalAgreement:electricalAgree,regressions,regressionTitles,nonElectricalObserved,nonElectricalFindings};
  console.log("PHASE_3X_LIVE_REPORT="+JSON.stringify(report));

  expect(failures).toEqual([]);
  expect(regressions).toBe(0);
  expect(electricalAgree).toBeGreaterThan(0);
  expect(electricalAgree).toBeLessThanOrEqual(total);
},120000)});
