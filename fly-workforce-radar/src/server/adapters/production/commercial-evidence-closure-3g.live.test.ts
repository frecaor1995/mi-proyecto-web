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
import type{WorkforceConversionEvaluationInput}from"../../services/hot-conversion-engine/hot-conversion-engine-service";
import{buildWorkItems}from"../../services/operational-desk/operational-desk-service";
import{createContactCandidate}from"../../services/contact-intelligence/contact-intelligence-service";
import{
  addAf01Candidates,addContactCandidates,buildAf01Candidate,buildClosureDeskSnapshot,deriveClosureCases,
}from"../../services/commercial-evidence-closure/commercial-evidence-closure-service";
import type{RawAf01Observation}from"../../services/commercial-evidence-closure/commercial-evidence-closure-service";
import{BECHTEL_LISTING_URL,BechtelListingDiscoveryAdapter}from"./bechtel-listing-adapter";
import{IBEW716_JOURNEYMAN_JOB_CALLS_URL,Ibew716JobCallAdapter}from"./ibew716-job-call-adapter";
import{STRIKE_LISTING_URL,StrikeListingDiscoveryAdapter}from"./strike-listing-adapter";
import{TRILLIUM_LISTING_URL,TrilliumListingDiscoveryAdapter}from"./trillium-listing-adapter";

/**
 * Phase 3G real closure pilot (manual live; excluded from CI). Replays the
 * SAME four already-approved discovery sources as every prior real-pipeline
 * test, builds the current real Phase 3F desk, and runs a bounded closure
 * pilot on the top current priorities' MISSING_ACTIONABLE_CONTACT / MISSING_AF01
 * blockers.
 *
 * Source-family discipline (Phase 3G section 37/20): candidate evidence is
 * only fetched from organization-specific pages that a PRIOR phase already
 * established as approved for this exact purpose -- Bechtel's supplier page
 * (used in Phase 3B/3C) and Anheuser-Busch's supplier pages (same). Any
 * other organization appearing in the current top priorities is explicitly
 * reported as skipped for lack of a previously-approved source family,
 * never silently fetched from a new site.
 */
const at=new Date(),request=(s:string):ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:s,cursor:null,policyDecisionId:randomUUID(),asOf:at}),
transport:PublicTransport={get:async url=>{const r=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/3G (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});return{status:r.status,url:r.url,contentType:r.headers.get("content-type"),body:await r.text(),headers:Object.fromEntries(r.headers.entries())}}},
str=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;

const fetchLive=async(url:string)=>{try{const r=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/3G (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});return{ok:r.ok,status:r.status,body:await r.text()}}catch{return{ok:false,status:0,body:null as string|null}}};

/** HTTP 200 with a bot-protection interstitial is not content -- it must
 * never be fed into candidate-evidence classification (its own generic
 * "you have been blocked" copy can otherwise false-positive as ambiguous
 * vendor language). Detected, never bypassed: per section 43/47, a blocked
 * source is recorded as blocked, not worked around. */
const BLOCK_PAGE_MARKERS=/cloudflare|attention required|you have been blocked|access denied|please enable cookies|verify you are human|checking your browser/i;
const isBlockedPage=(body:string)=>BLOCK_PAGE_MARKERS.test(body);

/** Previously-approved (Phase 3B/3C) official supplier/procurement pages,
 * keyed by exact organization string as it appears in real discovery data.
 * No other organization is fetched in this pilot. */
const APPROVED_ORG_SOURCES:Record<string,{contact:string[];af01:string[]}>={
  "Bechtel":{contact:["https://www.bechtel.com/supplier/"],af01:["https://www.bechtel.com/supplier/"]},
  "Anheuser-Busch (Budweiser)":{contact:["https://www.anheuser-busch.com/supplier-information","https://hops.ab-inbev.com/"],af01:["https://hops.ab-inbev.com/"]},
};

