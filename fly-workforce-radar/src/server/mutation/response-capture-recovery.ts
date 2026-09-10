import type {
  HumanAnswerDisposition, HumanAuthorityLevel, HumanInteraction, HumanResponseAssessment,
  HumanVerificationTask, HumanVerificationTaskStatus,
} from "../../domain/human-verification";
import { desiredResponseTaskStatus, evaluateCanonicalClosure, planTaskStatusHops } from "../../domain/human-verification-closure";
import { PostgresEvidenceRepository } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresHumanVerificationRepository } from "../repositories/human-verification/postgres-human-verification-repository";
import { PostgresManpowerAcceptanceRepository } from "../repositories/manpower-acceptance/postgres-manpower-acceptance-repository";
import { HUMAN_VERIFICATION_TASK_TRANSITIONS } from "../services/human-verification/human-verification-service";
import type { CapturedResponseFields, ResponseCaptureDeps, ResponseCaptureInput, ResponseCaptureOutcome, StoredResult } from "./protected-human-verification-response-capture";
import { buildAssessmentInput, buildClosureInput, buildInteractionInput } from "./protected-human-verification-response-capture";

/**
 * TX-INTEGRITY-04B. Thrown by any recovery step that cannot deterministically
 * proceed. `reason === "STALE_STATE"` is the one case treated as a genuine,
 * completable terminal outcome (it means recovery discovered the task moved
 * for a reason unrelated to this operation -- the identical situation the
 * normal execution path already handles the same way). Every other reason
 * leaves the idempotency key exactly as IN_PROGRESS as it already was --
 * recovery never guesses, never deletes/releases the key, and never repairs
 * by deleting or rewriting append-only rows.
 */
class RecoveryFailClosedError extends Error {
  constructor(readonly reason: string, readonly detail: string) {
    super(detail);
  }
}

/**
 * TX-INTEGRITY-04A/04B. Business-record-first recovery for a same-key/same-
 * actor/same-target/same-payload retry that observed IN_PROGRESS (claim()
 * itself already enforces all four of those before ever returning
 * IN_PROGRESS -- see its CONFLICT checks in the caller). Inspects durable
 * correlated state for each of response capture's independently durable
 * phases (TX-INTEGRITY-03B's frozen model, untouched here) and executes only
 * whatever is actually missing, using the existing certified TransactionRunner
 * per phase -- never one transaction spanning the whole operation. Idempotency
 * completion always stays a separate call on the plain client (Manager
 * Correction #2), reconstructing the terminal result from durable state
 * exactly as buildInteractionInput/buildAssessmentInput/buildClosureInput
 * would have produced it on a first attempt.
 */
export async function attemptResponseCaptureRecovery(
  input: ResponseCaptureInput,
  deps: ResponseCaptureDeps,
  operatorId: string,
  claimedAt: Date,
): Promise<ResponseCaptureOutcome> {
  try {
    const task = await deps.humanVerificationRepository.getTask(input.taskId);
    if (!task) {
      return { kind: "REJECTED", reason: "RECOVERY_INTEGRITY_CONFLICT", detail: "task not found during recovery" };
    }

    // TX-INTEGRITY-05B. Before the first durable business write, distinguish
    // a fresh/stale attempt from valid same-key crash recovery. Correlated
    // state means this key crossed the write boundary and must resume even if
    // prior task hops changed status. With no correlation, a state mismatch
    // is terminal STALE_STATE and persists no response-capture business row.
    const preflightInteractions = await deps.humanVerificationRepository.findInteractionByIdempotencyKey(input.taskId, input.idempotencyKey);
    if (preflightInteractions.length > 1) {
      throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "multiple interactions are correlated to this idempotency key");
    }
    if (preflightInteractions.length === 0 && task.status !== input.expectedTaskStatus) {
      throw new RecoveryFailClosedError("STALE_STATE", "task state changed before the first response-capture business write");
    }

    const interaction = await recoverInteraction(deps, input, task, operatorId, claimedAt);

    const substantive = input.reachedHuman && !!input.answerDisposition;
    let assessmentId: string | null = null;
    let canonicalOutcome: "NO_CANONICAL_CHANGE" | "AF01_EVALUATED" = "NO_CANONICAL_CHANGE";
    let af01Result: string | undefined;

    if (substantive && input.answerDisposition && input.authorityLevel) {
      const answerDisposition = input.answerDisposition;
      const authorityLevel = input.authorityLevel;
      const assessment = await recoverAssessment(deps, input, task, interaction, operatorId, claimedAt, answerDisposition, authorityLevel);
      assessmentId = assessment.id;

      const evaluationResult = await recoverClosure(deps, input, task, interaction, assessment, operatorId, answerDisposition, authorityLevel);
      if (evaluationResult !== undefined) {
        canonicalOutcome = "AF01_EVALUATED";
        af01Result = evaluationResult;
      }
    }

    const desiredStatus = desiredResponseTaskStatus(input.reachedHuman, input.answerDisposition ?? null);
    const plannedHops = planTaskStatusHops(input.expectedTaskStatus, desiredStatus, HUMAN_VERIFICATION_TASK_TRANSITIONS);
    const newTaskStatus = await recoverHops(deps, input, plannedHops, desiredStatus, interaction.id, operatorId);

    const result: CapturedResponseFields = {
      taskId: input.taskId, newTaskStatus, interactionId: interaction.id, assessmentId, canonicalOutcome, af01Result,
    };
    await deps.idempotencyRepository.complete(input.idempotencyKey, { kind: "EXECUTED", ...result } satisfies StoredResult);
    return { kind: "EXECUTED", ...result };
  } catch (error) {
    if (error instanceof RecoveryFailClosedError) {
      if (error.reason === "STALE_STATE") {
        await deps.idempotencyRepository.complete(input.idempotencyKey, { kind: "STALE_STATE" } satisfies StoredResult);
        return { kind: "REJECTED", reason: "STALE_STATE" };
      }
      return { kind: "REJECTED", reason: error.reason, detail: error.detail };
    }
    throw error;
  }
}

