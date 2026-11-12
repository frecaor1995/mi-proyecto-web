import type { BillingCadence, PayrollFrequency, PaymentTerms } from "./commercial-terms";
import type { DerivedEconomicResult, EconomicFactTier, EconomicValue, MoneyAmount } from "./economic-value";
import { multiplyMoney, weakestNonUnknownTier } from "./economic-value";
import { billingCadenceIntervalWeeks, payrollCadenceIntervalWeeks, paymentTermsWeeklyOffset, type WorkHorizon } from "./cash-flow-timing";

/**
 * Phase 4E. Auditable cash-flow event generation. The certified 4B
 * CashOutflowEvent/CashInflowEvent (commercial-economics.ts) are documented
 * there as vocabulary only ("no simulation function is implemented in 4B").
 * The richer, tier-and-basis-carrying event types below are the actual
 * simulation implementation those placeholders anticipated -- they are not
 * a redefinition of any certified contract.
 *
 * Cadence tiling model (corrected per the Phase 4E pre-commit reconciliation
 * mandate): cadence determines event TIMING/GROUPING only, never economic
 * value. Period k's COVERAGE is [k*interval, min((k+1)*interval,
 * horizonWeeks)-1] -- boundaries anchored to the start of the work horizon
 * (week 0), entirely independent of anchorWeek. This guarantees every
 * period's periodsCovered values sum to exactly horizonWeeks, so
 * SUM(event amounts) == weeklyAmount * horizonWeeks always, for any anchor
 * and any horizon/interval combination (including a horizon not evenly
 * divisible by the interval, which yields a genuine partial final period
 * rather than a fabricated full one). No worked week can ever be dropped
 * merely because the anchor is nonzero, since coverage never depends on it.
 *
 * anchorWeek means: the event (payment/invoicing) week for period 0. Period
 * k's event lands at week `anchorWeek + k*interval` -- the anchor shifts
 * WHEN each period's cash event is placed on the simulation grid, never
 * WHAT work-horizon weeks that period economically covers.
 */

type Tier = Exclude<EconomicFactTier, "UNKNOWN">;

export interface PayrollCashOutEvent {
  readonly weekIndex: number;
  readonly amount: MoneyAmount;
  readonly tier: Tier;
  readonly periodsCovered: number;
  readonly cadenceIntervalWeeks: number;
  readonly basis: string;
}

export interface InvoiceEvent {
  readonly weekIndex: number;
  readonly amount: MoneyAmount;
  readonly tier: Tier;
  readonly periodsCovered: number;
  readonly cadenceIntervalWeeks: number;
  readonly basis: string;
}

/** An expected/modeled cash-in event derived from an invoice + payment terms -- never an observed bank transaction (mandate section 22). */
export interface CashReceiptEvent {
  readonly weekIndex: number;
  readonly amount: MoneyAmount;
  readonly tier: Tier;
  readonly sourceInvoiceWeekIndex: number;
  readonly paymentTermsOffsetWeeks: number;
  readonly basis: string;
}

interface CadenceEvent {
  readonly weekIndex: number;
  readonly amount: MoneyAmount;
  readonly periodsCovered: number;
  readonly basis: string;
}

function generateCadenceEvents(
  weeklyAmount: MoneyAmount,
  anchorWeek: number,
  intervalWeeks: number,
  horizonWeeks: number,
  basisLabel: (periodsCovered: number, weekIndex: number) => string,
): readonly CadenceEvent[] {
  const events: CadenceEvent[] = [];
  const numPeriods = Math.ceil(horizonWeeks / intervalWeeks);
  for (let periodIndex = 0; periodIndex < numPeriods; periodIndex++) {
    const coverageStart = periodIndex * intervalWeeks;
    const coverageEnd = Math.min((periodIndex + 1) * intervalWeeks, horizonWeeks) - 1;
    const periodsCovered = coverageEnd - coverageStart + 1;
    const weekIndex = anchorWeek + periodIndex * intervalWeeks;
    events.push({ weekIndex, amount: multiplyMoney(weeklyAmount, periodsCovered), periodsCovered, basis: basisLabel(periodsCovered, weekIndex) });
  }
  return events;
}

export interface PayrollAssumptions {
  readonly payrollFrequency: EconomicValue<PayrollFrequency>;
  /** Week index (0-based, within the work horizon) of the first payroll cash-out event. Section 16: never silently assumed to be week 1/0 when unavailable -- an UNKNOWN anchor makes absolute placement UNKNOWN. */
  readonly anchorWeek: EconomicValue<number>;
}

/**
 * Generates deterministic weekly payroll cash-out events from the certified
 * 4D weekly workforce labor cost. `weeklyLaborCost` should be either the
 * complete or labor-only workforce-per-week figure from 4D's
 * LaborCostEvaluation -- this function does not know or care which; the
 * distinction is made by the caller's choice of which 4D field to pass in.
 */
