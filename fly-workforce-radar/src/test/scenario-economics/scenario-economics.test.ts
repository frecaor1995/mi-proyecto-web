import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BurdenComponent } from "../../domain/burden-profile";
import {
  assumedValue, createMoneyAmount, createRate, unknownValue, unverifiedSourcedValue, verifiedValue,
} from "../../domain/economic-value";
import { createPaymentTerms } from "../../domain/commercial-economics";
import type { DeploymentEconomicsInput, LaborEconomicsInput } from "../../domain/commercial-economics";
import type { CommercialTermsContract } from "../../domain/commercial-terms";
import type { CashFlowAssumptions } from "../../domain/cash-flow-engine";
import { evaluateCashFlow } from "../../domain/cash-flow-engine";
import { evaluateCommercialEconomics } from "../../domain/commercial-economics-engine";
import type { ScenarioDefinition, ScenarioOverrides } from "../../domain/economics-scenario";
import { applyBurdenComponentRatePatches, patchBurdenComponentRateByType, resolveScenarioInputs } from "../../domain/economics-scenario";
import { classifyProfitability, runScenario, runScenarioSet } from "../../domain/scenario-engine";
import { compareScenarios } from "../../domain/scenario-comparison";
import { runBurdenComponentRateSensitivity, runSensitivity, type SensitivityTestPoint } from "../../domain/sensitivity-engine";

const usd = (amount: number) => createMoneyAmount(amount, "USD");

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
function scenarioDefinition(label: "BASE" | "CONSERVATIVE" | "TARGET", overrides: ScenarioOverrides = {}): ScenarioDefinition {
  return {
    label,
    baseLabor: laborInput(),
    baseCommercialTerms: commercialTerms(),
    baseDeployment: deployment(),
    baseCashFlowAssumptions: cashFlowAssumptions(),
    overrides,
  };
}
function knownAmount(result: { state: string; value?: unknown }): number {
  if (result.state !== "KNOWN") throw new Error(`expected KNOWN, got ${result.state}`);
  return (result.value as { amount: number }).amount;
}

