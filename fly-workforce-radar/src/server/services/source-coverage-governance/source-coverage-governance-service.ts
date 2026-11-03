/**
 * Phase 3H Source Onboarding & Coverage Expansion composition.
 *
 * Composes, never reimplements:
 *  - production-source.ts / production-source-policy.ts's SourceFamily,
 *    SourceCapability, SourceReadinessState, ProductionHealthState,
 *    deterministicSourceIdentity, nextHealth, structuredFailure (Phase 2) --
 *    source identity, capability vocabulary, readiness lifecycle, and health
 *    state machine are ALL reused verbatim, never re-encoded here.
 *  - commercial-evidence-closure-service.ts's matchEntity (Phase 3G) for
 *    entity safety -- the same "no fuzzy merge" rule, never a second
 *    implementation.
 *
 * This file's only new logic is: deriving coverage gaps from real Phase 3G
 * closure cases, classifying source-family/capability -> evidence-type
 * compatibility, and the deterministic usability/coverage-state/selection
 * logic Phase 3G needs -- all ending at a human approval decision that is
 * never invented here.
 */
import type{ClosureCase,ClosureTargetType}from"../../../domain/commercial-evidence-closure";
import{matchEntity}from"../commercial-evidence-closure/commercial-evidence-closure-service";
import type{ProductionHealthState,SourceCapability,SourceFamily,SourceReadinessState}from"../../../domain/production-source";
import{deterministicSourceIdentity}from"../production-source/production-source-policy";
import type{TradeId}from"../../../domain/workforce-taxonomy";
import type{
  BlockedSourceItem,CoverageGap,CoverageGapState,CoveragePreviewResult,CoveragePriorityItem,CoverageState,
  DiscoveryBudget,DiscoveryStrategy,SourceAccessProfile,SourceApprovalDecisionInput,SourceApprovalPacket,
  SourceApprovalRecord,SourceAssessmentStatus,SourceCandidate,SourceCoverageDeskSnapshot,
  SourceOwnershipType,SourceQuality,SourceTradeScope,SourceUsability,SourceUsabilityQuery,SourceUsabilityResult,
}from"../../../domain/source-coverage-governance";
import{
  DEFAULT_DISCOVERY_BUDGET,SOURCE_COVERAGE_GOVERNANCE_RULE_VERSION,
}from"../../../domain/source-coverage-governance";

/* ------------------------------------------------------------------------ */
/* Coverage gap derivation (from real Phase 3G closure cases only)          */
/* ------------------------------------------------------------------------ */

export function coverageGapId(organization:string,evidenceType:ClosureTargetType):string{
  return`coverage:${organization}:${evidenceType}`;
}

const REQUIRED_CAPABILITIES:Record<ClosureTargetType,SourceCapability[]>={
  ACTIONABLE_CONTACT:["CONTACT_PERSON","CONTACT_ROUTE"],
  AF01_ACCEPTANCE:["AF01_ACCEPTANCE_EVIDENCE"],
};

/** A source "usable" readiness for real acquisition -- mirrors canExecuteLive's
 * own gate (production-source-policy.ts) without re-deriving it, since this
 * layer only asks a yes/no question about readiness, never schedules. */
const USABLE_READINESS=new Set<SourceReadinessState>(["APPROVED_FOR_LIVE_CAPTURE"]);
const BLOCKED_HEALTH=new Set<ProductionHealthState>(["BLOCKED","FAILING"]);
const STALE_HEALTH=new Set<ProductionHealthState>(["STALE"]);

function organizationMatches(record:SourceApprovalRecord,organization:string):boolean{
  return record.organizationScope==="GLOBAL_SOURCE_FAMILY"||matchEntity(record.organization,organization)==="MATCH";
}

function recordsForOrganization(records:readonly SourceApprovalRecord[],organization:string):SourceApprovalRecord[]{
  return records.filter(r=>organizationMatches(r,organization));
}

