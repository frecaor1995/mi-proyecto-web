import type{ContactRouteType}from"../../../domain/contact";
import type{AggregatedCandidate}from"../../../domain/evidence-aggregation";
import type{EvidenceFact}from"../../../domain/targeted-evidence-closure";
import{FACTS,TARGETED_SOURCES,FACTS_2I,TARGETED_SOURCES_2I,FACTS_2J,TARGETED_SOURCES_2J,FACTS_2Q,TARGETED_SOURCES_2Q}from"../targeted-evidence/targeted-evidence-facts";
import{REAL_CONVERSION_SET}from"../hot-conversion/hot-conversion-service";

/**
 * Phase 2M: neutral evidence-aggregation layer resolving TECH-DEBT-04.
 *
 * This module reads real captured evidence from:
 *  - targeted-evidence-facts.ts (Phase 2H/2I/2J TARGETED_SOURCES and FACTS arrays, a
 *    dependency-free leaf -- see that file's header for exactly why it exists and
 *    not targeted-evidence-closure-service.ts directly)
 *  - hot-conversion-service.ts's REAL_CONVERSION_SET (also dependency-free; its
 *    only imports are ../../../domain/hot-conversion and ../../../domain/verification)
 *
 * and normalizes buyer/AF-01/contact-authority/conflict/stale-evidence observations
 * into a single AggregatedCandidate vocabulary. It does NOT verify, reject, infer,
 * grade, score, or determine eligibility -- every real candidate this module produces
 * carries verificationState "UNVERIFIED" and reviewState "READY_FOR_HUMAN_REVIEW" or
 * "NEEDS_MORE_EVIDENCE" only.
 *
 * Dependency direction: opportunity-qualification-service.ts imports FROM this file;
 * this file imports FROM targeted-evidence-facts.ts and hot-conversion-service.ts;
 * NEITHER of those imports opportunity-qualification-service.ts, and this file itself
 * never imports opportunity-qualification-service.ts. No cycle exists anywhere in this
 * chain -- see src/test/evidence-aggregation/evidence-aggregation.test.ts's explicit
 * acyclicity test.
 */

export const DEFAULT_AT=new Date("2026-08-23T12:00:00Z");

// Sources confirmed dead/unavailable during live re-verification (Phase 2I) and
// classified RETIRED by Phase 2K's SOURCE_PORTFOLIO_INVENTORY. Their FACTS rows are
// preserved for historical/audit purposes in the targeted-evidence data but must not
// produce live human-review candidates here -- a real reviewer acting on this queue
// would otherwise be reviewing a dead posting as if it were current.
export const RETIRED_SOURCE_KEYS=new Set(["trillium-midland-794201","nes-houston-27773"]);

// Only a named contact person or a specific, non-generic contact route counts as
// contact-authority evidence -- mirrors source-portfolio-audit-2k-service.ts's own
// GENERIC_CONTACT_ROUTES convention so a placeholder never masquerades as a real lead.
const GENERIC_CONTACT_ROUTES=new Set(["Public assignment page"]);

// The five tracked qualification dossiers this codebase carries (Phase 2G/2L; Texas
// Panhandle added Phase 2Q). This mirrors the literal opportunityId strings the FACTS
// ledgers themselves already use (e.g. FACTS[0].opportunityId==="qual-beaumont-port-
// arthur") -- it is data, not an import of opportunity-qualification-service.ts.
export const MARKET_TO_TRACKED_OPPORTUNITY:Record<string,string>={
  "Freeport":"qual-freeport",
  "Beaumont / Port Arthur":"qual-beaumont-port-arthur",
  "Permian Basin":"qual-permian",
  "Corpus Christi":"qual-corpus",
  "Texas Panhandle":"qual-amarillo",
};

const ALL_TARGETED_SOURCES=[...TARGETED_SOURCES,...TARGETED_SOURCES_2I,...TARGETED_SOURCES_2J,...TARGETED_SOURCES_2Q];
const sourceDecision=(key:string)=>ALL_TARGETED_SOURCES.find(s=>s.key===key)?.decision??null;
const reviewStateForSource=(sourceKey:string):"READY_FOR_HUMAN_REVIEW"|"NEEDS_MORE_EVIDENCE"=>sourceDecision(sourceKey)==="ACTIVATE"?"READY_FOR_HUMAN_REVIEW":"NEEDS_MORE_EVIDENCE";

