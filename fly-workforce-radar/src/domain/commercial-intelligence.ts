import type{ProductionObservationKind}from"./production-capture";import type{SourceFamily,SourceTier}from"./production-source";
export type CommercialSourceDecision="ACTIVATE"|"DEFER"|"UNDER_REVIEW"|"BLOCKED"|"REJECT";
export interface CommercialSourceEvaluation{key:string;name:string;family:SourceFamily;tier:SourceTier;endpoint:string;markets:string[];decision:CommercialSourceDecision;reason:string;risk:string;gapsClosed:string[]}
export interface CommercialSourceDefinition extends CommercialSourceEvaluation{decision:"ACTIVATE";adapterId:string;parserId:string;kind:ProductionObservationKind;titlePattern:RegExp;organizationPattern:RegExp;locationPattern?:RegExp;externalIdPattern?:RegExp;buyerPattern?:RegExp;af01Pattern?:RegExp;contactPattern?:RegExp;payPattern?:RegExp;perDiemPattern?:RegExp;headcountPattern?:RegExp;schedulePattern?:RegExp}
export interface FreshnessInput{lastSuccessfulCapture:Date|null;lastEvidenceAt:Date|null;staleAfterMinutes:number;asOf:Date}
export interface FreshnessResult{state:"FRESH"|"STALE"|"UNKNOWN";ageMinutes:number|null;sourceHealth:"HEALTHY"|"STALE"|"UNKNOWN"}
