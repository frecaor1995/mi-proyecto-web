import { createHash } from "node:crypto";
import type {
  HumanAnswerDisposition, HumanAuthorityLevel, HumanCommercialMechanism,
  HumanInteractionMethod, HumanInteractionOutcome, HumanVerificationTaskStatus,
} from "../../domain/human-verification";
import { desiredResponseTaskStatus, planTaskStatusHops } from "../../domain/human-verification-closure";
import type { AcceptanceContext } from "../../domain/manpower-acceptance";
import { authorizeOperator } from "../auth/authorization";
import type { ServerSession } from "../auth/session";
import type { TransactionRunner } from "../database/transaction";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import type { HumanVerificationRepository } from "../repositories/human-verification/human-verification-repository";
import { PostgresHumanVerificationRepository } from "../repositories/human-verification/postgres-human-verification-repository";
import type { IdempotencyRepository } from "../repositories/idempotency/idempotency-repository";
import type { OperatorRepository } from "../repositories/operator/operator-repository";
import type { HumanVerificationClosureService } from "../services/human-verification/human-verification-closure-service";
import { HUMAN_VERIFICATION_TASK_TRANSITIONS, HumanVerificationService } from "../services/human-verification/human-verification-service";

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
   * invocation of this runner, never inside one another.
   */
  readonly transactionRunner: TransactionRunner;
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

type StoredResult =
  | { readonly kind: "INVALID_TRANSITION" }
  | { readonly kind: "STALE_STATE" }
  | { readonly kind: "TASK_NOT_FOUND" }
  | ({ readonly kind: "EXECUTED" } & CapturedResponseFields);

