/**
 * Phase 3G Commercial Evidence Closure & Contact Intelligence composition.
 *
 * Composes, never reimplements:
 *  - hot-conversion-engine-service.ts's evaluateWorkforceConversion (Phase
 *    3E) for every hypothetical preview -- no eligibility/HOT logic here.
 *  - contact-intelligence-service.ts's createContactCandidate /
 *    recommendContactGrade (Phase 3C) for every contact candidate -- grade
 *    recommendation is never recomputed, only reused.
 *  - multi-trade-workforce.ts's acceptanceCoversTrade / contactAuthorityCoversTrade
 *    (Phase 3X) for scope, via the SAME applyEvidenceScope Phase 3E already uses.
 *
 * This file's only new logic is: turning a real Phase 3F blocker into an
 * explicit search plan, classifying raw candidate text into a bounded
 * evidence-class/scope/entity-match vocabulary, and packaging the result
 * for a human decision that is never made here.
 */
import{createHash}from"node:crypto";
import type{ConversionAcceptanceEvidence,ConversionContactEvidence}from"../../../domain/commercial-conversion";
import type{EvidenceSourceType}from"../../../domain/commercial-evidence-acquisition";
import type{ContactCandidateEvidence}from"../../../domain/contact-intelligence";
import{recommendContactGrade}from"../contact-intelligence/contact-intelligence-service";
import type{TradeId}from"../../../domain/workforce-taxonomy";
import type{
  AF01CandidateEvidence,AcquisitionBudget,Af01EvidenceClass,CandidateQuality,ClosureCase,ClosureCaseState,
  ClosureDeskSnapshot,ClosureHumanDecisionInput,ClosurePriorityItem,ClosureTarget,ClosureTargetType,
  EntityMatchState,EvidenceScopeState,PreviewImpact,SearchStrategy,VerificationPacket,
}from"../../../domain/commercial-evidence-closure";
import{
  AF01_CLOSURE_BLOCKERS,COMMERCIAL_EVIDENCE_CLOSURE_RULE_VERSION,CONTACT_CLOSURE_BLOCKERS,
  DEFAULT_ACQUISITION_BUDGET,STRONG_AF01_CLASSES,
}from"../../../domain/commercial-evidence-closure";
import type{WorkforceOperationalItem}from"../../../domain/operational-desk";
import type{WorkforceEvidenceScopeInput,WorkforceConversionEvaluationInput}from"../hot-conversion-engine/hot-conversion-engine-service";
import{evaluateWorkforceConversion}from"../hot-conversion-engine/hot-conversion-engine-service";

const hash=(v:string)=>createHash("sha256").update(v).digest("hex").slice(0,24);

/* ------------------------------------------------------------------------ */
/* Closure case derivation (from real Phase 3F work items only)             */
/* ------------------------------------------------------------------------ */

export function closureCaseId(opportunityId:string,targetType:ClosureTargetType,tradeId:string|null):string{
  return`closure:${opportunityId}:${targetType}:${tradeId??"NONE"}`;
}

function buildClosureTarget(item:WorkforceOperationalItem,targetType:ClosureTargetType):ClosureTarget{
  const description=targetType==="ACTIONABLE_CONTACT"
    ?`Verified current professional contact route relevant to the commercial decision path${item.tradeId?` for ${item.tradeId}`:""}.`
    :`Official evidence that ${item.organization??"the organization"} accepts an external manpower relationship relevant to ${item.tradeId??"this trade"}.`;
  return{targetType,description,tradeId:item.tradeId,organization:item.organization,projectRef:item.projectRef};
}

/** Derives at most one contact closure case and one AF-01 closure case per
 * work item, only when a real Phase 3E blocker of that category is present.
 * Never invents a closure case for a work item that has neither. */
export function deriveClosureCases(item:WorkforceOperationalItem,budget:AcquisitionBudget=DEFAULT_ACQUISITION_BUDGET):ClosureCase[]{
  const blockerCodes=new Set(item.blockers.map(b=>b.code));
  const cases:ClosureCase[]=[];
  const wants=(list:readonly string[])=>list.some(c=>blockerCodes.has(c as never));
  if(wants(CONTACT_CLOSURE_BLOCKERS))cases.push(openCase(item,"ACTIONABLE_CONTACT",budget));
  if(wants(AF01_CLOSURE_BLOCKERS))cases.push(openCase(item,"AF01_ACCEPTANCE",budget));
  return cases;
}

