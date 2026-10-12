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
import { MatchingReadModelService } from "../../server/services/matching/matching-read-model-service";
import { evaluateWorkerDemandMatch } from "../../server/matching/evaluate-worker-demand-match";
import { transactionRunnerOnClient } from "../../server/database/transaction";
import type { ServerSession } from "../../server/auth/session";
import type { OperatorRepository } from "../../server/repositories/operator/operator-repository";

const EXCLUDED_LOCAL_MIGRATIONS = new Set([
  "20260915024424_security_rls_b0_r1_public_routine_defaults.sql",
  "20260915024716_security_rls_b0_r1_global_routine_defaults.sql",
]);

const EVALUATION_DATE = new Date("2026-10-01T00:00:00.000Z");

describe("MATCHING-B2-B commercial read model", () => {
  let db: PGlite;
  let operatorRepository: OperatorRepository;
  const fullAccessId = "e2222222-2222-4222-8222-222222222222";
  const noPermissionId = "e3333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory = resolve(process.cwd(), "supabase/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql") && !EXCLUDED_LOCAL_MIGRATIONS.has(name)).sort();
    for (const file of files) await db.exec(await readFile(resolve(directory, file), "utf8"));
    operatorRepository = new PostgresOperatorRepository(db as unknown as SqlClient);
    await operatorRepository.create({
      authUserId: fullAccessId, email: "full@example.com", status: "ACTIVE",
      permissions: ["worker_profile.read", "worker_profile.write", "worker_contact.read", "worker_contact.write", "worker_compensation.read", "worker_compensation.write", "demand_requirement.write", "matching_result.read"],
    });
    await operatorRepository.create({ authUserId: noPermissionId, email: "no-permission@example.com", status: "ACTIVE", permissions: [] });
  });
  afterAll(async () => db.close());

  const session = (id: string): (() => Promise<ServerSession | null>) => () => Promise.resolve({ authUserId: id, email: "irrelevant@example.com" });
  const workerService = () =>
    new WorkerService({ repository: new PostgresWorkerRepository(db as unknown as SqlClient), transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient), getSession: session(fullAccessId), operatorRepository });
  const demandService = () =>
    new DemandRequirementService({ repository: new PostgresDemandRequirementRepository(db as unknown as SqlClient), transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient), getSession: session(fullAccessId), operatorRepository });
  const persistenceService = () => new MatchingPersistenceService({ transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient) });
  const readModelService = (sessionId: string = fullAccessId) =>
    new MatchingReadModelService({
      repository: new PostgresMatchingResultRepository(db as unknown as SqlClient),
      workerService: workerService(),
      demandRequirementService: demandService(),
      getSession: session(sessionId),
      operatorRepository,
    });

  async function createWorkerFixture(displayName: string, experienceMonths: number) {
    const worker = await workerService().createWorker({ displayName, sourceOfRecord: "IMPORTED" });
    if (worker.kind !== "OK") throw new Error("worker setup failed");
    await workerService().addTradeOccupation({ workerId: worker.value.id, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths });
    await workerService().addSkill({ workerId: worker.value.id, skillCode: "TIG", verificationState: "VERIFIED" });
    await workerService().addCredential({ workerId: worker.value.id, credentialCode: "OSHA_10", verificationState: "VERIFIED", verifiedAt: new Date("2026-01-01T00:00:00.000Z") });
    await workerService().appendAvailability({ workerId: worker.value.id, status: "AVAILABLE", source: "OPERATOR_ENTERED" });
    await workerService().appendCompensationExpectation({ workerId: worker.value.id, rateType: "HOURLY", rateMin: 30, currency: "USD", negotiable: false });
    await workerService().addContactRoute({ workerId: worker.value.id, routeType: "PHONE", target: "555-0100" });
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
    const engineResult = evaluateWorkerDemandMatch({ demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE });
    return persistenceService().persist({ demand: demandInputResult.value, worker: workerInputResult.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE, engineResult });
  }

  it("19 / 20. counts use only current results, historical superseded results are excluded", async () => {
    const demandSignalId = await createDemandFixture("B2-B read model fixture 19-20");
    const strongWorkerId = await createWorkerFixture("SYNTHETIC-RM-STRONG", 36);
    const noMatchWorkerId = await createWorkerFixture("SYNTHETIC-RM-NOMATCH", 3);
    await evaluateAndPersist(demandSignalId, strongWorkerId);
    await evaluateAndPersist(demandSignalId, noMatchWorkerId);

    // Supersede the NO_MATCH worker's result with a new STRONG_MATCH-producing evaluation.
    await workerService().updateTradeOccupationExperience(noMatchWorkerId, "ELECTRICAL", "ELECTRICIAN", 36);
    await evaluateAndPersist(demandSignalId, noMatchWorkerId);

    const readModel = await readModelService().getDemandMatchReadModel(demandSignalId);
    expect(readModel.kind).toBe("OK");
    if (readModel.kind !== "OK") throw new Error("unreachable");
    expect(readModel.value.counts.STRONG_MATCH).toBe(2);
    expect(readModel.value.counts.NO_MATCH).toBe(0);
    expect(readModel.value.workers).toHaveLength(2);
  });

  it("21. missing-information reasons derive from UNKNOWN criteria", async () => {
    const demandSignalId = await createDemandFixture("B2-B read model fixture 21");
    const worker = await workerService().createWorker({ displayName: "SYNTHETIC-RM-MISSING-INFO", sourceOfRecord: "IMPORTED" });
    if (worker.kind !== "OK") throw new Error("unreachable");
    await evaluateAndPersist(demandSignalId, worker.value.id);

    const readModel = await readModelService().getDemandMatchReadModel(demandSignalId);
    if (readModel.kind !== "OK") throw new Error("unreachable");
    const row = readModel.value.workers.find((w) => w.workerId === worker.value.id);
    expect(row?.outcome).toBe("INSUFFICIENT_DATA");
    expect(row?.missingInformationReasons).toContain("WORKER_TRADE_UNKNOWN");
  });

  it("22. no contact data (phone/email/consent) appears anywhere in the read model", async () => {
    const demandSignalId = await createDemandFixture("B2-B read model fixture 22");
    const workerId = await createWorkerFixture("SYNTHETIC-RM-PRIVACY", 36);
    await evaluateAndPersist(demandSignalId, workerId);

    const readModel = await readModelService().getDemandMatchReadModel(demandSignalId);
    const serialized = JSON.stringify(readModel);
    expect(serialized).not.toMatch(/555-0100/);
    expect(serialized).not.toMatch(/consent/i);
    expect(serialized).not.toMatch(/rawIdentifier/i);
  });

  it("read model requires matching_result.read and is denied without it", async () => {
    const demandSignalId = await createDemandFixture("B2-B read model fixture auth");
    const denied = await readModelService(noPermissionId).getDemandMatchReadModel(demandSignalId);
    expect(denied.kind).toBe("UNAUTHORIZED");
  });

  it("23 / 24. an archived worker's historical result remains queryable, and current lifecycle can differ from the evaluation-time snapshot", async () => {
    const demandSignalId = await createDemandFixture("B2-B read model fixture 23-24");
    const workerId = await createWorkerFixture("SYNTHETIC-RM-ARCHIVED", 36);
    const persisted = await evaluateAndPersist(demandSignalId, workerId);
    expect(persisted.kind).toBe("PERSISTED");

    const archived = await workerService().archiveWorker(workerId);
    expect(archived.kind).toBe("OK");

    const readModel = await readModelService().getDemandMatchReadModel(demandSignalId);
    expect(readModel.kind).toBe("OK");
    if (readModel.kind !== "OK") throw new Error("unreachable");
    const row = readModel.value.workers.find((w) => w.workerId === workerId);
    // The historical result (computed while ACTIVE) remains present and queryable.
    expect(row).not.toBeUndefined();
    expect(row?.workerLifecycleStatusAtEvaluation).toBe("ACTIVE");
    // But the worker's CURRENT lifecycle is now ARCHIVED -- captured independently.
    expect(row?.currentWorkerLifecycleStatus).toBe("ARCHIVED");
    expect(row?.workerLifecycleStatusAtEvaluation).not.toBe(row?.currentWorkerLifecycleStatus);
  });
});
