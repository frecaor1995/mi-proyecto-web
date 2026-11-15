import type { BurdenBreakdown, WageBasis } from "./burden-engine";
import { burdenBreakdown } from "./burden-engine";
import {
  clientOvertimeBilling, clientPerDiemBilling, regularClientBilling, type PerDiemBillingBreakdown,
} from "./billing-engine";
import { overtimeWageCost, regularWageCost, type OvertimeWageBreakdown } from "./wage-engine";
import type { CommercialTermsContract } from "./commercial-terms";
import type { DeploymentDuration, DeploymentEconomicsInput, LaborCostPerHourResult, LaborEconomicsInput } from "./commercial-economics";
import { laborCostPerHour } from "./commercial-economics";
import type { DerivedEconomicResult, EconomicValue, MoneyAmount, MoneyDelta, SignedRate } from "./economic-value";
import { createSignedRate, multiplyMoney, subtractMoney, weakestNonUnknownTier } from "./economic-value";

/**
 * Phase 4D (corrected per Phase 4D pre-commit correction). Top-level
 * orchestration composing wage-engine.ts + burden-engine.ts + billing-
 * engine.ts into an explainable labor-cost / client-billing / gross-profit /
 * gross-margin evaluation. Deterministic, pure, side-effect free, no
 * persistence, no database.
 *
 * LABOR-ONLY vs COMPLETE (pre-commit correction): LaborEconomicsInput.
 * workerPerDiem and CommercialTermsContract.reimbursablePerDiem carry no
 * certified frequency (daily? weekly? per mobilization?) -- multiplying
 * either by hours/weeks would fabricate a conversion policy the 4B contract
 * does not provide. The original 4D implementation handled this by simply
 * excluding per-diem from every "total" while still calling those totals
 * complete -- a mathematically partial subtotal masquerading as a complete
 * economic total. This is corrected as follows:
 *
 * - Every "laborOnlyCost" / "laborOnlyBilling" (and their workforce/
 *   deployment-scaled forms) is wages + burden (or billing) ONLY, excluding
 *   per-diem entirely, and remains KNOWN whenever its own inputs allow --
 *   labeled explicitly as labor-only, never presented as a complete total.
 * - Every "completeEmployerCost" / "completeBilling" (and their scaled
 *   forms) additionally accounts for per-diem honestly: a KNOWN ZERO
 *   per-diem contributes nothing and does not block completeness (adding
 *   zero needs no frequency); an UNKNOWN per-diem makes the complete result
 *   UNKNOWN; a KNOWN NON-ZERO per-diem whose frequency cannot be normalized
 *   makes the complete result UNAVAILABLE, with a reason naming per-diem
 *   normalization as the cause -- it is never silently dropped from a value
 *   presented as complete.
 * - Gross profit/margin mirror the same split: "complete*" figures require
 *   BOTH the complete cost and complete billing bases; "laborOnly*" figures
 *   are computed from the labor-only bases and are explicitly named as such.
 *
 * perDiemNetContribution remains a separate, frequency-agnostic comparison
 * (client per-diem economics vs worker per-diem cost) -- valid without a
 * frequency because both sides describe the same undefined-but-shared
 * period. It is informational and is never summed into any labor-only or
 * complete total.
 */

function combineTwoMoneyResults(a: DerivedEconomicResult<MoneyAmount>, b: DerivedEconomicResult<MoneyAmount>): DerivedEconomicResult<MoneyAmount> {
  if (a.state !== "KNOWN") return a;
  if (b.state !== "KNOWN") return b;
  if (a.value.currency !== b.value.currency) return { state: "UNAVAILABLE", reason: "Currency mismatch" };
  return { state: "KNOWN", tier: weakestNonUnknownTier([a.tier, b.tier]), value: { amount: a.value.amount + b.value.amount, currency: a.value.currency } };
}

