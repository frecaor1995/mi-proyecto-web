import type { ProductionObservationKind } from "./production-capture";
import type { SourceFamily, SourceTier } from "./production-source";
export type ExpansionDecision="ACTIVATE"|"DEFER"|"UNDER_REVIEW"|"BLOCKED"|"REJECT";
export interface EvaluatedSource{key:string;name:string;family:SourceFamily;tier:SourceTier;endpoint:string;markets:string[];decision:ExpansionDecision;reason:string;capabilities:string[];risk:string}
export interface ExpandedSourceDefinition extends EvaluatedSource{decision:"ACTIVATE";adapterId:string;parserId:string;kind:ProductionObservationKind;titlePattern:RegExp;organizationPattern:RegExp;locationPattern?:RegExp}