/** Classifies one (organization, evidenceType) coverage gap against the
 * current approved-source registry. Never returns SUFFICIENT_COVERAGE from
 * deriveCoverageGaps -- a fully-covered organization is not a gap. */
function classifyGapState(organization:string,evidenceType:ClosureTargetType,records:readonly SourceApprovalRecord[],requiredCapabilities:readonly SourceCapability[],closureCasesForGap:readonly ClosureCase[]):CoverageGapState{
  const orgRecords=recordsForOrganization(records,organization);
  if(orgRecords.length===0)return"NO_APPROVED_SOURCE";
  const evidenceApproved=orgRecords.filter(r=>r.approvedEvidenceTypes.includes(evidenceType));
  if(evidenceApproved.length===0)return"APPROVED_SOURCE_NO_CAPABILITY";
  const capable=evidenceApproved.filter(r=>requiredCapabilities.some(c=>r.approvedCapabilities.includes(c)));
  if(capable.length===0)return"APPROVED_SOURCE_NO_CAPABILITY";
  const healthy=capable.filter(r=>!BLOCKED_HEALTH.has(r.health)&&USABLE_READINESS.has(r.readiness));
  if(healthy.length===0)return"APPROVED_SOURCE_BLOCKED";
  if(healthy.every(r=>STALE_HEALTH.has(r.health)))return"APPROVED_SOURCE_STALE";
  const hasEvidence=closureCasesForGap.some(c=>c.target.targetType===evidenceType&&(c.contactCandidates.length>0||c.af01Candidates.length>0));
  if(!hasEvidence&&closureCasesForGap.some(c=>c.target.targetType===evidenceType&&c.status==="UNRESOLVED"))return"APPROVED_SOURCE_NO_EVIDENCE";
  return"SUFFICIENT_COVERAGE";
}

/** Derives coverage gaps ONLY from real Phase 3G closure cases (never
 * invented) that are not yet SUFFICIENT_COVERAGE. One gap per
 * (organization, evidenceType) pair, matching Phase 3G's one-case-per-target
 * discipline. */
export function deriveCoverageGaps(closureCases:readonly ClosureCase[],registry:readonly SourceApprovalRecord[]=[]):CoverageGap[]{
  const byKey=new Map<string,{organization:string;evidenceType:ClosureTargetType;cases:ClosureCase[]}>();
  for(const c of closureCases){
    if(!c.organization)continue;
    const key=`${c.organization} ${c.target.targetType}`;
    const entry=byKey.get(key)??{organization:c.organization,evidenceType:c.target.targetType,cases:[]};
    entry.cases.push(c);
    byKey.set(key,entry);
  }
  const gaps:CoverageGap[]=[];
  for(const{organization,evidenceType,cases}of byKey.values()){
    const requiredCapabilities=REQUIRED_CAPABILITIES[evidenceType];
    const status=classifyGapState(organization,evidenceType,registry,requiredCapabilities,cases);
    if(status==="SUFFICIENT_COVERAGE")continue;
    const orgRecords=recordsForOrganization(registry,organization);
    gaps.push({
      coverageGapId:coverageGapId(organization,evidenceType),
      organization,
      opportunityIds:[...new Set(cases.map(c=>c.opportunityId))],
      closureCaseIds:cases.map(c=>c.closureCaseId),
      tradeScopes:[...new Set(cases.map(c=>c.tradeId).filter((t):t is TradeId=>t!==null))],
      missingEvidenceTypes:[evidenceType],
      requiredCapabilities,
      existingApprovedSourceIds:orgRecords.map(r=>r.sourceId),
      attemptedSourceIds:[],
      blockedSourceIds:orgRecords.filter(r=>BLOCKED_HEALTH.has(r.health)).map(r=>r.sourceId),
      coverageStatus:status,
      priority:cases.length,
      provenanceRefs:cases.flatMap(c=>c.provenanceRefs),
    });
  }
  return gaps.sort((a,b)=>b.priority-a.priority||a.coverageGapId.localeCompare(b.coverageGapId));
}

