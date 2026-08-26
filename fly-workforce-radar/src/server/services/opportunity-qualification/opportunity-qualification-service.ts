import type{OpportunityGraph}from"../../../domain/opportunity";import type{GapMatrixEntry,ManagerVerificationCandidate,QualificationDossier,QualificationGap,QualificationState}from"../../../domain/opportunity-qualification";import type{ManpowerAcceptanceResult}from"../../../domain/manpower-acceptance";import{MANPOWER_ACCEPTANCE_RULE_VERSION}from"../../../domain/manpower-acceptance";import{EligibilityService}from"../eligibility/eligibility-service";
import type{AggregatedCandidate}from"../../../domain/evidence-aggregation";import{aggregatedCandidates}from"../evidence-aggregation/evidence-aggregation-service";
const at=new Date("2026-08-21T12:00:00Z"),source=(key:string)=>`source:${key}`,evidence=(key:string)=>`evidence:${key}`;
export type Seed=Omit<QualificationDossier,"gapMatrix"|"eligibility"|"scoreState"|"commercialActionState"|"managerState">;
const seeds:Seed[]=[
{id:"qual-freeport",context:"Port Freeport procurement plus Freeport electrical demand",market:"Freeport",currentDemand:true,electricalRoles:["Principal Electrical Engineer"],demandSources:["freeport-lng-careers","port-freeport-notices"],company:"Port Freeport",canonicalCompanyStatus:"RESOLVED",project:"Port Freeport public construction procurement",projectStatus:"KNOWN",buyerCandidate:"Port Freeport",buyerVerificationStatus:"UNVERIFIED",companyRole:"OWNER / PROCUREMENT ISSUER; MANPOWER_BUYER UNVERIFIED",af01Candidate:null,af01Category:null,af01VerificationState:"MISSING",contactPerson:null,contactFunction:"PROCUREMENT",contactRoute:"marketing@portfreeport.com",routeType:"PROCUREMENT_EMAIL",routeGrade:null,routeVerificationState:"UNVERIFIED",compensation:null,overtime:null,perDiem:null,headcount:null,schedule:"Bid deadline; Full Time owner opening",duration:null,firstSeen:at,lastSeen:at,staleAfter:new Date("2026-09-16T19:00:00Z"),evidenceIds:[evidence("port-freeport"),evidence("freeport-lng"),evidence("city-freeport")],claimIds:[],sourceUrls:["https://www.portfreeport.com/governance/public-notices","https://freeportlng.com/careers/current-openings","https://www.freeporttx.gov/purchasing"],conflicts:["Freeport LNG, Port Freeport, and City of Freeport are separate entities; geography is not an identity key"],humanReviewRequirements:["Review Port Freeport buyer context","Review procurement route authority","Obtain opportunity-specific AF-01 evidence"]},
{id:"qual-beaumont-port-arthur",context:"Beaumont demand plus Port Arthur contractor procurement",market:"Beaumont / Port Arthur",currentDemand:true,electricalRoles:["Electrical demand context"],demandSources:["exxonmobil-beaumont"],company:"ExxonMobil",canonicalCompanyStatus:"RESOLVED",project:null,projectStatus:"CONFLICTING",buyerCandidate:"Port of Port Arthur",buyerVerificationStatus:"CONFLICTING",companyRole:"PROCUREMENT ISSUER; relationship to ExxonMobil demand unproven",af01Candidate:"participation in contracting",af01Category:"LABOR_SUBCONTRACTING_ACCEPTED",af01VerificationState:"CONFLICTING",contactPerson:null,contactFunction:"PROCUREMENT",contactRoute:"409-983-2011",routeType:"CORPORATE_PHONE",routeGrade:null,routeVerificationState:"CONFLICTING",compensation:null,overtime:null,perDiem:null,headcount:null,schedule:null,duration:null,firstSeen:at,lastSeen:at,staleAfter:new Date("2026-09-20T00:00:00Z"),evidenceIds:[evidence("exxonmobil"),evidence("port-arthur")],claimIds:[],sourceUrls:["https://jobs.exxonmobil.com/","https://portpa.com/business/procurement/"],conflicts:["No stable identifier links ExxonMobil demand to Port of Port Arthur procurement"],humanReviewRequirements:["Do not verify cross-entity buyer or AF-01","Find project-specific demand identifier"]},
{id:"qual-permian",context:"Strike Midland journeyman demand",market:"Permian Basin",currentDemand:true,electricalRoles:["Journeyman Electrician"],demandSources:["strike-midland"],company:"Strike",canonicalCompanyStatus:"RESOLVED",project:null,projectStatus:"UNKNOWN",buyerCandidate:null,buyerVerificationStatus:"MISSING",companyRole:"EMPLOYER; MANPOWER_BUYER not established",af01Candidate:null,af01Category:null,af01VerificationState:"MISSING",contactPerson:null,contactFunction:null,contactRoute:null,routeType:null,routeGrade:null,routeVerificationState:"MISSING",compensation:null,overtime:null,perDiem:null,headcount:null,schedule:"Full Time",duration:null,firstSeen:at,lastSeen:at,staleAfter:new Date("2026-09-20T00:00:00Z"),evidenceIds:[evidence("strike")],claimIds:[],sourceUrls:["https://strike.applytojob.com/apply/L3Wr0FKloj/Journeyman-Electrician"],conflicts:[],humanReviewRequirements:["No legitimate verification target yet; acquire buyer, AF-01, and authority evidence"]},
{id:"qual-corpus",context:"PSV industrial electrician demand plus Corpus procurement",market:"Corpus Christi",currentDemand:true,electricalRoles:["Industrial Electrician"],demandSources:["psv-industries"],company:"PSV Industries",canonicalCompanyStatus:"RESOLVED",project:null,projectStatus:"CONFLICTING",buyerCandidate:"City of Corpus Christi",buyerVerificationStatus:"CONFLICTING",companyRole:"MUNICIPAL PROCUREMENT; relationship to PSV demand unproven",af01Candidate:null,af01Category:null,af01VerificationState:"MISSING",contactPerson:null,contactFunction:"PROCUREMENT",contactRoute:"FinanceDepartment@CorpusChristiTX.gov",routeType:"PROCUREMENT_EMAIL",routeGrade:null,routeVerificationState:"CONFLICTING",compensation:null,overtime:null,perDiem:null,headcount:null,schedule:null,duration:null,firstSeen:at,lastSeen:at,staleAfter:new Date("2026-09-20T00:00:00Z"),evidenceIds:[evidence("psv"),evidence("corpus-procurement"),evidence("corpus-portal")],claimIds:[],sourceUrls:["https://www.psvindustries.com/careers","https://www.corpuschristitx.gov/department-directory/finance-procurement/contracts-and-procurement/","https://www.corpuschristitx.gov/department-directory/finance-procurement/contracts-and-procurement/supplier-portal-information/"],conflicts:["No stable identifier links PSV demand to City procurement"],humanReviewRequirements:["Do not resolve cross-source identity without project identifier","Acquire PSV recruiter authority and AF-01 evidence"]}
];
const state=(x:Seed,g:QualificationGap):QualificationState=>g==="DEMAND"?x.currentDemand?"PRESENT":"MISSING":g==="COMPANY"?x.company?"PRESENT":"MISSING":g==="PROJECT"?x.projectStatus==="CONFLICTING"?"CONFLICTING":x.project?"PRESENT":"MISSING":g==="BUYER"?x.buyerVerificationStatus:g==="AF_01"?x.af01VerificationState:g==="CONTACT_PERSON"?x.contactPerson?"UNVERIFIED":"MISSING":g==="CONTACT_ROUTE"||g==="ROUTE_AUTHORITY"?x.routeVerificationState:g==="COMPENSATION"?x.compensation?"PRESENT":"MISSING":g==="OVERTIME"?x.overtime?"PRESENT":"MISSING":g==="PER_DIEM"?x.perDiem?"PRESENT":"MISSING":g==="HEADCOUNT"?x.headcount!=null?"PRESENT":"MISSING":g==="SCHEDULE"?x.schedule?"PRESENT":"MISSING":g==="DURATION"?x.duration?"PRESENT":"MISSING":g==="PROVENANCE"?x.evidenceIds.length?"PRESENT":"MISSING":g==="CURRENTNESS"?x.staleAfter&&x.staleAfter<=at?"STALE":"PRESENT":g==="CONFLICT"?x.conflicts.length?"CONFLICTING":"PRESENT":x.humanReviewRequirements.length?"UNVERIFIED":"PRESENT";
const gaps:QualificationGap[]=["DEMAND","COMPANY","PROJECT","BUYER","AF_01","CONTACT_PERSON","CONTACT_ROUTE","ROUTE_AUTHORITY","COMPENSATION","OVERTIME","PER_DIEM","HEADCOUNT","SCHEDULE","DURATION","PROVENANCE","CURRENTNESS","CONFLICT","HUMAN_VERIFICATION"];
// Real-evidence wiring for the eligibility graph. This reads the same descriptive
// AF-01/buyer-candidate and contact-route fields already captured on each Seed (the
// same fields the gap matrix and managerVerificationCandidates() already read) instead
// of hardcoding acceptance:null / routeGrades:[] regardless of what evidence exists.
// A candidate is never promoted to VERIFIED here -- only an explicit "VERIFIED" already
// recorded on the Seed (which no real production Seed currently carries; only a
// controlled test fixture would) can produce a VERIFIED acceptance or route.
export const acceptanceResultFor=(x:Seed):ManpowerAcceptanceResult=>x.af01VerificationState==="VERIFIED"?"VERIFIED":x.af01Candidate?"INSUFFICIENT_EVIDENCE":"NOT_VERIFIED";
export const acceptanceFor=(x:Seed):Record<string,unknown>|null=>{if(!x.company)return null;const result=acceptanceResultFor(x);return{id:`${x.id}:acceptance`,companyId:x.company,context:{type:"OPPORTUNITY",id:x.id},result,qualifyingCategories:[],supportingClaimIds:[],supportingEvidenceIds:x.af01Candidate?x.evidenceIds:[],ignoredClaimIds:[],evaluatedAt:at,ruleVersion:MANPOWER_ACCEPTANCE_RULE_VERSION,valid_until:result==="VERIFIED"?x.staleAfter:null,reason:x.af01Candidate?`AF-01 candidate "${x.af01Candidate}" is captured but not human-verified`:"No AF-01 acceptance claim exists; absence is not denial"}};
export const routeVerificationStateFor=(x:Seed):string=>x.routeVerificationState==="VERIFIED"?"VERIFIED":"UNVERIFIED";
export const routeGradesFor=(x:Seed):Record<string,unknown>[]=>x.contactRoute&&x.routeGrade?[{id:`${x.id}:grade`,contact_route_id:`${x.id}:route`,grade:x.routeGrade,reason:`Contact-route grade evidence captured for ${x.contactRoute}`,ruleVersion:"contact-route-grade@1.0.0",evaluatedAt:at}]:[];
const matrix=(x:Seed):GapMatrixEntry[]=>gaps.map(g=>{const s=state(x,g),eligibility=["DEMAND","COMPANY","PROJECT","BUYER","AF_01","CONTACT_ROUTE","ROUTE_AUTHORITY","PROVENANCE","CURRENTNESS","CONFLICT","HUMAN_VERIFICATION"].includes(g);return{gap:g,status:s,evidenceAvailable:x.evidenceIds,evidenceRequired:s==="PRESENT"?"None for descriptive completeness":`Current opportunity-specific ${g} evidence`,likelySources:x.demandSources.map(source),blocksVamo:eligibility&&["CONTACT_ROUTE","ROUTE_AUTHORITY","CONFLICT","HUMAN_VERIFICATION"].includes(g),blocksHotA:eligibility,blocksHotB:eligibility&&["DEMAND","CONTACT_ROUTE","ROUTE_AUTHORITY","PROVENANCE","CURRENTNESS","CONFLICT","HUMAN_VERIFICATION"].includes(g),humanReviewRequired:["BUYER","AF_01","ROUTE_AUTHORITY","CONFLICT","HUMAN_VERIFICATION"].includes(g)&&s!=="PRESENT"}});
const graph=(x:Seed):OpportunityGraph=>({opportunity:{id:x.id,identityKey:x.id,projectId:x.project?`${x.id}:project`:null,unresolvedCompanyContext:x.company,title:x.context,lifecycle:"ACTIVE",firstSeenAt:x.firstSeen,lastSeenAt:x.lastSeen,staleAfter:x.staleAfter,verificationDueAt:null,metadata:{}},demandSignals:x.currentDemand?[{id:`${x.id}:demand`,raw_evidence_id:x.evidenceIds[0],stale_after:x.staleAfter}]:[],claims:[],companies:x.company?[{id:`${x.id}:company`,name:x.company}]:[],companyRoles:x.buyerCandidate?[{id:`${x.id}:buyer`,role:"MANPOWER_BUYER",verification_state:"UNVERIFIED"}]:[],project:x.project?{id:`${x.id}:project`,name:x.project}:null,acceptance:acceptanceFor(x),vendorRoutes:[],contactPeople:[],contactRoutes:x.contactRoute?[{id:`${x.id}:route`,route_type:x.routeType,verification_state:routeVerificationStateFor(x),lifecycle:"ACTIVE",stale_after:x.staleAfter}]:[],routeGrades:routeGradesFor(x),evidence:x.evidenceIds.map(id=>({id})),verificationReviews:[],gaps:["MISSING_MANPOWER_ACCEPTANCE","MISSING_ACTIONABLE_ROUTE",...(x.project?[]:["MISSING_PROJECT"])]as OpportunityGraph["gaps"],conflicts:x.conflicts,asOf:at,descriptiveOnly:true});
export{graph};
const buildDossier=(x:Seed):QualificationDossier=>{const results=new EligibilityService({graph:async()=>graph(x)},{activeEvidenceIds:async(ids:string[])=>ids,save:async r=>({...r,id:"unused",createdAt:at}),list:async()=>[]},()=>at).assess(graph(x),at),eligibility=Object.fromEntries(results.map(r=>[r.eligibilityType,{eligible:r.eligible,blockers:r.blockingGaps}]))as QualificationDossier["eligibility"];return{...x,gapMatrix:matrix(x),eligibility,scoreState:"NOT_SCORABLE",commercialActionState:"NOT_GENERATED",managerState:x.buyerCandidate&&x.buyerVerificationStatus==="UNVERIFIED"?"AWAITING_MANAGER_VERIFICATION":"EVIDENCE_GAP"}};
export function qualificationDossiers():QualificationDossier[]{return seeds.map(buildDossier)}

