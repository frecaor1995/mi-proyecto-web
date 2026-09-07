import { createHash } from "node:crypto";
import type { CommercialEconomicsMutationRejection, CreateCommercialTermsVersionMutationInput } from "../../domain/commercial-economics-mutation";
import type { CommercialTermsVersionRecord } from "../../domain/commercial-economics-persistence";
import { authorizeOperator } from "../auth/authorization";
import type { ServerSession } from "../auth/session";
import type { TransactionRunner } from "../database/transaction";
import { PostgresCommercialTermsRepository } from "../repositories/commercial-terms/postgres-commercial-terms-repository";
import { PostgresIdempotencyRepository } from "../repositories/idempotency/postgres-idempotency-repository";
import type { OperatorRepository } from "../repositories/operator/operator-repository";

/**
 * Phase 4G. Protected server-side mutation: create a new Commercial Terms
 * version. Reuses the certified B3A authorize -> idempotency -> concurrency
 * -> write pattern from 3I-B3, with the pre-commit concurrency/atomicity
 * correction applied: claim, the canonical target lock, the current-version
 * check, the write, and idempotency completion ALL run inside one real
 * transaction (via `deps.transactionRunner`, never the plain
 * getProductionSqlClient()) -- so a crash/failure at any point rolls back
 * everything together, and no two callers racing from the same believed
 * current version (including two "first version" callers both starting from
 * null) can both succeed. See transaction.ts for why a plain SqlClient
 * cannot provide this guarantee under a pooled production connection.
 */

type StoredResult =
  | { readonly kind: "VALIDATION_ERROR"; readonly detail: string }
  | { readonly kind: "CONCURRENCY_CONFLICT" }
  | { readonly kind: "EXECUTED"; readonly versionId: string };

export type CreateCommercialTermsVersionOutcome =
  | CommercialEconomicsMutationRejection
  | { readonly kind: "EXECUTED"; readonly version: CommercialTermsVersionRecord }
  | { readonly kind: "REPLAYED"; readonly versionId: string };

export interface CreateCommercialTermsVersionDeps {
  readonly transactionRunner: TransactionRunner;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
}

function fingerprint(input: CreateCommercialTermsVersionMutationInput): string {
  const material = {
    contextType: input.contextType, companyId: input.companyId, opportunityId: input.opportunityId,
    terms: input.terms, supportingClaimIds: input.supportingClaimIds, supportingEvidenceIds: input.supportingEvidenceIds,
    ruleVersion: input.ruleVersion, expectedCurrentVersionId: input.expectedCurrentVersionId,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

/** Stable, deterministic identity for the advisory lock -- the same (contextType, contextId) pair always contends on the same lock, regardless of who is calling or what idempotency key they used. */
function canonicalLockKey(contextType: CreateCommercialTermsVersionMutationInput["contextType"], contextId: string): string {
  return `commercial_terms:${contextType}:${contextId}`;
}

export async function executeProtectedCreateCommercialTermsVersion(
  input: CreateCommercialTermsVersionMutationInput,
  deps: CreateCommercialTermsVersionDeps,
): Promise<CreateCommercialTermsVersionOutcome> {
  const authResult = await authorizeOperator("commercial_economics.write", { getSession: deps.getSession, repository: deps.operatorRepository });
  if (authResult.state === "UNAUTHENTICATED") return { kind: "REJECTED", reason: "UNAUTHENTICATED" };
  if (authResult.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { kind: "REJECTED", reason: "UNAUTHORIZED" };
  const operator = authResult.operator;

  if (input.contextType === "COMPANY" && (!input.companyId || input.opportunityId)) {
    return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: "COMPANY context requires companyId and forbids opportunityId" };
  }
  if (input.contextType === "OPPORTUNITY" && (!input.opportunityId || input.companyId)) {
    return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: "OPPORTUNITY context requires opportunityId and forbids companyId" };
  }
  const contextId = input.companyId ?? input.opportunityId;
  if (!contextId) return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: "A contextId (companyId or opportunityId) is required" };

  const lockKey = canonicalLockKey(input.contextType, contextId);
  const requestFingerprint = fingerprint(input);

  return deps.transactionRunner<CreateCommercialTermsVersionOutcome>(async (client) => {
    const commercialTermsRepository = new PostgresCommercialTermsRepository(client);
    const idempotencyRepository = new PostgresIdempotencyRepository(client);

    const claim = await idempotencyRepository.claim({
      idempotencyKey: input.idempotencyKey,
      operatorId: operator.operatorId,
      action: "commercial_economics.create_commercial_terms_version",
      targetType: "COMMERCIAL_TERMS_CONTEXT",
      targetId: contextId,
      requestFingerprint,
    });
    if (claim.outcome === "CONFLICT") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: claim.reason };
    if (claim.outcome === "IN_PROGRESS") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: "IN_PROGRESS" };
    if (claim.outcome === "REPLAY") {
      const stored = claim.result as StoredResult;
      if (stored.kind === "EXECUTED") return { kind: "REPLAYED", versionId: stored.versionId };
      if (stored.kind === "CONCURRENCY_CONFLICT") return { kind: "REJECTED", reason: "CONCURRENCY_CONFLICT" };
      return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: stored.detail };
    }

    // claim.outcome === "CLAIMED" -- acquire the canonical target lock for the rest of this transaction.
    // Held until COMMIT/ROLLBACK; any other transaction requesting the same lockKey blocks here until we finish,
    // which is what makes the current-version check below race-free, including for two "first version" callers
    // that both started from expectedCurrentVersionId = null.
    await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [lockKey]);

    const current = await commercialTermsRepository.getCurrent(input.contextType, contextId);
    const currentId = current?.id ?? null;
    if (currentId !== input.expectedCurrentVersionId) {
      await idempotencyRepository.complete(input.idempotencyKey, { kind: "CONCURRENCY_CONFLICT" } satisfies StoredResult);
      return { kind: "REJECTED", reason: "CONCURRENCY_CONFLICT", detail: `Expected current version ${input.expectedCurrentVersionId ?? "null"}, actual current version ${currentId ?? "null"}` };
    }

    const version = await commercialTermsRepository.createVersion({
      contextType: input.contextType,
      companyId: input.companyId,
      opportunityId: input.opportunityId,
      terms: input.terms,
      supportingClaimIds: input.supportingClaimIds,
      supportingEvidenceIds: input.supportingEvidenceIds,
      ruleVersion: input.ruleVersion,
      assertedBy: operator.operatorId,
      evaluatedAt: new Date(),
      supersedesCommercialTermsId: input.expectedCurrentVersionId,
    });
    await idempotencyRepository.complete(input.idempotencyKey, { kind: "EXECUTED", versionId: version.id } satisfies StoredResult);
    return { kind: "EXECUTED", version };
  });
}