function sourceBlockerFor(item:WorkforceOperationalItem,targetType:ClosureTargetType){
  const list=targetType==="ACTIONABLE_CONTACT"?CONTACT_CLOSURE_BLOCKERS:AF01_CLOSURE_BLOCKERS;
  return item.blockers.find(b=>(list as readonly string[]).includes(b.code))??item.primaryBlocker;
}

function openCase(item:WorkforceOperationalItem,targetType:ClosureTargetType,budget:AcquisitionBudget):ClosureCase{
  const target=buildClosureTarget(item,targetType),id=closureCaseId(item.opportunityId,targetType,item.tradeId);
  const blocker=sourceBlockerFor(item,targetType);
  return{
    closureCaseId:id,
    workItemId:item.workItemId,
    opportunityId:item.opportunityId,
    organization:item.organization,
    projectRef:item.projectRef,
    workforceClassification:{state:"RECOGNIZED",industryId:null,disciplineId:null,tradeId:item.tradeId,occupationId:item.occupationId,roleClass:item.roleClass,specialtyIds:[],skillIds:[],credentialIds:[]},
    tradeId:item.tradeId,
    occupationId:item.occupationId,
    sourceBlocker:blocker?.code??"MISSING_ACTIONABLE_CONTACT",
    closureTaskType:targetType==="ACTIONABLE_CONTACT"?"FIND_ACTIONABLE_CONTACT":"FIND_AF01_EVIDENCE",
    nextBestAction:item.nextBestAction,
    target,
    searchPlan:buildSearchPlan(id,target,budget),
    contactCandidates:[],
    af01Candidates:[],
    verificationPackets:[],
    status:"OPEN",
    provenanceRefs:[...item.provenanceRefs],
    ruleVersion:COMMERCIAL_EVIDENCE_CLOSURE_RULE_VERSION,
  };
}

/* ------------------------------------------------------------------------ */
/* Search plan (deterministic, bounded)                                     */
/* ------------------------------------------------------------------------ */

const CONTACT_STRATEGY_TEMPLATES:{intent:(org:string,project:string|null)=>string;sources:EvidenceSourceType[]}[]=[
  {intent:org=>`${org} procurement contact`,sources:["OFFICIAL_CORPORATE_CONTACT","OFFICIAL_PROCUREMENT"]},
  {intent:org=>`${org} supplier relations`,sources:["OFFICIAL_SUPPLIER_VENDOR"]},
  {intent:(org,project)=>project?`${org} project manager ${project}`:`${org} project leadership`,sources:["OFFICIAL_PROJECT"]},
  {intent:org=>`${org} workforce solutions`,sources:["OFFICIAL_CONTINGENT_WORKFORCE"]},
  {intent:org=>`${org} staffing vendor`,sources:["PROFESSIONAL_CORPORATE_PAGE","STAFFING_POSTING"]},
];
const AF01_STRATEGY_TEMPLATES:{intent:(org:string)=>string;sources:EvidenceSourceType[]}[]=[
  {intent:org=>`${org} staffing suppliers`,sources:["OFFICIAL_CONTINGENT_WORKFORCE"]},
  {intent:org=>`${org} contingent workforce`,sources:["OFFICIAL_CONTINGENT_WORKFORCE"]},
  {intent:org=>`${org} craft labor vendors`,sources:["OFFICIAL_SUBCONTRACTOR_ONBOARDING"]},
  {intent:org=>`${org} subcontract labor`,sources:["OFFICIAL_SUBCONTRACTOR_ONBOARDING"]},
  {intent:org=>`${org} manpower supplier`,sources:["OFFICIAL_SUPPLIER_VENDOR"]},
];
const STOP_CONDITION="Stop once sufficient high-quality candidate evidence exists for human review, authoritative negative evidence is found, the search budget is exhausted, or no approved source strategy remains.";

