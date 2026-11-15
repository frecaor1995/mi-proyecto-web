import { createHash } from "node:crypto";
import type { LaborEconomicsInput } from "../../domain/commercial-economics";
import type { CommercialEconomicsMutationRejection, SaveEconomicsScenarioSnapshotMutationInput } from "../../domain/commercial-economics-mutation";
import type { EconomicsScenarioSnapshotRecord } from "../../domain/commercial-economics-persistence";
import type { ScenarioDefinition } from "../../domain/economics-scenario";
import { runScenario } from "../../domain/scenario-engine";
import { authorizeOperator } from "../auth/authorization";
import type { ServerSession } from "../auth/session";
import type { TransactionRunner } from "../database/transaction";
import { PostgresBurdenProfileRepository } from "../repositories/burden-profile/postgres-burden-profile-repository";
import { PostgresCommercialTermsRepository } from "../repositories/commercial-terms/postgres-commercial-terms-repository";
import { PostgresEconomicsScenarioRepository } from "../repositories/economics-scenario/postgres-economics-scenario-repository";
import { PostgresIdempotencyRepository } from "../repositories/idempotency/postgres-idempotency-repository";
import type { OperatorRepository } from "../repositories/operator/operator-repository";

/**
 * Phase 4G. Protected server-side mutation: save a canonical Economics
 * Scenario Snapshot. The client input contract carries NO derived-result
 * field at all -- there is no `grossProfit`, `revenue`,
 * `workingCapitalRequirement`, or any other output a client could submit to
 * be trusted. Every derived number in the persisted `result` comes from
 * running the certified 4F `runScenario` (composing certified 4D + 4E)
 * against canonical inputs resolved server-side from already-persisted 4C
 * versions.
 *
 * Snapshots are independent historical captures, not a "current" chain
 * (EconomicsScenarioRepository has no getCurrent* method -- mandate section
 * 24) -- per the concurrency/atomicity correction mandate section 10, this
 * mutation does NOT acquire a canonical target lock or perform a current-
 * version check; inventing one would be exactly the "current-head rule" the
 * correction explicitly forbids here. It DOES still run claim -> resolve ->
 * recompute -> insert -> complete inside one real transaction via
 * `deps.transactionRunner`, for the same general idempotency-completion-
 * failure atomicity reason as the other two mutations (mandate section 9) --
 * a crash between the insert and idempotency completion rolls back the
 * whole snapshot rather than leaving an orphaned row.
 */

type StoredResult =
  | { readonly kind: "VALIDATION_ERROR"; readonly detail: string }
  | { readonly kind: "CANONICAL_INPUT_UNAVAILABLE"; readonly detail: string }
  | { readonly kind: "SCENARIO_CALCULATION_UNAVAILABLE"; readonly detail: string }
  | { readonly kind: "EXECUTED"; readonly snapshotId: string };

export type SaveEconomicsScenarioSnapshotOutcome =
  | CommercialEconomicsMutationRejection
  | { readonly kind: "EXECUTED"; readonly snapshot: EconomicsScenarioSnapshotRecord }
  | { readonly kind: "REPLAYED"; readonly snapshotId: string };

export interface SaveEconomicsScenarioSnapshotDeps {
  readonly transactionRunner: TransactionRunner;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
}

