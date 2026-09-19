import { describe, expect, it } from "vitest";
import { evaluateWorkerDemandMatch } from "../../server/matching/evaluate-worker-demand-match";
import { knownFact, unknownFact, type MatchingReadyWorkerInput } from "../../domain/worker";
import type { MatchingReadyDemandInput } from "../../domain/demand-matching";
import type { CriterionEvaluation } from "../../domain/matching-engine";

/**
 * MATCHING-B1-D / B1-D-R1. Pure engine tests -- no PGlite, no database of
 * any kind. evaluateWorkerDemandMatch takes plain, in-memory fixture
 * objects built to exactly the shapes MatchingReadyDemandInput/
 * MatchingReadyWorkerInput already publish (MATCHING-B1-C, extended by
 * B1-D-R1 with per-skill verificationState and compensation.negotiable),
 * so these tests are also a live proof that the engine only ever consumes
 * the sanitized, published contract.
 *
 * B1-D-R1 replaced B1-D's two "documented gap" tests (a matched required
 * skill capped at SATISFIED_WITH_LIMITATION; a compensation gap always
 * UNKNOWN) with tests of the now-fully-implemented rules, since
 * MatchingReadyWorkerInput.skills and MatchingReadyCompensation.negotiable
 * now carry the facts those rules always needed.
 */

const EVALUATION_DATE = new Date("2026-09-18T00:00:00.000Z");

function baseDemand(overrides: Partial<MatchingReadyDemandInput> = {}): MatchingReadyDemandInput {
  return {
    demandSignalId: "demand-1",
    tradeCode: "ELECTRICAL",
    occupationCode: "ELECTRICIAN",
    minimumExperienceMonths: 24,
    skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }],
    credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: null }],
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    compensation: knownFact({ payCurrency: "USD", basePayMin: 28, basePayMax: 38, payPeriod: "HOURLY" }),
    ...overrides,
  };
}

function baseWorker(overrides: Partial<MatchingReadyWorkerInput> = {}): MatchingReadyWorkerInput {
  return {
    workerId: "worker-1",
    tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 36 }],
    skills: [{ skillCode: "TIG", verificationState: "VERIFIED" }],
    credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }],
    availability: knownFact({ status: "AVAILABLE", availableFrom: null }),
    location: unknownFact(),
    compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 34, currency: "USD", perDiemRequired: null, negotiable: false }),
    knownGaps: [],
    ...overrides,
  };
}

function evaluate(demand: MatchingReadyDemandInput, worker: MatchingReadyWorkerInput, lifecycleStatus: "ACTIVE" | "INACTIVE" | "ARCHIVED" = "ACTIVE") {
  return evaluateWorkerDemandMatch({ demand, worker, workerLifecycleStatus: lifecycleStatus, evaluationDate: EVALUATION_DATE });
}

function criterion(criteria: readonly CriterionEvaluation[], key: CriterionEvaluation["criterion"], subject: string | null = null): CriterionEvaluation | undefined {
  return criteria.find((c) => c.criterion === key && c.subject === subject);
}

