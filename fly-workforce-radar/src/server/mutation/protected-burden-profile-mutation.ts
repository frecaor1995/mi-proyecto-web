import { createHash } from "node:crypto";
import type { CommercialEconomicsMutationRejection, CreateBurdenProfileVersionMutationInput } from "../../domain/commercial-economics-mutation";
import type { BurdenProfileVersionRecord } from "../../domain/commercial-economics-persistence";
import { authorizeOperator } from "../auth/authorization";
import type { ServerSession } from "../auth/session";
import type { TransactionRunner } from "../database/transaction";
import { PostgresBurdenProfileRepository } from "../repositories/burden-profile/postgres-burden-profile-repository";
import { PostgresIdempotencyRepository } from "../repositories/idempotency/postgres-idempotency-repository";
import type { OperatorRepository } from "../repositories/operator/operator-repository";

/**
 * Phase 4G. Protected server-side mutation: create a new Burden Profile
 * version. Mirrors protected-commercial-terms-mutation.ts exactly, including
 * the pre-commit concurrency/atomicity correction: claim, the canonical
 * scope lock, the current-version check, the write, and idempotency
 * completion all run inside one real transaction via `deps.transactionRunner`.
 *
 * Per the certified Phase 4F limitation (BurdenComponent has no true stable
 * id -- see economics-scenario.ts's composite-override correction), this
 * mutation persists a COMPLETE validated components array as one version; it
 * does not attempt in-place per-component patching of a persisted profile.
 */

type StoredResult =
  | { readonly kind: "VALIDATION_ERROR"; readonly detail: string }
  | { readonly kind: "CONCURRENCY_CONFLICT" }
  | { readonly kind: "EXECUTED"; readonly versionId: string };

export type CreateBurdenProfileVersionOutcome =
  | CommercialEconomicsMutationRejection
  | { readonly kind: "EXECUTED"; readonly version: BurdenProfileVersionRecord }
  | { readonly kind: "REPLAYED"; readonly versionId: string };

export interface CreateBurdenProfileVersionDeps {
  readonly transactionRunner: TransactionRunner;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
}

function fingerprint(input: CreateBurdenProfileVersionMutationInput): string {
  const material = {
    scope: input.scope, components: input.components, ruleVersion: input.ruleVersion, expectedCurrentVersionId: input.expectedCurrentVersionId,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

/**
 * Stable, deterministic identity for BOTH the idempotency targetId (which
 * must be a real uuid -- see below) and the advisory lock. A burden profile
 * scope has no natural pre-existing UUID of its own (there is no row to
 * target until a version is created); deterministically derives a valid
 * UUID from the scope's own identity so the same scope always maps to the
 * same target/lock, without claiming this id refers to any real persisted row.
 */
function scopeIdentity(scope: CreateBurdenProfileVersionMutationInput["scope"]): { readonly targetId: string; readonly lockKey: string } {
  const hex = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
  const targetId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return { targetId, lockKey: `burden_profile:${hex}` };
}

export async function executeProtectedCreateBurdenProfileVersion(
  input: CreateBurdenProfileVersionMutationInput,
  deps: CreateBurdenProfileVersionDeps,
): Promise<CreateBurdenProfileVersionOutcome> {
  const authResult = await authorizeOperator("commercial_economics.write", { getSession: deps.getSession, repository: deps.operatorRepository });
  if (authResult.state === "UNAUTHENTICATED") return { kind: "REJECTED", reason: "UNAUTHENTICATED" };
  if (authResult.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { kind: "REJECTED", reason: "UNAUTHORIZED" };
  const operator = authResult.operator;

  if (input.components.length === 0) {
    return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: "A burden profile version requires at least one component" };
  }
  if (input.scope.level === "SCENARIO_OVERRIDE" && !input.scope.scenarioId) {
    return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: "SCENARIO_OVERRIDE scope requires scenarioId" };
  }
  if (input.scope.level === "COMPANY_OVERRIDE" && !input.scope.companyId) {
    return { kind: "REJECTED", reason: "VALIDATION_ERROR", detail: "COMPANY_OVERRIDE scope requires companyId" };
  }

  const { targetId, lockKey } = scopeIdentity(input.scope);
  const requestFingerprint = fingerprint(input);

  return deps.transactionRunner<CreateBurdenProfileVersionOutcome>(async (client) => {
    const burdenProfileRepository = new PostgresBurdenProfileRepository(client);
    const idempotencyRepository = new PostgresIdempotencyRepository(client);

    const claim = await idempotencyRepository.claim({
      idempotencyKey: input.idempotencyKey,
      operatorId: operator.operatorId,
      action: "commercial_economics.create_burden_profile_version",
      targetType: "BURDEN_PROFILE_SCOPE",
      targetId,
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

    // claim.outcome === "CLAIMED" -- acquire the canonical scope lock for the rest of this transaction (see canonical-terms mutation for the identical rationale).
    await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [lockKey]);

    const current = await burdenProfileRepository.getCurrentForScope(input.scope);
    const currentId = current?.id ?? null;
    if (currentId !== input.expectedCurrentVersionId) {
      await idempotencyRepository.complete(input.idempotencyKey, { kind: "CONCURRENCY_CONFLICT" } satisfies StoredResult);
      return { kind: "REJECTED", reason: "CONCURRENCY_CONFLICT", detail: `Expected current version ${input.expectedCurrentVersionId ?? "null"}, actual current version ${currentId ?? "null"}` };
    }

    const version = await burdenProfileRepository.createVersion({
      scope: input.scope,
      components: input.components,
      ruleVersion: input.ruleVersion,
      assertedBy: operator.operatorId,
      evaluatedAt: new Date(),
      supersedesBurdenProfileId: input.expectedCurrentVersionId,
    });
    await idempotencyRepository.complete(input.idempotencyKey, { kind: "EXECUTED", versionId: version.id } satisfies StoredResult);
    return { kind: "EXECUTED", version };
  });
}
