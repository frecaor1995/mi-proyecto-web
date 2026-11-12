import type { BurdenComponent, BurdenProfileScope } from "./burden-profile";
import type { CashFlowAssumptions } from "./cash-flow-engine";
import type { DeploymentEconomicsInput, ScenarioLabel } from "./commercial-economics";
import type { CommercialContextType } from "./commercial-economics-persistence";
import type { CommercialTermsContract } from "./commercial-terms";
import type { EconomicValue, MoneyAmount, Rate } from "./economic-value";
import type { ScenarioOverrides } from "./economics-scenario";

/**
 * Phase 4G. Client-facing mutation intent contracts for protected commercial
 * economics writes. Deliberately excludes any field that must be server-
 * derived -- actor identity (assertedBy/operatorId/role/permission),
 * timestamps (evaluatedAt/createdAt), and canonical version identity -- and,
 * critically for the scenario snapshot mutation, ANY derived economic result
 * (revenue/cost/profit/margin/working capital). Client input expresses only
 * economic FACTS and mutation intent; every derived number is calculated
 * server-side by the certified 4D/4E/4F engines (mandate sections 9/20/21/43)
 * -- there is no field here through which a fabricated result could even be
 * submitted, let alone accepted.
 */

export interface CreateCommercialTermsVersionMutationInput {
  readonly contextType: CommercialContextType;
  readonly companyId: string | null;
  readonly opportunityId: string | null;
  readonly terms: CommercialTermsContract;
  readonly supportingClaimIds: readonly string[];
  readonly supportingEvidenceIds: readonly string[];
  readonly ruleVersion: string;
  /** The version id the caller believes is currently current for this context, or null if none exists yet -- used for optimistic concurrency, never trusted as authoritative without server verification against the certified "current" query. */
  readonly expectedCurrentVersionId: string | null;
  readonly idempotencyKey: string;
}

export interface CreateBurdenProfileVersionMutationInput {
  readonly scope: BurdenProfileScope;
  readonly components: readonly BurdenComponent[];
  readonly ruleVersion: string;
  readonly expectedCurrentVersionId: string | null;
  readonly idempotencyKey: string;
}

export interface SaveEconomicsScenarioSnapshotMutationInput {
  readonly opportunityId: string;
  readonly scenarioLabel: ScenarioLabel;
  /** References to already-persisted 4C versions -- the server fetches the canonical CommercialTermsContract/BurdenComponent[] from these, never accepting them re-typed from the client. */
  readonly commercialTermsVersionId: string;
  readonly burdenProfileVersionId: string;
  /** The labor facts NOT already captured by a persisted burden profile version (which supplies only burdenComponents). */
  readonly labor: {
    readonly basePayRate: EconomicValue<MoneyAmount>;
    readonly overtimeMultiplier: EconomicValue<Rate>;
    readonly workerPerDiem: EconomicValue<MoneyAmount>;
  };
  readonly deployment: DeploymentEconomicsInput;
  readonly cashFlowAssumptions: CashFlowAssumptions;
  /** Optional certified 4F scenario overrides, resolved and executed server-side -- never a shortcut around server recomputation. */
  readonly overrides?: ScenarioOverrides;
  /** An explicit, caller-known prior snapshot this one supersedes (an audit link, not a "current" concurrency chain -- 4C's EconomicsScenarioRepository has no getCurrent* method, so snapshots are independent historical captures per mandate section 24). Validated to exist if supplied. */
  readonly supersedesScenarioId?: string | null;
  readonly ruleVersion: string;
  readonly idempotencyKey: string;
}

export type CommercialEconomicsMutationRejectionReason =
  | "UNAUTHENTICATED"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "CONCURRENCY_CONFLICT"
  | "NOT_FOUND"
  | "CANONICAL_INPUT_UNAVAILABLE"
  | "SCENARIO_CALCULATION_UNAVAILABLE";

export interface CommercialEconomicsMutationRejection {
  readonly kind: "REJECTED";
  readonly reason: CommercialEconomicsMutationRejectionReason;
  readonly detail?: string;
}
