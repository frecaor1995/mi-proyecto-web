import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EconomicFactTier } from "../../domain/economic-value";
import { assumedValue, createMoneyAmount, unknownValue, unverifiedSourcedValue, verifiedValue } from "../../domain/economic-value";
import { createPaymentTerms, createRate } from "../../domain/commercial-economics";
import type { CommercialTermsContract } from "../../domain/commercial-terms";
import type { DeploymentEconomicsInput, LaborEconomicsInput } from "../../domain/commercial-economics";
import { evaluateClientBilling, evaluateLaborCost } from "../../domain/commercial-economics-engine";
import { billingCadenceIntervalWeeks, payrollCadenceIntervalWeeks, paymentTermsWeeklyOffset, workHorizonFor } from "../../domain/cash-flow-timing";
import {
  generateCashReceiptEvents, generateInvoiceEvents, generatePayrollCashOutEvents,
  type CashReceiptEvent, type InvoiceEvent, type PayrollCashOutEvent,
} from "../../domain/cash-flow-events";
import { buildWeeklyCashLedger, evaluateCashFlow, type CashFlowAssumptions } from "../../domain/cash-flow-engine";
import { evaluateWorkingCapital } from "../../domain/working-capital-engine";
import type { DerivedEconomicResult } from "../../domain/economic-value";

const usd = (amount: number) => createMoneyAmount(amount, "USD");
function known<T>(value: T, tier: Exclude<EconomicFactTier, "UNKNOWN"> = "VERIFIED"): DerivedEconomicResult<T> {
  return { state: "KNOWN", tier, value };
}
function payrollEvt(weekIndex: number, amount: number, tier: Exclude<EconomicFactTier, "UNKNOWN"> = "VERIFIED"): PayrollCashOutEvent {
  return { weekIndex, amount: usd(amount), tier, periodsCovered: 1, cadenceIntervalWeeks: 1, basis: "test fixture" };
}
function receiptEvt(weekIndex: number, amount: number, sourceWeek: number, tier: Exclude<EconomicFactTier, "UNKNOWN"> = "VERIFIED"): CashReceiptEvent {
  return { weekIndex, amount: usd(amount), tier, sourceInvoiceWeekIndex: sourceWeek, paymentTermsOffsetWeeks: weekIndex - sourceWeek, basis: "test fixture" };
}

describe("4E cash-flow timing", () => {
  it("payroll cadence interval weeks -- WEEKLY=1, BIWEEKLY=2, never confused with each other", () => {
    expect(payrollCadenceIntervalWeeks("WEEKLY")).toBe(1);
    expect(payrollCadenceIntervalWeeks("BIWEEKLY")).toBe(2);
  });

  it("billing cadence interval weeks -- WEEKLY=1, BIWEEKLY=2, MONTHLY=null (no invented weekly mapping)", () => {
    expect(billingCadenceIntervalWeeks("WEEKLY")).toBe(1);
    expect(billingCadenceIntervalWeeks("BIWEEKLY")).toBe(2);
    expect(billingCadenceIntervalWeeks("MONTHLY")).toBeNull();
  });

  it("9-15. payment-terms weekly discretization: ceil(days/7), including arbitrary valid day counts", () => {
    expect(paymentTermsWeeklyOffset(0)).toBe(0);
    expect(paymentTermsWeeklyOffset(1)).toBe(1);
    expect(paymentTermsWeeklyOffset(7)).toBe(1);
    expect(paymentTermsWeeklyOffset(8)).toBe(2);
    expect(paymentTermsWeeklyOffset(30)).toBe(5);
    expect(paymentTermsWeeklyOffset(45)).toBe(7);
    expect(paymentTermsWeeklyOffset(90)).toBe(13); // arbitrary valid term, not restricted to Net 15/30/45/60
  });

  it("46. FIXED duration produces a finite work horizon", () => {
    expect(workHorizonFor({ kind: "FIXED", weeks: 10 })).toEqual({ kind: "FIXED", weeks: 10 });
  });

  it("48. OPEN_ENDED duration is never converted into an invented finite project duration", () => {
    expect(workHorizonFor({ kind: "OPEN_ENDED" })).toEqual({ kind: "OPEN_ENDED" });
  });

  it("49. UNKNOWN duration is never converted into zero weeks", () => {
    expect(workHorizonFor({ kind: "UNKNOWN" })).toEqual({ kind: "UNKNOWN" });
  });
});