/* ------------------------------------------------------------------------ */
/* Evidence-type compatibility (assessment only -- never proof)             */
/* ------------------------------------------------------------------------ */

export const EVIDENCE_TYPE_COMPATIBILITY_LEVELS=["COMPATIBLE","POSSIBLE","INCOMPATIBLE"]as const;
export type EvidenceTypeCompatibilityLevel=(typeof EVIDENCE_TYPE_COMPATIBILITY_LEVELS)[number];

/** "Compatible" is checked directly; a supplier/vendor-route or staffing
 * capability is only ever "possible" for AF-01 (section 12: a supplier
 * portal supports VENDOR_ROUTE, it must never automatically be considered
 * sufficient for AF-01). Nothing is ever auto-upgraded from POSSIBLE to
 * COMPATIBLE by this function -- that upgrade only happens via human
 * approval attaching AF01_ACCEPTANCE_EVIDENCE explicitly (section 33). */
export function evidenceTypeCompatibility(capabilities:readonly SourceCapability[],evidenceType:ClosureTargetType):EvidenceTypeCompatibilityLevel{
  if(evidenceType==="AF01_ACCEPTANCE"){
    if(capabilities.includes("AF01_ACCEPTANCE_EVIDENCE"))return"COMPATIBLE";
    if(capabilities.includes("VENDOR_ROUTE")||capabilities.includes("STAFFING_RELATIONSHIP"))return"POSSIBLE";
    return"INCOMPATIBLE";
  }
  if(capabilities.includes("CONTACT_PERSON")||capabilities.includes("CONTACT_ROUTE"))return"COMPATIBLE";
  if(capabilities.includes("COMPANY_IDENTITY")||capabilities.includes("COMPANY_ROLE"))return"POSSIBLE";
  return"INCOMPATIBLE";
}

/* ------------------------------------------------------------------------ */
/* Source identity, ownership, entity safety                                */
/* ------------------------------------------------------------------------ */

export function sourceCandidateId(sourceFamily:SourceFamily,baseReference:string|null):string{
  return deterministicSourceIdentity(sourceFamily,baseReference??"unidentified");
}

/** Deterministic, conservative: OFFICIAL only when the host itself contains
 * a normalized token of the organization name -- never inferred from
 * "looks corporate" alone. .gov hosts are GOVERNMENT. Everything else is
 * UNKNOWN, never silently upgraded to OFFICIAL. */
export function classifyOwnership(baseReference:string|null,organization:string):SourceOwnershipType{
  if(!baseReference)return"UNKNOWN";
  let host:string;
  try{host=new URL(baseReference).hostname.toLowerCase()}catch{return"UNKNOWN"}
  if(host.endsWith(".gov"))return"GOVERNMENT";
  const orgToken=organization.toLowerCase().replace(/[^a-z0-9]+/g,"");
  if(orgToken.length>=3&&host.replace(/[^a-z0-9]+/g,"").includes(orgToken))return"OFFICIAL";
  return"UNKNOWN";
}

/* ------------------------------------------------------------------------ */
/* Source candidate construction (assessment-only)                         */
/* ------------------------------------------------------------------------ */

export interface RawSourceCandidateObservation{
  organization:string;
  candidateOrganizationLabel:string|null;
  sourceFamily:SourceFamily;
  baseReference:string|null;
  candidateCapabilities:SourceCapability[];
  candidateTradeScope:SourceTradeScope;
  candidateTradeIds:TradeId[];
  accessProfile:SourceAccessProfile;
  discoveryReason:string;
  coverageGapIds:string[];
  provenanceRefs:string[];
  assessmentStatus?:SourceAssessmentStatus;
}

