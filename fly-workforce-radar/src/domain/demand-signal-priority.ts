/**
 * Phase 2Q Data Center Discovery Gap Closure. Discovery must precede eligibility:
 * a demand signal with buyer=UNKNOWN, AF-01=UNKNOWN, contact=UNKNOWN, or
 * project=UNKNOWN must still be discoverable and preserved. This module answers
 * only "how commercially interesting is this raw signal, on its own explicit
 * merits" -- it never touches eligibility, scoring, verification, or Commercial
 * Action, and it never infers a field that was not explicitly observed.
 */
export const DEMAND_SIGNAL_PRIORITY_RULE_VERSION="demand-signal-priority@1.0.0";

export type DemandSignalSector="DATA_CENTER"|"OTHER"|"UNKNOWN";
export type DemandSignalRole="JOURNEYMAN_ELECTRICIAN"|"OTHER"|"UNKNOWN";
export type DemandSignalDuration="LONG_TERM"|"SHORT_TERM"|"UNKNOWN";
export const DEMAND_SIGNAL_PRIORITY_TIERS=["HIGH_VALUE_DATA_CENTER_MANPOWER","STANDARD","LOW_SIGNAL"]as const;
export type DemandSignalPriorityTier=(typeof DEMAND_SIGNAL_PRIORITY_TIERS)[number];

export interface DemandSignalPriorityInput{
  /** Only "DATA_CENTER" when the underlying evidence itself explicitly states a
   * data-center project connection -- never inferred from employer identity,
   * geography, or industry reputation alone. */
  sector:DemandSignalSector;
  role:DemandSignalRole;
  hoursPerWeek:number|null;
  hasOvertime:boolean;
  hasPerDiem:boolean;
  duration:DemandSignalDuration;
  /** Only set when an explicit headcount figure was actually observed; a project's
   * scale, superintendent staffing, or "hiring electricians" language is never
   * enough to populate this. */
  headcount:number|null;
}

const HIGH_HOURS_THRESHOLD=60;

/** Pure classification. Every contributing condition must be explicitly true on
 * the input -- absence of a field never counts toward a higher tier, and no
 * combination of present fields can ever produce a fabricated one. Headcount
 * strengthens the explanation when present but is never required to reach the
 * top tier (a real high-hours, high-per-diem, long-term data-center electrician
 * signal is high-value even with unstated headcount). */
export function classifyDemandSignalPriority(input:DemandSignalPriorityInput):{tier:DemandSignalPriorityTier;ruleVersion:string;reasons:string[]}{
  const reasons:string[]=[];
  const isDataCenter=input.sector==="DATA_CENTER";
  const isElectrician=input.role==="JOURNEYMAN_ELECTRICIAN";
  const isHighHours=input.hoursPerWeek!==null&&input.hoursPerWeek>=HIGH_HOURS_THRESHOLD;
  const isLongTerm=input.duration==="LONG_TERM";

  if(isDataCenter)reasons.push("explicit data-center sector evidence");
  if(isElectrician)reasons.push("journeyman electrician role");
  if(isHighHours)reasons.push(`>=${HIGH_HOURS_THRESHOLD} hours/week explicitly stated`);
  if(input.hasOvertime)reasons.push("overtime explicitly stated");
  if(input.hasPerDiem)reasons.push("per diem explicitly stated");
  if(isLongTerm)reasons.push("long-term duration explicitly stated");
  if(input.headcount!==null)reasons.push(`explicit headcount of ${input.headcount}`);

  if(isDataCenter&&isElectrician&&isHighHours&&input.hasPerDiem&&isLongTerm){
    return{tier:"HIGH_VALUE_DATA_CENTER_MANPOWER",ruleVersion:DEMAND_SIGNAL_PRIORITY_RULE_VERSION,reasons};
  }
  if(reasons.length>0){
    return{tier:"STANDARD",ruleVersion:DEMAND_SIGNAL_PRIORITY_RULE_VERSION,reasons};
  }
  return{tier:"LOW_SIGNAL",ruleVersion:DEMAND_SIGNAL_PRIORITY_RULE_VERSION,reasons:["no explicit high-value signal fields present"]};
}