/**
 * Phase 1 recovery: interaction. Correlated via metadata.idempotencyKey,
 * stamped in the same INSERT that creates the row (buildInteractionInput) --
 * never a follow-up statement, so there is no crash gap between "interaction
 * exists" and "interaction is correlated." Zero or one match is expected;
 * more than one is an integrity conflict, never guessed past.
 */
async function recoverInteraction(
  deps: ResponseCaptureDeps, input: ResponseCaptureInput, task: HumanVerificationTask, operatorId: string, claimedAt: Date,
): Promise<HumanInteraction> {
  const correlated = await deps.humanVerificationRepository.findInteractionByIdempotencyKey(input.taskId, input.idempotencyKey);
  if (correlated.length > 1) {
    throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "multiple interactions are correlated to this idempotency key");
  }
  if (correlated.length === 1) return correlated[0];

  // Nothing correlated yet. Before concluding "this attempt never reached the interaction step," rule
  // out the one case that would make that conclusion wrong: an interaction on this same task created at
  // or after this claim was made, carrying no correlation at all. Every interaction response capture
  // creates always carries metadata.idempotencyKey (buildInteractionInput) -- an uncorrelated one
  // temporally consistent with this claim can only be explained as a write from before recovery
  // correlation existed, which cannot be safely attributed to (or ruled out for) this key.
  const existing = await deps.humanVerificationRepository.listInteractions(input.taskId);
  const suspicious = existing.filter((candidate) => candidate.createdAt.getTime() >= claimedAt.getTime() && !candidate.metadata?.idempotencyKey);
  if (suspicious.length > 0) {
    throw new RecoveryFailClosedError("RECOVERY_LEGACY_UNRECOVERABLE", "an uncorrelated interaction exists on this task from at or after this claim and cannot be safely attributed");
  }

  return deps.transactionRunner(async (client) => {
    const repository = new PostgresHumanVerificationRepository(client);
    // Re-check inside the phase transaction. R1's outer session-level lock
    // already owns the complete recovery attempt continuously.
    const recheck = await repository.findInteractionByIdempotencyKey(input.taskId, input.idempotencyKey);
    if (recheck.length > 1) throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "multiple interactions are correlated to this idempotency key");
    if (recheck.length === 1) return recheck[0];
    return repository.createInteraction(buildInteractionInput(input, task, operatorId));
  });
}