export function buildSourceCandidate(raw:RawSourceCandidateObservation):SourceCandidate{
  const entityMatch=matchEntity(raw.candidateOrganizationLabel,raw.organization);
  const candidateEvidenceTypes=(["ACTIONABLE_CONTACT","AF01_ACCEPTANCE"]as const)
    .filter(t=>evidenceTypeCompatibility(raw.candidateCapabilities,t)!=="INCOMPATIBLE");
  return{
    sourceCandidateId:sourceCandidateId(raw.sourceFamily,raw.baseReference),
    organization:raw.organization,
    organizationScope:"ORGANIZATION_SPECIFIC",
    sourceFamily:raw.sourceFamily,
    ownershipType:classifyOwnership(raw.baseReference,raw.organization),
    baseReference:raw.baseReference,
    candidateCapabilities:raw.candidateCapabilities,
    candidateEvidenceTypes,
    candidateTradeScope:raw.candidateTradeScope,
    candidateTradeIds:raw.candidateTradeIds,
    accessProfile:raw.accessProfile,
    discoveryReason:raw.discoveryReason,
    coverageGapIds:raw.coverageGapIds,
    provenanceRefs:raw.provenanceRefs,
    assessmentStatus:raw.assessmentStatus??"DISCOVERED",
    entityMatch,
  };
}

/* ------------------------------------------------------------------------ */
/* Source quality (assessment/ranking only -- never verification)          */
/* ------------------------------------------------------------------------ */

const OWNERSHIP_AUTHORITY:Record<SourceOwnershipType,number>={OFFICIAL:2,GOVERNMENT:2,AUTHORITATIVE_THIRD_PARTY:1,PROFESSIONAL:1,AGGREGATOR:0,UNKNOWN:0};

export function scoreSourceQuality(candidate:SourceCandidate,targetEvidenceType:ClosureTargetType):SourceQuality{
  const authority=OWNERSHIP_AUTHORITY[candidate.ownershipType];
  const compatibility=evidenceTypeCompatibility(candidate.candidateCapabilities,targetEvidenceType);
  const directness=compatibility==="COMPATIBLE"?2:compatibility==="POSSIBLE"?1:0;
  const specificity=candidate.candidateCapabilities.length>1?2:candidate.candidateCapabilities.length===1?1:0;
  const currentness=1;
  const stability=candidate.accessProfile==="PUBLIC_READ_ONLY"?2:candidate.accessProfile==="UNKNOWN_ACCESS"?1:0;
  const entityCertainty=candidate.entityMatch==="MATCH"?2:candidate.entityMatch==="AMBIGUOUS"?1:0;
  const commercialRelevance=candidate.candidateEvidenceTypes.includes(targetEvidenceType)?2:0;
  const total=authority+directness+specificity+currentness+stability+entityCertainty+commercialRelevance;
  return{authority,directness,specificity,currentness,stability,entityCertainty,commercialRelevance,total};
}

/* ------------------------------------------------------------------------ */
/* Discovery plan (deterministic, bounded)                                  */
/* ------------------------------------------------------------------------ */

const DISCOVERY_FAMILY_ORDER:readonly SourceFamily[]=["PROCUREMENT_PORTAL","VENDOR_PORTAL","COMPANY_CAREERS","PROJECT_OWNER","EPC_CONTRACTOR","GENERAL_CONTRACTOR","GOVERNMENT_PUBLIC","PROFESSIONAL_DIRECTORY","OTHER_APPROVED"];
const STOP_CONDITION="Stop once a strong official source candidate has been identified and assessed for human review, an authoritative source proves unreachable/unsuitable, the discovery budget is exhausted, or no relevant candidate family remains.";

