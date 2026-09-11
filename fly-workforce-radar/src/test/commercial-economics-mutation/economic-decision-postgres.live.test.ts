import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateEconomicDecisionMutationInput, EconomicDisposition } from "../../domain/economic-decision";
import { executeProtectedCreateEconomicDecision } from "../../server/mutation/protected-economic-decision-mutation";
import type { ServerSession } from "../../server/auth/session";
import type { TransactionRunner } from "../../server/database/transaction";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresEconomicsScenarioRepository } from "../../server/repositories/economics-scenario/postgres-economics-scenario-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";

const databaseUrl = process.env.WORKFORCE_RADAR_4J_R1_LOCAL_DATABASE_URL;
const localHost = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && localHost !== "127.0.0.1" && localHost !== "localhost") {
  throw new Error("WORKFORCE_RADAR_4J_R1_LOCAL_DATABASE_URL must target localhost");
}

const migrations = [
  "20260817010000_canonical_model.sql",
  "20260817090000_opportunity_graph.sql",
  "20260905010000_operator_identity_and_safe_mutation.sql",
  "20260907010000_commercial_economics_persistence.sql",
  "20260910120000_phase_4j_durable_economic_decisions.sql",
];

const asSqlClient = (client: Pool | PoolClient): SqlClient => ({
  async query<Row>(text: string, values?: unknown[]) {
    const result = await client.query(text, values);
    return { rows: result.rows as Row[] };
  },
});

const transactionRunner = (pool: Pool, failAfterCallback = false): TransactionRunner => async (fn) => {
  const session = await pool.connect();
  const client = asSqlClient(session);
  try {
    await client.query("begin");
    const result = await fn(client);
    if (failAfterCallback) throw new Error("R1 forced post-lock rollback");
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    session.release();
  }
};

