import type{DemandSignal}from"./demand-signal";
import type{ElectricalRole,ElectricalRoleMatch}from"./electrical-role-recognition";
import{ELECTRICAL_ROLE_RULE_VERSION,recognizeElectricalRoles}from"./electrical-role-recognition";

/**
 * Phase 2R-A Discovery Foundation: Demand Signal -> Tracked status.
 *
 * ISOLATION IS THE POINT. This module is additive and standalone. It does NOT
 * import, extend, or feed opportunity-qualification-service.ts, whose
 * qualificationDossiers() remains the fixed five hardcoded dossiers many other
 * services and tests depend on. A signal promoted here becomes a
 * TrackedDiscoverySignal -- a discovery-stage record -- and never a sixth
 * qualification dossier. Wiring the two together, if ever wanted, is a
 * deliberate later decision, not a side effect of this checkpoint.
 *
 * The promotion rule, per the manager's narrowing for this checkpoint:
 * credible evidence of electrical manpower demand is *sufficient*. Buyer,
 * AF-01 acceptance, contact person, project, headcount and economics may all
 * be UNKNOWN and the signal still tracks. Discovery precedes eligibility; an
 * unqualified-but-real signal must be preserved, not dropped.
 *
 * "Credible evidence" is defined narrowly and non-negotiably as: the signal's
 * own captured text explicitly names an electrician-family craft role
 * (electrical-role-recognition.ts). Nothing here infers demand from the
 * employer's identity, the sector, the market, or the priority tier.
 */
export const DISCOVERY_PROMOTION_RULE_VERSION="discovery-promotion@1.0.0";

export interface TrackedDiscoverySignal{
  trackedId:string;
  signalId:string;
  externalId:string;
  sourceKey:string;
  sourceUrl:string;
  title:string|null;
  organization:string|null;
  location:string|null;
  recognizedRoles:ElectricalRole[];
  roleMatches:ElectricalRoleMatch[];
  /** Copied verbatim from the originating signal; promotion never upgrades,
   * downgrades or recomputes the existing priority classification. */
  tier:DemandSignal["tier"];
  observedAt:Date;
  reasons:string[];
  ruleVersion:string;
}

export interface PromotionDecision{
  signalId:string;
  externalId:string;
  promoted:boolean;
  recognizedRoles:ElectricalRole[];
  roleMatches:ElectricalRoleMatch[];
  reasons:string[];
  ruleVersion:string;
}

export interface PromotionResult{
  tracked:TrackedDiscoverySignal[];
  decisions:PromotionDecision[];
}

/**
 * The text a promotion decision is allowed to read. Only fields the source's
 * own listing text populated: the candidate's title and the description-derived
 * project string. `organization` is EXCLUDED on purpose -- promoting because an
 * employer is an electrical contractor would be exactly the
 * inference-from-employer-identity this program forbids (see
 * demand-signal-priority.ts's own sector note).
 */
export function promotionEvidenceText(signal:DemandSignal):string{
  return[signal.title,signal.project].filter((v):v is string=>typeof v==="string"&&v.trim().length>0).join(" — ");
}

/** Pure, deterministic, side-effect free. */
export function evaluateDemandSignalForTracking(signal:DemandSignal):PromotionDecision{
  const recognition=recognizeElectricalRoles(promotionEvidenceText(signal));
  const promoted=recognition.roles.length>0;
  const reasons=promoted
    ?recognition.matches.map(m=>`explicit electrician-family role stated in source text: "${m.phrase}" (${m.role})`)
    :["no explicit electrician-family role stated in the signal's own captured text; not promoted (buyer, AF-01, contact, project, headcount and economics are irrelevant to this decision either way)"];
  return{
    signalId:signal.id,
    externalId:signal.externalId,
    promoted,
    recognizedRoles:recognition.roles,
    roleMatches:recognition.matches,
    reasons,
    ruleVersion:`${DISCOVERY_PROMOTION_RULE_VERSION}+${ELECTRICAL_ROLE_RULE_VERSION}`
  };
}

function trackedFrom(signal:DemandSignal,decision:PromotionDecision):TrackedDiscoverySignal{
  return{
    trackedId:`tracked-discovery:${signal.externalId}`,
    signalId:signal.id,
    externalId:signal.externalId,
    sourceKey:signal.sourceKey,
    sourceUrl:signal.sourceUrl,
    title:signal.title,
    organization:signal.organization,
    location:signal.location,
    recognizedRoles:decision.recognizedRoles,
    roleMatches:decision.roleMatches,
    tier:signal.tier,
    observedAt:signal.observedAt,
    reasons:decision.reasons,
    ruleVersion:decision.ruleVersion
  };
}

/**
 * Idempotent by stable externalId, matching dedupeDemandSignals()'s existing
 * contract: re-running a scan, or feeding the same signal twice in one batch,
 * yields exactly one tracked record. `alreadyTracked` lets a caller carry a
 * prior run's tracked set forward across runs with the same guarantee.
 */
export function promoteDemandSignals(signals:readonly DemandSignal[],alreadyTracked:readonly TrackedDiscoverySignal[]=[]):PromotionResult{
  const seen=new Set(alreadyTracked.map(t=>t.externalId));
  const tracked:TrackedDiscoverySignal[]=[...alreadyTracked];
  const decisions:PromotionDecision[]=[];
  for(const signal of signals){
    const decision=evaluateDemandSignalForTracking(signal);
    decisions.push(decision);
    if(!decision.promoted)continue;
    if(seen.has(signal.externalId))continue;
    seen.add(signal.externalId);
    tracked.push(trackedFrom(signal,decision));
  }
  return{tracked,decisions};
}
