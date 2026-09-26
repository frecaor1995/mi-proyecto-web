import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresWorkerRepository } from "../../server/repositories/worker/postgres-worker-repository";
import { PostgresDemandRequirementRepository } from "../../server/repositories/demand/postgres-demand-requirement-repository";
import { PostgresMatchingResultRepository } from "../../server/repositories/matching/postgres-matching-result-repository";
import { WorkerService } from "../../server/services/worker/worker-service";
import { DemandRequirementService } from "../../server/services/demand/demand-requirement-service";
import { MatchingPersistenceService } from "../../server/services/matching/matching-persistence-service";
import { MatchingReadModelService } from "../../server/services/matching/matching-read-model-service";
import {
  DEMAND_WORKFORCE_PAGE_SIZE, evaluateDemandAgainstWorkforce, type EvaluateDemandAgainstWorkforceDeps,
} from "../../server/services/matching/evaluate-demand-against-workforce";
import { evaluateWorkerDemandMatch, MATCHING_RULE_VERSION } from "../../server/matching/evaluate-worker-demand-match";
import { transactionRunnerOnClient } from "../../server/database/transaction";
import { DEMAND_WORKFORCE_FAILURE_REASON_CODES, type DemandWorkforceEvaluationRun } from "../../domain/demand-workforce-evaluation";
import { OPERATOR_PERMISSIONS, type OperatorPermission } from "../../domain/operator";
import type { MatchOutcome } from "../../domain/matching-engine";
import type { VerificationState } from "../../domain/database";
import type { WorkerSearchFilter } from "../../domain/worker";
import type { ServerSession } from "../../server/auth/session";
import type { OperatorRepository } from "../../server/repositories/operator/operator-repository";

const EXCLUDED_LOCAL_MIGRATIONS = new Set([
  "20260915024424_security_rls_b0_r1_public_routine_defaults.sql",
  "20260915024716_security_rls_b0_r1_global_routine_defaults.sql",
]);

const RUN_BASE_MS = Date.parse("2026-10-01T00:00:00.000Z");