function scaleMoneyResult(result: DerivedEconomicResult<MoneyAmount>, factor: EconomicValue<number>, factorName: string): DerivedEconomicResult<MoneyAmount> {
  if (result.state !== "KNOWN") return result;
  if (factor.tier === "UNKNOWN") return { state: "UNKNOWN" };
  if (factor.value < 0) return { state: "UNAVAILABLE", reason: `${factorName} cannot be negative` };
  return { state: "KNOWN", tier: weakestNonUnknownTier([result.tier, factor.tier]), value: multiplyMoney(result.value, factor.value) };
}

/** UNKNOWN (not fabricated) for OPEN_ENDED and UNKNOWN duration -- only FIXED duration produces a deployment total (mandate section 28). */
function scaleMoneyResultByFixedWeeks(result: DerivedEconomicResult<MoneyAmount>, duration: DeploymentDuration): DerivedEconomicResult<MoneyAmount> {
  if (result.state !== "KNOWN") return result;
  if (duration.kind !== "FIXED") return { state: "UNKNOWN" };
  if (duration.weeks < 0) return { state: "UNAVAILABLE", reason: "Duration weeks cannot be negative" };
  return { state: "KNOWN", tier: result.tier, value: multiplyMoney(result.value, duration.weeks) };
}

function overtimePortionResult(ot: DerivedEconomicResult<OvertimeWageBreakdown>, pick: (b: OvertimeWageBreakdown) => MoneyAmount): DerivedEconomicResult<MoneyAmount> {
  if (ot.state !== "KNOWN") return ot;
  return { state: "KNOWN", tier: ot.tier, value: pick(ot.value) };
}

function grossProfitFromResults(billing: DerivedEconomicResult<MoneyAmount>, cost: DerivedEconomicResult<MoneyAmount>): DerivedEconomicResult<MoneyDelta> {
  if (billing.state !== "KNOWN") return billing;
  if (cost.state !== "KNOWN") return cost;
  const diff = subtractMoney(billing.value, cost.value);
  if (diff.outcome === "CURRENCY_MISMATCH") return { state: "UNAVAILABLE", reason: "Currency mismatch between billing and cost" };
  return { state: "KNOWN", tier: weakestNonUnknownTier([billing.tier, cost.tier]), value: diff.result };
}

function grossMarginFromResults(billing: DerivedEconomicResult<MoneyAmount>, cost: DerivedEconomicResult<MoneyAmount>): DerivedEconomicResult<SignedRate> {
  const profit = grossProfitFromResults(billing, cost);
  if (profit.state !== "KNOWN") return profit;
  if (billing.state !== "KNOWN") return { state: "UNKNOWN" };
  if (billing.value.amount === 0) return { state: "UNAVAILABLE", reason: "Margin is undefined when billing is zero" };
  return { state: "KNOWN", tier: profit.tier, value: createSignedRate(profit.value.amount / billing.value.amount) };
}

/**
 * Gates a labor-only subtotal into a complete total based on an independent
 * per-diem amount (mandate: pre-commit correction sections 4-8):
 * - labor-only itself not KNOWN -> propagate it unchanged (nothing new to add).
 * - per-diem UNKNOWN -> UNKNOWN (never silently zero).
 * - per-diem UNAVAILABLE (e.g. an upstream currency mismatch) -> propagate it.
 * - per-diem KNOWN ZERO -> contributes nothing; the labor-only figure IS the
 *   complete figure (no frequency is needed to add zero).
 * - per-diem KNOWN NON-ZERO -> UNAVAILABLE; folding a non-zero, un-normalizable
 *   per-diem into a weekly/deployment total would fabricate a conversion
 *   policy the certified contracts do not provide.
 */
function applyPerDiemToCompleteTotal(
  laborOnly: DerivedEconomicResult<MoneyAmount>,
  perDiem: DerivedEconomicResult<MoneyAmount>,
  perDiemDescription: string,
): DerivedEconomicResult<MoneyAmount> {
  if (laborOnly.state !== "KNOWN") return laborOnly;
  if (perDiem.state === "UNKNOWN") return { state: "UNKNOWN" };
  if (perDiem.state === "UNAVAILABLE") return perDiem;
  if (perDiem.value.amount === 0) return laborOnly;
  return {
    state: "UNAVAILABLE",
    reason: `A known non-zero ${perDiemDescription} exists, but its frequency/normalization basis is not part of the certified economics contract -- the complete total cannot be computed without fabricating a conversion policy`,
  };
}

