import type { CriterionEvaluation, WorkerDemandMatchEvaluation, WorkerDemandMatchResult } from "../../domain/matching-engine";
import type { MatchingReadyDemandInput } from "../../domain/demand-matching";
import type { MatchingReadyTradeOccupation, MatchingReadyWorkerInput, WorkerLifecycleStatus } from "../../domain/worker";
import { isEligibleForMatching } from "./eligibility";

/**
 * MATCHING-B1-D / B1-D-R1. Pure, deterministic worker-demand match
 * evaluator.
 *
 * B1-D-R1 remediated the two input-fidelity gaps B1-D discovered and
 * documented (skill verification state, compensation negotiability): both
 * facts already existed in the published schema and were simply being
 * dropped by MatchingReadyWorkerInput's projection. Both now flow through,
 * so REQUIRED_SKILL/PREFERRED_SKILL and COMPENSATION can reach the full
 * range of states the D-series design always intended, symmetric with how
 * REQUIRED_CREDENTIAL already worked in B1-D.
 *
 * Pure: no SQL, no network, no auth lookup, no database mutation, no
 * Date.now()/Math.random() -- `evaluationDate` is always the caller-supplied
 * explicit instant. Same demand + worker + evaluationDate always produces
 * the same criteria (same order) and the same outcome.
 */

export interface EvaluateWorkerDemandMatchInput {
  readonly demand: MatchingReadyDemandInput;
  readonly worker: MatchingReadyWorkerInput;
  readonly workerLifecycleStatus: WorkerLifecycleStatus;
  readonly evaluationDate: Date;
}

export function evaluateWorkerDemandMatch(input: EvaluateWorkerDemandMatchInput): WorkerDemandMatchResult {
  if (!isEligibleForMatching(input.workerLifecycleStatus)) {
    return { kind: "INELIGIBLE", reason: input.workerLifecycleStatus === "INACTIVE" ? "WORKER_LIFECYCLE_INACTIVE" : "WORKER_LIFECYCLE_ARCHIVED" };
  }

  const relevantTradeOccupation = findRelevantTradeOccupation(input.demand, input.worker.tradeOccupations);

  const criteria: CriterionEvaluation[] = [
    evaluateTrade(input.demand, input.worker.tradeOccupations),
    evaluateOccupation(input.demand, input.worker.tradeOccupations),
    evaluateMinimumExperience(input.demand, relevantTradeOccupation),
    ...input.demand.skills.map((requirement) => evaluateSkillRequirement(requirement, input.worker.skills)),
    ...input.demand.credentials.map((requirement) => evaluateCredentialRequirement(requirement, input.worker.credentials, input.evaluationDate)),
    evaluateAvailability(input.demand, input.worker.availability),
    evaluateCompensation(input.demand, input.worker.compensation),
  ];

  return { kind: "EVALUATED", evaluation: { outcome: aggregateOutcome(criteria), criteria } };
}

/* -------------------------------------------------------------------- */
/* Shared trade/occupation lookup                                        */
/* -------------------------------------------------------------------- */

/**
 * The single worker trade/occupation row used by TRADE, OCCUPATION and
 * MINIMUM_EXPERIENCE so all three evaluate against a consistent assignment,
 * not three independently-picked rows. Preference order: an exact
 * trade+occupation match (PRIMARY over SECONDARY), else an exact trade-only
 * match (PRIMARY over SECONDARY), else an exact occupation-only match (when
 * the demand specifies an occupation but no trade). Returns null when
 * nothing in the demand identifies a specific assignment to look up, or
 * when no worker row matches.
 */
function findRelevantTradeOccupation(demand: MatchingReadyDemandInput, rows: readonly MatchingReadyTradeOccupation[]): MatchingReadyTradeOccupation | null {
  if (demand.tradeCode === null && demand.occupationCode === null) return null;

  const byPrimaryThenSecondary = (candidates: readonly MatchingReadyTradeOccupation[]): MatchingReadyTradeOccupation | null =>
    candidates.find((r) => r.roleDesignation === "PRIMARY") ?? candidates[0] ?? null;

  if (demand.tradeCode !== null && demand.occupationCode !== null) {
    const exact = rows.filter((r) => r.tradeCode === demand.tradeCode && r.occupationCode === demand.occupationCode);
    if (exact.length > 0) return byPrimaryThenSecondary(exact);
  }
  if (demand.tradeCode !== null) {
    const tradeOnly = rows.filter((r) => r.tradeCode === demand.tradeCode);
    if (tradeOnly.length > 0) return byPrimaryThenSecondary(tradeOnly);
  }
  if (demand.occupationCode !== null) {
    const occupationOnly = rows.filter((r) => r.occupationCode === demand.occupationCode);
    if (occupationOnly.length > 0) return byPrimaryThenSecondary(occupationOnly);
  }
  return null;
}

