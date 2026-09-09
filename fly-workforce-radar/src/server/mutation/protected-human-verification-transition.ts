import { createHash } from "node:crypto";
import type { HumanVerificationTaskStatus } from "../../domain/human-verification";
import type { AuthorizationResult } from "../auth/authorization";
import { authorizeOperator } from "../auth/authorization";
import type { ServerSession } from "../auth/session";
import type { TransactionRunner } from "../database/transaction";
import { PostgresHumanVerificationRepository } from "../repositories/human-verification/postgres-human-verification-repository";
import type { IdempotencyRepository } from "../repositories/idempotency/idempotency-repository";
import type { OperatorRepository } from "../repositories/operator/operator-repository";

export type ProtectedTransitionOutcome =
  | { readonly kind: "REJECTED"; readonly reason: "UNAUTHENTICATED" | "UNAUTHORIZED" | "STALE_STATE" }
  | { readonly kind: "REJECTED"; readonly reason: "IDEMPOTENCY_CONFLICT"; readonly detail: "ACTOR_MISMATCH" | "TARGET_MISMATCH" | "PAYLOAD_MISMATCH" | "IN_PROGRESS" }
  | { readonly kind: "EXECUTED" | "REPLAYED"; readonly taskId: string; readonly status: HumanVerificationTaskStatus };

export interface ProtectedTransitionInput {
  readonly idempotencyKey: string;
  readonly taskId: string;
  readonly expectedStatus: HumanVerificationTaskStatus;
  readonly newStatus: HumanVerificationTaskStatus;
  readonly reason: string;
}

type StoredResult = { readonly kind: "EXECUTED"; readonly taskId: string; readonly status: HumanVerificationTaskStatus } | { readonly kind: "STALE_STATE" };

function fingerprint(action: string, payload: unknown): string {
  return createHash("sha256").update(JSON.stringify({ action, payload })).digest("hex");
}

/**
 * The full B3A trust chain, composed and reusable by a future authorized B3
 * write: authenticated session -> authorized operator -> idempotency claim
 * -> concurrency-guarded repository transition -> audit event (the existing
 * human_verification_task_events trail, via transitionTaskIfCurrentStatus).
 * Actor identity comes ONLY from the resolved AuthorizedOperator --
 * ProtectedTransitionInput deliberately has no operatorId/operatorName
 * field, so a caller cannot supply an actor even if it wanted to.
 *
 * This does not implement 3I-B3 response capture; it exercises the safe-
 * mutation foundation against the existing task-status transition, the
 * smallest real mutation available today.
 */
export async function executeProtectedHumanVerificationTransition(
  input: ProtectedTransitionInput,
  deps: {
    readonly transactionRunner: TransactionRunner;
    readonly idempotencyRepository: IdempotencyRepository;
    readonly getSession?: () => Promise<ServerSession | null>;
    readonly operatorRepository?: OperatorRepository | null;
  },
): Promise<ProtectedTransitionOutcome> {
  const authorization: AuthorizationResult = await authorizeOperator("human_verification.write", {
    getSession: deps.getSession,
    repository: deps.operatorRepository,
  });
  if (authorization.state === "UNAUTHENTICATED") return { kind: "REJECTED", reason: "UNAUTHENTICATED" };
  if (authorization.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { kind: "REJECTED", reason: "UNAUTHORIZED" };
  const operator = authorization.operator;

  const claim = await deps.idempotencyRepository.claim({
    idempotencyKey: input.idempotencyKey,
    operatorId: operator.operatorId,
    action: "human_verification.transition_task",
    targetType: "HUMAN_VERIFICATION_TASK",
    targetId: input.taskId,
    requestFingerprint: fingerprint("human_verification.transition_task", { taskId: input.taskId, expectedStatus: input.expectedStatus, newStatus: input.newStatus, reason: input.reason }),
  });
  if (claim.outcome === "CONFLICT") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: claim.reason };
  if (claim.outcome === "IN_PROGRESS") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: "IN_PROGRESS" };
  if (claim.outcome === "REPLAY") {
    const stored = claim.result as StoredResult;
    return stored.kind === "STALE_STATE" ? { kind: "REJECTED", reason: "STALE_STATE" } : { kind: "REPLAYED", taskId: stored.taskId, status: stored.status };
  }

  // 3I-B3R1: the guarded status transition and its audit event must commit or roll back together as
  // one atomic unit -- run them inside the certified TransactionRunner (see production-sql-client.ts /
  // transaction.ts) rather than on the plain per-call pooled client, which cannot scope a real
  // transaction across the two statements transitionTaskIfCurrentStatus issues.
  const transitioned = await deps.transactionRunner(async (client) => {
    const humanVerificationRepository = new PostgresHumanVerificationRepository(client);
    return humanVerificationRepository.transitionTaskIfCurrentStatus(input.taskId, input.expectedStatus, input.newStatus, {
      eventType: "STATE_CHANGED", oldState: input.expectedStatus, newState: input.newStatus, reason: input.reason,
      operatorId: operator.operatorId, occurredAt: new Date(),
    });
  });
  if (!transitioned) {
    await deps.idempotencyRepository.complete(input.idempotencyKey, { kind: "STALE_STATE" } satisfies StoredResult);
    return { kind: "REJECTED", reason: "STALE_STATE" };
  }

  const result: StoredResult = { kind: "EXECUTED", taskId: transitioned.id, status: transitioned.status };
  await deps.idempotencyRepository.complete(input.idempotencyKey, result);
  return { kind: "EXECUTED", taskId: result.taskId, status: result.status };
}