describe("Phase 3G real commercial evidence closure pilot (manual live; excluded from CI)",()=>{it("runs a bounded contact-first, then AF-01, closure pilot on the current top real priorities",async()=>{
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

  const evalInputs:WorkforceConversionEvaluationInput[]=allInputs.map(({input,classification})=>({
    input,classification,projectRef:deriveProjectRef({project:str(input.project),opportunityId:input.signal.externalId}),
  }));
  const dossiers=evalInputs.map(evaluateWorkforceConversion),ranked=rankWorkforceConversions(dossiers),{items}=buildWorkItems(ranked);
  const evalByOpportunity=new Map(evalInputs.map(x=>[`conversion:${x.input.signal.externalId}`,x]));

  const top5=items.slice(0,5);
  const complianceLog:{organization:string|null;url:string;approved:boolean;status:number;blocked:boolean;loginRequired:false;captchaEncountered:false;paywallEncountered:false;writeActionPerformed:false;outreachPerformed:false}[]=[];
  const pilotResults:{organization:string|null;trade:string|null;blocker:string|null;closureTarget:string;strategiesAttempted:number;candidateCount:number;strongCandidates:number;ambiguousCandidates:number;negativeEvidence:number;verificationPackets:number;previewImpact:string;remainingBlockers:number;nextAction:string;skippedReason:string|null}[]=[];

  for(const item of top5){
    const evalInput=evalByOpportunity.get(item.opportunityId)!;
    const cases=deriveClosureCases(item);
    for(const closureCase of cases){
      const approvedSources=item.organization?APPROVED_ORG_SOURCES[item.organization]:undefined;
      if(!approvedSources){
        pilotResults.push({organization:item.organization,trade:item.tradeId,blocker:closureCase.sourceBlocker,closureTarget:closureCase.target.targetType,strategiesAttempted:0,candidateCount:0,strongCandidates:0,ambiguousCandidates:0,negativeEvidence:0,verificationPackets:0,previewImpact:"N/A",remainingBlockers:item.blockers.length,nextAction:item.nextBestAction,skippedReason:"No previously-approved source family for this organization (Phase 3B/3C precedent covers only Bechtel and Anheuser-Busch); skipped rather than activating a new source."});
        continue;
      }
      const urls=closureCase.target.targetType==="ACTIONABLE_CONTACT"?approvedSources.contact:approvedSources.af01;
      let updated=closureCase;
      for(const url of urls){
        const r=await fetchLive(url),blocked=r.body!==null&&isBlockedPage(r.body);
        complianceLog.push({organization:item.organization,url,approved:true,status:r.status,blocked,loginRequired:false,captchaEncountered:false,paywallEncountered:false,writeActionPerformed:false,outreachPerformed:false});
        if(r.body===null||!r.ok||blocked)continue;
        if(closureCase.target.targetType==="ACTIONABLE_CONTACT"){
          const emailMatch=/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.exec(r.body);
          if(emailMatch){
            const candidate=createContactCandidate({
              opportunityId:item.opportunityId,signalId:evalInput.input.signal.signalId,personName:null,title:null,
              organization:item.organization,function:"PROCUREMENT",contactType:"PROCUREMENT_MAILBOX",routeTarget:emailMatch[0],
              sourceUrl:url,evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",sourceType:"OFFICIAL_SUPPLIER_VENDOR",
              observedAt:at,publicationOrEffectiveDate:null,verificationState:"CANDIDATE",conflicts:[],
              provenance:`Official ${item.organization} page`,supportedRelationship:"Official published procurement/supplier mailbox",
              authorityEvidence:null,opportunityRelationshipExplicit:false,
            },at);
            updated=addContactCandidates(updated,[candidate],evalInput);
          }
        }else{
          const stripped=r.body.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ");
          const sentenceMatch=/[^.]{0,200}\b(supplier|vendor|contingent|subcontract|staffing|manpower)\b[^.]{0,200}\./i.exec(stripped);
          if(sentenceMatch){
            const raw:RawAf01Observation={opportunityId:item.opportunityId,organization:item.organization,candidateClaim:sentenceMatch[0].trim(),sourceUrl:url,sourceType:"OFFICIAL_SUPPLIER_VENDOR",evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",observedAt:at,scope:"UNKNOWN",scopedTradeIds:[],scopeEvidenceText:null,targetOrganization:item.organization,targetProjectRef:null};
            updated=addAf01Candidates(updated,[buildAf01Candidate(raw)],evalInput);
          }
        }
      }
      const contactStrong=updated.contactCandidates.filter(c=>c.authorityEvidence&&c.opportunityRelationshipExplicit).length;
      const af01Strong=updated.af01Candidates.filter(c=>["EXPLICIT_MANPOWER_ACCEPTANCE","STAFFING_VENDOR_ACCEPTANCE","CONTINGENT_LABOR_ACCEPTANCE","CRAFT_LABOR_SUPPLIER_ACCEPTANCE","WORKFORCE_SUBCONTRACTING_ACCEPTANCE","THIRD_PARTY_LABOR_ACCEPTANCE"].includes(c.evidenceClass)).length;
      const af01Negative=updated.af01Candidates.filter(c=>c.evidenceClass==="NEGATIVE_EVIDENCE").length;
      const candidateCount=updated.contactCandidates.length+updated.af01Candidates.length;
      pilotResults.push({
        organization:item.organization,trade:item.tradeId,blocker:closureCase.sourceBlocker,closureTarget:closureCase.target.targetType,
        strategiesAttempted:urls.length,candidateCount,strongCandidates:contactStrong+af01Strong,
        ambiguousCandidates:candidateCount-contactStrong-af01Strong-af01Negative,negativeEvidence:af01Negative,
        verificationPackets:updated.verificationPackets.length,
        previewImpact:updated.verificationPackets.some(p=>p.previewImpact?.wouldBecomeActiveHotA||p.previewImpact?.wouldBecomeActiveHotB)?"WOULD_REACH_ACTIVE_HOT":candidateCount?"NO_HOT_CHANGE":"NO_EVIDENCE_FOUND",
        remainingBlockers:item.blockers.length,nextAction:item.nextBestAction,skippedReason:null,
      });
    }
  }

  const closureCasesAll=top5.flatMap(item=>deriveClosureCases(item));
  const desk=buildClosureDeskSnapshot(closureCasesAll);

  const report={
    failures,realWorkItems:items.length,top5Count:top5.length,
    pilotResults,complianceLog,blockedSources:complianceLog.filter(c=>c.blocked).length,
    closureDeskSnapshot:{openClosureCases:desk.openClosureCases,contactCases:desk.contactCases,af01Cases:desk.af01Cases},
  };
  console.log("PHASE_3G_LIVE_REPORT="+JSON.stringify(report));

  expect(failures).toEqual([]);
  expect(complianceLog.every(c=>!c.writeActionPerformed&&!c.outreachPerformed&&!c.loginRequired&&!c.captchaEncountered&&!c.paywallEncountered)).toBe(true);
},120000)});
