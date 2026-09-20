import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import type { TransactionRunner } from "../../server/database/transaction";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresWorkerRepository } from "../../server/repositories/worker/postgres-worker-repository";
import { PostgresDemandRequirementRepository } from "../../server/repositories/demand/postgres-demand-requirement-repository";
import { PostgresMatchingResultRepository } from "../../server/repositories/matching/postgres-matching-result-repository";
import { WorkerService } from "../../server/services/worker/worker-service";
import { DemandRequirementService } from "../../server/services/demand/demand-requirement-service";
import { MatchingPersistenceService, matchingResultPairLockKey } from "../../server/services/matching/matching-persistence-service";
import { evaluateDemandAgainstWorkforce } from "../../server/services/matching/evaluate-demand-against-workforce";
import { evaluateWorkerDemandMatch } from "../../server/matching/evaluate-worker-demand-match";
import type { ServerSession } from "../../server/auth/session";

/**
 * MATCHING-B3-B live concurrency proof. Real PostgreSQL only: PGlite is one
 * embedded session, so two of its "concurrent" transactions never actually
 * contend for an advisory lock. Excluded from `npm test` by the `*.live.test.ts`
 * convention; run explicitly against a DISPOSABLE local database:
 *
 *   WORKFORCE_RADAR_MATCHING_B3_LOCAL_DATABASE_URL=postgresql://user:pw@127.0.0.1:PORT/<name>_disposable \
 *     npx vitest run src/test/matching/matching-b3-persistence-concurrency.live.test.ts
 *
 * Guards (this file applies migrations, so it must never point at a real DB):
 * localhost only, database name must end in `_disposable`, and the database
 * must be empty of the workforce schema before the migrations run.
 */
const databaseUrl = process.env.WORKFORCE_RADAR_MATCHING_B3_LOCAL_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("WORKFORCE_RADAR_MATCHING_B3_LOCAL_DATABASE_URL must target localhost");
  if (!url.pathname.slice(1).endsWith("_disposable")) throw new Error("WORKFORCE_RADAR_MATCHING_B3_LOCAL_DATABASE_URL must name a database ending in _disposable");
}

const EXCLUDED_LOCAL_MIGRATIONS = new Set([
  "20260913133740_discovery_mvp_a0_durable_runs.sql",
  "20260913135341_discovery_mvp_a_candidates.sql",
  "20260914024442_discovery_mvp_b_r1_destination_policy_state.sql",
  "20260914094253_canonical_multi_profession_demand.sql",
  "20260915024424_security_rls_b0_r1_public_routine_defaults.sql",
  "20260915024716_security_rls_b0_r1_global_routine_defaults.sql",
]);
const EVALUATION_DATE = new Date("2026-10-01T00:00:00.000Z");

const asSqlClient = (client: Pool | PoolClient): SqlClient => ({
  async query<Row>(text: string, values?: unknown[]) {
    const result = await client.query(text, values);
    return { rows: result.rows as Row[] };
  },
});

/** One dedicated physical connection per transaction -- genuinely concurrent across calls. */
const poolTransactionRunner = (pool: Pool): TransactionRunner => async (fn) => {
  const session = await pool.connect();
  const client = asSqlClient(session);
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    session.release();
  }
};

