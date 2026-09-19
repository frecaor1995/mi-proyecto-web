import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresWorkerRepository } from "../../server/repositories/worker/postgres-worker-repository";
import { PostgresDemandRequirementRepository } from "../../server/repositories/demand/postgres-demand-requirement-repository";
import { PostgresMatchingResultRepository } from "../../server/repositories/matching/postgres-matching-result-repository";
import { WorkerService } from "../../server/services/worker/worker-service";
import { DemandRequirementService } from "../../server/services/demand/demand-requirement-service";
import { MatchingPersistenceService } from "../../server/services/matching/matching-persistence-service";
import { evaluateWorkerDemandMatch, MATCHING_RULE_VERSION } from "../../server/matching/evaluate-worker-demand-match";
import { transactionRunnerOnClient } from "../../server/database/transaction";
import type { ServerSession } from "../../server/auth/session";
import type { OperatorRepository } from "../../server/repositories/operator/operator-repository";
import type { CriterionEvaluation } from "../../domain/matching-engine";

const EXCLUDED_LOCAL_MIGRATIONS = new Set([
  "20260913133740_discovery_mvp_a0_durable_runs.sql",
  "20260913135341_discovery_mvp_a_candidates.sql",
  "20260914024442_discovery_mvp_b_r1_destination_policy_state.sql",
  "20260914094253_canonical_multi_profession_demand.sql",
  "20260915024424_security_rls_b0_r1_public_routine_defaults.sql",
  "20260915024716_security_rls_b0_r1_global_routine_defaults.sql",
]);

const EVALUATION_DATE = new Date("2026-10-01T00:00:00.000Z");

