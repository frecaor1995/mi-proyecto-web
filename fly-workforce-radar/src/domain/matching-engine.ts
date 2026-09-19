/**
 * MATCHING-B1-D. Pure, deterministic engine types. No scoring, no ranking,
 * no AI -- an outcome is always derived from explicit criterion states
 * through the fixed precedence rules in evaluate-worker-demand-match.ts.
 *
 * Five-state model per MATCHING-B1-B/B1-C authorization. UNKNOWN != VIOLATED
 * is the core invariant everywhere in this module: missing information is
 * never allowed to become an affirmative mismatch.
 */

export const CRITERION_IMPORTANCES = ["HARD", "PREFERRED"] as const;
export type CriterionImportance = (typeof CRITERION_IMPORTANCES)[number];

export const CRITERION_STATES = ["SATISFIED", "SATISFIED_WITH_LIMITATION", "VIOLATED", "UNKNOWN", "NOT_APPLICABLE"] as const;
export type CriterionState = (typeof CRITERION_STATES)[number];

export const CRITERION_KEYS = [
  "TRADE",
  "OCCUPATION",
  "MINIMUM_EXPERIENCE",
  "REQUIRED_SKILL",
  "PREFERRED_SKILL",
  "REQUIRED_CREDENTIAL",
  "PREFERRED_CREDENTIAL",
  "AVAILABILITY",
  "COMPENSATION",
] as const;
export type CriterionKey = (typeof CRITERION_KEYS)[number];

/**
 * `subject` distinguishes repeated per-item criteria (one row per skill/
 * credential code); it is null for the singleton criteria (TRADE,
 * OCCUPATION, MINIMUM_EXPERIENCE, AVAILABILITY, COMPENSATION).
 * `observedDemand`/`observedWorker` are deliberately plain, PII-free strings
 * (codes, ISO dates, small numbers, enum states) -- never a name, contact
 * value, consent state, or raw credential identifier, because the engine
 * never receives those in the first place (MatchingReadyDemandInput /
 * MatchingReadyWorkerInput already exclude them, MATCHING-B1-C).
 */
export interface CriterionEvaluation {
  readonly criterion: CriterionKey;
  readonly subject: string | null;
  readonly importance: CriterionImportance;
  readonly state: CriterionState;
  readonly reasonCode: string;
  readonly observedDemand: string | null;
  readonly observedWorker: string | null;
}

export const MATCH_OUTCOMES = ["STRONG_MATCH", "POSSIBLE_MATCH", "NO_MATCH", "INSUFFICIENT_DATA"] as const;
export type MatchOutcome = (typeof MATCH_OUTCOMES)[number];

export interface WorkerDemandMatchEvaluation {
  readonly outcome: MatchOutcome;
  readonly criteria: readonly CriterionEvaluation[];
}

export const WORKER_INELIGIBLE_REASONS = ["WORKER_LIFECYCLE_INACTIVE", "WORKER_LIFECYCLE_ARCHIVED"] as const;
export type WorkerIneligibleReason = (typeof WORKER_INELIGIBLE_REASONS)[number];

/**
 * Eligibility (can this worker be matched at all) and qualification (does
 * this worker fit this demand) are distinct concerns (MATCHING-B1-C
 * eligibility.ts) -- an ineligible worker never reaches criterion
 * evaluation and is never described as NO_MATCH, which is a qualification
 * outcome.
 */
export type WorkerDemandMatchResult =
  | { readonly kind: "INELIGIBLE"; readonly reason: WorkerIneligibleReason }
  | { readonly kind: "EVALUATED"; readonly evaluation: WorkerDemandMatchEvaluation };