const slug=(...parts:(string|null|undefined)[])=>parts.filter((p):p is string=>!!p).join(":").toLowerCase().replace(/[^a-z0-9:]+/g,"-");
const isRecruiterLike=(sourceKey:string)=>sourceKey.startsWith("trillium");
function classifyRouteType(sourceKey:string,routeTarget:string):ContactRouteType{
  const email=routeTarget.includes("@");
  if(isRecruiterLike(sourceKey))return email?"RECRUITER_EMAIL":"RECRUITER_PHONE";
  return email?"PROCUREMENT_EMAIL":"CORPORATE_PHONE";
}

function candidatesFromFact(f:EvidenceFact,originService:string):AggregatedCandidate[]{
  if(RETIRED_SOURCE_KEYS.has(f.sourceKey))return[];
  const out:AggregatedCandidate[]=[];
  const reviewState=reviewStateForSource(f.sourceKey);
  const evidenceIds=[f.id],sourceIds=[f.sourceKey],sourceUrls=[f.url];
  const trackedOpportunityId=f.opportunityId;

  // Buyer/AF-01 review questions are opportunity-specific ("does this establish
  // manpower-purchasing authority FOR THIS OPPORTUNITY"); a candidate with no tracked
  // opportunity cannot honestly receive one -- this mirrors the exact precedent already
  // established by reviewPackages2j()'s own filter in targeted-evidence-closure-2j-
  // service.ts, extended here to AF-01 as well. This is also the concrete mechanism
  // that keeps Trillium Amarillo's real buyer/AF-01 text (present on the raw FACTS_2J
  // rows) from ever being represented as a candidate against a tracked dossier.
  if(f.buyerCandidate&&trackedOpportunityId){
    out.push({
      id:`BUYER_CANDIDATE:${trackedOpportunityId}:${f.id}`,type:"BUYER_CANDIDATE",
      opportunityId:trackedOpportunityId,contextId:trackedOpportunityId,market:f.market,
      company:f.buyerCandidate,project:f.project,value:f.buyerCandidate,category:null,
      contactPersonName:null,routeTarget:null,routeType:null,routeGrade:null,
      evidenceIds,sourceIds,sourceUrls,observedAt:f.observedAt,staleAfter:f.freshUntil,
      verificationState:"UNVERIFIED",reviewState,reason:f.support,
      contraryEvidence:["A procurement issuer or employer is not automatically a manpower buyer; opportunity-specific purchasing authority must be established by human review."],
      provenance:{originService,originFactId:f.id},
    });
  }
  if(f.af01Candidate&&trackedOpportunityId){
    out.push({
      id:`AF01_CANDIDATE:${trackedOpportunityId}:${f.id}`,type:"AF01_CANDIDATE",
      opportunityId:trackedOpportunityId,contextId:trackedOpportunityId,market:f.market,
      company:null,project:f.project,value:f.af01Candidate,category:f.af01Candidate,
      contactPersonName:null,routeTarget:null,routeType:null,routeGrade:null,
      evidenceIds,sourceIds,sourceUrls,observedAt:f.observedAt,staleAfter:f.freshUntil,
      verificationState:"UNVERIFIED",reviewState,reason:f.support,
      contraryEvidence:["An AF-01 candidate excerpt requires human confirmation of taxonomy and opportunity scope before it can support manpower acceptance."],
      provenance:{originService,originFactId:f.id},
    });
  }
  // Contact-authority is deliberately NOT gated on a tracked opportunityId: whether a
  // named person or route is a legitimate point of contact at all is a standalone
  // question, independent of whether it happens to be linked to one of the four
  // tracked dossiers. This is what lets a genuine Trillium Amarillo review case exist
  // (real recruiter evidence, Texas Panhandle, no tracked dossier) without ever
  // implying a buyer, AF-01 or route grade for it.
  const nonGenericRoute=f.contactRoute&&!GENERIC_CONTACT_ROUTES.has(f.contactRoute)?f.contactRoute:null;
  if(f.contactPerson||nonGenericRoute){
    // Deliberately keyed by market + person/route identity, NOT sourceKey: the same
    // real contact (e.g. Trillium Amarillo's Roberto Venegas) can appear on multiple
    // distinct postings/sourceKeys, and must still resolve to ONE reviewable candidate
    // -- see dedupeContacts() below, which merges on this same contextId.
    const contextId=trackedOpportunityId??`context:${slug(f.market,f.contactPerson??nonGenericRoute??f.id)}`;
    out.push({
      id:`CONTACT_AUTHORITY:${contextId}:${f.id}`,type:"CONTACT_AUTHORITY",
      opportunityId:trackedOpportunityId,contextId,market:f.market,company:null,project:f.project,
      value:f.contactPerson??nonGenericRoute??"",category:null,
      contactPersonName:f.contactPerson,routeTarget:nonGenericRoute,
      routeType:nonGenericRoute?classifyRouteType(f.sourceKey,nonGenericRoute):null,routeGrade:null,
      evidenceIds,sourceIds,sourceUrls,observedAt:f.observedAt,staleAfter:f.freshUntil,
      verificationState:"UNVERIFIED",reviewState,reason:f.support,
      contraryEvidence:trackedOpportunityId
        ?["Named contact authority requires human confirmation before any use for outreach."]
        :["This candidate is not linked to any tracked qualification dossier; buyer, AF-01 or route-grade status must never be inferred from this contact's existence alone."],
      provenance:{originService,originFactId:f.id},
    });
  }
  return out;
}

