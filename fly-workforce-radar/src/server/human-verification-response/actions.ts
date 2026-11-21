"use server";
import { revalidatePath } from "next/cache";
import type {
  HumanAnswerDisposition, HumanAuthorityLevel, HumanCommercialMechanism,
  HumanInteractionMethod, HumanInteractionOutcome, HumanVerificationTaskStatus,
} from "../../domain/human-verification";
import { getProductionResponseCaptureOwnershipRunner, getProductionSqlClient, getProductionTransactionRunner } from "../database/production-sql-client";
import { executeProtectedHumanVerificationResponseCapture, type ResponseCaptureOutcome } from "../mutation/protected-human-verification-response-capture";
import { PostgresClaimRepository } from "../repositories/claims/postgres-claim-repository";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresEvidenceRepository } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresHumanVerificationRepository } from "../repositories/human-verification/postgres-human-verification-repository";
import { PostgresIdempotencyRepository } from "../repositories/idempotency/postgres-idempotency-repository";
import { PostgresManpowerAcceptanceRepository } from "../repositories/manpower-acceptance/postgres-manpower-acceptance-repository";
import { PostgresSourceRepository } from "../repositories/source/postgres-source-repository";
import { ClaimService } from "../services/claims/claim-service";
import { HumanVerificationClosureService } from "../services/human-verification/human-verification-closure-service";
import { ManpowerAcceptanceService } from "../services/manpower-acceptance/manpower-acceptance-service";

/**
 * TX-INTEGRITY-03B. Builds a fresh HumanVerificationClosureService bound to
 * whatever single transaction-scoped client a TransactionRunner callback
 * provides -- this is the composition root's job, not the closure service's
 * (which stays entirely Postgres/transaction-agnostic).
 */
function closureServiceFor(client: SqlClient): HumanVerificationClosureService {
  const evidenceRepository = new PostgresEvidenceRepository(client);
  const sourceRepository = new PostgresSourceRepository(client);
  const claimService = new ClaimService(new PostgresClaimRepository(client), evidenceRepository);
  const manpowerAcceptanceService = new ManpowerAcceptanceService(new PostgresManpowerAcceptanceRepository(client));
  return new HumanVerificationClosureService(evidenceRepository, sourceRepository, claimService, manpowerAcceptanceService);
}

export interface ResponseCaptureFormState {
  readonly outcome: ResponseCaptureOutcome | null;
  readonly error: string | null;
}

function str(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value : null;
}

export async function submitHumanVerificationResponseAction(_previous: ResponseCaptureFormState, formData: FormData): Promise<ResponseCaptureFormState> {
  const client = getProductionSqlClient();
  const transactionRunner = getProductionTransactionRunner();
  const ownershipRunner = getProductionResponseCaptureOwnershipRunner();
  if (!client || !transactionRunner || !ownershipRunner) return { outcome: null, error: "verificationResponse.unavailable" };

  const taskId = str(formData, "taskId");
  const idempotencyKey = str(formData, "idempotencyKey");
  const expectedTaskStatus = str(formData, "expectedTaskStatus") as HumanVerificationTaskStatus | null;
  const interactionMethod = str(formData, "interactionMethod") as HumanInteractionMethod | null;
  const interactionOutcome = str(formData, "interactionOutcome") as HumanInteractionOutcome | null;
  const reachedHuman = formData.get("reachedHuman") === "true";
  if (!taskId || !idempotencyKey || !expectedTaskStatus || !interactionMethod || !interactionOutcome) {
    return { outcome: null, error: "verificationResponse.invalidInput" };
  }

  const answerDisposition = str(formData, "answerDisposition") as HumanAnswerDisposition | null;
  const authorityLevel = str(formData, "authorityLevel") as HumanAuthorityLevel | null;
  const commercialMechanism = str(formData, "commercialMechanism") as HumanCommercialMechanism | null;

  const humanVerificationRepository = new PostgresHumanVerificationRepository(client);
  const idempotencyRepository = new PostgresIdempotencyRepository(client);

  const outcome = await executeProtectedHumanVerificationResponseCapture(
    {
      idempotencyKey, taskId, expectedTaskStatus, interactionMethod, interactionOutcome,
      attemptedAt: new Date(), reachedHuman,
      contactRouteId: str(formData, "contactRouteId"), contactPersonId: str(formData, "contactPersonId"),
      personNameSnapshot: str(formData, "personNameSnapshot"), personTitleSnapshot: str(formData, "personTitleSnapshot"),
      departmentSnapshot: str(formData, "departmentSnapshot"), companyRepresentedText: str(formData, "companyRepresentedText"),
      responseVerbatim: str(formData, "responseVerbatim"), responseSummary: str(formData, "responseSummary"),
      answerDisposition, authorityLevel, authorityBasis: str(formData, "authorityBasis"), commercialMechanism,
      followUpRequired: formData.get("followUpRequired") === "true", followUpTarget: str(formData, "followUpTarget"),
      assessmentNotes: str(formData, "assessmentNotes"),
    },
    { humanVerificationRepository, idempotencyRepository, transactionRunner, ownershipRunner, closureServiceFor },
  );

  if (outcome.kind === "EXECUTED" || outcome.kind === "REPLAYED") revalidatePath(`/verification/${taskId}`);
  return { outcome, error: null };
}
