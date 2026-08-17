import type { AcceptanceClaimObservation, AcceptanceContext, AcceptanceEvaluation } from "../../../domain/manpower-acceptance";
import { MANPOWER_ACCEPTANCE_RULE_VERSION } from "../../../domain/manpower-acceptance";
import type { ManpowerAcceptanceRepository } from "../../repositories/manpower-acceptance/manpower-acceptance-repository";

const unique = <Value>(values: Value[]) => [...new Set(values)];

export class ManpowerAcceptanceService {
  constructor(
    private readonly repository: ManpowerAcceptanceRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async evaluate(companyId: string, context: AcceptanceContext | null = null): Promise<AcceptanceEvaluation> {
    const evaluatedAt = this.clock();
    const observations = await this.repository.listClaimObservations(companyId, context);
    const currentFact = (claim: AcceptanceClaimObservation) =>
      claim.assertionKind === "FACT"
      && claim.verificationState === "VERIFIED"
      && claim.hasActiveEvidence
      && (claim.staleAfter === null || claim.staleAfter > evaluatedAt);
    const positive = observations.filter((claim) => currentFact(claim) && claim.accepted === true);
    const negative = observations.filter((claim) => currentFact(claim) && claim.accepted === false);
    const stalePositive = observations.filter((claim) =>
      claim.assertionKind === "FACT" && claim.verificationState === "VERIFIED"
      && claim.hasActiveEvidence && claim.accepted === true
      && claim.staleAfter !== null && claim.staleAfter <= evaluatedAt,
    );

    let result: AcceptanceEvaluation["result"];
    let reason: string;
    if (positive.length > 0 && negative.length > 0) {
      result = "INSUFFICIENT_EVIDENCE";
      reason = "Conflicting current verified evidence requires review";
    } else if (positive.length > 0) {
      result = "VERIFIED";
      reason = "At least one current VERIFIED AF-01 FACT has active supporting evidence";
    } else if (stalePositive.length > 0) {
      result = "STALE";
      reason = "All otherwise qualifying positive AF-01 claims are stale";
    } else if (observations.length > 0) {
      result = "INSUFFICIENT_EVIDENCE";
      reason = "AF-01 observations exist but none currently satisfy every verification rule";
    } else {
      result = "NOT_VERIFIED";
      reason = "No AF-01 acceptance claim exists; absence is not denial";
    }

    const supporting = result === "VERIFIED" ? positive : [];
    const ignored = observations.filter((claim) => !supporting.includes(claim));
    const validDates = supporting.flatMap((claim) => claim.staleAfter ? [claim.staleAfter] : []);
    return this.repository.saveEvaluation({
      companyId, context, result,
      qualifyingCategories: unique(supporting.map((claim) => claim.category)),
      supportingClaimIds: supporting.map((claim) => claim.claimId),
      supportingEvidenceIds: unique(supporting.flatMap((claim) => claim.evidenceIds)),
      ignoredClaimIds: ignored.map((claim) => claim.claimId),
      evaluatedAt, ruleVersion: MANPOWER_ACCEPTANCE_RULE_VERSION,
      validUntil: validDates.length === 0 ? null : new Date(Math.min(...validDates.map(Number))),
      reason,
      explanation: {
        evaluatedClaims: observations.length,
        qualifyingPositiveClaims: positive.map((claim) => claim.claimId),
        conflictingNegativeClaims: negative.map((claim) => claim.claimId),
        stalePositiveClaims: stalePositive.map((claim) => claim.claimId),
        ignoredClaims: ignored.map((claim) => ({
          id: claim.claimId, assertionKind: claim.assertionKind,
          verificationState: claim.verificationState, hasActiveEvidence: claim.hasActiveEvidence,
        })),
      },
    });
  }
}