describe("4E payroll cash-out event generation", () => {
  it("1. weekly payroll cadence generates one cash-out event per work week", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("WEEKLY"), anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 4 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value.map((e) => e.weekIndex)).toEqual([0, 1, 2, 3]);
      expect(result.value.every((e) => e.amount.amount === 1000)).toBe(true);
    }
  });

  it("2/3. biweekly payroll cadence is every two weeks, not confused with the weekly simulation granularity", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("BIWEEKLY"), anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 6 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value.map((e) => e.weekIndex)).toEqual([0, 2, 4]); // simulation grid stays weekly; payroll only fires every 2nd week
      expect(result.value[0].amount.amount).toBe(2000); // one event covers 2 weeks of labor cost
      expect(result.value[0].periodsCovered).toBe(2);
    }
  });

  it("4/30. a missing/UNKNOWN payroll anchor never becomes week 1 or any other invented week -- the whole event schedule is UNKNOWN", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("WEEKLY"), anchorWeek: unknownValue() }, { kind: "FIXED", weeks: 4 });
    expect(result).toEqual({ state: "UNKNOWN" });
  });

  it("UNKNOWN payroll frequency blocks the schedule without fabricating a cadence", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: unknownValue(), anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 4 });
    expect(result).toEqual({ state: "UNKNOWN" });
  });

  it("37/40. weakest-tier propagation for a payroll cash-out event: an OPERATOR_ASSUMPTION input prevents a VERIFIED result", () => {
    const withAssumedFrequency = generatePayrollCashOutEvents(known(usd(1000), "VERIFIED"), { payrollFrequency: assumedValue("WEEKLY"), anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 2 });
    expect(withAssumedFrequency.state).toBe("KNOWN");
    if (withAssumedFrequency.state === "KNOWN") expect(withAssumedFrequency.tier).toBe("OPERATOR_ASSUMPTION");

    const withAssumedAnchor = generatePayrollCashOutEvents(known(usd(1000), "VERIFIED"), { payrollFrequency: verifiedValue("WEEKLY"), anchorWeek: assumedValue(0) }, { kind: "FIXED", weeks: 2 });
    expect(withAssumedAnchor.state).toBe("KNOWN");
    if (withAssumedAnchor.state === "KNOWN") expect(withAssumedAnchor.tier).toBe("OPERATOR_ASSUMPTION");
  });
});

