import { createHash } from "node:crypto";
import type {
  CreateHumanInteractionInput, CreateHumanResponseAssessmentInput, HumanAnswerDisposition, HumanAuthorityLevel,
  HumanCommercialMechanism, HumanInteractionMethod, HumanInteractionOutcome, HumanVerificationTask, HumanVerificationTaskStatus,
} from "../../domain/human-verification";
import type { AcceptanceContext } from "../../domain/manpower-acceptance";
import { authorizeOperator } from "../auth/authorization";
import type { ServerSession } from "../auth/session";
import type { ResponseCaptureOwnershipRunner, TransactionRunner } from "../database/transaction";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import type { HumanVerificationRepository } from "../repositories/human-verification/human-verification-repository";
import { PostgresHumanVerificationRepository } from "../repositories/human-verification/postgres-human-verification-repository";
import type { IdempotencyRepository } from "../repositories/idempotency/idempotency-repository";
import { PostgresIdempotencyRepository } from "../repositories/idempotency/postgres-idempotency-repository";
import type { OperatorRepository } from "../repositories/operator/operator-repository";
import type { CloseHumanVerificationResponseInput, HumanVerificationClosureService } from "../services/human-verification/human-verification-closure-service";
import { attemptResponseCaptureRecovery } from "./response-capture-recovery";

export interface ResponseCaptureInput {
  readonly idempotencyKey: string;
  readonly taskId: string;
  readonly expectedTaskStatus: HumanVerificationTaskStatus;
  readonly interactionMethod: HumanInteractionMethod;
  readonly interactionOutcome: HumanInteractionOutcome;
  readonly attemptedAt: Date;
  readonly reachedHuman: boolean;
  readonly contactRouteId?: string | null;
  readonly contactPersonId?: string | null;
  readonly personNameSnapshot?: string | null;
  readonly personTitleSnapshot?: string | null;
  readonly departmentSnapshot?: string | null;
  readonly companyRepresentedText?: string | null;
  readonly responseVerbatim?: string | null;
  readonly responseSummary?: string | null;
  /** Present only when reachedHuman is true and a substantive answer was given; the DB trigger require_assessable_human_interaction already rejects an assessment on a non-substantive outcome, so these are simply omitted for class-G (no-answer/voicemail/etc.) submissions. */
  readonly answerDisposition?: HumanAnswerDisposition | null;
  readonly authorityLevel?: HumanAuthorityLevel | null;
  readonly authorityBasis?: string | null;
  readonly commercialMechanism?: HumanCommercialMechanism | null;
  readonly followUpRequired?: boolean;
  readonly followUpTarget?: string | null;
  readonly assessmentNotes?: string | null;
}

export interface ResponseCaptureDeps {
  readonly humanVerificationRepository: HumanVerificationRepository;
  readonly idempotencyRepository: IdempotencyRepository;
  /**
   * TX-INTEGRITY-03B. The certified TransactionRunner (see TX-INTEGRITY-02/
   * 3I-B3R1) -- used to scope the canonical closure unit (evidence create ->
   * claim createOrGet -> evidence link -> claim transition -> AF01
   * evaluate+save) as one real transaction, and to scope each individual
   * task-transition hop as its own separate transaction. Never nested: the
   * closure call and each transition-hop call are each their own top-level
   * invocation of this runner, never inside one another. TX-INTEGRITY-04B
   * reuses the same runner for its own recovery-scoped transactions (one
   * per phase being recovered), for the identical reason.
   */
  readonly transactionRunner: TransactionRunner;
  /** TX-INTEGRITY-04B-R1: continuous, same-session ownership shared by the
   * fresh CLAIMED path and every IN_PROGRESS recovery path. */
  readonly ownershipRunner: ResponseCaptureOwnershipRunner;
  /**
   * TX-INTEGRITY-03B. A transaction-scoped-repository factory (mirrors
   * HumanVerificationTransactionalAccess.repositoryFor from TX-INTEGRITY-02)
   * -- builds a fresh HumanVerificationClosureService bound to the one
   * SqlClient a given TransactionRunner callback provides, so every write
   * inside close() lands on the same connection. HumanVerificationClosure-
   * Service itself remains entirely transaction-agnostic; only the
   * composition root (a real caller, or a test) knows how to construct one
   * from a client.
   */
  readonly closureServiceFor: (client: SqlClient) => HumanVerificationClosureService;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
}

export interface CapturedResponseFields {
  readonly taskId: string;
  readonly newTaskStatus: HumanVerificationTaskStatus;
  readonly interactionId: string;
  readonly assessmentId: string | null;
  readonly canonicalOutcome: "NO_CANONICAL_CHANGE" | "AF01_EVALUATED";
  readonly af01Result?: string;
}
export type ResponseCaptureOutcome =
  | { readonly kind: "REJECTED"; readonly reason: string; readonly detail?: string }
  | ({ readonly kind: "EXECUTED" } & CapturedResponseFields)
  | ({ readonly kind: "REPLAYED" } & CapturedResponseFields);

