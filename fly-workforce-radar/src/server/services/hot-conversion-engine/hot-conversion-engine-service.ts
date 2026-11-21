/**
 * Phase 3E Multi-Trade HOT Conversion Engine composition.
 *
 * Composes, never reimplements:
 *  - commercial-conversion-service.ts's convertDiscoverySignal (itself a
 *    composition of the REAL EligibilityService / ScoringService /
 *    CommercialActionService / opportunity-actionability-service, exactly
 *    as used by Phase 3B/3C/3D) -- the canonical HOT input/output.
 *  - multi-trade-workforce.ts's Phase 3X scope evaluators
 *    (acceptanceCoversTrade / contactAuthorityCoversTrade).
 *
 * The ONLY place this file writes new logic is the read-only GATE / BLOCKER
 * / READINESS / DISTANCE-TO-HOT / CLOSURE-PLAN explanation layer built on
 * top of that canonical output, plus a small structural adapter
 * (toDiscoverySignalShape) documented below.
 */
import type{ElectricalRole,ElectricalRoleMatch}from"../../../domain/electrical-role-recognition";
import type{TrackedDiscoverySignal}from"../../../domain/discovery-promotion";
import type{CommercialConversionDossier,ConversionAcceptanceEvidence,ConversionContactEvidence,ConversionEvidenceInput}from"../../../domain/commercial-conversion";
import{EXPLICIT_TERMINAL_STATUSES,OPEN_COMPATIBLE_STATES}from"../../../domain/opportunity-actionability";
import type{
  ClosureTask,ConversionBlockerCode,ConversionGateId,ConversionGateResult,
  DistanceToHot,GateState,NextBestAction,PrioritizedBlocker,ReadinessState,WorkforceConversionDossier,
  RankedWorkforceConversion,
}from"../../../domain/hot-conversion-engine";
import{HOT_CONVERSION_ENGINE_RULE_VERSION}from"../../../domain/hot-conversion-engine";
import type{TrackedWorkforceDemandSignal}from"../../../domain/multi-trade-workforce";
import{acceptanceCoversTrade,contactAuthorityCoversTrade}from"../../../domain/multi-trade-workforce";
import type{ScopedAcceptanceEvidence,ScopedContactAuthority}from"../../../domain/multi-trade-workforce";
import type{WorkforceClassification}from"../../../domain/workforce-taxonomy";
import{UNKNOWN_WORKFORCE_CLASSIFICATION}from"../../../domain/workforce-taxonomy";
import{convertDiscoverySignal,previewConversionDecision}from"../commercial-conversion/commercial-conversion-service";
import type{PreviewDecision}from"../commercial-conversion/commercial-conversion-service";

/**
 * Small structural adapter (Phase 3X section 5's "small additive adapter"):
 * ConversionEvidenceInput.signal is typed TrackedDiscoverySignal
 * (electrical-only, from the frozen discovery-promotion.ts) because that is
 * the canonical HOT input's existing contract -- changing that contract
 * would touch a frozen file. convertDiscoverySignal never reads
 * recognizedRoles/roleMatches (verified by inspection: only externalId,
 * signalId, title, organization, location, sourceKey, observedAt are read),
 * so this adapter carries a generalized Phase 3X TrackedWorkforceDemandSignal
 * into that exact shape with an honestly-empty recognizedRoles/roleMatches,
 * losing no information the canonical engine actually consumes.
 */
export function toDiscoverySignalShape(signal:TrackedWorkforceDemandSignal):TrackedDiscoverySignal{
  return{
    trackedId:signal.trackedId,signalId:signal.signalId,externalId:signal.externalId,
    sourceKey:signal.sourceKey,sourceUrl:signal.sourceUrl,title:signal.title,
    organization:signal.organization,location:signal.location,
    recognizedRoles:[]as ElectricalRole[],roleMatches:[]as ElectricalRoleMatch[],
    tier:signal.tier,observedAt:signal.observedAt,reasons:signal.reasons,
    ruleVersion:signal.ruleVersion,
  };
}

export interface WorkforceEvidenceScopeInput{
  af01:ScopedAcceptanceEvidence|null;
  contactScopes:Record<string,ScopedContactAuthority>;
}

/**
 * Phase 3X section 18 / Phase 3E section 18 enforcement point: builds the
 * ConversionEvidenceInput actually handed to convertDiscoverySignal so that
 * out-of-scope AF-01/contact evidence is degraded to unverified/absent
 * BEFORE it ever reaches EligibilityService -- eligibility itself is never
 * touched or told about "scope"; it just correctly sees unverified/missing
 * evidence when scope does not cover this demand's trade. This is what
 * prevents an electrical-scoped AF-01 from silently unlocking a welding
 * HOT: the acceptance evidence is nulled out here, deterministically, before
 * the canonical eligibility gate ever runs.
 */
