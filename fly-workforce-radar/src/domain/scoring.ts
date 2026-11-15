import type{EligibilityType}from"./eligibility";
export const SCORE_STATES=["SCORED","NOT_SCORABLE"]as const;export type ScoreState=(typeof SCORE_STATES)[number];
export const SCORE_FACTORS=["DEMAND","MANPOWER_ACCEPTANCE","CONTACTABILITY","EVIDENCE_QUALITY","RECENCY","COMMERCIAL_SPECIFICITY"]as const;export type ScoreFactor=(typeof SCORE_FACTORS)[number];
export interface ScoreFactorResult{factor:ScoreFactor;weight:number;points:number;rawInputs:Record<string,unknown>;explanation:string}
export interface ScoreCap{code:string;maximum:number;applied:boolean;reason:string}
export interface ScoreResult{opportunityId:string;scoreName:"MANPOWER_BUSINESS_SCORE";state:ScoreState;score:number|null;ruleVersion:string;evaluatedAt:Date;asOf:Date;eligibilityBasis:{snapshotIds:string[];eligibleTypes:EligibilityType[]};factors:ScoreFactorResult[];caps:ScoreCap[];reviewedIdentifiers:{evidenceIds:string[];claimIds:string[];contactIds:string[];routeIds:string[];reviewDecisionIds:string[]};explanation:string}
export interface ScoreSnapshot extends ScoreResult{id:string;createdAt:Date}
