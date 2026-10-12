import type { ScenarioResult } from "./scenario-engine";
import type { ScenarioLabel } from "./commercial-economics";
import type { DerivedEconomicResult, EconomicFactTier, MoneyAmount, MoneyDelta, SignedRate } from "./economic-value";
import { createSignedRate, subtractMoney, weakestNonUnknownTier } from "./economic-value";
import type { FundingRecoveryStatus } from "./working-capital-engine";

/**
 * Phase 4F. Deterministic, descriptive comparison between two scenario
 * results. Operates on the COMPLETE side of each scenario (the authoritative
 * economics, per the certified 4D/4E labor-only/complete distinction) --
 * comparing labor-only figures is a disclosed non-goal of this module (see
 * the Phase 4F implementation report). Deltas are strictly descriptive --
 * this module never judges, ranks, or scores the scenarios being compared
 * (mandate sections 27/29/56).
 */

function deltaMoneyAmount(from: DerivedEconomicResult<MoneyAmount>, to: DerivedEconomicResult<MoneyAmount>): DerivedEconomicResult<MoneyDelta> {
  if (from.state !== "KNOWN") return from;
  if (to.state !== "KNOWN") return to;
  const diff = subtractMoney(to.value, from.value);
  if (diff.outcome === "CURRENCY_MISMATCH") return { state: "UNAVAILABLE", reason: `Currency mismatch between scenarios (${diff.currencies.join(" vs ")}) -- Phase 4F performs no FX conversion` };
  return { state: "KNOWN", tier: weakestNonUnknownTier([from.tier, to.tier]), value: diff.result };
}

function deltaMoneyDelta(from: DerivedEconomicResult<MoneyDelta>, to: DerivedEconomicResult<MoneyDelta>): DerivedEconomicResult<MoneyDelta> {
  if (from.state !== "KNOWN") return from;
  if (to.state !== "KNOWN") return to;
  if (from.value.currency !== to.value.currency) {
    return { state: "UNAVAILABLE", reason: `Currency mismatch between scenarios (${from.value.currency} vs ${to.value.currency}) -- Phase 4F performs no FX conversion` };
  }
  return { state: "KNOWN", tier: weakestNonUnknownTier([from.tier, to.tier]), value: { amount: to.value.amount - from.value.amount, currency: from.value.currency } };
}

function deltaSignedRate(from: DerivedEconomicResult<SignedRate>, to: DerivedEconomicResult<SignedRate>): DerivedEconomicResult<SignedRate> {
  if (from.state !== "KNOWN") return from;
  if (to.state !== "KNOWN") return to;
  return { state: "KNOWN", tier: weakestNonUnknownTier([from.tier, to.tier]), value: createSignedRate(to.value.value - from.value.value) };
}

/** Only meaningful when both scenarios reach a concrete RECOVERED week -- NOT_APPLICABLE/NOT_REACHED_WITHIN_HORIZON pairs are not numerically comparable and yield an explicit UNAVAILABLE, never an invented delta. */
function deltaRecoveryWeek(from: FundingRecoveryStatus, to: FundingRecoveryStatus, tier: Exclude<EconomicFactTier, "UNKNOWN">): DerivedEconomicResult<number> {
  if (from.kind !== "RECOVERED" || to.kind !== "RECOVERED") {
    return { state: "UNAVAILABLE", reason: "Recovery-week delta is only meaningful when both scenarios reach a concrete recovery week" };
  }
  return { state: "KNOWN", tier, value: to.weekIndex - from.weekIndex };
}

export interface ScenarioComparison {
  readonly from: ScenarioLabel;
  readonly to: ScenarioLabel;
  readonly revenueDelta: DerivedEconomicResult<MoneyDelta>;
  readonly employerCostDelta: DerivedEconomicResult<MoneyDelta>;
  readonly grossProfitDelta: DerivedEconomicResult<MoneyDelta>;
  readonly grossMarginDelta: DerivedEconomicResult<SignedRate>;
  readonly workingCapitalDelta: DerivedEconomicResult<MoneyDelta>;
  readonly recoveryWeekDelta: DerivedEconomicResult<number>;
}

export function compareScenarios(from: ScenarioResult, to: ScenarioResult): ScenarioComparison {
  const revenueDelta = deltaMoneyAmount(from.economics.billing.perWorkerPerWeek.completeBilling, to.economics.billing.perWorkerPerWeek.completeBilling);
  const employerCostDelta = deltaMoneyAmount(from.economics.labor.perWorkerPerWeek.completeEmployerCost, to.economics.labor.perWorkerPerWeek.completeEmployerCost);
  const grossProfitDelta = deltaMoneyDelta(from.profitability.complete.grossProfit, to.profitability.complete.grossProfit);
  const grossMarginDelta = deltaSignedRate(from.profitability.complete.grossMargin, to.profitability.complete.grossMargin);

  const fromWc = from.cashFlow.complete.workingCapital;
  const toWc = to.cashFlow.complete.workingCapital;

  let workingCapitalDelta: DerivedEconomicResult<MoneyDelta>;
  let recoveryWeekDelta: DerivedEconomicResult<number>;
  if (fromWc.state !== "KNOWN") {
    workingCapitalDelta = fromWc;
    recoveryWeekDelta = fromWc;
  } else if (toWc.state !== "KNOWN") {
    workingCapitalDelta = toWc;
    recoveryWeekDelta = toWc;
  } else {
    const tier = weakestNonUnknownTier([fromWc.tier, toWc.tier]);
    workingCapitalDelta = deltaMoneyAmount(
      { state: "KNOWN", tier: fromWc.tier, value: fromWc.value.workingCapitalRequirement },
      { state: "KNOWN", tier: toWc.tier, value: toWc.value.workingCapitalRequirement },
    );
    recoveryWeekDelta = deltaRecoveryWeek(fromWc.value.recovery, toWc.value.recovery, tier);
  }

  return { from: from.label, to: to.label, revenueDelta, employerCostDelta, grossProfitDelta, grossMarginDelta, workingCapitalDelta, recoveryWeekDelta };
}
