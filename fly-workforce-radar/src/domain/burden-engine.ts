import type { BurdenComponent, BurdenComponentType, BurdenWagePortion } from "./burden-profile";
import type { DerivedEconomicResult, MoneyAmount } from "./economic-value";
import { addMoney, createMoneyAmount, multiplyMoney, weakestNonUnknownTier } from "./economic-value";

/**
 * Phase 4D. Burden AMOUNTS (not just rates) applied to real wage amounts,
 * decomposed per component for full explainability. There is no universal
 * "wage x (1 + total burden)" formula -- mandate section 13/14/15: burden
 * applicability comes entirely from each BurdenComponent's own `appliesTo`,
 * never invented here.
 */

/**
 * The three wage amounts a burden component's applicability can reference --
 * produced by wage-engine.ts. DerivedEconomicResult (not EconomicValue),
 * because these are themselves derived values that can be UNAVAILABLE with a
 * specific reason (e.g. a currency mismatch upstream), not merely UNKNOWN --
 * that reason must survive into any burden result blocked by it.
 */
export interface WageBasis {
  readonly regularWages: DerivedEconomicResult<MoneyAmount>;
  readonly overtimeBaseWages: DerivedEconomicResult<MoneyAmount>;
  readonly overtimePremiumWages: DerivedEconomicResult<MoneyAmount>;
}

function wageForPortion(basis: WageBasis, portion: BurdenWagePortion): DerivedEconomicResult<MoneyAmount> {
  if (portion === "REGULAR_WAGES") return basis.regularWages;
  if (portion === "OVERTIME_BASE_PORTION") return basis.overtimeBaseWages;
  return basis.overtimePremiumWages;
}

function sumKnownMoney(amounts: readonly MoneyAmount[]): DerivedEconomicResult<MoneyAmount> {
  if (amounts.length === 0) return { state: "UNAVAILABLE", reason: "No wage amounts to sum" };
  let total = amounts[0];
  for (let i = 1; i < amounts.length; i++) {
    const combined = addMoney(total, amounts[i]);
    if (combined.outcome === "CURRENCY_MISMATCH") return { state: "UNAVAILABLE", reason: "Currency mismatch across wage portions" };
    total = combined.result;
  }
  return { state: "KNOWN", tier: "VERIFIED", value: total }; // tier is overwritten by the caller once combined with input tiers
}

export interface BurdenComponentContribution {
  readonly type: BurdenComponentType;
  readonly amount: DerivedEconomicResult<MoneyAmount>;
}

/** component burden = sum(applicable wage portions) x component rate (mandate section 14). */
export function burdenComponentContribution(component: BurdenComponent, basis: WageBasis): DerivedEconomicResult<MoneyAmount> {
  const applicableWages = component.appliesTo.map((portion) => wageForPortion(basis, portion));
  if (applicableWages.length === 0) return { state: "UNAVAILABLE", reason: "Burden component has no applicable wage portions" };
  const firstBlocking = applicableWages.find((wage) => wage.state !== "KNOWN");
  if (firstBlocking) return firstBlocking;
  if (component.rate.tier === "UNKNOWN") return { state: "UNKNOWN" };

  const knownWages = applicableWages as ReadonlyArray<Extract<DerivedEconomicResult<MoneyAmount>, { state: "KNOWN" }>>;
  const summed = sumKnownMoney(knownWages.map((wage) => wage.value));
  if (summed.state !== "KNOWN") return summed;

  const tier = weakestNonUnknownTier([...knownWages.map((wage) => wage.tier), component.rate.tier]);
  return { state: "KNOWN", tier, value: multiplyMoney(summed.value, component.rate.value.value) };
}

export interface BurdenBreakdown {
  readonly components: readonly BurdenComponentContribution[];
  readonly totalBurden: DerivedEconomicResult<MoneyAmount>;
}

function referenceCurrency(basis: WageBasis): string | null {
  for (const wage of [basis.regularWages, basis.overtimeBaseWages, basis.overtimePremiumWages]) if (wage.state === "KNOWN") return wage.value.currency;
  return null;
}

/** Full explainable burden breakdown: one contribution per component plus the aggregate total -- never only one opaque number (mandate section 17). */
export function burdenBreakdown(components: readonly BurdenComponent[], basis: WageBasis): BurdenBreakdown {
  const contributions = components.map((component): BurdenComponentContribution => ({ type: component.type, amount: burdenComponentContribution(component, basis) }));

  if (contributions.length === 0) {
    const currency = referenceCurrency(basis);
    return { components: [], totalBurden: currency ? { state: "KNOWN", tier: "VERIFIED", value: createMoneyAmount(0, currency) } : { state: "UNKNOWN" } };
  }

  const firstBlocking = contributions.find((c) => c.amount.state !== "KNOWN");
  if (firstBlocking) return { components: contributions, totalBurden: firstBlocking.amount };

  const known = contributions.map((c) => c.amount).filter((a): a is Extract<DerivedEconomicResult<MoneyAmount>, { state: "KNOWN" }> => a.state === "KNOWN");
  const summed = sumKnownMoney(known.map((a) => a.value));
  if (summed.state !== "KNOWN") return { components: contributions, totalBurden: summed };
  const tier = weakestNonUnknownTier(known.map((a) => a.tier));
  return { components: contributions, totalBurden: { state: "KNOWN", tier, value: summed.value } };
}