describe("MATCHING-B1-D deterministic matching engine", () => {
  /* ------------------------------------------------------------------ */
  /* D17.1-3 -- eligibility                                              */
  /* ------------------------------------------------------------------ */

  it("1. ACTIVE worker enters qualification evaluation", () => {
    const result = evaluate(baseDemand(), baseWorker(), "ACTIVE");
    expect(result.kind).toBe("EVALUATED");
  });

  it("2. INACTIVE worker is ineligible", () => {
    const result = evaluate(baseDemand(), baseWorker(), "INACTIVE");
    expect(result).toEqual({ kind: "INELIGIBLE", reason: "WORKER_LIFECYCLE_INACTIVE" });
  });

  it("3. ARCHIVED worker is ineligible -- not NO_MATCH, a distinct kind entirely", () => {
    const result = evaluate(baseDemand(), baseWorker(), "ARCHIVED");
    expect(result).toEqual({ kind: "INELIGIBLE", reason: "WORKER_LIFECYCLE_ARCHIVED" });
    expect(result.kind).not.toBe("EVALUATED");
  });

  /* ------------------------------------------------------------------ */
  /* D17.4-7 -- trade (unchanged by B1-D-R1)                             */
  /* ------------------------------------------------------------------ */

  it("4. demand trade absent -> NOT_APPLICABLE", () => {
    const result = evaluate(baseDemand({ tradeCode: null }), baseWorker());
    expect(result.kind).toBe("EVALUATED");
    const trade = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "TRADE") : undefined;
    expect(trade?.state).toBe("NOT_APPLICABLE");
  });

  it("5. primary trade match -> SATISFIED", () => {
    const result = evaluate(baseDemand(), baseWorker({ tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 36 }] }));
    const trade = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "TRADE") : undefined;
    expect(trade?.state).toBe("SATISFIED");
    expect(trade?.reasonCode).toBe("TRADE_MATCH_PRIMARY");
  });

  it("6. secondary trade match -> SATISFIED_WITH_LIMITATION", () => {
    const result = evaluate(baseDemand(), baseWorker({ tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "SECONDARY", experienceMonths: 36 }] }));
    const trade = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "TRADE") : undefined;
    expect(trade?.state).toBe("SATISFIED_WITH_LIMITATION");
    expect(trade?.reasonCode).toBe("TRADE_MATCH_SECONDARY");
  });

  it("7. no matching trade -> UNKNOWN, never VIOLATED (worker's trade set is not a certified complete enumeration)", () => {
    const result = evaluate(baseDemand(), baseWorker({ tradeOccupations: [{ tradeCode: "WELDING", occupationCode: "WELDER", roleDesignation: "PRIMARY", experienceMonths: 60 }] }));
    const trade = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "TRADE") : undefined;
    expect(trade?.state).toBe("UNKNOWN");
    expect(trade?.reasonCode).toBe("WORKER_TRADE_UNKNOWN");
  });

  /* ------------------------------------------------------------------ */
  /* D17.8 -- occupation (unchanged by B1-D-R1)                          */
  /* ------------------------------------------------------------------ */

  it("8. occupation missing -> UNKNOWN", () => {
    const result = evaluate(baseDemand(), baseWorker({ tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICAL_FOREMAN", roleDesignation: "PRIMARY", experienceMonths: 36 }] }));
    const occupation = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "OCCUPATION") : undefined;
    expect(occupation?.state).toBe("UNKNOWN");
    expect(occupation?.reasonCode).toBe("WORKER_OCCUPATION_UNKNOWN");
  });

  /* ------------------------------------------------------------------ */
  /* D17.9-11 -- experience (unchanged by B1-D-R1)                       */
  /* ------------------------------------------------------------------ */

  it("9. experience exactly minimum -> SATISFIED", () => {
    const result = evaluate(baseDemand({ minimumExperienceMonths: 24 }), baseWorker({ tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 24 }] }));
    const experience = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "MINIMUM_EXPERIENCE") : undefined;
    expect(experience?.state).toBe("SATISFIED");
    expect(experience?.reasonCode).toBe("EXPERIENCE_MEETS_MINIMUM");
  });

  it("10. experience below minimum -> VIOLATED", () => {
    const result = evaluate(baseDemand({ minimumExperienceMonths: 24 }), baseWorker({ tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 6 }] }));
    const experience = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "MINIMUM_EXPERIENCE") : undefined;
    expect(experience?.state).toBe("VIOLATED");
    expect(experience?.reasonCode).toBe("EXPERIENCE_BELOW_MINIMUM");
  });

  it("11. experience absent -> UNKNOWN", () => {
    const result = evaluate(baseDemand({ minimumExperienceMonths: 24 }), baseWorker({ tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: null }] }));
    const experience = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "MINIMUM_EXPERIENCE") : undefined;
    expect(experience?.state).toBe("UNKNOWN");
    expect(experience?.reasonCode).toBe("WORKER_EXPERIENCE_UNKNOWN");
  });

  /* ------------------------------------------------------------------ */
  /* R1.7.2-6 / D17.12-15 -- skills (fully implemented by B1-D-R1)      */
  /* ------------------------------------------------------------------ */

  it("R1.7.2 / 12. VERIFIED required skill -> SATISFIED", () => {
    const result = evaluate(baseDemand({ skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }] }), baseWorker({ skills: [{ skillCode: "TIG", verificationState: "VERIFIED" }] }));
    const skill = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "REQUIRED_SKILL", "TIG") : undefined;
    expect(skill?.state).toBe("SATISFIED");
    expect(skill?.reasonCode).toBe("REQUIRED_SKILL_VERIFIED");
  });

  it("R1.7.3 / 13. UNVERIFIED required skill -> SATISFIED_WITH_LIMITATION", () => {
    const result = evaluate(baseDemand({ skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }] }), baseWorker({ skills: [{ skillCode: "TIG", verificationState: "UNVERIFIED" }] }));
    const skill = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "REQUIRED_SKILL", "TIG") : undefined;
    expect(skill?.state).toBe("SATISFIED_WITH_LIMITATION");
    expect(skill?.reasonCode).toBe("REQUIRED_SKILL_UNVERIFIED");
  });

  it("STALE required skill -> SATISFIED_WITH_LIMITATION (conservatively bucketed with UNVERIFIED, per R1.2)", () => {
    const result = evaluate(baseDemand({ skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }] }), baseWorker({ skills: [{ skillCode: "TIG", verificationState: "STALE" }] }));
    const skill = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "REQUIRED_SKILL", "TIG") : undefined;
    expect(skill?.state).toBe("SATISFIED_WITH_LIMITATION");
  });

  it("R1.7.5. explicit REJECTED skill -> HARD VIOLATED (an affirmative fact, not inferred from absence)", () => {
    const result = evaluate(baseDemand({ skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }] }), baseWorker({ skills: [{ skillCode: "TIG", verificationState: "REJECTED" }] }));
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    const skill = criterion(result.evaluation.criteria, "REQUIRED_SKILL", "TIG");
    expect(skill?.state).toBe("VIOLATED");
    expect(skill?.reasonCode).toBe("SKILL_REJECTED");
    expect(result.evaluation.outcome).toBe("NO_MATCH");
  });

  it("R1.7.4 / 14. required missing skill -> UNKNOWN", () => {
    const result = evaluate(baseDemand({ skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }] }), baseWorker({ skills: [] }));
    const skill = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "REQUIRED_SKILL", "TIG") : undefined;
    expect(skill?.state).toBe("UNKNOWN");
    expect(skill?.reasonCode).toBe("REQUIRED_SKILL_UNKNOWN");
  });

  it("R1.7.6 / 15. preferred missing skill never produces NO_MATCH or INSUFFICIENT_DATA by itself", () => {
    const result = evaluate(
      baseDemand({ skills: [{ skillCode: "CONTROLS", requirementLevel: "PREFERRED" }], credentials: [] }),
      baseWorker({ skills: [] }),
    );
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    const skill = criterion(result.evaluation.criteria, "PREFERRED_SKILL", "CONTROLS");
    expect(skill?.state).toBe("UNKNOWN");
    expect(result.evaluation.outcome).not.toBe("NO_MATCH");
    expect(result.evaluation.outcome).not.toBe("INSUFFICIENT_DATA");
  });

  it("verified preferred skill -> SATISFIED, same fact interpretation as required, PREFERRED importance", () => {
    const result = evaluate(baseDemand({ skills: [{ skillCode: "CONTROLS", requirementLevel: "PREFERRED" }], credentials: [] }), baseWorker({ skills: [{ skillCode: "CONTROLS", verificationState: "VERIFIED" }] }));
    const skill = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "PREFERRED_SKILL", "CONTROLS") : undefined;
    expect(skill?.state).toBe("SATISFIED");
    expect(skill?.importance).toBe("PREFERRED");
  });

  /* ------------------------------------------------------------------ */
  /* D17.16-20 -- credentials (unchanged by B1-D-R1)                     */
  /* ------------------------------------------------------------------ */

  it("16. verified valid credential -> SATISFIED", () => {
    const result = evaluate(baseDemand(), baseWorker({ credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }] }));
    const credential = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "REQUIRED_CREDENTIAL", "OSHA_10") : undefined;
    expect(credential?.state).toBe("SATISFIED");
    expect(credential?.reasonCode).toBe("REQUIRED_CREDENTIAL_VERIFIED");
  });

  it("17. unverified required credential -> limitation", () => {
    const result = evaluate(baseDemand(), baseWorker({ credentials: [{ credentialCode: "OSHA_10", verificationState: "UNVERIFIED", expiresAt: null }] }));
    const credential = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "REQUIRED_CREDENTIAL", "OSHA_10") : undefined;
    expect(credential?.state).toBe("SATISFIED_WITH_LIMITATION");
    expect(credential?.reasonCode).toBe("REQUIRED_CREDENTIAL_UNVERIFIED");
  });

  it("18. missing required credential -> UNKNOWN", () => {
    const result = evaluate(baseDemand(), baseWorker({ credentials: [] }));
    const credential = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "REQUIRED_CREDENTIAL", "OSHA_10") : undefined;
    expect(credential?.state).toBe("UNKNOWN");
    expect(credential?.reasonCode).toBe("REQUIRED_CREDENTIAL_UNKNOWN");
  });

  it("19. expired required credential -> VIOLATED", () => {
    const result = evaluate(baseDemand(), baseWorker({ credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: new Date("2026-01-01T00:00:00.000Z") }] }));
    const credential = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "REQUIRED_CREDENTIAL", "OSHA_10") : undefined;
    expect(credential?.state).toBe("VIOLATED");
    expect(credential?.reasonCode).toBe("CREDENTIAL_EXPIRED");
  });

  it("20. credential expiration uses the explicit evaluation date, never system time", () => {
    const futureExpiry = new Date("2026-12-01T00:00:00.000Z");
    const worker = baseWorker({ credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: futureExpiry }] });
    const beforeExpiry = evaluateWorkerDemandMatch({ demand: baseDemand(), worker, workerLifecycleStatus: "ACTIVE", evaluationDate: new Date("2026-09-18T00:00:00.000Z") });
    const afterExpiry = evaluateWorkerDemandMatch({ demand: baseDemand(), worker, workerLifecycleStatus: "ACTIVE", evaluationDate: new Date("2027-01-01T00:00:00.000Z") });
    const before = beforeExpiry.kind === "EVALUATED" ? criterion(beforeExpiry.evaluation.criteria, "REQUIRED_CREDENTIAL", "OSHA_10") : undefined;
    const after = afterExpiry.kind === "EVALUATED" ? criterion(afterExpiry.evaluation.criteria, "REQUIRED_CREDENTIAL", "OSHA_10") : undefined;
    expect(before?.state).toBe("SATISFIED");
    expect(after?.state).toBe("VIOLATED");
  });

  /* ------------------------------------------------------------------ */
  /* D17.21-23 -- availability (unchanged by B1-D-R1)                    */
  /* ------------------------------------------------------------------ */

  it("21. COMMITTED availability -> UNKNOWN, always (Manager correction)", () => {
    const result = evaluate(baseDemand(), baseWorker({ availability: knownFact({ status: "COMMITTED", availableFrom: new Date("2026-09-01T00:00:00.000Z") }) }));
    const availability = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "AVAILABILITY") : undefined;
    expect(availability?.state).toBe("UNKNOWN");
    expect(availability?.reasonCode).toBe("WORKER_COMMITTED_STATUS_UNKNOWN");
  });

  it("22. UNKNOWN availability fact -> UNKNOWN", () => {
    const result = evaluate(baseDemand(), baseWorker({ availability: unknownFact() }));
    const availability = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "AVAILABILITY") : undefined;
    expect(availability?.state).toBe("UNKNOWN");
    expect(availability?.reasonCode).toBe("WORKER_AVAILABILITY_UNKNOWN");
  });

  it("23. explicit incompatible UNAVAILABLE -> VIOLATED", () => {
    const result = evaluate(baseDemand({ startDate: new Date("2026-10-01T00:00:00.000Z") }), baseWorker({ availability: knownFact({ status: "UNAVAILABLE", availableFrom: new Date("2026-12-01T00:00:00.000Z") }) }));
    const availability = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "AVAILABILITY") : undefined;
    expect(availability?.state).toBe("VIOLATED");
    expect(availability?.reasonCode).toBe("WORKER_UNAVAILABLE_FOR_START");
  });

  /* ------------------------------------------------------------------ */
  /* R1.7.8-12 / D17.24-28 -- compensation (fully implemented by B1-D-R1)*/
  /* ------------------------------------------------------------------ */

  it("24. compatible compensation -> SATISFIED", () => {
    const result = evaluate(baseDemand({ compensation: knownFact({ payCurrency: "USD", basePayMin: 28, basePayMax: 38, payPeriod: "HOURLY" }) }), baseWorker({ compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 34, currency: "USD", perDiemRequired: null, negotiable: false }) }));
    const compensation = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "COMPENSATION") : undefined;
    expect(compensation?.state).toBe("SATISFIED");
    expect(compensation?.reasonCode).toBe("COMPENSATION_COMPATIBLE");
  });

  it("R1.7.8 / 25. negotiable=true compensation gap -> SATISFIED_WITH_LIMITATION, and may reach POSSIBLE_MATCH when no other blocker exists (never NO_MATCH by itself)", () => {
    const result = evaluate(
      baseDemand({ skills: [], credentials: [], compensation: knownFact({ payCurrency: "USD", basePayMin: 20, basePayMax: 25, payPeriod: "HOURLY" }) }),
      baseWorker({ compensation: knownFact({ rateType: "HOURLY", rateMin: 40, ratePreferred: 45, currency: "USD", perDiemRequired: null, negotiable: true }) }),
    );
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    const compensation = criterion(result.evaluation.criteria, "COMPENSATION");
    expect(compensation?.state).toBe("SATISFIED_WITH_LIMITATION");
    expect(compensation?.reasonCode).toBe("COMPENSATION_NEGOTIABLE_GAP");
    expect(result.evaluation.outcome).toBe("POSSIBLE_MATCH");
  });

  it("R1.7.9 / R1.7.10 / 26. negotiable=false compensation gap -> HARD VIOLATED -> NO_MATCH", () => {
    const result = evaluate(
      baseDemand({ compensation: knownFact({ payCurrency: "USD", basePayMin: 20, basePayMax: 25, payPeriod: "HOURLY" }) }),
      baseWorker({ compensation: knownFact({ rateType: "HOURLY", rateMin: 40, ratePreferred: 45, currency: "USD", perDiemRequired: null, negotiable: false }) }),
    );
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    const compensation = criterion(result.evaluation.criteria, "COMPENSATION");
    expect(compensation?.state).toBe("VIOLATED");
    expect(compensation?.reasonCode).toBe("COMPENSATION_HARD_GAP");
    expect(result.evaluation.outcome).toBe("NO_MATCH");
  });

  it("ratePreferred is never used as a hard rejection threshold -- only rateMin is compared", () => {
    // worker minimum is within range even though ratePreferred alone would exceed the demand maximum.
    const result = evaluate(
      baseDemand({ skills: [], credentials: [], compensation: knownFact({ payCurrency: "USD", basePayMin: 20, basePayMax: 30, payPeriod: "HOURLY" }) }),
      baseWorker({ compensation: knownFact({ rateType: "HOURLY", rateMin: 25, ratePreferred: 50, currency: "USD", perDiemRequired: null, negotiable: false }) }),
    );
    const compensation = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "COMPENSATION") : undefined;
    expect(compensation?.state).toBe("SATISFIED");
  });

  it("R1.7.11 / 27. incompatible currency -> UNKNOWN, not rejection", () => {
    const result = evaluate(baseDemand({ compensation: knownFact({ payCurrency: "USD", basePayMin: 28, basePayMax: 38, payPeriod: "HOURLY" }) }), baseWorker({ compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 34, currency: "MXN", perDiemRequired: null, negotiable: false }) }));
    const compensation = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "COMPENSATION") : undefined;
    expect(compensation?.state).toBe("UNKNOWN");
    expect(compensation?.reasonCode).toBe("COMPENSATION_NOT_COMPARABLE");
  });

  it("R1.7.12 / 28. incompatible pay period -> UNKNOWN, not rejection", () => {
    const result = evaluate(baseDemand({ compensation: knownFact({ payCurrency: "USD", basePayMin: 28, basePayMax: 38, payPeriod: "HOURLY" }) }), baseWorker({ compensation: knownFact({ rateType: "SALARY", rateMin: 60000, ratePreferred: 65000, currency: "USD", perDiemRequired: null, negotiable: false }) }));
    const compensation = result.kind === "EVALUATED" ? criterion(result.evaluation.criteria, "COMPENSATION") : undefined;
    expect(compensation?.state).toBe("UNKNOWN");
    expect(compensation?.reasonCode).toBe("COMPENSATION_PAY_PERIOD_NOT_COMPARABLE");
  });

  /* ------------------------------------------------------------------ */
  /* D17.29-32 -- aggregation precedence (unchanged by B1-D-R1)          */
  /* ------------------------------------------------------------------ */

  it("29. hard VIOLATED outranks hard UNKNOWN -> NO_MATCH", () => {
    const result = evaluate(
      baseDemand({ minimumExperienceMonths: 24 }),
      baseWorker({
        tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 6 }],
        credentials: [],
      }),
    );
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    const experience = criterion(result.evaluation.criteria, "MINIMUM_EXPERIENCE");
    const credential = criterion(result.evaluation.criteria, "REQUIRED_CREDENTIAL", "OSHA_10");
    expect(experience?.state).toBe("VIOLATED");
    expect(credential?.state).toBe("UNKNOWN");
    expect(result.evaluation.outcome).toBe("NO_MATCH");
  });

  it("30. hard UNKNOWN without any violation -> INSUFFICIENT_DATA", () => {
    const result = evaluate(baseDemand(), baseWorker({ tradeOccupations: [], credentials: [] }));
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    expect(result.evaluation.criteria.some((c) => c.importance === "HARD" && c.state === "VIOLATED")).toBe(false);
    expect(result.evaluation.criteria.some((c) => c.importance === "HARD" && c.state === "UNKNOWN")).toBe(true);
    expect(result.evaluation.outcome).toBe("INSUFFICIENT_DATA");
  });

  it("31. hard limitation without unknown or violation -> POSSIBLE_MATCH", () => {
    // The trade match is SECONDARY (a hard SATISFIED_WITH_LIMITATION); nothing else is unknown/violated.
    const result = evaluate(
      baseDemand({ skills: [], credentials: [] }),
      baseWorker({ tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "SECONDARY", experienceMonths: 36 }] }),
    );
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    expect(result.evaluation.criteria.some((c) => c.importance === "HARD" && (c.state === "VIOLATED" || c.state === "UNKNOWN"))).toBe(false);
    expect(result.evaluation.outcome).toBe("POSSIBLE_MATCH");
  });

  it("32. all hard satisfied, no material limitation -> STRONG_MATCH", () => {
    const result = evaluate(baseDemand({ skills: [], credentials: [] }), baseWorker());
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    expect(result.evaluation.outcome).toBe("STRONG_MATCH");
  });

  it("32b. now that skills are fully implemented, a verified required skill also allows STRONG_MATCH", () => {
    const result = evaluate(baseDemand(), baseWorker());
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    expect(result.evaluation.outcome).toBe("STRONG_MATCH");
  });

  /* ------------------------------------------------------------------ */
  /* R1.8 / D17.33-34 -- privacy                                         */
  /* ------------------------------------------------------------------ */

  it("R1.8 / 33. contact consent has no field to affect the result -- the engine input structurally excludes it", () => {
    const result = evaluate(baseDemand(), baseWorker());
    expect(result.kind).toBe("EVALUATED");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/consent/i);
    expect(serialized).not.toMatch(/contactRoute/i);
  });

  it("R1.8 / 34. raw credential identifier, phone, email, and precise address never appear in the output", () => {
    const result = evaluate(baseDemand(), baseWorker());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/rawIdentifier/i);
    expect(serialized).not.toMatch(/555-0100/);
    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/streetAddress|postalCode|latitude|longitude/i);
  });

  /* ------------------------------------------------------------------ */
  /* R1.7.14 / D17.35-36 -- determinism                                  */
  /* ------------------------------------------------------------------ */

  it("35. stable criterion ordering across repeated skill/credential requirements, following input array order", () => {
    const demand = baseDemand({
      skills: [{ skillCode: "SMAW", requirementLevel: "PREFERRED" }, { skillCode: "TIG", requirementLevel: "REQUIRED" }],
      credentials: [{ credentialCode: "OSHA_30", requirementLevel: "PREFERRED", jurisdiction: null }, { credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: null }],
    });
    const result = evaluate(demand, baseWorker({ skills: [{ skillCode: "TIG", verificationState: "VERIFIED" }, { skillCode: "SMAW", verificationState: "VERIFIED" }], credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }, { credentialCode: "OSHA_30", verificationState: "VERIFIED", expiresAt: null }] }));
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") throw new Error("unreachable");
    const skillSubjects = result.evaluation.criteria.filter((c) => c.criterion === "REQUIRED_SKILL" || c.criterion === "PREFERRED_SKILL").map((c) => c.subject);
    const credentialSubjects = result.evaluation.criteria.filter((c) => c.criterion === "REQUIRED_CREDENTIAL" || c.criterion === "PREFERRED_CREDENTIAL").map((c) => c.subject);
    expect(skillSubjects).toEqual(["SMAW", "TIG"]);
    expect(credentialSubjects).toEqual(["OSHA_30", "OSHA_10"]);
  });

  it("R1.7.14 / 36. identical demand/worker/evaluationDate inputs always produce an identical result", () => {
    const demand = baseDemand();
    const worker = baseWorker();
    const first = evaluateWorkerDemandMatch({ demand, worker, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE });
    const second = evaluateWorkerDemandMatch({ demand, worker, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE });
    expect(first).toEqual(second);
  });

  /* ------------------------------------------------------------------ */
  /* R1.6 / R1.7.13 / D16 -- mandatory four-worker fixture proof         */
  /* ------------------------------------------------------------------ */

  describe("R1.6 four-worker fixture proof (now exercising the restored skill/compensation facts)", () => {
    const demandFull = baseDemand();

    it("WORKER_A: a VERIFIED required skill, a VERIFIED required credential, and every other hard criterion satisfied -> STRONG_MATCH", () => {
      const workerA = baseWorker({
        tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 60 }],
        skills: [{ skillCode: "TIG", verificationState: "VERIFIED" }],
        credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }],
        availability: knownFact({ status: "AVAILABLE", availableFrom: null }),
        compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 34, currency: "USD", perDiemRequired: null, negotiable: false }),
      });
      const result = evaluate(demandFull, workerA);
      expect(result.kind).toBe("EVALUATED");
      if (result.kind !== "EVALUATED") throw new Error("unreachable");
      expect(result.evaluation.outcome).toBe("STRONG_MATCH");
    });

    it("WORKER_B: an UNVERIFIED required skill (no hard violation, one limitation) -> POSSIBLE_MATCH", () => {
      const workerB = baseWorker({
        tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 60 }],
        skills: [{ skillCode: "TIG", verificationState: "UNVERIFIED" }],
        credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }],
        availability: knownFact({ status: "AVAILABLE", availableFrom: null }),
        compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 34, currency: "USD", perDiemRequired: null, negotiable: false }),
      });
      const result = evaluate(demandFull, workerB);
      expect(result.kind).toBe("EVALUATED");
      if (result.kind !== "EVALUATED") throw new Error("unreachable");
      expect(result.evaluation.criteria.some((c) => c.importance === "HARD" && c.state === "VIOLATED")).toBe(false);
      expect(result.evaluation.criteria.some((c) => c.importance === "HARD" && c.state === "UNKNOWN")).toBe(false);
      expect(result.evaluation.outcome).toBe("POSSIBLE_MATCH");
    });

    it("WORKER_B-alternate: a negotiable compensation gap (no hard violation, one limitation) -> POSSIBLE_MATCH", () => {
      const workerBAlt = baseWorker({
        tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 60 }],
        skills: [{ skillCode: "TIG", verificationState: "VERIFIED" }],
        credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }],
        availability: knownFact({ status: "AVAILABLE", availableFrom: null }),
        compensation: knownFact({ rateType: "HOURLY", rateMin: 50, ratePreferred: 55, currency: "USD", perDiemRequired: null, negotiable: true }),
      });
      const result = evaluate(demandFull, workerBAlt);
      expect(result.kind).toBe("EVALUATED");
      if (result.kind !== "EVALUATED") throw new Error("unreachable");
      expect(result.evaluation.outcome).toBe("POSSIBLE_MATCH");
    });

    it("WORKER_C: an affirmative hard violation (experience below the explicit minimum) -> NO_MATCH", () => {
      const workerC = baseWorker({
        tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 6 }],
        skills: [{ skillCode: "TIG", verificationState: "VERIFIED" }],
        credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }],
      });
      const result = evaluate(demandFull, workerC);
      expect(result.kind).toBe("EVALUATED");
      if (result.kind !== "EVALUATED") throw new Error("unreachable");
      expect(result.evaluation.outcome).toBe("NO_MATCH");
    });

    it("WORKER_D: no violation, but material required information (trade) is unknown -> INSUFFICIENT_DATA", () => {
      const workerD = baseWorker({ tradeOccupations: [], skills: [], credentials: [] });
      const result = evaluate(demandFull, workerD);
      expect(result.kind).toBe("EVALUATED");
      if (result.kind !== "EVALUATED") throw new Error("unreachable");
      expect(result.evaluation.criteria.some((c) => c.importance === "HARD" && c.state === "VIOLATED")).toBe(false);
      expect(result.evaluation.outcome).toBe("INSUFFICIENT_DATA");
    });
  });
});
