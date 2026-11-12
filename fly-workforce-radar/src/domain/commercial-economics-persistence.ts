import type { BurdenComponent, BurdenProfileScope } from "./burden-profile";
import type { CommercialTermsContract } from "./commercial-terms";
import type { ScenarioLabel } from "./commercial-economics";

/**
 * Phase 4C. Persistence-facing record types layered ON TOP of the certified
 * Phase 4B domain contracts (CommercialTermsContract, BurdenComponent,
 * BurdenProfileScope, ScenarioLabel) -- none of those 4B types are modified
 * here. Kept in a separate file rather than added to commercial-economics.ts/
 * burden-profile.ts/commercial-terms.ts specifically so the certified 4B
 * files remain untouched (per the "do not casually rename or redesign these
 * contracts" instruction) and so this persistence layer is clearly
 * additive/optional to import.
 */

export type CommercialContextType = "COMPANY" | "OPPORTUNITY";

export interface CreateCommercialTermsVersionInput {
  readonly contextType: CommercialContextType;
  readonly companyId: string | null;
  readonly opportunityId: string | null;
  readonly terms: CommercialTermsContract;
  readonly supportingClaimIds: readonly string[];
  readonly supportingEvidenceIds: readonly string[];
  readonly ruleVersion: string;
  readonly assertedBy: string | null;
  readonly evaluatedAt: Date;
  readonly supersedesCommercialTermsId: string | null;
}
export interface CommercialTermsVersionRecord extends CreateCommercialTermsVersionInput {
  readonly id: string;
  readonly createdAt: Date;
}

export interface CreateBurdenProfileVersionInput {
  readonly scope: BurdenProfileScope;
  readonly components: readonly BurdenComponent[];
  readonly ruleVersion: string;
  readonly assertedBy: string | null;
  readonly evaluatedAt: Date;
  readonly supersedesBurdenProfileId: string | null;
}
export interface BurdenProfileVersionRecord extends CreateBurdenProfileVersionInput {
  readonly id: string;
  readonly createdAt: Date;
}

export interface CreateEconomicsScenarioSnapshotInput {
  readonly opportunityId: string;
  readonly scenarioLabel: ScenarioLabel;
  readonly commercialTermsVersionId: string | null;
  readonly burdenProfileVersionId: string | null;
  /** Enough of the labor/deployment input to reproduce what was believed at evaluatedAt -- structural payload, not further typed in 4C. */
  readonly basis: Record<string, unknown>;
  /** Any DerivedEconomicResult values computed at that time; empty by default -- 4C does not implement the calculation engine. */
  readonly result: Record<string, unknown>;
  readonly ruleVersion: string;
  readonly assertedBy: string | null;
  readonly evaluatedAt: Date;
  readonly asOf: Date;
  readonly supersedesScenarioId: string | null;
}
export interface EconomicsScenarioSnapshotRecord extends CreateEconomicsScenarioSnapshotInput {
  readonly id: string;
  readonly createdAt: Date;
}

/**
 * Defensive shape check run before any EconomicValue<T>-shaped jsonb is
 * persisted. jsonb itself enforces no schema, so this is the one place that
 * guards against a corrupted/malformed payload smuggling a fake value
 * alongside tier:"UNKNOWN" (structurally impossible to construct through the
 * certified 4B EconomicValue<T> type itself, but jsonb round-trips are not
 * type-checked at the database boundary).
 */
export function assertValidEconomicValueShape(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") throw new Error(`${path}: expected an EconomicValue object`);
  const tier = (value as { tier?: unknown }).tier;
  if (typeof tier !== "string" || !["VERIFIED", "UNVERIFIED_SOURCED", "OPERATOR_ASSUMPTION", "UNKNOWN"].includes(tier)) {
    throw new Error(`${path}: invalid or missing economic fact tier`);
  }
  const hasValue = "value" in (value as Record<string, unknown>);
  if (tier === "UNKNOWN" && hasValue) throw new Error(`${path}: UNKNOWN tier must not carry a value (unknown must never be persisted as a fake value)`);
  if (tier !== "UNKNOWN" && !hasValue) throw new Error(`${path}: non-UNKNOWN tier must carry a value`);
}