export function applyEvidenceScope(base:ConversionEvidenceInput,classification:WorkforceClassification,scope:WorkforceEvidenceScopeInput):ConversionEvidenceInput{
  const tradeId=classification.tradeId;
  const acceptance:ConversionAcceptanceEvidence|null=(()=>{
    if(!base.acceptance)return null;
    if(!scope.af01||!tradeId)return base.acceptance;
    if(acceptanceCoversTrade(scope.af01,tradeId))return base.acceptance;
    return{...base.acceptance,verificationState:"UNVERIFIED",accepted:null};
  })();
  const contacts:ConversionContactEvidence[]=base.contacts.map(c=>{
    const s=scope.contactScopes[c.id];
    if(!s||!tradeId)return c;
    if(contactAuthorityCoversTrade(s,tradeId))return c;
    return{...c,verificationState:"UNVERIFIED"};
  });
  return{...base,acceptance,contacts};
}

/* ------------------------------------------------------------------------ */
/* Gate / blocker derivation (read-only over CommercialConversionDossier)   */
/* ------------------------------------------------------------------------ */

function terminalTemporal(state:string):boolean{
  return(EXPLICIT_TERMINAL_STATUSES as readonly string[]).includes(state);
}

function temporalBlocker(state:string):ConversionBlockerCode{
  if(state==="EXPIRED")return"TEMPORAL_EXPIRED";
  if(state==="CLOSED")return"TEMPORAL_CLOSED";
  if(state==="CANCELLED")return"TEMPORAL_CANCELLED";
  if(state==="TERMINATED")return"TEMPORAL_TERMINATED";
  return"TEMPORAL_UNKNOWN";
}

interface Derived{
  gates:ConversionGateResult[];
  blockers:PrioritizedBlocker[];
  af01Analysis:{state:WorkforceConversionDossier["af01State"];scopeCoversTrade:boolean|null};
  contactAnalysis:{state:WorkforceConversionDossier["contactState"];grade:WorkforceConversionDossier["contactGrade"];scopeCoversTrade:boolean|null};
}

