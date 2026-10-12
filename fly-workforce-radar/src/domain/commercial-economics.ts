import type { BurdenComponent, BurdenWagePortion } from "./burden-profile";
import { totalBurdenRateFor } from "./burden-profile";
import type { BillingCadence, CommercialTermsContract, PaymentTerms, PayrollFrequency } from "./commercial-terms";
import type { DerivedEconomicResult, EconomicValue, MoneyAmount, MoneyDelta, Rate, SignedRate } from "./economic-value";
import { createSignedRate, multiplyMoney, weakestNonUnknownTier } from "./economic-value";

/**
 * Phase 4B. Canonical commercialization & economics domain vocabulary.
 * Domain-only: no persistence, no mutation, no UI, no cash-flow simulation.
 * Composes economic-value.ts, burden-profile.ts, and commercial-terms.ts;
 * re-exports the primitives most callers need so this remains the single
 * import surface a future 4C+ phase reaches for.
 */
export type {
  MoneyAmount, MoneyDelta, Rate, SignedRate, EconomicFactTier, EconomicValue, DerivedEconomicResult,
} from "./economic-value";
export {
  createMoneyAmount, addMoney, subtractMoney, multiplyMoney, createRate, createSignedRate,
  percentageToDecimalFraction, ECONOMIC_FACT_TIERS, weakestTier, weakestNonUnknownTier, deriveEconomicResult,
  verifiedValue, unverifiedSourcedValue, assumedValue, unknownValue,
} from "./economic-value";
export type { BurdenComponent, BurdenComponentType, BurdenProfile, BurdenProfileScope, BurdenProfileScopeLevel, BurdenWagePortion } from "./burden-profile";
export { BURDEN_COMPONENT_TYPES, BURDEN_PROFILE_SCOPE_LEVELS, BURDEN_WAGE_PORTIONS, totalBurdenRateFor, burdenTierFor } from "./burden-profile";
export type { BillingCadence, CommercialTermsContract, OvertimeBillBasis, PayrollFrequency, PaymentTerms } from "./commercial-terms";
export { BILLING_CADENCES, PAYROLL_FREQUENCIES, COMMON_PAYMENT_TERMS, createPaymentTerms } from "./commercial-terms";

/* ------------------------------------------------------------------------ */
/* Labor economics input contract                                           */
/* ------------------------------------------------------------------------ */

export interface LaborEconomicsInput {
  readonly basePayRate: EconomicValue<MoneyAmount>;
  readonly overtimeMultiplier: EconomicValue<Rate>;
  readonly workerPerDiem: EconomicValue<MoneyAmount>;
  readonly burdenComponents: readonly BurdenComponent[];
}

/**
 * Future 4C+ mapping boundary only -- describes exactly which existing
 * demand_signals-shaped fields (supabase/migrations/20260817010000_
 * canonical_model.sql) a later persistence-integration layer will read to
 * help populate LaborEconomicsInput. No DB access happens here; this is a
 * type contract, not an implementation, and does not duplicate the existing
 * NormalizedDemandSignal (domain/ingestion.ts) -- it names only the subset
 * relevant to economics.
 */
export interface DemandSignalEconomicsSource {
  readonly payCurrency: string | null;
  readonly basePayMin: number | null;
  readonly basePayMax: number | null;
  readonly payPeriod: string | null;
  readonly overtimeAvailable: boolean | null;
  readonly overtimeRate: number | null;
  readonly perDiemAvailable: boolean | null;
  readonly perDiemAmount: number | null;
  readonly perDiemFrequency: string | null;
  readonly headcountEstimate: number | null;
}

/* ------------------------------------------------------------------------ */
/* Deployment economics contract                                            */
/* ------------------------------------------------------------------------ */

/** UNKNOWN, FIXED, and OPEN_ENDED are structurally distinct -- open-ended work is never silently converted to an arbitrary week count. */
export type DeploymentDuration =
  | { readonly kind: "UNKNOWN" }
  | { readonly kind: "OPEN_ENDED" }
  | { readonly kind: "FIXED"; readonly weeks: number };

export interface DeploymentEconomicsInput {
  readonly headcount: EconomicValue<number>;
  readonly regularHoursPerWeek: EconomicValue<number>;
  readonly overtimeHoursPerWeek: EconomicValue<number>;
  readonly duration: DeploymentDuration;
  readonly startDate: EconomicValue<string> | null;
  readonly estimatedEndDate: EconomicValue<string> | null;
  /** An economically relevant location/jurisdiction reference (e.g. for per-diem/travel/burden scoping) -- not the opportunity's general location field. */
  readonly jurisdiction: string | null;
}

