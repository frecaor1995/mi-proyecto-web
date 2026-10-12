import type { DerivedEconomicResult, MoneyAmount, MoneyDelta } from "./economic-value";
import { createMoneyAmount } from "./economic-value";
import type { WeeklyCashLedger } from "./cash-flow-engine";

/**
 * Phase 4E. Peak funding deficit / working capital requirement / recovery
 * timing, derived from a weekly cash ledger. Any external funding product a
 * business might use to cover this requirement, and any policy decision
 * about whether to proceed given it, are explicitly out of scope (mandate
 * sections 37/38) -- this module only calculates the requirement itself.
 */

export type FundingRecoveryStatus =
  /** Cumulative cash never went negative -- there was nothing to recover from. */
  | { readonly kind: "NOT_APPLICABLE" }
  | { readonly kind: "RECOVERED"; readonly weekIndex: number }
  /** The modeled horizon ended while cumulative cash remained negative -- recovery is never invented beyond the modeled horizon (mandate section 28). */
  | { readonly kind: "NOT_REACHED_WITHIN_HORIZON" };

export interface WorkingCapitalEvaluation {
  /** Signed: the most negative cumulative cash position reached (<= 0), or a known $0 delta if cumulative cash never went negative. */
  readonly peakDeficit: MoneyDelta;
  /** null when cumulative cash never went negative. */
  readonly peakDeficitWeek: number | null;
  /** abs(peakDeficit) -- never negative. Explicit known zero when cumulative cash never went negative (mandate section 26). */
  readonly workingCapitalRequirement: MoneyAmount;
  /** First week cumulative cash goes negative; null if it never does. */
  readonly fundingNeededWeek: number | null;
  readonly recovery: FundingRecoveryStatus;
}

/**
 * The whole evaluation is wrapped in one DerivedEconomicResult rather than
 * wrapping each field separately: every field here depends on the same
 * underlying ledger, so a single blocking condition (the ledger itself being
 * UNKNOWN/UNAVAILABLE) must block all of them together, not selectively.
 */
export function evaluateWorkingCapital(ledger: DerivedEconomicResult<WeeklyCashLedger>): DerivedEconomicResult<WorkingCapitalEvaluation> {
  if (ledger.state !== "KNOWN") return ledger;
  const { entries, currency } = ledger.value;

  let minCumulative = 0;
  let minWeek: number | null = null;
  let fundingNeededWeek: number | null = null;
  for (const entry of entries) {
    if (entry.cumulativeCash.amount < 0 && fundingNeededWeek === null) fundingNeededWeek = entry.weekIndex;
    if (entry.cumulativeCash.amount < minCumulative) {
      minCumulative = entry.cumulativeCash.amount;
      minWeek = entry.weekIndex;
    }
  }

  const peakDeficit: MoneyDelta = { amount: minCumulative, currency };
  const workingCapitalRequirement = createMoneyAmount(Math.abs(minCumulative), currency);

  let recovery: FundingRecoveryStatus;
  if (minWeek === null) {
    recovery = { kind: "NOT_APPLICABLE" };
  } else {
    const recoveryEntry = entries.find((entry) => entry.weekIndex >= minWeek! && entry.cumulativeCash.amount >= 0);
    recovery = recoveryEntry ? { kind: "RECOVERED", weekIndex: recoveryEntry.weekIndex } : { kind: "NOT_REACHED_WITHIN_HORIZON" };
  }

  return { state: "KNOWN", tier: ledger.tier, value: { peakDeficit, peakDeficitWeek: minWeek, workingCapitalRequirement, fundingNeededWeek, recovery } };
}
