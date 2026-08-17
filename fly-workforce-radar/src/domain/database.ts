export const ACCESS_CLASSIFICATIONS = [
  "PUBLIC",
  "ACCOUNT_REQUIRED",
  "REQUIRES_LOGIN",
  "PAYWALLED",
  "RESTRICTED",
  "UNKNOWN",
] as const;

export const COMPANY_ROLES = [
  "OWNER",
  "EPC",
  "GC",
  "ELECTRICAL_CONTRACTOR",
  "EMPLOYER",
  "STAFFING_SUPPLIER",
  "MANPOWER_BUYER",
] as const;

export const ASSERTION_KINDS = ["FACT", "INFERENCE", "UNKNOWN"] as const;

export const VERIFICATION_STATES = [
  "UNVERIFIED",
  "VERIFIED",
  "REJECTED",
  "STALE",
] as const;

export const VENDOR_ROUTE_TYPES = [
  "SUPPLIER_PORTAL",
  "ARIBA",
  "TRADE_PARTNER",
  "THIRD_PARTY_RECRUITER",
  "REGISTER_FORM",
  "PROCUREMENT_EMAIL",
  "PROCUREMENT_PHONE",
  "OTHER",
] as const;

export const EXTERNAL_MANPOWER_CATEGORIES = [
  "STAFFING_VENDOR_ACCEPTED",
  "SUPPLEMENTAL_LABOR_ACCEPTED",
  "CONTINGENT_WORKFORCE_ACCEPTED",
  "CRAFT_LABOR_VENDOR_ACCEPTED",
  "THIRD_PARTY_RECRUITING_ACCEPTED",
  "LABOR_SUBCONTRACTING_ACCEPTED",
] as const;

export const CONTACT_ROUTE_GRADES = ["A", "B", "C", "D", "E"] as const;

export const DEMAND_CLUSTER_KINDS = ["POSSIBLE_SHARED_DEMAND_CLUSTER"] as const;

export type AccessClassification = (typeof ACCESS_CLASSIFICATIONS)[number];
export type CompanyRole = (typeof COMPANY_ROLES)[number];
export type AssertionKind = (typeof ASSERTION_KINDS)[number];
export type VerificationState = (typeof VERIFICATION_STATES)[number];
export type VendorRouteType = (typeof VENDOR_ROUTE_TYPES)[number];
export type ExternalManpowerCategory = (typeof EXTERNAL_MANPOWER_CATEGORIES)[number];
export type ContactRouteGrade = (typeof CONTACT_ROUTE_GRADES)[number];
export type DemandClusterKind = (typeof DEMAND_CLUSTER_KINDS)[number];