/* -------------------------------------------------------------------- */
/* D5 -- TRADE                                                           */
/* -------------------------------------------------------------------- */

function evaluateTrade(demand: MatchingReadyDemandInput, rows: readonly MatchingReadyTradeOccupation[]): CriterionEvaluation {
  const base = { criterion: "TRADE" as const, subject: null, importance: "HARD" as const };
  if (demand.tradeCode === null) {
    return { ...base, state: "NOT_APPLICABLE", reasonCode: "DEMAND_TRADE_NOT_SPECIFIED", observedDemand: null, observedWorker: null };
  }
  const matches = rows.filter((r) => r.tradeCode === demand.tradeCode);
  if (matches.length === 0) {
    // No matching trade row != VIOLATED -- the worker's trade set is not
    // certified as a complete enumeration of everything they can perform.
    return { ...base, state: "UNKNOWN", reasonCode: "WORKER_TRADE_UNKNOWN", observedDemand: demand.tradeCode, observedWorker: null };
  }
  const primary = matches.find((r) => r.roleDesignation === "PRIMARY");
  if (primary) {
    return { ...base, state: "SATISFIED", reasonCode: "TRADE_MATCH_PRIMARY", observedDemand: demand.tradeCode, observedWorker: "PRIMARY" };
  }
  return { ...base, state: "SATISFIED_WITH_LIMITATION", reasonCode: "TRADE_MATCH_SECONDARY", observedDemand: demand.tradeCode, observedWorker: "SECONDARY" };
}

/* -------------------------------------------------------------------- */
/* D6 -- OCCUPATION                                                      */
/* -------------------------------------------------------------------- */

function evaluateOccupation(demand: MatchingReadyDemandInput, rows: readonly MatchingReadyTradeOccupation[]): CriterionEvaluation {
  const base = { criterion: "OCCUPATION" as const, subject: null, importance: "HARD" as const };
  if (demand.occupationCode === null) {
    return { ...base, state: "NOT_APPLICABLE", reasonCode: "DEMAND_OCCUPATION_NOT_SPECIFIED", observedDemand: null, observedWorker: null };
  }
  const matches = rows.filter(
    (r) => r.occupationCode === demand.occupationCode && (demand.tradeCode === null || r.tradeCode === demand.tradeCode),
  );
  if (matches.length === 0) {
    // No affirmative fact in the published model proves incompatibility --
    // absence alone never becomes VIOLATED here.
    return { ...base, state: "UNKNOWN", reasonCode: "WORKER_OCCUPATION_UNKNOWN", observedDemand: demand.occupationCode, observedWorker: null };
  }
  return { ...base, state: "SATISFIED", reasonCode: "OCCUPATION_MATCH", observedDemand: demand.occupationCode, observedWorker: "MATCHED" };
}

/* -------------------------------------------------------------------- */
/* D7 -- MINIMUM EXPERIENCE                                              */
/* -------------------------------------------------------------------- */

function evaluateMinimumExperience(demand: MatchingReadyDemandInput, relevant: MatchingReadyTradeOccupation | null): CriterionEvaluation {
  const base = { criterion: "MINIMUM_EXPERIENCE" as const, subject: null, importance: "HARD" as const };
  if (demand.minimumExperienceMonths === null) {
    return { ...base, state: "NOT_APPLICABLE", reasonCode: "DEMAND_MINIMUM_EXPERIENCE_NOT_SPECIFIED", observedDemand: null, observedWorker: null };
  }
  if (relevant === null || relevant.experienceMonths === null) {
    return { ...base, state: "UNKNOWN", reasonCode: "WORKER_EXPERIENCE_UNKNOWN", observedDemand: String(demand.minimumExperienceMonths), observedWorker: null };
  }
  if (relevant.experienceMonths >= demand.minimumExperienceMonths) {
    return { ...base, state: "SATISFIED", reasonCode: "EXPERIENCE_MEETS_MINIMUM", observedDemand: String(demand.minimumExperienceMonths), observedWorker: String(relevant.experienceMonths) };
  }
  return { ...base, state: "VIOLATED", reasonCode: "EXPERIENCE_BELOW_MINIMUM", observedDemand: String(demand.minimumExperienceMonths), observedWorker: String(relevant.experienceMonths) };
}

