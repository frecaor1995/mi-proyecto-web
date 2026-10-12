import type { CashFlowEvaluation } from "./cash-flow-engine";
import { evaluateCashFlow } from "./cash-flow-engine";
import type { CommercialEconomicsEvaluation } from "./commercial-economics-engine";
import { evaluateCommercialEconomics } from "./commercial-economics-engine";
import type { DerivedEconomicResult, EconomicFactTier, MoneyDelta, SignedRate } from "./economic-value";
import { weakestNonUnknownTier } from "./economic-value";
import type { ScenarioLabel } from "./commercial-economics";
import type { ScenarioDefinition } from "./economics-scenario";
import { resolveScenarioInputs, type ResolvedScenarioInputs } from "./economics-scenario";

/**
 * Phase 4F. Scenario execution: resolved inputs -> certified 4D economics ->
 * certified 4E cash flow -> a single explainable ScenarioResult. This module
 * composes wage-engine.ts/burden-engine.ts/billing-engine.ts/commercial-
 * economics-engine.ts (4D) and cash-flow-timing.ts/cash-flow-events.ts/
 * cash-flow-engine.ts/working-capital-engine.ts (4E) -- it does not
 * reimplement any wage, burden, billing, or working-capital formula.
 */

export const PROFITABILITY_CLASSIFICATIONS = ["PROFIT", "BREAK_EVEN", "LOSS"] as const;
/** Purely mathematical, derived only from gross-profit sign -- NOT a GO/NO-GO or quality judgment (mandate section 25/26). */
export type ProfitabilityClassification = (typeof PROFITABILITY_CLASSIFICATIONS)[number];

export function classifyProfitability(grossProfit: DerivedEconomicResult<MoneyDelta>): ProfitabilityClassification | null {
  if (grossProfit.state !== "KNOWN") return null;
  if (grossProfit.value.amount > 0) return "PROFIT";
  if (grossProfit.value.amount < 0) return "LOSS";
  return "BREAK_EVEN";
}

export interface ScenarioProfitabilitySide {
  readonly grossProfit: DerivedEconomicResult<MoneyDelta>;
  readonly grossMargin: DerivedEconomicResult<SignedRate>;
  readonly classification: ProfitabilityClassification | null;
}

export interface ScenarioProfitability {
  readonly complete: ScenarioProfitabilitySide;
  readonly laborOnly: ScenarioProfitabilitySide;
}

function buildProfitabilitySide(grossProfit: DerivedEconomicResult<MoneyDelta>, grossMargin: DerivedEconomicResult<SignedRate>): ScenarioProfitabilitySide {
  return { grossProfit, grossMargin, classification: classifyProfitability(grossProfit) };
}

function collectKnownTiers(economics: CommercialEconomicsEvaluation, cashFlow: CashFlowEvaluation): readonly Exclude<EconomicFactTier, "UNKNOWN">[] {
  const results: readonly DerivedEconomicResult<unknown>[] = [
    economics.labor.perWorkerPerWeek.completeEmployerCost,
    economics.billing.perWorkerPerWeek.completeBilling,
    economics.grossProfit.completePerWorkerPerWeek,
    economics.grossProfit.completeMarginPerWorkerPerWeek,
    cashFlow.complete.ledger,
    cashFlow.complete.workingCapital,
  ];
  return results
    .filter((result): result is Extract<DerivedEconomicResult<unknown>, { state: "KNOWN" }> => result.state === "KNOWN")
    .map((result) => result.tier);
}

function collectBlockingReasons(economics: CommercialEconomicsEvaluation, cashFlow: CashFlowEvaluation): readonly string[] {
  const labeled: ReadonlyArray<readonly [string, DerivedEconomicResult<unknown>]> = [
    ["complete employer cost", economics.labor.perWorkerPerWeek.completeEmployerCost],
    ["complete client billing", economics.billing.perWorkerPerWeek.completeBilling],
    ["complete gross profit", economics.grossProfit.completePerWorkerPerWeek],
    ["complete gross margin", economics.grossProfit.completeMarginPerWorkerPerWeek],
    ["payroll cash-out events", cashFlow.complete.payrollEvents],
    ["invoice events", cashFlow.complete.invoiceEvents],
    ["modeled cash receipts", cashFlow.complete.receiptEvents],
    ["weekly cash ledger", cashFlow.complete.ledger],
    ["working capital", cashFlow.complete.workingCapital],
  ];
  const reasons: string[] = [];
  for (const [label, result] of labeled) {
    if (result.state === "UNAVAILABLE") reasons.push(`${label}: UNAVAILABLE -- ${result.reason}`);
    else if (result.state === "UNKNOWN") reasons.push(`${label}: UNKNOWN`);
  }
  return reasons;
}