describe("4E billing/invoice event generation", () => {
  it("5. weekly billing cadence", () => {
    const result = generateInvoiceEvents(known(usd(3400)), verifiedValue("WEEKLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 3 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") expect(result.value.map((e) => e.weekIndex)).toEqual([0, 1, 2]);
  });

  it("6/7. biweekly billing cadence is every two weeks, never twice-monthly", () => {
    const result = generateInvoiceEvents(known(usd(3400)), verifiedValue("BIWEEKLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 8 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value.map((e) => e.weekIndex)).toEqual([0, 2, 4, 6]); // every 2 weeks: 4 invoices in 8 weeks
      expect(result.value[0].amount.amount).toBe(6800);
    }
  });

  it("8/36 (AA). monthly billing does not silently become every 4 (or 4.33) weeks -- absolute placement is UNAVAILABLE while the underlying weekly amount stays independently known", () => {
    const weeklyBilling = known(usd(3400));
    const result = generateInvoiceEvents(weeklyBilling, verifiedValue("MONTHLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 12 });
    expect(result.state).toBe("UNAVAILABLE");
    if (result.state === "UNAVAILABLE") expect(result.reason).toMatch(/monthly/i);
    // the underlying weekly amount was never consumed or altered by the failed placement
    expect(weeklyBilling).toEqual({ state: "KNOWN", tier: "VERIFIED", value: usd(3400) });
  });

  it("a missing/UNKNOWN billing anchor never becomes week 1 or any other invented week", () => {
    const result = generateInvoiceEvents(known(usd(3400)), verifiedValue("WEEKLY"), { anchorWeek: unknownValue() }, { kind: "FIXED", weeks: 4 });
    expect(result).toEqual({ state: "UNKNOWN" });
  });
});

describe("4E cash receipt event generation", () => {
  it("16/17. an invoice event remains distinct from its receipt event; receipt amount derives exactly from invoice amount", () => {
    const invoices: DerivedEconomicResult<readonly InvoiceEvent[]> = known([{ weekIndex: 0, amount: usd(1000), tier: "VERIFIED", periodsCovered: 1, cadenceIntervalWeeks: 1, basis: "x" }]);
    const receipts = generateCashReceiptEvents(invoices, verifiedValue(createPaymentTerms(14)));
    expect(receipts.state).toBe("KNOWN");
    if (receipts.state === "KNOWN") {
      expect(receipts.value[0].amount).toEqual(usd(1000));
      expect(receipts.value[0].sourceInvoiceWeekIndex).toBe(0);
      expect(receipts.value[0].weekIndex).toBe(2); // ceil(14/7) = 2
      expect(receipts.value[0].paymentTermsOffsetWeeks).toBe(2);
    }
  });

  it("31/44. UNKNOWN payment terms never become Net 0 -- receipt timing is UNKNOWN while the source invoice schedule remains independently known", () => {
    const invoices: DerivedEconomicResult<readonly InvoiceEvent[]> = known([{ weekIndex: 0, amount: usd(1000), tier: "VERIFIED", periodsCovered: 1, cadenceIntervalWeeks: 1, basis: "x" }]);
    const receipts = generateCashReceiptEvents(invoices, unknownValue());
    expect(receipts).toEqual({ state: "UNKNOWN" });
    expect(invoices.state).toBe("KNOWN"); // unaffected
  });

  it("38. weakest-tier propagation for a receipt event", () => {
    const invoices: DerivedEconomicResult<readonly InvoiceEvent[]> = known([{ weekIndex: 0, amount: usd(1000), tier: "VERIFIED", periodsCovered: 1, cadenceIntervalWeeks: 1, basis: "x" }], "VERIFIED");
    const receipts = generateCashReceiptEvents(invoices, unverifiedSourcedValue(createPaymentTerms(30)));
    expect(receipts.state).toBe("KNOWN");
    if (receipts.state === "KNOWN") expect(receipts.tier).toBe("UNVERIFIED_SOURCED");
  });
});

describe("4E weekly cash ledger", () => {
  it("18. aggregates outflows/inflows correctly per week", () => {
    const payroll = known([payrollEvt(0, 1000), payrollEvt(1, 1000)]);
    const receipts = known([receiptEvt(2, 1500, 0)]);
    const ledger = buildWeeklyCashLedger(payroll, receipts);
    expect(ledger.state).toBe("KNOWN");
    if (ledger.state === "KNOWN") {
      expect(ledger.value.entries).toHaveLength(3); // weeks 0,1,2
      expect(ledger.value.entries[0].totalOutflow.amount).toBe(1000);
      expect(ledger.value.entries[1].totalOutflow.amount).toBe(1000);
      expect(ledger.value.entries[2].totalInflow.amount).toBe(1500);
    }
  });

  it("19/20. cumulative cash position is calculated correctly and negative cumulative cash is preserved, never clamped", () => {
    const payroll = known([payrollEvt(0, 1000), payrollEvt(1, 1000)]);
    const receipts = known([receiptEvt(2, 1500, 0)]);
    const ledger = buildWeeklyCashLedger(payroll, receipts);
    expect(ledger.state).toBe("KNOWN");
    if (ledger.state === "KNOWN") {
      expect(ledger.value.entries[0].cumulativeCash.amount).toBe(-1000);
      expect(ledger.value.entries[1].cumulativeCash.amount).toBe(-2000);
      expect(ledger.value.entries[2].cumulativeCash.amount).toBe(-500);
    }
  });

  it("35. currency mismatch between outflow and inflow blocks the combined ledger; no FX conversion occurs", () => {
    const payroll = known([payrollEvt(0, 1000)]); // USD
    const receipts: DerivedEconomicResult<readonly CashReceiptEvent[]> = known([
      { weekIndex: 1, amount: createMoneyAmount(1000, "CAD"), tier: "VERIFIED", sourceInvoiceWeekIndex: 0, paymentTermsOffsetWeeks: 1, basis: "x" },
    ]);
    const ledger = buildWeeklyCashLedger(payroll, receipts);
    expect(ledger).toMatchObject({ state: "UNAVAILABLE" });
  });
});

describe("4E working capital evaluation", () => {
  it("21/22/23. peak deficit, working capital requirement (absolute value), and peak deficit week are identified correctly", () => {
    const payroll = known([payrollEvt(0, 1000), payrollEvt(1, 1000)]);
    const receipts = known([receiptEvt(2, 1500, 0)]);
    const ledger = buildWeeklyCashLedger(payroll, receipts);
    const wc = evaluateWorkingCapital(ledger);
    expect(wc.state).toBe("KNOWN");
    if (wc.state === "KNOWN") {
      expect(wc.value.peakDeficit).toEqual({ amount: -2000, currency: "USD" });
      expect(wc.value.peakDeficitWeek).toBe(1);
      expect(wc.value.workingCapitalRequirement).toEqual({ amount: 2000, currency: "USD" });
    }
  });

  it("24. cumulative cash never negative -> explicit known zero working capital requirement, never omitted", () => {
    const payroll = known([payrollEvt(0, 500)]);
    const receipts = known([receiptEvt(0, 1000, 0)]);
    const ledger = buildWeeklyCashLedger(payroll, receipts);
    const wc = evaluateWorkingCapital(ledger);
    expect(wc.state).toBe("KNOWN");
    if (wc.state === "KNOWN") {
      expect(wc.value.workingCapitalRequirement).toEqual({ amount: 0, currency: "USD" });
      expect(wc.value.peakDeficitWeek).toBeNull();
    }
  });

  it("25/26. first funding-needed week and recovery week are identified when reached", () => {
    const payroll = known([payrollEvt(0, 1000), payrollEvt(1, 1000)]);
    const receipts = known([receiptEvt(2, 2500, 0)]);
    const ledger = buildWeeklyCashLedger(payroll, receipts);
    const wc = evaluateWorkingCapital(ledger);
    expect(wc.state).toBe("KNOWN");
    if (wc.state === "KNOWN") {
      expect(wc.value.fundingNeededWeek).toBe(0);
      expect(wc.value.recovery).toEqual({ kind: "RECOVERED", weekIndex: 2 });
    }
  });

  it("27. a no-negative-cash scenario has NOT_APPLICABLE recovery semantics, never an invented week 0", () => {
    const payroll = known([payrollEvt(0, 100)]);
    const receipts = known([receiptEvt(0, 200, 0)]);
    const ledger = buildWeeklyCashLedger(payroll, receipts);
    const wc = evaluateWorkingCapital(ledger);
    if (wc.state === "KNOWN") expect(wc.value.recovery).toEqual({ kind: "NOT_APPLICABLE" });
  });

  it("28. recovery not reached within the modeled horizon is represented explicitly, never invented beyond it", () => {
    const payroll = known([payrollEvt(0, 1000), payrollEvt(1, 1000)]);
    const receipts = known([receiptEvt(2, 500, 0)]); // insufficient to recover
    const ledger = buildWeeklyCashLedger(payroll, receipts);
    const wc = evaluateWorkingCapital(ledger);
    if (wc.state === "KNOWN") expect(wc.value.recovery).toEqual({ kind: "NOT_REACHED_WITHIN_HORIZON" });
  });

  it("39. weakest-tier propagation into the working-capital result", () => {
    const payroll = known([payrollEvt(0, 1000)], "UNVERIFIED_SOURCED");
    const receipts = known([receiptEvt(1, 500, 0)], "VERIFIED");
    const ledger = buildWeeklyCashLedger(payroll, receipts);
    const wc = evaluateWorkingCapital(ledger);
    expect(wc.state).toBe("KNOWN");
    if (wc.state === "KNOWN") expect(wc.tier).toBe("UNVERIFIED_SOURCED");
  });
});

function laborInput(overrides: Partial<LaborEconomicsInput> = {}): LaborEconomicsInput {
  return {
    basePayRate: verifiedValue(usd(30)),
    overtimeMultiplier: verifiedValue(createRate(1.5)),
    workerPerDiem: verifiedValue(usd(0)),
    burdenComponents: [{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"] }],
    ...overrides,
  };
}
function commercialTerms(overrides: Partial<CommercialTermsContract> = {}): CommercialTermsContract {
  return {
    billRate: verifiedValue(usd(85)),
    overtimeBillBasis: verifiedValue({ kind: "MULTIPLIER", multiplier: createRate(1.5) }),
    reimbursablePerDiem: verifiedValue(usd(0)),
    perDiemMarkup: verifiedValue(createRate(0)),
    paymentTerms: verifiedValue(createPaymentTerms(30)),
    billingCadence: verifiedValue("WEEKLY"),
    ...overrides,
  };
}
function deployment(overrides: Partial<DeploymentEconomicsInput> = {}): DeploymentEconomicsInput {
  return {
    headcount: verifiedValue(4),
    regularHoursPerWeek: verifiedValue(40),
    overtimeHoursPerWeek: verifiedValue(0),
    duration: { kind: "FIXED", weeks: 8 },
    startDate: null, estimatedEndDate: null, jurisdiction: null,
    ...overrides,
  };
}
function cashFlowAssumptions(overrides: Partial<CashFlowAssumptions> = {}): CashFlowAssumptions {
  return {
    payrollFrequency: verifiedValue("WEEKLY"),
    payrollAnchorWeek: verifiedValue(0),
    billingAnchorWeek: verifiedValue(0),
    ...overrides,
  };
}

describe("4E full orchestration: evaluateCashFlow composed from certified 4D economics", () => {
  it("a fully-known scenario produces a KNOWN complete ledger and working-capital evaluation end to end", () => {
    const labor = evaluateLaborCost(laborInput(), deployment());
    const billing = evaluateClientBilling(commercialTerms(), deployment());
    const evaluation = evaluateCashFlow(labor, billing, deployment(), commercialTerms(), cashFlowAssumptions());
    expect(evaluation.complete.payrollEvents.state).toBe("KNOWN");
    expect(evaluation.complete.invoiceEvents.state).toBe("KNOWN");
    expect(evaluation.complete.ledger.state).toBe("KNOWN");
    expect(evaluation.complete.workingCapital.state).toBe("KNOWN");
  });

  it("41. unresolved non-zero per diem from 4D blocks complete 4E economics", () => {
    const labor = evaluateLaborCost(laborInput({ workerPerDiem: verifiedValue(usd(50)) }), deployment()); // non-zero, unresolved frequency
    const billing = evaluateClientBilling(commercialTerms(), deployment());
    const evaluation = evaluateCashFlow(labor, billing, deployment(), commercialTerms(), cashFlowAssumptions());
    expect(evaluation.complete.payrollEvents.state).toBe("UNAVAILABLE");
    expect(evaluation.complete.ledger.state).toBe("UNAVAILABLE");
    expect(evaluation.complete.workingCapital.state).toBe("UNAVAILABLE");
  });

  it("42. labor-only cash-flow is an explicitly distinct field, not an alias of complete cash-flow -- it remains available when complete is blocked", () => {
    const labor = evaluateLaborCost(laborInput({ workerPerDiem: verifiedValue(usd(50)) }), deployment());
    const billing = evaluateClientBilling(commercialTerms(), deployment());
    const evaluation = evaluateCashFlow(labor, billing, deployment(), commercialTerms(), cashFlowAssumptions());
    expect(evaluation.laborOnly.payrollEvents.state).toBe("KNOWN");
    expect(evaluation.laborOnly.ledger.state).toBe("KNOWN");
    expect(evaluation.laborOnly.workingCapital.state).toBe("KNOWN");
    expect(evaluation.complete.workingCapital.state).toBe("UNAVAILABLE");
  });

  it("29/47. a valid post-deployment receipt extends the simulation tail beyond the final work week", () => {
    const dep = deployment({ duration: { kind: "FIXED", weeks: 4 } });
    const terms = commercialTerms({ paymentTerms: verifiedValue(createPaymentTerms(30)) }); // ceil(30/7) = 5 week offset
    const labor = evaluateLaborCost(laborInput(), dep);
    const billing = evaluateClientBilling(terms, dep);
    const evaluation = evaluateCashFlow(labor, billing, dep, terms, cashFlowAssumptions());
    expect(evaluation.complete.ledger.state).toBe("KNOWN");
    if (evaluation.complete.ledger.state === "KNOWN") {
      const lastWeek = evaluation.complete.ledger.value.entries.at(-1)!.weekIndex;
      expect(lastWeek).toBeGreaterThanOrEqual(3 + 5); // last invoice at week 3 + 5-week payment-term offset
    }
  });

  it("43. a known payroll schedule survives UNKNOWN payment terms; the combined ledger correctly becomes UNKNOWN", () => {
    const terms = commercialTerms({ paymentTerms: unknownValue() });
    const labor = evaluateLaborCost(laborInput(), deployment());
    const billing = evaluateClientBilling(terms, deployment());
    const evaluation = evaluateCashFlow(labor, billing, deployment(), terms, cashFlowAssumptions());
    expect(evaluation.complete.payrollEvents.state).toBe("KNOWN");
    expect(evaluation.complete.invoiceEvents.state).toBe("KNOWN"); // 44. known billing schedule survives UNKNOWN receipt timing
    expect(evaluation.complete.receiptEvents).toEqual({ state: "UNKNOWN" });
    expect(evaluation.complete.ledger).toEqual({ state: "UNKNOWN" });
  });

  it("32/33. UNKNOWN employer cost / UNKNOWN billing never become zero -- they block only their dependent events", () => {
    const labor = evaluateLaborCost(laborInput({ basePayRate: unknownValue() }), deployment());
    const terms = commercialTerms({ billRate: unknownValue() });
    const billing = evaluateClientBilling(terms, deployment());
    const evaluation = evaluateCashFlow(labor, billing, deployment(), terms, cashFlowAssumptions());
    expect(evaluation.complete.payrollEvents).toEqual({ state: "UNKNOWN" });
    expect(evaluation.complete.invoiceEvents).toEqual({ state: "UNKNOWN" });
  });

  it("34. an explicit zero employer cost/billing produces known-zero events, never blocked ones -- zero is not missing data", () => {
    const labor = evaluateLaborCost(laborInput({ basePayRate: verifiedValue(usd(0)) }), deployment());
    const billing = evaluateClientBilling(commercialTerms(), deployment());
    const evaluation = evaluateCashFlow(labor, billing, deployment(), commercialTerms(), cashFlowAssumptions());
    expect(evaluation.complete.payrollEvents.state).toBe("KNOWN");
    if (evaluation.complete.payrollEvents.state === "KNOWN") {
      expect(evaluation.complete.payrollEvents.value.every((e) => e.amount.amount === 0)).toBe(true);
    }
  });

  it("multi-context: a CAD / biweekly-payroll / monthly-billing scenario behaves independently with no hardcoded currency or cadence", () => {
    const terms = commercialTerms({ billRate: verifiedValue(createMoneyAmount(95, "CAD")), billingCadence: verifiedValue("MONTHLY") });
    const dep = deployment();
    const labor = evaluateLaborCost(laborInput({ basePayRate: verifiedValue(createMoneyAmount(40, "CAD")) }), dep);
    const billing = evaluateClientBilling(terms, dep);
    const evaluation = evaluateCashFlow(labor, billing, dep, terms, cashFlowAssumptions({ payrollFrequency: verifiedValue("BIWEEKLY") }));
    expect(evaluation.complete.payrollEvents.state).toBe("KNOWN");
    if (evaluation.complete.payrollEvents.state === "KNOWN") {
      expect(evaluation.complete.payrollEvents.value.map((e) => e.weekIndex)).toEqual([0, 2, 4, 6]);
      expect(evaluation.complete.payrollEvents.value[0].amount.currency).toBe("CAD");
    }
    expect(evaluation.complete.invoiceEvents.state).toBe("UNAVAILABLE"); // MONTHLY still unmapped regardless of currency/payroll cadence
  });

  it("a second, independent USD/weekly-billing/Net-15 scenario produces different, unrelated numbers with no cross-contamination", () => {
    const terms = commercialTerms({ paymentTerms: verifiedValue(createPaymentTerms(15)) }); // ceil(15/7)=3
    const dep = deployment({ duration: { kind: "FIXED", weeks: 3 } });
    const labor = evaluateLaborCost(laborInput(), dep);
    const billing = evaluateClientBilling(terms, dep);
    const evaluation = evaluateCashFlow(labor, billing, dep, terms, cashFlowAssumptions());
    expect(evaluation.complete.receiptEvents.state).toBe("KNOWN");
    if (evaluation.complete.receiptEvents.state === "KNOWN") {
      expect(evaluation.complete.receiptEvents.value.every((e) => e.paymentTermsOffsetWeeks === 3)).toBe(true);
    }
  });
});

/**
 * Phase 4E pre-commit reconciliation correction. Cadence determines cash-
 * event TIMING/GROUPING only -- it must never create or destroy economic
 * value. These tests prove SUM(event amounts) reconciles exactly to the
 * certified complete economics for a FIXED deployment whose horizon is not
 * evenly divisible by the cadence interval, per the correction mandate's 18
 * required items.
 */
describe("4E pre-commit reconciliation correction", () => {
  it("RC1. a 3-week WEEKLY payroll schedule totals exactly 3x the weekly employer cost", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("WEEKLY"), anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 3 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value.map((e) => e.periodsCovered)).toEqual([1, 1, 1]);
      expect(result.value.reduce((sum, e) => sum + e.amount.amount, 0)).toBe(3000);
    }
  });

  it("RC2. a 3-week BIWEEKLY payroll schedule splits 2+1 and totals exactly 3x the weekly employer cost (no overstatement)", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("BIWEEKLY"), anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 3 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value.map((e) => e.periodsCovered)).toEqual([2, 1]);
      expect(result.value.map((e) => e.amount.amount)).toEqual([2000, 1000]);
      expect(result.value.reduce((sum, e) => sum + e.amount.amount, 0)).toBe(3000);
    }
  });

  it("RC3. a 5-week BIWEEKLY payroll schedule splits 2+2+1 with exact total reconciliation", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("BIWEEKLY"), anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 5 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value.map((e) => e.periodsCovered)).toEqual([2, 2, 1]);
      expect(result.value.reduce((sum, e) => sum + e.amount.amount, 0)).toBe(5000);
    }
  });

  it("RC4. a 3-week WEEKLY billing schedule totals exactly 3x the weekly billing amount", () => {
    const result = generateInvoiceEvents(known(usd(15000)), verifiedValue("WEEKLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 3 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") expect(result.value.reduce((sum, e) => sum + e.amount.amount, 0)).toBe(45000);
  });

  it("RC5. a 3-week BIWEEKLY billing schedule splits 2+1 and totals exactly 3x the weekly billing amount", () => {
    const result = generateInvoiceEvents(known(usd(15000)), verifiedValue("BIWEEKLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 3 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value.map((e) => e.periodsCovered)).toEqual([2, 1]);
      expect(result.value.reduce((sum, e) => sum + e.amount.amount, 0)).toBe(45000);
    }
  });

  it("RC6. a 5-week BIWEEKLY billing schedule splits 2+2+1 with exact total reconciliation", () => {
    const result = generateInvoiceEvents(known(usd(15000)), verifiedValue("BIWEEKLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 5 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value.map((e) => e.periodsCovered)).toEqual([2, 2, 1]);
      expect(result.value.reduce((sum, e) => sum + e.amount.amount, 0)).toBe(75000);
    }
  });

  it("RC7. the final partial invoice produces a receipt of exactly the same amount", () => {
    const invoices = generateInvoiceEvents(known(usd(15000)), verifiedValue("BIWEEKLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 3 });
    expect(invoices.state).toBe("KNOWN");
    if (invoices.state === "KNOWN") {
      const finalInvoice = invoices.value.at(-1)!;
      expect(finalInvoice.periodsCovered).toBe(1);
      const receipts = generateCashReceiptEvents(invoices, verifiedValue(createPaymentTerms(14)));
      expect(receipts.state).toBe("KNOWN");
      if (receipts.state === "KNOWN") {
        const finalReceipt = receipts.value.at(-1)!;
        expect(finalReceipt.amount).toEqual(finalInvoice.amount);
        expect(finalReceipt.sourceInvoiceWeekIndex).toBe(finalInvoice.weekIndex);
      }
    }
  });

  it("RC8. the final receipt extends the collection tail beyond the final invoice week when payment terms require it", () => {
    const invoices = generateInvoiceEvents(known(usd(15000)), verifiedValue("BIWEEKLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 3 });
    const receipts = generateCashReceiptEvents(invoices, verifiedValue(createPaymentTerms(30))); // ceil(30/7) = 5
    expect(invoices.state).toBe("KNOWN");
    expect(receipts.state).toBe("KNOWN");
    if (invoices.state === "KNOWN" && receipts.state === "KNOWN") {
      const lastInvoiceWeek = Math.max(...invoices.value.map((e) => e.weekIndex));
      const lastReceiptWeek = Math.max(...receipts.value.map((e) => e.weekIndex));
      expect(lastReceiptWeek).toBe(lastInvoiceWeek + 5);
      const emptyPayroll: DerivedEconomicResult<readonly PayrollCashOutEvent[]> = known([]);
      const ledger = buildWeeklyCashLedger(emptyPayroll, receipts);
      expect(ledger.state).toBe("KNOWN");
      if (ledger.state === "KNOWN") expect(ledger.value.entries.at(-1)!.weekIndex).toBe(lastReceiptWeek);
    }
  });

  it("RC9. sum(receipt amounts) equals sum(invoice amounts) -- payment terms change timing, never economic amount", () => {
    const invoices = generateInvoiceEvents(known(usd(15000)), verifiedValue("BIWEEKLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 5 });
    const receipts = generateCashReceiptEvents(invoices, verifiedValue(createPaymentTerms(20)));
    expect(invoices.state).toBe("KNOWN");
    expect(receipts.state).toBe("KNOWN");
    if (invoices.state === "KNOWN" && receipts.state === "KNOWN") {
      const invoiceTotal = invoices.value.reduce((sum, e) => sum + e.amount.amount, 0);
      const receiptTotal = receipts.value.reduce((sum, e) => sum + e.amount.amount, 0);
      expect(receiptTotal).toBe(invoiceTotal);
      expect(invoiceTotal).toBe(75000); // 5 weeks x 15000
    }
  });

  it("RC10/RC11. corrected payroll and invoice events reconcile exactly to the certified complete fixed-deployment totals, for a horizon not evenly divisible by either cadence", () => {
    const dep = deployment({ duration: { kind: "FIXED", weeks: 5 } });
    const terms = commercialTerms({ billingCadence: verifiedValue("BIWEEKLY") });
    const labor = evaluateLaborCost(laborInput(), dep);
    const billing = evaluateClientBilling(terms, dep);
    const assumptions = cashFlowAssumptions({ payrollFrequency: verifiedValue("BIWEEKLY") });
    const evaluation = evaluateCashFlow(labor, billing, dep, terms, assumptions);

    expect(labor.completeFixedDeploymentTotal.state).toBe("KNOWN");
    expect(billing.completeFixedDeploymentTotal.state).toBe("KNOWN");
    expect(evaluation.complete.payrollEvents.state).toBe("KNOWN");
    expect(evaluation.complete.invoiceEvents.state).toBe("KNOWN");
    if (labor.completeFixedDeploymentTotal.state === "KNOWN" && evaluation.complete.payrollEvents.state === "KNOWN") {
      const payrollTotal = evaluation.complete.payrollEvents.value.reduce((sum, e) => sum + e.amount.amount, 0);
      expect(payrollTotal).toBeCloseTo(labor.completeFixedDeploymentTotal.value.amount);
    }
    if (billing.completeFixedDeploymentTotal.state === "KNOWN" && evaluation.complete.invoiceEvents.state === "KNOWN") {
      const invoiceTotal = evaluation.complete.invoiceEvents.value.reduce((sum, e) => sum + e.amount.amount, 0);
      expect(invoiceTotal).toBeCloseTo(billing.completeFixedDeploymentTotal.value.amount);
    }
  });

  it("RC12. no leading deployment economics disappear when the anchor is later than the start of the work horizon", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("WEEKLY"), anchorWeek: verifiedValue(3) }, { kind: "FIXED", weeks: 4 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value).toHaveLength(4); // all 4 worked weeks still produce an event despite anchor=3
      expect(result.value.reduce((sum, e) => sum + e.amount.amount, 0)).toBe(4000);
    }
  });

  it("RC13. working capital is derived from the corrected, reconciled event streams -- not a separately patched number", () => {
    const dep = deployment({ duration: { kind: "FIXED", weeks: 3 } });
    const terms = commercialTerms({ paymentTerms: verifiedValue(createPaymentTerms(0)) }); // 0-day terms: receipt lands in the same week as its invoice
    const labor = evaluateLaborCost(laborInput(), dep);
    const billing = evaluateClientBilling(terms, dep);
    const assumptions = cashFlowAssumptions({ payrollFrequency: verifiedValue("BIWEEKLY") });
    const evaluation = evaluateCashFlow(labor, billing, dep, terms, assumptions);
    expect(evaluation.complete.ledger.state).toBe("KNOWN");
    expect(evaluation.complete.workingCapital.state).toBe("KNOWN");
    if (evaluation.complete.ledger.state === "KNOWN" && evaluation.complete.workingCapital.state === "KNOWN") {
      // peak deficit is capped at 0 from above (a deficit is never positive) -- it must equal the lowest cumulative
      // cash actually reached in the ledger, or 0 if cumulative cash never went negative
      const minInLedger = Math.min(0, ...evaluation.complete.ledger.value.entries.map((e) => e.cumulativeCash.amount));
      expect(evaluation.complete.workingCapital.value.peakDeficit.amount).toBe(minInLedger);
    }
  });

  it("RC14. OPEN_ENDED duration remains protected after the correction -- no finite schedule is fabricated", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("BIWEEKLY"), anchorWeek: verifiedValue(0) }, { kind: "OPEN_ENDED" });
    expect(result).toEqual({ state: "UNKNOWN" });
  });

  it("RC15. UNKNOWN duration remains protected after the correction -- never treated as zero weeks", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("BIWEEKLY"), anchorWeek: verifiedValue(0) }, { kind: "UNKNOWN" });
    expect(result).toEqual({ state: "UNKNOWN" });
  });

  it("RC16. MONTHLY billing remains protected/unavailable after the correction -- no 4-week or 4.33-week assumption introduced", () => {
    const result = generateInvoiceEvents(known(usd(1000)), verifiedValue("MONTHLY"), { anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 5 });
    expect(result.state).toBe("UNAVAILABLE");
  });

  it("RC17. an unresolved non-zero per diem from 4D remains protected after the correction -- complete 4E economics stay blocked", () => {
    const dep = deployment({ duration: { kind: "FIXED", weeks: 5 } });
    const labor = evaluateLaborCost(laborInput({ workerPerDiem: verifiedValue(usd(50)) }), dep);
    const billing = evaluateClientBilling(commercialTerms(), dep);
    const evaluation = evaluateCashFlow(labor, billing, dep, commercialTerms(), cashFlowAssumptions({ payrollFrequency: verifiedValue("BIWEEKLY") }));
    expect(evaluation.complete.payrollEvents.state).toBe("UNAVAILABLE");
    expect(evaluation.complete.ledger.state).toBe("UNAVAILABLE");
  });

  it("RC18. WEEKLY cadence behavior is unchanged: N fixed deployment weeks still produce exactly N weekly economic periods", () => {
    const result = generatePayrollCashOutEvents(known(usd(1000)), { payrollFrequency: verifiedValue("WEEKLY"), anchorWeek: verifiedValue(0) }, { kind: "FIXED", weeks: 7 });
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value).toHaveLength(7);
      expect(result.value.every((e) => e.periodsCovered === 1)).toBe(true);
    }
  });
});

describe("4E scope boundaries: no financing product, no commercial policy, no persistence, no HOT/scoring logic", () => {
  it("50/51/52/53/54. the 4E engine source contains no loan/interest/financing-product logic, no GO/NO-GO or margin-threshold policy, no persistence/database access, and no HOT/eligibility/scoring references", () => {
    const domainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "domain");
    const sources = ["cash-flow-timing.ts", "cash-flow-events.ts", "cash-flow-engine.ts", "working-capital-engine.ts"]
      .map((file) => readFileSync(join(domainDir, file), "utf-8"));

    const forbiddenPatterns = [
      /\bLOAN\b/i, /\bINTEREST\b/i, /\bAPR\b/i, /FACTORING/i, /CREDIT[_-]?LINE/i, /BORROWING/i, /LENDER/i,
      /GO[_-]?NO[_-]?GO/i, /MINIMUM[_-]?MARGIN/i, /THRESHOLD/i,
      /\bHOT\b/, /eligibility/i, /\bscoring\b/i, /economicsReady/i, /humanVerification/i,
      /supabase/i, /from ["'].*\/repositories?\//i, /from ["'].*\/server\//i,
    ];

    for (const source of sources) {
      for (const pattern of forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});
