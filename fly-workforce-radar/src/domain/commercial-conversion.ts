import type{ActiveHotLead}from"./active-lead";
import type{CommercialAction}from"./commercial-action";
import type{TrackedDiscoverySignal}from"./discovery-promotion";
import type{EligibilityResult}from"./eligibility";
import type{ActionabilityInput,ActionabilityState}from"./opportunity-actionability";
import type{ScoreResult}from"./scoring";
import type{VerificationNeedKind}from"./verification-needs";

export const COMMERCIAL_CONVERSION_PRIORITY_RULE_VERSION="commercial-conversion-priority@1.0.0";
export const COMMERCIAL_CONVERSION_RULE_VERSION="commercial-conversion@1.0.0";
export const SOURCE_ORGANIZATION_PROVENANCE_RULE_VERSION="source-organization-provenance@1.0.0";
export type EvidenceVerificationState="UNVERIFIED"|"VERIFIED"|"REJECTED"|"STALE";
export type CompanyCommercialRole="PROBABLE_END_EMPLOYER"|"ELECTRICAL_CONTRACTOR"|"STAFFING_COMPANY"|"GENERAL_CONTRACTOR"|"SUBCONTRACTOR"|"OWNER"|"UNKNOWN";
export type SourceIdentityClass="FIRST_PARTY_EMPLOYER_SOURCE"|"THIRD_PARTY_OR_MULTI_EMPLOYER_SOURCE"|"UNION_DISPATCH_SOURCE"|"STAFFING_SOURCE"|"UNKNOWN_SOURCE_IDENTITY";
export type OrganizationEvidenceBasis="DIRECT_LISTING"|"VERIFIED_FIRST_PARTY_SOURCE_IDENTITY"|"ROW_STATED_DISPATCH_CONTRACTOR"|"VERIFIED_STAFFING_SOURCE_IDENTITY"|"UNKNOWN";
export interface SourceOrganizationProfile{sourceId:string;sourceUrl:string;identityClass:SourceIdentityClass;organization:string|null;ownershipEvidence:string;observedAt:Date}
export interface OrganizationProvenance{organization:string|null;basis:OrganizationEvidenceBasis;sourceId:string;sourceUrl:string;sourceIdentityClass:SourceIdentityClass;evidenceBasis:string;observedAt:Date;derivationRuleVersion:string;conflicts:string[];companyRole:CompanyCommercialRole;employer:string|null;contractor:string|null;staffingIntermediary:string|null}

export interface ConversionContactEvidence{id:string;organization:string|null;function:string;routeType:string;target:string;gradeCandidate:"A"|"B"|"C"|"D"|"E";verificationState:EvidenceVerificationState;observedAt:Date;staleAfter:Date|null;evidenceIds:string[]}
export interface ConversionAcceptanceEvidence{id:string;category:string;verificationState:EvidenceVerificationState;accepted:boolean|null;observedAt:Date;validUntil:Date|null;evidenceIds:string[]}
export interface ConversionEvidenceInput{
  signal:TrackedDiscoverySignal;
  evidenceIds:string[];
  employer:string|null;
  companyRole:CompanyCommercialRole;
  companyRoleEvidenceIds:string[];
  project:string|null;
  buyer:string|null;
  wage:string|null;
  perDiemOrIncentive:string|null;
  schedule:string|null;
  headcount:number|null;
  acceptance:ConversionAcceptanceEvidence|null;
  contacts:ConversionContactEvidence[];
  actionability:ActionabilityInput;
  conflicts:string[];
  organizationProvenance?:OrganizationProvenance|null;
}
export interface ConversionPriority{score:number;reasons:string[];blockerCount:number;ruleVersion:string}
export interface ConversionVerificationItem{kind:VerificationNeedKind|"VERIFY_BUYER"|"VERIFY_AF01"|"VERIFY_CONTACT_ROUTE"|"VERIFY_CONTACT_GRADE"|"VERIFY_CONFLICT"|"VERIFY_COMPANY_ROLE";currentState:string;supportingEvidenceIds:string[];conflictingEvidence:string[];affectsEligibility:boolean;affectsActiveHot:boolean;recommendedHumanAction:string}
export interface CommercialConversionDossier{
  discoverySignalId:string;sourceId:string;sourceExternalId:string;organization:string|null;role:string|null;location:string|null;
  employer:string|null;companyRole:CompanyCommercialRole;organizationProvenance:OrganizationProvenance|null;project:string|null;buyer:string|null;
  economics:{wage:string|null;perDiemOrIncentive:string|null;schedule:string|null;headcount:number|null};
  acceptance:ConversionAcceptanceEvidence|null;contacts:ConversionContactEvidence[];temporalState:ActionabilityState;
  evidenceIds:string[];conflicts:string[];verificationQueue:ConversionVerificationItem[];
  eligibility:EligibilityResult[];score:ScoreResult;commercialAction:CommercialAction;activeHot:ActiveHotLead[];
  conversionPriority:ConversionPriority;conversionBlockers:string[];failedConversion:boolean;observedAt:Date;
  ruleVersions:string[];
}