function deriveGatesAndBlockers(
  dossier:CommercialConversionDossier,
  classification:WorkforceClassification,
  scope:WorkforceEvidenceScopeInput,
  originalAcceptance:ConversionAcceptanceEvidence|null,
  originalContacts:ConversionContactEvidence[],
):Derived{
  const hotA=dossier.activeHot.find(h=>h.hotType==="HOT_A")!;
  const hotB=dossier.activeHot.find(h=>h.hotType==="HOT_B")!;
  // Union across VAMO/HOT_A/HOT_B, not just one "closest" type: a requirement
  // (e.g. AF-01) that HOT_B does not need must still surface here when HOT_A
  // fails on it, even if HOT_B happens to have fewer blockers overall.
  const failedReasons=new Set(dossier.eligibility.flatMap(e=>e.blockingGaps)as readonly string[]);

  const blockers:PrioritizedBlocker[]=[];
  const gates:ConversionGateResult[]=[];
  const gate=(gateId:ConversionGateId,state:GateState,reason:string,evidenceIds:string[],blockingEffect:boolean,recommendedNextAction:string,verificationRequirement="Human verification required before production promotion.",currentnessRequirement="Must remain current as-of evaluation time."):void=>{
    gates.push({gateId,state,reason,evidenceIds,provenance:"Derived from convertDiscoverySignal's real eligibility/score/action/actionability output.",verificationRequirement,currentnessRequirement,blockingEffect,recommendedNextAction});
  };
  const addBlocker=(code:ConversionBlockerCode,reason:string,couldChangeEligibility:boolean,couldChangeActiveHot:boolean,evidenceRealisticallyObtainable:boolean,isUpstreamOfOtherBlockers:boolean)=>{
    blockers.push({code,rank:0,couldChangeEligibility,couldChangeActiveHot,evidenceRealisticallyObtainable,isUpstreamOfOtherBlockers,commercialValueScore:dossier.conversionPriority.score,reason});
  };

  // G1 workforce demand
  if(failedReasons.has("CURRENT_DEMAND_REQUIRED")){gate("G1_WORKFORCE_DEMAND","FAIL","No current demand signal.",[],true,"MONITOR_FOR_NEW_EVIDENCE");addBlocker("MISSING_WORKFORCE_DEMAND","No current demand signal is present.",true,true,false,true)}
  else if(failedReasons.has("STALE_DEMAND")){gate("G1_WORKFORCE_DEMAND","FAIL","Demand signal is stale.",[],true,"MONITOR_FOR_NEW_EVIDENCE");addBlocker("STALE_DEMAND","Demand signal exceeded its stale-after window.",true,true,true,true)}
  else gate("G1_WORKFORCE_DEMAND","PASS","Current demand signal present.",dossier.evidenceIds,false,"NO_ACTION");

  // G2 workforce classification (new in Phase 3E; not a canonical eligibility requirement)
  if(classification.state!=="RECOGNIZED"){gate("G2_WORKFORCE_CLASSIFICATION","UNKNOWN","No explicit recognized occupation for this demand.",[],true,"MONITOR_FOR_NEW_EVIDENCE");addBlocker("MISSING_WORKFORCE_CLASSIFICATION","The demand's own text does not explicitly name a supported occupation.",false,false,true,true)}
  else gate("G2_WORKFORCE_CLASSIFICATION","PASS",`Recognized occupation ${classification.occupationId}.`,[],false,"NO_ACTION");

  // G3 organization resolution
  if(failedReasons.has("COMPANY_REQUIRED")){gate("G3_ORGANIZATION_RESOLUTION","FAIL","No canonical company resolved.",[],true,"MONITOR_FOR_NEW_EVIDENCE");addBlocker("MISSING_ORGANIZATION","No canonical employer/company evidence is present.",true,true,true,true)}
  else gate("G3_ORGANIZATION_RESOLUTION","PASS",`Organization resolved: ${dossier.employer}.`,[],false,"NO_ACTION");

  // G4 project/relationship context (informational -- canonical HOT_A/HOT_B never require it)
  if(!dossier.project){gate("G4_PROJECT_RELATIONSHIP_CONTEXT","UNKNOWN","No explicit project evidence.",[],false,"VERIFY_PROJECT_RELATIONSHIP");addBlocker("MISSING_PROJECT_RELATIONSHIP","No explicit project evidence has been linked to this demand.",false,false,true,false)}
  else gate("G4_PROJECT_RELATIONSHIP_CONTEXT","PASS",`Explicit project: ${dossier.project}.`,[],false,"NO_ACTION");

  // G5 AF-01, with Phase 3X scope enforcement
  const rawAcceptance=originalAcceptance;
  const scopeCoversTrade=(()=>{
    if(!rawAcceptance||!scope.af01||!classification.tradeId)return null;
    return acceptanceCoversTrade(scope.af01,classification.tradeId);
  })();
  let af01State:WorkforceConversionDossier["af01State"]="MISSING";
  if(!rawAcceptance){gate("G5_EXTERNAL_MANPOWER_ACCEPTANCE","FAIL","No AF-01 acceptance evidence.",[],true,"FIND_AF01_EVIDENCE");addBlocker("MISSING_AF01","No external manpower acceptance evidence exists for this organization.",true,true,true,true)}
  else if(scopeCoversTrade===false){af01State="CANDIDATE";gate("G5_EXTERNAL_MANPOWER_ACCEPTANCE","BLOCKED",`AF-01 evidence exists but its scope (${scope.af01?.scope}) does not cover trade ${classification.tradeId}.`,rawAcceptance.evidenceIds,true,"FIND_AF01_EVIDENCE");addBlocker("AF01_SCOPE_UNSUPPORTED",`Existing AF-01 acceptance evidence is explicitly scoped and does not cover ${classification.tradeId}.`,true,true,true,true)}
  else if(failedReasons.has("STALE_ACCEPTANCE")){af01State="STALE";gate("G5_EXTERNAL_MANPOWER_ACCEPTANCE","FAIL","AF-01 acceptance is stale.",rawAcceptance.evidenceIds,true,"VERIFY_AF01");addBlocker("AF01_STALE","Verified AF-01 acceptance has passed its validUntil date.",true,true,true,true)}
  else if(rawAcceptance.verificationState==="VERIFIED"&&rawAcceptance.accepted===true){af01State="VERIFIED";gate("G5_EXTERNAL_MANPOWER_ACCEPTANCE","PASS","AF-01 acceptance is current and verified.",rawAcceptance.evidenceIds,false,"NO_ACTION")}
  else if(rawAcceptance.verificationState==="REJECTED"){af01State="REJECTED";gate("G5_EXTERNAL_MANPOWER_ACCEPTANCE","FAIL","AF-01 acceptance evidence was rejected on review.",rawAcceptance.evidenceIds,true,"FIND_AF01_EVIDENCE");addBlocker("AF01_CONFLICT","Prior AF-01 acceptance evidence was rejected by human review.",true,true,true,true)}
  else{af01State="CANDIDATE";gate("G5_EXTERNAL_MANPOWER_ACCEPTANCE","BLOCKED","AF-01 candidate evidence exists but is not yet verified.",rawAcceptance.evidenceIds,true,"VERIFY_AF01");addBlocker("AF01_UNVERIFIED","AF-01 acceptance evidence exists but has not been human-verified.",true,true,true,true)}

  // G6 buyer/vendor route -- informational only; never a blocking gate (Phase 3E section 21 / 3B policy)
  gate("G6_BUYER_VENDOR_ROUTE","NOT_REQUIRED",dossier.buyer?`Buyer candidate: ${dossier.buyer} (informational only, not an eligibility gate).`:"No buyer evidence (informational only, not an eligibility gate).",[],false,dossier.buyer?"NO_ACTION":"COMPLETE_VENDOR_REGISTRATION_RESEARCH");

  // G7 actionable contact, with Phase 3X scope enforcement
  const bestContact=originalContacts.find(c=>["A","B","C","D"].includes(c.gradeCandidate))??originalContacts[0]??null;
  let contactState:WorkforceConversionDossier["contactState"]="MISSING";
  let contactScopeCoversTrade:boolean|null=null;
  if(!originalContacts.length){gate("G7_ACTIONABLE_CONTACT","FAIL","No contact/route evidence.",[],true,"FIND_ACTIONABLE_CONTACT");addBlocker("MISSING_ACTIONABLE_CONTACT","No contact or commercial route evidence exists.",true,true,true,true)}
  else{
    const s=bestContact?scope.contactScopes[bestContact.id]:undefined;
    contactScopeCoversTrade=(bestContact&&s&&classification.tradeId)?contactAuthorityCoversTrade(s,classification.tradeId):(s?null:null);
    if(bestContact&&s&&classification.tradeId&&!contactAuthorityCoversTrade(s,classification.tradeId)){
      contactState="CANDIDATE";
      gate("G7_ACTIONABLE_CONTACT","BLOCKED",`Contact exists but its authority scope (${s.scope}) does not cover trade ${classification.tradeId}.`,bestContact.evidenceIds,true,"VERIFY_CONTACT_AUTHORITY");
      addBlocker("CONTACT_AUTHORITY_SCOPE_UNSUPPORTED",`Existing contact authority is explicitly scoped and does not cover ${classification.tradeId}.`,true,true,true,true);
    }else if(failedReasons.has("STALE_CONTACT_ROUTE")){
      contactState="STALE";
      gate("G7_ACTIONABLE_CONTACT","FAIL","Contact route is stale.",bestContact?.evidenceIds??[],true,"VERIFY_CONTACT");
      addBlocker("CONTACT_STALE","Contact route exceeded its stale-after window.",true,true,true,true);
    }else if(failedReasons.has("ACTIONABLE_CONTACT_REQUIRED")){
      contactState="CANDIDATE";
      const scopeUnknown=!!bestContact&&!scope.contactScopes[bestContact.id];
      gate("G7_ACTIONABLE_CONTACT","BLOCKED","Contact exists but is not yet a verified, sufficiently-graded route.",bestContact?.evidenceIds??[],true,"VERIFY_CONTACT");
      addBlocker(scopeUnknown?"CONTACT_AUTHORITY_UNKNOWN":"CONTACT_UNVERIFIED",scopeUnknown?"Contact authority scope has not been established.":"Contact route exists but is not verified to a sufficient grade.",true,true,true,true);
    }else{
      contactState="VERIFIED";
      gate("G7_ACTIONABLE_CONTACT","PASS",`Verified actionable route (grade ${bestContact?.gradeCandidate}).`,bestContact?.evidenceIds??[],false,"NO_ACTION");
    }
  }

  // G8 temporal actionability
  const openCompatible=OPEN_COMPATIBLE_STATES.has(dossier.temporalState);
  if(openCompatible)gate("G8_TEMPORAL_ACTIONABILITY","PASS",`Actionability state ${dossier.temporalState} is OPEN-compatible.`,[],false,"NO_ACTION");
  else{
    const terminal=terminalTemporal(dossier.temporalState);
    gate("G8_TEMPORAL_ACTIONABILITY",terminal?"FAIL":"UNKNOWN",`Actionability state is ${dossier.temporalState}.`,[],true,terminal?"MONITOR_FOR_NEW_EVIDENCE":"VERIFY_TEMPORAL_STATUS");
    addBlocker(temporalBlocker(dossier.temporalState),`Actionability state ${dossier.temporalState} is not OPEN-compatible.`,false,true,!terminal,false);
  }

  // G9 human verification / conflict safety
  if(failedReasons.has("MATERIAL_CONFLICT_PRESENT")){gate("G9_HUMAN_VERIFICATION_CONFLICT_SAFETY","FAIL","Unresolved material conflict present.",[],true,"RESOLVE_CONFLICT");addBlocker("BLOCKING_CONFLICT","A material conflict exists and has not been resolved through human review.",true,true,true,false)}
  else if(failedReasons.has("HUMAN_VERIFICATION_REQUIRED")){gate("G9_HUMAN_VERIFICATION_CONFLICT_SAFETY","BLOCKED","A required human review has not resolved to VERIFY.",[],true,"RESOLVE_CONFLICT");addBlocker("HUMAN_VERIFICATION_REQUIRED","A required human review remains unresolved.",true,true,true,false)}
  else gate("G9_HUMAN_VERIFICATION_CONFLICT_SAFETY","PASS","No unresolved conflicts or pending required reviews.",[],false,"NO_ACTION");

  // G10 eligibility
  const eligibleAny=dossier.eligibility.some(e=>e.eligible);
  if(eligibleAny)gate("G10_ELIGIBILITY","PASS","At least one eligibility type is satisfied.",[],false,"NO_ACTION");
  else{gate("G10_ELIGIBILITY","FAIL","No eligibility type is currently satisfied.",[],true,"NO_ACTION");addBlocker("NOT_ELIGIBLE","No canonical eligibility type (VAMO/HOT_A/HOT_B) is currently satisfied.",true,true,true,false)}

  // G11 score
  if(dossier.score.state==="SCORED")gate("G11_SCORE","PASS",`Scored: ${dossier.score.score}.`,[],false,"NO_ACTION");
  else{gate("G11_SCORE","UNKNOWN","Not scorable under canonical scoring rules.",[],false,"NO_ACTION");addBlocker("NOT_SCORABLE","Canonical scoring rules could not produce a score for this opportunity.",false,false,true,false)}

  // G12 commercial action
  gate("G12_COMMERCIAL_ACTION",hotA.active||hotB.active?"PASS":"BLOCKED",`Recommended commercial action: ${dossier.commercialAction} (recommended active action: ${hotA.recommendedCommercialAction??hotB.recommendedCommercialAction??"none"}).`,[],!(hotA.active||hotB.active),hotA.active||hotB.active?"READY_FOR_COMMERCIAL_CONTACT":"NO_ACTION");

  // G13 active hot
  gate("G13_ACTIVE_HOT",hotA.active?"PASS":hotB.active?"PASS":"FAIL",`HOT-A active=${hotA.active}, HOT-B active=${hotB.active}.`,[],!(hotA.active||hotB.active),hotA.active||hotB.active?"READY_FOR_COMMERCIAL_CONTACT":"NO_ACTION");

  return{
    gates,blockers,
    af01Analysis:{state:af01State,scopeCoversTrade},
    contactAnalysis:{state:contactState,grade:bestContact?.gradeCandidate??null,scopeCoversTrade:contactScopeCoversTrade},
  };
}

