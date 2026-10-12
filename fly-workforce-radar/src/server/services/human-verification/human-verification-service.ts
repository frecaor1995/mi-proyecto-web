import { createHash } from "node:crypto";
import {
  HUMAN_ASSESSMENT_APPROVAL_STATES, HUMAN_INTERACTION_OUTCOMES, TERMINAL_HUMAN_VERIFICATION_TASK_STATUSES,
  isSubstantiveHumanInteractionOutcome,
} from "../../../domain/human-verification";
import type {
  CreateHumanInteractionInput, CreateHumanResponseAssessmentInput, CreateHumanVerificationTaskInput,
  HumanVerificationScope, HumanVerificationTaskStatus,
} from "../../../domain/human-verification";
import type { TransactionRunner } from "../../database/transaction";
import type { SqlClient } from "../../repositories/evidence/postgres-evidence-repository";
import type { HumanVerificationRepository } from "../../repositories/human-verification/human-verification-repository";

/**
 * TX-INTEGRITY-02. The narrow seam through which createTask/transitionTask
 * obtain genuine cross-statement atomicity, without making this otherwise
 * Postgres-agnostic service depend on the concrete PostgresHumanVerification-
 * Repository class (a fake used by non-Postgres tests, e.g. the B2 planning
 * service's in-memory repository, has no real client/transaction to scope in
 * the first place -- forcing it to import a Postgres-specific class here
 * would break that abstraction for no benefit). The composition root (a
 * real production caller, or a test) supplies `run` (the certified
 * TransactionRunner) and `repositoryFor` (how to build a repository bound to
 * one transaction-scoped client) -- for a real Postgres-backed repository
 * that is `(client) => new PostgresHumanVerificationRepository(client)`; for
 * an in-memory fake with nothing to scope, it can be a no-op that ignores
 * the client and returns the same repository instance.
 */
export interface HumanVerificationTransactionalAccess {
  readonly run: TransactionRunner;
  readonly repositoryFor: (client: SqlClient) => HumanVerificationRepository;
}

