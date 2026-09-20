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
import { MatchingPersistenceService, matchingResultPairLockKey } from "../../server/services/matching/matching-persistence-service";
import { evaluateWorkerDemandMatch } from "../../server/matching/evaluate-worker-demand-match";
import { transactionRunnerOnClient } from "../../server/database/transaction";
import type { ServerSession } from "../../server/auth/session";

const EXCLUDED_LOCAL_MIGRATIONS = new Set([
  "20260913133740_discovery_mvp_a0_durable_runs.sql",
  "20260913135341_discovery_mvp_a_candidates.sql",
  "20260914024442_discovery_mvp_b_r1_destination_policy_state.sql",
  "20260914094253_canonical_multi_profession_demand.sql",
  "20260915024424_security_rls_b0_r1_public_routine_defaults.sql",
  "20260915024716_security_rls_b0_r1_global_routine_defaults.sql",
]);
const EVALUATION_DATE = new Date("2026-10-01T00:00:00.000Z");

describe("MATCHING-B3-B persistence advisory lock (statement-level; real cross-connection contention is proven by the live PostgreSQL test)", () => {
  let db: PGlite;
  const operatorId = "b3100000-0000-4000-8000-000000000001";
  const asSql = () => db as unknown as SqlClient;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory = resolve(process.cwd(), "supabase/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql") && !EXCLUDED_LOCAL_MIGRATIONS.has(name)).sort();
    for (const file of files) await db.exec(await readFile(resolve(directory, file), "utf8"));
    await new PostgresOperatorRepository(asSql()).create({
      authUserId: operatorId, email: "lock@example.com", status: "ACTIVE",
      permissions: ["worker_profile.read", "worker_profile.write", "worker_compensation.read", "worker_compensation.write", "demand_requirement.write"],
    });
  }, 120_000);
  afterAll(async () => db.close());

  const session = (): Promise<ServerSession | null> => Promise.resolve({ authUserId: operatorId, email: "irrelevant@example.com" });
  const operatorRepository = () => new PostgresOperatorRepository(asSql());
  const workerService = () => new WorkerService({ repository: new PostgresWorkerRepository(asSql()), transactionRunner: transactionRunnerOnClient(asSql()), getSession: session, operatorRepository: operatorRepository() });
  const demandService = () => new DemandRequirementService({ repository: new PostgresDemandRequirementRepository(asSql()), transactionRunner: transactionRunnerOnClient(asSql()), getSession: session, operatorRepository: operatorRepository() });

  async function fixture(label: string) {
    const inserted = await db.query<{ id: string }>(
      `insert into demand_signals (title, role_type, trade_code, occupation_code, minimum_experience_months, start_date, pay_currency, base_pay_min, base_pay_max, pay_period)
       values ($1,'ELECTRICIAN','ELECTRICAL','ELECTRICIAN',24,'2026-10-01','USD',28,38,'HOURLY') returning id`,
      [label],
    );
    const demandSignalId = (inserted.rows as { id: string }[])[0].id;
    await demandService().setDemandRequirements({ demandSignalId, skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }], credentials: [] });
    const worker = await workerService().createWorker({ displayName: `SYNTHETIC-LOCK-${label}`, sourceOfRecord: "IMPORTED" });
    if (worker.kind !== "OK") throw new Error("worker setup failed");
    const workerId = worker.value.id;
    await workerService().addTradeOccupation({ workerId, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 36 });
    await workerService().addSkill({ workerId, skillCode: "TIG", verificationState: "VERIFIED" });
    await workerService().appendAvailability({ workerId, status: "AVAILABLE", source: "OPERATOR_ENTERED" });
    await workerService().appendCompensationExpectation({ workerId, rateType: "HOURLY", rateMin: 30, currency: "USD", negotiable: false });
    const demand = await demandService().getMatchingReadyInput(demandSignalId);
    const built = await workerService().buildMatchingReadyInput(workerId);
    if (demand.kind !== "OK" || demand.value === null || built.kind !== "OK" || built.value === null) throw new Error("fixture inputs missing");
    const engineResult = evaluateWorkerDemandMatch({ demand: demand.value, worker: built.value, workerLifecycleStatus: "ACTIVE", evaluationDate: EVALUATION_DATE });
    return { demandSignalId, workerId, input: { demand: demand.value, worker: built.value, workerLifecycleStatus: "ACTIVE" as const, evaluationDate: EVALUATION_DATE, engineResult } };
  }

  /** A SqlClient that records every statement (and its bound values) the persistence transaction issues. */
  function recorder() {
    const log: { text: string; values: unknown[] | undefined }[] = [];
    const client: SqlClient = {
      async query<Row>(text: string, values?: unknown[]) {
        log.push({ text: text.replace(/\s+/g, " ").trim(), values });
        return asSql().query<Row>(text, values);
      },
    };
    return { log, service: new MatchingPersistenceService({ transactionRunner: transactionRunnerOnClient(client) }) };
  }

  it("the lock key deterministically embeds matching-result, demandSignalId and workerId", () => {
    const key = matchingResultPairLockKey("d-1", "w-1");
    expect(key).toBe("matching-result:d-1:w-1");
    expect(matchingResultPairLockKey("d-1", "w-1")).toBe(key);
  });

  it("same demand + same worker -> same lock; any different logical pair -> a different, independently lockable key", () => {
    const key = matchingResultPairLockKey("demand-A", "worker-1");
    expect(matchingResultPairLockKey("demand-A", "worker-2")).not.toBe(key);
    expect(matchingResultPairLockKey("demand-B", "worker-1")).not.toBe(key);
    // argument order is significant: (A,B) and (B,A) are different pairs
    expect(matchingResultPairLockKey("worker-1", "demand-A")).not.toBe(key);
  });

  it("persist() acquires the transaction-scoped advisory lock as the first statement of its transaction, BEFORE superseding", async () => {
    const { demandSignalId, workerId, input } = await fixture("order");
    const { log, service } = recorder();
    expect((await service.persist(input)).kind).toBe("PERSISTED");

    const texts = log.map((entry) => entry.text);
    expect(texts[0]).toBe("begin");
    expect(texts[1]).toBe("select pg_advisory_xact_lock(hashtext($1)::bigint)");
    expect(log[1].values).toEqual([matchingResultPairLockKey(demandSignalId, workerId)]);
    const supersedeAt = texts.findIndex((t) => t.startsWith("update worker_demand_match_results set superseded_at"));
    const insertAt = texts.findIndex((t) => t.startsWith("insert into worker_demand_match_results"));
    expect(supersedeAt).toBeGreaterThan(1);
    expect(insertAt).toBeGreaterThan(supersedeAt);
    expect(texts[texts.length - 1]).toBe("commit");
    // transaction-scoped only: no session-level lock/unlock is ever issued
    expect(texts.some((t) => /pg_advisory_lock\b|pg_advisory_unlock/.test(t))).toBe(false);
  });

  it("the lock is released automatically at COMMIT -- nothing lingers", async () => {
    const { input } = await fixture("release-commit");
    const { service } = recorder();
    await service.persist(input);
    const locks = await db.query<{ n: string }>("select count(*)::text n from pg_locks where locktype='advisory'");
    expect(Number((locks.rows as { n: string }[])[0].n)).toBe(0);
  });

  it("a failed persist rolls back (including the supersede), releases the lock without any manual unlock, and leaves the prior current result intact", async () => {
    const { demandSignalId, workerId, input } = await fixture("release-rollback");
    const { service } = recorder();
    const first = await service.persist(input);
    if (first.kind !== "PERSISTED") throw new Error("unreachable");

    // an outcome the results table's CHECK constraint rejects -> insert fails AFTER the supersede ran
    const poisoned = { ...input, engineResult: { kind: "EVALUATED" as const, evaluation: { outcome: "NOT_AN_OUTCOME" as never, criteria: [] } } };
    await expect(service.persist(poisoned)).rejects.toBeDefined();

    const locks = await db.query<{ n: string }>("select count(*)::text n from pg_locks where locktype='advisory'");
    expect(Number((locks.rows as { n: string }[])[0].n)).toBe(0);
    const repository = new PostgresMatchingResultRepository(asSql());
    const current = await repository.getCurrentResult(demandSignalId, workerId);
    expect(current?.id).toBe(first.resultId);
    expect(current?.supersededAt).toBeNull();
    expect(await repository.listHistoryForWorker(demandSignalId, workerId)).toHaveLength(1);

    // and the pair is immediately lockable/persistable again
    expect((await service.persist(input)).kind).toBe("PERSISTED");
    expect(await repository.listHistoryForWorker(demandSignalId, workerId)).toHaveLength(2);
  });

  it("existing B2 supersession behavior is unchanged by the lock: repeated persists still yield one current row and preserved history", async () => {
    const { demandSignalId, workerId, input } = await fixture("supersession");
    const { service } = recorder();
    for (let i = 0; i < 3; i++) expect((await service.persist(input)).kind).toBe("PERSISTED");
    const repository = new PostgresMatchingResultRepository(asSql());
    const history = await repository.listHistoryForWorker(demandSignalId, workerId);
    expect(history).toHaveLength(3);
    expect(history.filter((h) => h.supersededAt === null)).toHaveLength(1);
    expect((await repository.listCurrentResultsForDemand(demandSignalId))).toHaveLength(1);
  });

  it("a non-EVALUATED engine result still persists nothing and takes no lock", async () => {
    const { input } = await fixture("ineligible");
    const { log, service } = recorder();
    const outcome = await service.persist({ ...input, engineResult: { kind: "INELIGIBLE", reason: "WORKER_LIFECYCLE_INACTIVE" } });
    expect(outcome).toEqual({ kind: "NOT_PERSISTED_INELIGIBLE" });
    expect(log).toEqual([]);
  });
});