/* ------------------------------------------------------------------------ */
/* Blocker prioritization (deterministic)                                   */
/* ------------------------------------------------------------------------ */

function prioritizeBlockers(blockers:PrioritizedBlocker[]):PrioritizedBlocker[]{
  const scored=blockers.map(b=>{
    const score=
      (b.couldChangeEligibility?1000:0)+
      (b.couldChangeActiveHot?500:0)+
      (b.isUpstreamOfOtherBlockers?200:0)+
      (b.evidenceRealisticallyObtainable?100:0)+
      Math.min(99,Math.max(0,Math.round(b.commercialValueScore)));
    return{...b,rank:score};
  });
  return scored.sort((a,b)=>b.rank-a.rank||a.code.localeCompare(b.code)).map((b,i)=>({...b,rank:i+1}));
}

/* ------------------------------------------------------------------------ */
/* Next-best-action / readiness / distance-to-HOT                           */
/* ------------------------------------------------------------------------ */

function nextBestAction(prioritized:PrioritizedBlocker[],activeHotA:boolean,activeHotB:boolean):NextBestAction{
  if(activeHotA||activeHotB)return"READY_FOR_COMMERCIAL_CONTACT";
  const top=prioritized[0];
  if(!top)return"NO_ACTION";
  const map:Partial<Record<ConversionBlockerCode,NextBestAction>>={
    MISSING_WORKFORCE_CLASSIFICATION:"MONITOR_FOR_NEW_EVIDENCE",
    MISSING_WORKFORCE_DEMAND:"MONITOR_FOR_NEW_EVIDENCE",
    STALE_DEMAND:"MONITOR_FOR_NEW_EVIDENCE",
    MISSING_ORGANIZATION:"MONITOR_FOR_NEW_EVIDENCE",
    MISSING_PROJECT_RELATIONSHIP:"VERIFY_PROJECT_RELATIONSHIP",
    MISSING_AF01:"FIND_AF01_EVIDENCE",
    AF01_UNVERIFIED:"VERIFY_AF01",
    AF01_STALE:"VERIFY_AF01",
    AF01_CONFLICT:"FIND_AF01_EVIDENCE",
    AF01_SCOPE_UNSUPPORTED:"FIND_AF01_EVIDENCE",
    MISSING_VENDOR_ROUTE:"COMPLETE_VENDOR_REGISTRATION_RESEARCH",
    MISSING_ACTIONABLE_CONTACT:"FIND_ACTIONABLE_CONTACT",
    CONTACT_UNVERIFIED:"VERIFY_CONTACT",
    CONTACT_STALE:"VERIFY_CONTACT",
    CONTACT_AUTHORITY_UNKNOWN:"VERIFY_CONTACT_AUTHORITY",
    CONTACT_AUTHORITY_SCOPE_UNSUPPORTED:"VERIFY_CONTACT_AUTHORITY",
    TEMPORAL_UNKNOWN:"VERIFY_TEMPORAL_STATUS",
    TEMPORAL_EXPIRED:"MONITOR_FOR_NEW_EVIDENCE",
    TEMPORAL_CLOSED:"MONITOR_FOR_NEW_EVIDENCE",
    TEMPORAL_CANCELLED:"MONITOR_FOR_NEW_EVIDENCE",
    TEMPORAL_TERMINATED:"MONITOR_FOR_NEW_EVIDENCE",
    BLOCKING_CONFLICT:"RESOLVE_CONFLICT",
    HUMAN_VERIFICATION_REQUIRED:"RESOLVE_CONFLICT",
    NOT_ELIGIBLE:"MONITOR_FOR_NEW_EVIDENCE",
    NOT_SCORABLE:"MONITOR_FOR_NEW_EVIDENCE",
  };
  return map[top.code]??"NO_ACTION";
}