describe("4F scenario resolution", () => {
  it("1. the BASE label does not imply VERIFIED -- an OPERATOR_ASSUMPTION input under BASE propagates that tier, not VERIFIED", () => {
    const result = runScenario(scenarioDefinition("BASE", { labor: { basePayRate: assumedValue(usd(30)) } }));
    expect(result.economics.labor.perWorkerPerWeek.laborOnlyCost).toMatchObject({ tier: "OPERATOR_ASSUMPTION" });
  });

  it("2/3. CONSERVATIVE and TARGET labels do not alter any value automatically -- identical inputs under different labels produce identical resolved economics", () => {
    const shared = { baseLabor: laborInput(), baseCommercialTerms: commercialTerms(), baseDeployment: deployment(), baseCashFlowAssumptions: cashFlowAssumptions() };
    const base = runScenario({ label: "BASE", ...shared });
    const conservative = runScenario({ label: "CONSERVATIVE", ...shared });
    const target = runScenario({ label: "TARGET", ...shared });
    expect(conservative.economics.grossProfit.completePerWorkerPerWeek).toEqual(base.economics.grossProfit.completePerWorkerPerWeek);
    expect(target.economics.grossProfit.completePerWorkerPerWeek).toEqual(base.economics.grossProfit.completePerWorkerPerWeek);
  });

  it("4. an explicit override replaces the base value", () => {
    const resolved = resolveScenarioInputs(scenarioDefinition("BASE", { commercialTerms: { billRate: verifiedValue(usd(100)) } }));
    expect(resolved.commercialTerms.billRate).toEqual(verifiedValue(usd(100)));
  });

  it("5. an absent override uses the provided base value", () => {
    const resolved = resolveScenarioInputs(scenarioDefinition("BASE"));
    expect(resolved.commercialTerms.billRate).toEqual(commercialTerms().billRate);
  });

  it("6. absent base value + absent override remains UNKNOWN", () => {
    const def: ScenarioDefinition = {
      label: "BASE", baseLabor: laborInput({ basePayRate: unknownValue() }), baseCommercialTerms: commercialTerms(),
      baseDeployment: deployment(), baseCashFlowAssumptions: cashFlowAssumptions(),
    };
    expect(resolveScenarioInputs(def).labor.basePayRate).toEqual({ tier: "UNKNOWN" });
  });

  it("7. an explicit UNKNOWN override replaces a known base value with UNKNOWN, never falling back to the base", () => {
    const resolved = resolveScenarioInputs(scenarioDefinition("BASE", { labor: { basePayRate: unknownValue() } }));
    expect(resolved.labor.basePayRate).toEqual({ tier: "UNKNOWN" });
  });

  it("8. the override's own fact tier replaces the base's fact tier for the resolved value -- the VERIFIED base tier is never inherited", () => {
    const def = scenarioDefinition("BASE", { commercialTerms: { billRate: assumedValue(usd(55)) } }); // base billRate is VERIFIED $85
    expect(resolveScenarioInputs(def).commercialTerms.billRate).toEqual(assumedValue(usd(55)));
    const result = runScenario(def);
    expect(result.economics.billing.perWorkerPerWeek.completeBilling).toMatchObject({ tier: "OPERATOR_ASSUMPTION" });
  });

  it("9. scenario resolution does not mutate the base labor input object", () => {
    const baseLabor = laborInput();
    const def: ScenarioDefinition = {
      label: "BASE", baseLabor, baseCommercialTerms: commercialTerms(), baseDeployment: deployment(), baseCashFlowAssumptions: cashFlowAssumptions(),
      overrides: { labor: { basePayRate: verifiedValue(usd(999)) } },
    };
    resolveScenarioInputs(def);
    expect(baseLabor.basePayRate).toEqual(verifiedValue(usd(30)));
  });

  it("10. scenario resolution does not mutate the canonical commercial terms object", () => {
    const baseTerms = commercialTerms();
    const def: ScenarioDefinition = {
      label: "BASE", baseLabor: laborInput(), baseCommercialTerms: baseTerms, baseDeployment: deployment(), baseCashFlowAssumptions: cashFlowAssumptions(),
      overrides: { commercialTerms: { billRate: verifiedValue(usd(999)) } },
    };
    resolveScenarioInputs(def);
    expect(baseTerms.billRate).toEqual(verifiedValue(usd(85)));
  });

  it("11. no hidden CONSERVATIVE/TARGET percentage adjustment exists anywhere in the 4F scenario source", () => {
    const domainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "domain");
    const sources = ["economics-scenario.ts", "scenario-engine.ts"].map((file) => readFileSync(join(domainDir, file), "utf-8"));
    for (const source of sources) {
      expect(source).not.toMatch(/label\s*===\s*["']CONSERVATIVE["']/);
      expect(source).not.toMatch(/label\s*===\s*["']TARGET["']/);
      expect(source).not.toMatch(/0\.9\s*\*|1\.1\s*\*|\*\s*0\.95|\*\s*1\.05/);
    }
  });

  it("12/13/14. one, two, and three scenarios can each run independently with no cross-contamination", () => {
    const one = runScenarioSet([scenarioDefinition("BASE")]);
    expect(one.outcome).toBe("OK");
    if (one.outcome === "OK") expect(one.scenarios).toHaveLength(1);

    const two = runScenarioSet([scenarioDefinition("BASE"), scenarioDefinition("TARGET", { commercialTerms: { billRate: verifiedValue(usd(120)) } })]);
    expect(two.outcome).toBe("OK");
    if (two.outcome === "OK") {
      expect(two.scenarios).toHaveLength(2);
      expect(two.scenarios[0].economics.billing.perWorkerPerWeek.completeBilling).not.toEqual(two.scenarios[1].economics.billing.perWorkerPerWeek.completeBilling);
    }

    const three = runScenarioSet([scenarioDefinition("BASE"), scenarioDefinition("CONSERVATIVE"), scenarioDefinition("TARGET")]);
    expect(three.outcome).toBe("OK");
    if (three.outcome === "OK") expect(three.scenarios).toHaveLength(3);
  });

  it("duplicate scenario labels are detected explicitly, never silently overwritten", () => {
    const result = runScenarioSet([scenarioDefinition("BASE"), scenarioDefinition("BASE")]);
    expect(result).toMatchObject({ outcome: "DUPLICATE_LABELS", duplicateLabels: ["BASE"] });
  });
});

describe("4F scenario execution", () => {
  it("15/16/17/18/19/20. a scenario result matches the certified 4D/4E engines run directly on the same resolved inputs -- no reimplementation", () => {
    const def = scenarioDefinition("BASE");
    const resolved = resolveScenarioInputs(def);
    const directEconomics = evaluateCommercialEconomics(resolved.labor, resolved.commercialTerms, resolved.deployment);
    const directCashFlow = evaluateCashFlow(directEconomics.labor, directEconomics.billing, resolved.deployment, resolved.commercialTerms, resolved.cashFlowAssumptions);
    const result = runScenario(def);
    expect(result.economics).toEqual(directEconomics);
    expect(result.cashFlow).toEqual(directCashFlow);
    expect(result.profitability.complete.grossProfit).toEqual(directEconomics.grossProfit.completePerWorkerPerWeek);
    expect(result.profitability.complete.grossMargin).toEqual(directEconomics.grossProfit.completeMarginPerWorkerPerWeek);
  });

  it("21. unresolved non-zero per diem blocks complete scenario economics", () => {
    const result = runScenario(scenarioDefinition("BASE", { labor: { workerPerDiem: verifiedValue(usd(50)) } }));
    expect(result.economics.labor.perWorkerPerWeek.completeEmployerCost.state).toBe("UNAVAILABLE");
    expect(result.profitability.complete.grossProfit.state).toBe("UNAVAILABLE");
    expect(result.blockingReasons.length).toBeGreaterThan(0);
  });

  it("22. the labor-only result remains clearly distinguished and remains available when complete is blocked", () => {
    const result = runScenario(scenarioDefinition("BASE", { labor: { workerPerDiem: verifiedValue(usd(50)) } }));
    expect(result.profitability.laborOnly.grossProfit.state).toBe("KNOWN");
    expect(result.profitability.complete.grossProfit.state).toBe("UNAVAILABLE");
  });

  it("23/24. UNKNOWN payment terms does not block gross profit but blocks the dependent working-capital result", () => {
    const result = runScenario(scenarioDefinition("BASE", { commercialTerms: { paymentTerms: unknownValue() } }));
    expect(result.profitability.complete.grossProfit.state).toBe("KNOWN");
    expect(result.cashFlow.complete.workingCapital.state).toBe("UNKNOWN");
  });

  it("25. a MONTHLY billing cadence limitation propagates into cash flow without disturbing gross profit", () => {
    const result = runScenario(scenarioDefinition("BASE", { commercialTerms: { billingCadence: verifiedValue("MONTHLY") } }));
    expect(result.profitability.complete.grossProfit.state).toBe("KNOWN");
    expect(result.cashFlow.complete.invoiceEvents.state).toBe("UNAVAILABLE");
  });

  it("26. a currency mismatch between labor and billing currencies remains explicit", () => {
    const result = runScenario(scenarioDefinition("BASE", { labor: { basePayRate: verifiedValue(createMoneyAmount(30, "CAD")) } }));
    expect(result.profitability.complete.grossProfit.state).toBe("UNAVAILABLE");
  });

  it("27/28. negative and zero gross profit are preserved, never clamped, and classified correctly", () => {
    const lossResult = runScenario(scenarioDefinition("BASE", { labor: { basePayRate: verifiedValue(usd(200)) } }));
    expect(lossResult.profitability.complete.classification).toBe("LOSS");
    expect(knownAmount(lossResult.profitability.complete.grossProfit)).toBeLessThan(0);

    // zero pay rate and zero bill rate: cost and billing are both exactly $0 on every computation path, so profit is exactly zero with no floating-point risk
    const breakEvenResult = runScenario(scenarioDefinition("BASE", { labor: { basePayRate: verifiedValue(usd(0)) }, commercialTerms: { billRate: verifiedValue(usd(0)) } }));
    expect(breakEvenResult.profitability.complete.classification).toBe("BREAK_EVEN");
    expect(knownAmount(breakEvenResult.profitability.complete.grossProfit)).toBeCloseTo(0);
  });

  it("29. zero working capital is preserved as an explicit known zero, not missing data", () => {
    const result = runScenario(scenarioDefinition("BASE", { commercialTerms: { paymentTerms: verifiedValue(createPaymentTerms(0)) } }));
    expect(result.cashFlow.complete.workingCapital.state).toBe("KNOWN");
    if (result.cashFlow.complete.workingCapital.state === "KNOWN") {
      expect(result.cashFlow.complete.workingCapital.value.workingCapitalRequirement.amount).toBe(0);
    }
  });
});

describe("4F scenario comparison", () => {
  it("30/31. profit delta BASE->TARGET is computed correctly, including negative deltas", () => {
    const base = runScenario(scenarioDefinition("BASE"));
    const target = runScenario(scenarioDefinition("TARGET", { commercialTerms: { billRate: verifiedValue(usd(60)) } }));
    const comparison = compareScenarios(base, target);
    expect(comparison.grossProfitDelta.state).toBe("KNOWN");
    expect(knownAmount(comparison.grossProfitDelta)).toBeLessThan(0);
  });

  it("32. gross-margin delta computed correctly", () => {
    const base = runScenario(scenarioDefinition("BASE"));
    const target = runScenario(scenarioDefinition("TARGET", { commercialTerms: { billRate: verifiedValue(usd(120)) } }));
    const comparison = compareScenarios(base, target);
    expect(comparison.grossMarginDelta.state).toBe("KNOWN");
    if (comparison.grossMarginDelta.state === "KNOWN") expect(comparison.grossMarginDelta.value.value).toBeGreaterThan(0);
  });

  it("33. working-capital delta computed correctly", () => {
    const base = runScenario(scenarioDefinition("BASE", { commercialTerms: { paymentTerms: verifiedValue(createPaymentTerms(0)) } }));
    const target = runScenario(scenarioDefinition("TARGET", { commercialTerms: { paymentTerms: verifiedValue(createPaymentTerms(60)) } }));
    const comparison = compareScenarios(base, target);
    expect(comparison.workingCapitalDelta.state).toBe("KNOWN");
    expect(knownAmount(comparison.workingCapitalDelta)).toBeGreaterThan(0);
  });

  it("34. recovery-week delta is computed only when both scenarios reach a concrete recovery week", () => {
    const netZeroResult = runScenario(scenarioDefinition("BASE", { commercialTerms: { paymentTerms: verifiedValue(createPaymentTerms(0)) } }));
    expect(netZeroResult.cashFlow.complete.workingCapital).toMatchObject({ state: "KNOWN", value: { recovery: { kind: "NOT_APPLICABLE" } } });
    expect(compareScenarios(netZeroResult, netZeroResult).recoveryWeekDelta).toMatchObject({ state: "UNAVAILABLE" });

    const net30Result = runScenario(scenarioDefinition("BASE", { commercialTerms: { paymentTerms: verifiedValue(createPaymentTerms(30)) } }));
    const net45Result = runScenario(scenarioDefinition("TARGET", { commercialTerms: { paymentTerms: verifiedValue(createPaymentTerms(45)) } }));
    expect(net30Result.cashFlow.complete.workingCapital.state).toBe("KNOWN");
    expect(net45Result.cashFlow.complete.workingCapital.state).toBe("KNOWN");
    if (net30Result.cashFlow.complete.workingCapital.state === "KNOWN" && net45Result.cashFlow.complete.workingCapital.state === "KNOWN") {
      expect(net30Result.cashFlow.complete.workingCapital.value.recovery.kind).toBe("RECOVERED");
      expect(net45Result.cashFlow.complete.workingCapital.value.recovery.kind).toBe("RECOVERED");
      expect(compareScenarios(net30Result, net45Result).recoveryWeekDelta.state).toBe("KNOWN");
    }
  });

  it("35. comparison does not mutate either scenario result", () => {
    const base = runScenario(scenarioDefinition("BASE"));
    const target = runScenario(scenarioDefinition("TARGET"));
    const before = base.profitability.complete.grossProfit;
    compareScenarios(base, target);
    expect(base.profitability.complete.grossProfit).toEqual(before);
  });

  it("36. a different-currency monetary comparison becomes UNAVAILABLE, never FX-converted", () => {
    const usdScenario = runScenario(scenarioDefinition("BASE"));
    const cadScenario = runScenario(scenarioDefinition("TARGET", {
      labor: { basePayRate: verifiedValue(createMoneyAmount(30, "CAD")) },
      commercialTerms: { billRate: verifiedValue(createMoneyAmount(85, "CAD")) },
    }));
    expect(compareScenarios(usdScenario, cadScenario).grossProfitDelta).toMatchObject({ state: "UNAVAILABLE" });
  });

  it("37. an incomplete working-capital result does not block an otherwise-known profit comparison", () => {
    const base = runScenario(scenarioDefinition("BASE"));
    const target = runScenario(scenarioDefinition("TARGET", { commercialTerms: { paymentTerms: unknownValue() } }));
    const comparison = compareScenarios(base, target);
    expect(comparison.grossProfitDelta.state).toBe("KNOWN");
    expect(comparison.workingCapitalDelta.state).toBe("UNKNOWN");
  });

  it("38. comparison works with exactly two scenarios", () => {
    const a = runScenario(scenarioDefinition("BASE"));
    const b = runScenario(scenarioDefinition("CONSERVATIVE"));
    expect(() => compareScenarios(a, b)).not.toThrow();
  });
});

describe("4F sensitivity engine", () => {
  it("41/42. sensitivity changes exactly one selected variable; all other resolved inputs remain unchanged", () => {
    const def = scenarioDefinition("BASE");
    const baseResolved = resolveScenarioInputs(def);
    const points: SensitivityTestPoint[] = [
      { variable: "BASE_PAY_RATE", value: verifiedValue(usd(28)) },
      { variable: "BASE_PAY_RATE", value: verifiedValue(usd(32)) },
    ];
    const results = runSensitivity(def, points);
    for (const r of results) {
      expect(r.scenario.resolvedInputs.commercialTerms).toEqual(baseResolved.commercialTerms);
      expect(r.scenario.resolvedInputs.deployment).toEqual(baseResolved.deployment);
      expect(r.scenario.resolvedInputs.labor.overtimeMultiplier).toEqual(baseResolved.labor.overtimeMultiplier);
      expect(r.scenario.resolvedInputs.labor.workerPerDiem).toEqual(baseResolved.labor.workerPerDiem);
      expect(r.scenario.resolvedInputs.labor.burdenComponents).toEqual(baseResolved.labor.burdenComponents);
    }
    expect(results[0].scenario.resolvedInputs.labor.basePayRate).toEqual(verifiedValue(usd(28)));
    expect(results[1].scenario.resolvedInputs.labor.basePayRate).toEqual(verifiedValue(usd(32)));
  });

  it("43. caller-provided bill-rate values produce deterministic, monotonic outputs", () => {
    const results = runSensitivity(scenarioDefinition("BASE"), [80, 85, 90].map((v) => ({ variable: "BILL_RATE" as const, value: verifiedValue(usd(v)) })));
    const profits = results.map((r) => knownAmount(r.scenario.profitability.complete.grossProfit));
    expect(profits[0]).toBeLessThan(profits[1]);
    expect(profits[1]).toBeLessThan(profits[2]);
  });

  it("44. caller-provided base-pay values produce deterministic, monotonic outputs", () => {
    const results = runSensitivity(scenarioDefinition("BASE"), [28, 30, 32, 35].map((v) => ({ variable: "BASE_PAY_RATE" as const, value: verifiedValue(usd(v)) })));
    const profits = results.map((r) => knownAmount(r.scenario.profitability.complete.grossProfit));
    for (let i = 1; i < profits.length; i++) expect(profits[i]).toBeLessThan(profits[i - 1]);
  });

  it("45. caller-provided OT-hours values produce deterministic, monotonic outputs", () => {
    const results = runSensitivity(scenarioDefinition("BASE"), [0, 5, 10].map((v) => ({ variable: "OVERTIME_HOURS_PER_WEEK" as const, value: verifiedValue(v) })));
    const costs = results.map((r) => knownAmount(r.scenario.economics.labor.perWorkerPerWeek.completeEmployerCost));
    expect(costs[0]).toBeLessThan(costs[1]);
    expect(costs[1]).toBeLessThan(costs[2]);
  });

  it("46. caller-provided headcount values produce deterministic, proportional outputs", () => {
    const results = runSensitivity(scenarioDefinition("BASE"), [2, 4, 8].map((v) => ({ variable: "HEADCOUNT" as const, value: verifiedValue(v) })));
    const totals = results.map((r) => knownAmount(r.scenario.economics.labor.completeTotalWorkforcePerWeek));
    expect(totals[1]).toBeCloseTo(totals[0] * 2);
    expect(totals[2]).toBeCloseTo(totals[0] * 4);
  });

  it("47. caller-provided payment-terms values change 4E timing/working capital without changing 4D gross profit", () => {
    const results = runSensitivity(scenarioDefinition("BASE"), [0, 30, 60].map((v) => ({ variable: "PAYMENT_TERMS_DAYS" as const, value: verifiedValue(v) })));
    expect(results[0].scenario.profitability.complete.grossProfit).toEqual(results[1].scenario.profitability.complete.grossProfit);
    expect(results[1].scenario.profitability.complete.grossProfit).toEqual(results[2].scenario.profitability.complete.grossProfit);
    const wcRequirements = results.map((r) => {
      const wc = r.scenario.cashFlow.complete.workingCapital;
      if (wc.state !== "KNOWN") throw new Error("expected KNOWN working capital");
      return wc.value.workingCapitalRequirement.amount;
    });
    expect(wcRequirements[0]).toBeLessThanOrEqual(wcRequirements[1]);
    expect(wcRequirements[1]).toBeLessThanOrEqual(wcRequirements[2]);
  });

  it("48/49. sensitivity preserves the tested value's own fact tier, capping result certainty at the weakest required input", () => {
    const assumedResults = runSensitivity(scenarioDefinition("BASE"), [{ variable: "BASE_PAY_RATE", value: assumedValue(usd(32)) }]);
    expect(assumedResults[0].scenario.resolvedInputs.labor.basePayRate).toEqual(assumedValue(usd(32)));
    expect(assumedResults[0].scenario.economics.labor.perWorkerPerWeek.laborOnlyCost).toMatchObject({ tier: "OPERATOR_ASSUMPTION" });

    const weakBillRateDef = scenarioDefinition("BASE", { commercialTerms: { billRate: unverifiedSourcedValue(usd(85)) } });
    const results = runSensitivity(weakBillRateDef, [{ variable: "BASE_PAY_RATE", value: verifiedValue(usd(30)) }]);
    expect(results[0].scenario.profitability.complete.grossProfit).toMatchObject({ tier: "UNVERIFIED_SOURCED" });
  });

  it("50. unresolved non-zero per diem continues to block complete sensitivity results", () => {
    const results = runSensitivity(scenarioDefinition("BASE", { labor: { workerPerDiem: verifiedValue(usd(50)) } }), [{ variable: "BILL_RATE", value: verifiedValue(usd(90)) }]);
    expect(results[0].scenario.profitability.complete.grossProfit.state).toBe("UNAVAILABLE");
    expect(results[0].scenario.profitability.laborOnly.grossProfit.state).toBe("KNOWN");
  });

  it("51. different sensitivity points do not mutate the source scenario definition", () => {
    const def = scenarioDefinition("BASE");
    const before = JSON.stringify(def);
    runSensitivity(def, [{ variable: "BASE_PAY_RATE", value: verifiedValue(usd(999)) }, { variable: "BILL_RATE", value: verifiedValue(usd(1)) }]);
    expect(JSON.stringify(def)).toBe(before);
  });

  it("burden-component-rate sensitivity replaces exactly the named component's rate, leaving others untouched", () => {
    const components: BurdenComponent[] = [
      { type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] },
      { type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.1)), appliesTo: ["REGULAR_WAGES"] },
    ];
    const def = scenarioDefinition("BASE", { labor: { burdenComponents: components } });
    const results = runBurdenComponentRateSensitivity(def, [{ componentType: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.2)) }]);
    const resultComponents = results[0].scenario.resolvedInputs.labor.burdenComponents;
    expect(resultComponents.find((c) => c.type === "PAYROLL_TAX")?.rate).toEqual(verifiedValue(createRate(0.0765)));
    expect(resultComponents.find((c) => c.type === "WORKERS_COMPENSATION")?.rate).toEqual(verifiedValue(createRate(0.2)));
  });

  it("52/53/54. no automatic percentage steps, random values, or probability distributions are generated -- test points are used exactly as supplied", () => {
    const points: SensitivityTestPoint[] = [{ variable: "BILL_RATE", value: verifiedValue(usd(85)) }];
    const results = runSensitivity(scenarioDefinition("BASE"), points);
    expect(results[0].scenario.resolvedInputs.commercialTerms.billRate).toEqual(verifiedValue(usd(85))); // exactly the supplied value, no adjustment
    const resultsAgain = runSensitivity(scenarioDefinition("BASE"), points);
    expect(results[0].scenario.profitability.complete.grossProfit).toEqual(resultsAgain[0].scenario.profitability.complete.grossProfit); // deterministic, not random
  });
});