/**
 * Phase 2M / TECH-DEBT-04 resolution. seedWithAggregatedEvidence() folds
 * AggregatedCandidate evidence -- sourced one-directionally from the neutral
 * evidence-aggregation-service.ts, which reads the Phase 2H/2I/2J targeted-evidence
 * data and the hot-conversion REAL_CONVERSION_SET ledger and never imports anything
 * from this file -- into a Seed's own buyer/AF-01/contact-route fields. This is the
 * concrete mechanism by which a human reviewer's decision on richer FACTS-level
 * evidence (previously unreachable from this file without a circular import) becomes
 * visible to the same real, unmodified graph()/EligibilityService pipeline every
 * other seed already goes through.
 *
 * Candidate evidence NEVER overwrites a Seed's own descriptive fields (this is
 * additive, never lossy) and only ever promotes buyer/AF-01/route verification state
 * to "VERIFIED" when the candidate's OWN verificationState is genuinely "VERIFIED" --
 * which, for every real AggregatedCandidate produced from real production evidence,
 * is never true; only the CONTROLLED_TEST_REVIEW pathway exercised in tests can
 * produce that state.
 *
 * qualificationDossiers() above (relied on by every prior-phase test and by every
 * existing downstream consumer of the default seeds) is left byte-for-byte
 * unchanged: it still maps seeds through buildDossier() with zero enrichment, exactly
 * as before this phase. qualificationDossiersEnriched() below is the new, additive,
 * explicitly-opt-in entry point that exercises and proves the resolved wiring.
 */