/** Merges CONTACT_AUTHORITY candidates that describe the same person/route within the
 * same context (e.g. Trillium Amarillo's Roberto Venegas, captured on two separate
 * postings) into one candidate carrying the union of evidence, rather than surfacing
 * near-duplicate review targets for the same real-world question. */
function dedupeContacts(candidates:AggregatedCandidate[]):AggregatedCandidate[]{
  const byKey=new Map<string,AggregatedCandidate>();
  for(const c of candidates){
    const key=c.type==="CONTACT_AUTHORITY"?`CONTACT_AUTHORITY:${c.contextId}:${c.contactPersonName??""}:${c.routeTarget??""}`:c.id;
    const existing=byKey.get(key);
    if(!existing){byKey.set(key,c);continue}
    byKey.set(key,{
      ...existing,
      evidenceIds:[...new Set([...existing.evidenceIds,...c.evidenceIds])],
      sourceIds:[...new Set([...existing.sourceIds,...c.sourceIds])],
      sourceUrls:[...new Set([...existing.sourceUrls,...c.sourceUrls])],
      observedAt:c.observedAt<existing.observedAt?c.observedAt:existing.observedAt,
    });
  }
  return[...byKey.values()];
}

/** COMPANY_PROJECT_CONFLICT candidates. Corpus Christi's cross-entity uncertainty
 * (City of Corpus Christi procurement vs. PSV Industries demand) does not exist as a
 * targeted-evidence FACT -- it lives in hot-conversion-service.ts's REAL_CONVERSION_SET
 * ("corpus-industrial", conflict: "Cross-source project identity unresolved"), which is
 * the only real-evidence ledger that actually captures it. */
function conflictCandidates():AggregatedCandidate[]{
  return REAL_CONVERSION_SET.filter(x=>x.conflict).map(x=>{
    const opportunityId=MARKET_TO_TRACKED_OPPORTUNITY[x.market]??null;
    const contextId=opportunityId??`context:${slug(x.market,x.id)}`;
    return{
      id:`COMPANY_PROJECT_CONFLICT:${contextId}:${x.id}`,type:"COMPANY_PROJECT_CONFLICT",
      opportunityId,contextId,market:x.market,company:x.buyerCandidate,project:null,
      value:x.conflict!,category:null,contactPersonName:null,routeTarget:null,routeType:null,routeGrade:null,
      evidenceIds:x.evidenceIds,sourceIds:[...new Set(x.sources.map(s=>s.key))],sourceUrls:[...new Set(x.sources.map(s=>s.url))],
      observedAt:x.observedAt,staleAfter:x.staleAfter,
      verificationState:"UNVERIFIED",reviewState:"READY_FOR_HUMAN_REVIEW",reason:x.conflict!,
      contraryEvidence:["Cross-source identity is not established by geography or coincidental timing alone; do not fuzzy-merge."],
      provenance:{originService:"hot-conversion-service:REAL_CONVERSION_SET",originFactId:x.id},
    };
  });
}

