import type{DemandSignal}from"../../../domain/demand-signal";
import type{DemandSignalDuration,DemandSignalPriorityInput}from"../../../domain/demand-signal-priority";
import{classifyDemandSignalPriority}from"../../../domain/demand-signal-priority";
import type{ElectricalRole}from"../../../domain/electrical-role-recognition";
import{toDemandSignalRole}from"../../../domain/electrical-role-recognition";
import type{TrackedDiscoverySignal}from"../../../domain/discovery-promotion";
import{promoteDemandSignals}from"../../../domain/discovery-promotion";
import type{VerificationNeedsResult}from"../../../domain/verification-needs";
import{deriveVerificationNeeds}from"../../../domain/verification-needs";
import type{ProductionObservation}from"../../../domain/production-capture";
import{dedupeDemandSignals}from"./tpwd-listing-discovery-service";

/**
 * Phase 2R-B: shared discovery pipeline for the four listing adapters added or
 * upgraded this checkpoint (IBEW 716, Strike/JazzHR, Trillium, Bechtel).
 *
 * It reuses, and does not touch, the existing pieces:
 *   classifyDemandSignalPriority  (demand-signal-priority.ts, rules unmodified)
 *   promoteDemandSignals          (discovery-promotion.ts, semantics unmodified)
 *   dedupeDemandSignals           (tpwd-listing-discovery-service.ts)
 * and adds only the mapping from a captured observation's explicitly-stated
 * facts into those existing contracts.
 *
 * EVERY mapping below is absence-preserving. A fact the source did not state
 * becomes null / UNKNOWN / false, never a default that reads as evidence.
 */

const str=(v:unknown):string|null=>typeof v==="string"&&v.trim().length>0?v.trim():null;
const num=(v:unknown):number|null=>typeof v==="number"&&Number.isFinite(v)?v:null;

/**
 * Explicit sector evidence only. The row's own text must SAY data centre or
 * mission critical. A jobsite named after a technology company, a hyperscaler
 * or a chip maker proves nothing about the project type and is deliberately
 * not matched here -- that inference is exactly what Phase 2Q's classifier note
 * forbids.
 */
export const statesDataCentreSector=(text:string|null):boolean=>
  text!==null&&/\b(data\s?cent(?:er|re)s?|mission[-\s]critical|hyperscale)\b/i.test(text);

/**
 * Construction shorthand for a stated schedule: "6(10's)" means six ten-hour
 * days. Multiplying two numbers the source itself printed is arithmetic on
 * explicit values, not an inference, so the result is trustworthy as
 * hoursPerWeek. Anything that does not match this exact printed form yields
 * null rather than an estimate.
 */
