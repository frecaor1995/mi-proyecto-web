import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BURDEN_WAGE_PORTIONS, type BurdenComponent, burdenTierFor, totalBurdenRateFor,
} from "../../domain/burden-profile";
import {
  addMoney, assumedValue, COMMON_PAYMENT_TERMS, createMoneyAmount, createPaymentTerms, createRate,
  createSignedRate, type DeploymentDuration, deriveEconomicResult, ECONOMIC_FACT_TIERS,
  grossMarginPercent, grossProfitPerHour, laborCostPerHour, percentageToDecimalFraction,
  SCENARIO_LABELS, subtractMoney, unknownValue, unverifiedSourcedValue, verifiedValue,
  weakestNonUnknownTier, weakestTier,
} from "../../domain/commercial-economics";

describe("3I-Phase 4B money model", () => {
  it("1. money always has an explicit currency", () => {
    const money = createMoneyAmount(42.5, "USD");
    expect(money.currency).toBe("USD");
    expect(() => createMoneyAmount(10, "")).toThrow();
    expect(() => createMoneyAmount(10, "us")).toThrow();
    expect(() => createMoneyAmount(10, "USDX")).toThrow();
  });

  it("does not assume USD -- any ISO-4217-shaped code is accepted", () => {
    expect(createMoneyAmount(10, "CAD").currency).toBe("CAD");
    expect(createMoneyAmount(10, "MXN").currency).toBe("MXN");
  });

  it("2. zero money is distinguishable from UNKNOWN", () => {
    const zero = verifiedValue(createMoneyAmount(0, "USD"));
    const unknown = unknownValue<ReturnType<typeof createMoneyAmount>>();
    expect(zero.tier).not.toBe("UNKNOWN");
    if (zero.tier !== "UNKNOWN") expect(zero.value.amount).toBe(0);
    expect(unknown.tier).toBe("UNKNOWN");
    expect("value" in unknown).toBe(false);
  });

  it("rejects negative money amounts -- no exception authorized in 4B", () => {
    expect(() => createMoneyAmount(-1, "USD")).toThrow();
  });

  it("3. currency mismatch cannot silently calculate (add/subtract)", () => {
    const usd = createMoneyAmount(100, "USD");
    const cad = createMoneyAmount(100, "CAD");
    expect(addMoney(usd, cad)).toEqual({ outcome: "CURRENCY_MISMATCH", currencies: ["USD", "CAD"] });
    expect(subtractMoney(usd, cad)).toEqual({ outcome: "CURRENCY_MISMATCH", currencies: ["USD", "CAD"] });
    expect(addMoney(usd, createMoneyAmount(50, "USD"))).toEqual({ outcome: "OK", result: { amount: 150, currency: "USD" } });
  });

  it("22. USD+USD and CAD+CAD are permitted; USD+CAD is blocked with no FX invented", () => {
    expect(addMoney(createMoneyAmount(10, "USD"), createMoneyAmount(5, "USD")).outcome).toBe("OK");
    expect(addMoney(createMoneyAmount(10, "CAD"), createMoneyAmount(5, "CAD")).outcome).toBe("OK");
    expect(addMoney(createMoneyAmount(10, "USD"), createMoneyAmount(5, "CAD")).outcome).toBe("CURRENCY_MISMATCH");
  });

  it("3b. currency mismatch blocks derived calculations too (gross profit / margin)", () => {
    const revenue = verifiedValue(createMoneyAmount(100, "USD"));
    const cost = verifiedValue(createMoneyAmount(60, "CAD"));
    expect(grossProfitPerHour(revenue, cost)).toEqual({ state: "UNAVAILABLE", reason: "Currency mismatch between revenue and cost" });
    expect(grossMarginPercent(revenue, cost).state).toBe("UNAVAILABLE");
  });
});

describe("4B rate / percentage convention", () => {
  it("4. canonical percentages use decimal fractions, never mixed with raw percent numbers", () => {
    expect(createRate(0.25).value).toBe(0.25);
    expect(createRate(1.5).value).toBe(1.5); // 150% OT multiplier is a valid Rate
    expect(percentageToDecimalFraction(25)).toBe(0.25);
    expect(percentageToDecimalFraction(7.65)).toBeCloseTo(0.0765);
  });

  it("rejects negative rates", () => {
    expect(() => createRate(-0.1)).toThrow();
  });

  it("margin (a signed rate) can legitimately be negative for a loss, unlike Rate", () => {
    expect(createSignedRate(-0.15).value).toBe(-0.15);
  });
});

