import { createHash } from "node:crypto";
import { ECONOMIC_DISPOSITIONS, type CreateEconomicDecisionMutationInput, type EconomicDecisionMutationRejection, type EconomicDecisionRecord } from "../../domain/economic-decision";
import { ECONOMIC_FACT_TIERS, type EconomicFactTier } from "../../domain/economic-value";
import { authorizeOperator } from "../auth/authorization";
import type { ServerSession } from "../auth/session";
import type { TransactionRunner } from "../database/transaction";
import { PostgresEconomicDecisionRepository } from "../repositories/economic-decision/postgres-economic-decision-repository";
import { PostgresEconomicsScenarioRepository } from "../repositories/economics-scenario/postgres-economics-scenario-repository";
import { PostgresIdempotencyRepository } from "../repositories/idempotency/postgres-idempotency-repository";
import type { OperatorRepository } from "../repositories/operator/operator-repository";

type StoredResult =
  | { readonly kind: "VALIDATION_ERROR"; readonly detail: string }
  | { readonly kind: "CONCURRENCY_CONFLICT"; readonly detail: string }
  | { readonly kind: "SNAPSHOT_NOT_FOUND"; readonly detail: string }
  | { readonly kind: "SNAPSHOT_OPPORTUNITY_MISMATCH"; readonly detail: string }
  | { readonly kind: "SNAPSHOT_INTEGRITY_ERROR"; readonly detail: string }
  | { readonly kind: "EXECUTED"; readonly decisionId: string };

export type CreateEconomicDecisionOutcome =
  | EconomicDecisionMutationRejection
  | { readonly kind: "EXECUTED"; readonly decision: EconomicDecisionRecord }
  | { readonly kind: "REPLAYED"; readonly decisionId: string };

export interface CreateEconomicDecisionDeps {
  readonly transactionRunner: TransactionRunner;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
  readonly clock?: () => Date;
}

function fingerprint(input: CreateEconomicDecisionMutationInput): string {
  return createHash("sha256").update(JSON.stringify({
    opportunityId: input.opportunityId,
    scenarioSnapshotId: input.scenarioSnapshotId,
    disposition: input.disposition,
    rationale: input.rationale,
    ruleVersion: input.ruleVersion,
    expectedCurrentDecisionId: input.expectedCurrentDecisionId,
  })).digest("hex");
}

function snapshotAuditContext(result: Record<string, unknown>):
  | { readonly ok: true; readonly certainty: EconomicFactTier; readonly blockingReasons: readonly string[] }
  | { readonly ok: false; readonly detail: string } {
  const weakestTier = result.weakestTier;
  const certainty: unknown = weakestTier === null ? "UNKNOWN" : weakestTier;
  if (typeof certainty !== "string" || !(ECONOMIC_FACT_TIERS as readonly string[]).includes(certainty)) {
    return { ok: false, detail: "Scenario snapshot has an invalid or missing weakestTier" };
  }
  if (!Array.isArray(result.blockingReasons) || !result.blockingReasons.every((reason) => typeof reason === "string")) {
    return { ok: false, detail: "Scenario snapshot has invalid or missing blockingReasons" };
  }
  return { ok: true, certainty: certainty as EconomicFactTier, blockingReasons: [...result.blockingReasons] };
}

function rejectStored(stored: Exclude<StoredResult, { kind: "EXECUTED" }>): EconomicDecisionMutationRejection {
  return { kind: "REJECTED", reason: stored.kind, detail: stored.detail };
}

/**
 * Phase 4J. Persists a human-supplied business disposition against one
 * immutable scenario snapshot. It never recalculates economics and never
 * reads or mutates eligibility, HOT, AF01, scoring, or verification state.
 */
