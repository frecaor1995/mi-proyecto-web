import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResponseCaptureInput } from "../../server/mutation/protected-human-verification-response-capture";
import { executeProtectedHumanVerificationResponseCapture } from "../../server/mutation/protected-human-verification-response-capture";
import type { ServerSession } from "../../server/auth/session";
import { transactionRunnerOnClient, type ResponseCaptureOwnershipRunner, type TransactionRunner } from "../../server/database/transaction";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresClaimRepository } from "../../server/repositories/claims/postgres-claim-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresHumanVerificationRepository } from "../../server/repositories/human-verification/postgres-human-verification-repository";
import { PostgresIdempotencyRepository } from "../../server/repositories/idempotency/postgres-idempotency-repository";
import { PostgresManpowerAcceptanceRepository } from "../../server/repositories/manpower-acceptance/postgres-manpower-acceptance-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresSourceRepository } from "../../server/repositories/source/postgres-source-repository";
import { ClaimService } from "../../server/services/claims/claim-service";
import { HumanVerificationClosureService } from "../../server/services/human-verification/human-verification-closure-service";
import { HUMAN_VERIFICATION_RULE_VERSION, HumanVerificationService } from "../../server/services/human-verification/human-verification-service";
import { ManpowerAcceptanceService } from "../../server/services/manpower-acceptance/manpower-acceptance-service";

const databaseUrl = process.env.WORKFORCE_RADAR_LOCAL_TEST_DATABASE_URL;
const localHost = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && localHost !== "127.0.0.1" && localHost !== "localhost") {
  throw new Error("WORKFORCE_RADAR_LOCAL_TEST_DATABASE_URL must target localhost");
}

const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql", "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql", "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql", "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql", "20260817110000_eligibility_engine.sql", "20260817120000_explainable_scoring.sql",
  "20260817130000_commercial_action_engine.sql", "20260817140000_contact_grade_ordering.sql", "20260817150000_production_source_architecture.sql",
  "20260817160000_first_production_adapters.sql", "20260817170000_production_capture_closeout.sql",
  "20260904010000_human_verification_domain.sql", "20260905010000_operator_identity_and_safe_mutation.sql",
  "20260909010000_response_capture_recovery_correlation.sql", "20260910070755_tx_integrity_05b_active_response_capture_task_guard.sql",
];

const asSqlClient = (client: Pool | PoolClient): SqlClient => ({
  async query<Row>(text: string, values?: unknown[]) {
    const result = await client.query(text, values);
    return { rows: result.rows as Row[] };
  },
});