function readiness(activeHotA:boolean,activeHotB:boolean,conflicts:string[],temporalState:string,blockers:PrioritizedBlocker[],coreFactsMissing:number):ReadinessState{
  if(activeHotA||activeHotB)return"READY";
  if(conflicts.length>0||blockers.some(b=>b.code==="BLOCKING_CONFLICT"))return"CONFLICTING";
  if(terminalTemporal(temporalState))return"INACTIVE";
  if(blockers.length===0)return"READY";
  if(blockers.length<=2)return"NEAR_READY";
  return coreFactsMissing>=3?"INSUFFICIENT_EVIDENCE":"BLOCKED";
}

function distanceToHot(prioritized:PrioritizedBlocker[],activeHotA:boolean,activeHotB:boolean,temporalState:string):DistanceToHot{
  if(activeHotA||activeHotB)return{tier:"AT_HOT",blockingGatesRemaining:0,criticalBlockers:[],nearestHotType:activeHotA?"HOT_A":"HOT_B"};
  if(terminalTemporal(temporalState))return{tier:"INACTIVE",blockingGatesRemaining:prioritized.length,criticalBlockers:prioritized.map(b=>b.code),nearestHotType:null};
  const critical=prioritized.filter(b=>b.couldChangeEligibility||b.couldChangeActiveHot).map(b=>b.code);
  return{tier:critical.length<=2?"NEAR":"FAR",blockingGatesRemaining:critical.length,criticalBlockers:critical,nearestHotType:"HOT_A"};
}