describe.skipIf(!databaseUrl)("Phase 4J-R1 real PostgreSQL decision concurrency", () => {
  let poolA: Pool;
  let poolB: Pool;
  let control: Pool;
  let operatorId: string;
  const operatorAuthUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let sequence = 0;

  beforeAll(async () => {
    poolA = new Pool({ connectionString: databaseUrl, max: 1, application_name: "phase-4j-r1-a" });
    poolB = new Pool({ connectionString: databaseUrl, max: 1, application_name: "phase-4j-r1-b" });
    control = new Pool({ connectionString: databaseUrl, max: 4, application_name: "phase-4j-r1-control" });
    for (const migration of migrations) await control.query(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    const pidA = Number((await poolA.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0].pid);
    const pidB = Number((await poolB.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0].pid);
    expect(pidA).not.toBe(pidB);
    operatorId = (await new PostgresOperatorRepository(asSqlClient(control)).create({
      authUserId: operatorAuthUserId,
      email: "phase-4j-r1@example.com",
      permissions: ["commercial_economics.decide"],
    })).id;
  }, 60_000);

  afterAll(async () => {
    await Promise.all([poolA?.end(), poolB?.end(), control?.end()]);
  });

  const session = (): Promise<ServerSession> => Promise.resolve({ authUserId: operatorAuthUserId, email: "phase-4j-r1@example.com" });
  const deps = (pool: Pool, runner = transactionRunner(pool)) => ({
    transactionRunner: runner,
    operatorRepository: new PostgresOperatorRepository(asSqlClient(control)),
    getSession: session,
    clock: () => new Date("2026-09-10T20:00:00.000Z"),
  });

  async function basis(label: string) {
    const projectId = String((await control.query("insert into projects(name) values($1) returning id", [`4J-R1 ${label}`])).rows[0].id);
    const opportunityId = String((await control.query(
      "insert into opportunities(title,project_id,opportunity_identity_key) values($1,$2,$3) returning id",
      [`4J-R1 ${label}`, projectId, `4j-r1-${label}-${++sequence}`],
    )).rows[0].id);
    const snapshot = await new PostgresEconomicsScenarioRepository(asSqlClient(control)).createSnapshot({
      opportunityId, scenarioLabel: "BASE", commercialTermsVersionId: null, burdenProfileVersionId: null,
      basis: {}, result: { weakestTier: "OPERATOR_ASSUMPTION", blockingReasons: ["R1 audit context"] },
      ruleVersion: "4f@1", assertedBy: null, evaluatedAt: new Date(), asOf: new Date(), supersedesScenarioId: null,
    });
    return { opportunityId, scenarioSnapshotId: snapshot.id };
  }

  function input(
    ids: Awaited<ReturnType<typeof basis>>,
    key: string,
    disposition: EconomicDisposition,
    expectedCurrentDecisionId: string | null = null,
  ): CreateEconomicDecisionMutationInput {
    return {
      ...ids, disposition, expectedCurrentDecisionId,
      rationale: `Independent human rationale for ${disposition}`,
      ruleVersion: "economic-decision@1",
      idempotencyKey: key,
    };
  }

  async function holdOpportunityLock(opportunityId: string): Promise<PoolClient> {
    const gate = await control.connect();
    await gate.query("begin");
    await gate.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [`economic-decision:${opportunityId}`]);
    return gate;
  }

  async function waitForBlocked(applications: readonly string[]): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const waiting = await control.query<{ application_name: string }>(
        `select application_name from pg_stat_activity
         where application_name=any($1::text[]) and wait_event_type='Lock' and wait_event='advisory'`,
        [[...applications]],
      );
      if (new Set(waiting.rows.map((row) => row.application_name)).size === applications.length) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    throw new Error(`Timed out waiting for advisory-lock overlap: ${applications.join(",")}`);
  }

  async function directDecision(
    opportunityId: string,
    scenarioSnapshotId: string,
    supersedesDecisionId: string | null,
    disposition: EconomicDisposition = "PROCEED",
  ): Promise<string> {
    return String((await control.query(
      `insert into economic_decisions(opportunity_id,scenario_snapshot_id,disposition,rationale,scenario_effective_certainty,scenario_blocking_reasons,rule_version,decided_by,decided_at,supersedes_decision_id)
       values($1,$2,$3,'Direct invariant proof','VERIFIED','{}','economic-decision@1',$4,now(),$5) returning id`,
      [opportunityId, scenarioSnapshotId, disposition, operatorId, supersedesDecisionId],
    )).rows[0].id);
  }

  it("enforces all eight decision-lineage invariants directly in PostgreSQL", async () => {
    const a = await basis("direct-a");
    const b = await basis("direct-b");
    const d1 = await directDecision(a.opportunityId, a.scenarioSnapshotId, null);
    await expect(directDecision(a.opportunityId, a.scenarioSnapshotId, null, "DECLINE")).rejects.toMatchObject({ code: "23505" });
    await expect(directDecision(b.opportunityId, b.scenarioSnapshotId, null)).resolves.toEqual(expect.any(String));
    await expect(directDecision(b.opportunityId, b.scenarioSnapshotId, d1, "DEFER")).rejects.toMatchObject({ code: "23503" });
    const d2 = await directDecision(a.opportunityId, a.scenarioSnapshotId, d1, "DEFER");
    await expect(directDecision(a.opportunityId, a.scenarioSnapshotId, d1, "DECLINE")).rejects.toMatchObject({ code: "23505" });
    await expect(control.query("update economic_decisions set disposition='DECLINE' where id=$1", [d1])).rejects.toThrow(/append-only/);
    await expect(control.query("delete from economic_decisions where id=$1", [d2])).rejects.toThrow(/append-only/);
    expect(Number((await control.query("select count(*) c from economic_decisions where opportunity_id=$1", [a.opportunityId])).rows[0].c)).toBe(2);
  });

  it("serializes concurrent initial decisions into one root and one deterministic loser", async () => {
    const ids = await basis("concurrent-root");
    const gate = await holdOpportunityLock(ids.opportunityId);
    const requestA = executeProtectedCreateEconomicDecision(input(ids, `root-a-${sequence}`, "PROCEED"), deps(poolA));
    const requestB = executeProtectedCreateEconomicDecision(input(ids, `root-b-${sequence}`, "DECLINE"), deps(poolB));
    await waitForBlocked(["phase-4j-r1-a", "phase-4j-r1-b"]);
    await gate.query("commit");
    gate.release();
    const outcomes = await Promise.all([requestA, requestB]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["EXECUTED", "REJECTED"]);
    expect(outcomes.find((outcome) => outcome.kind === "REJECTED")).toMatchObject({ kind: "REJECTED", reason: "CONCURRENCY_CONFLICT" });
    expect(Number((await control.query("select count(*) c from economic_decisions where opportunity_id=$1 and supersedes_decision_id is null", [ids.opportunityId])).rows[0].c)).toBe(1);
    expect(Number((await control.query("select count(*) c from command_idempotency_keys where target_id=$1 and result->>'kind'='EXECUTED'", [ids.opportunityId])).rows[0].c)).toBe(1);
    expect(poolA.waitingCount + poolB.waitingCount).toBe(0);
  }, 15_000);

  it("allows exactly one concurrent successor of the same current decision", async () => {
    const ids = await basis("concurrent-successor");
    const initial = await executeProtectedCreateEconomicDecision(input(ids, `successor-root-${sequence}`, "PROCEED"), deps(poolA));
    expect(initial.kind).toBe("EXECUTED");
    if (initial.kind !== "EXECUTED") return;
    const gate = await holdOpportunityLock(ids.opportunityId);
    const requestA = executeProtectedCreateEconomicDecision(input(ids, `successor-a-${sequence}`, "DECLINE", initial.decision.id), deps(poolA));
    const requestB = executeProtectedCreateEconomicDecision(input(ids, `successor-b-${sequence}`, "DEFER", initial.decision.id), deps(poolB));
    await waitForBlocked(["phase-4j-r1-a", "phase-4j-r1-b"]);
    await gate.query("commit");
    gate.release();
    const outcomes = await Promise.all([requestA, requestB]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["EXECUTED", "REJECTED"]);
    expect(outcomes.find((outcome) => outcome.kind === "REJECTED")).toMatchObject({ kind: "REJECTED", reason: "CONCURRENCY_CONFLICT" });
    expect(Number((await control.query("select count(*) c from economic_decisions where supersedes_decision_id=$1", [initial.decision.id])).rows[0].c)).toBe(1);
    expect((await control.query("select disposition from economic_decisions where id=$1", [initial.decision.id])).rows[0].disposition).toBe("PROCEED");
    expect(poolA.waitingCount + poolB.waitingCount).toBe(0);
  }, 15_000);

  it("uses stable opportunity lock identity without blocking a different opportunity", async () => {
    const a = await basis("parallel-a");
    const b = await basis("parallel-b");
    const lockAFromA = String((await poolA.query("select hashtext($1)::bigint lock_id", [`economic-decision:${a.opportunityId}`])).rows[0].lock_id);
    const lockAFromB = String((await poolB.query("select hashtext($1)::bigint lock_id", [`economic-decision:${a.opportunityId}`])).rows[0].lock_id);
    const lockB = String((await poolB.query("select hashtext($1)::bigint lock_id", [`economic-decision:${b.opportunityId}`])).rows[0].lock_id);
    expect(lockAFromA).toBe(lockAFromB);
    expect(lockAFromA).not.toBe(lockB);

    const gate = await holdOpportunityLock(a.opportunityId);
    const blockedA = executeProtectedCreateEconomicDecision(input(a, `parallel-a-${sequence}`, "PROCEED"), deps(poolA));
    await waitForBlocked(["phase-4j-r1-a"]);
    const independentB = executeProtectedCreateEconomicDecision(input(b, `parallel-b-${sequence}`, "DEFER"), deps(poolB));
    await expect(Promise.race([
      independentB,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Different opportunity was unnecessarily serialized")), 2_000)),
    ])).resolves.toMatchObject({ kind: "EXECUTED" });
    await gate.query("commit");
    gate.release();
    await expect(blockedA).resolves.toMatchObject({ kind: "EXECUTED" });
    expect(Number((await control.query("select count(*) c from economic_decisions where opportunity_id=any($1::uuid[])", [[a.opportunityId, b.opportunityId]])).rows[0].c)).toBe(2);
  }, 15_000);

  it("rolls back decision/idempotency, releases the transaction lock, and permits retry", async () => {
    const ids = await basis("rollback-release");
    const key = `rollback-${sequence}`;
    const request = input(ids, key, "PROCEED");
    await expect(executeProtectedCreateEconomicDecision(request, deps(poolA, transactionRunner(poolA, true)))).rejects.toThrow("R1 forced post-lock rollback");
    expect(Number((await control.query("select count(*) c from economic_decisions where opportunity_id=$1", [ids.opportunityId])).rows[0].c)).toBe(0);
    expect(Number((await control.query("select count(*) c from command_idempotency_keys where idempotency_key=$1", [key])).rows[0].c)).toBe(0);
    await expect(executeProtectedCreateEconomicDecision(request, deps(poolB))).resolves.toMatchObject({ kind: "EXECUTED" });
    expect(Number((await control.query("select count(*) c from economic_decisions where opportunity_id=$1", [ids.opportunityId])).rows[0].c)).toBe(1);
    expect(Number((await control.query("select count(*) c from command_idempotency_keys where idempotency_key=$1 and result->>'kind'='EXECUTED'", [key])).rows[0].c)).toBe(1);
    expect(poolA.waitingCount + poolB.waitingCount).toBe(0);
  }, 15_000);
});