describe("4F classification and multi-context behavior", () => {
  it("55. PROFIT/BREAK_EVEN/LOSS classification derives strictly from gross-profit sign", () => {
    expect(classifyProfitability({ state: "KNOWN", tier: "VERIFIED", value: { amount: 100, currency: "USD" } })).toBe("PROFIT");
    expect(classifyProfitability({ state: "KNOWN", tier: "VERIFIED", value: { amount: 0, currency: "USD" } })).toBe("BREAK_EVEN");
    expect(classifyProfitability({ state: "KNOWN", tier: "VERIFIED", value: { amount: -50, currency: "USD" } })).toBe("LOSS");
    expect(classifyProfitability({ state: "UNKNOWN" })).toBeNull();
  });

  it("multi-context: an electrical/USD scenario and a welding/CAD scenario calculate independently with no hardcoded trade/currency", () => {
    const electrical = runScenario(scenarioDefinition("BASE", {
      labor: { basePayRate: verifiedValue(usd(35)), burdenComponents: [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.14)), appliesTo: ["REGULAR_WAGES"] }] },
      commercialTerms: { billRate: verifiedValue(usd(90)) },
    }));
    const welding = runScenario(scenarioDefinition("TARGET", {
      labor: { basePayRate: verifiedValue(createMoneyAmount(38, "CAD")), burdenComponents: [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.22)), appliesTo: ["REGULAR_WAGES"] }] },
      commercialTerms: { billRate: verifiedValue(createMoneyAmount(95, "CAD")) },
    }));
    expect(electrical.profitability.complete.grossProfit.state).toBe("KNOWN");
    expect(welding.profitability.complete.grossProfit.state).toBe("KNOWN");
    if (electrical.profitability.complete.grossProfit.state === "KNOWN") expect(electrical.profitability.complete.grossProfit.value.currency).toBe("USD");
    if (welding.profitability.complete.grossProfit.state === "KNOWN") expect(welding.profitability.complete.grossProfit.value.currency).toBe("CAD");
    expect(compareScenarios(electrical, welding).grossProfitDelta).toMatchObject({ state: "UNAVAILABLE" });
  });
});