/* -------------------------------------------------------------------- */
/* D8 -- SKILLS                                                          */
/* -------------------------------------------------------------------- */

function evaluateSkillRequirement(
  requirement: MatchingReadyDemandInput["skills"][number],
  workerSkills: MatchingReadyWorkerInput["skills"],
): CriterionEvaluation {
  const isHard = requirement.requirementLevel === "REQUIRED";
  const criterion = isHard ? ("REQUIRED_SKILL" as const) : ("PREFERRED_SKILL" as const);
  const importance = isHard ? ("HARD" as const) : ("PREFERRED" as const);
  const match = workerSkills.find((s) => s.skillCode === requirement.skillCode);

  if (!match) {
    return {
      criterion, subject: requirement.skillCode, importance, state: "UNKNOWN",
      reasonCode: isHard ? "REQUIRED_SKILL_UNKNOWN" : "PREFERRED_SKILL_UNKNOWN",
      observedDemand: requirement.skillCode, observedWorker: null,
    };
  }

  // REJECTED is an explicit, affirmative fact (a reviewer decided against
  // the claim) -- symmetric with how an expired/rejected credential is
  // treated, never inferred from mere absence.
  if (match.verificationState === "REJECTED") {
    return {
      criterion, subject: requirement.skillCode, importance, state: "VIOLATED",
      reasonCode: "SKILL_REJECTED",
      observedDemand: requirement.skillCode, observedWorker: "REJECTED",
    };
  }

  if (match.verificationState === "VERIFIED") {
    return {
      criterion, subject: requirement.skillCode, importance, state: "SATISFIED",
      reasonCode: isHard ? "REQUIRED_SKILL_VERIFIED" : "PREFERRED_SKILL_VERIFIED",
      observedDemand: requirement.skillCode, observedWorker: "VERIFIED",
    };
  }

  // UNVERIFIED or STALE -- a match exists but is not currently VERIFIED.
  return {
    criterion, subject: requirement.skillCode, importance, state: "SATISFIED_WITH_LIMITATION",
    reasonCode: isHard ? "REQUIRED_SKILL_UNVERIFIED" : "PREFERRED_SKILL_UNVERIFIED",
    observedDemand: requirement.skillCode, observedWorker: match.verificationState,
  };
}

/* -------------------------------------------------------------------- */
/* D9 -- CREDENTIALS                                                     */
/* -------------------------------------------------------------------- */