/** Phase 2 recovery: assessment. Same correlation-then-lock-then-recheck pattern as interaction, scoped by idempotency_key (the one narrow schema addition TX-INTEGRITY-04A identified as required). */
async function recoverAssessment(
  deps: ResponseCaptureDeps, input: ResponseCaptureInput, task: HumanVerificationTask, interaction: HumanInteraction, operatorId: string,
  claimedAt: Date, answerDisposition: HumanAnswerDisposition, authorityLevel: HumanAuthorityLevel,
): Promise<HumanResponseAssessment> {
  const correlated = await deps.humanVerificationRepository.findAssessmentByIdempotencyKey(input.idempotencyKey);
  if (correlated.length > 1) {
    throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "multiple assessments are correlated to this idempotency key");
  }
  if (correlated.length === 1) return correlated[0];

  // Same legacy/ambiguity guard as interaction recovery, scoped to this interaction's own assessments --
  // a genuine reassessment always carries its OWN (different, correlated) idempotency key, so this never
  // fires for legitimate reassessment traffic; it only fires for an uncorrelated row temporally
  // consistent with this specific claim.
  const existing = await deps.humanVerificationRepository.listAssessments(interaction.id);
  const suspicious = existing.filter((candidate) => candidate.createdAt.getTime() >= claimedAt.getTime() && !candidate.idempotencyKey);
  if (suspicious.length > 0) {
    throw new RecoveryFailClosedError("RECOVERY_LEGACY_UNRECOVERABLE", "an uncorrelated assessment exists on this interaction from at or after this claim and cannot be safely attributed");
  }

  return deps.transactionRunner(async (client) => {
    const repository = new PostgresHumanVerificationRepository(client);
    const recheck = await repository.findAssessmentByIdempotencyKey(input.idempotencyKey);
    if (recheck.length > 1) throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "multiple assessments are correlated to this idempotency key");
    if (recheck.length === 1) return recheck[0];
    return repository.createAssessment(buildAssessmentInput(input, task, interaction.id, operatorId, answerDisposition, authorityLevel));
  });
}

type ClosureLookup = { readonly kind: "NOT_FOUND" } | { readonly kind: "AMBIGUOUS" } | { readonly kind: "FOUND"; readonly result: string };

/**
 * Looks up whether canonical closure already committed for this interaction, using the evidence
 * repository's existing metadata.interactionId correlation (already stamped by
 * HumanVerificationClosureService.close() for every closure, unrelated to TX-INTEGRITY-04B). Because
 * TX-INTEGRITY-03B guarantees the whole closure transaction is atomic, any single matching evidence row
 * proves the entire closure (evidence, claim link/transition, AF01 evaluation) committed -- no separate
 * closure-specific checkpoint is needed or added.
 */
async function lookupClosure(deps: ResponseCaptureDeps, companyId: string, interactionId: string): Promise<ClosureLookup> {
  return deps.transactionRunner(async (client) => {
    const evidenceRepository = new PostgresEvidenceRepository(client);
    const found = await evidenceRepository.findByInteractionId(interactionId);
    if (found.length === 0) return { kind: "NOT_FOUND" };
    if (found.length > 1) return { kind: "AMBIGUOUS" };
    const manpowerAcceptanceRepository = new PostgresManpowerAcceptanceRepository(client);
    const evaluations = await manpowerAcceptanceRepository.listEvaluations(companyId);
    const matches = evaluations.filter((evaluation) => evaluation.supportingEvidenceIds.includes(found[0].id));
    if (matches.length === 0) return { kind: "AMBIGUOUS" };
    return { kind: "FOUND", result: matches[matches.length - 1].result };
  });
}

/**
 * Phase 3 recovery: canonical closure. `evaluateCanonicalClosure` is pure and deterministic from the
 * resubmitted (payload-hash-verified-identical) input alone, so whether this submission even qualifies
 * for closure is never ambiguous. Does not change HumanVerificationClosureService's transaction
 * boundary -- a still-missing closure is executed through the exact same `deps.closureServiceFor(client)
 * .close(...)` call the normal path uses, inside one more TransactionRunner invocation guarded by the
 * same recovery-ownership lock.
 */
async function recoverClosure(
  deps: ResponseCaptureDeps, input: ResponseCaptureInput, task: HumanVerificationTask, interaction: HumanInteraction, assessment: HumanResponseAssessment,
  operatorId: string, answerDisposition: HumanAnswerDisposition, authorityLevel: HumanAuthorityLevel,
): Promise<string | undefined> {
  const decision = evaluateCanonicalClosure({
    reachedHuman: input.reachedHuman, answerDisposition, authorityLevel,
    commercialMechanism: input.commercialMechanism ?? null, scope: task.scope,
  });
  if (!decision.qualifies) return undefined; // deterministically NO_CANONICAL_CHANGE -- closure was never applicable to this submission

  const lookup = await lookupClosure(deps, task.companyId, interaction.id);
  if (lookup.kind === "FOUND") return lookup.result;
  if (lookup.kind === "AMBIGUOUS") {
    throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "closure evidence exists but no AF01 evaluation references it, or multiple evidence records are correlated to this interaction");
  }

  return deps.transactionRunner(async (client) => {
    const evidenceRepository = new PostgresEvidenceRepository(client);
    const recheck = await evidenceRepository.findByInteractionId(interaction.id);
    if (recheck.length > 1) throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "multiple evidence records are correlated to this interaction");
    if (recheck.length === 1) {
      const manpowerAcceptanceRepository = new PostgresManpowerAcceptanceRepository(client);
      const evaluations = await manpowerAcceptanceRepository.listEvaluations(task.companyId);
      const matches = evaluations.filter((evaluation) => evaluation.supportingEvidenceIds.includes(recheck[0].id));
      if (matches.length === 0) throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "closure evidence exists but no AF01 evaluation references it");
      return matches[matches.length - 1].result;
    }
    const closure = await deps.closureServiceFor(client).close(
      buildClosureInput(input, task, interaction.id, assessment.id, operatorId, answerDisposition, authorityLevel),
    );
    return closure.kind === "AF01_EVALUATED" ? closure.evaluation.result : undefined;
  });
}