export interface LaborCostEvaluation {
  readonly perWorkerPerWeek: {
    readonly regularWages: DerivedEconomicResult<MoneyAmount>;
    readonly overtimeWages: DerivedEconomicResult<OvertimeWageBreakdown>;
    readonly totalWages: DerivedEconomicResult<MoneyAmount>;
    readonly burden: BurdenBreakdown;
    /** Wages + burden only, excluding per-diem. Explicitly labor-only -- never present this as the complete economic cost. */
    readonly laborOnlyCost: DerivedEconomicResult<MoneyAmount>;
    /** laborOnlyCost honestly combined with worker per-diem (see applyPerDiemToCompleteTotal). This is the complete employer cost. */
    readonly completeEmployerCost: DerivedEconomicResult<MoneyAmount>;
  };
  /** Reuses the certified 4B laborCostPerHour proof helper verbatim -- not reimplemented. Per-regular-hour, not a "total"; unaffected by the labor-only/complete distinction. */
  readonly perWorkerPerRegularHour: LaborCostPerHourResult;
  readonly workerPerDiemCost: DerivedEconomicResult<MoneyAmount>;
  readonly laborOnlyTotalWorkforcePerWeek: DerivedEconomicResult<MoneyAmount>;
  readonly laborOnlyFixedDeploymentTotal: DerivedEconomicResult<MoneyAmount>;
  readonly completeTotalWorkforcePerWeek: DerivedEconomicResult<MoneyAmount>;
  readonly completeFixedDeploymentTotal: DerivedEconomicResult<MoneyAmount>;
}

export function evaluateLaborCost(labor: LaborEconomicsInput, deployment: DeploymentEconomicsInput): LaborCostEvaluation {
  const regularWages = regularWageCost(labor.basePayRate, deployment.regularHoursPerWeek);
  const overtimeWages = overtimeWageCost(labor.basePayRate, labor.overtimeMultiplier, deployment.overtimeHoursPerWeek);
  const wageBasis: WageBasis = {
    regularWages,
    overtimeBaseWages: overtimePortionResult(overtimeWages, (b) => b.basePortion),
    overtimePremiumWages: overtimePortionResult(overtimeWages, (b) => b.premiumPortion),
  };
  const burden = burdenBreakdown(labor.burdenComponents, wageBasis);
  const overtimeTotal = overtimePortionResult(overtimeWages, (b) => b.total);
  const totalWages = combineTwoMoneyResults(regularWages, overtimeTotal);
  const laborOnlyCost = combineTwoMoneyResults(totalWages, burden.totalBurden);

  const perWorkerPerRegularHour = laborCostPerHour(labor.basePayRate, labor.burdenComponents, "REGULAR_WAGES");

  const workerPerDiemCost: DerivedEconomicResult<MoneyAmount> = labor.workerPerDiem.tier === "UNKNOWN"
    ? { state: "UNKNOWN" } : { state: "KNOWN", tier: labor.workerPerDiem.tier, value: labor.workerPerDiem.value };

  const completeEmployerCost = applyPerDiemToCompleteTotal(laborOnlyCost, workerPerDiemCost, "worker per-diem amount");

  const laborOnlyTotalWorkforcePerWeek = scaleMoneyResult(laborOnlyCost, deployment.headcount, "Headcount");
  const laborOnlyFixedDeploymentTotal = scaleMoneyResultByFixedWeeks(laborOnlyTotalWorkforcePerWeek, deployment.duration);
  const completeTotalWorkforcePerWeek = scaleMoneyResult(completeEmployerCost, deployment.headcount, "Headcount");
  const completeFixedDeploymentTotal = scaleMoneyResultByFixedWeeks(completeTotalWorkforcePerWeek, deployment.duration);

  return {
    perWorkerPerWeek: { regularWages, overtimeWages, totalWages, burden, laborOnlyCost, completeEmployerCost },
    perWorkerPerRegularHour, workerPerDiemCost,
    laborOnlyTotalWorkforcePerWeek, laborOnlyFixedDeploymentTotal, completeTotalWorkforcePerWeek, completeFixedDeploymentTotal,
  };
}