describe("MATCHING-B3-B demand-to-workforce orchestration", () => {
  let db: PGlite;
  let operatorRepository: OperatorRepository;
  const adminId = "b3000000-0000-4000-8000-000000000001";
  const executorId = "b3000000-0000-4000-8000-000000000002";
  const readerOnlyId = "b3000000-0000-4000-8000-000000000003";
  const executeOnlyId = "b3000000-0000-4000-8000-000000000004";
  const noWorkerReadId = "b3000000-0000-4000-8000-000000000005";
  const noCompensationReadId = "b3000000-0000-4000-8000-000000000006";
  const readModelReaderId = "b3000000-0000-4000-8000-000000000007";
  const noPermissionId = "b3000000-0000-4000-8000-000000000008";

  const asSql = () => db as unknown as SqlClient;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory = resolve(process.cwd(), "supabase/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql") && !EXCLUDED_LOCAL_MIGRATIONS.has(name)).sort();
    for (const file of files) await db.exec(await readFile(resolve(directory, file), "utf8"));
    operatorRepository = new PostgresOperatorRepository(asSql());
    const make = (authUserId: string, permissions: OperatorPermission[]) =>
      operatorRepository.create({ authUserId, email: `${authUserId}@example.com`, status: "ACTIVE", permissions });
    // Fixture author only -- never used to run the orchestrator.
    await make(adminId, ["worker_profile.read", "worker_profile.write", "worker_contact.read", "worker_contact.write", "worker_compensation.read", "worker_compensation.write", "demand_requirement.write"]);
    // The intended caller: matching.execute plus the dependency permissions of the services it composes. NO matching_result.read.
    await make(executorId, ["matching.execute", "worker_profile.read", "worker_compensation.read", "demand_requirement.write"]);
    // Has every dependency permission AND matching_result.read, but NOT matching.execute.
    await make(readerOnlyId, ["matching_result.read", "worker_profile.read", "worker_compensation.read", "demand_requirement.write"]);
    await make(executeOnlyId, ["matching.execute"]);
    await make(noWorkerReadId, ["matching.execute", "demand_requirement.write", "worker_compensation.read"]);
    await make(noCompensationReadId, ["matching.execute", "demand_requirement.write", "worker_profile.read"]);
    await make(readModelReaderId, ["matching_result.read", "worker_profile.read", "worker_compensation.read", "demand_requirement.write"]);
    await make(noPermissionId, []);
  }, 120_000);
  afterAll(async () => db.close());

  // Each test controls its own ACTIVE population: everything created by an earlier test goes INACTIVE.
  beforeEach(async () => {
    await db.exec("update workforce_workers set lifecycle_status='INACTIVE' where lifecycle_status='ACTIVE'");
  });

  const session = (id: string | null): (() => Promise<ServerSession | null>) => () =>
    Promise.resolve(id === null ? null : { authUserId: id, email: "irrelevant@example.com" });
  const workerService = (id: string) =>
    new WorkerService({ repository: new PostgresWorkerRepository(asSql()), transactionRunner: transactionRunnerOnClient(asSql()), getSession: session(id), operatorRepository });
  const demandService = (id: string) =>
    new DemandRequirementService({ repository: new PostgresDemandRequirementRepository(asSql()), transactionRunner: transactionRunnerOnClient(asSql()), getSession: session(id), operatorRepository });
  const persistenceService = () => new MatchingPersistenceService({ transactionRunner: transactionRunnerOnClient(asSql()) });
  const resultRepository = () => new PostgresMatchingResultRepository(asSql());
  const admin = () => workerService(adminId);

  interface WorkerFixtureOptions { experienceMonths?: number; withTrade?: boolean; skillState?: VerificationState; contact?: boolean }
  async function createWorkerFixture(displayName: string, options: WorkerFixtureOptions = {}) {
    const { experienceMonths = 36, withTrade = true, skillState = "VERIFIED", contact = false } = options;
    const created = await admin().createWorker({ displayName, sourceOfRecord: "IMPORTED" });
    if (created.kind !== "OK") throw new Error("worker setup failed");
    const id = created.value.id;
    if (withTrade) await admin().addTradeOccupation({ workerId: id, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths });
    await admin().addSkill({ workerId: id, skillCode: "TIG", verificationState: skillState });
    await admin().addCredential({ workerId: id, credentialCode: "OSHA_10", verificationState: "VERIFIED", verifiedAt: new Date("2026-01-01T00:00:00.000Z") });
    await admin().appendAvailability({ workerId: id, status: "AVAILABLE", source: "OPERATOR_ENTERED" });
    await admin().appendCompensationExpectation({ workerId: id, rateType: "HOURLY", rateMin: 30, currency: "USD", negotiable: false });
    if (contact) {
      await admin().addContactRoute({ workerId: id, routeType: "PHONE", target: "555-0142" });
      await admin().addContactRoute({ workerId: id, routeType: "EMAIL", target: "privacy.worker@example.com" });
    }
    return id;
  }
  /** One worker per outcome, against the demand fixture below. */
  const createOutcomeWorkers = async (prefix: string) => ({
    STRONG_MATCH: await createWorkerFixture(`${prefix}-STRONG`),
    POSSIBLE_MATCH: await createWorkerFixture(`${prefix}-POSSIBLE`, { skillState: "UNVERIFIED" }),
    NO_MATCH: await createWorkerFixture(`${prefix}-NOMATCH`, { experienceMonths: 3 }),
    INSUFFICIENT_DATA: await createWorkerFixture(`${prefix}-NOTRADE`, { withTrade: false }),
  });

  async function createDemandFixture(title: string) {
    const inserted = await db.query<{ id: string }>(
      `insert into demand_signals (title, role_type, trade_code, occupation_code, minimum_experience_months, start_date, pay_currency, base_pay_min, base_pay_max, pay_period)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [title, "ELECTRICIAN", "ELECTRICAL", "ELECTRICIAN", 24, "2026-10-01", "USD", 28, 38, "HOURLY"],
    );
    const demandSignalId = (inserted.rows as { id: string }[])[0].id;
    await demandService(adminId).setDemandRequirements({
      demandSignalId,
      skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }],
      credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED" }],
    });
    return demandSignalId;
  }

  /** Real services + an event log. Overrides replace individual dependency methods. */
  interface Instrumented {
    readonly deps: EvaluateDemandAgainstWorkforceDeps;
    readonly events: string[];
    readonly searchFilters: WorkerSearchFilter[];
  }
  function instrument(
    callerId: string | null = executorId,
    overrides: {
      searchWorkers?: (real: WorkerService, filter: WorkerSearchFilter) => ReturnType<WorkerService["searchWorkers"]>;
      getWorker?: (real: WorkerService, id: string) => ReturnType<WorkerService["getWorker"]>;
      buildMatchingReadyInput?: (real: WorkerService, id: string) => ReturnType<WorkerService["buildMatchingReadyInput"]>;
      getMatchingReadyInput?: (real: DemandRequirementService, id: string) => ReturnType<DemandRequirementService["getMatchingReadyInput"]>;
      persist?: (real: MatchingPersistenceService, input: Parameters<MatchingPersistenceService["persist"]>[0]) => ReturnType<MatchingPersistenceService["persist"]>;
      pageSize?: number;
      evaluate?: EvaluateDemandAgainstWorkforceDeps["evaluate"];
    } = {},
  ): Instrumented {
    const events: string[] = [];
    const searchFilters: WorkerSearchFilter[] = [];
    const id = callerId ?? executorId;
    const realWorkers = workerService(id);
    const realDemand = demandService(id);
    const realPersistence = persistenceService();
    let tick = 0;
    const deps: EvaluateDemandAgainstWorkforceDeps = {
      demandRequirementService: {
        getMatchingReadyInput: (demandId) => {
          events.push("demand");
          return overrides.getMatchingReadyInput ? overrides.getMatchingReadyInput(realDemand, demandId) : realDemand.getMatchingReadyInput(demandId);
        },
      },
      workerService: {
        searchWorkers: (filter) => {
          events.push(`search:${filter.offset}`);
          searchFilters.push(filter);
          return overrides.searchWorkers ? overrides.searchWorkers(realWorkers, filter) : realWorkers.searchWorkers(filter);
        },
        getWorker: (workerId) => {
          events.push(`get:${workerId}`);
          return overrides.getWorker ? overrides.getWorker(realWorkers, workerId) : realWorkers.getWorker(workerId);
        },
        buildMatchingReadyInput: (workerId) => {
          events.push(`build:${workerId}`);
          return overrides.buildMatchingReadyInput ? overrides.buildMatchingReadyInput(realWorkers, workerId) : realWorkers.buildMatchingReadyInput(workerId);
        },
      },
      persistenceService: {
        persist: (input) => {
          events.push(`persist:${input.worker.workerId}`);
          return overrides.persist ? overrides.persist(realPersistence, input) : realPersistence.persist(input);
        },
      },
      getSession: session(callerId),
      operatorRepository,
      clock: () => new Date(RUN_BASE_MS + 1000 * tick++),
      pageSize: overrides.pageSize,
      evaluate: overrides.evaluate,
    };
    return { deps, events, searchFilters };
  }

  async function runOk(demandSignalId: string, instrumented: Instrumented = instrument()): Promise<DemandWorkforceEvaluationRun> {
    const result = await evaluateDemandAgainstWorkforce(demandSignalId, instrumented.deps);
    if (result.kind !== "OK") throw new Error(`expected OK, got ${result.kind}`);
    return result.value;
  }
  const outcomeTotal = (run: DemandWorkforceEvaluationRun) => Object.values(run.outcomes).reduce((a, b) => a + b, 0);
  const persistedIds = (events: readonly string[]) => events.filter((e) => e.startsWith("persist:")).map((e) => e.slice("persist:".length));
  const readModel = () =>
    new MatchingReadModelService({
      repository: resultRepository(), workerService: workerService(readModelReaderId), demandRequirementService: demandService(readModelReaderId),
      getSession: session(readModelReaderId), operatorRepository,
    });
  async function rowCount(demandSignalId: string, workerId?: string): Promise<number> {
    const q = workerId
      ? await db.query<{ n: string }>("select count(*)::text n from worker_demand_match_results where demand_signal_id=$1 and worker_id=$2", [demandSignalId, workerId])
      : await db.query<{ n: string }>("select count(*)::text n from worker_demand_match_results where demand_signal_id=$1", [demandSignalId]);
    return Number((q.rows as { n: string }[])[0].n);
  }

  /* ------------------------------------------------------------------ */
  /* B3-B2 / B3-B16 -- permissions                                        */
  /* ------------------------------------------------------------------ */

  describe("permissions", () => {
    it("23. matching.execute is a distinct, registered permission", () => {
      expect(OPERATOR_PERMISSIONS).toContain("matching.execute");
      expect(OPERATOR_PERMISSIONS).toContain("matching_result.read");
      expect("matching.execute").not.toBe("matching_result.read");
    });

    it("23. operator WITH matching.execute may trigger orchestration", async () => {
      const demandSignalId = await createDemandFixture("B3-B permission allowed");
      await createWorkerFixture("SYNTHETIC-B3-PERM-OK");
      const result = await evaluateDemandAgainstWorkforce(demandSignalId, instrument(executorId).deps);
      expect(result.kind).toBe("OK");
    });

    it("23. operator WITHOUT matching.execute is denied before any service is touched", async () => {
      const demandSignalId = await createDemandFixture("B3-B permission denied");
      await createWorkerFixture("SYNTHETIC-B3-PERM-DENIED");
      const noPermission = instrument(noPermissionId);
      expect(await evaluateDemandAgainstWorkforce(demandSignalId, noPermission.deps)).toEqual({ kind: "UNAUTHORIZED" });
      expect(noPermission.events).toEqual([]);
      expect(await rowCount(demandSignalId)).toBe(0);
    });

    it("23. an unauthenticated caller is rejected before any service is touched", async () => {
      const demandSignalId = await createDemandFixture("B3-B permission unauthenticated");
      const anonymous = instrument(null);
      expect(await evaluateDemandAgainstWorkforce(demandSignalId, anonymous.deps)).toEqual({ kind: "UNAUTHENTICATED" });
      expect(anonymous.events).toEqual([]);
    });

    it("24. matching_result.read alone (with every dependency permission) does NOT authorize execution", async () => {
      const demandSignalId = await createDemandFixture("B3-B read is not execute");
      await createWorkerFixture("SYNTHETIC-B3-READ-NOT-EXECUTE");
      const readerOnly = instrument(readerOnlyId);
      expect(await evaluateDemandAgainstWorkforce(demandSignalId, readerOnly.deps)).toEqual({ kind: "UNAUTHORIZED" });
      expect(readerOnly.events).toEqual([]);
      expect(await rowCount(demandSignalId)).toBe(0);
    });

    it("24. matching.execute does NOT imply matching_result.read: the executor cannot read persisted results", async () => {
      const demandSignalId = await createDemandFixture("B3-B execute is not read");
      await createWorkerFixture("SYNTHETIC-B3-EXECUTE-NOT-READ");
      expect((await evaluateDemandAgainstWorkforce(demandSignalId, instrument(executorId).deps)).kind).toBe("OK");

      const executorReadModel = new MatchingReadModelService({
        repository: resultRepository(), workerService: workerService(executorId), demandRequirementService: demandService(executorId),
        getSession: session(executorId), operatorRepository,
      });
      expect(await executorReadModel.getDemandMatchReadModel(demandSignalId)).toEqual({ kind: "UNAUTHORIZED" });
    });

    it("24. existing service boundaries are not weakened: matching.execute alone cannot bypass demand_requirement.write", async () => {
      const demandSignalId = await createDemandFixture("B3-B demand boundary");
      const executeOnly = instrument(executeOnlyId);
      expect(await evaluateDemandAgainstWorkforce(demandSignalId, executeOnly.deps)).toEqual({ kind: "UNAUTHORIZED" });
      expect(executeOnly.events).toEqual(["demand"]);
    });

    it("24. existing service boundaries are not weakened: without worker_profile.read nothing is enumerated or persisted", async () => {
      const demandSignalId = await createDemandFixture("B3-B worker read boundary");
      await createWorkerFixture("SYNTHETIC-B3-NO-WORKER-READ");
      const caller = instrument(noWorkerReadId);
      expect(await evaluateDemandAgainstWorkforce(demandSignalId, caller.deps)).toEqual({ kind: "UNAUTHORIZED" });
      expect(persistedIds(caller.events)).toEqual([]);
      expect(await rowCount(demandSignalId)).toBe(0);
    });

    it("24. existing service boundaries are not weakened: without worker_compensation.read the run stops instead of degrading to per-worker failures", async () => {
      const demandSignalId = await createDemandFixture("B3-B compensation boundary");
      await createWorkerFixture("SYNTHETIC-B3-NO-COMP-READ-1");
      await createWorkerFixture("SYNTHETIC-B3-NO-COMP-READ-2");
      const caller = instrument(noCompensationReadId);
      expect(await evaluateDemandAgainstWorkforce(demandSignalId, caller.deps)).toEqual({ kind: "UNAUTHORIZED" });
      expect(caller.events.filter((e) => e.startsWith("build:"))).toHaveLength(1);
      expect(persistedIds(caller.events)).toEqual([]);
      expect(await rowCount(demandSignalId)).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /* B3-B3 / B3-B5 / B3-B15 -- demand input, enumeration, trade semantics */
  /* ------------------------------------------------------------------ */

  describe("demand input, enumeration and trade semantics", () => {
    it("1. the canonical demand input is loaded exactly once, before any worker is touched", async () => {
      const demandSignalId = await createDemandFixture("B3-B demand once");
      for (const n of [1, 2, 3, 4, 5]) await createWorkerFixture(`SYNTHETIC-B3-ONCE-${n}`);
      const instrumented = instrument();
      await runOk(demandSignalId, instrumented);
      expect(instrumented.events.filter((e) => e === "demand")).toHaveLength(1);
      expect(instrumented.events[0]).toBe("demand");
    });

    it("5. / 6. / 2. only ACTIVE workers are enumerated -- INACTIVE and ARCHIVED never enter the initial population", async () => {
      const demandSignalId = await createDemandFixture("B3-B active only");
      const active = [await createWorkerFixture("SYNTHETIC-B3-ACTIVE-1"), await createWorkerFixture("SYNTHETIC-B3-ACTIVE-2")];
      const inactive = await createWorkerFixture("SYNTHETIC-B3-INACTIVE");
      const archived = await createWorkerFixture("SYNTHETIC-B3-ARCHIVED");
      await admin().updateWorker(inactive, { lifecycleStatus: "INACTIVE" });
      expect((await admin().archiveWorker(archived)).kind).toBe("OK");

      const instrumented = instrument();
      const run = await runOk(demandSignalId, instrumented);

      expect(instrumented.searchFilters.length).toBeGreaterThan(0);
      for (const filter of instrumented.searchFilters) expect(filter.lifecycleStatus).toBe("ACTIVE");
      expect(run.eligibleWorkerCount).toBe(2);
      expect([...persistedIds(instrumented.events)].sort()).toEqual([...active].sort());
      const touched = instrumented.events.filter((e) => e.startsWith("get:") || e.startsWith("build:") || e.startsWith("persist:"));
      expect(touched.some((e) => e.endsWith(inactive) || e.endsWith(archived))).toBe(false);
      expect(await rowCount(demandSignalId, inactive)).toBe(0);
      expect(await rowCount(demandSignalId, archived)).toBe(0);
    });

    it("3. no trade/occupation prefilter is applied to the enumeration", async () => {
      const demandSignalId = await createDemandFixture("B3-B no trade prefilter");
      await createWorkerFixture("SYNTHETIC-B3-NOFILTER");
      const instrumented = instrument();
      await runOk(demandSignalId, instrumented);
      for (const filter of instrumented.searchFilters) {
        expect(filter.tradeCode).toBeUndefined();
        expect(filter.occupationCode).toBeUndefined();
      }
    });

    it("4. / 15. a zero-trade ACTIVE worker still reaches the deterministic engine and is persisted as INSUFFICIENT_DATA", async () => {
      const demandSignalId = await createDemandFixture("B3-B zero trade");
      const noTrade = await createWorkerFixture("SYNTHETIC-B3-ZERO-TRADE", { withTrade: false });
      const withTrade = await createWorkerFixture("SYNTHETIC-B3-WITH-TRADE");
      const instrumented = instrument();
      const run = await runOk(demandSignalId, instrumented);

      expect(run.eligibleWorkerCount).toBe(2);
      expect(persistedIds(instrumented.events)).toContain(noTrade);
      expect(run.outcomes.INSUFFICIENT_DATA).toBe(1);
      expect(run.outcomes.STRONG_MATCH).toBe(1);
      const current = await resultRepository().getCurrentResult(demandSignalId, noTrade);
      expect(current?.outcome).toBe("INSUFFICIENT_DATA");
      const criteria = await resultRepository().listCriteriaForResult(current!.id);
      expect(criteria.some((c) => c.reasonCode === "WORKER_TRADE_UNKNOWN")).toBe(true);
      expect((await resultRepository().getCurrentResult(demandSignalId, withTrade))?.outcome).toBe("STRONG_MATCH");
    });

    it("a demand that cannot be loaded fails the whole run before any worker is processed", async () => {
      const missing = "00000000-0000-4000-8000-00000000dead";
      await createWorkerFixture("SYNTHETIC-B3-NO-DEMAND");
      const notFound = instrument();
      expect(await evaluateDemandAgainstWorkforce(missing, notFound.deps)).toEqual({ kind: "DEMAND_NOT_FOUND" });
      expect(notFound.events).toEqual(["demand"]);

      const demandSignalId = await createDemandFixture("B3-B demand load throws");
      const throwing = instrument(executorId, { getMatchingReadyInput: () => Promise.reject(new Error("db exploded worker@example.com")) });
      const result = await evaluateDemandAgainstWorkforce(demandSignalId, throwing.deps);
      expect(result).toEqual({ kind: "DEMAND_LOAD_FAILED" });
      expect(JSON.stringify(result)).not.toContain("exploded");
      expect(throwing.events).toEqual(["demand"]);
      expect(await rowCount(demandSignalId)).toBe(0);
    });

    it("a workforce that cannot be enumerated fails the whole run before any worker is processed", async () => {
      const demandSignalId = await createDemandFixture("B3-B enumeration throws");
      await createWorkerFixture("SYNTHETIC-B3-ENUM-FAIL");
      const failing = instrument(executorId, { searchWorkers: () => Promise.reject(new Error("search exploded")) });
      expect(await evaluateDemandAgainstWorkforce(demandSignalId, failing.deps)).toEqual({ kind: "WORKFORCE_ENUMERATION_FAILED" });
      expect(failing.events.some((e) => e.startsWith("get:") || e.startsWith("persist:"))).toBe(false);
      expect(await rowCount(demandSignalId)).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /* B3-B4 / B3-B7 -- lifecycle recheck and per-worker flow              */
  /* ------------------------------------------------------------------ */

  describe("per-worker flow", () => {
    it("7. / 9. lifecycle is reloaded immediately before each worker is built, evaluated and persisted, strictly one worker at a time", async () => {
      const demandSignalId = await createDemandFixture("B3-B flow order");
      for (const n of [1, 2, 3]) await createWorkerFixture(`SYNTHETIC-B3-FLOW-${n}`);
      const instrumented = instrument();
      await runOk(demandSignalId, instrumented);

      const perWorker = instrumented.events.filter((e) => !e.startsWith("search:") && e !== "demand");
      expect(perWorker).toHaveLength(9);
      for (let i = 0; i < perWorker.length; i += 3) {
        const [get, build, persist] = perWorker.slice(i, i + 3);
        const workerId = get.slice("get:".length);
        expect(get.startsWith("get:")).toBe(true);
        expect(build).toBe(`build:${workerId}`);
        expect(persist).toBe(`persist:${workerId}`);
      }
    });

    it("8. / 20. lifecycle race: a worker deactivated AFTER enumeration is skipped as ineligible, never built, never persisted", async () => {
      const demandSignalId = await createDemandFixture("B3-B lifecycle race");
      const keep = await createWorkerFixture("SYNTHETIC-B3-RACE-KEEP");
      const raced = await createWorkerFixture("SYNTHETIC-B3-RACE-TARGET");
      let deactivated = false;
      const instrumented = instrument(executorId, {
        searchWorkers: async (real, filter) => {
          const page = await real.searchWorkers(filter);
          if (!deactivated && page.kind === "OK" && page.value.length < filter.limit) {
            deactivated = true;
            await admin().updateWorker(raced, { lifecycleStatus: "INACTIVE" });
          }
          return page;
        },
      });
      const run = await runOk(demandSignalId, instrumented);

      expect(deactivated).toBe(true);
      expect(run.eligibleWorkerCount).toBe(2);
      expect(run.ineligibleWorkerCount).toBe(1);
      expect(run.persistedWorkerCount).toBe(1);
      expect(run.failedWorkerCount).toBe(0);
      expect(persistedIds(instrumented.events)).toEqual([keep]);
      expect(instrumented.events).not.toContain(`build:${raced}`);
      expect(await rowCount(demandSignalId, raced)).toBe(0);
    });

    it("6. an ARCHIVED-after-enumeration worker is likewise skipped", async () => {
      const demandSignalId = await createDemandFixture("B3-B archived race");
      const raced = await createWorkerFixture("SYNTHETIC-B3-ARCHIVE-RACE");
      let archivedNow = false;
      const instrumented = instrument(executorId, {
        searchWorkers: async (real, filter) => {
          const page = await real.searchWorkers(filter);
          if (!archivedNow) { archivedNow = true; await admin().archiveWorker(raced); }
          return page;
        },
      });
      const run = await runOk(demandSignalId, instrumented);
      expect(run.ineligibleWorkerCount).toBe(1);
      expect(run.persistedWorkerCount).toBe(0);
      expect(await rowCount(demandSignalId)).toBe(0);
    });

    it("9. an eligible worker is evaluated by the certified engine and its persisted outcome is the engine's own", async () => {
      const demandSignalId = await createDemandFixture("B3-B engine parity");
      const workers = await createOutcomeWorkers("SYNTHETIC-B3-PARITY");
      const run = await runOk(demandSignalId);

      const demandInput = await demandService(adminId).getMatchingReadyInput(demandSignalId);
      if (demandInput.kind !== "OK" || demandInput.value === null) throw new Error("unreachable");
      for (const workerId of Object.values(workers)) {
        const workerInput = await workerService(adminId).buildMatchingReadyInput(workerId);
        if (workerInput.kind !== "OK" || workerInput.value === null) throw new Error("unreachable");
        const direct = evaluateWorkerDemandMatch({ demand: demandInput.value, worker: workerInput.value, workerLifecycleStatus: "ACTIVE", evaluationDate: run.startedAt });
        if (direct.kind !== "EVALUATED") throw new Error("unreachable");
        const persisted = await resultRepository().getCurrentResult(demandSignalId, workerId);
        expect(persisted?.outcome).toBe(direct.evaluation.outcome);
        expect(persisted?.ruleVersion).toBe(MATCHING_RULE_VERSION);
        expect(persisted?.evaluationDate.toISOString()).toBe(run.startedAt.toISOString());
      }
      expect(MATCHING_RULE_VERSION).toBe("matching-b1-d-v1");
    });

    it("10. / 11. / 12. / 13. each outcome is persisted and counted: STRONG_MATCH, POSSIBLE_MATCH, NO_MATCH, INSUFFICIENT_DATA", async () => {
      const demandSignalId = await createDemandFixture("B3-B four outcomes");
      const workers = await createOutcomeWorkers("SYNTHETIC-B3-OUTCOMES");
      const run = await runOk(demandSignalId);

      expect(run.outcomes).toEqual({ STRONG_MATCH: 1, POSSIBLE_MATCH: 1, NO_MATCH: 1, INSUFFICIENT_DATA: 1 });
      expect(run.eligibleWorkerCount).toBe(4);
      expect(run.evaluatedWorkerCount).toBe(4);
      expect(run.persistedWorkerCount).toBe(4);
      expect(run.ineligibleWorkerCount).toBe(0);
      expect(run.failedWorkerCount).toBe(0);
      expect(run.failures).toEqual([]);
      for (const [outcome, workerId] of Object.entries(workers) as [MatchOutcome, string][]) {
        expect((await resultRepository().getCurrentResult(demandSignalId, workerId))?.outcome).toBe(outcome);
      }
    });

    it("the run's timestamps come from the injected clock and bracket the run", async () => {
      const demandSignalId = await createDemandFixture("B3-B clock");
      await createWorkerFixture("SYNTHETIC-B3-CLOCK");
      const run = await runOk(demandSignalId);
      expect(run.demandSignalId).toBe(demandSignalId);
      expect(run.startedAt.toISOString()).toBe(new Date(RUN_BASE_MS).toISOString());
      expect(run.completedAt.getTime()).toBeGreaterThanOrEqual(run.startedAt.getTime());
    });

    it("workers are processed sequentially -- never more than one dependency call in flight", async () => {
      const demandSignalId = await createDemandFixture("B3-B sequential");
      for (const n of [1, 2, 3, 4]) await createWorkerFixture(`SYNTHETIC-B3-SEQ-${n}`);
      let inFlight = 0;
      let maxInFlight = 0;
      const tracked = async <T>(work: () => Promise<T>): Promise<T> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try { await new Promise((r) => setTimeout(r, 3)); return await work(); } finally { inFlight -= 1; }
      };
      const instrumented = instrument(executorId, {
        getWorker: (real, id) => tracked(() => real.getWorker(id)),
        buildMatchingReadyInput: (real, id) => tracked(() => real.buildMatchingReadyInput(id)),
        persist: (real, input) => tracked(() => real.persist(input)),
      });
      const run = await runOk(demandSignalId, instrumented);
      expect(run.persistedWorkerCount).toBe(4);
      expect(maxInFlight).toBe(1);
    });

    it("an engine answer of INELIGIBLE after the explicit check is handled conservatively and never persisted", async () => {
      const demandSignalId = await createDemandFixture("B3-B engine ineligible");
      await createWorkerFixture("SYNTHETIC-B3-ENGINE-INELIGIBLE");
      const instrumented = instrument(executorId, { evaluate: () => ({ kind: "INELIGIBLE", reason: "WORKER_LIFECYCLE_INACTIVE" }) });
      const run = await runOk(demandSignalId, instrumented);
      expect(run.ineligibleWorkerCount).toBe(1);
      expect(run.persistedWorkerCount).toBe(0);
      expect(persistedIds(instrumented.events)).toEqual([]);
      expect(await rowCount(demandSignalId)).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /* B3-B8 -- partial failure                                            */
  /* ------------------------------------------------------------------ */

  describe("partial failure", () => {
    it("14. / 16. / 17. a worker-input build failure is isolated, counted as failed, not as an outcome, and later workers continue", async () => {
      const demandSignalId = await createDemandFixture("B3-B build failure");
      for (const n of [1, 2, 3, 4]) await createWorkerFixture(`SYNTHETIC-B3-BUILDFAIL-${n}`);
      let failedWorker: string | null = null;
      const instrumented = instrument(executorId, {
        buildMatchingReadyInput: (real, id) => {
          failedWorker ??= id;
          if (id === failedWorker) return Promise.reject(new Error("row decode failed for worker@example.com 555-0199"));
          return real.buildMatchingReadyInput(id);
        },
      });
      const run = await runOk(demandSignalId, instrumented);

      expect(run.failures).toEqual([{ workerId: failedWorker, reasonCode: "WORKER_INPUT_BUILD_FAILED" }]);
      expect(run.failedWorkerCount).toBe(1);
      expect(run.persistedWorkerCount).toBe(3);
      expect(run.evaluatedWorkerCount).toBe(3);
      expect(outcomeTotal(run)).toBe(3);
      expect(run.eligibleWorkerCount).toBe(4);
      expect(await rowCount(demandSignalId, failedWorker!)).toBe(0);
      // the failing worker was FIRST in processing order; every later worker still ran to persistence
      expect(persistedIds(instrumented.events)).toHaveLength(3);
      expect(persistedIds(instrumented.events)).not.toContain(failedWorker);
    });

    it("14. a build that yields no matching-ready input is the same isolated WORKER_INPUT_BUILD_FAILED", async () => {
      const demandSignalId = await createDemandFixture("B3-B build null");
      await createWorkerFixture("SYNTHETIC-B3-BUILDNULL-1");
      await createWorkerFixture("SYNTHETIC-B3-BUILDNULL-2");
      let first: string | null = null;
      const run = await runOk(demandSignalId, instrument(executorId, {
        buildMatchingReadyInput: async (real, id) => {
          first ??= id;
          return id === first ? { kind: "OK", value: null } : real.buildMatchingReadyInput(id);
        },
      }));
      expect(run.failures).toEqual([{ workerId: first, reasonCode: "WORKER_INPUT_BUILD_FAILED" }]);
      expect(run.persistedWorkerCount).toBe(1);
    });

    it("15. / 16. / 17. a persistence failure is isolated: evaluated but not persisted, no outcome incremented, later workers continue", async () => {
      const demandSignalId = await createDemandFixture("B3-B persistence failure");
      for (const n of [1, 2, 3, 4]) await createWorkerFixture(`SYNTHETIC-B3-PERSISTFAIL-${n}`);
      let failedWorker: string | null = null;
      const instrumented = instrument(executorId, {
        persist: (real, input) => {
          failedWorker ??= input.worker.workerId;
          if (input.worker.workerId === failedWorker) return Promise.reject(new Error("could not serialize access for worker@example.com"));
          return real.persist(input);
        },
      });
      const run = await runOk(demandSignalId, instrumented);

      expect(run.failures).toEqual([{ workerId: failedWorker, reasonCode: "PERSISTENCE_FAILED" }]);
      expect(run.eligibleWorkerCount).toBe(4);
      expect(run.evaluatedWorkerCount).toBe(4);
      expect(run.persistedWorkerCount).toBe(3);
      expect(outcomeTotal(run)).toBe(3);
      expect(run.outcomes.STRONG_MATCH).toBe(3); // the failed worker would have been the 4th STRONG_MATCH
      expect(await rowCount(demandSignalId, failedWorker!)).toBe(0);
      expect(persistedIds(instrumented.events)).toHaveLength(4);
      expect(await rowCount(demandSignalId)).toBe(3);
    });

    it("an unexpected engine error is isolated as UNEXPECTED_ERROR", async () => {
      const demandSignalId = await createDemandFixture("B3-B unexpected");
      await createWorkerFixture("SYNTHETIC-B3-UNEXPECTED-1");
      await createWorkerFixture("SYNTHETIC-B3-UNEXPECTED-2");
      let calls = 0;
      const run = await runOk(demandSignalId, instrument(executorId, {
        evaluate: (input) => {
          calls += 1;
          if (calls === 1) throw new Error("boom: 555-0100 privacy.worker@example.com");
          return evaluateWorkerDemandMatch(input);
        },
      }));
      expect(run.failures).toHaveLength(1);
      expect(run.failures[0].reasonCode).toBe("UNEXPECTED_ERROR");
      expect(run.persistedWorkerCount).toBe(1);
    });

    it("a worker whose reload yields no record is an isolated UNEXPECTED_ERROR", async () => {
      const demandSignalId = await createDemandFixture("B3-B reload null");
      await createWorkerFixture("SYNTHETIC-B3-RELOAD-1");
      await createWorkerFixture("SYNTHETIC-B3-RELOAD-2");
      let first: string | null = null;
      const run = await runOk(demandSignalId, instrument(executorId, {
        getWorker: async (real, id) => {
          first ??= id;
          return id === first ? { kind: "OK", value: null } : real.getWorker(id);
        },
      }));
      expect(run.failures).toEqual([{ workerId: first, reasonCode: "UNEXPECTED_ERROR" }]);
      expect(run.persistedWorkerCount).toBe(1);
    });

    it("population accounting holds: eligible = persisted + ineligible + failed; evaluated = persisted + PERSISTENCE_FAILED", async () => {
      const demandSignalId = await createDemandFixture("B3-B accounting");
      for (const n of [1, 2, 3, 4, 5, 6]) await createWorkerFixture(`SYNTHETIC-B3-ACCOUNT-${n}`);
      const order: string[] = [];
      const run = await runOk(demandSignalId, instrument(executorId, {
        getWorker: (real, id) => { order.push(id); return real.getWorker(id); },
        buildMatchingReadyInput: (real, id) => (id === order[0] ? Promise.reject(new Error("x")) : real.buildMatchingReadyInput(id)),
        persist: (real, input) => (input.worker.workerId === order[1] ? Promise.reject(new Error("y")) : real.persist(input)),
      }));
      expect(run.eligibleWorkerCount).toBe(run.persistedWorkerCount + run.ineligibleWorkerCount + run.failedWorkerCount);
      expect(run.failures.map((f) => f.reasonCode).sort()).toEqual(["PERSISTENCE_FAILED", "WORKER_INPUT_BUILD_FAILED"]);
      expect(run.evaluatedWorkerCount).toBe(run.persistedWorkerCount + 1);
      expect(run.persistedWorkerCount).toBe(4);
    });
  });

  /* ------------------------------------------------------------------ */
  /* B3-B9 / B3-B10 -- run-scoped summary and re-run                     */
  /* ------------------------------------------------------------------ */

  describe("run scope and re-run", () => {
    it("18. / 19. re-running the same demand supersedes each prior current result and preserves history (B2 supersession reused)", async () => {
      const demandSignalId = await createDemandFixture("B3-B rerun");
      const workers = await createOutcomeWorkers("SYNTHETIC-B3-RERUN");
      const first = await runOk(demandSignalId);
      const before = new Map<string, string>();
      for (const workerId of Object.values(workers)) before.set(workerId, (await resultRepository().getCurrentResult(demandSignalId, workerId))!.id);

      const second = await runOk(demandSignalId);
      expect(second.outcomes).toEqual(first.outcomes);
      expect(second.persistedWorkerCount).toBe(4);

      for (const workerId of Object.values(workers)) {
        const history = await resultRepository().listHistoryForWorker(demandSignalId, workerId);
        expect(history).toHaveLength(2);
        expect(history[0].id).toBe(before.get(workerId));
        expect(history[0].supersededAt).not.toBeNull();
        expect(history[1].supersededAt).toBeNull();
        const current = await resultRepository().getCurrentResult(demandSignalId, workerId);
        expect(current?.id).toBe(history[1].id);
        expect(current?.id).not.toBe(before.get(workerId));
        // the superseded row's own facts and criteria are untouched
        expect((await resultRepository().listCriteriaForResult(history[0].id)).length).toBeGreaterThan(0);
      }
      expect(await rowCount(demandSignalId)).toBe(8);
      expect((await resultRepository().listCurrentResultsForDemand(demandSignalId))).toHaveLength(4);
    });

    it("20. / 21. a worker who became ineligible since the prior run gets no new result, keeps the historical one, and is absent from this run's counts", async () => {
      const demandSignalId = await createDemandFixture("B3-B rerun ineligible");
      const workers = await createOutcomeWorkers("SYNTHETIC-B3-INELIG-RERUN");
      await runOk(demandSignalId);

      const departed = workers.STRONG_MATCH;
      const historicalId = (await resultRepository().getCurrentResult(demandSignalId, departed))!.id;
      await admin().updateWorker(departed, { lifecycleStatus: "INACTIVE" });

      const instrumented = instrument();
      const second = await runOk(demandSignalId, instrumented);

      // the departed worker is not even in the ACTIVE snapshot, so nothing is built or persisted for them
      expect(instrumented.events.some((e) => e.endsWith(departed))).toBe(false);
      expect(second.eligibleWorkerCount).toBe(3);
      expect(second.persistedWorkerCount).toBe(3);
      expect(second.outcomes.STRONG_MATCH).toBe(0);
      expect(outcomeTotal(second)).toBe(3);

      const history = await resultRepository().listHistoryForWorker(demandSignalId, departed);
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe(historicalId);
      expect(history[0].supersededAt).toBeNull();

      // execution summary != persisted current read model: the read model still shows the departed worker's result
      const model = await readModel().getDemandMatchReadModel(demandSignalId);
      if (model.kind !== "OK") throw new Error("unreachable");
      expect(model.value.counts.STRONG_MATCH).toBe(1);
      expect(model.value.counts.STRONG_MATCH + model.value.counts.POSSIBLE_MATCH + model.value.counts.NO_MATCH + model.value.counts.INSUFFICIENT_DATA).toBe(4);
      expect(outcomeTotal(second)).toBe(3);
    });

    it("20. / 21. a worker who goes ineligible mid-run (after the snapshot) is counted ineligible, keeps the historical result, and is excluded from outcomes", async () => {
      const demandSignalId = await createDemandFixture("B3-B rerun ineligible mid-run");
      const workers = await createOutcomeWorkers("SYNTHETIC-B3-MIDRUN");
      await runOk(demandSignalId);
      const departed = workers.NO_MATCH;
      const historicalId = (await resultRepository().getCurrentResult(demandSignalId, departed))!.id;

      let done = false;
      const second = await runOk(demandSignalId, instrument(executorId, {
        searchWorkers: async (real, filter) => {
          const page = await real.searchWorkers(filter);
          if (!done && page.kind === "OK" && page.value.length < filter.limit) { done = true; await admin().updateWorker(departed, { lifecycleStatus: "INACTIVE" }); }
          return page;
        },
      }));

      expect(second.eligibleWorkerCount).toBe(4);
      expect(second.ineligibleWorkerCount).toBe(1);
      expect(second.persistedWorkerCount).toBe(3);
      expect(second.outcomes.NO_MATCH).toBe(0);
      expect(outcomeTotal(second)).toBe(3);
      const history = await resultRepository().listHistoryForWorker(demandSignalId, departed);
      expect(history.map((h) => h.id)).toEqual([historicalId]);
      expect(history[0].supersededAt).toBeNull();
    });

    it("a re-run reflects changed worker facts: the new current result carries the new outcome", async () => {
      const demandSignalId = await createDemandFixture("B3-B rerun changed");
      const worker = await createWorkerFixture("SYNTHETIC-B3-CHANGED", { experienceMonths: 3 });
      expect((await runOk(demandSignalId)).outcomes.NO_MATCH).toBe(1);
      await admin().updateTradeOccupationExperience(worker, "ELECTRICAL", "ELECTRICIAN", 36);
      const second = await runOk(demandSignalId);
      expect(second.outcomes.STRONG_MATCH).toBe(1);
      expect(second.outcomes.NO_MATCH).toBe(0);
      const history = await resultRepository().listHistoryForWorker(demandSignalId, worker);
      expect(history.map((h) => h.outcome)).toEqual(["NO_MATCH", "STRONG_MATCH"]);
    });

    it("the run summary never merges B2 results it did not write: a failed re-run for a worker still leaves the prior result out of the counts", async () => {
      const demandSignalId = await createDemandFixture("B3-B no merge");
      await createWorkerFixture("SYNTHETIC-B3-NOMERGE-1");
      await createWorkerFixture("SYNTHETIC-B3-NOMERGE-2");
      await runOk(demandSignalId);
      const second = await runOk(demandSignalId, instrument(executorId, { persist: () => Promise.reject(new Error("db down")) }));
      expect(second.persistedWorkerCount).toBe(0);
      expect(outcomeTotal(second)).toBe(0);
      expect(second.failures).toHaveLength(2);
      // ...while the persisted current view is untouched by the failed run
      expect((await resultRepository().listCurrentResultsForDemand(demandSignalId))).toHaveLength(2);
    });
  });

  /* ------------------------------------------------------------------ */
  /* B3-B13 / B3-B14 -- pagination                                       */
  /* ------------------------------------------------------------------ */

  describe("pagination", () => {
    it("22. more than one page: every ACTIVE worker is evaluated exactly once, none skipped, none duplicated, non-ACTIVE never included", async () => {
      const demandSignalId = await createDemandFixture("B3-B pagination");
      const active: string[] = [];
      for (let n = 1; n <= 8; n++) active.push(await createWorkerFixture(`SYNTHETIC-B3-PAGE-${n}`, { withTrade: n % 2 === 0 }));
      const inactive = await createWorkerFixture("SYNTHETIC-B3-PAGE-INACTIVE");
      const archived = await createWorkerFixture("SYNTHETIC-B3-PAGE-ARCHIVED");
      await admin().updateWorker(inactive, { lifecycleStatus: "INACTIVE" });
      await admin().archiveWorker(archived);

      const instrumented = instrument(executorId, { pageSize: 3 });
      const run = await runOk(demandSignalId, instrumented);

      expect(instrumented.searchFilters.map((f) => f.offset)).toEqual([0, 3, 6]);
      expect(instrumented.searchFilters.every((f) => f.limit === 3 && f.lifecycleStatus === "ACTIVE")).toBe(true);
      const persisted = persistedIds(instrumented.events);
      expect(persisted).toHaveLength(8);
      expect(new Set(persisted).size).toBe(8);
      expect([...persisted].sort()).toEqual([...active].sort());
      expect(persisted).not.toContain(inactive);
      expect(persisted).not.toContain(archived);
      expect(run.eligibleWorkerCount).toBe(8);
      expect(run.persistedWorkerCount).toBe(8);
      expect(await rowCount(demandSignalId)).toBe(8);
      for (const workerId of active) expect(await rowCount(demandSignalId, workerId)).toBe(1);
    });

    it("22. a population that is an exact multiple of the page size terminates after the empty trailing page", async () => {
      const demandSignalId = await createDemandFixture("B3-B exact multiple");
      for (let n = 1; n <= 6; n++) await createWorkerFixture(`SYNTHETIC-B3-EXACT-${n}`);
      const instrumented = instrument(executorId, { pageSize: 3 });
      const run = await runOk(demandSignalId, instrumented);
      expect(instrumented.searchFilters.map((f) => f.offset)).toEqual([0, 3, 6]);
      expect(run.eligibleWorkerCount).toBe(6);
      expect(new Set(persistedIds(instrumented.events)).size).toBe(6);
    });

    it("22. lifecycle changes across pages are still caught: a worker deactivated once enumeration completed is skipped, the rest are each evaluated once", async () => {
      const demandSignalId = await createDemandFixture("B3-B pagination race");
      const ids: string[] = [];
      for (let n = 1; n <= 7; n++) ids.push(await createWorkerFixture(`SYNTHETIC-B3-PAGERACE-${n}`));
      const target = ids[3];
      let done = false;
      const instrumented = instrument(executorId, {
        pageSize: 2,
        searchWorkers: async (real, filter) => {
          const page = await real.searchWorkers(filter);
          if (!done && page.kind === "OK" && page.value.length < filter.limit) { done = true; await admin().updateWorker(target, { lifecycleStatus: "INACTIVE" }); }
          return page;
        },
      });
      const run = await runOk(demandSignalId, instrumented);
      expect(run.eligibleWorkerCount).toBe(7);
      expect(run.ineligibleWorkerCount).toBe(1);
      expect(run.persistedWorkerCount).toBe(6);
      const persisted = persistedIds(instrumented.events);
      expect(new Set(persisted).size).toBe(6);
      expect(persisted).not.toContain(target);
    });

    it("22. the default page size is 200 and a real 200-boundary is crossed exactly once each (205 workers)", async () => {
      expect(DEMAND_WORKFORCE_PAGE_SIZE).toBe(200);
      const demandSignalId = await createDemandFixture("B3-B default page size");
      await db.exec(
        `insert into workforce_workers (display_name, source_of_record)
         select 'SYNTHETIC-B3-BULK-' || g, 'IMPORTED' from generate_series(1, 205) g`,
      );
      const instrumented = instrument();
      const run = await runOk(demandSignalId, instrumented);
      expect(instrumented.searchFilters.map((f) => [f.offset, f.limit])).toEqual([[0, 200], [200, 200]]);
      expect(run.eligibleWorkerCount).toBe(205);
      expect(run.persistedWorkerCount).toBe(205);
      expect(run.outcomes.INSUFFICIENT_DATA).toBe(205);
      expect(new Set(persistedIds(instrumented.events)).size).toBe(205);
      const distinct = await db.query<{ n: string }>("select count(distinct worker_id)::text n from worker_demand_match_results where demand_signal_id=$1", [demandSignalId]);
      expect(Number((distinct.rows as { n: string }[])[0].n)).toBe(205);
      expect(await rowCount(demandSignalId)).toBe(205);
    }, 180_000);

    it("an invalid page size is rejected rather than silently clamped", async () => {
      const demandSignalId = await createDemandFixture("B3-B bad page size");
      for (const pageSize of [0, -1, 201, 1.5]) {
        await expect(evaluateDemandAgainstWorkforce(demandSignalId, instrument(executorId, { pageSize }).deps)).rejects.toThrow(RangeError);
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /* Privacy of the execution contract                                    */
  /* ------------------------------------------------------------------ */

  describe("execution contract privacy", () => {
    const FORBIDDEN_KEYS = /score|rank|percent|confidence|phone|email|consent|credential|address|message|stack|error/i;
    const collectKeys = (value: unknown, keys: Set<string> = new Set()): Set<string> => {
      if (Array.isArray(value)) value.forEach((v) => collectKeys(v, keys));
      else if (value && typeof value === "object" && !(value instanceof Date)) {
        for (const [k, v] of Object.entries(value)) { keys.add(k); collectKeys(v, keys); }
      }
      return keys;
    };

    it("25. failure entries carry exactly workerId + a closed reasonCode -- no raw exception text", async () => {
      const demandSignalId = await createDemandFixture("B3-B failure privacy");
      for (const n of [1, 2, 3]) await createWorkerFixture(`SYNTHETIC-B3-FAILPRIV-${n}`, { contact: true });
      const order: string[] = [];
      const secret = "connection refused user=svc_fly password=hunter2 worker@example.com 555-0199 123 Main St";
      const run = await runOk(demandSignalId, instrument(executorId, {
        getWorker: (real, id) => { order.push(id); return real.getWorker(id); },
        buildMatchingReadyInput: (real, id) => (id === order[0] ? Promise.reject(new Error(secret)) : real.buildMatchingReadyInput(id)),
        persist: (real, input) => (input.worker.workerId === order[1] ? Promise.reject(new Error(secret)) : real.persist(input)),
        evaluate: (input) => (input.worker.workerId === order[2] ? (() => { throw new Error(secret); })() : evaluateWorkerDemandMatch(input)),
      }));

      expect(run.failures).toHaveLength(3);
      for (const failure of run.failures) {
        expect(Object.keys(failure).sort()).toEqual(["reasonCode", "workerId"]);
        expect(DEMAND_WORKFORCE_FAILURE_REASON_CODES).toContain(failure.reasonCode);
      }
      expect(run.failures.map((f) => f.reasonCode).sort()).toEqual(["PERSISTENCE_FAILED", "UNEXPECTED_ERROR", "WORKER_INPUT_BUILD_FAILED"]);
      const serialized = JSON.stringify(run);
      for (const leak of ["connection refused", "hunter2", "svc_fly", "worker@example.com", "555-0199", "Main St"]) expect(serialized).not.toContain(leak);
    });

    it("26. the execution result carries no contact/PII, name, score, rank, percentage or AI confidence", async () => {
      const demandSignalId = await createDemandFixture("B3-B result privacy");
      const workers = await createOutcomeWorkers("SYNTHETIC-B3-RESULTPRIV");
      await createWorkerFixture("SYNTHETIC-B3-RESULTPRIV-CONTACT", { contact: true });
      const run = await runOk(demandSignalId);

      expect(Object.keys(run).sort()).toEqual([
        "completedAt", "demandSignalId", "eligibleWorkerCount", "evaluatedWorkerCount", "failedWorkerCount", "failures",
        "ineligibleWorkerCount", "outcomes", "persistedWorkerCount", "startedAt",
      ]);
      expect(Object.keys(run.outcomes).sort()).toEqual(["INSUFFICIENT_DATA", "NO_MATCH", "POSSIBLE_MATCH", "STRONG_MATCH"]);
      for (const key of collectKeys(run)) expect(key).not.toMatch(FORBIDDEN_KEYS);
      const serialized = JSON.stringify(run);
      for (const leak of ["555-0142", "privacy.worker@example.com", "SYNTHETIC-B3-RESULTPRIV", "GRANTED", "UNKNOWN"]) expect(serialized).not.toContain(leak);
      expect(Object.values(workers).length).toBe(4);
    });
  });

  /* ------------------------------------------------------------------ */
  /* B3-B17 -- no read-model coupling                                    */
  /* ------------------------------------------------------------------ */

  describe("structure", () => {
    it("17. the orchestrator neither imports nor calls the B2 read model, and uses no unbounded concurrency", async () => {
      const raw = await readFile(resolve(process.cwd(), "src/server/services/matching/evaluate-demand-against-workforce.ts"), "utf8");
      // inspect code, not prose: comments legitimately mention what the orchestrator does NOT do
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(source).not.toMatch(/^import .*matching-read-model-service/m);
      expect(source).not.toContain("getDemandMatchReadModel");
      expect(source).not.toContain("MatchingReadModelService");
      expect(source).not.toMatch(/\bPromise\.all\b/);
      expect(source).not.toMatch(/\bPromise\.allSettled\b/);
      // demand facts come only through the canonical service, never a direct demand_signals query
      expect(source).not.toMatch(/demand_signals/);
      expect(source).not.toMatch(/\.query\(/);
    });

    it("no new schema: B3 introduces no run/queue table and no migration beyond the published B2 one", async () => {
      const files = (await readdir(resolve(process.cwd(), "supabase/migrations"))).filter((f) => /matching_b[123]_/i.test(f)).sort();
      expect(files).toEqual(["20260918010000_matching_b1_demand_readiness.sql", "20260919010000_matching_b2_durable_results.sql"]);
      const tables = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_name like '%match%'");
      expect((tables.rows as { table_name: string }[]).map((t) => t.table_name).sort()).toEqual(["worker_demand_match_criteria", "worker_demand_match_results"]);
    });
  });
});