/**
 * Phase 4 recovery: task-transition hops. `plannedHops` is recomputed from input.expectedTaskStatus (the
 * ORIGINAL, payload-hash-verified starting point) through the same desiredResponseTaskStatus/
 * planTaskStatusHops the normal path uses -- deterministic, never re-derived from the task's current
 * (possibly already-partially-advanced) status. A hop already represented by a correlated STATE_CHANGED
 * event (interactionId-tagged, written in the same transaction as the hop itself) is reused, never
 * re-applied; current task status is used only as transitionTaskIfCurrentStatus's own compare-and-swap
 * guard, never trusted alone as proof this operation performed a transition.
 */
async function recoverHops(
  deps: ResponseCaptureDeps, input: ResponseCaptureInput, plannedHops: readonly HumanVerificationTaskStatus[],
  desiredStatus: HumanVerificationTaskStatus, interactionId: string, operatorId: string,
): Promise<HumanVerificationTaskStatus> {
  if (plannedHops.length === 0) {
    const task = await deps.humanVerificationRepository.getTask(input.taskId);
    if (!task) throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "task not found during recovery");
    if (task.status !== desiredStatus) {
      throw new RecoveryFailClosedError("STALE_STATE", "task state no longer matches the planned (zero-hop) recovery outcome");
    }
    return task.status;
  }

  const allEvents = await deps.humanVerificationRepository.listTaskEvents(input.taskId);
  const correlatedEvents = allEvents.filter((event) => event.eventType === "STATE_CHANGED" && event.interactionId === interactionId);
  const expectedPairs = plannedHops.map((newState, index) => ({
    oldState: index === 0 ? input.expectedTaskStatus : plannedHops[index - 1],
    newState,
  }));
  if (correlatedEvents.length > expectedPairs.length) {
    throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "too many task transitions are correlated to this response capture");
  }
  for (let index = 0; index < correlatedEvents.length; index += 1) {
    const event = correlatedEvents[index];
    const expected = expectedPairs[index];
    if (event.oldState !== expected.oldState || event.newState !== expected.newState) {
      throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "correlated task transition history contradicts the planned old/new status sequence");
    }
  }

  let currentStatus = input.expectedTaskStatus;
  for (let hopIndex = 0; hopIndex < plannedHops.length; hopIndex += 1) {
    const hop = plannedHops[hopIndex];
    if (hopIndex < correlatedEvents.length) { currentStatus = hop; continue; }

    const transitioned = await deps.transactionRunner(async (client) => {
      const repository = new PostgresHumanVerificationRepository(client);
      const recheckEvents = await repository.listTaskEvents(input.taskId);
      const ownedEvents = recheckEvents.filter((event) => event.eventType === "STATE_CHANGED" && event.interactionId === interactionId);
      if (ownedEvents.length > hopIndex) {
        const event = ownedEvents[hopIndex];
        if (event.oldState !== currentStatus || event.newState !== hop || ownedEvents.length > hopIndex + 1) {
          throw new RecoveryFailClosedError("RECOVERY_INTEGRITY_CONFLICT", "correlated task transition history changed inconsistently during recovery");
        }
        return repository.getTask(input.taskId);
      }
      return repository.transitionTaskIfCurrentStatus(input.taskId, currentStatus, hop, {
        eventType: "STATE_CHANGED", oldState: currentStatus, newState: hop,
        reason: "Human verification response captured (recovered)", operatorId, occurredAt: input.attemptedAt,
        interactionId,
      });
    });
    if (!transitioned) {
      throw new RecoveryFailClosedError("STALE_STATE", "task state no longer matches the planned recovery hop");
    }
    currentStatus = transitioned.status;
  }
  return currentStatus;
}