export type StoredResult =
  | { readonly kind: "INVALID_TRANSITION" }
  | { readonly kind: "STALE_STATE" }
  | { readonly kind: "TASK_NOT_FOUND" }
  | ({ readonly kind: "EXECUTED" } & CapturedResponseFields);

export function fingerprint(input: ResponseCaptureInput): string {
  const material = {
    taskId: input.taskId, expectedTaskStatus: input.expectedTaskStatus,
    interactionMethod: input.interactionMethod, interactionOutcome: input.interactionOutcome,
    attemptedAt: input.attemptedAt.toISOString(), reachedHuman: input.reachedHuman,
    responseSummary: input.responseSummary ?? null, answerDisposition: input.answerDisposition ?? null,
    authorityLevel: input.authorityLevel ?? null, commercialMechanism: input.commercialMechanism ?? null,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

/**
 * TX-INTEGRITY-04B. Pure, deterministic builders for the interaction/
 * assessment/closure inputs response capture produces -- shared by the
 * normal execution path below AND by response-capture-recovery.ts, so a
 * recovered interaction/assessment/closure attempt is byte-for-byte the
 * same shape a successful first attempt would have produced from the same
 * (idempotency-verified-identical) resubmitted payload. This is also where
 * the recovery correlation stamp is written -- in the SAME object that
 * becomes the SAME INSERT statement, never a follow-up statement.
 */
export function buildInteractionInput(input: ResponseCaptureInput, task: HumanVerificationTask, operatorId: string): CreateHumanInteractionInput {
  return {
    verificationTaskId: input.taskId,
    interactionMethod: input.interactionMethod,
    interactionOutcome: input.interactionOutcome,
    attemptedAt: input.attemptedAt,
    operatorId,
    routeSnapshot: { contactRouteId: input.contactRouteId ?? null },
    reachedHuman: input.reachedHuman,
    contactRouteId: input.contactRouteId ?? null,
    contactPersonId: input.contactPersonId ?? null,
    personNameSnapshot: input.personNameSnapshot ?? null,
    personTitleSnapshot: input.personTitleSnapshot ?? null,
    departmentSnapshot: input.departmentSnapshot ?? null,
    companyRepresentedId: task.companyId,
    companyRepresentedText: input.companyRepresentedText ?? null,
    responseVerbatim: input.responseVerbatim ?? null,
    responseSummary: input.responseSummary ?? null,
    metadata: { idempotencyKey: input.idempotencyKey },
  };
}

export function buildAssessmentInput(
  input: ResponseCaptureInput, task: HumanVerificationTask, interactionId: string, operatorId: string,
  answerDisposition: HumanAnswerDisposition, authorityLevel: HumanAuthorityLevel,
): CreateHumanResponseAssessmentInput {
  return {
    interactionId,
    answerDisposition,
    authorityLevel,
    authorityBasis: input.authorityBasis ?? "Operator-recorded authority basis",
    scope: task.scope,
    confidence: 1,
    assessedBy: operatorId,
    assessorKind: "HUMAN",
    assessedAt: input.attemptedAt,
    approvalState: "APPROVED",
    approvedBy: operatorId,
    ruleVersion: "human-verification-closure@1.0.0",
    commercialMechanism: input.commercialMechanism ?? null,
    companyId: task.companyId,
    projectId: task.projectId ?? null,
    opportunityId: task.opportunityId ?? null,
    followUpRequired: input.followUpRequired ?? (input.answerDisposition === "REFERRAL"),
    followUpTarget: input.followUpTarget ?? null,
    assessmentNotes: input.assessmentNotes ?? null,
    idempotencyKey: input.idempotencyKey,
  };
}

export function buildClosureInput(
  input: ResponseCaptureInput, task: HumanVerificationTask, interactionId: string, assessmentId: string, operatorId: string,
  answerDisposition: HumanAnswerDisposition, authorityLevel: HumanAuthorityLevel,
): CloseHumanVerificationResponseInput {
  const context: AcceptanceContext | null = task.projectId
    ? { type: "PROJECT", id: task.projectId }
    : task.opportunityId ? { type: "OPPORTUNITY", id: task.opportunityId } : null;
  return {
    companyId: task.companyId,
    context,
    interactionId,
    assessmentId,
    attemptedAt: input.attemptedAt,
    reachedHuman: input.reachedHuman,
    answerDisposition,
    authorityLevel,
    commercialMechanism: input.commercialMechanism ?? null,
    scope: task.scope,
    responseSummary: input.responseSummary ?? input.responseVerbatim ?? "",
    operatorId,
  };
}

/**
 * The 3I-B3 protected mutation. Extends the exact B3A trust chain
 * (authenticated session -> authorized operator -> idempotency claim ->
 * concurrency-guarded repository writes -> existing append-only audit trail)
 * with the actual response-capture work: record the interaction, optionally
 * record the assessment (only for a substantive, reached outcome), run the
 * narrow canonical-closure gate, and advance the task status through
 * individually-valid, policy-map-checked hops. Actor identity comes only
 * from the resolved AuthorizedOperator -- ResponseCaptureInput has no actor
 * field for a caller to supply.
 *
 * TX-INTEGRITY-04B: an IN_PROGRESS claim (a same-key/same-actor/same-target/
 * same-payload retry of an operation that did not reach idempotency
 * completion, whether because it is still executing or because it crashed
 * partway through) is no longer an unconditional rejection -- it is handed
 * to attemptResponseCaptureRecovery, which inspects durable correlated
 * state and resumes only whatever is actually missing. See
 * response-capture-recovery.ts for the full recovery algorithm.
 */
export async function executeProtectedHumanVerificationResponseCapture(
  input: ResponseCaptureInput,
  deps: ResponseCaptureDeps,
): Promise<ResponseCaptureOutcome> {
  const authorization = await authorizeOperator("human_verification.write", {
    getSession: deps.getSession,
    repository: deps.operatorRepository,
  });
  if (authorization.state === "UNAUTHENTICATED") return { kind: "REJECTED", reason: "UNAUTHENTICATED" };
  if (authorization.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { kind: "REJECTED", reason: "UNAUTHORIZED" };
  const operator = authorization.operator;

  // Idempotency is checked before re-validating current task state: a retry of an
  // already-succeeded submission must replay its stored result, even though the
  // task has legitimately moved on since then -- that is not a stale conflict.
  const claim = await deps.idempotencyRepository.claim({
    idempotencyKey: input.idempotencyKey,
    operatorId: operator.operatorId,
    action: "human_verification.capture_response",
    targetType: "HUMAN_VERIFICATION_TASK",
    targetId: input.taskId,
    requestFingerprint: fingerprint(input),
  });
  if (claim.outcome === "CONFLICT") {
    return claim.reason === "TASK_CAPTURE_IN_PROGRESS"
      ? { kind: "REJECTED", reason: "TASK_CAPTURE_IN_PROGRESS" }
      : { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: claim.reason };
  }
  if (claim.outcome === "REPLAY") {
    const stored = claim.result as StoredResult;
    if (stored.kind !== "EXECUTED") return { kind: "REJECTED", reason: stored.kind };
    return { kind: "REPLAYED", taskId: stored.taskId, newTaskStatus: stored.newTaskStatus, interactionId: stored.interactionId, assessmentId: stored.assessmentId, canonicalOutcome: stored.canonicalOutcome, af01Result: stored.af01Result };
  }

  // TX-INTEGRITY-04B-R1. Both a newly CLAIMED request and a same-key
  // IN_PROGRESS request enter the identical session-ownership protocol before
  // any durable business effect. The initial claim is intentionally re-read
  // on the owned session after lock acquisition because another worker may
  // have completed while this worker was waiting.
  return deps.ownershipRunner(input.idempotencyKey, async ({ client, transactionRunner }) => {
    const ownedIdempotencyRepository = new PostgresIdempotencyRepository(client);
    const postLockClaim = await ownedIdempotencyRepository.claim({
      idempotencyKey: input.idempotencyKey,
      operatorId: operator.operatorId,
      action: "human_verification.capture_response",
      targetType: "HUMAN_VERIFICATION_TASK",
      targetId: input.taskId,
      requestFingerprint: fingerprint(input),
    });
    if (postLockClaim.outcome === "CONFLICT") {
      return postLockClaim.reason === "TASK_CAPTURE_IN_PROGRESS"
        ? { kind: "REJECTED", reason: "TASK_CAPTURE_IN_PROGRESS" }
        : { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: postLockClaim.reason };
    }
    if (postLockClaim.outcome === "REPLAY") {
      const stored = postLockClaim.result as StoredResult;
      if (stored.kind !== "EXECUTED") return { kind: "REJECTED", reason: stored.kind };
      return { kind: "REPLAYED", taskId: stored.taskId, newTaskStatus: stored.newTaskStatus, interactionId: stored.interactionId, assessmentId: stored.assessmentId, canonicalOutcome: stored.canonicalOutcome, af01Result: stored.af01Result };
    }
    if (postLockClaim.outcome === "CLAIMED") {
      return { kind: "REJECTED", reason: "RECOVERY_INTEGRITY_CONFLICT", detail: "idempotency row disappeared after the initial claim" };
    }

    const ownedDeps: ResponseCaptureDeps = {
      ...deps,
      humanVerificationRepository: new PostgresHumanVerificationRepository(client),
      idempotencyRepository: ownedIdempotencyRepository,
      transactionRunner,
    };
    return attemptResponseCaptureRecovery(input, ownedDeps, operator.operatorId, postLockClaim.claimedAt);
  });
}