export interface ScenarioResult {
  readonly label: ScenarioLabel;
  /** A local, in-memory calculation identifier only -- never a persisted database id (mandate section 42). */
  readonly calculationId: string;
  readonly resolvedInputs: ResolvedScenarioInputs;
  /** Certified 4D composite result (labor cost, client billing, gross profit/margin -- both complete and labor-only). */
  readonly economics: CommercialEconomicsEvaluation;
  /** Certified 4E composite result (payroll/invoice/receipt events, weekly ledger, working capital -- both complete and labor-only). */
  readonly cashFlow: CashFlowEvaluation;
  readonly profitability: ScenarioProfitability;
  /** Weakest fact tier among this scenario's KNOWN complete-side results, or null if none are KNOWN. Per-result tiers remain independently available on `economics`/`cashFlow` -- this is an additional summary, not a replacement (mandate section 46). */
  readonly weakestTier: Exclude<EconomicFactTier, "UNKNOWN"> | null;
  /** Explicit UNKNOWN/UNAVAILABLE reasons collected from the complete-side results, for auditability (mandate section 47) -- structured state on `economics`/`cashFlow` remains the source of truth. */
  readonly blockingReasons: readonly string[];
}

let calculationCounter = 0;
function generateCalculationId(): string {
  calculationCounter += 1;
  return `4f-scenario-calc-${Date.now().toString(36)}-${calculationCounter}`;
}

export function runScenario(definition: ScenarioDefinition): ScenarioResult {
  const resolvedInputs = resolveScenarioInputs(definition);
  const economics = evaluateCommercialEconomics(resolvedInputs.labor, resolvedInputs.commercialTerms, resolvedInputs.deployment);
  const cashFlow = evaluateCashFlow(economics.labor, economics.billing, resolvedInputs.deployment, resolvedInputs.commercialTerms, resolvedInputs.cashFlowAssumptions);

  const profitability: ScenarioProfitability = {
    complete: buildProfitabilitySide(economics.grossProfit.completePerWorkerPerWeek, economics.grossProfit.completeMarginPerWorkerPerWeek),
    laborOnly: buildProfitabilitySide(economics.grossProfit.laborOnlyPerWorkerPerWeek, economics.grossProfit.laborOnlyMarginPerWorkerPerWeek),
  };

  const knownTiers = collectKnownTiers(economics, cashFlow);
  const scenarioWeakestTier = knownTiers.length > 0 ? weakestNonUnknownTier(knownTiers) : null;

  return {
    label: definition.label,
    calculationId: generateCalculationId(),
    resolvedInputs,
    economics,
    cashFlow,
    profitability,
    weakestTier: scenarioWeakestTier,
    blockingReasons: collectBlockingReasons(economics, cashFlow),
  };
}

export type ScenarioSetResult =
  | { readonly outcome: "OK"; readonly scenarios: readonly ScenarioResult[] }
  | { readonly outcome: "DUPLICATE_LABELS"; readonly duplicateLabels: readonly ScenarioLabel[] };

/**
 * Runs any number of scenarios (1, 2, or 3 -- BASE/CONSERVATIVE/TARGET are
 * never required to all be present, and none is auto-generated for a
 * missing label, per mandate section 44). Detects duplicate labels
 * explicitly rather than silently letting one overwrite another (mandate
 * section 45).
 */
export function runScenarioSet(definitions: readonly ScenarioDefinition[]): ScenarioSetResult {
  const counts = new Map<ScenarioLabel, number>();
  for (const definition of definitions) counts.set(definition.label, (counts.get(definition.label) ?? 0) + 1);
  const duplicateLabels = [...counts.entries()].filter(([, count]) => count > 1).map(([label]) => label);
  if (duplicateLabels.length > 0) return { outcome: "DUPLICATE_LABELS", duplicateLabels };
  return { outcome: "OK", scenarios: definitions.map(runScenario) };
}