export function buildDiscoveryPlan(gap:CoverageGap,budget:DiscoveryBudget=DEFAULT_DISCOVERY_BUDGET):DiscoveryStrategy[]{
  return DISCOVERY_FAMILY_ORDER.slice(0,budget.maxDiscoveryStrategies).map((family,i):DiscoveryStrategy=>({
    strategyId:`${gap.coverageGapId}:discovery:${i+1}`,coverageGapId:gap.coverageGapId,organization:gap.organization,
    queryIntent:`${gap.organization} ${family.toLowerCase().replace(/_/g," ")}`,preferredSourceFamilies:[family],
    priority:i+1,stopCondition:STOP_CONDITION,
  }));
}

/* ------------------------------------------------------------------------ */
/* Source approval packet (human-reviewable -- never self-approving)       */
/* ------------------------------------------------------------------------ */

export function buildSourceApprovalPacket(candidate:SourceCandidate,gap:CoverageGap,targetEvidenceType:ClosureTargetType):SourceApprovalPacket{
  const quality=scoreSourceQuality(candidate,targetEvidenceType);
  const compatibility=evidenceTypeCompatibility(candidate.candidateCapabilities,targetEvidenceType);
  const knownRestrictions:string[]=[];
  if(candidate.accessProfile!=="PUBLIC_READ_ONLY")knownRestrictions.push(`Access profile is ${candidate.accessProfile}; automated read-only acquisition may not be permitted.`);
  if(compatibility==="POSSIBLE")knownRestrictions.push(`Capability supports ${targetEvidenceType} discovery only, not proof; verified evidence still requires human review.`);
  if(candidate.entityMatch!=="MATCH")knownRestrictions.push(`Entity match is ${candidate.entityMatch}; organization identity is not confirmed.`);
  const knownRisks:string[]=compatibility==="INCOMPATIBLE"?["Declared capabilities do not plausibly support this evidence type."]:[];
  return{
    packetId:`packet:${candidate.sourceCandidateId}:${targetEvidenceType}`,
    sourceCandidateId:candidate.sourceCandidateId,coverageGapId:gap.coverageGapId,organization:gap.organization,
    sourceFamily:candidate.sourceFamily,ownershipType:candidate.ownershipType,baseReference:candidate.baseReference,
    requestedCapabilities:candidate.candidateCapabilities,requestedEvidenceTypes:candidate.candidateEvidenceTypes,
    organizationScope:candidate.organizationScope,tradeScope:candidate.candidateTradeScope,
    accessProfile:candidate.accessProfile,accessTestResult:`assessment-only; discovery reason: ${candidate.discoveryReason}`,
    quality,entityMatch:candidate.entityMatch,knownRestrictions,knownRisks,
    whyNeeded:`Coverage gap ${gap.coverageGapId} (${gap.coverageStatus}) has no usable approved source for ${targetEvidenceType}.`,
    recommendation:compatibility==="COMPATIBLE"&&candidate.accessProfile==="PUBLIC_READ_ONLY"&&candidate.entityMatch==="MATCH"
      ?"Recommend human review for approval."
      :"Recommend human review; one or more safety conditions require explicit reviewer judgment before any approval.",
    humanDecisionRequired:true,
  };
}

/* ------------------------------------------------------------------------ */
/* Human source-approval decision (never invented here)                     */
/* ------------------------------------------------------------------------ */

const PROHIBITED_AUTOMATED_ACCESS=new Set<SourceAccessProfile>(["LOGIN_REQUIRED","CAPTCHA_PROTECTED","PAYWALLED","WRITE_INTERACTION_REQUIRED"]);

/** Applies an EXTERNALLY-supplied human decision. A source requiring
 * prohibited access can never be approved for automated read-only
 * acquisition even if a reviewer attempts it -- enforced in code, not just
 * by convention (section 14). Mirrors Phase 3G's applyHumanClosureDecision
 * discipline: no new record exists until a human decision arrives. */
