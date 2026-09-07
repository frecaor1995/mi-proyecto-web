import type { BurdenComponent, BurdenComponentType } from "./burden-profile";
import type { CashFlowAssumptions } from "./cash-flow-engine";
import type { DeploymentEconomicsInput, LaborEconomicsInput, ScenarioLabel } from "./commercial-economics";
import type { CommercialTermsContract } from "./commercial-terms";
import type { EconomicValue, Rate } from "./economic-value";

/**
 * Phase 4F. Explicit scenario input model. A scenario is a named
 * (BASE/CONSERVATIVE/TARGET -- the certified 4B labels, reused verbatim, no
 * new labels added) projection over certified 4D/4E inputs: a base input set
 * plus an explicit, auditable set of field-level overrides.
 *
 * Scenario labels are organizational only -- they carry no fact tier and no
 * built-in arithmetic (mandate sections 3/9/10). CONSERVATIVE does not
 * automatically reduce a bill rate; TARGET does not automatically improve a
 * margin. Every value in a scenario, base or overridden, carries its own
 * certified EconomicValue tier.
 *
 * COMPOSITE-OVERRIDE CORRECTION (pre-commit). Every overridable field is
 * classified explicitly as either ATOMIC REPLACEMENT or an explicit
 * composite mechanism -- no field relies on ambiguous nested merge behavior:
 *
 *   ATOMIC (plain `Partial<T>` replacement is safe and correct because the
 *   field is a single indivisible value with no independently-meaningful
 *   sibling data that a naive override could silently discard):
 *     - labor.basePayRate / overtimeMultiplier / workerPerDiem (EconomicValue<MoneyAmount|Rate>)
 *     - commercialTerms.billRate / reimbursablePerDiem / perDiemMarkup / paymentTerms / billingCadence
 *       (paymentTerms wraps PaymentTerms, which has exactly one field --
 *       there is no sibling to lose)
 *     - commercialTerms.overtimeBillBasis (a discriminated union -- replacing
 *       it always replaces the whole {kind, rate|multiplier} value together,
 *       never just one branch's field)
 *     - deployment.headcount / regularHoursPerWeek / overtimeHoursPerWeek / duration
 *       (duration is a discriminated union, same reasoning as overtimeBillBasis)
 *     - cashFlowAssumptions.payrollFrequency / payrollAnchorWeek / billingAnchorWeek
 *
 *   COMPOSITE (the one genuinely collection-shaped field reachable through
 *   the four override groups):
 *     - labor.burdenComponents: readonly BurdenComponent[]
 *
 * For burdenComponents, `Partial<LaborEconomicsInput>.burdenComponents` (if
 * supplied) remains a WHOLE-COLLECTION REPLACEMENT -- explicit and
 * documented as such, never inferred, never confused with a patch. For the
 * common case of adjusting ONE component without discarding the others, use
 * the dedicated `burdenComponentRatePatches` field below, resolved via
 * `applyBurdenComponentRatePatches` -- a small, targeted, typed helper, not
 * a generic recursive deep merge (mandate section 5).
 *
 * Because resolution is built from plain object spreads and array `.map`,
 * never in-place mutation, the base input objects, the canonical commercial
 * terms/labor/deployment objects, and the override objects themselves are
 * never mutated -- scenario calculation is a projection, never a canonical
 * correction (mandate section 12).
 */

export interface ScenarioOverrides {
  /** burdenComponents, if present, REPLACES THE ENTIRE collection -- see the module doc comment. */
  readonly labor?: Partial<LaborEconomicsInput>;
  readonly commercialTerms?: Partial<CommercialTermsContract>;
  readonly deployment?: Partial<DeploymentEconomicsInput>;
  readonly cashFlowAssumptions?: Partial<CashFlowAssumptions>;
  /**
   * Explicit patch-by-identity for burden component rates. Applied AFTER
   * `labor.burdenComponents` (base or whole-replaced) is resolved. Each
   * patch replaces exactly the named component's rate -- including its own
   * fact tier, never inheriting the replaced rate's tier -- while every
   * other component in the collection is returned untouched.
   */
  readonly burdenComponentRatePatches?: readonly BurdenComponentRatePatch[];
}

export interface ScenarioDefinition {
  readonly label: ScenarioLabel;
  readonly baseLabor: LaborEconomicsInput;
  readonly baseCommercialTerms: CommercialTermsContract;
  readonly baseDeployment: DeploymentEconomicsInput;
  readonly baseCashFlowAssumptions: CashFlowAssumptions;
  readonly overrides?: ScenarioOverrides;
}