function evaluateCredentialRequirement(
  requirement: MatchingReadyDemandInput["credentials"][number],
  workerCredentials: MatchingReadyWorkerInput["credentials"],
  evaluationDate: Date,
): CriterionEvaluation {
  const isHard = requirement.requirementLevel === "REQUIRED";
  const criterion = isHard ? ("REQUIRED_CREDENTIAL" as const) : ("PREFERRED_CREDENTIAL" as const);
  const importance = isHard ? ("HARD" as const) : ("PREFERRED" as const);
  const match = workerCredentials.find((c) => c.credentialCode === requirement.credentialCode);

  if (!match) {
    return {
      criterion, subject: requirement.credentialCode, importance, state: "UNKNOWN",
      reasonCode: isHard ? "REQUIRED_CREDENTIAL_UNKNOWN" : "PREFERRED_CREDENTIAL_UNKNOWN",
      observedDemand: requirement.credentialCode, observedWorker: null,
    };
  }

  // Jurisdiction is never compared: the published worker credential record
  // carries no jurisdiction field at all, so a comparison could never be
  // "both explicit" -- conservative by construction, per D9.

  if (match.expiresAt !== null && match.expiresAt.getTime() <= evaluationDate.getTime()) {
    return {
      criterion, subject: requirement.credentialCode, importance, state: "VIOLATED",
      reasonCode: "CREDENTIAL_EXPIRED",
      observedDemand: requirement.credentialCode, observedWorker: match.expiresAt.toISOString(),
    };
  }

  if (match.verificationState === "REJECTED") {
    return {
      criterion, subject: requirement.credentialCode, importance, state: "VIOLATED",
      reasonCode: "CREDENTIAL_REJECTED",
      observedDemand: requirement.credentialCode, observedWorker: "REJECTED",
    };
  }

  if (match.verificationState === "VERIFIED") {
    return {
      criterion, subject: requirement.credentialCode, importance, state: "SATISFIED",
      reasonCode: isHard ? "REQUIRED_CREDENTIAL_VERIFIED" : "PREFERRED_CREDENTIAL_VERIFIED",
      observedDemand: requirement.credentialCode, observedWorker: "VERIFIED",
    };
  }

  // UNVERIFIED or STALE -- a match exists but is not currently VERIFIED.
  return {
    criterion, subject: requirement.credentialCode, importance, state: "SATISFIED_WITH_LIMITATION",
    reasonCode: isHard ? "REQUIRED_CREDENTIAL_UNVERIFIED" : "PREFERRED_CREDENTIAL_UNVERIFIED",
    observedDemand: requirement.credentialCode, observedWorker: match.verificationState,
  };
}

/* -------------------------------------------------------------------- */
/* D10 -- AVAILABILITY / START DATE                                      */
/* -------------------------------------------------------------------- */

function evaluateAvailability(demand: MatchingReadyDemandInput, availability: MatchingReadyWorkerInput["availability"]): CriterionEvaluation {
  const base = { criterion: "AVAILABILITY" as const, subject: null, importance: "HARD" as const };
  if (demand.startDate === null) {
    return { ...base, state: "NOT_APPLICABLE", reasonCode: "DEMAND_START_DATE_NOT_SPECIFIED", observedDemand: null, observedWorker: null };
  }
  const observedDemand = demand.startDate.toISOString();
  if (availability.state === "UNKNOWN") {
    return { ...base, state: "UNKNOWN", reasonCode: "WORKER_AVAILABILITY_UNKNOWN", observedDemand, observedWorker: null };
  }
  const { status, availableFrom } = availability.value;

  // Manager correction (MATCHING-B1-C authorization): COMMITTED always
  // evaluates as UNKNOWN, never inferred from availableFrom/availableUntil.
  if (status === "COMMITTED") {
    return { ...base, state: "UNKNOWN", reasonCode: "WORKER_COMMITTED_STATUS_UNKNOWN", observedDemand, observedWorker: "COMMITTED" };
  }
  if (status === "UNKNOWN") {
    return { ...base, state: "UNKNOWN", reasonCode: "WORKER_AVAILABILITY_UNKNOWN", observedDemand, observedWorker: "UNKNOWN" };
  }
  if (status === "AVAILABLE") {
    if (availableFrom === null || availableFrom.getTime() <= demand.startDate.getTime()) {
      return { ...base, state: "SATISFIED", reasonCode: "AVAILABLE_FOR_START", observedDemand, observedWorker: availableFrom?.toISOString() ?? "AVAILABLE" };
    }
    return { ...base, state: "VIOLATED", reasonCode: "WORKER_AVAILABLE_FROM_AFTER_REQUIRED_START", observedDemand, observedWorker: availableFrom.toISOString() };
  }
  // status === "UNAVAILABLE"
  if (availableFrom === null || availableFrom.getTime() > demand.startDate.getTime()) {
    return { ...base, state: "VIOLATED", reasonCode: "WORKER_UNAVAILABLE_FOR_START", observedDemand, observedWorker: availableFrom?.toISOString() ?? "UNAVAILABLE" };
  }
  // availableFrom <= startDate while marked UNAVAILABLE is ambiguous
  // (does the worker become available again in time, or not?) -- the
  // published model gives no unambiguous way to resolve that, so this
  // stays UNKNOWN rather than inferring SATISFIED.
  return { ...base, state: "UNKNOWN", reasonCode: "WORKER_AVAILABILITY_UNKNOWN", observedDemand, observedWorker: "UNAVAILABLE" };
}

