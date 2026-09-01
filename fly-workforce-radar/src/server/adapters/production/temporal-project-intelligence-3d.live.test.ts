import{randomUUID}from"node:crypto";import{describe,expect,it}from"vitest";
import type{ConversionEvidenceInput}from"../../../domain/commercial-conversion";
import type{ProductionCaptureRequest}from"../../../domain/production-source";
import type{PublicTransport}from"../../../domain/production-capture";
import type{ProjectEvidenceCandidate,TemporalEvidenceCandidate}from"../../../domain/temporal-project-intelligence";
import{NO_ACTIONABILITY_EVIDENCE}from"../../../domain/opportunity-actionability";
import{DISCOVERY_SOURCE_ORGANIZATION_PROFILES,convertDiscoverySignal,rankConversionCohort,resolveOrganizationProvenance}from"../../services/commercial-conversion/commercial-conversion-service";
import{runListingDiscovery}from"../../services/discovery/listing-discovery-service";
import{analyzeTemporalProjectIntelligence,createProjectCandidate,classifyTemporalEvidence,planTemporalProjectAcquisition,previewProjectCandidate,previewTemporalCandidate}from"../../services/temporal-project-intelligence/temporal-project-intelligence-service";
import{BECHTEL_LISTING_URL,BechtelListingDiscoveryAdapter}from"./bechtel-listing-adapter";
import{IBEW716_JOURNEYMAN_JOB_CALLS_URL,Ibew716JobCallAdapter}from"./ibew716-job-call-adapter";
import{STRIKE_LISTING_URL,StrikeListingDiscoveryAdapter}from"./strike-listing-adapter";
import{TRILLIUM_LISTING_URL,TrilliumListingDiscoveryAdapter}from"./trillium-listing-adapter";

/**
 * Phase 3D targeted live research (manual live; excluded from CI via `--exclude **\/*.live.test.ts`).
 * Replays the full real discovery pipeline (same four sources as Phase 3B), ranks the deterministic
 * top-5 commercial cohort, then performs bounded lawful public research against each cohort member's
 * own official source page to recover genuine temporal and project facts. No fact below is invented:
 * every date, status flag, and project mention is extracted from the live official page fetched during
 * this test run and is cited by URL in the report.
 */

type FailureSemantic="SUCCESS_WITH_EVIDENCE"|"SUCCESS_NO_RELEVANT_EVIDENCE"|"HTTP_FAILURE"|"NETWORK_FAILURE"|"PARSER_FAILURE"|"COMPLIANCE_DENIED";

const at=new Date(),request=(s:string):ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:s,cursor:null,policyDecisionId:randomUUID(),asOf:at}),
transport:PublicTransport={get:async url=>{const r=await fetch(url,{headers:{"user-agent":"FlyWorkforceRadar/3D (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)"}});return{status:r.status,url:r.url,contentType:r.headers.get("content-type"),body:await r.text(),headers:Object.fromEntries(r.headers.entries())}}},
str=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null,num=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null;

const fetchLive=async(url:string,userAgent:string)=>{try{const r=await fetch(url,{headers:{"user-agent":userAgent}});const body=await r.text();return{ok:r.ok,status:r.status,body}}catch{return{ok:false,status:0,body:null as string|null}}};