export function buildSearchPlan(caseId:string,target:ClosureTarget,budget:AcquisitionBudget=DEFAULT_ACQUISITION_BUDGET):SearchStrategy[]{
  const org=target.organization??"the organization";
  const templates=target.targetType==="ACTIONABLE_CONTACT"?CONTACT_STRATEGY_TEMPLATES:AF01_STRATEGY_TEMPLATES;
  return templates.slice(0,budget.maxStrategiesPerCase).map((t,i):SearchStrategy=>({
    strategyId:`${caseId}:strategy:${i+1}`,closureCaseId:caseId,evidenceType:target.targetType,
    organization:target.organization,projectRef:target.projectRef,tradeId:target.tradeId,occupationId:null,
    queryIntent:target.targetType==="ACTIONABLE_CONTACT"?(t as typeof CONTACT_STRATEGY_TEMPLATES[number]).intent(org,target.projectRef):(t as typeof AF01_STRATEGY_TEMPLATES[number]).intent(org),
    preferredSourceClasses:t.sources,priority:i+1,stopCondition:STOP_CONDITION,
  }));
}

/* ------------------------------------------------------------------------ */
/* AF-01 candidate classification (deterministic, text-based)               */
/* ------------------------------------------------------------------------ */

const NEGATIVE_PATTERN=/\b(does not|do not|no longer|not currently|discontinued|excludes?|ineligible)\b[^.]{0,60}\b(staffing|vendor|contingent|subcontract|manpower|labor|craft)\b/i;
const CLASS_PATTERNS:{cls:Af01EvidenceClass;pattern:RegExp}[]=[
  {cls:"STAFFING_VENDOR_ACCEPTANCE",pattern:/\bstaffing (agenc(?:y|ies)|vendors?)\b.{0,40}\b(accept|approv|partner|utili[sz]e|engag|work with)|\b(accept|approv|partner|utili[sz]e|engag|work with).{0,40}\bstaffing (agenc(?:y|ies)|vendors?)\b/i},
  {cls:"CONTINGENT_LABOR_ACCEPTANCE",pattern:/\bcontingent (workforce|labor|staffing)\b/i},
  {cls:"CRAFT_LABOR_SUPPLIER_ACCEPTANCE",pattern:/\bcraft labor (supplier|vendor)s?\b/i},
  {cls:"WORKFORCE_SUBCONTRACTING_ACCEPTANCE",pattern:/\bsubcontract(?:ing)? (labor|workforce|manpower)\b/i},
  {cls:"THIRD_PARTY_LABOR_ACCEPTANCE",pattern:/\bthird[- ]party (labor|recruiting|staffing)\b/i},
  {cls:"EXPLICIT_MANPOWER_ACCEPTANCE",pattern:/\bmanpower (supplier|acceptance|policy|vendor)\b|\baccepts? external manpower\b/i},
  {cls:"GENERAL_SUPPLIER_ROUTE",pattern:/\bsupplier (portal|registration|program|information)\b/i},
  {cls:"GENERAL_SUBCONTRACTOR_ROUTE",pattern:/\bsubcontractors?\b/i},
  {cls:"AMBIGUOUS_VENDOR_LANGUAGE",pattern:/\bvendors?\b/i},
];

/** Pure, deterministic. Order matters: negative evidence and the most
 * specific strong classes are checked before generic/ambiguous ones, so
 * "explicit staffing vendor acceptance" never collapses into the same
 * bucket as a bare "vendors" mention. */
export function classifyAf01EvidenceText(text:string):Af01EvidenceClass{
  if(NEGATIVE_PATTERN.test(text))return"NEGATIVE_EVIDENCE";
  for(const{cls,pattern}of CLASS_PATTERNS)if(pattern.test(text))return cls;
  return"UNKNOWN";
}

/* ------------------------------------------------------------------------ */
/* Entity / project match safety                                            */
/* ------------------------------------------------------------------------ */

/** No fuzzy merge: exact case/whitespace-insensitive match only counts as
 * MATCH. A substring relationship ("Bechtel" vs "Bechtel Corporation") is
 * AMBIGUOUS, never silently treated as the same entity. */
export function matchEntity(candidateOrganization:string|null,targetOrganization:string|null):EntityMatchState{
  if(!candidateOrganization||!targetOrganization)return"AMBIGUOUS";
  const a=candidateOrganization.trim().toLowerCase(),b=targetOrganization.trim().toLowerCase();
  if(a===b)return"MATCH";
  if(a.includes(b)||b.includes(a))return"AMBIGUOUS";
  return"MISMATCH";
}

