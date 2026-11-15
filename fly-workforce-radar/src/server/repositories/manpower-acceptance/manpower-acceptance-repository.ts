import type { AcceptanceClaimObservation, AcceptanceContext, AcceptanceEvaluation, ManpowerAcceptanceResult } from "../../../domain/manpower-acceptance";
import type { ExternalManpowerCategory } from "../../../domain/database";

export interface SaveAcceptanceEvaluation {
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

export interface ManpowerAcceptanceRepository {
  listClaimObservations(companyId: string, context?: AcceptanceContext | null): Promise<AcceptanceClaimObservation[]>;
  saveEvaluation(input: SaveAcceptanceEvaluation): Promise<AcceptanceEvaluation>;
  listEvaluations(companyId: string): Promise<AcceptanceEvaluation[]>;
}
