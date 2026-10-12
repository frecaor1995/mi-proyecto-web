import type { BillingCadence, PayrollFrequency } from "./commercial-terms";
import type { DeploymentDuration } from "./commercial-economics";

/**
 * Phase 4E. Pure timing/discretization helpers mapping certified cadence /
 * duration / payment-terms vocabulary onto the frozen weekly simulation
 * grid (mandate section 6). No calendar policy -- payroll/invoice weekday,
 * ACH delay, bank processing delay, weekends, holidays, approval delay,
 * retainage, mobilization delay, or collection probability -- is introduced
 * anywhere in this module (mandate section 7).
 */

const PAYROLL_CADENCE_INTERVAL_WEEKS: Readonly<Record<PayrollFrequency, number>> = { WEEKLY: 1, BIWEEKLY: 2 };

/** Payroll cadence interval in weeks. Certified PayrollFrequency values (WEEKLY, BIWEEKLY) map exactly onto the weekly grid -- BIWEEKLY is every two weeks, never "twice a month" (mandate section 15). */
export function payrollCadenceIntervalWeeks(frequency: PayrollFrequency): number {
  return PAYROLL_CADENCE_INTERVAL_WEEKS[frequency];
}

/**
 * WEEKLY and BIWEEKLY billing cadences map onto the weekly grid exactly (1
 * and 2 week intervals). MONTHLY has no certified calendar/anchor policy for
 * weekly-grid placement -- mandate sections 18/36 explicitly forbid
 * inventing a universal "4 weeks" or "4.33 weeks" rule, so this returns
 * `null` for MONTHLY, signaling "cannot be represented on the weekly grid
 * without fabricating a policy," not "zero interval."
 */
const BILLING_CADENCE_INTERVAL_WEEKS: Readonly<Record<BillingCadence, number | null>> = { WEEKLY: 1, BIWEEKLY: 2, MONTHLY: null };

export function billingCadenceIntervalWeeks(cadence: BillingCadence): number | null {
  return BILLING_CADENCE_INTERVAL_WEEKS[cadence];
}

/**
 * The one explicit, isolated, named, conservative weekly-bucket placement
 * policy for payment terms (mandate section 20):
 *   receiptWeekOffset = ceil(paymentTermsDays / 7)
 * 0 -> 0, 1 -> 1, 7 -> 1, 8 -> 2, 30 -> 5, 45 -> 7. This is a simulation
 * discretization rule for placing a modeled receipt into a weekly bucket,
 * NOT a claim about which weekday a client actually pays.
 */
export function paymentTermsWeeklyOffset(paymentTermsDays: number): number {
  if (!Number.isFinite(paymentTermsDays) || paymentTermsDays < 0) throw new Error("Payment terms days must be a non-negative finite number");
  return Math.ceil(paymentTermsDays / 7);
}

/**
 * The deployment's work horizon in whole weeks. Mirrors the existing 4D
 * convention (commercial-economics-engine.ts's scaleMoneyResultByFixedWeeks)
 * that only FIXED duration ever yields a finite week count. OPEN_ENDED and
 * UNKNOWN are structurally distinct from each other and from FIXED -- as in
 * the certified DeploymentDuration type itself, this is not an economic-
 * fact-tier value, so neither is ever converted into an invented finite
 * number of weeks.
 */
export type WorkHorizon =
  | { readonly kind: "FIXED"; readonly weeks: number }
  | { readonly kind: "OPEN_ENDED" }
  | { readonly kind: "UNKNOWN" };

export function workHorizonFor(duration: DeploymentDuration): WorkHorizon {
  if (duration.kind === "FIXED") return { kind: "FIXED", weeks: duration.weeks };
  return { kind: duration.kind };
}
