import type { DemandRequirementLevel } from "./demand-matching";

export const COMMERCIAL_INTAKE_SOURCE_TYPES = ["PHONE_CALL", "EMAIL", "REFERRAL", "CUSTOMER_CONVERSATION", "PUBLIC_SOURCE"] as const;
export type CommercialIntakeSourceType = (typeof COMMERCIAL_INTAKE_SOURCE_TYPES)[number];

export interface CommercialIntakeRequirement { readonly code: string; readonly level: DemandRequirementLevel }
export interface CommercialIntakeInput {
  readonly idempotencyKey: string;
  readonly sourceType: CommercialIntakeSourceType;
  readonly sourceReference: string | null;
  readonly evidenceSummary: string;
  readonly customerName: string;
  readonly opportunityTitle: string;
  readonly projectName: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly tradeCode: string;
  readonly occupationCode: string;
  readonly headcount: number;
  readonly minimumExperienceMonths: number | null;
  readonly startDate: string | null;
  readonly schedule: string | null;
  readonly skills: readonly CommercialIntakeRequirement[];
  readonly credentials: readonly CommercialIntakeRequirement[];
}

export interface CommercialIntakeActivation {
  readonly opportunityId: string;
  readonly demandSignalId: string;
  readonly evidenceId: string;
  readonly replayed: boolean;
  readonly companyResolution: "RESOLVED" | "UNRESOLVED";
  readonly gaps: readonly string[];
}

export type CommercialIntakeResult =
  | { readonly kind: "UNAUTHENTICATED" | "UNAUTHORIZED" | "UNAVAILABLE" }
  | { readonly kind: "VALIDATION_ERROR"; readonly errors: Readonly<Record<string, string>> }
  | { readonly kind: "ACTIVATED"; readonly value: CommercialIntakeActivation };

export function validateCommercialIntake(input: CommercialIntakeInput): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  if (!/^[0-9a-f-]{36}$/i.test(input.idempotencyKey)) errors.idempotencyKey = "invalid";
  if (!COMMERCIAL_INTAKE_SOURCE_TYPES.includes(input.sourceType)) errors.sourceType = "invalid";
  if (!input.evidenceSummary.trim()) errors.evidenceSummary = "required";
  if (!input.customerName.trim()) errors.customerName = "required";
  if (!input.opportunityTitle.trim()) errors.opportunityTitle = "required";
  if (!input.tradeCode.trim()) errors.tradeCode = "required";
  if (!input.occupationCode.trim()) errors.occupationCode = "required";
  if (!Number.isInteger(input.headcount) || input.headcount < 1) errors.headcount = "positiveInteger";
  if (input.minimumExperienceMonths !== null && (!Number.isInteger(input.minimumExperienceMonths) || input.minimumExperienceMonths < 0)) errors.minimumExperienceMonths = "nonNegativeInteger";
  if (input.startDate && Number.isNaN(Date.parse(`${input.startDate}T00:00:00Z`))) errors.startDate = "invalidDate";
  if (input.sourceType === "PUBLIC_SOURCE" && !input.sourceReference?.trim()) errors.sourceReference = "requiredForPublicSource";
  if (new Set(input.skills.map((item) => `${item.code}:${item.level}`)).size !== input.skills.length) errors.skills = "duplicate";
  if (new Set(input.credentials.map((item) => `${item.code}:${item.level}`)).size !== input.credentials.length) errors.credentials = "duplicate";
  return errors;
}
