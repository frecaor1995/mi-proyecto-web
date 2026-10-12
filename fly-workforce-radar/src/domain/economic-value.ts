/**
 * Phase 4B. Foundational money/rate/fact-tier primitives shared by
 * commercial-economics.ts, burden-profile.ts, and commercial-terms.ts.
 * Kept in its own module (a small, disclosed deviation from the phase's
 * three-file guidance) purely to avoid a circular import between those
 * three files, which all need these primitives and one of which
 * (commercial-economics.ts) also composes the other two.
 *
 * Domain-only: no persistence, no Supabase, no server/read-model import.
 * MoneyAmount below intentionally mirrors the shape (not the layer) of the
 * existing server/read-models/shared.ts MetricValue precedent
 * (KNOWN/UNKNOWN/UNAVAILABLE) rather than importing across layers -- the
 * domain layer must not depend on the read-model layer above it.
 */

/* ------------------------------------------------------------------------ */
/* Money                                                                     */
/* ------------------------------------------------------------------------ */

/** Structural ISO-4217 shape check only (three uppercase letters) -- this
 * module does not embed or validate against the real official currency
 * list; that is a policy choice, not an oversight (see 4B report section G). */
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/**
 * An absolute monetary quantity (a rate, a per-diem amount, a bill rate).
 * Always non-negative -- Phase 4B authorizes no exception. Zero is a
 * legitimate value (e.g. $0 per diem, genuinely offered); UNKNOWN is never
 * represented as amount: 0 -- see EconomicValue below, which is the only
 * sanctioned way to represent "not known."
 */
export interface MoneyAmount {
  readonly amount: number;
  readonly currency: string;
}
export function createMoneyAmount(amount: number, currency: string): MoneyAmount {
  if (!Number.isFinite(amount)) throw new Error("Money amount must be a finite number");
  if (amount < 0) throw new Error("Negative money amounts are not authorized in this domain");
  if (!CURRENCY_CODE_PATTERN.test(currency)) throw new Error("Currency must be an ISO-4217-shaped 3-letter uppercase code");
  return { amount, currency };
}

/**
 * A SIGNED monetary difference (gross profit, a loss). Deliberately a
 * separate type from MoneyAmount rather than an exception carved into it --
 * MoneyAmount itself (a rate, a per-diem, a bill rate) may never be
 * negative; a DERIVED difference between two such amounts legitimately can
 * be (a loss-making scenario). Never used as an input, only as an output.
 */
export interface MoneyDelta {
  readonly amount: number;
  readonly currency: string;
}

export type CurrencyOperationResult<T> =
  | { readonly outcome: "OK"; readonly result: T }
  | { readonly outcome: "CURRENCY_MISMATCH"; readonly currencies: readonly [string, string] };

export function addMoney(a: MoneyAmount, b: MoneyAmount): CurrencyOperationResult<MoneyAmount> {
  if (a.currency !== b.currency) return { outcome: "CURRENCY_MISMATCH", currencies: [a.currency, b.currency] };
  return { outcome: "OK", result: createMoneyAmount(a.amount + b.amount, a.currency) };
}
export function subtractMoney(a: MoneyAmount, b: MoneyAmount): CurrencyOperationResult<MoneyDelta> {
  if (a.currency !== b.currency) return { outcome: "CURRENCY_MISMATCH", currencies: [a.currency, b.currency] };
  return { outcome: "OK", result: { amount: a.amount - b.amount, currency: a.currency } };
}
/** factor must itself be non-negative (a MoneyAmount stays non-negative under multiplication by a non-negative factor); use a burdened/loaded rate this way, never to introduce a sign. */
export function multiplyMoney(a: MoneyAmount, factor: number): MoneyAmount {
  if (!Number.isFinite(factor) || factor < 0) throw new Error("A money multiplication factor must be a non-negative finite number");
  return createMoneyAmount(a.amount * factor, a.currency);
}

/* ------------------------------------------------------------------------ */
/* Rates / percentages -- canonical decimal-fraction convention             */
/* ------------------------------------------------------------------------ */

/**
 * Canonical decimal-fraction rate: 25% = 0.25, 150% = 1.50. Used uniformly
 * for both burden percentages and multipliers (an OT multiplier of 1.5x is
 * exactly as valid a Rate as a 7.65% payroll-tax burden). Always
 * non-negative; a margin/profit percentage that can legitimately be
 * negative uses SignedRate instead, never this type.
 */
export interface Rate {
  readonly value: number;
}
export function createRate(value: number): Rate {
  if (!Number.isFinite(value)) throw new Error("Rate must be a finite number");
  if (value < 0) throw new Error("Negative rates are not authorized in this domain");
  return { value };
}
/** Explicit, named conversion for the one legitimate normalization case: a human entered "25" meaning 25%. Never applied silently/automatically. */
export function percentageToDecimalFraction(percent: number): number {
  return percent / 100;
}