export function matchProject(candidateProjectRef:string|null,targetProjectRef:string|null):EntityMatchState|"NOT_APPLICABLE"{
  if(!targetProjectRef||targetProjectRef.startsWith("opportunity:"))return"NOT_APPLICABLE";
  if(!candidateProjectRef)return"AMBIGUOUS";
  if(candidateProjectRef===targetProjectRef)return"MATCH";
  return"MISMATCH";
}

/* ------------------------------------------------------------------------ */
/* AF-01 candidate construction                                             */
/* ------------------------------------------------------------------------ */

export interface RawAf01Observation{
  opportunityId:string;
  organization:string|null;
  candidateClaim:string;
  sourceUrl:string;
  sourceType:EvidenceSourceType;
  evidenceTier:AF01CandidateEvidence["evidenceTier"];
  observedAt:Date;
  scope:EvidenceScopeState;
  scopedTradeIds:TradeId[];
  scopeEvidenceText:string|null;
  targetOrganization:string|null;
  targetProjectRef:string|null;
}

export function buildAf01Candidate(raw:RawAf01Observation):AF01CandidateEvidence{
  const evidenceClass=classifyAf01EvidenceText(raw.candidateClaim);
  const base={
    opportunityId:raw.opportunityId,organization:raw.organization,evidenceClass,candidateClaim:raw.candidateClaim,
    sourceUrl:raw.sourceUrl,sourceType:raw.sourceType,evidenceTier:raw.evidenceTier,observedAt:raw.observedAt,
    scope:raw.scope,scopedTradeIds:raw.scopedTradeIds,scopeEvidenceText:raw.scopeEvidenceText,
    entityMatch:matchEntity(raw.organization,raw.targetOrganization),
    projectMatch:matchProject(null,raw.targetProjectRef),
    verificationState:"UNVERIFIED"as const,conflicts:[]as string[],
    provenance:`${raw.sourceType} observed ${raw.observedAt.toISOString()} at ${raw.sourceUrl}`,
  };
  const id=`af01:${hash([raw.opportunityId,raw.sourceUrl,evidenceClass,raw.candidateClaim].join("|"))}`;
  return{...base,id};
}

/* ------------------------------------------------------------------------ */
/* Candidate quality (prioritization only -- never a verification bypass)   */
/* ------------------------------------------------------------------------ */

const TIER_SCORE:Record<string,number>={TIER_1_PRIMARY_AUTHORITATIVE:2,TIER_2_STRONG_SUPPORTING:1,TIER_3_DISCOVERY_LEAD:0};

export function scoreContactCandidateQuality(c:ContactCandidateEvidence):CandidateQuality{
  const sourceAuthority=TIER_SCORE[c.evidenceTier]??0;
  const directness=c.personName?2:c.routeTarget?1:0;
  const specificity=c.function!=="UNKNOWN"?2:c.contactType!=="UNKNOWN"?1:0;
  const currentness=c.freshness==="CURRENT"?2:c.freshness==="UNKNOWN"?1:0;
  const entityMatch=c.opportunityRelationshipExplicit?2:0;
  const scopeRelevance=c.supportedRelationship?2:0;
  const authorityRelevance=c.authorityEvidence?2:0;
  const total=sourceAuthority+directness+specificity+currentness+entityMatch+scopeRelevance+authorityRelevance;
  return{sourceAuthority,directness,specificity,currentness,entityMatch,scopeRelevance,authorityRelevance,total};
}

export function scoreAf01CandidateQuality(c:AF01CandidateEvidence):CandidateQuality{
  const sourceAuthority=TIER_SCORE[c.evidenceTier]??0;
  const directness=STRONG_AF01_CLASSES.has(c.evidenceClass)?2:c.evidenceClass==="AMBIGUOUS_VENDOR_LANGUAGE"?0:1;
  const specificity=c.evidenceClass!=="UNKNOWN"&&c.evidenceClass!=="AMBIGUOUS_VENDOR_LANGUAGE"?2:0;
  const currentness=1;
  const entityMatch=c.entityMatch==="MATCH"?2:c.entityMatch==="AMBIGUOUS"?1:0;
  const scopeRelevance=c.scope==="ORGANIZATION_WIDE"||c.scope==="TRADE_SPECIFIC"?2:c.scope==="MULTI_TRADE"?1:0;
  const authorityRelevance=c.scopeEvidenceText?2:0;
  const total=sourceAuthority+directness+specificity+currentness+entityMatch+scopeRelevance+authorityRelevance;
  return{sourceAuthority,directness,specificity,currentness,entityMatch,scopeRelevance,authorityRelevance,total};
}

