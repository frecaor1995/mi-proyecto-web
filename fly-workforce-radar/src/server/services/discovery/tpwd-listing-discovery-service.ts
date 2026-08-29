import type{DemandSignal}from"../../../domain/demand-signal";
import type{DemandSignalPriorityInput}from"../../../domain/demand-signal-priority";
import{classifyDemandSignalPriority}from"../../../domain/demand-signal-priority";
import type{ProductionObservation}from"../../../domain/production-capture";

/**
 * Turns TpwdListingDiscoveryAdapter's captured ProductionObservations into
 * DemandSignal records by feeding each observation's explicitly-observed
 * facts into the existing, unmodified classifyDemandSignalPriority. TPWD
 * bid-listing rows are procurement notices, not staffing/job postings, so
 * sector/hours/overtime/perDiem/duration/headcount are legitimately absent
 * on almost every row -- LOW_SIGNAL or STANDARD is the correct, expected
 * outcome, not a bug. Only a row whose own text explicitly states journeyman
 * electrician work is mapped to that role; nothing here fabricates it.
 */
function inputFromObservation(o:ProductionObservation):DemandSignalPriorityInput{
  const explicitJourneyman=o.facts.explicitJourneymanElectrician===true;
  return{
    // TPWD construction bids never state a data-center project connection.
    sector:"UNKNOWN",
    role:explicitJourneyman?"JOURNEYMAN_ELECTRICIAN":"UNKNOWN",
    hoursPerWeek:null,
    hasOvertime:false,
    hasPerDiem:false,
    duration:"UNKNOWN",
    headcount:null
  };
}

export function demandSignalsFromObservations(observations:ProductionObservation[],observedAt:Date):DemandSignal[]{
  return observations.map(o=>{
    const input=inputFromObservation(o);
    const classification=classifyDemandSignalPriority(input);
    const description=typeof o.facts.description==="string"?o.facts.description:null;
    return{
      id:`demand-signal:${o.externalId}`,
      sourceKey:"tpwd",
      externalId:o.externalId,
      sourceUrl:o.sourceUrl,
      title:o.title,
      organization:o.organization,
      location:o.location,
      // Explicit only when the row's own text supplied a distinguishable
      // description segment -- never falls back to the raw listing text.
      project:description,
      // TPWD's own listing is the buyer's own page; it never names a
      // separate third-party staffing buyer, an AF-01 acceptance status, or
      // a named contact person within the summary-list text.
      buyerCandidate:null,
      af01Candidate:null,
      contactPerson:null,
      observedAt,
      input,
      tier:classification.tier,
      ruleVersion:classification.ruleVersion,
      reasons:classification.reasons
    };
  });
}

/** Idempotent by stable external ID: re-scanning the same listing and
 * feeding the concatenated observations through this must not duplicate
 * signals for the same candidate. */
export function dedupeDemandSignals(signals:DemandSignal[]):DemandSignal[]{
  const seen=new Set<string>();
  const out:DemandSignal[]=[];
  for(const s of signals){
    if(seen.has(s.externalId))continue;
    seen.add(s.externalId);
    out.push(s);
  }
  return out;
}
