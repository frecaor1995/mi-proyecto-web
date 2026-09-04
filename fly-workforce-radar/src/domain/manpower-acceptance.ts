import type { ExternalManpowerCategory } from "./database";

export const MANPOWER_ACCEPTANCE_RESULTS = [
  "VERIFIED_POSITIVE", "VERIFIED_NEGATIVE", "NOT_VERIFIED", "INSUFFICIENT_EVIDENCE", "STALE",
] as const;
export const MANPOWER_ACCEPTANCE_RULE_VERSION = "af-01@2.0.0";

export type ManpowerAcceptanceResult = (typeof MANPOWER_ACCEPTANCE_RESULTS)[number];
export type PersistedManpowerAcceptanceResult = ManpowerAcceptanceResult | "VERIFIED";
export const normalizeManpowerAcceptanceResult = (result: PersistedManpowerAcceptanceResult): ManpowerAcceptanceResult =>
  result === "VERIFIED" ? "VERIFIED_POSITIVE" : result;
export const isVerifiedPositiveManpowerAcceptance = (result: unknown): boolean =>
  result === "VERIFIED_POSITIVE" || result === "VERIFIED";
export type AcceptanceContext =
  | { type: "PROJECT"; id: string }
  | { type: "OPPORTUNITY"; id: string };

export interface AcceptanceClaimObservation {
  claimId: string;
  category: ExternalManpowerCategory;
  assertionKind: "FACT" | "INFERENCE" | "UNKNOWN";
  verificationState: "UNVERIFIED" | "VERIFIED" | "REJECTED" | "STALE";
  accepted: boolean | null;
  staleAfter: Date | null;
  evidenceIds: string[];
  hasActiveEvidence: boolean;
}

export interface AcceptanceEvaluation {
  id: string;
  companyId: string;
  context: AcceptanceContext | null;
  result: ManpowerAcceptanceResult;
  qualifyingCategories: ExternalManpowerCategory[];
  supportingClaimIds: string[];
  supportingEvidenceIds: string[];
  ignoredClaimIds: string[];
  evaluatedAt: Date;
  ruleVersion: string;
  validUntil: Date | null;
  reason: string;
  explanation: Record<string, unknown>;
}