/* ------------------------------------------------------------------------ */
/* Preview (hypothetical, non-persisting -- reuses Phase 3E verbatim)       */
/* ------------------------------------------------------------------------ */

/** Phase 3X's canonical AcceptanceEvidenceScope has no MULTI_TRADE value --
 * multi-trade coverage is expressed there as TRADE_SPECIFIC with more than
 * one entry in scopedTradeIds. This maps Phase 3G's own (slightly richer,
 * pre-verification) EvidenceScopeState onto that canonical vocabulary for
 * the sole purpose of running a real Phase 3E/3X scope check; it changes no
 * scope semantics, only relabels for the call. */
function toAcceptanceScope(scope:EvidenceScopeState):"ORGANIZATION_WIDE"|"TRADE_SPECIFIC"|"UNKNOWN"{
  if(scope==="ORGANIZATION_WIDE")return"ORGANIZATION_WIDE";
  if(scope==="TRADE_SPECIFIC"||scope==="MULTI_TRADE")return"TRADE_SPECIFIC";
  return"UNKNOWN";
}

const PROFESSIONAL_CONTACT_TYPES=new Set(["PROCUREMENT_PERSON","PURCHASING_PERSON","SOURCING_PERSON","SUPPLY_CHAIN_PERSON","VENDOR_MANAGEMENT_PERSON","CONTINGENT_WORKFORCE_PERSON","WORKFORCE_PROCUREMENT_PERSON","SUBCONTRACTING_PERSON","PROJECT_PROCUREMENT_PERSON","CONSTRUCTION_PROCUREMENT_PERSON","SUPPLIER_RELATIONS_PERSON","PROJECT_LEADERSHIP_PERSON"]);

/**
 * Phase 3C's ContactIntelligenceType (who the person/route IS -- e.g.
 * "PROCUREMENT_PERSON") and the canonical eligibility/commercial-action
 * engine's routeType (what MEDIUM the route is -- e.g. "PROCUREMENT_EMAIL")
 * are different vocabularies. This maps deterministically from the
 * candidate's real, observed contactType plus the actual shape of its
 * routeTarget (an "@" address vs. a phone-shaped string) onto the medium
 * the canonical engine understands -- never a guess at who the person is,
 * only at which channel their already-observed target uses.
 */
function inferRouteType(candidate:ContactCandidateEvidence):string{
  const target=candidate.routeTarget??"";
  const isEmail=target.includes("@");
  const isPhone=!isEmail&&/^[+()\d\s-]{7,}$/.test(target);
  if(candidate.contactType==="RECRUITER")return isPhone?"RECRUITER_PHONE":"RECRUITER_EMAIL";
  if(PROFESSIONAL_CONTACT_TYPES.has(candidate.contactType))return isPhone?"PROFESSIONAL_PHONE":"PROFESSIONAL_EMAIL";
  if(candidate.contactType==="PROCUREMENT_MAILBOX")return"PROCUREMENT_EMAIL";
  if(candidate.contactType==="PHONE_ROUTE")return"OFFICE_PHONE";
  if(candidate.contactType==="VENDOR_PORTAL_ROUTE")return"VENDOR_REGISTRATION";
  if(candidate.contactType==="SUPPLIER_SUPPORT_ROUTE")return"SUPPLIER_PORTAL";
  if(candidate.contactType==="DEPARTMENT_MAILBOX"||candidate.contactType==="GENERAL_CORPORATE_CONTACT")return"CORPORATE_EMAIL";
  return"CORPORATE_EMAIL";
}