describe("4F scope boundaries: no policy, no ranking, no persistence, no HOT/scoring logic", () => {
  it("39/40/56/57/58/59/60/61/62/63/64/65. the 4F engine source contains no winner/recommendation field, no composite score, no margin-quality threshold, no GO/NO-GO, no HOT/eligibility/scoring reference, no persistence/database access, no FX conversion, no Monte Carlo/probability logic, no opportunity ranking, and no loan/financing-product logic", () => {
    const domainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "domain");
    const sources = ["economics-scenario.ts", "scenario-engine.ts", "scenario-comparison.ts", "sensitivity-engine.ts"]
      .map((file) => readFileSync(join(domainDir, file), "utf-8"));

    const forbiddenPatterns = [
      /\bwinner\b/i, /\brecommend/i, /\bpreferred\b/i, /\bbest[_-]?scenario\b/i,
      /composite[_-]?score/i, /\bscenarioScore\b/i, /weighted[_-]?rank/i, /\butilityScore\b/i,
      /HIGH_MARGIN/, /LOW_MARGIN/, /GOOD_MARGIN/, /BAD_MARGIN/,
      /GO[_-]?NO[_-]?GO/i, /\bBID\b/, /NO[_-]?BID/i, /\bACCEPT\b/, /\bREJECT\b/,
      /minimum[_-]?margin/i, /maximum[_-]?working[_-]?capital/i, /profitability[_-]?threshold/i,
      /\bHOT\b/, /eligibility/i, /\bscoring\b/i, /economicsReady/i, /humanVerification/i,
      /supabase/i, /from ["'].*\/repositories?\//i, /from ["'].*\/server\//i,
      /MonteCarlo/i, /\bP10\b|\bP50\b|\bP90\b/, /confidenceInterval/i, /probability/i, /Math\.random/i,
      /\bLOAN\b/i, /\bINTEREST\b/i, /\bAPR\b/i, /FACTORING/i, /CREDIT[_-]?LINE/i, /BORROWING/i, /LENDER/i,
      /ranking/i, /rankOpportunit/i,
    ];

    for (const source of sources) {
      for (const pattern of forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});

/**
 * Phase 4F pre-commit composite-override correction. burdenComponents is the
 * one genuinely composite (collection-shaped) field reachable through the
 * four scenario override groups. These tests prove the corrected semantics:
 * `labor.burdenComponents` (if supplied) is an explicit WHOLE-COLLECTION
 * REPLACEMENT, while `burdenComponentRatePatches` is an explicit PATCH-BY-
 * IDENTITY mechanism that preserves every untouched component -- and that
 * the identity (component type) is used only when it is actually safe.
 */
describe("4F pre-commit composite-override correction", () => {
  it("CO1. an atomic scalar override still replaces the base value", () => {
    const resolved = resolveScenarioInputs(scenarioDefinition("BASE", { commercialTerms: { billRate: verifiedValue(usd(77)) } }));
    expect(resolved.commercialTerms.billRate).toEqual(verifiedValue(usd(77)));
  });

  it("CO2. an explicit UNKNOWN atomic scalar override still replaces a known base value", () => {
    const resolved = resolveScenarioInputs(scenarioDefinition("BASE", { commercialTerms: { billRate: unknownValue() } }));
    expect(resolved.commercialTerms.billRate).toEqual({ tier: "UNKNOWN" });
  });

  it("CO3/CO4/CO5. overriding one burden component via a rate patch preserves all unrelated components, uses the override value, and uses the override's own fact tier", () => {
    const components: BurdenComponent[] = [
      { type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] },
      { type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.1)), appliesTo: ["REGULAR_WAGES"] },
      { type: "BENEFITS", rate: verifiedValue(createRate(0.05)), appliesTo: ["REGULAR_WAGES"] },
    ];
    const def = scenarioDefinition("BASE", {
      labor: { burdenComponents: components },
      burdenComponentRatePatches: [{ componentType: "WORKERS_COMPENSATION", rate: assumedValue(createRate(0.2)) }],
    });
    const resolved = resolveScenarioInputs(def).labor.burdenComponents;
    expect(resolved).toHaveLength(3);
    expect(resolved.find((c) => c.type === "PAYROLL_TAX")?.rate).toEqual(verifiedValue(createRate(0.0765))); // preserved
    expect(resolved.find((c) => c.type === "BENEFITS")?.rate).toEqual(verifiedValue(createRate(0.05))); // preserved
    const patched = resolved.find((c) => c.type === "WORKERS_COMPENSATION");
    expect(patched?.rate).toEqual(assumedValue(createRate(0.2))); // override value AND override tier (OPERATOR_ASSUMPTION, not the base's VERIFIED)
  });

  it("CO6. a burden-component patch does not mutate the base burden collection", () => {
    const components: BurdenComponent[] = [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.1)), appliesTo: ["REGULAR_WAGES"] }];
    const before = JSON.stringify(components);
    applyBurdenComponentRatePatches(components, [{ componentType: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.2)) }]);
    expect(JSON.stringify(components)).toBe(before);
  });

  it("CO7. scenario resolution does not mutate the overrides.burdenComponentRatePatches collection", () => {
    const patches = [{ componentType: "WORKERS_COMPENSATION" as const, rate: verifiedValue(createRate(0.2)) }];
    const def = scenarioDefinition("BASE", {
      labor: { burdenComponents: [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.1)), appliesTo: ["REGULAR_WAGES"] }] },
      burdenComponentRatePatches: patches,
    });
    const before = JSON.stringify(patches);
    resolveScenarioInputs(def);
    expect(JSON.stringify(patches)).toBe(before);
  });

  it("CO8/CO9. sensitivity burden-component-rate overrides use the same canonical patch-by-identity semantics and change only the selected component", () => {
    const components: BurdenComponent[] = [
      { type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] },
      { type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.1)), appliesTo: ["REGULAR_WAGES"] },
    ];
    const def = scenarioDefinition("BASE", { labor: { burdenComponents: components } });
    const results = runBurdenComponentRateSensitivity(def, [{ componentType: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.25)) }]);
    const resolved = results[0].scenario.resolvedInputs.labor.burdenComponents;
    expect(resolved.find((c) => c.type === "PAYROLL_TAX")?.rate).toEqual(verifiedValue(createRate(0.0765))); // untouched
    expect(resolved.find((c) => c.type === "WORKERS_COMPENSATION")?.rate).toEqual(verifiedValue(createRate(0.25))); // changed
    // and nothing else about the resolved scenario changed
    const directPatchResult = resolveScenarioInputs({ ...def, overrides: { ...def.overrides, burdenComponentRatePatches: [{ componentType: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.25)) }] } });
    expect(results[0].scenario.resolvedInputs).toEqual(directPatchResult);
  });

  it("CO10. duplicate/same-type burden components cannot be accidentally overwritten through an unsafe type-only key -- the patch is explicitly refused", () => {
    const components: BurdenComponent[] = [
      { type: "OTHER", rate: verifiedValue(createRate(0.01)), appliesTo: ["REGULAR_WAGES"] },
      { type: "OTHER", rate: verifiedValue(createRate(0.02)), appliesTo: ["REGULAR_WAGES"] },
    ];
    const outcome = patchBurdenComponentRateByType(components, "OTHER", verifiedValue(createRate(0.5)));
    expect(outcome).toMatchObject({ outcome: "AMBIGUOUS_COMPONENT_TYPE", componentType: "OTHER", matchCount: 2 });
    // the collection is untouched -- no silent overwrite of either entry, no silent pick of "the first one"
    expect(components[0].rate).toEqual(verifiedValue(createRate(0.01)));
    expect(components[1].rate).toEqual(verifiedValue(createRate(0.02)));
    expect(() => applyBurdenComponentRatePatches(components, [{ componentType: "OTHER", rate: verifiedValue(createRate(0.5)) }])).toThrow(/ambiguous|share this type/i);
  });

  it("patching a component type that does not exist in the collection is explicitly refused, not silently added or ignored", () => {
    const components: BurdenComponent[] = [{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }];
    const outcome = patchBurdenComponentRateByType(components, "WORKERS_COMPENSATION", verifiedValue(createRate(0.1)));
    expect(outcome).toMatchObject({ outcome: "COMPONENT_NOT_FOUND", componentType: "WORKERS_COMPENSATION" });
    expect(() => applyBurdenComponentRatePatches(components, [{ componentType: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.1)) }])).toThrow(/no component of this type/i);
  });

  it("CO11. whole-collection replacement remains supported and is explicit -- supplying labor.burdenComponents replaces every prior component", () => {
    const original: BurdenComponent[] = [
      { type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] },
      { type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.1)), appliesTo: ["REGULAR_WAGES"] },
    ];
    const replacement: BurdenComponent[] = [{ type: "BENEFITS", rate: verifiedValue(createRate(0.03)), appliesTo: ["REGULAR_WAGES"] }];
    const def: ScenarioDefinition = {
      label: "BASE", baseLabor: laborInput({ burdenComponents: original }), baseCommercialTerms: commercialTerms(),
      baseDeployment: deployment(), baseCashFlowAssumptions: cashFlowAssumptions(),
      overrides: { labor: { burdenComponents: replacement } },
    };
    const resolved = resolveScenarioInputs(def).labor.burdenComponents;
    expect(resolved).toEqual(replacement); // PAYROLL_TAX and WORKERS_COMPENSATION are gone -- an intentional, explicit whole replacement
  });

  it("CO12. no generic recursive deep-merge machinery exists in the 4F scenario source", () => {
    const domainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "domain");
    const sources = ["economics-scenario.ts", "scenario-engine.ts", "sensitivity-engine.ts"].map((file) => readFileSync(join(domainDir, file), "utf-8"));
    for (const source of sources) {
      expect(source).not.toMatch(/deepMerge/i);
      expect(source).not.toMatch(/function\s+merge\s*\(/i);
      expect(source).not.toMatch(/lodash/i);
    }
  });

  it("CO13. other composite-shaped fields (discriminated unions) have documented atomic replacement semantics, not partial-field merging", () => {
    // overtimeBillBasis and duration are single discriminated-union values -- overriding one always replaces the whole {kind, ...} value together
    const resolvedBasis = resolveScenarioInputs(scenarioDefinition("BASE", { commercialTerms: { overtimeBillBasis: verifiedValue({ kind: "RATE", rate: usd(130) }) } }));
    expect(resolvedBasis.commercialTerms.overtimeBillBasis).toEqual(verifiedValue({ kind: "RATE", rate: usd(130) }));

    const resolvedDuration = resolveScenarioInputs(scenarioDefinition("BASE", { deployment: { duration: { kind: "OPEN_ENDED" } } }));
    expect(resolvedDuration.deployment.duration).toEqual({ kind: "OPEN_ENDED" });
  });

  it("CO14/CO15. existing scenario-resolution and UNKNOWN/partial-result tests remain green under the corrected semantics", () => {
    // re-assert two of the original resolution behaviors directly, proving the correction did not disturb them
    expect(resolveScenarioInputs(scenarioDefinition("BASE", { labor: { basePayRate: unknownValue() } })).labor.basePayRate).toEqual({ tier: "UNKNOWN" });
    const result = runScenario(scenarioDefinition("BASE", { commercialTerms: { paymentTerms: unknownValue() } }));
    expect(result.profitability.complete.grossProfit.state).toBe("KNOWN");
    expect(result.cashFlow.complete.workingCapital.state).toBe("UNKNOWN");
  });

  it("CO16. when no composite override is used, 4D/4E outputs remain byte-identical to a direct certified-engine call, unaffected by the correction", () => {
    const def = scenarioDefinition("BASE");
    const resolved = resolveScenarioInputs(def);
    const directEconomics = evaluateCommercialEconomics(resolved.labor, resolved.commercialTerms, resolved.deployment);
    const directCashFlow = evaluateCashFlow(directEconomics.labor, directEconomics.billing, resolved.deployment, resolved.commercialTerms, resolved.cashFlowAssumptions);
    const result = runScenario(def);
    expect(result.economics).toEqual(directEconomics);
    expect(result.cashFlow).toEqual(directCashFlow);
  });
});
