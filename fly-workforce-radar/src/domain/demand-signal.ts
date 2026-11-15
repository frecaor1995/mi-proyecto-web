import type{DemandSignalPriorityInput,DemandSignalPriorityTier}from"./demand-signal-priority";

/**
 * Discovery-phase demand signal record shape. Combines a captured
 * ProductionObservation's identity/evidence with the pure classification
 * produced by classifyDemandSignalPriority (demand-signal-priority.ts),
 * without touching that classifier's own logic. buyerCandidate, af01Candidate
 * and contactPerson stay null whenever the originating source text does not
 * explicitly state them -- discovery precedes eligibility, and an unqualified
 * signal is still preserved, never fabricated or dropped.
 */
export interface DemandSignal{
  id:string;
  sourceKey:string;
  externalId:string;
  sourceUrl:string;
  title:string|null;
  organization:string|null;
  location:string|null;
  /** Only set when the source's own text explicitly names a project/description
   * distinct from bare identifiers -- never inferred. */
  project:string|null;
  buyerCandidate:string|null;
  af01Candidate:string|null;
  contactPerson:string|null;
  observedAt:Date;
  input:DemandSignalPriorityInput;
  tier:DemandSignalPriorityTier;
  ruleVersion:string;
  reasons:string[];
}
