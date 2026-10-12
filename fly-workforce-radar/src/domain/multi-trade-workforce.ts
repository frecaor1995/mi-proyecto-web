/**
 * Phase 3X Multi-Trade / Multi-Profession Architecture: the pieces that make
 * the existing universal core loop (SOURCE -> RAW EVIDENCE -> DEMAND SIGNAL
 * -> ... -> ACTIVE HOT) usable by more than one trade, without duplicating
 * it per profession and without touching any frozen Phase 2/3 module.
 *
 * Three concerns live here, all additive:
 *  1. A generalized discovery-promotion entry point, parallel to (not a
 *     replacement for) discovery-promotion.ts's frozen electrical-only gate.
 *  2. The multi-demand-per-project model: one project, many independent
 *     workforce demands, sharing project facts without duplicating them.
 *  3. Conservative evidence-scope evaluators for AF-01 acceptance and
 *     contact authority, so a trade-specific or project-specific finding is
 *     never silently assumed to cover a different trade.
 */
import type{DemandSignal}from"./demand-signal";
import{promotionEvidenceText}from"./discovery-promotion";
import type{TradeId,WorkforceClassification}from"./workforce-taxonomy";
import{recognizeWorkforceOccupations}from"./workforce-role-recognition";
import type{WorkforceRoleMatch}from"./workforce-role-recognition";

export const MULTI_TRADE_WORKFORCE_RULE_VERSION="multi-trade-workforce@1.0.0";

/* ---------------------------------------------------------------------- */
/* 1. Generalized discovery-promotion entry point                          */
/* ---------------------------------------------------------------------- */

export interface TrackedWorkforceDemandSignal{
  trackedId:string;
  signalId:string;
  externalId:string;
  sourceKey:string;
  sourceUrl:string;
  title:string|null;
  organization:string|null;
  location:string|null;
  classifications:WorkforceClassification[];
  roleMatches:WorkforceRoleMatch[];
  tier:DemandSignal["tier"];
  observedAt:Date;
  reasons:string[];
  ruleVersion:string;
}

export interface WorkforcePromotionDecision{
  signalId:string;
  externalId:string;
  promoted:boolean;
  classifications:WorkforceClassification[];
  roleMatches:WorkforceRoleMatch[];
  reasons:string[];
  ruleVersion:string;
}

export interface WorkforcePromotionResult{
  tracked:TrackedWorkforceDemandSignal[];
  decisions:WorkforcePromotionDecision[];
}

/** Pure, deterministic, side-effect free. Reuses discovery-promotion.ts's own
 * promotionEvidenceText (title + explicit project text only -- organization
 * is deliberately excluded, exactly as the frozen module documents). */
export function evaluateDemandSignalForWorkforceTracking(signal:DemandSignal):WorkforcePromotionDecision{
  const recognition=recognizeWorkforceOccupations(promotionEvidenceText(signal));
  const promoted=recognition.classifications.length>0;
  const reasons=promoted
    ?recognition.matches.map(m=>`explicit occupation stated in source text: "${m.phrase}" (${m.occupationId})`)
    :["no explicit recognized occupation stated in the signal's own captured text; not promoted (buyer, AF-01, contact, project, headcount and economics are irrelevant to this decision either way)"];
  return{
    signalId:signal.id,
    externalId:signal.externalId,
    promoted,
    classifications:recognition.classifications,
    roleMatches:recognition.matches,
    reasons,
    ruleVersion:`${MULTI_TRADE_WORKFORCE_RULE_VERSION}+${recognition.ruleVersion}`
  };
}

function trackedFrom(signal:DemandSignal,decision:WorkforcePromotionDecision):TrackedWorkforceDemandSignal{
  return{
    trackedId:`tracked-workforce-demand:${signal.externalId}`,
    signalId:signal.id,
    externalId:signal.externalId,
    sourceKey:signal.sourceKey,
    sourceUrl:signal.sourceUrl,
    title:signal.title,
    organization:signal.organization,
    location:signal.location,
    classifications:decision.classifications,
    roleMatches:decision.roleMatches,
    tier:signal.tier,
    observedAt:signal.observedAt,
    reasons:decision.reasons,
    ruleVersion:decision.ruleVersion
  };
}

/** Idempotent by stable externalId, matching discovery-promotion.ts's own
 * contract. */
export function promoteWorkforceDemandSignals(signals:readonly DemandSignal[],alreadyTracked:readonly TrackedWorkforceDemandSignal[]=[]):WorkforcePromotionResult{
  const seen=new Set(alreadyTracked.map(t=>t.externalId));
  const tracked:TrackedWorkforceDemandSignal[]=[...alreadyTracked];
  const decisions:WorkforcePromotionDecision[]=[];
  for(const signal of signals){
    const decision=evaluateDemandSignalForWorkforceTracking(signal);
    decisions.push(decision);
    if(!decision.promoted)continue;
    if(seen.has(signal.externalId))continue;
    seen.add(signal.externalId);
    tracked.push(trackedFrom(signal,decision));
  }
  return{tracked,decisions};
}