/* -------------------------------------------------------------------- */
/* D11 -- COMPENSATION                                                   */
/* -------------------------------------------------------------------- */

const WORKER_RATE_TYPE_TO_PAY_PERIOD: Record<string, string> = { HOURLY: "HOURLY", DAILY: "DAILY", SALARY: "SALARY", PROJECT: "PROJECT" };

function evaluateCompensation(demand: MatchingReadyDemandInput, workerCompensation: MatchingReadyWorkerInput["compensation"]): CriterionEvaluation {
  const base = { criterion: "COMPENSATION" as const, subject: null, importance: "HARD" as const };

  if (demand.compensation.state === "UNKNOWN") {
    return { ...base, state: "NOT_APPLICABLE", reasonCode: "DEMAND_COMPENSATION_NOT_SPECIFIED", observedDemand: null, observedWorker: null };
  }
  if (workerCompensation.state === "UNKNOWN") {
    return { ...base, state: "UNKNOWN", reasonCode: "WORKER_COMPENSATION_UNKNOWN", observedDemand: null, observedWorker: null };
  }

  const demandComp = demand.compensation.value;
  const workerComp = workerCompensation.value;

  if (demandComp.payCurrency === null || demandComp.payCurrency !== workerComp.currency) {
    return { ...base, state: "UNKNOWN", reasonCode: "COMPENSATION_NOT_COMPARABLE", observedDemand: demandComp.payCurrency, observedWorker: workerComp.currency };
  }
  if (demandComp.payPeriod === null || WORKER_RATE_TYPE_TO_PAY_PERIOD[workerComp.rateType] !== demandComp.payPeriod) {
    return { ...base, state: "UNKNOWN", reasonCode: "COMPENSATION_PAY_PERIOD_NOT_COMPARABLE", observedDemand: demandComp.payPeriod, observedWorker: workerComp.rateType };
  }
  if (demandComp.basePayMax === null || workerComp.rateMin === null) {
    return { ...base, state: "UNKNOWN", reasonCode: "COMPENSATION_NOT_COMPARABLE", observedDemand: demandComp.basePayMax === null ? null : String(demandComp.basePayMax), observedWorker: workerComp.rateMin === null ? null : String(workerComp.rateMin) };
  }

  if (workerComp.rateMin <= demandComp.basePayMax) {
    return { ...base, state: "SATISFIED", reasonCode: "COMPENSATION_COMPATIBLE", observedDemand: String(demandComp.basePayMax), observedWorker: String(workerComp.rateMin) };
  }

  // A hard gap: worker minimum exceeds demand maximum. `negotiable` is an
  // explicit, already-published fact (never inferred) that decides whether
  // this is a follow-up-worthy limitation or a genuine disqualifier.
  if (workerComp.negotiable) {
    return { ...base, state: "SATISFIED_WITH_LIMITATION", reasonCode: "COMPENSATION_NEGOTIABLE_GAP", observedDemand: String(demandComp.basePayMax), observedWorker: String(workerComp.rateMin) };
  }
  return { ...base, state: "VIOLATED", reasonCode: "COMPENSATION_HARD_GAP", observedDemand: String(demandComp.basePayMax), observedWorker: String(workerComp.rateMin) };
}

/* -------------------------------------------------------------------- */
/* D3 -- FINAL OUTCOME AGGREGATION                                       */
/* -------------------------------------------------------------------- */

function aggregateOutcome(criteria: readonly CriterionEvaluation[]): WorkerDemandMatchEvaluation["outcome"] {
  const hard = criteria.filter((c) => c.importance === "HARD");
  const preferred = criteria.filter((c) => c.importance === "PREFERRED");

  if (hard.some((c) => c.state === "VIOLATED")) return "NO_MATCH";
  if (hard.some((c) => c.state === "UNKNOWN")) return "INSUFFICIENT_DATA";
  if (hard.some((c) => c.state === "SATISFIED_WITH_LIMITATION")) return "POSSIBLE_MATCH";
  if (preferred.some((c) => c.state === "VIOLATED" || c.state === "SATISFIED_WITH_LIMITATION")) return "POSSIBLE_MATCH";
  return "STRONG_MATCH";
}