const transactionRunner = (pool: Pool): TransactionRunner => async (fn) => {
  const client = await pool.connect();
  const sql = asSqlClient(client);
  try {
    await sql.query("begin");
    const result = await fn(sql);
    await sql.query("commit");
    return result;
  } catch (error) {
    await sql.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const ownershipRunner = (pool: Pool): ResponseCaptureOwnershipRunner => async (key, fn) => {
  const session = await pool.connect();
  const sql = asSqlClient(session);
  const lockName = `fly-workforce-radar:human-verification:response-capture-recovery:v1:${key}`;
  let discard = false;
  try {
    await sql.query("select pg_advisory_lock(hashtextextended($1,0))", [lockName]);
    return await fn({ client: sql, transactionRunner: transactionRunnerOnClient(sql) });
  } finally {
    try {
      const unlocked = await sql.query<{ unlocked: boolean }>("select pg_advisory_unlock(hashtextextended($1,0)) as unlocked", [lockName]);
      discard = unlocked.rows[0]?.unlocked !== true;
    } catch {
      discard = true;
    }
    session.release(discard);
  }
};

function closureServiceFor(client: SqlClient): HumanVerificationClosureService {
  const evidence = new PostgresEvidenceRepository(client);
  return new HumanVerificationClosureService(
    evidence,
    new PostgresSourceRepository(client),
    new ClaimService(new PostgresClaimRepository(client), evidence),
    new ManpowerAcceptanceService(new PostgresManpowerAcceptanceRepository(client)),
  );
}

describe.skipIf(!databaseUrl)("TX-INTEGRITY-05B real PostgreSQL different-key/same-task ownership", () => {
  let poolA: Pool;
  let poolB: Pool;
  let operatorAuthUserId: string;
  let operatorId: string;
  let taskId: string;
  let companyId: string;

  beforeAll(async () => {
    poolA = new Pool({ connectionString: databaseUrl, max: 4 });
    poolB = new Pool({ connectionString: databaseUrl, max: 4 });
    for (const migration of migrations) await poolA.query(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    const pidA = Number((await poolA.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid);
    const pidB = Number((await poolB.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid);
    expect(pidA).not.toBe(pidB);

    companyId = String((await poolA.query("insert into companies(common_name) values('TX-05B Company') returning id")).rows[0].id);
    const projectId = String((await poolA.query("insert into projects(name,location_text) values('TX-05B Project','Texas') returning id")).rows[0].id);
    operatorAuthUserId = "55555555-5555-4555-8555-555555555555";
    operatorId = (await new PostgresOperatorRepository(asSqlClient(poolA)).create({
      authUserId: operatorAuthUserId, email: "tx05b@example.com", permissions: ["human_verification.write"],
    })).id;
    const repository = new PostgresHumanVerificationRepository(asSqlClient(poolA));
    const service = new HumanVerificationService(repository, {
      run: transactionRunner(poolA), repositoryFor: (client) => new PostgresHumanVerificationRepository(client),
    });
    taskId = (await service.createTask({
      companyId, projectId, targetType: "MANPOWER_ACCEPTANCE", targetId: companyId,
      verificationObjective: "TX-05B concurrency proof", questionType: "MANPOWER_ACCEPTANCE",
      primaryQuestion: "Does the company accept external manpower?", createdBy: operatorId,
      ruleVersion: HUMAN_VERIFICATION_RULE_VERSION, scope: { companyScope: "UNKNOWN", projectId },
    })).task.id;
  }, 60_000);

  afterAll(async () => {
    await Promise.all([poolA?.end(), poolB?.end()]);
  });

  it("allows exactly one owner and rejects the opposite response before every losing business write", async () => {
    const session = (): Promise<ServerSession> => Promise.resolve({ authUserId: operatorAuthUserId, email: "tx05b@example.com" });
    const input = (key: string, affirmative: boolean): ResponseCaptureInput => ({
      idempotencyKey: key, taskId, expectedTaskStatus: "OPEN", interactionMethod: "PHONE",
      interactionOutcome: "DECISION_MAKER_REACHED", attemptedAt: new Date("2026-09-10T12:00:00Z"), reachedHuman: true,
      responseSummary: affirmative ? "Authorized acceptance confirmed." : "Authorized representative denied acceptance.",
      answerDisposition: affirmative ? "AFFIRMATIVE" : "NEGATIVE", authorityLevel: "AUTHORIZED_COMPANY_AUTHORITY",
      authorityBasis: "Authorized representative", commercialMechanism: affirmative ? "DIRECT_EXTERNAL_MANPOWER" : "NO_EXTERNAL_MANPOWER",
    });
    const keyA = `tx05b-a-${taskId}`;
    const keyB = `tx05b-b-${taskId}`;
    let ownerReached!: () => void;
    let releaseOwner!: () => void;
    const reached = new Promise<void>((resolve) => { ownerReached = resolve; });
    const held = new Promise<void>((resolve) => { releaseOwner = resolve; });
    const baseOwnershipA = ownershipRunner(poolA);
    const pausedOwnershipA: ResponseCaptureOwnershipRunner = (key, fn) => baseOwnershipA(key, async (context) => {
      ownerReached();
      await held;
      return fn(context);
    });
    const deps = (pool: Pool, own: ResponseCaptureOwnershipRunner) => ({
      humanVerificationRepository: new PostgresHumanVerificationRepository(asSqlClient(pool)),
      idempotencyRepository: new PostgresIdempotencyRepository(asSqlClient(pool)),
      transactionRunner: transactionRunner(pool), ownershipRunner: own, closureServiceFor, getSession: session,
      operatorRepository: new PostgresOperatorRepository(asSqlClient(pool)),
    });

    const winner = executeProtectedHumanVerificationResponseCapture(input(keyA, true), deps(poolA, pausedOwnershipA));
    await reached;
    const loser = await executeProtectedHumanVerificationResponseCapture(input(keyB, false), deps(poolB, ownershipRunner(poolB)));
    expect(loser).toEqual({ kind: "REJECTED", reason: "TASK_CAPTURE_IN_PROGRESS" });
    releaseOwner();
    await expect(winner).resolves.toMatchObject({ kind: "EXECUTED", canonicalOutcome: "AF01_EVALUATED" });

    expect(Number((await poolA.query("select count(*) as c from human_interactions where verification_task_id=$1", [taskId])).rows[0].c)).toBe(1);
    expect(Number((await poolA.query("select count(*) as c from human_interactions where verification_task_id=$1 and metadata->>'idempotencyKey'=$2", [taskId, keyB])).rows[0].c)).toBe(0);
    expect(Number((await poolA.query("select count(*) as c from human_response_assessments where idempotency_key=$1", [keyB])).rows[0].c)).toBe(0);
    expect(Number((await poolA.query("select count(*) as c from raw_evidence where metadata->>'interactionId' in (select id::text from human_interactions where verification_task_id=$1)", [taskId])).rows[0].c)).toBe(1);
    expect(Number((await poolA.query("select count(*) as c from claims where company_id=$1", [companyId])).rows[0].c)).toBe(1);
    expect(Number((await poolA.query("select count(*) as c from manpower_acceptance_evaluations where company_id=$1", [companyId])).rows[0].c)).toBe(1);
    expect(Number((await poolA.query("select count(*) as c from human_verification_task_events where verification_task_id=$1 and event_type='STATE_CHANGED'", [taskId])).rows[0].c)).toBe(2);
    expect(Number((await poolA.query("select count(*) as c from command_idempotency_keys where idempotency_key=$1", [keyB])).rows[0].c)).toBe(0);
    expect(poolA.waitingCount).toBe(0);
    expect(poolB.waitingCount).toBe(0);
  }, 30_000);
});