describe("4B economic fact tier", () => {
  it("5. OPERATOR_ASSUMPTION can never be represented as VERIFIED", () => {
    const assumption = assumedValue(createMoneyAmount(50, "USD"));
    expect(assumption.tier).toBe("OPERATOR_ASSUMPTION");
    expect(assumption.tier).not.toBe("VERIFIED");
    // Structural guarantee: there is no exported coercion from one tier constructor's output to another's shape.
    expect(ECONOMIC_FACT_TIERS).toEqual(["VERIFIED", "UNVERIFIED_SOURCED", "OPERATOR_ASSUMPTION", "UNKNOWN"]);
  });

  it("reconciles with, but does not replace, existing trust vocabularies -- EconomicFactTier is economics-only vocabulary", () => {
    // VerificationState (UNVERIFIED/VERIFIED/REJECTED/STALE) is a different, untouched vocabulary; this only asserts
    // EconomicFactTier's own member set is exactly the approved four values, no more, no fewer.
    expect(ECONOMIC_FACT_TIERS).toHaveLength(4);
  });

  it("6. an UNKNOWN required input prevents a numeric result from ever being produced", () => {
    let computeCalled = false;
    const result = deriveEconomicResult([unknownValue<number>()], () => { computeCalled = true; return 42; });
    expect(result).toEqual({ state: "UNKNOWN" });
    expect(computeCalled).toBe(false);
  });

  it("7. derived tier can never exceed (be stronger than) the weakest contributing input", () => {
    expect(weakestTier(["VERIFIED", "VERIFIED"])).toBe("VERIFIED");
    expect(weakestTier(["VERIFIED", "UNVERIFIED_SOURCED"])).toBe("UNVERIFIED_SOURCED");
    expect(weakestTier(["VERIFIED", "OPERATOR_ASSUMPTION"])).toBe("OPERATOR_ASSUMPTION");
    expect(weakestTier(["UNVERIFIED_SOURCED", "OPERATOR_ASSUMPTION"])).toBe("OPERATOR_ASSUMPTION");
    expect(weakestTier(["VERIFIED", "UNKNOWN"])).toBe("UNKNOWN");
    expect(weakestNonUnknownTier(["VERIFIED", "UNVERIFIED_SOURCED"])).toBe("UNVERIFIED_SOURCED");

    // End-to-end: a VERIFIED bill rate but an OPERATOR_ASSUMPTION burden must never yield a VERIFIED margin.
    const revenue = verifiedValue(createMoneyAmount(100, "USD"));
    const payRate = verifiedValue(createMoneyAmount(40, "USD"));
    const assumedBurden: BurdenComponent[] = [{ type: "WORKERS_COMPENSATION", rate: assumedValue(createRate(0.2)), appliesTo: ["REGULAR_WAGES"] }];
    const cost = laborCostPerHour(payRate, assumedBurden, "REGULAR_WAGES");
    expect(cost.state).toBe("KNOWN");
    if (cost.state === "KNOWN") expect(cost.tier).toBe("OPERATOR_ASSUMPTION");
    if (cost.state === "KNOWN") {
      const margin = grossMarginPercent(revenue, { tier: "OPERATOR_ASSUMPTION", value: cost.value });
      expect(margin.state).toBe("KNOWN");
      if (margin.state === "KNOWN") expect(margin.tier).toBe("OPERATOR_ASSUMPTION");
    }
  });
});

describe("4B scenario model", () => {
  it("8. BASE/CONSERVATIVE/TARGET are labels, not trust states", () => {
    expect(SCENARIO_LABELS).toEqual(["BASE", "CONSERVATIVE", "TARGET"]);
    for (const label of SCENARIO_LABELS) expect(ECONOMIC_FACT_TIERS as readonly string[]).not.toContain(label);
    for (const tier of ECONOMIC_FACT_TIERS) expect(SCENARIO_LABELS as readonly string[]).not.toContain(tier);
  });

  it("a TARGET scenario can mix VERIFIED, UNVERIFIED_SOURCED, OPERATOR_ASSUMPTION, and UNKNOWN inputs simultaneously, each retaining its own tier", () => {
    const billRate = verifiedValue(createMoneyAmount(85, "USD"));
    const overtimeMultiplier = unverifiedSourcedValue(createRate(1.5));
    const perDiem = assumedValue(createMoneyAmount(75, "USD"));
    const paymentTerms = unknownValue<ReturnType<typeof createPaymentTerms>>();
    expect(billRate.tier).toBe("VERIFIED");
    expect(overtimeMultiplier.tier).toBe("UNVERIFIED_SOURCED");
    expect(perDiem.tier).toBe("OPERATOR_ASSUMPTION");
    expect(paymentTerms.tier).toBe("UNKNOWN");
  });
});