/** STALE_CRITICAL_EVIDENCE candidates, evaluated as of `asOf`. Every real production
 * evidence date in this codebase is currently in the future relative to any reasonable
 * `asOf`, so this returns [] for real data today -- that is the honest, correct result,
 * not a bug; the logic itself is exercised with a synthetic future `asOf` in tests. */
function staleCandidates(asOf:Date):AggregatedCandidate[]{
  const out:AggregatedCandidate[]=[];
  for(const f of[...FACTS,...FACTS_2I,...FACTS_2J,...FACTS_2Q]){
    if(RETIRED_SOURCE_KEYS.has(f.sourceKey)||f.freshUntil>asOf)continue;
    const contextId=f.opportunityId??`context:${slug(f.market,f.sourceKey)}`;
    out.push({
      id:`STALE_CRITICAL_EVIDENCE:${contextId}:${f.id}`,type:"STALE_CRITICAL_EVIDENCE",
      opportunityId:f.opportunityId,contextId,market:f.market,company:null,project:f.project,
      value:`Evidence from ${f.sourceKey} reached its freshUntil (${f.freshUntil.toISOString()}) as of ${asOf.toISOString()}`,
      category:null,contactPersonName:null,routeTarget:null,routeType:null,routeGrade:null,
      evidenceIds:[f.id],sourceIds:[f.sourceKey],sourceUrls:[f.url],
      observedAt:f.observedAt,staleAfter:f.freshUntil,
      verificationState:"UNVERIFIED",reviewState:"READY_FOR_HUMAN_REVIEW",
      reason:"Critical evidence has passed its freshness window and must be re-verified before further reliance.",
      contraryEvidence:[],provenance:{originService:"targeted-evidence-facts",originFactId:f.id},
    });
  }
  for(const x of REAL_CONVERSION_SET){
    if(!x.staleAfter||x.staleAfter>asOf)continue;
    const opportunityId=MARKET_TO_TRACKED_OPPORTUNITY[x.market]??null;
    const contextId=opportunityId??`context:${slug(x.market,x.id)}`;
    out.push({
      id:`STALE_CRITICAL_EVIDENCE:${contextId}:${x.id}`,type:"STALE_CRITICAL_EVIDENCE",
      opportunityId,contextId,market:x.market,company:x.buyerCandidate,project:null,
      value:`Critical production evidence for ${x.id} reached stale_after (${x.staleAfter.toISOString()}) as of ${asOf.toISOString()}`,
      category:null,contactPersonName:null,routeTarget:null,routeType:null,routeGrade:null,
      evidenceIds:x.evidenceIds,sourceIds:[...new Set(x.sources.map(s=>s.key))],sourceUrls:[...new Set(x.sources.map(s=>s.url))],
      observedAt:x.observedAt,staleAfter:x.staleAfter,
      verificationState:"UNVERIFIED",reviewState:"READY_FOR_HUMAN_REVIEW",
      reason:"Critical production evidence reached stale_after and must be re-verified before further reliance.",
      contraryEvidence:[],provenance:{originService:"hot-conversion-service:REAL_CONVERSION_SET",originFactId:x.id},
    });
  }
  return out;
}

export function aggregatedCandidates(asOf:Date=DEFAULT_AT):AggregatedCandidate[]{
  const factCandidates=[
    ...FACTS.flatMap(f=>candidatesFromFact(f,"targeted-evidence-facts:2H")),
    ...FACTS_2I.flatMap(f=>candidatesFromFact(f,"targeted-evidence-facts:2I")),
    ...FACTS_2J.flatMap(f=>candidatesFromFact(f,"targeted-evidence-facts:2J")),
    ...FACTS_2Q.flatMap(f=>candidatesFromFact(f,"targeted-evidence-facts:2Q")),
  ];
  return[...dedupeContacts(factCandidates),...conflictCandidates(),...staleCandidates(asOf)];
}

export function aggregatedCandidatesFor(opportunityId:string,asOf:Date=DEFAULT_AT):AggregatedCandidate[]{
  return aggregatedCandidates(asOf).filter(c=>c.opportunityId===opportunityId);
}