export function applyHumanSourceDecision(existing:SourceApprovalRecord|null,candidate:SourceCandidate,decision:SourceApprovalDecisionInput):SourceApprovalRecord|null{
  if(!decision.reviewerId.trim()||!decision.reason.trim())throw new Error("Reviewer and reason are required");
  if((decision.decision==="APPROVE"||decision.decision==="APPROVE_LIMITED")&&PROHIBITED_AUTOMATED_ACCESS.has(candidate.accessProfile)){
    throw new Error(`Cannot approve source with access profile ${candidate.accessProfile} for automated read-only acquisition`);
  }
  if(decision.decision==="REJECT")return existing?{...existing,readiness:"BLOCKED",reviewedBy:decision.reviewerId,reviewedAt:decision.decidedAt,reason:decision.reason}:null;
  if(decision.decision==="SUSPEND"){
    if(!existing)throw new Error("Cannot suspend a source with no existing approval record");
    return{...existing,readiness:"PAUSED",reviewedBy:decision.reviewerId,reviewedAt:decision.decidedAt,reason:decision.reason};
  }
  if(decision.decision==="DEPRECATE"){
    if(!existing)throw new Error("Cannot deprecate a source with no existing approval record");
    return{...existing,readiness:"RETIRED",reviewedBy:decision.reviewerId,reviewedAt:decision.decidedAt,reason:decision.reason};
  }
  if(decision.decision==="REQUIRE_REASSESSMENT"){
    if(!existing)throw new Error("Cannot require reassessment for a source with no existing approval record");
    return{...existing,reassessmentRequired:true,reviewedBy:decision.reviewerId,reviewedAt:decision.decidedAt,reason:decision.reason};
  }
  // APPROVE / APPROVE_LIMITED: approved scope NEVER silently expands beyond
  // what the reviewer explicitly supplies -- it defaults to the candidate's
  // own assessed (not automatically maximal) capabilities only when the
  // reviewer supplies nothing narrower.
  return{
    sourceId:candidate.sourceCandidateId,organization:candidate.organization,sourceFamily:candidate.sourceFamily,
    ownershipType:candidate.ownershipType,readiness:"APPROVED_FOR_LIVE_CAPTURE",
    approvedCapabilities:decision.approvedCapabilities??candidate.candidateCapabilities,
    approvedEvidenceTypes:decision.approvedEvidenceTypes??candidate.candidateEvidenceTypes,
    organizationScope:decision.approvedOrganizationScope??candidate.organizationScope,
    tradeScope:decision.approvedTradeScope??candidate.candidateTradeScope,
    approvedTradeIds:decision.approvedTradeIds??candidate.candidateTradeIds,
    accessProfile:candidate.accessProfile,health:"HEALTHY",lastHealthCheckAt:decision.decidedAt,
    reassessmentRequired:false,reviewedBy:decision.reviewerId,reviewedAt:decision.decidedAt,reason:decision.reason,
    restrictions:existing?.restrictions??[],provenanceRefs:candidate.provenanceRefs,
    ruleVersion:SOURCE_COVERAGE_GOVERNANCE_RULE_VERSION,
  };
}

/* ------------------------------------------------------------------------ */
/* 3G integration: deterministic usability answer                          */
/* ------------------------------------------------------------------------ */

/** Answers "can this source be used for this closure case?" without ever
 * treating an unapproved, out-of-scope, blocked, or unhealthy source as
 * usable. This is the ONLY function Phase 3G would call to check a source --
 * it never expands scope, never bypasses access, never auto-approves. */