function fingerprint(input: SaveEconomicsScenarioSnapshotMutationInput): string {
  const material = {
    opportunityId: input.opportunityId, scenarioLabel: input.scenarioLabel,
    commercialTermsVersionId: input.commercialTermsVersionId, burdenProfileVersionId: input.burdenProfileVersionId,
    labor: input.labor, deployment: input.deployment, cashFlowAssumptions: input.cashFlowAssumptions,
    overrides: input.overrides ?? null, supersedesScenarioId: input.supersedesScenarioId ?? null, ruleVersion: input.ruleVersion,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

export async function executeProtectedSaveEconomicsScenarioSnapshot(
  input: SaveEconomicsScenarioSnapshotMutationInput,
  deps: SaveEconomicsScenarioSnapshotDeps,
): Promise<SaveEconomicsScenarioSnapshotOutcome> {
  const authResult = await authorizeOperator("commercial_economics.write", { getSession: deps.getSession, repository: deps.operatorRepository });
  if (authResult.state === "UNAUTHENTICATED") return { kind: "REJECTED", reason: "UNAUTHENTICATED" };
  if (authResult.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { kind: "REJECTED", reason: "UNAUTHORIZED" };
  const operator = authResult.operator;

  const requestFingerprint = fingerprint(input);

  return deps.transactionRunner<SaveEconomicsScenarioSnapshotOutcome>(async (client) => {
    const commercialTermsRepository = new PostgresCommercialTermsRepository(client);
    const burdenProfileRepository = new PostgresBurdenProfileRepository(client);
    const economicsScenarioRepository = new PostgresEconomicsScenarioRepository(client);
    const idempotencyRepository = new PostgresIdempotencyRepository(client);

    const claim = await idempotencyRepository.claim({
      idempotencyKey: input.idempotencyKey,
      operatorId: operator.operatorId,
      action: "commercial_economics.save_scenario_snapshot",
      targetType: "OPPORTUNITY",
      targetId: input.opportunityId,
      requestFingerprint,
    });
    if (claim.outcome === "CONFLICT") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: claim.reason };
    if (claim.outcome === "IN_PROGRESS") return { kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: "IN_PROGRESS" };
    if (claim.outcome === "REPLAY") {
      const stored = claim.result as StoredResult;
      if (stored.kind === "EXECUTED") return { kind: "REPLAYED", snapshotId: stored.snapshotId };
      return { kind: "REJECTED", reason: stored.kind, detail: stored.detail };
    }

    const commercialTermsVersion = await commercialTermsRepository.getById(input.commercialTermsVersionId);
    if (!commercialTermsVersion) {
      const detail = "commercialTermsVersionId does not reference an existing commercial terms version";
      await idempotencyRepository.complete(input.idempotencyKey, { kind: "CANONICAL_INPUT_UNAVAILABLE", detail } satisfies StoredResult);
      return { kind: "REJECTED", reason: "CANONICAL_INPUT_UNAVAILABLE", detail };
    }
    const burdenProfileVersion = await burdenProfileRepository.getById(input.burdenProfileVersionId);
    if (!burdenProfileVersion) {
      const detail = "burdenProfileVersionId does not reference an existing burden profile version";
      await idempotencyRepository.complete(input.idempotencyKey, { kind: "CANONICAL_INPUT_UNAVAILABLE", detail } satisfies StoredResult);
      return { kind: "REJECTED", reason: "CANONICAL_INPUT_UNAVAILABLE", detail };
    }

    let supersedesScenarioId: string | null = null;
    if (input.supersedesScenarioId) {
      const priorSnapshot = await economicsScenarioRepository.getById(input.supersedesScenarioId);
      if (!priorSnapshot) {
        const detail = "supersedesScenarioId does not reference an existing snapshot";
        await idempotencyRepository.complete(input.idempotencyKey, { kind: "CANONICAL_INPUT_UNAVAILABLE", detail } satisfies StoredResult);
        return { kind: "REJECTED", reason: "CANONICAL_INPUT_UNAVAILABLE", detail };
      }
      supersedesScenarioId = input.supersedesScenarioId;
    }

    const baseLabor: LaborEconomicsInput = { ...input.labor, burdenComponents: burdenProfileVersion.components };
    const definition: ScenarioDefinition = {
      label: input.scenarioLabel,
      baseLabor,
      baseCommercialTerms: commercialTermsVersion.terms,
      baseDeployment: input.deployment,
      baseCashFlowAssumptions: input.cashFlowAssumptions,
      overrides: input.overrides,
    };

    let scenarioResult: ReturnType<typeof runScenario>;
    try {
      scenarioResult = runScenario(definition);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Scenario calculation failed";
      await idempotencyRepository.complete(input.idempotencyKey, { kind: "SCENARIO_CALCULATION_UNAVAILABLE", detail } satisfies StoredResult);
      return { kind: "REJECTED", reason: "SCENARIO_CALCULATION_UNAVAILABLE", detail };
    }

    const snapshot = await economicsScenarioRepository.createSnapshot({
      opportunityId: input.opportunityId,
      scenarioLabel: input.scenarioLabel,
      commercialTermsVersionId: input.commercialTermsVersionId,
      burdenProfileVersionId: input.burdenProfileVersionId,
      basis: {
        labor: input.labor,
        burdenComponents: burdenProfileVersion.components,
        deployment: input.deployment,
        cashFlowAssumptions: input.cashFlowAssumptions,
        overrides: input.overrides ?? null,
        resolvedInputs: scenarioResult.resolvedInputs,
      },
      // The server-generated certified 4D/4E/4F result -- nothing here originates from client input.
      result: {
        economics: scenarioResult.economics,
        cashFlow: scenarioResult.cashFlow,
        profitability: scenarioResult.profitability,
        weakestTier: scenarioResult.weakestTier,
        blockingReasons: scenarioResult.blockingReasons,
      },
      ruleVersion: input.ruleVersion,
      assertedBy: operator.operatorId,
      evaluatedAt: new Date(),
      asOf: new Date(),
      supersedesScenarioId,
    });
    await idempotencyRepository.complete(input.idempotencyKey, { kind: "EXECUTED", snapshotId: snapshot.id } satisfies StoredResult);
    return { kind: "EXECUTED", snapshot };
  });
}
