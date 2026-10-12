import type { EconomicFactTier, EconomicValue, Rate } from "./economic-value";
import { createRate, deriveEconomicResult, weakestTier, type DerivedEconomicResult } from "./economic-value";
import type { OccupationId, TradeId } from "./workforce-taxonomy";

/**
 * Phase 4B. Canonical, composable employer-burden vocabulary. Burden is
 * NOT an opportunity claim -- it is an internal, reusable operating
 * parameter (payroll tax, workers comp, benefits, ...), scoped by
 * jurisdiction/trade/occupation/company rather than sourced as evidence
 * about a specific buyer. No real payroll-tax, workers-comp, general-
 * liability, or benefits rate is hardcoded anywhere in this module --
 * every rate is an explicit EconomicValue<Rate> the caller must supply.
 */

export const BURDEN_COMPONENT_TYPES = ["PAYROLL_TAX", "WORKERS_COMPENSATION", "GENERAL_LIABILITY", "BENEFITS", "OTHER"] as const;
export type BurdenComponentType = (typeof BURDEN_COMPONENT_TYPES)[number];

/**
 * Which portion(s) of a worker's wages a burden component's rate applies
 * to. Deliberately explicit and per-component -- Phase 4B authorizes no
 * assumption that every component applies identically to overtime.
 */
export const BURDEN_WAGE_PORTIONS = ["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"] as const;
export type BurdenWagePortion = (typeof BURDEN_WAGE_PORTIONS)[number];

export interface BurdenComponent {
  readonly type: BurdenComponentType;
  readonly rate: EconomicValue<Rate>;
  readonly appliesTo: readonly BurdenWagePortion[];
}

/**
 * The approved future resolution hierarchy (PLATFORM_DEFAULT -> JURISDICTION
 * -> TRADE_OCCUPATION -> COMPANY_OVERRIDE -> SCENARIO_OVERRIDE). Phase 4B
 * defines the shape only -- no resolution/merge logic and no persistence.
 */
export const BURDEN_PROFILE_SCOPE_LEVELS = ["PLATFORM_DEFAULT", "JURISDICTION", "TRADE_OCCUPATION", "COMPANY_OVERRIDE", "SCENARIO_OVERRIDE"] as const;
export type BurdenProfileScopeLevel = (typeof BURDEN_PROFILE_SCOPE_LEVELS)[number];

export interface BurdenProfileScope {
  readonly level: BurdenProfileScopeLevel;
  /** e.g. a state/country code -- never hardcoded to a single jurisdiction anywhere in this module. */
  readonly jurisdiction: string | null;
  readonly tradeId: TradeId | null;
  readonly occupationId: OccupationId | null;
  readonly companyId: string | null;
  /** Set only for SCENARIO_OVERRIDE. */
  readonly scenarioId: string | null;
}

export interface BurdenProfile {
  readonly scope: BurdenProfileScope;
  readonly components: readonly BurdenComponent[];
}

/**
 * Sums the components applicable to one wage portion. A pure proof helper
 * (Phase 4B does not implement a burden calculation engine) demonstrating
 * that components remain distinct and composable, and that an UNKNOWN
 * component rate blocks the total rather than being silently skipped/zeroed.
 */
export function totalBurdenRateFor(components: readonly BurdenComponent[], portion: BurdenWagePortion): DerivedEconomicResult<Rate> {
  const applicable = components.filter((component) => component.appliesTo.includes(portion));
  return deriveEconomicResult(applicable.map((component) => component.rate), () => {
    const knownRates = applicable
      .map((component) => component.rate)
      .filter((rate): rate is Extract<EconomicValue<Rate>, { tier: Exclude<EconomicFactTier, "UNKNOWN"> }> => rate.tier !== "UNKNOWN");
    return createRate(knownRates.reduce((sum, rate) => sum + rate.value.value, 0));
  });
}

/** Exposed for callers that need the effective tier of a burden total without the summed value (e.g. to decide whether to even attempt a downstream calculation). */
export function burdenTierFor(components: readonly BurdenComponent[], portion: BurdenWagePortion): EconomicFactTier {
  return weakestTier(components.filter((component) => component.appliesTo.includes(portion)).map((component) => component.rate.tier));
}