function fingerprint(input: ResponseCaptureInput): string {
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
 * The 3I-B3 protected mutation. Extends the exact B3A trust chain
 * (authenticated session -> authorized operator -> idempotency claim ->
 * concurrency-guarded repository writes -> existing append-only audit trail)
 * with the actual response-capture work: record the interaction, optionally
 * record the assessment (only for a substantive, reached outcome), run the
 * narrow canonical-closure gate, and advance the task status through
 * individually-valid, policy-map-checked hops. Actor identity comes only
 * from the resolved AuthorizedOperator -- ResponseCaptureInput has no actor
 * field for a caller to supply.
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
  if (claim.outcome === "CONFLICT") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: claim.reason };
  if (claim.outcome === "IN_PROGRESS") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: "IN_PROGRESS" };
  if (claim.outcome === "REPLAY") {
    const stored = claim.result as StoredResult;
    if (stored.kind !== "EXECUTED") return { kind: "REJECTED", reason: stored.kind };
    return { kind: "REPLAYED", taskId: stored.taskId, newTaskStatus: stored.newTaskStatus, interactionId: stored.interactionId, assessmentId: stored.assessmentId, canonicalOutcome: stored.canonicalOutcome, af01Result: stored.af01Result };
  }

  const task = await deps.humanVerificationRepository.getTask(input.taskId);
  if (!task) {
    await deps.idempotencyRepository.complete(input.idempotencyKey, { kind: "TASK_NOT_FOUND" } satisfies StoredResult);
    return { kind: "REJECTED", reason: "TASK_NOT_FOUND" };
  }
  if (task.status !== input.expectedTaskStatus) {
    await deps.idempotencyRepository.complete(input.idempotencyKey, { kind: "STALE_STATE" } satisfies StoredResult);
    return { kind: "REJECTED", reason: "STALE_STATE" };
  }

  const service = new HumanVerificationService(deps.humanVerificationRepository);
  const substantive = input.reachedHuman && !!input.answerDisposition;

  const desiredStatus = desiredResponseTaskStatus(input.reachedHuman, input.answerDisposition ?? null);
  const hops = planTaskStatusHops(task.status, desiredStatus, HUMAN_VERIFICATION_TASK_TRANSITIONS);
  if (hops.length === 0 && task.status !== desiredStatus) {
    await deps.idempotencyRepository.complete(input.idempotencyKey, { kind: "INVALID_TRANSITION" } satisfies StoredResult);
    return { kind: "REJECTED", reason: "INVALID_TRANSITION" };
  }

  const interaction = await service.recordInteraction({
    verificationTaskId: input.taskId,
    interactionMethod: input.interactionMethod,
    interactionOutcome: input.interactionOutcome,
    attemptedAt: input.attemptedAt,
    operatorId: operator.operatorId,
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
  });

  let assessmentId: string | null = null;
  let canonicalOutcome: "NO_CANONICAL_CHANGE" | "AF01_EVALUATED" = "NO_CANONICAL_CHANGE";
  let af01Result: string | undefined;

  if (substantive && input.answerDisposition && input.authorityLevel) {
    // Captured into locals: TypeScript's narrowing of input.answerDisposition/input.authorityLevel from the
    // `if` above does not persist inside the nested transactionRunner callback below (a closure over a
    // property access, not a plain narrowed variable) -- these consts keep the narrowed, non-null type.
    const answerDisposition = input.answerDisposition;
    const authorityLevel = input.authorityLevel;
    const assessment = await service.assessResponse({
      interactionId: interaction.id,
      answerDisposition: input.answerDisposition,
      authorityLevel: input.authorityLevel,
      authorityBasis: input.authorityBasis ?? "Operator-recorded authority basis",
      scope: task.scope,
      confidence: 1,
      assessedBy: operator.operatorId,
      assessorKind: "HUMAN",
      assessedAt: input.attemptedAt,
      approvalState: "APPROVED",
      approvedBy: operator.operatorId,
      ruleVersion: "human-verification-closure@1.0.0",
      commercialMechanism: input.commercialMechanism ?? null,
      companyId: task.companyId,
      projectId: task.projectId ?? null,
      opportunityId: task.opportunityId ?? null,
      followUpRequired: input.followUpRequired ?? (input.answerDisposition === "REFERRAL"),
      followUpTarget: input.followUpTarget ?? null,
      assessmentNotes: input.assessmentNotes ?? null,
    });
    assessmentId = assessment.id;

    const context: AcceptanceContext | null = task.projectId
      ? { type: "PROJECT", id: task.projectId }
      : task.opportunityId ? { type: "OPPORTUNITY", id: task.opportunityId } : null;
    // TX-INTEGRITY-03B: the canonical closure unit (evidence create -> claim createOrGet ->
    // evidence link -> claim transition -> AF01 evaluate+save, all inside HumanVerificationClosureService.close)
    // now runs as one real transaction. The interaction and assessment recorded above are NOT part of
    // this transaction and are unaffected if it rolls back -- both are independently durable historical facts.
    const closure = await deps.transactionRunner((client) => deps.closureServiceFor(client).close({
      companyId: task.companyId,
      context,
      interactionId: interaction.id,
      assessmentId: assessment.id,
      attemptedAt: input.attemptedAt,
      reachedHuman: input.reachedHuman,
      answerDisposition,
      authorityLevel,
      commercialMechanism: input.commercialMechanism ?? null,
      scope: task.scope,
      responseSummary: input.responseSummary ?? input.responseVerbatim ?? "",
      operatorId: operator.operatorId,
    }));
    if (closure.kind === "AF01_EVALUATED") {
      canonicalOutcome = "AF01_EVALUATED";
      af01Result = closure.evaluation.result;
    }
  }

  // TX-INTEGRITY-03B: each hop runs as its own separate transaction (never combined with
  // canonical closure, never combined with another hop) via the same certified TransactionRunner
  // pattern 3I-B3R1 established for transitionTaskIfCurrentStatus -- the event insert and the
  // status update inside one hop commit or roll back together; a failed hop never affects the
  // already-committed interaction, assessment, or canonical closure from earlier phases.
  let currentStatus = task.status;
  for (const hop of hops) {
    const transitioned = await deps.transactionRunner((client) =>
      new PostgresHumanVerificationRepository(client).transitionTaskIfCurrentStatus(input.taskId, currentStatus, hop, {
        eventType: "STATE_CHANGED", oldState: currentStatus, newState: hop,
        reason: "Human verification response captured", operatorId: operator.operatorId, occurredAt: input.attemptedAt,
      }),
    );
    if (!transitioned) {
      await deps.idempotencyRepository.complete(input.idempotencyKey, { kind: "STALE_STATE" } satisfies StoredResult);
      return { kind: "REJECTED", reason: "STALE_STATE" };
    }
    currentStatus = hop;
  }

  const result: CapturedResponseFields = {
    taskId: input.taskId, newTaskStatus: currentStatus, interactionId: interaction.id, assessmentId, canonicalOutcome, af01Result,
  };
  await deps.idempotencyRepository.complete(input.idempotencyKey, { kind: "EXECUTED", ...result } satisfies StoredResult);
  return { kind: "EXECUTED", ...result };
}
