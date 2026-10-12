import { createPaymentTerms } from "./commercial-economics";
import type { EconomicValue, MoneyAmount, Rate } from "./economic-value";
import type { BurdenComponentRatePatch, ScenarioDefinition, ScenarioOverrides } from "./economics-scenario";
import type { ScenarioComparison } from "./scenario-comparison";
import { compareScenarios } from "./scenario-comparison";
import type { ScenarioResult } from "./scenario-engine";
import { runScenario } from "./scenario-engine";

/**
 * Phase 4F. Bounded, deterministic, one-variable-at-a-time sensitivity
 * analysis. Not a stochastic simulation, not an optimizer (mandate section
 * 30). Every test value is caller-supplied and carries its own explicit fact
 * tier -- this module never invents +/-5%/10%/20% steps, never generates a
 * random value, and never draws from a statistical distribution.
 * Each point re-runs the certified scenario engine (which itself composes
 * the certified 4D/4E engines) with exactly one field overridden; every
 * other resolved input is left exactly as the base scenario defines it.
 */

export type SensitivityTestPoint =
  | { readonly variable: "BASE_PAY_RATE"; readonly value: EconomicValue<MoneyAmount> }
  | { readonly variable: "BILL_RATE"; readonly value: EconomicValue<MoneyAmount> }
  | { readonly variable: "REGULAR_HOURS_PER_WEEK"; readonly value: EconomicValue<number> }
  | { readonly variable: "OVERTIME_HOURS_PER_WEEK"; readonly value: EconomicValue<number> }
  | { readonly variable: "OVERTIME_MULTIPLIER"; readonly value: EconomicValue<Rate> }
  | { readonly variable: "HEADCOUNT"; readonly value: EconomicValue<number> }
  | { readonly variable: "PAYMENT_TERMS_DAYS"; readonly value: EconomicValue<number> }
  | { readonly variable: "FIXED_DURATION_WEEKS"; readonly value: EconomicValue<number> };

/** Folds one test point into a ScenarioOverrides patch, touching exactly one certified field. Every field here is atomic (see economics-scenario.ts) -- none of these variables is the composite burdenComponents collection, which has its own dedicated runBurdenComponentRateSensitivity below. */
export function applySensitivityOverride(base: ScenarioOverrides, point: SensitivityTestPoint): ScenarioOverrides {
  switch (point.variable) {
    case "BASE_PAY_RATE":
      return { ...base, labor: { ...base.labor, basePayRate: point.value } };
    case "BILL_RATE":
      return { ...base, commercialTerms: { ...base.commercialTerms, billRate: point.value } };
    case "REGULAR_HOURS_PER_WEEK":
      return { ...base, deployment: { ...base.deployment, regularHoursPerWeek: point.value } };
    case "OVERTIME_HOURS_PER_WEEK":
      return { ...base, deployment: { ...base.deployment, overtimeHoursPerWeek: point.value } };
    case "OVERTIME_MULTIPLIER":
      return { ...base, labor: { ...base.labor, overtimeMultiplier: point.value } };
    case "HEADCOUNT":
      return { ...base, deployment: { ...base.deployment, headcount: point.value } };
    case "PAYMENT_TERMS_DAYS":
      if (point.value.tier === "UNKNOWN") return { ...base, commercialTerms: { ...base.commercialTerms, paymentTerms: { tier: "UNKNOWN" } } };
      return { ...base, commercialTerms: { ...base.commercialTerms, paymentTerms: { tier: point.value.tier, value: createPaymentTerms(point.value.value) } } };
    case "FIXED_DURATION_WEEKS":
      if (point.value.tier === "UNKNOWN") return { ...base, deployment: { ...base.deployment, duration: { kind: "UNKNOWN" } } };
      return { ...base, deployment: { ...base.deployment, duration: { kind: "FIXED", weeks: point.value.value } } };
  }
}

export interface SensitivityPointResult {
  readonly testPoint: SensitivityTestPoint;
  readonly scenario: ScenarioResult;
  /** Present only when a referenceIndex was supplied to runSensitivity -- descriptive only, never labeled good/bad (mandate section 35). */
  readonly deltaFromReference: ScenarioComparison | null;
}

/**
 * Runs one scenario per test point, each with exactly the named variable
 * overridden on top of `definition`'s own overrides (never mutating
 * `definition` itself). If `referenceIndex` is supplied, each point's
 * scenario is compared against the scenario at that index.
 */
export function runSensitivity(
  definition: ScenarioDefinition,
  testPoints: readonly SensitivityTestPoint[],
  referenceIndex?: number,
): readonly SensitivityPointResult[] {
  const scenarios = testPoints.map((point) => runScenario({ ...definition, overrides: applySensitivityOverride(definition.overrides ?? {}, point) }));
  const reference = referenceIndex !== undefined ? scenarios[referenceIndex] : undefined;
  return testPoints.map((testPoint, index) => ({
    testPoint,
    scenario: scenarios[index],
    deltaFromReference: reference ? compareScenarios(reference, scenarios[index]) : null,
  }));
}

export interface BurdenComponentRateSensitivityPointResult {
  readonly testPoint: BurdenComponentRatePatch;
  readonly scenario: ScenarioResult;
  readonly deltaFromReference: ScenarioComparison | null;
}

/**
 * Dedicated entry point for burden-component-rate sensitivity, since
 * selecting a component (by type) is a different shape of "which one
 * variable changed" than the scalar SensitivityTestPoint variables above.
 * Reuses the exact same canonical `burdenComponentRatePatches` mechanism
 * (economics-scenario.ts) that the scenario engine's composite-override
 * correction defined -- there is only one way to patch a burden component's
 * rate in this codebase, not two contradictory ones. Each test point adds
 * exactly one patch on top of `definition`'s own overrides/patches.
 */
export function runBurdenComponentRateSensitivity(
  definition: ScenarioDefinition,
  testPoints: readonly BurdenComponentRatePatch[],
  referenceIndex?: number,
): readonly BurdenComponentRateSensitivityPointResult[] {
  const scenarios = testPoints.map((patch) => runScenario({
    ...definition,
    overrides: { ...definition.overrides, burdenComponentRatePatches: [...(definition.overrides?.burdenComponentRatePatches ?? []), patch] },
  }));
  const reference = referenceIndex !== undefined ? scenarios[referenceIndex] : undefined;
  return testPoints.map((testPoint, index) => ({
    testPoint,
    scenario: scenarios[index],
    deltaFromReference: reference ? compareScenarios(reference, scenarios[index]) : null,
  }));
}