export function hoursPerWeekFromSchedule(schedule:string|null):number|null{
  if(!schedule)return null;
  const m=schedule.match(/\b(\d{1,2})\s*\(\s*(\d{1,2})\s*['’]?s?\s*\)/);
  if(m){
    const days=Number(m[1]),hours=Number(m[2]);
    if(days>0&&days<=7&&hours>0&&hours<=24)return days*hours;
  }
  const direct=schedule.match(/\b(\d{2,3})\s*(?:hours?|hrs?)\s*(?:per|a|\/)\s*week\b/i);
  if(direct){const n=Number(direct[1]);if(n>0&&n<=168)return n}
  return null;
}

/** Explicitly stated duration only. */
export function durationFromText(text:string|null):DemandSignalDuration{
  if(!text)return"UNKNOWN";
  if(/\b(?:long[-\s]term|long term|multi[-\s]year|permanent|full[-\s]time\s+direct)\b/i.test(text))return"LONG_TERM";
  if(/\b(?:short[-\s]term|temporary\s+assignment|\d{1,2}\s*(?:day|week)s?\s+(?:assignment|duration))\b/i.test(text))return"SHORT_TERM";
  return"UNKNOWN";
}

/**
 * A stated dollar "incentive" is NOT a per diem. Per diem is a subsistence
 * allowance; an attendance/production incentive is compensation. The existing
 * classifier rewards hasPerDiem specifically, so only literal per-diem wording
 * sets it -- IBEW 716's real "$50 incentive per day" row therefore records an
 * incentive and leaves hasPerDiem false.
 */
export const statesPerDiem=(text:string|null):boolean=>text!==null&&/\bper[-\s]?diem\b/i.test(text);

export interface ListingSignalContext{
  sourceKey:string;
  observedAt:Date;
}

function rolesOf(o:ProductionObservation):ElectricalRole[]{
  const raw=str(o.facts.recognizedElectricalRoles);
  return raw?raw.split(",").filter(Boolean)as ElectricalRole[]:[];
}

/** Assembles the full text the SOURCE stated for this row, for sector/duration
 * checks only. Promotion never reads this -- it reads title/project via
 * discovery-promotion.ts's own promotionEvidenceText(). */
function statedText(o:ProductionObservation):string|null{
  const parts=[o.title,str(o.facts.rawListingText),str(o.facts.schedule),str(o.facts.incentive),str(o.facts.jobsite),str(o.facts.department)];
  const joined=parts.filter((v):v is string=>!!v).join(" — ");
  return joined.length>0?joined:null;
}

export function inputFromListingObservation(o:ProductionObservation):DemandSignalPriorityInput{
  const text=statedText(o);
  const schedule=str(o.facts.schedule);
  return{
    sector:statesDataCentreSector(text)?"DATA_CENTER":"UNKNOWN",
    role:toDemandSignalRole(rolesOf(o)),
    hoursPerWeek:hoursPerWeekFromSchedule(schedule),
    hasOvertime:text!==null&&/\bover[-\s]?time\b/i.test(text),
    hasPerDiem:statesPerDiem(text),
    duration:durationFromText(text),
    headcount:num(o.facts.headcount)
  };
}

export function demandSignalsFromListingObservations(observations:readonly ProductionObservation[],ctx:ListingSignalContext):DemandSignal[]{
  return observations.map(o=>{
    const input=inputFromListingObservation(o);
    const classification=classifyDemandSignalPriority(input);
    return{
      id:`demand-signal:${o.externalId}`,
      sourceKey:ctx.sourceKey,
      externalId:o.externalId,
      sourceUrl:o.sourceUrl,
      title:o.title,
      organization:o.organization,
      location:o.location,
      // The row's own requirement/description text when it stated one. Never
      // the employer name, and never the raw title echoed back.
      project:str(o.facts.rawListingText)!==o.title?str(o.facts.rawListingText):null,
      buyerCandidate:str(o.facts.buyer),
      af01Candidate:str(o.facts.manpowerAcceptance),
      contactPerson:str(o.facts.contact),
      observedAt:ctx.observedAt,
      input,
      tier:classification.tier,
      ruleVersion:classification.ruleVersion,
      reasons:classification.reasons
    };
  });
}

export interface DiscoveredOpportunity{
  tracked:TrackedDiscoverySignal;
  needs:VerificationNeedsResult;
}

export interface ListingDiscoveryRun{
  sourceKey:string;
  listingUrl:string;
  listingsObserved:number;
  electricalListings:number;
  signals:DemandSignal[];
  newSignals:number;
  duplicatesSuppressed:number;
  tracked:TrackedDiscoverySignal[];
  opportunities:DiscoveredOpportunity[];
}

/** Builds the verification needs for a promoted signal from the facts its own
 * observation actually captured. */
export function needsForObservation(o:ProductionObservation,signal:DemandSignal):VerificationNeedsResult{
  return deriveVerificationNeeds({
    buyer:signal.buyerCandidate,
    manpowerAcceptance:signal.af01Candidate,
    contact:signal.contactPerson,
    project:signal.project,
    wage:str(o.facts.wage),
    hoursOrSchedule:str(o.facts.schedule),
    perDiemOrIncentive:str(o.facts.incentive),
    headcount:num(o.facts.headcount),
    postingDate:str(o.facts.dispatchDateRaw)??str(o.facts.postedAtRaw)??str(o.facts.pageModifiedRaw)
  });
}

/**
 * One full pass: observations -> deduped demand signals -> promotion ->
 * verification needs. Idempotent by stable externalId, so re-running a scan
 * over the same listing (or concatenating two scans of it) yields the same
 * signal and tracked sets, with duplicates counted rather than silently lost.
 */
export function runListingDiscovery(
  observations:readonly ProductionObservation[],
  ctx:ListingSignalContext&{listingUrl:string},
  alreadyTracked:readonly TrackedDiscoverySignal[]=[]
):ListingDiscoveryRun{
  const all=demandSignalsFromListingObservations(observations,ctx);
  const signals=dedupeDemandSignals([...all]);
  const byId=new Map(observations.map(o=>[o.externalId,o]));
  const{tracked}=promoteDemandSignals(signals,alreadyTracked);
  const priorIds=new Set(alreadyTracked.map(t=>t.externalId));

  const opportunities:DiscoveredOpportunity[]=tracked.filter(t=>!priorIds.has(t.externalId)).map(t=>{
    const signal=signals.find(s=>s.externalId===t.externalId)!;
    const observation=byId.get(t.externalId)!;
    return{tracked:t,needs:needsForObservation(observation,signal)};
  });

  return{
    sourceKey:ctx.sourceKey,
    listingUrl:ctx.listingUrl,
    listingsObserved:observations.length,
    electricalListings:observations.filter(o=>o.facts.explicitElectricalRole===true).length,
    signals,
    newSignals:signals.length,
    duplicatesSuppressed:all.length-signals.length,
    tracked,
    opportunities
  };
}