describe.skipIf(!databaseUrl)("MATCHING-B3-B real PostgreSQL same-pair persistence concurrency", () => {
  let control: Pool;
  let workers: Pool;
  const operatorAuthUserId = "b3200000-0000-4000-8000-000000000001";
  const runnerAuthUserId = "b3200000-0000-4000-8000-000000000002";
  let sequence = 0;

  beforeAll(async () => {
    control = new Pool({ connectionString: databaseUrl, max: 4, application_name: "b3b-control" });
    workers = new Pool({ connectionString: databaseUrl, max: 16, application_name: "b3b-workers" });
    const existing = await control.query("select to_regclass('public.workforce_workers') as t");
    if (existing.rows[0].t !== null) throw new Error("Refusing to run: the target database already contains the workforce schema (must be a fresh disposable database)");
    await control.query(
      `do $$ begin
         if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
         if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
         if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin; end if;
       end $$`,
    );
    const directory = resolve(process.cwd(), "supabase/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql") && !EXCLUDED_LOCAL_MIGRATIONS.has(name)).sort();
    for (const file of files) await control.query(await readFile(resolve(directory, file), "utf8"));

    const operators = new PostgresOperatorRepository(asSqlClient(control));
    await operators.create({
      authUserId: operatorAuthUserId, email: "b3b-fixtures@example.com", status: "ACTIVE",
      permissions: ["worker_profile.read", "worker_profile.write", "worker_compensation.read", "worker_compensation.write", "demand_requirement.write"],
    });
    await operators.create({
      authUserId: runnerAuthUserId, email: "b3b-runner@example.com", status: "ACTIVE",
      permissions: ["matching.execute", "worker_profile.read", "worker_compensation.read", "demand_requirement.write"],
    });
  }, 180_000);

  afterAll(async () => {
    await Promise.all([control?.end(), workers?.end()]);
  });

  const sessionFor = (id: string) => (): Promise<ServerSession | null> => Promise.resolve({ authUserId: id, email: "irrelevant@example.com" });
  const operatorRepository = () => new PostgresOperatorRepository(asSqlClient(control));
  const workerService = (as: string = operatorAuthUserId) =>
    new WorkerService({ repository: new PostgresWorkerRepository(asSqlClient(control)), transactionRunner: poolTransactionRunner(control), getSession: sessionFor(as), operatorRepository: operatorRepository() });
  const demandService = (as: string = operatorAuthUserId) =>
    new DemandRequirementService({ repository: new PostgresDemandRequirementRepository(asSqlClient(control)), transactionRunner: poolTransactionRunner(control), getSession: sessionFor(as), operatorRepository: operatorRepository() });
  const persistenceOn = (pool: Pool) => new MatchingPersistenceService({ transactionRunner: poolTransactionRunner(pool) });
  const results = () => new PostgresMatchingResultRepository(asSqlClient(control));

  async function newDemand(label: string): Promise<string> {
    const inserted = await control.query(
      `insert into demand_signals (title, role_type, trade_code, occupation_code, minimum_experience_months, start_date, pay_currency, base_pay_min, base_pay_max, pay_period)
       values ($1,'ELECTRICIAN','ELECTRICAL','ELECTRICIAN',24,'2026-10-01','USD',28,38,'HOURLY') returning id`,
      [`B3-B live ${label} ${++sequence}`],
    );
    const demandSignalId = String(inserted.rows[0].id);
    await demandService().setDemandRequirements({
      demandSignalId,
      skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }],
      credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED" }],
    });
    return demandSignalId;
  }

  async function newWorker(label: string): Promise<string> {
    const created = await workerService().createWorker({ displayName: `SYNTHETIC-B3-LIVE-${label}-${++sequence}`, sourceOfRecord: "IMPORTED" });
    if (created.kind !== "OK") throw new Error("worker setup failed");
    const workerId = created.value.id;
    await workerService().addTradeOccupation({ workerId, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 36 });
    await workerService().addSkill({ workerId, skillCode: "TIG", verificationState: "VERIFIED" });
    await workerService().addCredential({ workerId, credentialCode: "OSHA_10", verificationState: "VERIFIED", verifiedAt: new Date("2026-01-01T00:00:00.000Z") });
    await workerService().appendAvailability({ workerId, status: "AVAILABLE", source: "OPERATOR_ENTERED" });
    await workerService().appendCompensationExpectation({ workerId, rateType: "HOURLY", rateMin: 30, currency: "USD", negotiable: false });
    return workerId;
  }

  async function persistInput(demandSignalId: string, workerId: string) {
    const demand = await demandService().getMatchingReadyInput(demandSignalId);
    const built = await workerService().buildMatchingReadyInput(workerId);
    if (demand.kind !== "OK" || demand.value === null || built.kind !== "OK" || built.value === null) throw new Error("fixture inputs missing");
    const engineResult = evaluateWorkerDemandMatch({ demand: demand.value, worker: built.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE });
    if (engineResult.kind !== "EVALUATED") throw new Error("unreachable");
    return { input: { demand: demand.value, worker: built.value, workerLifecycleStatus: "ACTIVE" as const, evaluationDate: EVALUATION_DATE, engineResult }, criteriaCount: engineResult.evaluation.criteria.length };
  }

  interface Row { id: string; evaluated_at: Date; superseded_at: Date | null; created_at: Date }
  async function pairRows(demandSignalId: string, workerId: string): Promise<Row[]> {
    const q = await control.query<Row>(
      "select id, evaluated_at, superseded_at, created_at from worker_demand_match_results where demand_signal_id=$1 and worker_id=$2 order by evaluated_at, created_at",
      [demandSignalId, workerId],
    );
    return q.rows;
  }
  async function criteriaCounts(demandSignalId: string, workerId: string): Promise<number[]> {
    const q = await control.query<{ n: number }>(
      `select count(c.id)::int n from worker_demand_match_results r left join worker_demand_match_criteria c on c.match_result_id=r.id
       where r.demand_signal_id=$1 and r.worker_id=$2 group by r.id`,
      [demandSignalId, workerId],
    );
    return q.rows.map((r) => r.n);
  }

  /** Blocks until some backend of `application` is waiting on an advisory lock (or the given lock kind). */
  async function waitUntilBlocked(application: string, waitEvent = "advisory", timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const q = await control.query(
        "select count(*)::int n from pg_stat_activity where application_name=$1 and wait_event_type='Lock' and wait_event=$2",
        [application, waitEvent],
      );
      if (q.rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out waiting for ${application} to block on ${waitEvent}`);
  }

  async function holdPairLock(demandSignalId: string, workerId: string): Promise<PoolClient> {
    const gate = await control.connect();
    await gate.query("begin");
    await gate.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [matchingResultPairLockKey(demandSignalId, workerId)]);
    return gate;
  }

  it("27. / 28. concurrent persists for the SAME demand+worker pair all succeed, with no unique-index race, exactly one current row, and valid history", async () => {
    const demandSignalId = await newDemand("same pair");
    const workerId = await newWorker("same-pair");
    const { input, criteriaCount } = await persistInput(demandSignalId, workerId);
    const CONTENDERS = 10;

    const settled = await Promise.allSettled(Array.from({ length: CONTENDERS }, () => persistenceOn(workers).persist(input)));

    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(rejected.map((r) => (r.reason as { code?: string; message?: string }).code ?? (r.reason as Error).message)).toEqual([]);
    for (const s of settled) expect(s.status === "fulfilled" && s.value.kind).toBe("PERSISTED");

    const rows = await pairRows(demandSignalId, workerId);
    expect(rows).toHaveLength(CONTENDERS);
    expect(rows.filter((r) => r.superseded_at === null)).toHaveLength(1);
    expect(rows.filter((r) => r.superseded_at !== null)).toHaveLength(CONTENDERS - 1);
    expect(await results().listCurrentResultsForDemand(demandSignalId)).toHaveLength(1);

    // history validity: the winner is the latest evaluation; every superseded row was closed at the moment some later row was evaluated
    const current = rows.find((r) => r.superseded_at === null)!;
    const evaluatedAtMs = new Set(rows.map((r) => r.evaluated_at.getTime()));
    for (const row of rows.filter((r) => r.superseded_at !== null)) {
      expect(evaluatedAtMs.has(row.superseded_at!.getTime())).toBe(true);
      expect(row.superseded_at!.getTime()).toBeLessThanOrEqual(current.evaluated_at.getTime());
      expect(row.superseded_at!.getTime()).toBeGreaterThanOrEqual(row.evaluated_at.getTime());
    }
    expect(current.evaluated_at.getTime()).toBe(Math.max(...rows.map((r) => r.evaluated_at.getTime())));
    // every row (superseded or current) kept a complete criteria set -- nothing half-written
    expect(await criteriaCounts(demandSignalId, workerId)).toEqual(Array(CONTENDERS).fill(criteriaCount));
  }, 120_000);

  it("27. / 28. many independent pairs contending at once: each pair ends with exactly one current row and none fail", async () => {
    const demandSignalId = await newDemand("many pairs");
    const workerIds = await Promise.all(["a", "b", "c", "d", "e"].map((l) => newWorker(`many-${l}`)));
    const prepared = await Promise.all(workerIds.map((w) => persistInput(demandSignalId, w)));
    const PER_PAIR = 6;

    const settled = await Promise.allSettled(prepared.flatMap((p) => Array.from({ length: PER_PAIR }, () => persistenceOn(workers).persist(p.input))));
    expect(settled.filter((s) => s.status === "rejected")).toEqual([]);

    for (const [i, workerId] of workerIds.entries()) {
      const rows = await pairRows(demandSignalId, workerId);
      expect(rows).toHaveLength(PER_PAIR);
      expect(rows.filter((r) => r.superseded_at === null)).toHaveLength(1);
      expect(await criteriaCounts(demandSignalId, workerId)).toEqual(Array(PER_PAIR).fill(prepared[i].criteriaCount));
    }
    expect(await results().listCurrentResultsForDemand(demandSignalId)).toHaveLength(workerIds.length);
  }, 120_000);

  it("lock identity: a persist for pair X really waits on pair X's advisory lock, while a DIFFERENT pair is independently lockable and completes", async () => {
    const demandSignalId = await newDemand("independent");
    const workerX = await newWorker("indep-x");
    const workerY = await newWorker("indep-y");
    const x = await persistInput(demandSignalId, workerX);
    const y = await persistInput(demandSignalId, workerY);
    const poolX = new Pool({ connectionString: databaseUrl, max: 1, application_name: "b3b-persist-x" });
    const poolY = new Pool({ connectionString: databaseUrl, max: 1, application_name: "b3b-persist-y" });
    const gate = await holdPairLock(demandSignalId, workerX);
    try {
      let xFinished = false;
      const persistX = persistenceOn(poolX).persist(x.input).then((value) => { xFinished = true; return value; });
      await waitUntilBlocked("b3b-persist-x");

      // pair Y (same demand, different worker) is not blocked by X's lock
      expect((await persistenceOn(poolY).persist(y.input)).kind).toBe("PERSISTED");
      expect(xFinished).toBe(false);
      expect(await pairRows(demandSignalId, workerX)).toHaveLength(0);

      await gate.query("commit");
      expect((await persistX).kind).toBe("PERSISTED");
    } finally {
      await gate.query("rollback").catch(() => {});
      gate.release();
      await Promise.all([poolX.end(), poolY.end()]);
    }
    expect((await pairRows(demandSignalId, workerX)).filter((r) => r.superseded_at === null)).toHaveLength(1);
    expect((await pairRows(demandSignalId, workerY)).filter((r) => r.superseded_at === null)).toHaveLength(1);
  }, 60_000);

  it("a persist that waited for the lock supersedes the row the previous holder committed (READ COMMITTED refresh after the lock)", async () => {
    const demandSignalId = await newDemand("waiter supersedes");
    const workerId = await newWorker("waiter");
    const { input } = await persistInput(demandSignalId, workerId);
    const poolWaiter = new Pool({ connectionString: databaseUrl, max: 1, application_name: "b3b-persist-waiter" });
    const gate = await holdPairLock(demandSignalId, workerId);
    try {
      const waiter = persistenceOn(poolWaiter).persist(input);
      await waitUntilBlocked("b3b-persist-waiter");

      // stand-in for a concurrent winner: commits a current row for the same pair while holding the pair lock
      await gate.query(
        `insert into worker_demand_match_results (demand_signal_id, worker_id, outcome, rule_version, evaluation_date, evaluated_at, worker_input_fingerprint, demand_input_fingerprint, worker_lifecycle_status_at_evaluation)
         values ($1,$2,'STRONG_MATCH','matching-b1-d-v1',$3,now(),'w-fp','d-fp','ACTIVE')`,
        [demandSignalId, workerId, EVALUATION_DATE],
      );
      await gate.query("commit");

      expect((await waiter).kind).toBe("PERSISTED");
    } finally {
      await gate.query("rollback").catch(() => {});
      gate.release();
      await poolWaiter.end();
    }
    const rows = await pairRows(demandSignalId, workerId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.superseded_at === null)).toHaveLength(1);
    expect(rows[0].superseded_at).not.toBeNull(); // the winner's row was superseded, not clobbered or duplicated
  }, 60_000);

  it("negative control: WITHOUT the lock the same interleaving really does hit the unique-index race (23505) -- so the tests above have teeth", async () => {
    const demandSignalId = await newDemand("negative control");
    const workerId = await newWorker("negative");
    const insertCurrent = `insert into worker_demand_match_results (demand_signal_id, worker_id, outcome, rule_version, evaluation_date, evaluated_at, worker_input_fingerprint, demand_input_fingerprint, worker_lifecycle_status_at_evaluation)
                           values ($1,$2,'STRONG_MATCH','matching-b1-d-v1',$3,now(),'w-fp','d-fp','ACTIVE')`;
    const supersede = "update worker_demand_match_results set superseded_at=now() where demand_signal_id=$1 and worker_id=$2 and superseded_at is null";
    const poolB = new Pool({ connectionString: databaseUrl, max: 1, application_name: "b3b-unlocked-b" });
    const txA = await control.connect();
    const txB = await poolB.connect();
    try {
      await txA.query("begin");
      await txA.query(supersede, [demandSignalId, workerId]);
      await txA.query(insertCurrent, [demandSignalId, workerId, EVALUATION_DATE]); // A: uncommitted current row

      await txB.query("begin");
      await txB.query(supersede, [demandSignalId, workerId]); // B sees no committed current row -> supersedes nothing
      const bInsert = txB.query(insertCurrent, [demandSignalId, workerId, EVALUATION_DATE]).then(() => null, (error: { code?: string }) => error);
      await waitUntilBlocked("b3b-unlocked-b", "transactionid"); // B is stuck on A's index entry

      await txA.query("commit");
      const failure = await bInsert;
      expect(failure?.code).toBe("23505");
    } finally {
      await txA.query("rollback").catch(() => {});
      await txB.query("rollback").catch(() => {});
      txA.release();
      txB.release();
      await poolB.end();
    }
  }, 60_000);

  it("the B2 partial unique index is not weakened: still exactly one current row per pair, enforced by the database", async () => {
    const index = await control.query("select indexdef from pg_indexes where indexname='worker_demand_match_results_current_unique_idx'");
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0].indexdef).toMatch(/UNIQUE/i);
    expect(index.rows[0].indexdef).toMatch(/superseded_at IS NULL/i);

    const demandSignalId = await newDemand("index");
    const workerId = await newWorker("index");
    const { input } = await persistInput(demandSignalId, workerId);
    await persistenceOn(workers).persist(input);
    await expect(
      control.query(
        `insert into worker_demand_match_results (demand_signal_id, worker_id, outcome, rule_version, evaluation_date, evaluated_at, worker_input_fingerprint, demand_input_fingerprint, worker_lifecycle_status_at_evaluation)
         values ($1,$2,'STRONG_MATCH','matching-b1-d-v1',$3,now(),'w-fp','d-fp','ACTIVE')`,
        [demandSignalId, workerId, EVALUATION_DATE],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  }, 60_000);

  // Smoke test only: whether two runs actually collide on one pair is timing-dependent, so this can pass even
  // without the lock (verified by mutation). The deterministic proofs above are what pin the lock's behavior.
  it("end-to-end smoke: two overlapping orchestrator runs for the SAME demand both complete with zero failures and one current row per worker", async () => {
    const demandSignalId = await newDemand("overlapping runs");
    // isolate the population: earlier tests' workers must not be ACTIVE for this run
    await control.query("update workforce_workers set lifecycle_status='INACTIVE' where lifecycle_status='ACTIVE'");
    const workerIds = await Promise.all(["1", "2", "3", "4", "5", "6"].map((l) => newWorker(`overlap-${l}`)));

    const runOnce = () =>
      evaluateDemandAgainstWorkforce(demandSignalId, {
        demandRequirementService: demandService(runnerAuthUserId),
        workerService: workerService(runnerAuthUserId),
        persistenceService: persistenceOn(workers),
        getSession: sessionFor(runnerAuthUserId),
        operatorRepository: operatorRepository(),
      });
    const [a, b] = await Promise.all([runOnce(), runOnce()]);

    for (const run of [a, b]) {
      if (run.kind !== "OK") throw new Error(`expected OK, got ${run.kind}`);
      expect(run.value.failures).toEqual([]);
      expect(run.value.eligibleWorkerCount).toBe(6);
      expect(run.value.persistedWorkerCount).toBe(6);
      expect(run.value.outcomes.STRONG_MATCH).toBe(6);
    }
    for (const workerId of workerIds) {
      const rows = await pairRows(demandSignalId, workerId);
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.superseded_at === null)).toHaveLength(1);
    }
    expect(await results().listCurrentResultsForDemand(demandSignalId)).toHaveLength(6);
  }, 120_000);
});