function toPreviewImpact(before:ReturnType<typeof evaluateWorkforceConversion>,after:ReturnType<typeof evaluateWorkforceConversion>):PreviewImpact{
  return{
    changed:JSON.stringify(before)!==JSON.stringify(after),
    wouldBecomeActiveHotA:!before.activeHotA&&after.activeHotA,
    wouldBecomeActiveHotB:!before.activeHotB&&after.activeHotB,
    eligibilityChanged:JSON.stringify(before.eligibility)!==JSON.stringify(after.eligibility),
    remainingBlockerCountAfter:after.blockers.length,
    persisted:false,
  };
}

/** Hypothetical only: inserts the candidate as a VERIFIED contact and
 * re-evaluates through the real Phase 3E engine, scoping the hypothetical
 * verification to exactly the scope the candidate itself claims -- so an
 * electrical-only candidate previews as NOT unlocking a welding demand,
 * exactly like already-existing scoped evidence would. Never persisted,
 * never mutates the real dossier. */
export function previewContactCandidate(evalInput:WorkforceConversionEvaluationInput,candidate:ContactCandidateEvidence):PreviewImpact{
  const before=evaluateWorkforceConversion(evalInput);
  // recommendContactGrade only ever proposes A-D when verificationState is
  // already VERIFIED (proposedGrade on an un-verified candidate is always
  // "E" by that function's own design -- confirmed by Phase 3C's own live
  // pilot, which asserts gradeA===0 for every real CANDIDATE-state route).
  // A meaningful "if a human verifies this exact evidence" preview must ask
  // the SAME canonical function what grade it would assign once verified,
  // not reuse the pre-verification placeholder grade.
  const verifiedGrade=recommendContactGrade({...candidate,verificationState:"VERIFIED",freshness:"CURRENT"}).proposedGrade;
  const hypothetical:ConversionContactEvidence={
    id:candidate.id,organization:candidate.organization,function:candidate.function,routeType:inferRouteType(candidate),
    target:candidate.routeTarget??"",gradeCandidate:verifiedGrade,verificationState:"VERIFIED",
    observedAt:candidate.observedAt,staleAfter:new Date(candidate.observedAt.getTime()+366*86400000),evidenceIds:[candidate.id],
  };
  const scope:WorkforceEvidenceScopeInput={
    af01:evalInput.scope?.af01??null,
    contactScopes:{...evalInput.scope?.contactScopes,[candidate.id]:{gradeCandidate:verifiedGrade,scope:candidate.opportunityRelationshipExplicit?"ORGANIZATION_WIDE":"UNKNOWN",scopedTradeIds:evalInput.classification.tradeId?[evalInput.classification.tradeId]:[]}},
  };
  const after=evaluateWorkforceConversion({...evalInput,input:{...evalInput.input,contacts:[...evalInput.input.contacts,hypothetical]},scope});
  return toPreviewImpact(before,after);
}

export function previewAf01Candidate(evalInput:WorkforceConversionEvaluationInput,candidate:AF01CandidateEvidence):PreviewImpact{
  const before=evaluateWorkforceConversion(evalInput);
  const hypothetical:ConversionAcceptanceEvidence={
    id:candidate.id,category:candidate.evidenceClass,verificationState:"VERIFIED",accepted:true,
    observedAt:candidate.observedAt,validUntil:new Date(candidate.observedAt.getTime()+366*86400000),evidenceIds:[candidate.id],
  };
  const scope:WorkforceEvidenceScopeInput={
    af01:{category:candidate.evidenceClass,scope:toAcceptanceScope(candidate.scope),scopedTradeIds:candidate.scopedTradeIds,scopeEvidenceText:candidate.scopeEvidenceText},
    contactScopes:evalInput.scope?.contactScopes??{},
  };
  const after=evaluateWorkforceConversion({...evalInput,input:{...evalInput.input,acceptance:hypothetical},scope});
  return toPreviewImpact(before,after);
}

/* ------------------------------------------------------------------------ */
/* Verification packets                                                     */
/* ------------------------------------------------------------------------ */