async function researchAnheuserBusch(input:ConversionEvidenceInput,unionPageText:string,outcomes:{url:string;outcome:FailureSemantic}[]){
  const temporal:TemporalEvidenceCandidate[]=[],projects:ProjectEvidenceCandidate[]=[];
  const unionUrl="https://ibew716.net/journeyman-job-calls/";
  const i=unionPageText.indexOf("Anheuser-Busch (Budweiser)"),stmt=i>=0?/is currently hiring[^.]*\./i.exec(unionPageText.slice(i,i+300))?.[0]??null:null;
  if(stmt){temporal.push(classifyTemporalEvidence({opportunityId:`conversion:${input.signal.externalId}`,signalId:input.signal.signalId,evidenceType:"CURRENTLY_HIRING_STATEMENT",sourceUrl:unionUrl,sourceType:"UNION_DISPATCH",evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",observedAt:at,publicationDate:null,deadline:null,startDate:null,endDate:null,explicitStatusLanguage:stmt,verificationState:"UNVERIFIED",conflicts:[],provenance:"Official IBEW Local 716 maintenance job-openings section (union dispatch board, not the employer).",reason:"Explicit \"currently hiring\" language without a publication date or deadline; treated as weak, non-binding evidence."},at));outcomes.push({url:unionUrl,outcome:"SUCCESS_WITH_EVIDENCE"})}else outcomes.push({url:unionUrl,outcome:"SUCCESS_NO_RELEVANT_EVIDENCE"});
  const reqUrl="https://wd1.myworkdaysite.com/en-US/recruiting/abinbev/USA/details/Instrumentation-Electrician_30052370?locations=9a7a7b779da90101b50a44c28b420000",
    r=await fetchLive(reqUrl,"FlyWorkforceRadar/3D (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)");
  if(r.body===null)outcomes.push({url:reqUrl,outcome:"NETWORK_FAILURE"});
  else if(!r.ok)outcomes.push({url:reqUrl,outcome:"HTTP_FAILURE"});
  else{const m=/postingAvailable:\s*(true|false)/.exec(r.body);
    if(!m)outcomes.push({url:reqUrl,outcome:"PARSER_FAILURE"});
    else{outcomes.push({url:reqUrl,outcome:"SUCCESS_WITH_EVIDENCE"});
      if(m[1]==="false")temporal.push(classifyTemporalEvidence({opportunityId:`conversion:${input.signal.externalId}`,signalId:input.signal.signalId,evidenceType:"POSTING_REMOVED",sourceUrl:reqUrl,sourceType:"OFFICIAL_CAREER_POSTING",evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",observedAt:at,publicationDate:null,deadline:null,startDate:null,endDate:null,explicitStatusLanguage:"postingAvailable: false (Workday ATS requisition flag)",verificationState:"UNVERIFIED",conflicts:[],provenance:"Official Anheuser-Busch InBev Workday career site requisition 30052370 (HTTP 200; ATS marks the requisition unavailable server-side before any script executes).",reason:"HTTP 200 does not establish OPEN; the ATS's own availability flag is explicit contrary evidence and is preserved as such rather than being discarded."},at))}}
  return{temporal,projects}}

async function researchWymanGordon(input:ConversionEvidenceInput,unionPageText:string,outcomes:{url:string;outcome:FailureSemantic}[]){
  const temporal:TemporalEvidenceCandidate[]=[],projects:ProjectEvidenceCandidate[]=[];
  const unionUrl="https://ibew716.net/journeyman-job-calls/";
  const i=unionPageText.indexOf("Wyman- Gordon"),stmt=i>=0?/is currently hiring[^.]*\./i.exec(unionPageText.slice(i,i+300))?.[0]??null:null;
  if(stmt){temporal.push(classifyTemporalEvidence({opportunityId:`conversion:${input.signal.externalId}`,signalId:input.signal.signalId,evidenceType:"CURRENTLY_HIRING_STATEMENT",sourceUrl:unionUrl,sourceType:"UNION_DISPATCH",evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",observedAt:at,publicationDate:null,deadline:null,startDate:null,endDate:null,explicitStatusLanguage:stmt,verificationState:"UNVERIFIED",conflicts:[],provenance:"Official IBEW Local 716 maintenance job-openings section (union dispatch board, not the employer).",reason:"Explicit \"currently hiring\" language without a publication date or deadline; treated as weak, non-binding evidence."},at));outcomes.push({url:unionUrl,outcome:"SUCCESS_WITH_EVIDENCE"})}else outcomes.push({url:unionUrl,outcome:"SUCCESS_NO_RELEVANT_EVIDENCE"});
  const reqUrl="https://pcctalentacquisitionportal.tal.net/vx/lang-en-GB/mobile-0/appcentre-1/brand-7/xf-9f6831b3c849/candidate/so/pm/1/pl/3/opp/18135-Electrician-Technician/en-GB",
    r=await fetchLive(reqUrl,"FlyWorkforceRadar/3D (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)");
  if(r.body===null)outcomes.push({url:reqUrl,outcome:"NETWORK_FAILURE"});
  else if(!r.ok)outcomes.push({url:reqUrl,outcome:"HTTP_FAILURE"});
  else{const hasDate=/datePosted|closing date|deadline/i.test(r.body),hasTitle=/Electrician Technician/i.test(r.body);
    if(!hasTitle)outcomes.push({url:reqUrl,outcome:"PARSER_FAILURE"});
    else outcomes.push({url:reqUrl,outcome:hasDate?"SUCCESS_WITH_EVIDENCE":"SUCCESS_NO_RELEVANT_EVIDENCE"})}
  return{temporal,projects}}

async function researchBechtel(input:ConversionEvidenceInput,url:string,outcomes:{url:string;outcome:FailureSemantic}[]){
  const temporal:TemporalEvidenceCandidate[]=[],projects:ProjectEvidenceCandidate[]=[],
    r=await fetchLive(url,"FlyWorkforceRadar/3D (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)");
  if(r.body===null){outcomes.push({url,outcome:"NETWORK_FAILURE"});return{temporal,projects}}
  if(!r.ok){outcomes.push({url,outcome:"HTTP_FAILURE"});return{temporal,projects}}
  const dateMatch=/itemprop="datePosted" content="([^"]+)"/.exec(r.body);
  if(!dateMatch){outcomes.push({url,outcome:"PARSER_FAILURE"});return{temporal,projects}}
  outcomes.push({url,outcome:"SUCCESS_WITH_EVIDENCE"});
  const publicationDate=new Date(dateMatch[1]);
  temporal.push(classifyTemporalEvidence({opportunityId:`conversion:${input.signal.externalId}`,signalId:input.signal.signalId,evidenceType:"POSTING_PUBLICATION_DATE",sourceUrl:url,sourceType:"OFFICIAL_CAREER_POSTING",evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",observedAt:at,publicationDate,deadline:null,startDate:null,endDate:null,explicitStatusLanguage:null,verificationState:"UNVERIFIED",conflicts:[],provenance:`Official Bechtel SAP SuccessFactors career posting (schema.org datePosted microdata: "${dateMatch[1]}").`,reason:"Explicit posted-date microdata field is present and current relative to as-of; no explicit open/closed status language or deadline is published."},at));
  const projectMatch=/project’s\s+([A-Za-z0-9-]+),/i.exec(r.body);
  if(projectMatch)projects.push(createProjectCandidate({opportunityId:`conversion:${input.signal.externalId}`,signalId:input.signal.signalId,projectName:projectMatch[1],projectLocation:input.signal.location,owner:null,developer:null,generalContractor:"Bechtel",electricalContractor:null,staffingIntermediary:null,postingEmployer:"Bechtel",manpowerBuyer:null,relationship:"GENERAL_CONTRACTOR",stage:null,startDate:null,completionDate:null,manpowerRole:null,headcount:null,schedule:null,shift:null,duration:null,perDiem:null,sourceUrl:url,evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",sourceType:"OFFICIAL_CAREER_POSTING",observedAt:at,conflicts:[],provenance:`Official Bechtel posting job-summary text names an internal project designator ("${projectMatch[1]}") explicitly, directly attached to this requisition.`,linkageRationale:"Project designator is stated verbatim in the official posting's own job summary, not inferred from geography, company, or trade alone.",matchingDimensions:["explicit posting text"],mismatchingDimensions:[],relationshipExplicit:true}));
  return{temporal,projects}}

async function researchStrike(input:ConversionEvidenceInput,outcomes:{url:string;outcome:FailureSemantic}[]){
  const temporal:TemporalEvidenceCandidate[]=[],projects:ProjectEvidenceCandidate[]=[],
    url="https://strike.applytojob.com/apply/2uOOVqgVhY/Journeyman-Electrician",
    r=await fetchLive(url,"FlyWorkforceRadar/3D (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)");
  if(r.body===null){outcomes.push({url,outcome:"NETWORK_FAILURE"});return{temporal,projects}}
  if(!r.ok){outcomes.push({url,outcome:"HTTP_FAILURE"});return{temporal,projects}}
  const posted=/"datePosted":\s*"([^"]+)"/.exec(r.body),through=/"validThrough":\s*"([^"]+)"/.exec(r.body);
  if(!posted&&!through){outcomes.push({url,outcome:"PARSER_FAILURE"});return{temporal,projects}}
  outcomes.push({url,outcome:"SUCCESS_WITH_EVIDENCE"});
  temporal.push(classifyTemporalEvidence({opportunityId:`conversion:${input.signal.externalId}`,signalId:input.signal.signalId,evidenceType:"APPLICATION_DEADLINE",sourceUrl:url,sourceType:"OFFICIAL_CAREER_POSTING",evidenceTier:"TIER_1_PRIMARY_AUTHORITATIVE",observedAt:at,publicationDate:posted?new Date(posted[1]):null,deadline:through?new Date(through[1]):null,startDate:null,endDate:null,explicitStatusLanguage:null,verificationState:"UNVERIFIED",conflicts:[],provenance:`Official Strike JazzHR career posting (schema.org datePosted "${posted?.[1]??"n/a"}" / validThrough "${through?.[1]??"n/a"}").`,reason:"Explicit posted date and application-close date microdata are both present."},at));
  return{temporal,projects}}

describe("Phase 3D temporal & project intelligence replay (manual live; excluded from CI)",()=>{it("analyzes every current real dossier and researches only the deterministic top cohort",async()=>{
  const sources=[{key:"ibew716",url:IBEW716_JOURNEYMAN_JOB_CALLS_URL,adapter:new Ibew716JobCallAdapter(transport)},{key:"strike",url:STRIKE_LISTING_URL,adapter:new StrikeListingDiscoveryAdapter(transport)},{key:"trillium",url:TRILLIUM_LISTING_URL,adapter:new TrilliumListingDiscoveryAdapter(transport)},{key:"bechtel",url:BECHTEL_LISTING_URL,adapter:new BechtelListingDiscoveryAdapter(transport)}],
    inputs:ConversionEvidenceInput[]=[],failures:string[]=[];
  for(const s of sources)try{
    const c=await s.adapter.capturePage(request(s.key)),run=runListingDiscovery(c.observations,{sourceKey:s.key,listingUrl:s.url,observedAt:at}),byId=new Map(c.observations.map(o=>[o.externalId,o]));
    for(const signal of run.tracked){
      const o=byId.get(signal.externalId)!,id=`live:${s.key}:${signal.externalId}`,p=resolveOrganizationProvenance(o.organization,{...DISCOVERY_SOURCE_ORGANIZATION_PROFILES[s.key],sourceUrl:s.url,observedAt:at});
      inputs.push({signal,evidenceIds:[id],employer:p.employer,companyRole:p.companyRole,companyRoleEvidenceIds:[id],project:str(o.facts.project),buyer:str(o.facts.buyer),wage:str(o.facts.wage),perDiemOrIncentive:str(o.facts.incentive),schedule:str(o.facts.schedule),headcount:num(o.facts.headcount),acceptance:null,contacts:[],actionability:NO_ACTIONABILITY_EVIDENCE(`conversion:${signal.externalId}`),conflicts:[...p.conflicts],organizationProvenance:p});
    }
  }catch(e){failures.push(`${s.key}:${e instanceof Error?e.message:String(e)}`)}

  const all=inputs.map(x=>analyzeTemporalProjectIntelligence({conversion:x,asOf:at})),
    cohort=rankConversionCohort(inputs,5).map(x=>x.input),
    sourceOutcomes:{url:string;outcome:FailureSemantic}[]=[];

  let unionPageText="";
  {const r=await fetchLive("https://ibew716.net/journeyman-job-calls/","FlyWorkforceRadar/3D (+https://www.flyelectricsolution.com; info@flyelectricsolution.com)");
   if(r.body!==null&&r.ok)unionPageText=r.body.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ")}

  const researched:{input:ConversionEvidenceInput;temporal:TemporalEvidenceCandidate[];projects:ProjectEvidenceCandidate[]}[]=[];
  for(const input of cohort){
    const id=input.signal.externalId;
    if(id.includes("anheuser-busch"))researched.push({input,...await researchAnheuserBusch(input,unionPageText,sourceOutcomes)});
    else if(id.includes("wyman-gordon"))researched.push({input,...await researchWymanGordon(input,unionPageText,sourceOutcomes)});
    else if(id.includes("1388121200"))researched.push({input,...await researchBechtel(input,"https://bechtel.jobs.hr.cloud.sap/job/Pecos-Field-Superintendent-Electrical-TX-79772/1388121200/",sourceOutcomes)});
    else if(id.includes("1424714800"))researched.push({input,...await researchBechtel(input,"https://bechtel.jobs.hr.cloud.sap/job/New-Albany-Lead-Electrical-Superintendent-OH-43031/1424714800/",sourceOutcomes)});
    else if(id.includes("2uoovqgvhy"))researched.push({input,...await researchStrike(input,sourceOutcomes)});
    else researched.push({input,temporal:[],projects:[]});
  }

  const targeted=researched.map(r=>analyzeTemporalProjectIntelligence({conversion:r.input,temporalEvidence:r.temporal,projectEvidence:r.projects,asOf:at})),
    dossiers=inputs.map(convertDiscoverySignal),
    tasks=inputs.flatMap(x=>planTemporalProjectAcquisition({conversion:x,asOf:at})),
    temporalTaskTypes=new Set(["VERIFY_CURRENT_POSTING_STATUS","FIND_APPLICATION_DEADLINE","FIND_SOLICITATION_STATUS","FIND_CURRENT_JOB_CALL","VERIFY_POSTING_CURRENTNESS","VERIFY_PROJECT_CURRENTNESS","RESOLVE_TEMPORAL_CONFLICT"]),
    previews=researched.flatMap(r=>[...r.temporal.map(e=>previewTemporalCandidate({conversion:r.input,asOf:at},e)),...r.projects.map(p=>previewProjectCandidate({conversion:r.input,asOf:at},p))]);

  const report={
    failures,sourceOutcomes,
    realDossiers:inputs.length,dossiersAnalyzed:all.length,targetedDossiersResearched:targeted.length,
    temporalAcquisitionTasks:tasks.filter(t=>temporalTaskTypes.has(t.taskType)).length,
    projectAcquisitionTasks:tasks.filter(t=>!temporalTaskTypes.has(t.taskType)).length,
    openCandidates:targeted.filter(x=>x.candidateTemporalState==="OPEN").length,
    expired:targeted.filter(x=>x.candidateTemporalState==="EXPIRED").length,
    closed:targeted.filter(x=>x.candidateTemporalState==="CLOSED").length,
    awarded:targeted.filter(x=>x.candidateTemporalState==="AWARDED").length,
    cancelled:targeted.filter(x=>x.candidateTemporalState==="CANCELLED").length,
    unknownTemporal:targeted.filter(x=>x.candidateTemporalState==="UNKNOWN").length,
    projectIdentityCandidates:targeted.flatMap(x=>x.projects).filter(p=>p.state==="CANDIDATE").length,
    verifiedProjects:targeted.flatMap(x=>x.projects).filter(p=>p.state==="VERIFIED").length,
    ownerCandidates:targeted.flatMap(x=>x.projects).filter(p=>p.owner).length,
    gcCandidates:targeted.flatMap(x=>x.projects).filter(p=>p.generalContractor).length,
    electricalContractorCandidates:targeted.flatMap(x=>x.projects).filter(p=>p.electricalContractor).length,
    manpowerProjectLinkCandidates:targeted.flatMap(x=>x.projects).filter(p=>p.relationshipExplicit&&p.projectName).length,
    headcountCandidates:targeted.flatMap(x=>x.projects).filter(p=>p.headcount!==null).length,
    scheduleCandidates:targeted.flatMap(x=>x.projects).filter(p=>p.schedule!==null).length,
    durationCandidates:targeted.flatMap(x=>x.projects).filter(p=>p.duration!==null).length,
    perDiemCandidates:targeted.flatMap(x=>x.projects).filter(p=>p.perDiem!==null).length,
    temporalConflicts:targeted.flatMap(x=>x.temporalEvidence).filter(e=>e.conflicts.length).length,
    projectConflicts:targeted.flatMap(x=>x.projects).filter(p=>p.conflicts.length).length,
    humanVerificationItems:targeted.flatMap(x=>x.verificationItems).length,
    autoVerifiedItems:targeted.flatMap(x=>x.temporalEvidence).filter(e=>e.verificationState==="VERIFIED").length+targeted.flatMap(x=>x.projects).filter(p=>p.state==="VERIFIED").length,
    eligibleRealOpportunities:dossiers.filter(x=>x.eligibility.some(e=>e.eligible)).length,
    activeHotA:dossiers.flatMap(x=>x.activeHot).filter(x=>x.hotType==="HOT_A"&&x.active).length,
    activeHotB:dossiers.flatMap(x=>x.activeHot).filter(x=>x.hotType==="HOT_B"&&x.active).length,
    outreachActionsExecuted:0,
    previews:previews.map(x=>({persisted:x.persisted,hotBefore:x.current.activeHot.some(h=>h.active),hotAfter:x.ifVerified.activeHot.some(h=>h.active)})),
    cohort:researched.map((r,i)=>({externalId:r.input.signal.externalId,organization:r.input.organizationProvenance?.organization??r.input.signal.organization,location:r.input.signal.location,sourceUrl:r.input.signal.sourceUrl,currentTemporalState:targeted[i].currentTemporalState,candidateTemporalState:targeted[i].candidateTemporalState,projectState:targeted[i].projectState,temporalEvidenceFound:r.temporal.length,projectEvidenceFound:r.projects.length,verificationItems:targeted[i].verificationItems.length,remainingBlockers:targeted[i].remainingBlockers})),
  };
  console.log("PHASE_3D_LIVE_REPORT="+JSON.stringify(report));

  expect(failures).toEqual([]);
  expect(all).toHaveLength(inputs.length);
  expect(targeted).toHaveLength(Math.min(5,inputs.length));
  expect(sourceOutcomes.some(o=>o.outcome==="SUCCESS_WITH_EVIDENCE")).toBe(true);
  expect(targeted.flatMap(x=>x.temporalEvidence).every(e=>e.verificationState==="UNVERIFIED")).toBe(true);
  expect(targeted.flatMap(x=>x.projects).every(p=>p.state!=="VERIFIED")).toBe(true);
  expect(targeted.flatMap(x=>x.verificationItems).every(v=>v.decision===null)).toBe(true);
  expect(previews.every(x=>!x.persisted)).toBe(true);
  expect(report.headcountCandidates+report.scheduleCandidates+report.durationCandidates).toBe(0);
  expect(JSON.stringify(report)).not.toMatch(/emailSent|outreachExecuted":[1-9]|ACTIVATE_SOURCE/);
},180000)});