export const HUMAN_VERIFICATION_RULE_VERSION = "human-verification@2.0.0";
const terminal = new Set<string>(TERMINAL_HUMAN_VERIFICATION_TASK_STATUSES);
/** Exported (3I-B3 addition, no behavior change) so the response-capture closure planner can reuse this exact policy instead of redefining it. */
export const HUMAN_VERIFICATION_TASK_TRANSITIONS: Record<HumanVerificationTaskStatus, HumanVerificationTaskStatus[]> = {
  OPEN: ["ASSIGNED", "ATTEMPTED", "CANCELLED", "DUPLICATE", "UNRESOLVABLE"],
  ASSIGNED: ["ATTEMPTED", "CANCELLED", "DUPLICATE", "UNRESOLVABLE"],
  ATTEMPTED: ["ATTEMPTED", "AWAITING_RESPONSE", "FOLLOW_UP_REQUIRED", "READY_FOR_ASSESSMENT", "CANCELLED", "UNRESOLVABLE"],
  AWAITING_RESPONSE: ["ATTEMPTED", "FOLLOW_UP_REQUIRED", "READY_FOR_ASSESSMENT", "CANCELLED", "UNRESOLVABLE"],
  FOLLOW_UP_REQUIRED: ["ATTEMPTED", "AWAITING_RESPONSE", "READY_FOR_ASSESSMENT", "CANCELLED", "UNRESOLVABLE"],
  READY_FOR_ASSESSMENT: ["READY_FOR_APPROVAL", "FOLLOW_UP_REQUIRED", "CANCELLED", "UNRESOLVABLE"],
  READY_FOR_APPROVAL: ["COMPLETED", "FOLLOW_UP_REQUIRED", "CANCELLED", "UNRESOLVABLE"],
  COMPLETED: [], CANCELLED: [], DUPLICATE: [], UNRESOLVABLE: [],
};

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
  return value;
}
export function humanVerificationTaskDeduplicationKey(input: Pick<CreateHumanVerificationTaskInput, "companyId" | "targetType" | "targetId" | "verificationObjective" | "questionType" | "scope">): string {
  const identity = normalized({ companyId: input.companyId, targetType: input.targetType, targetId: input.targetId, verificationObjective: input.verificationObjective.trim(), questionType: input.questionType, scope: input.scope });
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
function required(value: string, name: string) { if (!value.trim()) throw new Error(`${name} is required`) }
function validateScope(scope: HumanVerificationScope) {
  if (scope.companyScope === "COMPANYWIDE" && (scope.divisionOrSubsidiary || scope.projectId)) throw new Error("COMPANYWIDE scope cannot silently include division or project scope");
  if (scope.effectiveFrom && scope.effectiveUntil && new Date(scope.effectiveUntil) < new Date(scope.effectiveFrom)) throw new Error("Scope effectiveUntil cannot precede effectiveFrom");
}

export class HumanVerificationService {
  constructor(
    private readonly repository: HumanVerificationRepository,
    private readonly transactional?: HumanVerificationTransactionalAccess,
  ) {}

  /**
   * TX-INTEGRITY-02. The pre-check (findOpenTaskByDeduplicationKey) stays
   * outside the transaction exactly as before -- it is a read-only
   * early-return optimization, not part of the atomic unit that was
   * corrected. The atomic unit is task INSERT + its required initial
   * CREATED event INSERT: that unit now genuinely runs inside one real
   * transaction via the caller-supplied TransactionRunner, rather than
   * silently running with no transactional guarantee at all.
   */
  async createTask(input: CreateHumanVerificationTaskInput) {
    required(input.verificationObjective, "Verification objective"); required(input.primaryQuestion, "Primary question"); required(input.createdBy, "Creator"); required(input.ruleVersion, "Rule version"); validateScope(input.scope);
    const deduplicationKey = humanVerificationTaskDeduplicationKey(input);
    const existing = await this.repository.findOpenTaskByDeduplicationKey(deduplicationKey);
    if (existing) return { task: existing, created: false as const };
    if (!this.transactional) throw new Error("HumanVerificationService.createTask requires transactional access to atomically create the task and its required initial audit event");
    const task = await this.transactional.run((client) => this.transactional!.repositoryFor(client).createTask({ ...input, deduplicationKey }));
    return { task, created: true as const };
  }

  /** TX-INTEGRITY-02. Same correction: the event INSERT + status UPDATE atomic unit now runs inside one real transaction via the caller-supplied TransactionRunner. Contract otherwise unchanged -- still the unguarded transition, distinct from transitionTaskIfCurrentStatus. */
  async transitionTask(taskId: string, newState: HumanVerificationTaskStatus, operatorId: string, reason: string) {
    required(operatorId, "Operator"); required(reason, "Transition reason");
    const task = await this.repository.getTask(taskId); if (!task) throw new Error("Human verification task does not exist");
    if (terminal.has(task.status)) throw new Error("Closed human verification task cannot be reopened or changed");
    if (!HUMAN_VERIFICATION_TASK_TRANSITIONS[task.status].includes(newState)) throw new Error(`Invalid human verification transition ${task.status} -> ${newState}`);
    if (!this.transactional) throw new Error("HumanVerificationService.transitionTask requires transactional access to atomically apply the status change and its audit event");
    const occurredAt = new Date();
    return this.transactional.run((client) => this.transactional!.repositoryFor(client).transitionTask(taskId, newState, { eventType: "STATE_CHANGED", oldState: task.status, newState, reason, operatorId, occurredAt }));
  }

  async recordInteraction(input: CreateHumanInteractionInput) {
    required(input.operatorId, "Operator");
    if (!HUMAN_INTERACTION_OUTCOMES.includes(input.interactionOutcome)) throw new Error("Unknown interaction outcome");
    if (["NO_ANSWER", "VOICEMAIL_LEFT", "EMAIL_SENT", "EMAIL_BOUNCED"].includes(input.interactionOutcome) && (input.reachedHuman || input.responseVerbatim)) throw new Error(`${input.interactionOutcome} cannot be a human response`);
    return this.repository.createInteraction(input);
  }

  async assessResponse(input: CreateHumanResponseAssessmentInput) {
    required(input.assessedBy, "Assessor"); required(input.authorityBasis, "Authority basis"); required(input.ruleVersion, "Rule version"); validateScope(input.scope);
    if (input.confidence < 0 || input.confidence > 1) throw new Error("Confidence must be between zero and one");
    if (!HUMAN_ASSESSMENT_APPROVAL_STATES.includes(input.approvalState)) throw new Error("Unknown assessment approval state");
    if (input.approvalState === "APPROVED" && (input.assessorKind !== "HUMAN" || !input.approvedBy?.trim())) throw new Error("Only an identified human assessor may approve an assessment");
    return this.repository.createAssessment(input);
  }

  canInteractionSupportSubstantiveEvidence(outcome: CreateHumanInteractionInput["interactionOutcome"]) { return isSubstantiveHumanInteractionOutcome(outcome) }
}