export function buildContactVerificationPacket(closureCaseId:string,candidate:ContactCandidateEvidence,preview:PreviewImpact|null):VerificationPacket{
  return{
    verificationItemId:`verify:${candidate.id}`,closureCaseId,opportunityId:candidate.opportunityId,
    organization:candidate.organization,tradeId:null,candidateEvidenceType:"ACTIONABLE_CONTACT",candidateId:candidate.id,
    candidateValue:candidate.personName??candidate.routeTarget??candidate.contactType,
    candidateScope:candidate.opportunityRelationshipExplicit?"ORGANIZATION_WIDE":"UNKNOWN",
    candidateGrade:candidate.proposedGrade,candidateQuality:scoreContactCandidateQuality(candidate),
    sourceUrl:candidate.sourceUrl,provenance:candidate.provenance,
    whyItMatters:"A verified actionable contact route is required for HOT-A/VAMO eligibility (ACTIONABLE_CONTACT_REQUIRED).",
    affectedCanonicalGate:["G7_ACTIONABLE_CONTACT","G10_ELIGIBILITY","G13_ACTIVE_HOT"],
    previewImpact:preview,humanDecisionRequired:["VERIFY","REJECT","NEEDS_MORE_EVIDENCE","DEFER"],
  };
}

export function buildAf01VerificationPacket(closureCaseId:string,candidate:AF01CandidateEvidence,preview:PreviewImpact|null):VerificationPacket{
  return{
    verificationItemId:`verify:${candidate.id}`,closureCaseId,opportunityId:candidate.opportunityId,
    organization:candidate.organization,tradeId:candidate.scopedTradeIds[0]??null,candidateEvidenceType:"AF01_ACCEPTANCE",candidateId:candidate.id,
    candidateValue:candidate.candidateClaim,candidateScope:candidate.scope,candidateGrade:null,
    candidateQuality:scoreAf01CandidateQuality(candidate),sourceUrl:candidate.sourceUrl,provenance:candidate.provenance,
    whyItMatters:"Verified AF-01 external manpower acceptance is mandatory for HOT-A eligibility (MANPOWER_ACCEPTANCE_REQUIRED).",
    affectedCanonicalGate:["G5_EXTERNAL_MANPOWER_ACCEPTANCE","G10_ELIGIBILITY","G13_ACTIVE_HOT"],
    previewImpact:preview,humanDecisionRequired:["VERIFY","REJECT","NEEDS_MORE_EVIDENCE","DEFER"],
  };
}

/* ------------------------------------------------------------------------ */
/* Adding candidates to a closure case (deduplicated, status recomputed)    */
/* ------------------------------------------------------------------------ */

function deriveStatus(candidateCount:number,negativeCount:number,packetCount:number,searchExhausted:boolean):ClosureCaseState{
  if(candidateCount===0)return searchExhausted?"UNRESOLVED":"OPEN";
  if(negativeCount>0&&negativeCount===candidateCount)return"AWAITING_HUMAN_VERIFICATION";
  return packetCount>0?"AWAITING_HUMAN_VERIFICATION":"CANDIDATE_FOUND";
}

export function addContactCandidates(closureCase:ClosureCase,candidates:readonly ContactCandidateEvidence[],evalInput:WorkforceConversionEvaluationInput,budget:AcquisitionBudget=DEFAULT_ACQUISITION_BUDGET,searchExhausted=false):ClosureCase{
  const existing=new Set(closureCase.contactCandidates.map(c=>c.id));
  const merged=[...closureCase.contactCandidates];
  for(const c of candidates){if(existing.has(c.id))continue;if(merged.length>=budget.maxCandidatesPerCase)break;existing.add(c.id);merged.push(c)}
  const packets=merged.map(c=>buildContactVerificationPacket(closureCase.closureCaseId,c,previewContactCandidate(evalInput,c)));
  return{...closureCase,contactCandidates:merged,verificationPackets:packets,status:deriveStatus(merged.length,0,packets.length,searchExhausted)};
}

export function addAf01Candidates(closureCase:ClosureCase,candidates:readonly AF01CandidateEvidence[],evalInput:WorkforceConversionEvaluationInput,budget:AcquisitionBudget=DEFAULT_ACQUISITION_BUDGET,searchExhausted=false):ClosureCase{
  const existing=new Set(closureCase.af01Candidates.map(c=>c.id));
  const merged=[...closureCase.af01Candidates];
  for(const c of candidates){if(existing.has(c.id))continue;if(merged.length>=budget.maxCandidatesPerCase)break;existing.add(c.id);merged.push(c)}
  const packets=merged.map(c=>buildAf01VerificationPacket(closureCase.closureCaseId,c,previewAf01Candidate(evalInput,c)));
  const negativeCount=merged.filter(c=>c.evidenceClass==="NEGATIVE_EVIDENCE").length;
  return{...closureCase,af01Candidates:merged,verificationPackets:packets,status:deriveStatus(merged.length,negativeCount,packets.length,searchExhausted)};
}

