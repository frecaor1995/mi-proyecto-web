import type { DerivedEconomicResult, EconomicValue, MoneyAmount, Rate } from "./economic-value";
import { addMoney, createMoneyAmount, multiplyMoney, weakestNonUnknownTier } from "./economic-value";

/**
 * Phase 4D. Deterministic, pure wage mathematics: regular wage cost and the
 * frozen OT base/premium decomposition (mandate section 12). No burden, no
 * billing, no persistence -- see burden-engine.ts and billing-engine.ts for
 * the layers built on top of this one.
 */

export function regularWageCost(basePayRate: EconomicValue<MoneyAmount>, regularHours: EconomicValue<number>): DerivedEconomicResult<MoneyAmount> {
  if (basePayRate.tier === "UNKNOWN" || regularHours.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (regularHours.value < 0) return { state: "UNAVAILABLE", reason: "Regular hours cannot be negative" };
  return { state: "KNOWN", tier: weakestNonUnknownTier([basePayRate.tier, regularHours.tier]), value: multiplyMoney(basePayRate.value, regularHours.value) };
}

export interface OvertimeWageBreakdown {
  readonly basePortion: MoneyAmount;
  readonly premiumPortion: MoneyAmount;
  readonly total: MoneyAmount;
}

/**
 * OT base portion = basePayRate x OT hours. OT premium portion = basePayRate
 * x (multiplier - 1) x OT hours. Never one opaque "OT wage x loaded burden"
 * figure -- the two portions are kept separate because burden components
 * apply to them independently (see burden-engine.ts).
 *
 * Partial-result behavior (mandate section 8): if overtimeHours is KNOWN to
 * be exactly 0, the result is a known $0 regardless of whether the OT
 * multiplier is known -- 0 hours of overtime costs $0 under any multiplier,
 * so an UNKNOWN multiplier must not block this case. basePayRate is still
 * required even for the zero case, purely to supply a currency for the $0
 * MoneyAmount.
 */
export function overtimeWageCost(
  basePayRate: EconomicValue<MoneyAmount>,
  overtimeMultiplier: EconomicValue<Rate>,
  overtimeHours: EconomicValue<number>,
): DerivedEconomicResult<OvertimeWageBreakdown> {
  if (overtimeHours.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (overtimeHours.value < 0) return { state: "UNAVAILABLE", reason: "Overtime hours cannot be negative" };
  if (basePayRate.tier === "UNKNOWN") return { state: "UNKNOWN" };

  if (overtimeHours.value === 0) {
    const zero = createMoneyAmount(0, basePayRate.value.currency);
    return { state: "KNOWN", tier: weakestNonUnknownTier([basePayRate.tier, overtimeHours.tier]), value: { basePortion: zero, premiumPortion: zero, total: zero } };
  }

  if (overtimeMultiplier.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (overtimeMultiplier.value.value < 1) return { state: "UNAVAILABLE", reason: "An overtime multiplier below 1.0 is not a valid overtime premium" };

  const tier = weakestNonUnknownTier([basePayRate.tier, overtimeMultiplier.tier, overtimeHours.tier]);
  const basePortion = multiplyMoney(basePayRate.value, overtimeHours.value);
  const premiumPortion = multiplyMoney(basePayRate.value, (overtimeMultiplier.value.value - 1) * overtimeHours.value);
  const totalResult = addMoney(basePortion, premiumPortion);
  // basePortion and premiumPortion always share basePayRate's currency by construction; CURRENCY_MISMATCH is unreachable here.
  const total = totalResult.outcome === "OK" ? totalResult.result : basePortion;
  return { state: "KNOWN", tier, value: { basePortion, premiumPortion, total } };
}