/* ---------------------------------------------------------------------- */
/* 2. Multi-demand-per-project model                                       */
/* ---------------------------------------------------------------------- */

/**
 * A single occupation-level demand. Deliberately carries NO owner/GC/buyer/
 * project-stage fields -- those are project-level facts and stay in Phase
 * 3D's ProjectEvidenceCandidate, referenced here only by projectRef, so
 * shared project facts are never duplicated or allowed to drift per demand.
 */
export interface WorkforceDemandRecord{
  id:string;
  projectRef:string;
  signalId:string;
  classification:WorkforceClassification;
  headcount:number|null;
  schedule:string|null;
  shift:string|null;
  duration:string|null;
  perDiem:string|null;
  pay:string|null;
  sourceEvidenceIds:string[];
  observedAt:Date;
}

export interface ProjectWorkforceDemandGroup{
  projectRef:string;
  demands:WorkforceDemandRecord[];
}

/**
 * A demand is grouped under an explicitly-named project when its source
 * signal explicitly names one (matching Phase 3D's own linkage standard --
 * geography/company/trade alone never establish a shared project). Absent an
 * explicit project name, each opportunity is its own unlinked group: no two
 * signals are ever merged into one project on inference.
 */
export function deriveProjectRef(input:{project:string|null;opportunityId:string}):string{
  const project=input.project?.trim();
  return project?`project:${project.toLowerCase()}`:`opportunity:${input.opportunityId}`;
}

/** Pure grouping. One project key can hold demands for many different
 * occupations; each keeps its own headcount/schedule/pay/duration
 * independent of every other demand under the same project. */
export function groupWorkforceDemandsByProject(demands:readonly WorkforceDemandRecord[]):ProjectWorkforceDemandGroup[]{
  const byProject=new Map<string,WorkforceDemandRecord[]>();
  for(const d of demands){
    const list=byProject.get(d.projectRef)??[];
    list.push(d);
    byProject.set(d.projectRef,list);
  }
  return[...byProject.entries()]
    .map(([projectRef,list])=>({projectRef,demands:[...list].sort((a,b)=>a.id.localeCompare(b.id))}))
    .sort((a,b)=>a.projectRef.localeCompare(b.projectRef));
}

/* ---------------------------------------------------------------------- */
/* 3. Conservative evidence-scope evaluators (AF-01 / contact authority)   */
/* ---------------------------------------------------------------------- */

export const ACCEPTANCE_EVIDENCE_SCOPES=["TRADE_SPECIFIC","CRAFT_SPECIFIC","PROJECT_SPECIFIC","BUSINESS_UNIT_SPECIFIC","ORGANIZATION_WIDE","UNKNOWN"]as const;
export type AcceptanceEvidenceScope=(typeof ACCEPTANCE_EVIDENCE_SCOPES)[number];

/** Wraps, but never replaces or widens, the frozen AF-01 category vocabulary
 * (manpower-acceptance.ts). `category` is carried through verbatim for
 * provenance; this module does not read or interpret it. */
export interface ScopedAcceptanceEvidence{
  category:string;
  scope:AcceptanceEvidenceScope;
  scopedTradeIds:TradeId[];
  scopeEvidenceText:string|null;
}

/**
 * Conservative by construction: coverage requires either an explicit
 * ORGANIZATION_WIDE scope claim, or the target trade appearing explicitly in
 * scopedTradeIds. PROJECT_SPECIFIC, BUSINESS_UNIT_SPECIFIC and UNKNOWN scope
 * never auto-extend to any trade, including the one the evidence actually
 * concerned -- callers must populate scopedTradeIds explicitly even for a
 * single-trade finding. This function fabricates nothing; it only reads what
 * its caller already asserted as explicit.
 */
export function acceptanceCoversTrade(evidence:ScopedAcceptanceEvidence,targetTradeId:TradeId):boolean{
  if(evidence.scope==="ORGANIZATION_WIDE")return true;
  return evidence.scopedTradeIds.includes(targetTradeId);
}

export const CONTACT_AUTHORITY_SCOPES=["TRADE_SPECIFIC","PROJECT_SPECIFIC","BUSINESS_UNIT_SPECIFIC","ORGANIZATION_WIDE","UNKNOWN"]as const;
export type ContactAuthorityScope=(typeof CONTACT_AUTHORITY_SCOPES)[number];

/** Wraps, but never changes, the frozen Grade A-E vocabulary. */
export interface ScopedContactAuthority{
  gradeCandidate:"A"|"B"|"C"|"D"|"E";
  scope:ContactAuthorityScope;
  scopedTradeIds:TradeId[];
}

/** Same conservative rule as acceptanceCoversTrade: a contact found on one
 * project, or in one procurement function, does not become the authority for
 * every workforce category on that project merely by proximity. */
export function contactAuthorityCoversTrade(contact:ScopedContactAuthority,targetTradeId:TradeId):boolean{
  if(contact.scope==="ORGANIZATION_WIDE")return true;
  return contact.scopedTradeIds.includes(targetTradeId);
}
