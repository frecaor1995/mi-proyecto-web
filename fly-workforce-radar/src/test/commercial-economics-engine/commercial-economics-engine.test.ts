import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BurdenComponent } from "../../domain/burden-profile";
import { burdenBreakdown, burdenComponentContribution, type WageBasis } from "../../domain/burden-engine";
import { clientOvertimeBilling, clientPerDiemBilling, clientPerDiemMarkupAmount, clientPerDiemReimbursement, regularClientBilling } from "../../domain/billing-engine";
import { overtimeWageCost, regularWageCost } from "../../domain/wage-engine";
import { evaluateClientBilling, evaluateCommercialEconomics, evaluateLaborCost } from "../../domain/commercial-economics-engine";
import {
  assumedValue, createMoneyAmount, createPaymentTerms, createRate, unknownValue, unverifiedSourcedValue, verifiedValue,
} from "../../domain/commercial-economics";
import type { CommercialTermsContract } from "../../domain/commercial-terms";
import type { DeploymentEconomicsInput, LaborEconomicsInput } from "../../domain/commercial-economics";

const usd = (amount: number) => createMoneyAmount(amount, "USD");

describe("4D wage engine", () => {
  it("1. regular wage calculation", () => {
    const result = regularWageCost(verifiedValue(usd(30)), verifiedValue(40));
    expect(result).toMatchObject({ state: "KNOWN", tier: "VERIFIED", value: { amount: 1200, currency: "USD" } });
  });

  it("2/3/4/5. OT base/premium/total decomposition works for a non-1.5 multiplier", () => {
    // base pay = 30, OT multiplier = 2.0 (double time), OT hours = 10
    const result = overtimeWageCost(verifiedValue(usd(30)), verifiedValue(createRate(2)), verifiedValue(10));
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") {
      expect(result.value.basePortion).toEqual({ amount: 300, currency: "USD" }); // 30 x 10
      expect(result.value.premiumPortion).toEqual({ amount: 300, currency: "USD" }); // 30 x (2-1) x 10
      expect(result.value.total).toEqual({ amount: 600, currency: "USD" });
    }
  });

  it("the mandate's own worked example: base=30, multiplier=1.5, hours=10 -> base=300, premium=150, total=450", () => {
    const result = overtimeWageCost(verifiedValue(usd(30)), verifiedValue(createRate(1.5)), verifiedValue(10));
    expect(result).toMatchObject({ state: "KNOWN", value: { basePortion: { amount: 300 }, premiumPortion: { amount: 150 }, total: { amount: 450 } } });
  });

  it("an OT multiplier below 1.0 is rejected as mathematically invalid, not silently reinterpreted", () => {
    const result = overtimeWageCost(verifiedValue(usd(30)), verifiedValue(createRate(0.5)), verifiedValue(10));
    expect(result.state).toBe("UNAVAILABLE");
  });

  it("37. partial result: OT hours explicitly 0 is not blocked by an UNKNOWN OT multiplier", () => {
    const result = overtimeWageCost(verifiedValue(usd(30)), unknownValue(), verifiedValue(0));
    expect(result).toMatchObject({ state: "KNOWN", value: { total: { amount: 0, currency: "USD" } } });
  });

  it("regular wage cost is unaffected by an unrelated UNKNOWN OT multiplier (it never even takes one as input)", () => {
    const result = regularWageCost(verifiedValue(usd(30)), verifiedValue(40));
    expect(result.state).toBe("KNOWN");
  });
});

