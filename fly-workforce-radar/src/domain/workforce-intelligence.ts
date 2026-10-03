import type { VerificationState } from "./verification";

export const WORKER_LEVEL_CODES=["APPRENTICE","JOURNEYMAN","MASTER","FOREMAN","TECHNICIAN","HELPER","OTHER"] as const;
export type WorkerLevelCode=(typeof WORKER_LEVEL_CODES)[number];
export type ExplicitState="YES"|"NO"|"UNKNOWN";
export type PerDiemState="REQUIRES"|"ACCEPTS"|"NOT_REQUIRED"|"UNKNOWN";
export type ToolsState="YES"|"NO"|"PARTIAL"|"UNKNOWN";
export type ShiftCode="DAY"|"NIGHT"|"ROTATING";
export type WorkerConsentPurpose="DATA_USE"|"CANDIDATE_PRESENTATION";
export type WorkerConsentState="GRANTED"|"REVOKED"|"UNKNOWN";
export type CredentialExpirationBand="EXPIRED"|"WITHIN_30"|"WITHIN_60"|"WITHIN_90"|"LATER"|"UNKNOWN";

export interface WorkerLevelFact{readonly code:WorkerLevelCode;readonly verificationState:VerificationState}
export interface WorkerCredentialIntelligence{readonly id:string;readonly credentialCode:string;readonly jurisdiction:string|null;readonly verificationState:VerificationState;readonly expiresAt:Date|null;readonly lifecycleStatus:"CURRENT"|"SUPERSEDED"|"REVOKED"|"UNKNOWN"}
export interface WorkerMobilityFact{readonly inStateTravel:ExplicitState;readonly outOfStateTravel:ExplicitState;readonly relocation:ExplicitState}
export interface WorkerConditionFact{readonly perDiem:PerDiemState;readonly transportation:ExplicitState;readonly tools:ToolsState;readonly maximumHoursPerWeek:number|null;readonly overtime:ExplicitState;readonly verificationState:VerificationState}
export interface WorkerConsentFact{readonly purpose:WorkerConsentPurpose;readonly state:WorkerConsentState;readonly effectiveAt:Date}
export interface WorkerDocumentFact{readonly documentType:string;readonly readinessState:"KNOWN"|"VERIFIED"|"MISSING"|"EXPIRED"|"REQUIRES_VERIFICATION"|"UNKNOWN";readonly expiresAt:Date|null;readonly verificationState:VerificationState}
export interface WorkerIntelligenceFacts{readonly canonicalAssignment?:{readonly tradeCode:string;readonly occupationCode:string;readonly verificationState:VerificationState}|null;readonly level:WorkerLevelFact|null;readonly credentials:readonly WorkerCredentialIntelligence[];readonly mobility:WorkerMobilityFact|null;readonly conditions:WorkerConditionFact|null;readonly shifts:readonly {readonly code:ShiftCode;readonly verificationState:VerificationState}[];readonly consents:readonly WorkerConsentFact[];readonly documents:readonly WorkerDocumentFact[]}

export type WorkerReadinessBlocker="WORKER_INACTIVE"|"AVAILABILITY_UNKNOWN"|"WORKER_UNAVAILABLE"|"DATA_USE_CONSENT_MISSING"|"PRESENTATION_CONSENT_MISSING"|"PROFILE_UNVERIFIED"|"CREDENTIAL_EXPIRED"|"CREDENTIAL_VERIFICATION_INCOMPLETE"|"DOCUMENT_READINESS_INCOMPLETE";
export interface WorkerGeneralReadiness{readonly state:"READY"|"NEEDS_ATTENTION"|"BLOCKED";readonly blockers:readonly WorkerReadinessBlocker[]}

export function credentialExpirationBand(expiresAt:Date|null,asOf=new Date()):CredentialExpirationBand{
  if(!expiresAt)return "UNKNOWN";
  const days=Math.ceil((expiresAt.getTime()-asOf.getTime())/86400000);
  if(days<0)return "EXPIRED";
  if(days<=30)return "WITHIN_30";
  if(days<=60)return "WITHIN_60";
  if(days<=90)return "WITHIN_90";
  return "LATER";
}

export function deriveWorkerReadiness(input:{readonly lifecycle:string;readonly profileVerificationState:string;readonly availability:string|null;readonly facts:WorkerIntelligenceFacts;readonly asOf?:Date}):WorkerGeneralReadiness{
  const blockers:WorkerReadinessBlocker[]=[];
  if(input.lifecycle!=="ACTIVE")blockers.push("WORKER_INACTIVE");
  if(input.availability===null||input.availability==="UNKNOWN"||input.availability==="COMMITTED")blockers.push("AVAILABILITY_UNKNOWN");
  else if(input.availability==="UNAVAILABLE")blockers.push("WORKER_UNAVAILABLE");
  const consent=(purpose:WorkerConsentPurpose)=>input.facts.consents.find(c=>c.purpose===purpose)?.state??"UNKNOWN";
  if(consent("DATA_USE")!=="GRANTED")blockers.push("DATA_USE_CONSENT_MISSING");
  if(consent("CANDIDATE_PRESENTATION")!=="GRANTED")blockers.push("PRESENTATION_CONSENT_MISSING");
  if(input.profileVerificationState!=="VERIFIED")blockers.push("PROFILE_UNVERIFIED");
  if(input.facts.credentials.some(c=>credentialExpirationBand(c.expiresAt,input.asOf)==="EXPIRED"))blockers.push("CREDENTIAL_EXPIRED");
  if(input.facts.credentials.some(c=>c.verificationState!=="VERIFIED"))blockers.push("CREDENTIAL_VERIFICATION_INCOMPLETE");
  if(input.facts.documents.some(d=>["MISSING","EXPIRED","REQUIRES_VERIFICATION"].includes(d.readinessState)))blockers.push("DOCUMENT_READINESS_INCOMPLETE");
  const hard=blockers.some(b=>["WORKER_INACTIVE","WORKER_UNAVAILABLE","PRESENTATION_CONSENT_MISSING","CREDENTIAL_EXPIRED"].includes(b));
  return{state:hard?"BLOCKED":blockers.length?"NEEDS_ATTENTION":"READY",blockers};
}