export async function executeProtectedCreateEconomicDecision(
  input: CreateEconomicDecisionMutationInput,
  deps: CreateEconomicDecisionDeps,
): Promise<CreateEconomicDecisionOutcome> {
  const authorization = await authorizeOperator("commercial_economics.decide", {
    getSession: deps.getSession,
    repository: deps.operatorRepository,
  });
  if (authorization.state === "UNAUTHENTICATED") return { kind: "REJECTED", reason: "UNAUTHENTICATED" };
  if (authorization.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { kind: "REJECTED", reason: "UNAUTHORIZED" };

  if (!(ECONOMIC_DISPOSITIONS as readonly string[]).includes(input.disposition)) {
    return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: "Disposition must be PROCEED, DECLINE, or DEFER" };
  }
  if (!input.rationale.trim()) return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: "Rationale is required" };
  if (!input.ruleVersion.trim()) return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: "Rule version is required" };

  const operator = authorization.operator;
  const requestFingerprint = fingerprint(input);
  const decidedAt = (deps.clock ?? (() => new Date()))();

  return deps.transactionRunner<CreateEconomicDecisionOutcome>(async (client) => {
    const decisionRepository = new PostgresEconomicDecisionRepository(client);
    const scenarioRepository = new PostgresEconomicsScenarioRepository(client);
    const idempotencyRepository = new PostgresIdempotencyRepository(client);

    const claim = await idempotencyRepository.claim({
      idempotencyKey: input.idempotencyKey,
      operatorId: operator.operatorId,
      action: "commercial_economics.create_decision",
      targetType: "OPPORTUNITY",
      targetId: input.opportunityId,
      requestFingerprint,
    });
    if (claim.outcome === "CONFLICT") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: claim.reason };
    if (claim.outcome === "IN_PROGRESS") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: "IN_PROGRESS" };
    if (claim.outcome === "REPLAY") {
      const stored = claim.result as StoredResult;
      return stored.kind === "EXECUTED"
        ? { kind: "REPLAYED", decisionId: stored.decisionId }
        : rejectStored(stored);
    }

    await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [`economic-decision:${input.opportunityId}`]);
    const current = await decisionRepository.getCurrent(input.opportunityId);
    if ((current?.id ?? null) !== input.expectedCurrentDecisionId) {
      const detail = `Expected current decision ${input.expectedCurrentDecisionId ?? "null"}, actual current decision ${current?.id ?? "null"}`;
      const stored = { kind: "CONCURRENCY_CONFLICT", detail } as const;
      await idempotencyRepository.complete(input.idempotencyKey, stored);
      return rejectStored(stored);
    }

    const snapshot = await scenarioRepository.getById(input.scenarioSnapshotId);
    if (!snapshot) {
      const stored = { kind: "SNAPSHOT_NOT_FOUND", detail: "scenarioSnapshotId does not reference an existing economics scenario snapshot" } as const;
      await idempotencyRepository.complete(input.idempotencyKey, stored);
      return rejectStored(stored);
    }
    if (snapshot.opportunityId !== input.opportunityId) {
      const stored = { kind: "SNAPSHOT_OPPORTUNITY_MISMATCH", detail: "Scenario snapshot does not belong to the decision opportunity" } as const;
      await idempotencyRepository.complete(input.idempotencyKey, stored);
      return rejectStored(stored);
    }
    const auditContext = snapshotAuditContext(snapshot.result);
    if (!auditContext.ok) {
      const stored = { kind: "SNAPSHOT_INTEGRITY_ERROR", detail: auditContext.detail } as const;
      await idempotencyRepository.complete(input.idempotencyKey, stored);
      return rejectStored(stored);
    }

    const decision = await decisionRepository.create({
      opportunityId: input.opportunityId,
      scenarioSnapshotId: snapshot.id,
      disposition: input.disposition,
      rationale: input.rationale.trim(),
      scenarioEffectiveCertainty: auditContext.certainty,
      scenarioBlockingReasons: auditContext.blockingReasons,
      ruleVersion: input.ruleVersion,
      decidedBy: operator.operatorId,
      decidedAt,
      supersedesDecisionId: input.expectedCurrentDecisionId,
    });
    await idempotencyRepository.complete(input.idempotencyKey, { kind: "EXECUTED", decisionId: decision.id } satisfies StoredResult);
    return { kind: "EXECUTED", decision };
  });
}
