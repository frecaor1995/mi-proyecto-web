import type { DerivedEconomicResult, EconomicValue, MoneyAmount, MoneyDelta } from "./economic-value";
import { weakestNonUnknownTier } from "./economic-value";
import {
  generateCashReceiptEvents, generateInvoiceEvents, generatePayrollCashOutEvents,
  type CashReceiptEvent, type InvoiceEvent, type PayrollCashOutEvent,
} from "./cash-flow-events";
import { workHorizonFor } from "./cash-flow-timing";
import type { CommercialTermsContract, PayrollFrequency } from "./commercial-terms";
import type { DeploymentEconomicsInput } from "./commercial-economics";
import type { BillingEvaluation, LaborCostEvaluation } from "./commercial-economics-engine";
import { evaluateWorkingCapital, type WorkingCapitalEvaluation } from "./working-capital-engine";

/**
 * Phase 4E. Auditable weekly cash ledger: aggregates payroll cash-out events
 * and cash-receipt events into per-week totals plus a running cumulative
 * cash position. Event detail is preserved per week, not just aggregates
 * (mandate section 24/43).
 */

export interface WeeklyCashLedgerEntry {
  readonly weekIndex: number;
  readonly outflows: readonly PayrollCashOutEvent[];
  readonly inflows: readonly CashReceiptEvent[];
  readonly totalOutflow: MoneyAmount;
  readonly totalInflow: MoneyAmount;
  /** cashInflows_week - cashOutflows_week. Signed -- a heavy-payroll, light-receipt week is legitimately negative. */
  readonly netCashFlow: MoneyDelta;
  /**
   * Running total starting from an explicit zero baseline (mandate section
   * 25): "how much external/internal funding would this project require on
   * its own?" -- not the company's actual bank balance. Never clamped to
   * zero; a negative value is the economically meaningful signal this
   * engine exists to surface.
   */
  readonly cumulativeCash: MoneyDelta;
}

export interface WeeklyCashLedger {
  readonly entries: readonly WeeklyCashLedgerEntry[];
  readonly currency: string;
}

/**
 * Builds the ledger over [0, maxEventWeek] -- the horizon automatically
 * extends to cover any trailing receipt that lands after the last payroll/
 * invoice week (mandate section 29's collection tail), since maxEventWeek is
 * computed from ALL events, receipts included.
 */
export function buildWeeklyCashLedger(
  payrollEvents: DerivedEconomicResult<readonly PayrollCashOutEvent[]>,
  receiptEvents: DerivedEconomicResult<readonly CashReceiptEvent[]>,
): DerivedEconomicResult<WeeklyCashLedger> {
  if (payrollEvents.state !== "KNOWN") return payrollEvents;
  if (receiptEvents.state !== "KNOWN") return receiptEvents;

  const currencies = new Set([...payrollEvents.value.map((e) => e.amount.currency), ...receiptEvents.value.map((e) => e.amount.currency)]);
  if (currencies.size > 1) {
    return { state: "UNAVAILABLE", reason: `Currency mismatch in combined cash-flow ledger (${[...currencies].join(", ")}) -- Phase 4E performs no FX conversion` };
  }
  if (currencies.size === 0) {
    return { state: "UNAVAILABLE", reason: "No cash-flow events to build a weekly ledger from" };
  }
  const currency = [...currencies][0];
  const tier = weakestNonUnknownTier([payrollEvents.tier, receiptEvents.tier]);

  const maxWeek = Math.max(0, ...payrollEvents.value.map((e) => e.weekIndex), ...receiptEvents.value.map((e) => e.weekIndex));

  let cumulative = 0;
  const entries: WeeklyCashLedgerEntry[] = [];
  for (let week = 0; week <= maxWeek; week++) {
    const outflows = payrollEvents.value.filter((e) => e.weekIndex === week);
    const inflows = receiptEvents.value.filter((e) => e.weekIndex === week);
    const totalOutflowAmount = outflows.reduce((sum, e) => sum + e.amount.amount, 0);
    const totalInflowAmount = inflows.reduce((sum, e) => sum + e.amount.amount, 0);
    const net = totalInflowAmount - totalOutflowAmount;
    cumulative += net;
    entries.push({
      weekIndex: week,
      outflows,
      inflows,
      totalOutflow: { amount: totalOutflowAmount, currency },
      totalInflow: { amount: totalInflowAmount, currency },
      netCashFlow: { amount: net, currency },
      cumulativeCash: { amount: cumulative, currency },
    });
  }

  return { state: "KNOWN", tier, value: { entries, currency } };
}