/** A signed decimal-fraction rate (e.g. gross margin, which can be negative for a loss). Never used for burden/OT inputs, only for derived profitability outputs. */
export interface SignedRate {
  readonly value: number;
}
export function createSignedRate(value: number): SignedRate {
  if (!Number.isFinite(value)) throw new Error("Signed rate must be a finite number");
  return { value };
}

/* ------------------------------------------------------------------------ */
/* Economic fact tier                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Economics-specific fact/assumption vocabulary. This is NOT a replacement
 * for, and must never be confused with, the existing canonical trust
 * vocabularies (VerificationState, BuyerEvidenceState, IntelligenceState,
 * AggregationReviewState, ReadModelTrustState, AssertionKind) -- it exists
 * only to express economics semantics, and is intended to be POPULATED FROM
 * those vocabularies by a future integration layer (4C+), never to replace
 * them:
 *   VERIFIED            <- a claim with verificationState "VERIFIED"
 *   UNVERIFIED_SOURCED  <- a claim exists but is UNVERIFIED, or assertionKind is INFERENCE
 *   OPERATOR_ASSUMPTION <- NOT a claim at all; a scenario-only input with no evidence
 *   UNKNOWN             <- nothing supplied
 */
export const ECONOMIC_FACT_TIERS = ["VERIFIED", "UNVERIFIED_SOURCED", "OPERATOR_ASSUMPTION", "UNKNOWN"] as const;
export type EconomicFactTier = (typeof ECONOMIC_FACT_TIERS)[number];

/** Ordering used only for weakest-input propagation (lower = weaker). UNKNOWN is weakest by construction, which is what makes weakestTier() naturally return UNKNOWN whenever any input is UNKNOWN. */
const TIER_STRENGTH: Readonly<Record<EconomicFactTier, number>> = {
  UNKNOWN: 0, OPERATOR_ASSUMPTION: 1, UNVERIFIED_SOURCED: 2, VERIFIED: 3,
};

export function weakestTier(tiers: readonly EconomicFactTier[]): EconomicFactTier {
  if (tiers.length === 0) return "UNKNOWN";
  return tiers.reduce((weakest, tier) => (TIER_STRENGTH[tier] < TIER_STRENGTH[weakest] ? tier : weakest));
}

/** Narrower variant for callers who have already excluded UNKNOWN from every input (e.g. behind an early UNKNOWN-guard) -- the result can never be UNKNOWN either, since weakestTier only ever returns one of its own inputs. */
export function weakestNonUnknownTier(tiers: readonly Exclude<EconomicFactTier, "UNKNOWN">[]): Exclude<EconomicFactTier, "UNKNOWN"> {
  return weakestTier(tiers) as Exclude<EconomicFactTier, "UNKNOWN">;
}

/**
 * A tier-tagged economic input. Structurally impossible to pair a real
 * value with the UNKNOWN tier -- the UNKNOWN variant carries no `value`
 * field at all, so "unknown bill rate" can never be represented as
 * `{tier:"UNKNOWN", value:0}` or similar; there is no such shape to construct.
 */
export type EconomicValue<T> =
  | { readonly tier: Exclude<EconomicFactTier, "UNKNOWN">; readonly value: T }
  | { readonly tier: "UNKNOWN" };

export function verifiedValue<T>(value: T): EconomicValue<T> { return { tier: "VERIFIED", value }; }
export function unverifiedSourcedValue<T>(value: T): EconomicValue<T> { return { tier: "UNVERIFIED_SOURCED", value }; }
export function assumedValue<T>(value: T): EconomicValue<T> { return { tier: "OPERATOR_ASSUMPTION", value }; }
export function unknownValue<T>(): EconomicValue<T> { return { tier: "UNKNOWN" }; }

/**
 * A derived (calculated) economic result. Composes with the existing
 * MetricValue precedent's three-state shape (KNOWN/UNKNOWN/UNAVAILABLE)
 * while additionally carrying the propagated fact tier when KNOWN, so a
 * derived value can never be displayed or persisted as more certain than
 * the weakest of its contributing inputs (the weakest-input principle).
 */
export type DerivedEconomicResult<T> =
  | { readonly state: "KNOWN"; readonly tier: Exclude<EconomicFactTier, "UNKNOWN">; readonly value: T }
  | { readonly state: "UNKNOWN" }
  | { readonly state: "UNAVAILABLE"; readonly reason: string };

/**
 * The one deterministic mechanism for deriving a result's effective tier
 * from its contributing inputs. If ANY input is UNKNOWN, `compute` is never
 * invoked and the result is UNKNOWN -- an unknown required input prevents
 * the numeric result from being produced, it does not merely downgrade a
 * label attached to a fabricated number.
 */
export function deriveEconomicResult<T>(inputs: readonly EconomicValue<unknown>[], compute: () => T): DerivedEconomicResult<T> {
  const tier = weakestTier(inputs.map((input) => input.tier));
  if (tier === "UNKNOWN") return { state: "UNKNOWN" };
  return { state: "KNOWN", tier, value: compute() };
}