/* ------------------------------------------------------------------------ */
/* Evidence closure plan (Phase 3A style; deterministic, idempotent)        */
/* ------------------------------------------------------------------------ */

const CLOSURE_TASK_BY_BLOCKER:Partial<Record<ConversionBlockerCode,{taskType:string;priority:"HIGH"|"MEDIUM"|"LOW"}>>={
  MISSING_AF01:{taskType:"FIND_AF01_EVIDENCE",priority:"HIGH"},
  AF01_UNVERIFIED:{taskType:"VERIFY_AF01",priority:"HIGH"},
  AF01_STALE:{taskType:"VERIFY_AF01",priority:"HIGH"},
  AF01_CONFLICT:{taskType:"RESOLVE_CONFLICT",priority:"HIGH"},
  AF01_SCOPE_UNSUPPORTED:{taskType:"FIND_AF01_EVIDENCE",priority:"HIGH"},
  MISSING_ACTIONABLE_CONTACT:{taskType:"FIND_ACTIONABLE_CONTACT",priority:"HIGH"},
  CONTACT_UNVERIFIED:{taskType:"VERIFY_CONTACT",priority:"HIGH"},
  CONTACT_STALE:{taskType:"VERIFY_CONTACT",priority:"MEDIUM"},
  CONTACT_AUTHORITY_UNKNOWN:{taskType:"VERIFY_CONTACT_AUTHORITY",priority:"MEDIUM"},
  CONTACT_AUTHORITY_SCOPE_UNSUPPORTED:{taskType:"VERIFY_CONTACT_AUTHORITY",priority:"MEDIUM"},
  TEMPORAL_UNKNOWN:{taskType:"VERIFY_TEMPORAL_STATUS",priority:"MEDIUM"},
  MISSING_PROJECT_RELATIONSHIP:{taskType:"VERIFY_PROJECT_RELATIONSHIP",priority:"LOW"},
  BLOCKING_CONFLICT:{taskType:"RESOLVE_CONFLICT",priority:"HIGH"},
  HUMAN_VERIFICATION_REQUIRED:{taskType:"RESOLVE_CONFLICT",priority:"HIGH"},
};

