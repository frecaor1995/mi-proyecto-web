import type { Fact } from "./worker";

/**
 * MATCHING-B1-C. Demand-side counterpart to worker.ts's MatchingReadyWorkerInput.
 * Pure, deterministic read shapes for the future matching engine (MATCHING-B1).
 * No scoring, no ranking, no STRONG_MATCH/POSSIBLE_MATCH/NO_MATCH/
 * INSUFFICIENT_DATA classification -- that belongs to the engine, not here.
 *
 * tradeCode/occupationCode/minimumExperienceMonths/startDate are the
 * MATCHING-B1-B minimum-readiness columns added to demand_signals.
 * role_type (the closed, electrical-only ingestion enum on demand_signals)
 * is never read by any type or repository method in this file and must
 * never become the authoritative matching field.
 */

export const DEMAND_REQUIREMENT_LEVELS = ["REQUIRED", "PREFERRED"] as const;
export type DemandRequirementLevel = (typeof DEMAND_REQUIREMENT_LEVELS)[number];

export interface DemandSkillRequirementRecord {
  readonly demandSignalId: string;
  readonly skillCode: string;
  readonly requirementLevel: DemandRequirementLevel;
  readonly sourceLabel: string | null;
  readonly rawEvidenceId: string | null;
}

export interface DemandCredentialRequirementRecord {
  readonly demandSignalId: string;
  readonly credentialCode: string;
  readonly requirementLevel: DemandRequirementLevel;
  readonly jurisdiction: string | null;
  readonly sourceRequirementText: string | null;
  readonly rawEvidenceId: string | null;
}

/** Input to the replace-semantics write path (server/repositories/demand). */
export interface SetDemandSkillRequirementInput {
  readonly skillCode: string;
  readonly requirementLevel: DemandRequirementLevel;
  readonly sourceLabel?: string | null;
  readonly rawEvidenceId?: string | null;
}
export interface SetDemandCredentialRequirementInput {
  readonly credentialCode: string;
  readonly requirementLevel: DemandRequirementLevel;
  readonly jurisdiction?: string | null;
  readonly sourceRequirementText?: string | null;
  readonly rawEvidenceId?: string | null;
}
export interface SetDemandRequirementsInput {
  readonly demandSignalId: string;
  readonly skills: readonly SetDemandSkillRequirementInput[];
  readonly credentials: readonly SetDemandCredentialRequirementInput[];
}

/** Raw read of the MATCHING-B1-B minimum-readiness columns for one demand signal. */
export interface DemandMatchingCore {
  readonly demandSignalId: string;
  readonly tradeCode: string | null;
  readonly occupationCode: string | null;
  readonly minimumExperienceMonths: number | null;
  readonly startDate: Date | null;
}

export interface MatchingReadyCompensationDemand {
  readonly payCurrency: string | null;
  readonly basePayMin: number | null;
  readonly basePayMax: number | null;
  readonly payPeriod: string | null;
}

export interface MatchingReadySkillRequirement {
  readonly skillCode: string;
  readonly requirementLevel: DemandRequirementLevel;
}
export interface MatchingReadyCredentialRequirement {
  readonly credentialCode: string;
  readonly requirementLevel: DemandRequirementLevel;
  readonly jurisdiction: string | null;
}

export interface MatchingReadyDemandInput {
  readonly demandSignalId: string;
  readonly tradeCode: string | null;
  readonly occupationCode: string | null;
  readonly minimumExperienceMonths: number | null;
  readonly skills: readonly MatchingReadySkillRequirement[];
  readonly credentials: readonly MatchingReadyCredentialRequirement[];
  readonly startDate: Date | null;
  readonly compensation: Fact<MatchingReadyCompensationDemand>;
}