export interface BillingEvaluation {
  readonly perWorkerPerWeek: {
    readonly regularBilling: DerivedEconomicResult<MoneyAmount>;
    readonly overtimeBilling: DerivedEconomicResult<MoneyAmount>;
    /** Regular + OT billing only, excluding per-diem. Explicitly labor-only -- never present this as the complete client billing. */
    readonly laborOnlyBilling: DerivedEconomicResult<MoneyAmount>;
    /** laborOnlyBilling honestly combined with client per-diem (see applyPerDiemToCompleteTotal). This is the complete client billing. */
    readonly completeBilling: DerivedEconomicResult<MoneyAmount>;
  };
  readonly perDiemBilling: PerDiemBillingBreakdown;
  readonly laborOnlyTotalWorkforcePerWeek: DerivedEconomicResult<MoneyAmount>;
  readonly laborOnlyFixedDeploymentTotal: DerivedEconomicResult<MoneyAmount>;
  readonly completeTotalWorkforcePerWeek: DerivedEconomicResult<MoneyAmount>;
  readonly completeFixedDeploymentTotal: DerivedEconomicResult<MoneyAmount>;
}

export function evaluateClientBilling(commercialTerms: CommercialTermsContract, deployment: DeploymentEconomicsInput): BillingEvaluation {
  const regularBilling = regularClientBilling(commercialTerms.billRate, deployment.regularHoursPerWeek);
  const overtimeBilling = clientOvertimeBilling(commercialTerms.billRate, commercialTerms.overtimeBillBasis, deployment.overtimeHoursPerWeek);
  const laborOnlyBilling = combineTwoMoneyResults(regularBilling, overtimeBilling);
  const perDiemBilling = clientPerDiemBilling(commercialTerms.reimbursablePerDiem, commercialTerms.perDiemMarkup);

  // Gated on reimbursement alone (not the reimbursement+markup total): a zero
  // reimbursement makes any markup amount zero regardless, so materiality is
  // fully determined by reimbursement; gating on the combined total would
  // incorrectly block completeness merely because markup is UNKNOWN, which is
  // an unrelated partial-result case already handled inside billing-engine.ts.
  const completeBilling = applyPerDiemToCompleteTotal(laborOnlyBilling, perDiemBilling.reimbursement, "client reimbursable per-diem amount");

  const laborOnlyTotalWorkforcePerWeek = scaleMoneyResult(laborOnlyBilling, deployment.headcount, "Headcount");
  const laborOnlyFixedDeploymentTotal = scaleMoneyResultByFixedWeeks(laborOnlyTotalWorkforcePerWeek, deployment.duration);
  const completeTotalWorkforcePerWeek = scaleMoneyResult(completeBilling, deployment.headcount, "Headcount");
  const completeFixedDeploymentTotal = scaleMoneyResultByFixedWeeks(completeTotalWorkforcePerWeek, deployment.duration);

  return {
    perWorkerPerWeek: { regularBilling, overtimeBilling, laborOnlyBilling, completeBilling },
    perDiemBilling,
    laborOnlyTotalWorkforcePerWeek, laborOnlyFixedDeploymentTotal, completeTotalWorkforcePerWeek, completeFixedDeploymentTotal,
  };
}