describe("4B commercial terms / payment terms / billing cadence", () => {
  it("9. payment terms support arbitrary valid day counts, not only 15/30/45/60", () => {
    expect(createPaymentTerms(7).days).toBe(7);
    expect(createPaymentTerms(90).days).toBe(90);
    expect(createPaymentTerms(21).days).toBe(21);
    expect(COMMON_PAYMENT_TERMS.NET_30).toBe(30);
  });

  it("rejects invalid payment-terms day counts", () => {
    expect(() => createPaymentTerms(-1)).toThrow();
    expect(() => createPaymentTerms(1.5)).toThrow();
    expect(() => createPaymentTerms(1000)).toThrow();
  });
});

describe("4B deployment / duration model", () => {
  it("10. open-ended duration is structurally distinct from zero and from unknown duration", () => {
    const openEnded: DeploymentDuration = { kind: "OPEN_ENDED" };
    const zeroWeeks: DeploymentDuration = { kind: "FIXED", weeks: 0 };
    const unknown: DeploymentDuration = { kind: "UNKNOWN" };
    expect(openEnded).not.toEqual(zeroWeeks);
    expect(openEnded).not.toEqual(unknown);
    expect(zeroWeeks).not.toEqual(unknown);
    expect(openEnded.kind).toBe("OPEN_ENDED");
  });
});

describe("4B burden component model", () => {
  const components: BurdenComponent[] = [
    { type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"] },
    { type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.12)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION"] },
    { type: "GENERAL_LIABILITY", rate: verifiedValue(createRate(0.03)), appliesTo: ["REGULAR_WAGES"] },
  ];

  it("11. burden components remain distinct and composable", () => {
    expect(BURDEN_WAGE_PORTIONS).toEqual(["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"]);
    const regular = totalBurdenRateFor(components, "REGULAR_WAGES");
    expect(regular.state).toBe("KNOWN");
    if (regular.state === "KNOWN") expect(regular.value.value).toBeCloseTo(0.0765 + 0.12 + 0.03);
  });

  it("12. OT premium applicability can be represented per burden component, and differs from regular wages", () => {
    const premium = totalBurdenRateFor(components, "OVERTIME_PREMIUM_PORTION");
    expect(premium.state).toBe("KNOWN");
    if (premium.state === "KNOWN") expect(premium.value.value).toBeCloseTo(0.0765); // only payroll tax applies to the OT premium in this fixture
    const regular = totalBurdenRateFor(components, "REGULAR_WAGES");
    expect(premium).not.toEqual(regular);
  });

  it("an UNKNOWN burden component rate blocks the total rather than silently omitting it", () => {
    const withUnknown: BurdenComponent[] = [...components, { type: "BENEFITS", rate: unknownValue(), appliesTo: ["REGULAR_WAGES"] }];
    expect(totalBurdenRateFor(withUnknown, "REGULAR_WAGES")).toEqual({ state: "UNKNOWN" });
    expect(burdenTierFor(withUnknown, "REGULAR_WAGES")).toBe("UNKNOWN");
  });

  it("13. no default regulatory/payroll/workers-comp/benefits rate is introduced by this domain module", async () => {
    for (const file of ["src/domain/burden-profile.ts", "src/domain/commercial-economics.ts", "src/domain/commercial-terms.ts", "src/domain/economic-value.ts"]) {
      const source = await readFile(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/DEFAULT_(BURDEN|WORKERS_COMP|PAYROLL_TAX|BENEFITS|GENERAL_LIABILITY)_RATE/);
      expect(source).not.toMatch(/0\.062\b|0\.0145\b|6\.2%|1\.45%/); // common real FICA figures -- must never appear as a hardcoded default
    }
  });
});

describe("4B multi-trade / multi-company review", () => {
  it("14. the domain model works identically across different trades, occupations, and jurisdictions -- no hardcoded company/location", () => {
    const electricalBurden: BurdenComponent[] = [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.14)), appliesTo: ["REGULAR_WAGES"] }];
    const weldingBurden: BurdenComponent[] = [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.22)), appliesTo: ["REGULAR_WAGES"] }];
    const electricalCost = laborCostPerHour(verifiedValue(createMoneyAmount(35, "USD")), electricalBurden, "REGULAR_WAGES");
    const weldingCost = laborCostPerHour(verifiedValue(createMoneyAmount(38, "USD")), weldingBurden, "REGULAR_WAGES");
    expect(electricalCost.state).toBe("KNOWN");
    expect(weldingCost.state).toBe("KNOWN");
    if (electricalCost.state === "KNOWN" && weldingCost.state === "KNOWN") {
      expect(electricalCost.value.amount).not.toBe(weldingCost.value.amount); // distinct trades, distinct comp rates, distinct results -- nothing hardcoded to one trade
    }
  });
});
