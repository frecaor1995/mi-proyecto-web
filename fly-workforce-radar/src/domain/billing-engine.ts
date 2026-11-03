import type { OvertimeBillBasis } from "./commercial-terms";
import type { DerivedEconomicResult, EconomicValue, MoneyAmount, Rate } from "./economic-value";
import { addMoney, createMoneyAmount, multiplyMoney, weakestNonUnknownTier } from "./economic-value";

/**
 * Phase 4D. Deterministic client billing mathematics from the certified 4B
 * CommercialTermsContract. Worker pay/OT terms and client billing terms are
 * separate economic dimensions (mandate section 20) -- this module never
 * reads LaborEconomicsInput.
 */

export function regularClientBilling(billRate: EconomicValue<MoneyAmount>, regularHours: EconomicValue<number>): DerivedEconomicResult<MoneyAmount> {
  if (billRate.tier === "UNKNOWN" || regularHours.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (regularHours.value < 0) return { state: "UNAVAILABLE", reason: "Regular hours cannot be negative" };
  return { state: "KNOWN", tier: weakestNonUnknownTier([billRate.tier, regularHours.tier]), value: multiplyMoney(billRate.value, regularHours.value) };
}

/**
 * Uses the certified OvertimeBillBasis (RATE or MULTIPLIER) -- never assumes
 * client OT billing equals the worker OT multiplier (mandate section 20).
 * billRate is required even for a RATE-kind basis, purely as the currency
 * reference for the zero-hours partial result (mirrors wage-engine.ts's
 * overtimeWageCost exactly).
 */
export function clientOvertimeBilling(
  billRate: EconomicValue<MoneyAmount>,
  overtimeBillBasis: EconomicValue<OvertimeBillBasis>,
  overtimeHours: EconomicValue<number>,
): DerivedEconomicResult<MoneyAmount> {
  if (overtimeHours.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (overtimeHours.value < 0) return { state: "UNAVAILABLE", reason: "Overtime hours cannot be negative" };
  if (billRate.tier === "UNKNOWN") return { state: "UNKNOWN" };

  if (overtimeHours.value === 0) {
    return { state: "KNOWN", tier: weakestNonUnknownTier([billRate.tier, overtimeHours.tier]), value: createMoneyAmount(0, billRate.value.currency) };
  }

  if (overtimeBillBasis.tier === "UNKNOWN") return { state: "UNKNOWN" };
  const basis = overtimeBillBasis.value;
  if (basis.kind === "RATE") {
    return { state: "KNOWN", tier: weakestNonUnknownTier([overtimeBillBasis.tier, overtimeHours.tier]), value: multiplyMoney(basis.rate, overtimeHours.value) };
  }
  return { state: "KNOWN", tier: weakestNonUnknownTier([overtimeBillBasis.tier, billRate.tier, overtimeHours.tier]), value: multiplyMoney(billRate.value, basis.multiplier.value * overtimeHours.value) };
}

/**
 * Reimbursement alone depends only on reimbursablePerDiem -- an UNKNOWN
 * markup must not block it (mandate section 21/8).
 */
export function clientPerDiemReimbursement(reimbursablePerDiem: EconomicValue<MoneyAmount>): DerivedEconomicResult<MoneyAmount> {
  if (reimbursablePerDiem.tier === "UNKNOWN") return { state: "UNKNOWN" };
  return { state: "KNOWN", tier: reimbursablePerDiem.tier, value: reimbursablePerDiem.value };
}

export function clientPerDiemMarkupAmount(reimbursablePerDiem: EconomicValue<MoneyAmount>, perDiemMarkup: EconomicValue<Rate>): DerivedEconomicResult<MoneyAmount> {
  if (reimbursablePerDiem.tier === "UNKNOWN" || perDiemMarkup.tier === "UNKNOWN") return { state: "UNKNOWN" };
  return { state: "KNOWN", tier: weakestNonUnknownTier([reimbursablePerDiem.tier, perDiemMarkup.tier]), value: multiplyMoney(reimbursablePerDiem.value, perDiemMarkup.value.value) };
}

export interface PerDiemBillingBreakdown {
  readonly reimbursement: DerivedEconomicResult<MoneyAmount>;
  readonly markup: DerivedEconomicResult<MoneyAmount>;
  /** Requires BOTH reimbursement and markup to be known -- reimbursement alone remains available above even when this is UNKNOWN. */
  readonly total: DerivedEconomicResult<MoneyAmount>;
}

export function clientPerDiemBilling(reimbursablePerDiem: EconomicValue<MoneyAmount>, perDiemMarkup: EconomicValue<Rate>): PerDiemBillingBreakdown {
  const reimbursement = clientPerDiemReimbursement(reimbursablePerDiem);
  const markup = clientPerDiemMarkupAmount(reimbursablePerDiem, perDiemMarkup);
  if (reimbursement.state !== "KNOWN") return { reimbursement, markup, total: reimbursement };
  if (markup.state !== "KNOWN") return { reimbursement, markup, total: markup };
  const combined = addMoney(reimbursement.value, markup.value);
  const total: DerivedEconomicResult<MoneyAmount> = combined.outcome === "CURRENCY_MISMATCH"
    ? { state: "UNAVAILABLE", reason: "Currency mismatch between per-diem reimbursement and markup" }
    : { state: "KNOWN", tier: weakestNonUnknownTier([reimbursement.tier, markup.tier]), value: combined.result };
  return { reimbursement, markup, total };
}