export function seedWithAggregatedEvidence(x:Seed,candidates:AggregatedCandidate[]=[]):Seed{
  const mine=candidates.filter(c=>c.opportunityId===x.id);
  const buyer=mine.find(c=>c.type==="BUYER_CANDIDATE");
  const af01=mine.find(c=>c.type==="AF01_CANDIDATE");
  const contact=mine.find(c=>c.type==="CONTACT_AUTHORITY");
  if(!buyer&&!af01&&!contact)return x;
  const evidenceIds=[...new Set([...x.evidenceIds,...mine.flatMap(c=>c.evidenceIds)])];
  const sourceUrls=[...new Set([...x.sourceUrls,...mine.flatMap(c=>c.sourceUrls)])];
  return{
    ...x,
    evidenceIds,
    sourceUrls,
    ...(buyer&&buyer.verificationState==="VERIFIED"?{buyerCandidate:x.buyerCandidate??buyer.value,buyerVerificationStatus:"VERIFIED"as const}:{}),
    ...(af01&&af01.verificationState==="VERIFIED"?{af01Candidate:x.af01Candidate??af01.value,af01Category:x.af01Category??af01.category,af01VerificationState:"VERIFIED"as const}:{}),
    ...(contact&&contact.verificationState==="VERIFIED"?{contactPerson:x.contactPerson??contact.contactPersonName,contactRoute:x.contactRoute??contact.routeTarget,routeType:x.routeType??contact.routeType,routeGrade:x.routeGrade??contact.routeGrade,routeVerificationState:"VERIFIED"as const}:{}),
  };
}
export function qualificationDossiersEnriched(candidates:AggregatedCandidate[]=aggregatedCandidates()):QualificationDossier[]{return seeds.map(x=>buildDossier(seedWithAggregatedEvidence(x,candidates)))}
export function managerVerificationCandidates(rows=qualificationDossiers()):ManagerVerificationCandidate[]{return rows.flatMap(x=>x.managerState!=="AWAITING_MANAGER_VERIFICATION"?[]:[{target:`COMPANY_ROLE:${x.id}:buyer`,opportunityId:x.id,currentState:"UNVERIFIED"as const,proposedDecision:"NEEDS_MORE_EVIDENCE"as const,supportingEvidence:[x.buyerCandidate??""],evidenceIds:x.evidenceIds,sourceUrls:x.sourceUrls,reason:"Candidate is explicit but evidence does not yet establish external manpower authority",ifVerified:"Buyer gate may improve; AF-01 and route gates remain",ifRejected:"Buyer candidate cannot support eligibility"}])}
export function convergence(x:QualificationDossier){const values={Demand:x.currentDemand?"PRESENT":"MISSING",Project:x.projectStatus==="CONFLICTING"?"CONFLICTING":x.project?"PRESENT":"MISSING",Buyer:x.buyerVerificationStatus,AF01:x.af01VerificationState,ContactRoute:x.routeVerificationState};return{values,present:Object.values(values).filter(v=>v!=="MISSING").length,verified:Object.values(values).filter(v=>v==="VERIFIED").length}}
export const sourceContribution=(rows=qualificationDossiers())=>[...new Set(rows.flatMap(x=>x.demandSources))].map(key=>({source:key,roles:["DEMAND_CONTRIBUTOR","DISCOVERY_CONTRIBUTOR"],opportunities:rows.filter(x=>x.demandSources.includes(key)).map(x=>x.id)}));

/**
 * Stage 2N-A addition. Exposes a single real Seed by id so a non-persisted preview
 * service (decision-preview-service.ts) can run the REAL unmodified graph()/
 * EligibilityService/ScoringService/CommercialActionService pipeline against a
 * candidate-enriched seed, without duplicating this file's own seed literals or
 * fabricating a parallel copy of them. Purely additive read access: returns the
 * exact same Seed object qualificationDossiers() already builds every dossier from;
 * nothing is created, mutated, or removed by this export, and nothing calling it can
 * write back into `seeds`.
 */
export function qualificationSeed(id:string):Seed|undefined{return seeds.find(x=>x.id===id)}
