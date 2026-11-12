import { createHash } from "node:crypto";
import type { ClaimCandidate } from "../../../domain/claims";
import type { HumanAnswerDisposition, HumanAuthorityLevel, HumanCommercialMechanism, HumanVerificationScope } from "../../../domain/human-verification";
import { evaluateCanonicalClosure } from "../../../domain/human-verification-closure";
import type { AcceptanceContext, AcceptanceEvaluation } from "../../../domain/manpower-acceptance";
import type { EvidenceRepository } from "../../repositories/evidence/evidence-repository";
import type { SourceRepository } from "../../repositories/source/source-repository";
import type { ClaimService } from "../claims/claim-service";
import type { ManpowerAcceptanceService } from "../manpower-acceptance/manpower-acceptance-service";

const HUMAN_VERIFICATION_SOURCE_NAME = "Human Verification Interactions";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface CloseHumanVerificationResponseInput {
  readonly companyId: string;
  readonly context: AcceptanceContext | null;
  readonly interactionId: string;
  readonly assessmentId: string;
  readonly attemptedAt: Date;
  readonly reachedHuman: boolean;
  readonly answerDisposition: HumanAnswerDisposition;
  readonly authorityLevel: HumanAuthorityLevel;
  readonly commercialMechanism: HumanCommercialMechanism | null;
  readonly scope: HumanVerificationScope;
  readonly responseSummary: string;
  readonly operatorId: string;
}

export type CanonicalClosureOutcome =
  | { readonly kind: "NO_CANONICAL_CHANGE"; readonly reason: string }
  | { readonly kind: "AF01_EVALUATED"; readonly evaluation: AcceptanceEvaluation };

/**
 * Composes, never reimplements: ClaimService (claims/evidence-verified-claim
 * lifecycle) and ManpowerAcceptanceService.evaluate() (the existing, already
 * correct AF01 result computation from ALL current claims). This service's
 * only new logic is the single narrow gate in evaluateCanonicalClosure() --
 * everything downstream of "this response qualifies" is the same canonical
 * machinery every other AF01 evidence path would use.
 */
export class HumanVerificationClosureService {
  constructor(
    private readonly evidenceRepository: EvidenceRepository,
    private readonly sourceRepository: SourceRepository,
    private readonly claimService: ClaimService,
    private readonly manpowerAcceptanceService: ManpowerAcceptanceService,
  ) {}

  private async resolveSource() {
    const existing = await this.sourceRepository.findByName(HUMAN_VERIFICATION_SOURCE_NAME);
    if (existing) return existing;
    return this.sourceRepository.create({ name: HUMAN_VERIFICATION_SOURCE_NAME, sourceType: "HUMAN_INTERACTION", enabled: true });
  }

  async close(input: CloseHumanVerificationResponseInput): Promise<CanonicalClosureOutcome> {
    const decision = evaluateCanonicalClosure({
      reachedHuman: input.reachedHuman,
      answerDisposition: input.answerDisposition,
      authorityLevel: input.authorityLevel,
      commercialMechanism: input.commercialMechanism,
      scope: input.scope,
    });
    if (!decision.qualifies || decision.category === null || decision.accepted === null) {
      return { kind: "NO_CANONICAL_CHANGE", reason: decision.reason };
    }

    const source = await this.resolveSource();
    const contentHash = createHash("sha256").update(`${input.assessmentId}:${input.responseSummary}`).digest("hex");
    const evidence = await this.evidenceRepository.create({
      sourceId: source.id,
      sourceUrl: `internal://human-verification/assessment/${input.assessmentId}`,
      capturedAt: input.attemptedAt,
      captureMethod: "HUMAN_INTERACTION",
      contentHash,
      payloadSizeBytes: Buffer.byteLength(input.responseSummary, "utf8"),
      contentType: "text/plain",
      metadata: { interactionId: input.interactionId, assessmentId: input.assessmentId },
    });

    const candidate: ClaimCandidate = {
      subject: { type: "COMPANY", id: input.companyId },
      predicate: "external_manpower_acceptance_category",
      value: { accepted: decision.accepted, mechanism: input.commercialMechanism, disposition: input.answerDisposition, summary: input.responseSummary },
      assertionKind: "FACT",
      externalManpowerCategory: decision.category,
      evidenceIds: [evidence.id],
      assertedAt: input.attemptedAt,
      assertedBy: input.operatorId,
      staleAfter: new Date(input.attemptedAt.getTime() + ONE_YEAR_MS),
      metadata: {
        contextType: input.context?.type ?? null,
        contextId: input.context?.id ?? null,
        source: "human_verification_assessment",
        assessmentId: input.assessmentId,
      },
    };
    const claim = await this.claimService.create(candidate);
    if (claim.verificationState !== "VERIFIED") {
      await this.claimService.transition({
        claimId: claim.id, newState: "VERIFIED", actor: input.operatorId,
        reason: "Human-verified response captured through 3I-B3 response capture.", evidenceId: evidence.id,
      });
    }

    const evaluation = await this.manpowerAcceptanceService.evaluate(input.companyId, input.context);
    return { kind: "AF01_EVALUATED", evaluation };
  }
}