export function generatePayrollCashOutEvents(
  weeklyLaborCost: DerivedEconomicResult<MoneyAmount>,
  assumptions: PayrollAssumptions,
  horizon: WorkHorizon,
): DerivedEconomicResult<readonly PayrollCashOutEvent[]> {
  if (weeklyLaborCost.state !== "KNOWN") return weeklyLaborCost;
  if (assumptions.payrollFrequency.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (assumptions.anchorWeek.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (horizon.kind !== "FIXED") return { state: "UNKNOWN" };
  if (!Number.isInteger(assumptions.anchorWeek.value) || assumptions.anchorWeek.value < 0) {
    return { state: "UNAVAILABLE", reason: "Payroll anchor week must be a non-negative integer week index" };
  }

  const payrollFrequency = assumptions.payrollFrequency.value;
  const anchorWeek = assumptions.anchorWeek.value;
  const interval = payrollCadenceIntervalWeeks(payrollFrequency);
  const tier = weakestNonUnknownTier([weeklyLaborCost.tier, assumptions.payrollFrequency.tier, assumptions.anchorWeek.tier]);
  const raw = generateCadenceEvents(
    weeklyLaborCost.value, anchorWeek, interval, horizon.weeks,
    (periods, week) => `Payroll cash-out at simulation week ${week}: ${periods} week(s) of labor cost at the ${payrollFrequency} cadence, anchored at week ${anchorWeek}`,
  );
  const events: PayrollCashOutEvent[] = raw.map((event) => ({ ...event, tier, cadenceIntervalWeeks: interval }));
  return { state: "KNOWN", tier, value: events };
}

export interface BillingAssumptions {
  /** Week index (0-based, within the work horizon) of the first invoice event. Never silently assumed (mandate section 16, applied symmetrically to billing). */
  readonly anchorWeek: EconomicValue<number>;
}

/**
 * Generates deterministic invoice events from the certified 4D weekly
 * workforce billing figure. Returns UNAVAILABLE for MONTHLY billing cadence
 * (no certified weekly-grid mapping exists) without disturbing any
 * independently-computed result, per mandate section 36.
 */
export function generateInvoiceEvents(
  weeklyBilling: DerivedEconomicResult<MoneyAmount>,
  billingCadence: EconomicValue<BillingCadence>,
  assumptions: BillingAssumptions,
  horizon: WorkHorizon,
): DerivedEconomicResult<readonly InvoiceEvent[]> {
  if (weeklyBilling.state !== "KNOWN") return weeklyBilling;
  if (billingCadence.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (assumptions.anchorWeek.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (horizon.kind !== "FIXED") return { state: "UNKNOWN" };
  if (!Number.isInteger(assumptions.anchorWeek.value) || assumptions.anchorWeek.value < 0) {
    return { state: "UNAVAILABLE", reason: "Billing anchor week must be a non-negative integer week index" };
  }

  const interval = billingCadenceIntervalWeeks(billingCadence.value);
  if (interval === null) {
    return {
      state: "UNAVAILABLE",
      reason: `${billingCadence.value} billing cadence has no certified calendar/anchor policy for weekly-grid placement -- inventing a fixed week-count mapping (e.g. 4 or 4.33 weeks) is not authorized; the underlying weekly billing amount remains known independently of this event schedule`,
    };
  }

  const anchorWeek = assumptions.anchorWeek.value;
  const cadenceValue = billingCadence.value;
  const tier = weakestNonUnknownTier([weeklyBilling.tier, billingCadence.tier, assumptions.anchorWeek.tier]);
  const raw = generateCadenceEvents(
    weeklyBilling.value, anchorWeek, interval, horizon.weeks,
    (periods, week) => `Invoice issued at simulation week ${week}: ${periods} week(s) of client billing at the ${cadenceValue} cadence, anchored at week ${anchorWeek}`,
  );
  const events: InvoiceEvent[] = raw.map((event) => ({ ...event, tier, cadenceIntervalWeeks: interval }));
  return { state: "KNOWN", tier, value: events };
}

/**
 * Derives modeled cash-receipt events from invoice events + payment terms.
 * The receipt amount is always exactly the source invoice amount (mandate
 * section 21: no bad debt/partial collection/discounting/retainage/finance
 * charges in 4E) at a week offset from the conservative ceil(days/7)
 * discretization. An UNKNOWN payment term blocks receipt timing while
 * leaving the underlying invoice event fully inspectable (partial-result
 * principle, mandate section 34).
 */
export function generateCashReceiptEvents(
  invoiceEvents: DerivedEconomicResult<readonly InvoiceEvent[]>,
  paymentTerms: EconomicValue<PaymentTerms>,
): DerivedEconomicResult<readonly CashReceiptEvent[]> {
  if (invoiceEvents.state !== "KNOWN") return invoiceEvents;
  if (paymentTerms.tier === "UNKNOWN") return { state: "UNKNOWN" };

  const offsetWeeks = paymentTermsWeeklyOffset(paymentTerms.value.days);
  const tier = weakestNonUnknownTier([invoiceEvents.tier, paymentTerms.tier]);
  const events: CashReceiptEvent[] = invoiceEvents.value.map((invoice) => ({
    weekIndex: invoice.weekIndex + offsetWeeks,
    amount: invoice.amount,
    tier,
    sourceInvoiceWeekIndex: invoice.weekIndex,
    paymentTermsOffsetWeeks: offsetWeeks,
    basis: `Modeled (expected, not observed) cash receipt for the invoice issued at week ${invoice.weekIndex}, using a ${paymentTerms.value.days}-day payment term discretized conservatively to +${offsetWeeks} week(s) via ceil(days/7)`,
  }));
  return { state: "KNOWN", tier, value: events };
}