/* ------------------------------------------------------------------------ */
/* Human decision handoff (never invented here)                             */
/* ------------------------------------------------------------------------ */

const STATUS_FOR_DECISION:Record<ClosureHumanDecisionInput["decision"],ClosureCaseState>={VERIFY:"VERIFIED_CLOSED",REJECT:"REJECTED",NEEDS_MORE_EVIDENCE:"NEEDS_MORE_EVIDENCE",DEFER:"DEFERRED"};

/** Applies an EXTERNALLY-supplied human decision. Throws if the candidate
 * isn't part of this case or the decision is malformed -- exactly the same
 * discipline the rest of this codebase's human-decision boundaries use. */
export function applyHumanClosureDecision(closureCase:ClosureCase,decision:ClosureHumanDecisionInput):ClosureCase{
  const known=[...closureCase.contactCandidates.map(c=>c.id),...closureCase.af01Candidates.map(c=>c.id)];
  if(!known.includes(decision.candidateId))throw new Error("Decision candidateId does not belong to this closure case");
  if(!decision.reviewerId.trim()||!decision.reason.trim())throw new Error("Reviewer and reason are required");
  return{...closureCase,status:STATUS_FOR_DECISION[decision.decision]};
}

/* ------------------------------------------------------------------------ */
/* Closure desk snapshot                                                    */
/* ------------------------------------------------------------------------ */

export function buildClosureDeskSnapshot(cases:readonly ClosureCase[],topN=5):ClosureDeskSnapshot{
  const contactCases=cases.filter(c=>c.target.targetType==="ACTIONABLE_CONTACT").length;
  const af01Cases=cases.filter(c=>c.target.targetType==="AF01_ACCEPTANCE").length;
  const candidateFound=cases.filter(c=>c.status==="CANDIDATE_FOUND").length;
  const awaitingVerification=cases.filter(c=>c.status==="AWAITING_HUMAN_VERIFICATION").length;
  const unresolved=cases.filter(c=>c.status==="UNRESOLVED").length;
  const negativeEvidence=cases.reduce((n,c)=>n+c.af01Candidates.filter(x=>x.evidenceClass==="NEGATIVE_EVIDENCE").length,0);
  const highImpact=cases.flatMap(c=>c.verificationPackets).filter(p=>p.previewImpact?.wouldBecomeActiveHotA||p.previewImpact?.wouldBecomeActiveHotB).length;
  const sorted=[...cases].sort((a,b)=>{
    const aHigh=a.verificationPackets.some(p=>p.previewImpact?.wouldBecomeActiveHotA||p.previewImpact?.wouldBecomeActiveHotB);
    const bHigh=b.verificationPackets.some(p=>p.previewImpact?.wouldBecomeActiveHotA||p.previewImpact?.wouldBecomeActiveHotB);
    if(aHigh!==bHigh)return aHigh?-1:1;
    return b.verificationPackets.length-a.verificationPackets.length||a.closureCaseId.localeCompare(b.closureCaseId);
  });
  const topClosurePriorities:ClosurePriorityItem[]=sorted.slice(0,topN).map(c=>({
    closureCaseId:c.closureCaseId,organization:c.organization,tradeId:c.tradeId,status:c.status,
    reason:c.verificationPackets.some(p=>p.previewImpact?.wouldBecomeActiveHotA||p.previewImpact?.wouldBecomeActiveHotB)
      ?"Candidate evidence exists that would reach Active HOT if verified."
      :c.verificationPackets.length?`${c.verificationPackets.length} candidate(s) awaiting human verification.`
      :"No candidate evidence yet; search plan remains open.",
  }));
  return{openClosureCases:cases.filter(c=>c.status==="OPEN").length,contactCases,af01Cases,candidateFound,awaitingVerification,unresolved,negativeEvidence,highImpactVerificationItems:highImpact,topClosurePriorities,ruleVersion:COMMERCIAL_EVIDENCE_CLOSURE_RULE_VERSION};
}