/* ------------------------------------------------------------------------ */
/* Scenario contract (labels only -- never a fact tier)                     */
/* ------------------------------------------------------------------------ */

export const SCENARIO_LABELS = ["BASE", "CONSERVATIVE", "TARGET"] as const;
export type ScenarioLabel = (typeof SCENARIO_LABELS)[number];

/** A scenario bundles inputs at whatever tier they actually are; the label itself carries no trust/tier meaning. */
export interface EconomicScenario {
  readonly label: ScenarioLabel;
  readonly labor: LaborEconomicsInput;
  readonly commercialTerms: CommercialTermsContract;
  readonly deployment: DeploymentEconomicsInput;
}

/* ------------------------------------------------------------------------ */
/* Cash-flow vocabulary (not an engine)                                     */
/* ------------------------------------------------------------------------ */

export interface CashFlowVocabulary {
  readonly payrollFrequency: PayrollFrequency;
  readonly billingCadence: BillingCadence;
  readonly paymentTerms: PaymentTerms;
}
/** A single simulated payroll outflow at a given week index -- vocabulary only, no simulation function is implemented in 4B. */
export interface CashOutflowEvent { readonly weekIndex: number; readonly amount: MoneyAmount }
/** A single simulated client cash inflow at a given week index -- vocabulary only. */
export interface CashInflowEvent { readonly weekIndex: number; readonly amount: MoneyAmount }

/* ------------------------------------------------------------------------ */
/* Named derived-result contracts (types only, per section 19/20)           */
/* ------------------------------------------------------------------------ */

export type LaborCostPerHourResult = DerivedEconomicResult<MoneyAmount>;
export type RevenuePerHourResult = DerivedEconomicResult<MoneyAmount>;
export type GrossProfitPerHourResult = DerivedEconomicResult<MoneyDelta>;
export type GrossMarginPercentResult = DerivedEconomicResult<SignedRate>;
export type WeeklyRevenueResult = DerivedEconomicResult<MoneyAmount>;
export type WeeklyCostResult = DerivedEconomicResult<MoneyAmount>;
export type WeeklyGrossProfitResult = DerivedEconomicResult<MoneyDelta>;
export type MonthlyEstimateResult = DerivedEconomicResult<MoneyDelta>;
export type DeploymentRevenueResult = DerivedEconomicResult<MoneyAmount>;
export type DeploymentCostResult = DerivedEconomicResult<MoneyAmount>;
export type DeploymentGrossProfitResult = DerivedEconomicResult<MoneyDelta>;
export type PayrollCashExposureResult = DerivedEconomicResult<MoneyAmount>;
export type WorkingCapitalRequirementResult = DerivedEconomicResult<MoneyAmount>;

/* ------------------------------------------------------------------------ */
/* Small pure proof helpers (section 20 -- not a calculation engine)        */
/* ------------------------------------------------------------------------ */

/** Proves the burden-composition + weakest-tier + UNKNOWN-blocks-derivation contracts work together end to end; not a full payroll engine. */
export function laborCostPerHour(basePayRate: EconomicValue<MoneyAmount>, burdenComponents: readonly BurdenComponent[], portion: BurdenWagePortion): LaborCostPerHourResult {
  if (basePayRate.tier === "UNKNOWN") return { state: "UNKNOWN" };
  const burden = totalBurdenRateFor(burdenComponents, portion);
  if (burden.state !== "KNOWN") return burden;
  const loaded = multiplyMoney(basePayRate.value, 1 + burden.value.value);
  return { state: "KNOWN", tier: weakestNonUnknownTier([basePayRate.tier, burden.tier]), value: loaded };
}

export function grossProfitPerHour(revenue: EconomicValue<MoneyAmount>, cost: EconomicValue<MoneyAmount>): GrossProfitPerHourResult {
  if (revenue.tier === "UNKNOWN" || cost.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (revenue.value.currency !== cost.value.currency) return { state: "UNAVAILABLE", reason: "Currency mismatch between revenue and cost" };
  const tier = weakestNonUnknownTier([revenue.tier, cost.tier]);
  return { state: "KNOWN", tier, value: { amount: revenue.value.amount - cost.value.amount, currency: revenue.value.currency } };
}

export function grossMarginPercent(revenue: EconomicValue<MoneyAmount>, cost: EconomicValue<MoneyAmount>): GrossMarginPercentResult {
  const profit = grossProfitPerHour(revenue, cost);
  if (profit.state !== "KNOWN") return profit;
  if (revenue.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (revenue.value.amount === 0) return { state: "UNAVAILABLE", reason: "Margin is undefined when revenue is zero" };
  return { state: "KNOWN", tier: profit.tier, value: createSignedRate(profit.value.amount / revenue.value.amount) };
}