describe("4D burden engine", () => {
  const basis: WageBasis = {
    regularWages: { state: "KNOWN", tier: "VERIFIED", value: usd(1200) },
    overtimeBaseWages: { state: "KNOWN", tier: "VERIFIED", value: usd(300) },
    overtimePremiumWages: { state: "KNOWN", tier: "VERIFIED", value: usd(150) },
  };

  it("6. a component applying only to regular wages burdens only regular wages", () => {
    const component: BurdenComponent = { type: "GENERAL_LIABILITY", rate: verifiedValue(createRate(0.03)), appliesTo: ["REGULAR_WAGES"] };
    const result = burdenComponentContribution(component, basis);
    expect(result).toMatchObject({ state: "KNOWN", value: { amount: 36 } }); // 1200 x 0.03
  });

  it("7. a component applying to regular + OT base but not premium excludes the premium portion", () => {
    const component: BurdenComponent = { type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.1)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION"] };
    const result = burdenComponentContribution(component, basis);
    expect(result).toMatchObject({ state: "KNOWN", value: { amount: 150 } }); // (1200 + 300) x 0.1, premium (150) excluded
  });

  it("8. a component applying to all three wage portions burdens all three", () => {
    const component: BurdenComponent = { type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"] };
    const result = burdenComponentContribution(component, basis);
    expect(result.state).toBe("KNOWN");
    if (result.state === "KNOWN") expect(result.value.amount).toBeCloseTo((1200 + 300 + 150) * 0.0765);
  });

  it("9/10. multiple components aggregate independently, and a zero rate is valid and distinct from UNKNOWN", () => {
    const components: BurdenComponent[] = [
      { type: "GENERAL_LIABILITY", rate: verifiedValue(createRate(0.03)), appliesTo: ["REGULAR_WAGES"] },
      { type: "BENEFITS", rate: verifiedValue(createRate(0)), appliesTo: ["REGULAR_WAGES"] }, // legitimate zero, not unknown
    ];
    const breakdown = burdenBreakdown(components, basis);
    expect(breakdown.components).toHaveLength(2);
    expect(breakdown.components[1].amount).toMatchObject({ state: "KNOWN", value: { amount: 0 } });
    expect(breakdown.totalBurden).toMatchObject({ state: "KNOWN", value: { amount: 36 } }); // 36 + 0
  });

  it("11. an UNKNOWN burden component blocks only the dependent burden/cost result, not unrelated wage results", () => {
    const components: BurdenComponent[] = [{ type: "OTHER", rate: unknownValue(), appliesTo: ["REGULAR_WAGES"] }];
    const breakdown = burdenBreakdown(components, basis);
    expect(breakdown.totalBurden).toEqual({ state: "UNKNOWN" });
    // the wage basis itself (computed independently, upstream) remains fully known regardless
    expect(basis.regularWages.state).toBe("KNOWN");
  });

  it("an empty burden component list is a legitimate, known zero burden, not unknown", () => {
    const breakdown = burdenBreakdown([], basis);
    expect(breakdown.totalBurden).toMatchObject({ state: "KNOWN", value: { amount: 0, currency: "USD" } });
  });
});

describe("4D billing engine", () => {
  it("12. regular client billing calculation", () => {
    const result = regularClientBilling(verifiedValue(usd(85)), verifiedValue(40));
    expect(result).toMatchObject({ state: "KNOWN", value: { amount: 3400 } });
  });

  it("13/14. worker OT multiplier and client OT billing are independent -- a MULTIPLIER-kind basis uses the client bill rate, never the worker pay rate", () => {
    const billRate = verifiedValue(usd(85));
    const overtimeBillBasis = verifiedValue({ kind: "MULTIPLIER" as const, multiplier: createRate(1.5) });
    const result = clientOvertimeBilling(billRate, overtimeBillBasis, verifiedValue(10));
    expect(result).toMatchObject({ state: "KNOWN", value: { amount: 1275 } }); // 85 x 1.5 x 10, NOT worker pay rate x anything
  });

  it("a RATE-kind OT bill basis uses the explicit flat OT bill rate, not a multiplier at all", () => {
    const result = clientOvertimeBilling(verifiedValue(usd(85)), verifiedValue({ kind: "RATE" as const, rate: usd(130) }), verifiedValue(10));
    expect(result).toMatchObject({ state: "KNOWN", value: { amount: 1300 } });
  });

  it("15/16. worker per diem and client reimbursement are independent fields; reimbursement alone is calculable without markup", () => {
    const reimbursement = clientPerDiemReimbursement(verifiedValue(usd(75)));
    expect(reimbursement).toMatchObject({ state: "KNOWN", value: { amount: 75 } });
    // an UNKNOWN markup does not block reimbursement (section 8/21 partial-result principle)
    const breakdown = clientPerDiemBilling(verifiedValue(usd(75)), unknownValue());
    expect(breakdown.reimbursement).toMatchObject({ state: "KNOWN", value: { amount: 75 } });
    expect(breakdown.markup).toEqual({ state: "UNKNOWN" });
    expect(breakdown.total).toEqual({ state: "UNKNOWN" }); // the TOTAL depends on both
  });

  it("17. per-diem markup calculation", () => {
    const markup = clientPerDiemMarkupAmount(verifiedValue(usd(75)), verifiedValue(createRate(0.1)));
    expect(markup).toMatchObject({ state: "KNOWN", value: { amount: 7.5 } });
    const breakdown = clientPerDiemBilling(verifiedValue(usd(75)), verifiedValue(createRate(0.1)));
    expect(breakdown.total).toMatchObject({ state: "KNOWN", value: { amount: 82.5 } });
  });
});

function laborInput(overrides: Partial<LaborEconomicsInput> = {}): LaborEconomicsInput {
  return {
    basePayRate: verifiedValue(usd(30)),
    overtimeMultiplier: verifiedValue(createRate(1.5)),
    workerPerDiem: verifiedValue(usd(50)),
    burdenComponents: [{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"] }],
    ...overrides,
  };
}
function commercialTerms(overrides: Partial<CommercialTermsContract> = {}): CommercialTermsContract {
  return {
    billRate: verifiedValue(usd(85)),
    overtimeBillBasis: verifiedValue({ kind: "MULTIPLIER", multiplier: createRate(1.5) }),
    reimbursablePerDiem: verifiedValue(usd(75)),
    perDiemMarkup: unknownValue(),
    paymentTerms: verifiedValue(createPaymentTerms(45)),
    billingCadence: verifiedValue("WEEKLY"),
    ...overrides,
  };
}
function deployment(overrides: Partial<DeploymentEconomicsInput> = {}): DeploymentEconomicsInput {
  return {
    headcount: verifiedValue(4),
    regularHoursPerWeek: verifiedValue(40),
    overtimeHoursPerWeek: verifiedValue(5),
    duration: { kind: "FIXED", weeks: 12 },
    startDate: null, estimatedEndDate: null, jurisdiction: null,
    ...overrides,
  };
}

describe("4D orchestration: labor-only cost/billing, headcount, duration, tiers, currency", () => {
  it("18. labor-only employer cost combines wages and burden, excluding per-diem", () => {
    const result = evaluateLaborCost(laborInput(), deployment());
    expect(result.perWorkerPerWeek.laborOnlyCost.state).toBe("KNOWN");
    const wagesOnly = result.perWorkerPerWeek.totalWages;
    if (result.perWorkerPerWeek.laborOnlyCost.state === "KNOWN" && wagesOnly.state === "KNOWN") {
      expect(result.perWorkerPerWeek.laborOnlyCost.value.amount).toBeGreaterThan(wagesOnly.value.amount);
    }
    expect(result.workerPerDiemCost).toMatchObject({ state: "KNOWN", value: { amount: 50 } });
  });

  it("19. labor-only client billing combines regular and OT billing", () => {
    const result = evaluateClientBilling(commercialTerms(), deployment());
    expect(result.perWorkerPerWeek.laborOnlyBilling.state).toBe("KNOWN");
    if (result.perWorkerPerWeek.laborOnlyBilling.state === "KNOWN") {
      expect(result.perWorkerPerWeek.laborOnlyBilling.value.amount).toBe(85 * 40 + 85 * 1.5 * 5);
    }
  });

  it("20/22. a profitable scenario produces positive labor-only gross profit and positive labor-only gross margin", () => {
    const evaluation = evaluateCommercialEconomics(laborInput(), commercialTerms(), deployment());
    expect(evaluation.grossProfit.laborOnlyPerWorkerPerWeek.state).toBe("KNOWN");
    if (evaluation.grossProfit.laborOnlyPerWorkerPerWeek.state === "KNOWN") expect(evaluation.grossProfit.laborOnlyPerWorkerPerWeek.value.amount).toBeGreaterThan(0);
    expect(evaluation.grossProfit.laborOnlyMarginPerWorkerPerWeek.state).toBe("KNOWN");
    if (evaluation.grossProfit.laborOnlyMarginPerWorkerPerWeek.state === "KNOWN") expect(evaluation.grossProfit.laborOnlyMarginPerWorkerPerWeek.value.value).toBeGreaterThan(0);
  });

  it("21/23. a loss-making scenario (bill rate below fully-loaded cost) produces negative labor-only gross profit and negative labor-only gross margin, never clamped", () => {
    const evaluation = evaluateCommercialEconomics(
      laborInput({ basePayRate: verifiedValue(usd(80)) }), // pay rate higher than bill rate
      commercialTerms({ billRate: verifiedValue(usd(85)), overtimeBillBasis: verifiedValue({ kind: "MULTIPLIER", multiplier: createRate(1.0) }) }),
      deployment(),
    );
    expect(evaluation.grossProfit.laborOnlyPerWorkerPerWeek.state).toBe("KNOWN");
    if (evaluation.grossProfit.laborOnlyPerWorkerPerWeek.state === "KNOWN") expect(evaluation.grossProfit.laborOnlyPerWorkerPerWeek.value.amount).toBeLessThan(0);
    if (evaluation.grossProfit.laborOnlyMarginPerWorkerPerWeek.state === "KNOWN") expect(evaluation.grossProfit.laborOnlyMarginPerWorkerPerWeek.value.value).toBeLessThan(0);
  });

  it("24. zero client billing does not divide by zero -- labor-only margin is an explicit unavailable result", () => {
    const evaluation = evaluateCommercialEconomics(
      laborInput(), commercialTerms(), deployment({ regularHoursPerWeek: verifiedValue(0), overtimeHoursPerWeek: verifiedValue(0) }),
    );
    expect(evaluation.grossProfit.laborOnlyMarginPerWorkerPerWeek).toMatchObject({ state: "UNAVAILABLE" });
  });

  it("25/26. an UNKNOWN bill rate never becomes zero; an explicit zero bill rate stays a real, known zero", () => {
    const unknownBillRateEval = evaluateClientBilling(commercialTerms({ billRate: unknownValue() }), deployment());
    expect(unknownBillRateEval.perWorkerPerWeek.regularBilling).toEqual({ state: "UNKNOWN" });

    const zeroBillRateEval = evaluateClientBilling(commercialTerms({ billRate: verifiedValue(usd(0)) }), deployment());
    expect(zeroBillRateEval.perWorkerPerWeek.regularBilling).toMatchObject({ state: "KNOWN", value: { amount: 0 } });
  });

  it("27/28. weakest-tier propagation: an OPERATOR_ASSUMPTION input produces an assumption-tiered result, never a stronger one", () => {
    const evaluation = evaluateLaborCost(laborInput({ basePayRate: assumedValue(usd(30)) }), deployment());
    expect(evaluation.perWorkerPerWeek.laborOnlyCost).toMatchObject({ state: "KNOWN", tier: "OPERATOR_ASSUMPTION" });
  });

  it("mixed tiers: VERIFIED bill/pay rate but UNVERIFIED_SOURCED headcount yields an UNVERIFIED_SOURCED-tiered labor-only workforce total", () => {
    const result = evaluateLaborCost(laborInput(), deployment({ headcount: unverifiedSourcedValue(4) }));
    expect(result.laborOnlyTotalWorkforcePerWeek).toMatchObject({ state: "KNOWN", tier: "UNVERIFIED_SOURCED" });
  });

  it("29/30. incompatible currencies return an explicit unavailable labor-only result, never a silent FX conversion", () => {
    const evaluation = evaluateCommercialEconomics(
      laborInput({ basePayRate: verifiedValue(createMoneyAmount(30, "CAD")) }),
      commercialTerms({ billRate: verifiedValue(usd(85)) }),
      deployment(),
    );
    expect(evaluation.grossProfit.laborOnlyPerWorkerPerWeek).toMatchObject({ state: "UNAVAILABLE" });
  });

  it("31/32. per-worker labor-only cost survives unknown headcount, while the labor-only workforce total correctly requires it", () => {
    const result = evaluateLaborCost(laborInput(), deployment({ headcount: unknownValue() }));
    expect(result.perWorkerPerWeek.laborOnlyCost.state).toBe("KNOWN"); // per-worker still known
    expect(result.laborOnlyTotalWorkforcePerWeek).toEqual({ state: "UNKNOWN" }); // total requires headcount
  });

  it("33/35. OPEN_ENDED duration allows weekly labor-only economics but never fabricates a deployment total", () => {
    const result = evaluateLaborCost(laborInput(), deployment({ duration: { kind: "OPEN_ENDED" } }));
    expect(result.laborOnlyTotalWorkforcePerWeek.state).toBe("KNOWN"); // weekly still known
    expect(result.laborOnlyFixedDeploymentTotal).toEqual({ state: "UNKNOWN" }); // no invented deployment total
  });

  it("34. a FIXED duration correctly produces a labor-only deployment total", () => {
    const result = evaluateLaborCost(laborInput(), deployment({ duration: { kind: "FIXED", weeks: 12 } }));
    expect(result.laborOnlyFixedDeploymentTotal.state).toBe("KNOWN");
    if (result.laborOnlyFixedDeploymentTotal.state === "KNOWN" && result.laborOnlyTotalWorkforcePerWeek.state === "KNOWN") {
      expect(result.laborOnlyFixedDeploymentTotal.value.amount).toBeCloseTo(result.laborOnlyTotalWorkforcePerWeek.value.amount * 12);
    }
  });

  it("36. UNKNOWN duration never fabricates a labor-only deployment total", () => {
    const result = evaluateLaborCost(laborInput(), deployment({ duration: { kind: "UNKNOWN" } }));
    expect(result.laborOnlyFixedDeploymentTotal).toEqual({ state: "UNKNOWN" });
  });

  it("38. behaves generically across multiple trades/currencies/contexts with no hardcoding", () => {
    const electricalScenario = evaluateCommercialEconomics(
      laborInput({ basePayRate: verifiedValue(usd(35)), burdenComponents: [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.14)), appliesTo: ["REGULAR_WAGES"] }] }),
      commercialTerms({ billRate: verifiedValue(usd(90)) }),
      deployment(),
    );
    const weldingScenario = evaluateCommercialEconomics(
      laborInput({ basePayRate: verifiedValue(createMoneyAmount(38, "CAD")), burdenComponents: [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.22)), appliesTo: ["REGULAR_WAGES"] }] }),
      commercialTerms({ billRate: verifiedValue(createMoneyAmount(95, "CAD")) }),
      deployment(),
    );
    expect(electricalScenario.grossProfit.laborOnlyPerWorkerPerWeek.state).toBe("KNOWN");
    expect(weldingScenario.grossProfit.laborOnlyPerWorkerPerWeek.state).toBe("KNOWN");
    if (electricalScenario.grossProfit.laborOnlyPerWorkerPerWeek.state === "KNOWN") expect(electricalScenario.grossProfit.laborOnlyPerWorkerPerWeek.value.currency).toBe("USD");
    if (weldingScenario.grossProfit.laborOnlyPerWorkerPerWeek.state === "KNOWN") expect(weldingScenario.grossProfit.laborOnlyPerWorkerPerWeek.value.currency).toBe("CAD");
  });

  it("perDiemNetContribution is computed independently of the wage-based gross profit, never summed into it", () => {
    const evaluation = evaluateCommercialEconomics(laborInput({ workerPerDiem: verifiedValue(usd(50)) }), commercialTerms({ reimbursablePerDiem: verifiedValue(usd(75)), perDiemMarkup: verifiedValue(createRate(0)) }), deployment());
    expect(evaluation.grossProfit.perDiemNetContribution).toMatchObject({ state: "KNOWN", value: { amount: 25 } }); // 75 - 50
  });
});