export function evaluateSourceUsability(record:SourceApprovalRecord|null,query:SourceUsabilityQuery):SourceUsabilityResult{
  if(!record)return{usability:"NOT_APPROVED",reason:"No approved source record exists for this organization/evidence type."};
  if(record.readiness==="PAUSED"||record.readiness==="RETIRED"||record.readiness==="BLOCKED")return{usability:"BLOCKED",reason:`Source readiness is ${record.readiness}.`};
  if(record.readiness!=="APPROVED_FOR_LIVE_CAPTURE")return{usability:"NOT_APPROVED",reason:`Source readiness is ${record.readiness}, not approved for live capture.`};
  if(BLOCKED_HEALTH.has(record.health))return{usability:"BLOCKED",reason:`Source health is ${record.health}.`};
  if(!record.lastHealthCheckAt)return{usability:"UNHEALTHY",reason:"Source health has not been established."};
  if(STALE_HEALTH.has(record.health))return{usability:"UNHEALTHY",reason:"Source health is STALE; requires reassessment before use. A stale source is never silently treated as healthy."};
  if(record.organizationScope!=="GLOBAL_SOURCE_FAMILY"&&matchEntity(record.organization,query.organization)!=="MATCH")return{usability:"OUT_OF_SCOPE",reason:"Approved organization does not match the requested organization."};
  if(record.tradeScope==="TRADE_SPECIFIC"&&query.tradeId&&!record.approvedTradeIds.includes(query.tradeId))return{usability:"OUT_OF_SCOPE",reason:`Approved trade scope does not include ${query.tradeId}.`};
  if(!record.approvedEvidenceTypes.includes(query.targetEvidenceType))return{usability:"NOT_APPROVED",reason:`Source is not approved for ${query.targetEvidenceType}.`};
  if(!record.approvedCapabilities.includes(query.requiredCapability))return{usability:"LIMITED",reason:`Source is approved for ${query.targetEvidenceType} but not for capability ${query.requiredCapability}.`};
  return{usability:"ALLOWED",reason:"Source is approved, healthy, in scope, and capable."};
}

const HEALTH_RANK:Record<ProductionHealthState,number>={HEALTHY:3,DEGRADED:2,STALE:1,PAUSED:0,BLOCKED:0,FAILING:0};
const USABILITY_RANK:Record<SourceUsability,number>={ALLOWED:1,LIMITED:0,NOT_APPROVED:-1,OUT_OF_SCOPE:-1,BLOCKED:-1,UNHEALTHY:-1,UNKNOWN:-1};

/** Deterministic fallback selection (section 38): never randomness, never a
 * blocked/unapproved source. Ranks usable candidates by usability, then
 * health, then sourceId as a stable tie-break. */
export function selectUsableSource(records:readonly SourceApprovalRecord[],query:SourceUsabilityQuery):SourceApprovalRecord|null{
  const usable=records
    .map(r=>({record:r,result:evaluateSourceUsability(r,query)}))
    .filter(x=>x.result.usability==="ALLOWED"||x.result.usability==="LIMITED")
    .sort((a,b)=>USABILITY_RANK[b.result.usability]-USABILITY_RANK[a.result.usability]||HEALTH_RANK[b.record.health]-HEALTH_RANK[a.record.health]||a.record.sourceId.localeCompare(b.record.sourceId));
  return usable[0]?.record??null;
}

/* ------------------------------------------------------------------------ */
/* Coverage state / preview (hypothetical, non-persisting)                  */
/* ------------------------------------------------------------------------ */

export function computeCoverageState(gap:CoverageGap,records:readonly SourceApprovalRecord[]):CoverageState{
  const evidenceType=gap.missingEvidenceTypes[0];
  if(!evidenceType)return"UNKNOWN";
  const requiredCapabilities=gap.requiredCapabilities;
  const results=recordsForOrganization(records,gap.organization).map(r=>evaluateSourceUsability(r,{organization:gap.organization,tradeId:gap.tradeScopes[0]??null,targetEvidenceType:evidenceType,requiredCapability:requiredCapabilities[0]}));
  if(results.some(r=>r.usability==="ALLOWED"))return"COVERED_USABLE";
  if(results.some(r=>r.usability==="LIMITED"))return"PARTIALLY_COVERED";
  if(results.some(r=>r.usability==="UNHEALTHY"))return"COVERED_DEGRADED";
  if(results.some(r=>r.usability==="BLOCKED"))return"COVERED_BLOCKED";
  return"UNCOVERED";
}