export interface GrossProfitEvaluation {
  /** Requires BOTH complete employer cost and complete client billing. UNAVAILABLE/UNKNOWN whenever either side is blocked by unresolved per-diem -- this is the authoritative profit figure. */
  readonly completePerWorkerPerWeek: DerivedEconomicResult<MoneyDelta>;
  /** Scale-invariant (see module doc): the same value whether measured per worker, for the whole workforce, or for the fixed deployment, as long as headcount/duration and the complete bases are themselves known. */
  readonly completeMarginPerWorkerPerWeek: DerivedEconomicResult<SignedRate>;
  readonly completeTotalWorkforcePerWeek: DerivedEconomicResult<MoneyDelta>;
  readonly completeFixedDeploymentTotal: DerivedEconomicResult<MoneyDelta>;
  /** Explicitly labor-only profit/margin: wages+burden vs labor-only billing, excluding per-diem entirely. Exposed for cases where labor-only economics remain useful on their own, but never a substitute for the complete* figures above when a material per-diem is unresolved. */
  readonly laborOnlyPerWorkerPerWeek: DerivedEconomicResult<MoneyDelta>;
  readonly laborOnlyMarginPerWorkerPerWeek: DerivedEconomicResult<SignedRate>;
  /** Frequency-agnostic client-per-diem-vs-worker-per-diem comparison; informational only, never summed into the labor-only or complete profit figures above. */
  readonly perDiemNetContribution: DerivedEconomicResult<MoneyDelta>;
}

export interface CommercialEconomicsEvaluation {
  readonly labor: LaborCostEvaluation;
  readonly billing: BillingEvaluation;
  readonly grossProfit: GrossProfitEvaluation;
}

export function evaluateCommercialEconomics(
  labor: LaborEconomicsInput,
  commercialTerms: CommercialTermsContract,
  deployment: DeploymentEconomicsInput,
): CommercialEconomicsEvaluation {
  const laborEvaluation = evaluateLaborCost(labor, deployment);
  const billingEvaluation = evaluateClientBilling(commercialTerms, deployment);

  const completePerWorkerPerWeek = grossProfitFromResults(billingEvaluation.perWorkerPerWeek.completeBilling, laborEvaluation.perWorkerPerWeek.completeEmployerCost);
  const completeMarginPerWorkerPerWeek = grossMarginFromResults(billingEvaluation.perWorkerPerWeek.completeBilling, laborEvaluation.perWorkerPerWeek.completeEmployerCost);
  const completeTotalWorkforcePerWeek = grossProfitFromResults(billingEvaluation.completeTotalWorkforcePerWeek, laborEvaluation.completeTotalWorkforcePerWeek);
  const completeFixedDeploymentTotal = grossProfitFromResults(billingEvaluation.completeFixedDeploymentTotal, laborEvaluation.completeFixedDeploymentTotal);

  const laborOnlyPerWorkerPerWeek = grossProfitFromResults(billingEvaluation.perWorkerPerWeek.laborOnlyBilling, laborEvaluation.perWorkerPerWeek.laborOnlyCost);
  const laborOnlyMarginPerWorkerPerWeek = grossMarginFromResults(billingEvaluation.perWorkerPerWeek.laborOnlyBilling, laborEvaluation.perWorkerPerWeek.laborOnlyCost);

  const perDiemNetContribution: DerivedEconomicResult<MoneyDelta> = (() => {
    const clientTotal = billingEvaluation.perDiemBilling.total;
    const workerCost = laborEvaluation.workerPerDiemCost;
    if (clientTotal.state !== "KNOWN") return clientTotal;
    if (workerCost.state !== "KNOWN") return workerCost;
    const diff = subtractMoney(clientTotal.value, workerCost.value);
    if (diff.outcome === "CURRENCY_MISMATCH") return { state: "UNAVAILABLE", reason: "Currency mismatch between client per-diem billing and worker per-diem cost" };
    return { state: "KNOWN", tier: weakestNonUnknownTier([clientTotal.tier, workerCost.tier]), value: diff.result };
  })();

  return {
    labor: laborEvaluation,
    billing: billingEvaluation,
    grossProfit: {
      completePerWorkerPerWeek, completeMarginPerWorkerPerWeek, completeTotalWorkforcePerWeek, completeFixedDeploymentTotal,
      laborOnlyPerWorkerPerWeek, laborOnlyMarginPerWorkerPerWeek,
      perDiemNetContribution,
    },
  };
}