/**
 * Phase 4D pre-commit correction. A mathematically partial subtotal (wages +
 * burden / billing, excluding per-diem) must never masquerade as a complete
 * economic total when a material, unresolved per-diem exists. These tests
 * prove the labor-only vs complete distinction directly, per the correction
 * mandate's 15 required items.
 */
describe("4D pre-commit correction: labor-only vs complete per-diem semantics", () => {
  it("PC1. known-zero worker per diem does not block complete employer cost", () => {
    const result = evaluateLaborCost(laborInput({ workerPerDiem: verifiedValue(usd(0)) }), deployment());
    expect(result.perWorkerPerWeek.completeEmployerCost.state).toBe("KNOWN");
    if (result.perWorkerPerWeek.completeEmployerCost.state === "KNOWN" && result.perWorkerPerWeek.laborOnlyCost.state === "KNOWN") {
      expect(result.perWorkerPerWeek.completeEmployerCost.value.amount).toBe(result.perWorkerPerWeek.laborOnlyCost.value.amount);
    }
  });

  it("PC2. known non-zero worker per diem with no frequency blocks complete normalized employer cost", () => {
    const result = evaluateLaborCost(laborInput(), deployment()); // default workerPerDiem = $50, non-zero
    expect(result.perWorkerPerWeek.completeEmployerCost.state).toBe("UNAVAILABLE");
    if (result.perWorkerPerWeek.completeEmployerCost.state === "UNAVAILABLE") {
      expect(result.perWorkerPerWeek.completeEmployerCost.reason).toMatch(/per-diem/i);
    }
  });

  it("PC3. UNKNOWN worker per diem never becomes zero", () => {
    const result = evaluateLaborCost(laborInput({ workerPerDiem: unknownValue() }), deployment());
    expect(result.workerPerDiemCost).toEqual({ state: "UNKNOWN" });
    expect(result.perWorkerPerWeek.completeEmployerCost).toEqual({ state: "UNKNOWN" });
  });

  it("PC4. labor-only employer cost remains known despite unresolved non-zero worker per diem", () => {
    const result = evaluateLaborCost(laborInput(), deployment()); // default $50 per diem blocks completeness
    expect(result.perWorkerPerWeek.laborOnlyCost.state).toBe("KNOWN");
    expect(result.perWorkerPerWeek.completeEmployerCost.state).toBe("UNAVAILABLE");
  });

  it("PC5. known-zero client per diem does not block complete client billing", () => {
    const result = evaluateClientBilling(commercialTerms({ reimbursablePerDiem: verifiedValue(usd(0)), perDiemMarkup: verifiedValue(createRate(0)) }), deployment());
    expect(result.perWorkerPerWeek.completeBilling.state).toBe("KNOWN");
    if (result.perWorkerPerWeek.completeBilling.state === "KNOWN" && result.perWorkerPerWeek.laborOnlyBilling.state === "KNOWN") {
      expect(result.perWorkerPerWeek.completeBilling.value.amount).toBe(result.perWorkerPerWeek.laborOnlyBilling.value.amount);
    }
  });

  it("PC6. known non-zero client reimbursable per diem with no frequency blocks complete normalized client billing", () => {
    const result = evaluateClientBilling(commercialTerms(), deployment()); // default reimbursablePerDiem = $75, non-zero
    expect(result.perWorkerPerWeek.completeBilling.state).toBe("UNAVAILABLE");
    if (result.perWorkerPerWeek.completeBilling.state === "UNAVAILABLE") {
      expect(result.perWorkerPerWeek.completeBilling.reason).toMatch(/per-diem/i);
    }
  });

  it("PC7. UNKNOWN client per diem never becomes zero", () => {
    const result = evaluateClientBilling(commercialTerms({ reimbursablePerDiem: unknownValue() }), deployment());
    expect(result.perDiemBilling.reimbursement).toEqual({ state: "UNKNOWN" });
    expect(result.perWorkerPerWeek.completeBilling).toEqual({ state: "UNKNOWN" });
  });

  it("PC8. labor-only client billing remains known despite unresolved client per diem", () => {
    const result = evaluateClientBilling(commercialTerms(), deployment()); // default $75 reimbursable per diem blocks completeness
    expect(result.perWorkerPerWeek.laborOnlyBilling.state).toBe("KNOWN");
    expect(result.perWorkerPerWeek.completeBilling.state).toBe("UNAVAILABLE");
  });

  it("PC9. unresolved non-zero worker per diem blocks complete gross profit even when client per-diem is resolved", () => {
    const evaluation = evaluateCommercialEconomics(
      laborInput(), // default $50 worker per diem, unresolved
      commercialTerms({ reimbursablePerDiem: verifiedValue(usd(0)), perDiemMarkup: verifiedValue(createRate(0)) }), // client side resolved (zero)
      deployment(),
    );
    expect(evaluation.grossProfit.completePerWorkerPerWeek.state).toBe("UNAVAILABLE");
    expect(evaluation.grossProfit.laborOnlyPerWorkerPerWeek.state).toBe("KNOWN"); // labor-only remains available
  });

  it("PC10. unresolved non-zero client per diem blocks complete gross profit even when worker per-diem is resolved", () => {
    const evaluation = evaluateCommercialEconomics(
      laborInput({ workerPerDiem: verifiedValue(usd(0)) }), // worker side resolved (zero)
      commercialTerms(), // default $75 reimbursable per diem, unresolved
      deployment(),
    );
    expect(evaluation.grossProfit.completePerWorkerPerWeek.state).toBe("UNAVAILABLE");
    expect(evaluation.grossProfit.laborOnlyPerWorkerPerWeek.state).toBe("KNOWN");
  });

  it("PC11. unresolved per diem blocks complete gross margin -- never a fabricated 0% or silently omitted figure", () => {
    const evaluation = evaluateCommercialEconomics(laborInput(), commercialTerms(), deployment());
    expect(evaluation.grossProfit.completePerWorkerPerWeek.state).toBe("UNAVAILABLE");
    expect(evaluation.grossProfit.completeMarginPerWorkerPerWeek.state).toBe("UNAVAILABLE");
  });

  it("PC12. labor-only profit/margin are explicitly distinct fields from complete profit/margin, not aliases of the same computation", () => {
    const evaluation = evaluateCommercialEconomics(laborInput(), commercialTerms(), deployment());
    // labor-only is knowable; complete is not -- proving these are genuinely independent results, not the same value under two names
    expect(evaluation.grossProfit.laborOnlyPerWorkerPerWeek.state).toBe("KNOWN");
    expect(evaluation.grossProfit.laborOnlyMarginPerWorkerPerWeek.state).toBe("KNOWN");
    expect(evaluation.grossProfit.completePerWorkerPerWeek.state).toBe("UNAVAILABLE");
    expect(evaluation.grossProfit.completeMarginPerWorkerPerWeek.state).toBe("UNAVAILABLE");
  });

  it("PC13. a fully zero-per-diem scenario still produces a normal, known complete gross profit and margin, identical to the labor-only figures", () => {
    const evaluation = evaluateCommercialEconomics(
      laborInput({ workerPerDiem: verifiedValue(usd(0)) }),
      commercialTerms({ reimbursablePerDiem: verifiedValue(usd(0)), perDiemMarkup: verifiedValue(createRate(0)) }),
      deployment(),
    );
    expect(evaluation.grossProfit.completePerWorkerPerWeek.state).toBe("KNOWN");
    expect(evaluation.grossProfit.completeMarginPerWorkerPerWeek.state).toBe("KNOWN");
    if (evaluation.grossProfit.completePerWorkerPerWeek.state === "KNOWN" && evaluation.grossProfit.laborOnlyPerWorkerPerWeek.state === "KNOWN") {
      expect(evaluation.grossProfit.completePerWorkerPerWeek.value.amount).toBeCloseTo(evaluation.grossProfit.laborOnlyPerWorkerPerWeek.value.amount);
    }
  });

  it("PC14. an unrelated UNKNOWN input (headcount) blocks only the dependent complete workforce total, not the complete per-worker cost", () => {
    const result = evaluateLaborCost(laborInput({ workerPerDiem: verifiedValue(usd(0)) }), deployment({ headcount: unknownValue() }));
    expect(result.perWorkerPerWeek.completeEmployerCost.state).toBe("KNOWN"); // per-worker complete cost unaffected by headcount
    expect(result.completeTotalWorkforcePerWeek).toEqual({ state: "UNKNOWN" }); // workforce total correctly requires headcount
  });

  it("PC15. no daily/weekly/workday/mobilization per-diem conversion constant is introduced anywhere in the 4D engine source", () => {
    const domainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "domain");
    const sources = ["wage-engine.ts", "burden-engine.ts", "billing-engine.ts", "commercial-economics-engine.ts"]
      .map((file) => readFileSync(join(domainDir, file), "utf-8"));

    const forbiddenIdentifiers = [/perDiemFrequency/i, /DAILY_TO_WEEKLY/i, /WORKDAYS?/i, /CALENDAR_DAYS?/i, /MOBILIZATION_FREQUENCY/i, /DAYS_PER_WEEK/i];
    // a per-diem amount multiplied (or divided) by a bare day-count literal (5 or 7) would be a fabricated conversion factor
    const forbiddenConversionMath = [/perDiem\w*\s*[*/]\s*[57]\b/i, /\b[57]\s*[*/]\s*\w*[pP]er[dD]iem/];

    for (const source of sources) {
      for (const pattern of [...forbiddenIdentifiers, ...forbiddenConversionMath]) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});
