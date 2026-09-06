import type { EconomicValue, MoneyAmount, Rate } from "./economic-value";

/**
 * Phase 4B. Canonical payment-terms/billing-cadence vocabulary for a future
 * commercial-terms contract between Fly Workforce Radar and a client
 * company. Deliberately generic: no invoicing, no AR, no persistence.
 */

export const BILLING_CADENCES = ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const;
export type BillingCadence = (typeof BILLING_CADENCES)[number];

export const PAYROLL_FREQUENCIES = ["WEEKLY", "BIWEEKLY"] as const;
export type PayrollFrequency = (typeof PAYROLL_FREQUENCIES)[number];

/**
 * Arbitrary valid day counts are supported (Net 7, Net 90, ...) -- these are
 * NOT restricted to 15/30/45/60. COMMON_PAYMENT_TERMS below is a convenience
 * set of presets for a future UI, never a restriction on createPaymentTerms.
 */
export interface PaymentTerms {
  readonly days: number;
}
export function createPaymentTerms(days: number): PaymentTerms {
  if (!Number.isInteger(days) || days < 0) throw new Error("Payment terms days must be a non-negative integer");
  if (days > 365) throw new Error("Payment terms beyond 365 days are not supported");
  return { days };
}
export const COMMON_PAYMENT_TERMS = { NET_7: 7, NET_15: 15, NET_30: 30, NET_45: 45, NET_60: 60, NET_90: 90 } as const;

/** A future UI may present either a flat OT bill rate or a multiplier on the regular bill rate -- both are valid canonical representations, never conflated. */
export type OvertimeBillBasis =
  | { readonly kind: "RATE"; readonly rate: MoneyAmount }
  | { readonly kind: "MULTIPLIER"; readonly multiplier: Rate };

/**
 * Canonical client/billing-side commercial terms for an opportunity/company.
 * Every field is independently tier-wrapped -- a contract may have a
 * VERIFIED bill rate alongside an OPERATOR_ASSUMPTION payment-terms guess,
 * and each retains its own provenance strength.
 */
export interface CommercialTermsContract {
  readonly billRate: EconomicValue<MoneyAmount>;
  readonly overtimeBillBasis: EconomicValue<OvertimeBillBasis>;
  readonly reimbursablePerDiem: EconomicValue<MoneyAmount>;
  readonly perDiemMarkup: EconomicValue<Rate>;
  readonly paymentTerms: EconomicValue<PaymentTerms>;
  readonly billingCadence: EconomicValue<BillingCadence>;
}