/**
 * Timing assumptions Phase 4E requires at its own calculation boundary,
 * without mutating any certified persistence/contract (mandate section 16,
 * option B). None of these exist in the certified 4B/4C/4D architecture:
 * payroll frequency is an employer-internal operating parameter that
 * LaborEconomicsInput does not carry, and no payroll/billing anchor exists
 * anywhere certified. An UNKNOWN value for any of these blocks only the
 * results that structurally require it (partial-result principle).
 */
export interface CashFlowAssumptions {
  readonly payrollFrequency: EconomicValue<PayrollFrequency>;
  readonly payrollAnchorWeek: EconomicValue<number>;
  readonly billingAnchorWeek: EconomicValue<number>;
}

export interface CashFlowSideEvaluation {
  readonly payrollEvents: DerivedEconomicResult<readonly PayrollCashOutEvent[]>;
  readonly invoiceEvents: DerivedEconomicResult<readonly InvoiceEvent[]>;
  readonly receiptEvents: DerivedEconomicResult<readonly CashReceiptEvent[]>;
  readonly ledger: DerivedEconomicResult<WeeklyCashLedger>;
  readonly workingCapital: DerivedEconomicResult<WorkingCapitalEvaluation>;
}

export interface CashFlowEvaluation {
  /**
   * Built from 4D's COMPLETE workforce-per-week cost/billing figures.
   * Blocked (UNKNOWN/UNAVAILABLE) whenever 4D's complete economics are
   * blocked -- including the certified 4D per-diem invariant (mandate
   * sections 10/11/AB): a material, unresolved per-diem in 4D propagates
   * all the way through to a blocked complete cash-flow/working-capital
   * result here, never silently dropped.
   */
  readonly complete: CashFlowSideEvaluation;
  /**
   * Built from 4D's LABOR-ONLY workforce-per-week cost/billing figures
   * (excluding per-diem entirely). Explicitly labeled -- never a substitute
   * for `complete` above, and never to be presented as complete project
   * cash flow (mandate section 10/42).
   */
  readonly laborOnly: CashFlowSideEvaluation;
}

function evaluateCashFlowSide(
  weeklyLaborCost: DerivedEconomicResult<MoneyAmount>,
  weeklyBilling: DerivedEconomicResult<MoneyAmount>,
  commercialTerms: CommercialTermsContract,
  assumptions: CashFlowAssumptions,
  horizon: ReturnType<typeof workHorizonFor>,
): CashFlowSideEvaluation {
  const payrollEvents = generatePayrollCashOutEvents(
    weeklyLaborCost,
    { payrollFrequency: assumptions.payrollFrequency, anchorWeek: assumptions.payrollAnchorWeek },
    horizon,
  );
  const invoiceEvents = generateInvoiceEvents(
    weeklyBilling,
    commercialTerms.billingCadence,
    { anchorWeek: assumptions.billingAnchorWeek },
    horizon,
  );
  const receiptEvents = generateCashReceiptEvents(invoiceEvents, commercialTerms.paymentTerms);
  const ledger = buildWeeklyCashLedger(payrollEvents, receiptEvents);
  const workingCapital = evaluateWorkingCapital(ledger);
  return { payrollEvents, invoiceEvents, receiptEvents, ledger, workingCapital };
}

/**
 * Top-level Phase 4E orchestrator: certified 4D economics -> deployment
 * timeline -> payroll/billing events -> cash receipts -> weekly ledger ->
 * working capital. Pure, deterministic, side-effect free, no persistence.
 *
 * FIXED deployment duration is required for any finite event/ledger/working-
 * capital result; OPEN_ENDED and UNKNOWN duration correctly yield UNKNOWN
 * for those fields without fabricating a project length (mandate sections
 * 12/35) -- the steady per-week cost/billing rate remains available
 * independently via `labor`/`billing` (the certified 4D inputs), which this
 * function does not duplicate or hide.
 */
export function evaluateCashFlow(
  labor: LaborCostEvaluation,
  billing: BillingEvaluation,
  deployment: DeploymentEconomicsInput,
  commercialTerms: CommercialTermsContract,
  assumptions: CashFlowAssumptions,
): CashFlowEvaluation {
  const horizon = workHorizonFor(deployment.duration);
  const complete = evaluateCashFlowSide(labor.completeTotalWorkforcePerWeek, billing.completeTotalWorkforcePerWeek, commercialTerms, assumptions, horizon);
  const laborOnly = evaluateCashFlowSide(labor.laborOnlyTotalWorkforcePerWeek, billing.laborOnlyTotalWorkforcePerWeek, commercialTerms, assumptions, horizon);
  return { complete, laborOnly };
}
