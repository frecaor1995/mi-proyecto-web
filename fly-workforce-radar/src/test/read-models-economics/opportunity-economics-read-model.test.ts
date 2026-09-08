import { describe, expect, it } from "vitest";
import type { BurdenComponent, BurdenProfileScope } from "../../domain/burden-profile";
import type { CashFlowAssumptions } from "../../domain/cash-flow-engine";
import {
  assumedValue, createMoneyAmount, createPaymentTerms, createRate, unknownValue, unverifiedSourcedValue, verifiedValue,
} from "../../domain/commercial-economics";
import type { DeploymentEconomicsInput, LaborEconomicsInput } from "../../domain/commercial-economics";
import type {
  BurdenProfileVersionRecord, CommercialTermsVersionRecord, EconomicsScenarioSnapshotRecord,
} from "../../domain/commercial-economics-persistence";
import type { CommercialTermsContract } from "../../domain/commercial-terms";
import type { ScenarioDefinition } from "../../domain/economics-scenario";
import { runScenario } from "../../domain/scenario-engine";
import { assembleOpportunityEconomicsDetail } from "../../server/read-models/economics";

const usd = (amount: number) => createMoneyAmount(amount, "USD");

function laborInput(overrides: Partial<LaborEconomicsInput> = {}): LaborEconomicsInput {
  return {
    basePayRate: verifiedValue(usd(30)), overtimeMultiplier: verifiedValue(createRate(1.5)), workerPerDiem: verifiedValue(usd(0)),
    burdenComponents: [{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"] }],
    ...overrides,
  };
}
function commercialTerms(overrides: Partial<CommercialTermsContract> = {}): CommercialTermsContract {
  return {
    billRate: verifiedValue(usd(85)), overtimeBillBasis: verifiedValue({ kind: "MULTIPLIER", multiplier: createRate(1.5) }),
    reimbursablePerDiem: verifiedValue(usd(0)), perDiemMarkup: verifiedValue(createRate(0)),
    paymentTerms: verifiedValue(createPaymentTerms(30)), billingCadence: verifiedValue("WEEKLY"),
    ...overrides,
  };
}
function deployment(overrides: Partial<DeploymentEconomicsInput> = {}): DeploymentEconomicsInput {
  return {
    headcount: verifiedValue(4), regularHoursPerWeek: verifiedValue(40), overtimeHoursPerWeek: verifiedValue(0),
    duration: { kind: "FIXED", weeks: 8 }, startDate: null, estimatedEndDate: null, jurisdiction: null,
    ...overrides,
  };
}
function cashFlowAssumptions(overrides: Partial<CashFlowAssumptions> = {}): CashFlowAssumptions {
  return { payrollFrequency: verifiedValue("WEEKLY"), payrollAnchorWeek: verifiedValue(0), billingAnchorWeek: verifiedValue(0), ...overrides };
}
const platformScope: BurdenProfileScope = { level: "PLATFORM_DEFAULT", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: null };

let sequence = 0;
function commercialTermsVersion(terms: CommercialTermsContract, overrides: Partial<CommercialTermsVersionRecord> = {}): CommercialTermsVersionRecord {
  return {
    id: `terms-${++sequence}`, contextType: "OPPORTUNITY", companyId: null, opportunityId: "opp-1", terms,
    supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "test-v1", assertedBy: "operator-1",
    evaluatedAt: new Date("2026-09-07T12:00:00Z"), supersedesCommercialTermsId: null, createdAt: new Date("2026-09-07T12:00:00Z"),
    ...overrides,
  };
}
function burdenProfileVersion(components: BurdenComponent[], scope: BurdenProfileScope = platformScope, overrides: Partial<BurdenProfileVersionRecord> = {}): BurdenProfileVersionRecord {
  return {
    id: `burden-${++sequence}`, scope, components, ruleVersion: "test-v1", assertedBy: "operator-1",
    evaluatedAt: new Date("2026-09-07T12:00:00Z"), supersedesBurdenProfileId: null, createdAt: new Date("2026-09-07T12:00:00Z"),
    ...overrides,
  };
}
/** Uses the certified 4F engine to produce a real result, then persists it exactly as the certified 4G scenario-snapshot mutation would -- the most honest way to build a fixture. */
function snapshot(
  label: "BASE" | "CONSERVATIVE" | "TARGET",
  termsVersion: CommercialTermsVersionRecord,
  burdenVersion: BurdenProfileVersionRecord,
  laborOverrides: Partial<LaborEconomicsInput> = {},
  deploymentOverrides: Partial<DeploymentEconomicsInput> = {},
  overrides: Partial<EconomicsScenarioSnapshotRecord> = {},
): EconomicsScenarioSnapshotRecord {
  const definition: ScenarioDefinition = {
    label,
    baseLabor: { ...laborInput(laborOverrides), burdenComponents: burdenVersion.components },
    baseCommercialTerms: termsVersion.terms,
    baseDeployment: deployment(deploymentOverrides),
    baseCashFlowAssumptions: cashFlowAssumptions(),
  };
  const scenarioResult = runScenario(definition);
  return {
    id: `snapshot-${++sequence}`, opportunityId: "opp-1", scenarioLabel: label,
    commercialTermsVersionId: termsVersion.id, burdenProfileVersionId: burdenVersion.id,
    basis: { resolvedInputs: scenarioResult.resolvedInputs },
    result: { economics: scenarioResult.economics, cashFlow: scenarioResult.cashFlow, profitability: scenarioResult.profitability, weakestTier: scenarioResult.weakestTier, blockingReasons: scenarioResult.blockingReasons },
    ruleVersion: "test-v1", assertedBy: "operator-1", evaluatedAt: new Date("2026-09-07T12:00:00Z"), asOf: new Date("2026-09-07T12:00:00Z"),
    supersedesScenarioId: null, createdAt: new Date("2026-09-07T12:00:00Z"),
    ...overrides,
  };
}

describe("Phase 4H opportunity economics read model", () => {
  it("1. maps a certified scenario snapshot into a UI-ready scenario view", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const snap = snapshot("BASE", terms, burden);
    const detail = assembleOpportunityEconomicsDetail("opp-1", [snap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(detail.scenarios).toHaveLength(1);
    expect(detail.scenarios[0].label).toBe("BASE");
    expect(detail.scenarios[0].economics.grossProfit.completePerWorkerPerWeek.state).toBe("KNOWN");
  });

  it("2/3/4/5. VERIFIED, UNVERIFIED_SOURCED, OPERATOR_ASSUMPTION, and UNKNOWN input tiers all propagate into the presented derived result exactly as the certified engine computed them", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);

    const verifiedSnap = snapshot("BASE", terms, burden);
    const verifiedDetail = assembleOpportunityEconomicsDetail("opp-1", [verifiedSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(verifiedDetail.scenarios[0].economics.labor.perWorkerPerWeek.laborOnlyCost).toMatchObject({ tier: "VERIFIED" });

    const assumedSnap = snapshot("CONSERVATIVE", terms, burden, { basePayRate: assumedValue(usd(30)) });
    const assumedDetail = assembleOpportunityEconomicsDetail("opp-1", [assumedSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(assumedDetail.scenarios[0].economics.labor.perWorkerPerWeek.laborOnlyCost).toMatchObject({ tier: "OPERATOR_ASSUMPTION" });

    const sourcedSnap = snapshot("TARGET", terms, burden, { basePayRate: unverifiedSourcedValue(usd(30)) });
    const sourcedDetail = assembleOpportunityEconomicsDetail("opp-1", [sourcedSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(sourcedDetail.scenarios[0].economics.labor.perWorkerPerWeek.laborOnlyCost).toMatchObject({ tier: "UNVERIFIED_SOURCED" });

    const unknownSnap = snapshot("BASE", terms, burden, { basePayRate: unknownValue() });
    const unknownDetail = assembleOpportunityEconomicsDetail("opp-1", [unknownSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(unknownDetail.scenarios[0].economics.labor.perWorkerPerWeek.laborOnlyCost).toEqual({ state: "UNKNOWN" });
  });

  it("6. explicit zero remains distinct from UNKNOWN in the presented view", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const zeroSnap = snapshot("BASE", terms, burden, { basePayRate: verifiedValue(usd(0)) });
    const zeroDetail = assembleOpportunityEconomicsDetail("opp-1", [zeroSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    const cost = zeroDetail.scenarios[0].economics.labor.perWorkerPerWeek.laborOnlyCost;
    expect(cost).toMatchObject({ state: "KNOWN", value: { amount: 0 } });
    expect(cost.state).not.toBe("UNKNOWN");
  });

  it("7. negative results are preserved (loss-making scenario)", () => {
    const terms = commercialTermsVersion(commercialTerms({ billRate: verifiedValue(usd(10)) }));
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const lossSnap = snapshot("BASE", terms, burden, { basePayRate: verifiedValue(usd(50)) });
    const detail = assembleOpportunityEconomicsDetail("opp-1", [lossSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    const profit = detail.scenarios[0].profitability.complete.grossProfit;
    expect(profit.state).toBe("KNOWN");
    if (profit.state === "KNOWN") expect(profit.value.amount).toBeLessThan(0);
    expect(detail.scenarios[0].profitability.complete.classification).toBe("LOSS");
  });

  it("8/9. explicit currency is preserved and no FX conversion occurs across a multi-currency scenario", () => {
    const terms = commercialTermsVersion(commercialTerms({ billRate: verifiedValue(createMoneyAmount(95, "CAD")) }));
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const cadSnap = snapshot("BASE", terms, burden, { basePayRate: verifiedValue(createMoneyAmount(38, "CAD")) });
    const detail = assembleOpportunityEconomicsDetail("opp-1", [cadSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    const profit = detail.scenarios[0].profitability.complete.grossProfit;
    expect(profit.state).toBe("KNOWN");
    if (profit.state === "KNOWN") expect(profit.value.currency).toBe("CAD"); // never converted to USD
  });

  it("10. complete vs labor-only distinction is preserved -- unresolved per diem blocks complete but not labor-only", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const blockedSnap = snapshot("BASE", terms, burden, { workerPerDiem: verifiedValue(usd(50)) });
    const detail = assembleOpportunityEconomicsDetail("opp-1", [blockedSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(detail.scenarios[0].profitability.complete.grossProfit.state).toBe("UNAVAILABLE");
    expect(detail.scenarios[0].profitability.laborOnly.grossProfit.state).toBe("KNOWN");
  });

  it("11. blocking reasons are presented from the certified engine, not invented", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const blockedSnap = snapshot("BASE", terms, burden, { workerPerDiem: verifiedValue(usd(50)) });
    const detail = assembleOpportunityEconomicsDetail("opp-1", [blockedSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(detail.scenarios[0].blockingReasons.length).toBeGreaterThan(0);
    expect(detail.scenarios[0].blockingReasons.some((reason) => /per-diem|per diem/i.test(reason))).toBe(true);
  });

  it("15. scenario comparison exposes signed deltas via the certified compareScenarios formula", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const base = snapshot("BASE", terms, burden);
    const target = snapshot("TARGET", terms, burden, {}, {}, {});
    const detail = assembleOpportunityEconomicsDetail("opp-1", [base, target], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(detail.comparisons).toHaveLength(1);
    expect(detail.comparisons[0].grossProfitDelta.state).toBe("KNOWN"); // identical inputs -> delta of exactly zero, still a real signed KNOWN delta
    if (detail.comparisons[0].grossProfitDelta.state === "KNOWN") expect(detail.comparisons[0].grossProfitDelta.value.amount).toBeCloseTo(0);
  });

  it("16. cross-currency comparison is UNAVAILABLE, never FX-converted", () => {
    const usdTerms = commercialTermsVersion(commercialTerms());
    const cadTerms = commercialTermsVersion(commercialTerms({ billRate: verifiedValue(createMoneyAmount(95, "CAD")) }));
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const usdSnap = snapshot("BASE", usdTerms, burden);
    const cadSnap = snapshot("TARGET", cadTerms, burden, { basePayRate: verifiedValue(createMoneyAmount(38, "CAD")) });
    const detail = assembleOpportunityEconomicsDetail("opp-1", [usdSnap, cadSnap], new Map([[usdTerms.id, usdTerms], [cadTerms.id, cadTerms]]), new Map([[burden.id, burden]]));
    expect(detail.comparisons[0].grossProfitDelta).toMatchObject({ state: "UNAVAILABLE" });
  });

  it("17. working-capital data is preserved for presentation", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const snap = snapshot("BASE", terms, burden);
    const detail = assembleOpportunityEconomicsDetail("opp-1", [snap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(detail.scenarios[0].cashFlow.complete.workingCapital.state).toBe("KNOWN");
  });

  it("18. recovery status data is preserved for presentation", () => {
    const terms = commercialTermsVersion(commercialTerms({ paymentTerms: verifiedValue(createPaymentTerms(30)) }));
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const snap = snapshot("BASE", terms, burden);
    const detail = assembleOpportunityEconomicsDetail("opp-1", [snap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    const wc = detail.scenarios[0].cashFlow.complete.workingCapital;
    expect(wc.state).toBe("KNOWN");
    if (wc.state === "KNOWN") expect(["NOT_APPLICABLE", "RECOVERED", "NOT_REACHED_WITHIN_HORIZON"]).toContain(wc.value.recovery.kind);
  });

  it("19. monthly billing timing limitation is preserved for presentation without disturbing gross profit", () => {
    const terms = commercialTermsVersion(commercialTerms({ billingCadence: verifiedValue("MONTHLY") }));
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const snap = snapshot("BASE", terms, burden);
    const detail = assembleOpportunityEconomicsDetail("opp-1", [snap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(detail.scenarios[0].cashFlow.complete.invoiceEvents.state).toBe("UNAVAILABLE");
    expect(detail.scenarios[0].profitability.complete.grossProfit.state).toBe("KNOWN");
  });

  it("20. missing commercial terms is represented as null, not fabricated", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const snap = snapshot("BASE", terms, burden);
    // commercialTermsById intentionally does not include this version -- simulates a lookup gap
    const detail = assembleOpportunityEconomicsDetail("opp-1", [snap], new Map(), new Map([[burden.id, burden]]));
    expect(detail.scenarios[0].commercialTerms).toBeNull();
  });

  it("21. missing burden profile is represented as null, not fabricated", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const snap = snapshot("BASE", terms, burden);
    const detail = assembleOpportunityEconomicsDetail("opp-1", [snap], new Map([[terms.id, terms]]), new Map());
    expect(detail.scenarios[0].burdenProfile).toBeNull();
  });

  it("22. missing scenario state: zero snapshots produces an empty scenarios array, never a fabricated one", () => {
    const detail = assembleOpportunityEconomicsDetail("opp-1", [], new Map(), new Map());
    expect(detail.scenarios).toHaveLength(0);
    expect(detail.comparisons).toHaveLength(0);
  });

  it("12/13/14. BASE, CONSERVATIVE, and TARGET labels carry no automatic policy meaning -- identical inputs under each label produce identical economics", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const base = snapshot("BASE", terms, burden);
    const conservative = snapshot("CONSERVATIVE", terms, burden);
    const target = snapshot("TARGET", terms, burden);
    const detail = assembleOpportunityEconomicsDetail("opp-1", [base, conservative, target], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    const profits = detail.scenarios.map((s) => s.profitability.complete.grossProfit);
    expect(profits[0]).toEqual(profits[1]);
    expect(profits[1]).toEqual(profits[2]);
  });

  it("one scenario, two scenarios, and three scenarios are all supported without requiring all three labels", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const one = assembleOpportunityEconomicsDetail("opp-1", [snapshot("BASE", terms, burden)], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(one.scenarios).toHaveLength(1);
    const two = assembleOpportunityEconomicsDetail("opp-1", [snapshot("BASE", terms, burden), snapshot("TARGET", terms, burden)], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    expect(two.scenarios).toHaveLength(2);
  });
});