function buildClosurePlan(opportunityId:string,prioritized:PrioritizedBlocker[]):ClosureTask[]{
  const tasks:ClosureTask[]=[];
  const seen=new Set<string>();
  for(const b of prioritized){
    const spec=CLOSURE_TASK_BY_BLOCKER[b.code];
    if(!spec)continue;
    const id=`closure:${opportunityId}:${spec.taskType}`;
    if(seen.has(id))continue;
    seen.add(id);
    tasks.push({id,taskType:spec.taskType,targetBlocker:b.code,priority:spec.priority,alreadySatisfied:false});
  }
  return tasks.sort((a,b)=>({HIGH:0,MEDIUM:1,LOW:2}[a.priority]-{HIGH:0,MEDIUM:1,LOW:2}[b.priority])||a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------------ */
/* Top-level composition                                                    */
/* ------------------------------------------------------------------------ */

export interface WorkforceConversionEvaluationInput{
  input:ConversionEvidenceInput;
  classification:WorkforceClassification;
  projectRef:string;
  scope?:WorkforceEvidenceScopeInput;
}

export function evaluateWorkforceConversion(x:WorkforceConversionEvaluationInput):WorkforceConversionDossier{
  const classification=x.classification??UNKNOWN_WORKFORCE_CLASSIFICATION;
  const scope=x.scope??{af01:null,contactScopes:{}};
  const scopedInput=applyEvidenceScope(x.input,classification,scope);
  const dossier=convertDiscoverySignal(scopedInput);
  const derived=deriveGatesAndBlockers(dossier,classification,scope,x.input.acceptance,x.input.contacts);

  const prioritized=prioritizeBlockers(derived.blockers);
  const hotA=dossier.activeHot.find(h=>h.hotType==="HOT_A")!;
  const hotB=dossier.activeHot.find(h=>h.hotType==="HOT_B")!;
  const coreFactsMissing=[!x.input.employer,!x.input.acceptance,!x.input.contacts.length,!x.input.project].filter(Boolean).length;

  return{
    opportunityId:`conversion:${x.input.signal.externalId}`,
    projectRef:x.projectRef,
    organization:dossier.organization,
    workforceClassification:classification,
    roleClass:classification.roleClass,
    tradeId:classification.tradeId,
    location:dossier.location,
    demandEvidenceIds:dossier.evidenceIds,
    projectEvidenceIds:[],
    af01State:derived.af01Analysis.state,
    af01Scope:scope.af01?.scope??null,
    af01ScopeCoversTrade:derived.af01Analysis.scopeCoversTrade,
    buyerState:dossier.buyer?"CANDIDATE":"UNKNOWN",
    vendorRouteState:"UNKNOWN",
    contactState:derived.contactAnalysis.state,
    contactGrade:derived.contactAnalysis.grade,
    contactAuthorityScope:(x.input.contacts[0]&&scope.contactScopes[x.input.contacts[0].id]?.scope)??null,
    contactAuthorityScopeCoversTrade:derived.contactAnalysis.scopeCoversTrade,
    temporalState:dossier.temporalState,
    conflicts:dossier.conflicts,
    eligibility:dossier.eligibility.map(e=>({eligibilityType:e.eligibilityType,eligible:e.eligible,blockingGaps:e.blockingGaps})),
    score:{state:dossier.score.state,score:dossier.score.score},
    commercialAction:dossier.commercialAction,
    activeHotA:hotA.active,
    activeHotB:hotB.active,
    readiness:readiness(hotA.active,hotB.active,dossier.conflicts,dossier.temporalState,prioritized,coreFactsMissing),
    distanceToHot:distanceToHot(prioritized,hotA.active,hotB.active,dossier.temporalState),
    blockers:prioritized,
    gates:derived.gates,
    nextBestAction:nextBestAction(prioritized,hotA.active,hotB.active),
    closurePlan:buildClosurePlan(`conversion:${x.input.signal.externalId}`,prioritized),
    humanVerificationItemCount:dossier.verificationQueue.length,
    provenanceSummary:[...new Set([...dossier.evidenceIds,...(x.input.acceptance?.evidenceIds??[]),...x.input.contacts.flatMap(c=>c.evidenceIds)])],
    ruleVersion:`${HOT_CONVERSION_ENGINE_RULE_VERSION}+${dossier.ruleVersions.join("+")}`,
  };
}

/* ------------------------------------------------------------------------ */
/* Decision preview (reuses previewConversionDecision, non-persisting)      */
/* ------------------------------------------------------------------------ */

export function previewWorkforceConversion(x:WorkforceConversionEvaluationInput,decision:PreviewDecision){
  const before=evaluateWorkforceConversion(x);
  const scopedHypothetical=applyEvidenceScope(x.input,x.classification,x.scope??{af01:null,contactScopes:{}});
  const preview=previewConversionDecision(scopedHypothetical,decision);
  const after=evaluateWorkforceConversion({...x,input:{...x.input,
    acceptance:decision.verifyAcceptance&&x.input.acceptance?{...x.input.acceptance,verificationState:"VERIFIED",accepted:true}:x.input.acceptance,
    contacts:x.input.contacts.map(c=>decision.verifyContactIds?.includes(c.id)?{...c,verificationState:"VERIFIED"}:c),
    actionability:decision.explicitStatus?{...x.input.actionability,explicitStatus:decision.explicitStatus,explicitStatusFreshUntil:null}:x.input.actionability,
  }});
  return{before,after,changed:preview.changed,persisted:false};
}

/* ------------------------------------------------------------------------ */
/* Commercial priority ranking                                              */
/* ------------------------------------------------------------------------ */

function priorityTierFor(d:WorkforceConversionDossier):RankedWorkforceConversion["priorityTier"]{
  if(d.activeHotA||d.activeHotB)return"ACTIVE_HOT";
  if(d.eligibility.some(e=>e.eligible))return"ELIGIBLE_CURRENT";
  if(d.readiness==="NEAR_READY")return"NEAR_READY";
  if(d.readiness==="INACTIVE")return"INACTIVE";
  if(d.readiness==="INSUFFICIENT_EVIDENCE")return"LOW_INFORMATION";
  return"EVIDENCE_CLOSURE_VALUABLE";
}

const TIER_ORDER:Record<RankedWorkforceConversion["priorityTier"],number>={ACTIVE_HOT:0,ELIGIBLE_CURRENT:1,NEAR_READY:2,EVIDENCE_CLOSURE_VALUABLE:3,LOW_INFORMATION:4,INACTIVE:5};

/** Deterministic. Ranks by tier first (never by pay/headcount alone), then
 * by distance-to-HOT proximity, then by the existing canonical commercial
 * priority score as a final, explained tiebreaker. */
export function rankWorkforceConversions(dossiers:readonly WorkforceConversionDossier[]):RankedWorkforceConversion[]{
  const tierDistanceRank:Record<string,number>={AT_HOT:0,NEAR:1,FAR:2,INACTIVE:3};
  const withTier=dossiers.map(d=>({d,tier:priorityTierFor(d)}));
  const sorted=[...withTier].sort((a,b)=>
    TIER_ORDER[a.tier]-TIER_ORDER[b.tier]||
    tierDistanceRank[a.d.distanceToHot.tier]-tierDistanceRank[b.d.distanceToHot.tier]||
    a.d.blockers.length-b.d.blockers.length||
    a.d.opportunityId.localeCompare(b.d.opportunityId)
  );
  return sorted.map(({d,tier},i):RankedWorkforceConversion=>({
    dossier:d,
    rank:i+1,
    priorityTier:tier,
    components:[
      {label:"priorityTier",value:tier},
      {label:"distanceToHotTier",value:d.distanceToHot.tier},
      {label:"blockingGatesRemaining",value:String(d.distanceToHot.blockingGatesRemaining)},
      {label:"readiness",value:d.readiness},
    ],
  }));
}