/** Hypothetical only: never mutates the real registry. Inserts the candidate
 * record into a throwaway array purely to compute what coverage state WOULD
 * result, exactly mirroring Phase 3G's non-persisting preview discipline. */
export function previewCoverage(gap:CoverageGap,existingRecords:readonly SourceApprovalRecord[],hypotheticalRecord:SourceApprovalRecord):CoveragePreviewResult{
  const before=computeCoverageState(gap,existingRecords);
  const after=computeCoverageState(gap,[...existingRecords,hypotheticalRecord]);
  return{coverageGapId:gap.coverageGapId,before,after,changed:before!==after,persisted:false};
}

/* ------------------------------------------------------------------------ */
/* Source coverage desk snapshot                                           */
/* ------------------------------------------------------------------------ */

export function buildSourceCoverageDesk(gaps:readonly CoverageGap[],candidates:readonly SourceCandidate[],records:readonly SourceApprovalRecord[],topN=5):SourceCoverageDeskSnapshot{
  const states=gaps.map(g=>({gap:g,state:computeCoverageState(g,records)}));
  const uncovered=states.filter(s=>s.state==="UNCOVERED").length;
  const blocked=states.filter(s=>s.state==="COVERED_BLOCKED").length;
  const partial=states.filter(s=>s.state==="PARTIALLY_COVERED").length;
  const usable=states.filter(s=>s.state==="COVERED_USABLE").length;
  const awaitingApproval=candidates.filter(c=>!records.some(r=>r.sourceId===c.sourceCandidateId)).length;
  const reassessmentRequired=records.filter(r=>r.reassessmentRequired).length;
  const sorted=[...gaps].sort((a,b)=>b.priority-a.priority||a.coverageGapId.localeCompare(b.coverageGapId));
  const topOnboardingPriorities:CoveragePriorityItem[]=sorted.slice(0,topN).map(g=>({
    coverageGapId:g.coverageGapId,organization:g.organization,coverageStatus:g.coverageStatus,
    reason:g.coverageStatus==="NO_APPROVED_SOURCE"?"No approved source family exists for this organization."
      :g.coverageStatus==="APPROVED_SOURCE_NO_CAPABILITY"?"An approved source exists but lacks the required capability."
      :g.coverageStatus==="APPROVED_SOURCE_BLOCKED"?"The approved source is currently blocked."
      :g.coverageStatus==="APPROVED_SOURCE_STALE"?"The approved source has not been successfully accessed recently."
      :"The approved source has not yet yielded evidence.",
  }));
  const topBlockedSources:BlockedSourceItem[]=records.filter(r=>BLOCKED_HEALTH.has(r.health)).slice(0,topN).map(r=>({sourceId:r.sourceId,organization:r.organization,health:r.health}));
  return{totalCoverageGaps:gaps.length,uncovered,blocked,partial,usable,sourceCandidates:candidates.length,awaitingApproval,reassessmentRequired,topOnboardingPriorities,topBlockedSources,ruleVersion:SOURCE_COVERAGE_GOVERNANCE_RULE_VERSION};
}

/* ------------------------------------------------------------------------ */
/* Block-page detection (mirrors Phase 3G's live-test detector)             */
/* ------------------------------------------------------------------------ */

/** Deliberately the same pattern Phase 3G's live pilot test uses (section 22:
 * reuse, don't duplicate competing detection logic). Phase 3G's copy lives
 * inside an already-committed/pushed live test file rather than an
 * importable module, so this is a documented, intentional mirror -- not a
 * second, independently-evolving implementation. True single-sourcing is
 * deferred (see Legacy Source Convergence in the Phase 3H report) until that
 * detector is promoted out of a test file. */
const BLOCK_PAGE_MARKERS=/cloudflare|attention required|you have been blocked|access denied|please enable cookies|verify you are human|checking your browser/i;
export function isBlockedPage(body:string):boolean{return BLOCK_PAGE_MARKERS.test(body)}