describe("MATCHING-B2-B durable persistence", () => {
  let db: PGlite;
  let operatorRepository: OperatorRepository;
  const fullAccessId = "f1111111-1111-4111-8111-111111111111";

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory = resolve(process.cwd(), "supabase/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql") && !EXCLUDED_LOCAL_MIGRATIONS.has(name)).sort();
    for (const file of files) await db.exec(await readFile(resolve(directory, file), "utf8"));
    operatorRepository = new PostgresOperatorRepository(db as unknown as SqlClient);
    await operatorRepository.create({
      authUserId: fullAccessId, email: "full@example.com", status: "ACTIVE",
      permissions: ["worker_profile.read", "worker_profile.write", "worker_contact.read", "worker_compensation.read", "worker_compensation.write", "demand_requirement.write", "matching_result.read"],
    });
  });
  afterAll(async () => db.close());

  const session = (): (() => Promise<ServerSession | null>) => () => Promise.resolve({ authUserId: fullAccessId, email: "irrelevant@example.com" });
  const workerService = () =>
    new WorkerService({
      repository: new PostgresWorkerRepository(db as unknown as SqlClient),
      transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient),
      getSession: session(),
      operatorRepository,
    });
  const demandService = () =>
    new DemandRequirementService({
      repository: new PostgresDemandRequirementRepository(db as unknown as SqlClient),
      transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient),
      getSession: session(),
      operatorRepository,
    });
  const persistenceService = () => new MatchingPersistenceService({ transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient) });
  const resultRepository = () => new PostgresMatchingResultRepository(db as unknown as SqlClient);

  async function createWorkerFixture(displayName: string, experienceMonths = 36) {
    const worker = await workerService().createWorker({ displayName, sourceOfRecord: "IMPORTED" });
    if (worker.kind !== "OK") throw new Error("worker setup failed");
    await workerService().addTradeOccupation({ workerId: worker.value.id, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths });
    await workerService().addSkill({ workerId: worker.value.id, skillCode: "TIG", verificationState: "VERIFIED" });
    await workerService().addCredential({ workerId: worker.value.id, credentialCode: "OSHA_10", verificationState: "VERIFIED", verifiedAt: new Date("2026-01-01T00:00:00.000Z") });
    await workerService().appendAvailability({ workerId: worker.value.id, status: "AVAILABLE", source: "OPERATOR_ENTERED" });
    await workerService().appendCompensationExpectation({ workerId: worker.value.id, rateType: "HOURLY", rateMin: 30, currency: "USD", negotiable: false });
    return worker.value.id;
  }

  async function createDemandFixture(title: string) {
    const inserted = await db.query<{ id: string }>(
      `insert into demand_signals (title, role_type, trade_code, occupation_code, minimum_experience_months, start_date, pay_currency, base_pay_min, base_pay_max, pay_period)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [title, "ELECTRICIAN", "ELECTRICAL", "ELECTRICIAN", 24, "2026-10-01", "USD", 28, 38, "HOURLY"],
    );
    const demandSignalId = (inserted.rows as { id: string }[])[0].id;
    await demandService().setDemandRequirements({
      demandSignalId,
      skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }],
      credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED" }],
    });
    return demandSignalId;
  }

  async function evaluateAndPersist(demandSignalId: string, workerId: string) {
    const demandInputResult = await demandService().getMatchingReadyInput(demandSignalId);
    const workerInputResult = await workerService().buildMatchingReadyInput(workerId);
    if (demandInputResult.kind !== "OK" || demandInputResult.value === null) throw new Error("demand fixture missing");
    if (workerInputResult.kind !== "OK" || workerInputResult.value === null) throw new Error("worker fixture missing");
    const engineResult = evaluateWorkerDemandMatch({
      demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE,
    });
    return persistenceService().persist({
      demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE, engineResult,
    });
  }

  it("1. MATCHING_RULE_VERSION is pinned", () => {
    expect(MATCHING_RULE_VERSION).toBe("matching-b1-d-v1");
  });

  it("8. first evaluation persists exactly one current result", async () => {
    const demandSignalId = await createDemandFixture("B2-B fixture 8");
    const workerId = await createWorkerFixture("SYNTHETIC-B2B-8");
    const outcome = await evaluateAndPersist(demandSignalId, workerId);
    expect(outcome.kind).toBe("PERSISTED");
    const current = await resultRepository().getCurrentResult(demandSignalId, workerId);
    expect(current).not.toBeNull();
    expect(current?.supersededAt).toBeNull();
    expect(current?.ruleVersion).toBe("matching-b1-d-v1");
  });

  it("9. criteria persist faithfully (criterion/subject/importance/state/reasonCode/observed values match the engine's own output)", async () => {
    const demandSignalId = await createDemandFixture("B2-B fixture 9");
    const workerId = await createWorkerFixture("SYNTHETIC-B2B-9");
    const demandInputResult = await demandService().getMatchingReadyInput(demandSignalId);
    const workerInputResult = await workerService().buildMatchingReadyInput(workerId);
    if (demandInputResult.kind !== "OK" || demandInputResult.value === null) throw new Error("unreachable");
    if (workerInputResult.kind !== "OK" || workerInputResult.value === null) throw new Error("unreachable");
    const engineResult = evaluateWorkerDemandMatch({ demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE });
    if (engineResult.kind !== "EVALUATED") throw new Error("unreachable");
    const outcome = await persistenceService().persist({ demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE, engineResult });
    if (outcome.kind !== "PERSISTED") throw new Error("unreachable");

    const persistedCriteria = await resultRepository().listCriteriaForResult(outcome.resultId);
    expect(persistedCriteria).toHaveLength(engineResult.evaluation.criteria.length);
    const logical = (rows: readonly CriterionEvaluation[]) => rows.map((c) => ({ criterion: c.criterion, subject: c.subject, importance: c.importance, state: c.state, reasonCode: c.reasonCode, observedDemand: c.observedDemand, observedWorker: c.observedWorker }));
    const persistedLogical = persistedCriteria.map((c) => ({ criterion: c.criterion, subject: c.subject, importance: c.importance, state: c.state, reasonCode: c.reasonCode, observedDemand: c.observedDemand, observedWorker: c.observedWorker }));
    expect(persistedLogical).toEqual(logical(engineResult.evaluation.criteria));
  });

  it("10 / 11 / 12. second evaluation supersedes the first, history is preserved, and exactly one current result exists at all times", async () => {
    const demandSignalId = await createDemandFixture("B2-B fixture 10");
    const workerId = await createWorkerFixture("SYNTHETIC-B2B-10", 36);

    const first = await evaluateAndPersist(demandSignalId, workerId);
    expect(first.kind).toBe("PERSISTED");
    if (first.kind !== "PERSISTED") throw new Error("unreachable");

    // Change a matching-relevant worker fact so the second evaluation produces a genuinely different result.
    await workerService().updateTradeOccupationExperience(workerId, "ELECTRICAL", "ELECTRICIAN", 3);
    const second = await evaluateAndPersist(demandSignalId, workerId);
    expect(second.kind).toBe("PERSISTED");
    if (second.kind !== "PERSISTED") throw new Error("unreachable");
    expect(second.resultId).not.toBe(first.resultId);

    const current = await resultRepository().getCurrentResult(demandSignalId, workerId);
    expect(current?.id).toBe(second.resultId);

    const history = await resultRepository().listHistoryForWorker(demandSignalId, workerId);
    expect(history).toHaveLength(2);
    const historyIds = history.map((h) => h.id).sort();
    expect(historyIds).toEqual([first.resultId, second.resultId].sort());
    const supersededRow = history.find((h) => h.id === first.resultId);
    expect(supersededRow?.supersededAt).not.toBeNull();
    // The superseded row's own historical facts are unchanged.
    expect(supersededRow?.outcome).toBe(first.outcome);

    const currentRows = history.filter((h) => h.supersededAt === null);
    expect(currentRows).toHaveLength(1);
  });

  it("12b. the partial unique index rejects two simultaneously-current rows for the same demand/worker pair", async () => {
    const demandSignalId = await createDemandFixture("B2-B fixture 12b");
    const workerId = await createWorkerFixture("SYNTHETIC-B2B-12B");
    await evaluateAndPersist(demandSignalId, workerId);
    // Attempt to insert a second current row directly, bypassing the service's supersede step.
    await expect(
      db.query(
        `insert into worker_demand_match_results
           (demand_signal_id, worker_id, outcome, rule_version, evaluation_date, worker_input_fingerprint, demand_input_fingerprint, worker_lifecycle_status_at_evaluation)
         values ($1,$2,'STRONG_MATCH','matching-b1-d-v1',now(),'x','y','ACTIVE')`,
        [demandSignalId, workerId],
      ),
    ).rejects.toThrow();
  });

  it("13. a failure during criteria persistence rolls back the whole transaction -- the previous result remains current", async () => {
    const demandSignalId = await createDemandFixture("B2-B fixture 13");
    const workerId = await createWorkerFixture("SYNTHETIC-B2B-13");
    const first = await evaluateAndPersist(demandSignalId, workerId);
    expect(first.kind).toBe("PERSISTED");
    if (first.kind !== "PERSISTED") throw new Error("unreachable");

    const demandInputResult = await demandService().getMatchingReadyInput(demandSignalId);
    const workerInputResult = await workerService().buildMatchingReadyInput(workerId);
    if (demandInputResult.kind !== "OK" || demandInputResult.value === null) throw new Error("unreachable");
    if (workerInputResult.kind !== "OK" || workerInputResult.value === null) throw new Error("unreachable");
    const engineResult = evaluateWorkerDemandMatch({ demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE });
    if (engineResult.kind !== "EVALUATED") throw new Error("unreachable");

    // Deliberately corrupt one criterion's state to a value the CHECK
    // constraint rejects, forcing insertCriteria to fail mid-transaction.
    const corruptedEvaluation = {
      ...engineResult,
      evaluation: {
        ...engineResult.evaluation,
        criteria: engineResult.evaluation.criteria.map((c, i) => (i === 0 ? { ...c, state: "NOT_A_REAL_STATE" as CriterionEvaluation["state"] } : c)),
      },
    };

    await expect(
      persistenceService().persist({ demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE, engineResult: corruptedEvaluation }),
    ).rejects.toThrow();

    const current = await resultRepository().getCurrentResult(demandSignalId, workerId);
    expect(current?.id).toBe(first.resultId);
    expect(current?.supersededAt).toBeNull();
    const history = await resultRepository().listHistoryForWorker(demandSignalId, workerId);
    expect(history).toHaveLength(1);
  });

  it("14. INELIGIBLE is not persisted as a qualification result", async () => {
    const demandSignalId = await createDemandFixture("B2-B fixture 14");
    const workerId = await createWorkerFixture("SYNTHETIC-B2B-14");
    const archived = await workerService().archiveWorker(workerId);
    if (archived.kind !== "OK") throw new Error("archive setup failed");

    const demandInputResult = await demandService().getMatchingReadyInput(demandSignalId);
    const workerInputResult = await workerService().buildMatchingReadyInput(workerId);
    if (demandInputResult.kind !== "OK" || demandInputResult.value === null) throw new Error("unreachable");
    if (workerInputResult.kind !== "OK" || workerInputResult.value === null) throw new Error("unreachable");
    const engineResult = evaluateWorkerDemandMatch({ demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ARCHIVED", evaluationDate: EVALUATION_DATE });
    expect(engineResult.kind).toBe("INELIGIBLE");

    const outcome = await persistenceService().persist({ demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ARCHIVED", evaluationDate: EVALUATION_DATE, engineResult });
    expect(outcome).toEqual({ kind: "NOT_PERSISTED_INELIGIBLE" });
    const current = await resultRepository().getCurrentResult(demandSignalId, workerId);
    expect(current).toBeNull();
  });

  it("15/16/17/18. all four outcome categories persist correctly", async () => {
    const demandSignalId = await createDemandFixture("B2-B fixture outcomes");

    // STRONG_MATCH
    const strongWorkerId = await createWorkerFixture("SYNTHETIC-B2B-STRONG", 36);
    const strong = await evaluateAndPersist(demandSignalId, strongWorkerId);
    expect(strong.kind === "PERSISTED" ? strong.outcome : null).toBe("STRONG_MATCH");

    // POSSIBLE_MATCH: unverified required skill
    const possibleWorkerId = await createWorkerFixture("SYNTHETIC-B2B-POSSIBLE", 36);
    await workerService().removeSkill(possibleWorkerId, "TIG");
    await workerService().addSkill({ workerId: possibleWorkerId, skillCode: "TIG", verificationState: "UNVERIFIED" });
    const possible = await evaluateAndPersist(demandSignalId, possibleWorkerId);
    expect(possible.kind === "PERSISTED" ? possible.outcome : null).toBe("POSSIBLE_MATCH");

    // NO_MATCH: experience below minimum
    const noMatchWorkerId = await createWorkerFixture("SYNTHETIC-B2B-NOMATCH", 3);
    const noMatch = await evaluateAndPersist(demandSignalId, noMatchWorkerId);
    expect(noMatch.kind === "PERSISTED" ? noMatch.outcome : null).toBe("NO_MATCH");

    // INSUFFICIENT_DATA: no trade rows at all
    const worker = await workerService().createWorker({ displayName: "SYNTHETIC-B2B-INSUFFICIENT", sourceOfRecord: "IMPORTED" });
    if (worker.kind !== "OK") throw new Error("unreachable");
    const insufficient = await evaluateAndPersist(demandSignalId, worker.value.id);
    expect(insufficient.kind === "PERSISTED" ? insufficient.outcome : null).toBe("INSUFFICIENT_DATA");
  });

  it("25. direct mutation of a historical outcome is rejected by the append-only trigger", async () => {
    const demandSignalId = await createDemandFixture("B2-B fixture 25");
    const workerId = await createWorkerFixture("SYNTHETIC-B2B-25");
    const outcome = await evaluateAndPersist(demandSignalId, workerId);
    if (outcome.kind !== "PERSISTED") throw new Error("unreachable");
    await expect(db.query(`update worker_demand_match_results set outcome='NO_MATCH' where id=$1`, [outcome.resultId])).rejects.toThrow();
  });

  it("26. direct deletion of a result or a criterion row is rejected by the append-only trigger", async () => {
    const demandSignalId = await createDemandFixture("B2-B fixture 26");
    const workerId = await createWorkerFixture("SYNTHETIC-B2B-26");
    const outcome = await evaluateAndPersist(demandSignalId, workerId);
    if (outcome.kind !== "PERSISTED") throw new Error("unreachable");
    await expect(db.query(`delete from worker_demand_match_results where id=$1`, [outcome.resultId])).rejects.toThrow();
    const criteria = await resultRepository().listCriteriaForResult(outcome.resultId);
    await expect(db.query(`delete from worker_demand_match_criteria where id=$1`, [criteria[0].id])).rejects.toThrow();
    await expect(db.query(`update worker_demand_match_criteria set state='VIOLATED' where id=$1`, [criteria[0].id])).rejects.toThrow();
  });
});