export interface ResolvedScenarioInputs {
  readonly labor: LaborEconomicsInput;
  readonly commercialTerms: CommercialTermsContract;
  readonly deployment: DeploymentEconomicsInput;
  readonly cashFlowAssumptions: CashFlowAssumptions;
}

/**
 * Burden components carry no id/name field in the certified 4B contract
 * (`BurdenComponent` has only `type`, `rate`, `appliesTo`) -- `type` is the
 * smallest identity the certified architecture offers. Keying by type alone
 * is unsafe in general (nothing prevents two components sharing the same
 * type, most plausibly two "OTHER" entries), so `type` is used as an
 * identity ONLY when it is actually unique within the collection being
 * patched; otherwise the patch is explicitly refused (`AMBIGUOUS_COMPONENT_TYPE`)
 * rather than silently guessing which one was meant or overwriting both.
 */
export interface BurdenComponentRatePatch {
  readonly componentType: BurdenComponentType;
  readonly rate: EconomicValue<Rate>;
}

export type BurdenComponentPatchOutcome =
  | { readonly outcome: "OK"; readonly components: readonly BurdenComponent[] }
  | { readonly outcome: "AMBIGUOUS_COMPONENT_TYPE"; readonly componentType: BurdenComponentType; readonly matchCount: number }
  | { readonly outcome: "COMPONENT_NOT_FOUND"; readonly componentType: BurdenComponentType };

/**
 * Patches exactly one existing component's rate by type, refusing (rather
 * than guessing) when the base collection has zero or more than one
 * component of that type. This function only patches an EXISTING
 * component's rate -- it never adds a new component (that is what a whole-
 * collection replacement via `labor.burdenComponents` is for).
 */
export function patchBurdenComponentRateByType(
  components: readonly BurdenComponent[],
  componentType: BurdenComponentType,
  rate: EconomicValue<Rate>,
): BurdenComponentPatchOutcome {
  const matches = components.filter((component) => component.type === componentType);
  if (matches.length > 1) return { outcome: "AMBIGUOUS_COMPONENT_TYPE", componentType, matchCount: matches.length };
  if (matches.length === 0) return { outcome: "COMPONENT_NOT_FOUND", componentType };
  return { outcome: "OK", components: components.map((component) => (component.type === componentType ? { ...component, rate } : component)) };
}

/**
 * Applies each patch in order. Throws on an unsafe/invalid patch request
 * (ambiguous type identity, or a type with no existing component) -- this is
 * a caller-configuration error, not a missing economic fact, and is treated
 * the same way this domain already treats other invalid-construction cases
 * (e.g. `createMoneyAmount`/`createRate`/`createPaymentTerms` throwing on an
 * invalid value) rather than silently producing a wrong resolved scenario.
 */
export function applyBurdenComponentRatePatches(components: readonly BurdenComponent[], patches: readonly BurdenComponentRatePatch[]): readonly BurdenComponent[] {
  let result = components;
  for (const patch of patches) {
    const outcome = patchBurdenComponentRateByType(result, patch.componentType, patch.rate);
    if (outcome.outcome === "AMBIGUOUS_COMPONENT_TYPE") {
      throw new Error(`Cannot patch burden component type "${patch.componentType}" by type alone: ${outcome.matchCount} components share this type in the resolved collection. Type-only identity is unsafe here -- use an explicit whole-collection replacement via labor.burdenComponents instead.`);
    }
    if (outcome.outcome === "COMPONENT_NOT_FOUND") {
      throw new Error(`Cannot patch burden component type "${patch.componentType}": no component of this type exists in the resolved collection. A patch only replaces an existing component's rate; use labor.burdenComponents to add a new one.`);
    }
    result = outcome.components;
  }
  return result;
}

export function resolveScenarioInputs(definition: ScenarioDefinition): ResolvedScenarioInputs {
  const overrides = definition.overrides;
  const labor: LaborEconomicsInput = { ...definition.baseLabor, ...overrides?.labor };
  const patchedLabor: LaborEconomicsInput = overrides?.burdenComponentRatePatches && overrides.burdenComponentRatePatches.length > 0
    ? { ...labor, burdenComponents: applyBurdenComponentRatePatches(labor.burdenComponents, overrides.burdenComponentRatePatches) }
    : labor;

  return {
    labor: patchedLabor,
    commercialTerms: { ...definition.baseCommercialTerms, ...overrides?.commercialTerms },
    deployment: { ...definition.baseDeployment, ...overrides?.deployment },
    cashFlowAssumptions: { ...definition.baseCashFlowAssumptions, ...overrides?.cashFlowAssumptions },
  };
}
