import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthorizationResult } from "../../server/auth/authorization";
import type { ServerSession } from "../../server/auth/session";
import type { TransactionRunner } from "../../server/database/transaction";
import { PostgresDemandRequirementRepository } from "../../server/repositories/demand/postgres-demand-requirement-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresWorkerRepository } from "../../server/repositories/worker/postgres-worker-repository";
import { DemandRequirementService } from "../../server/services/demand/demand-requirement-service";
import { evaluateDemandAgainstWorkforce } from "../../server/services/matching/evaluate-demand-against-workforce";
import { MatchingPersistenceService } from "../../server/services/matching/matching-persistence-service";
import { WorkerService } from "../../server/services/worker/worker-service";

const OPPORTUNITY_ID = "1fb90f31-a576-450e-9c6b-8fa1d01690dd";
const DEMAND_ID = "3a7a9b82-fedf-4483-9893-fffa373ffe0b";
const pool = new Pool({ host: "127.0.0.1", port: 55422, database: "postgres", user: "postgres", password: "postgres", max: 3 });
const client: SqlClient = { async query<Row>(text: string, values?: unknown[]) { const result = await pool.query(text, values); return { rows: result.rows as Row[] }; } };
const transactionRunner: TransactionRunner = async (fn) => {
  const connection = await pool.connect();
  const scoped: SqlClient = { async query<Row>(text: string, values?: unknown[]) { const result = await connection.query(text, values); return { rows: result.rows as Row[] }; } };
  try { await connection.query("begin"); const result = await fn(scoped); await connection.query("commit"); return result; }
  catch (error) { await connection.query("rollback"); throw error; }
  finally { connection.release(); }
};

let session: ServerSession;
let authorization: Extract<AuthorizationResult, { state: "AUTHORIZED" }>;

vi.mock("server-only", () => ({}));

beforeAll(async () => {
  const operator = (await pool.query<{ id: string; auth_user_id: string; email: string; permissions: string[] }>("select id,auth_user_id,email,permissions from workforce_operators where status='ACTIVE' and permissions @> array['matching.execute','matching_result.read','worker_profile.read','worker_compensation.read','demand_requirement.write']::text[] order by created_at limit 1")).rows[0];
  if (!operator) throw new Error("LOCAL_MATCHING_OPERATOR_UNAVAILABLE");
  session = { authUserId: operator.auth_user_id, email: operator.email };
  authorization = { state: "AUTHORIZED", operator: { operatorId: operator.id, authUserId: operator.auth_user_id, email: operator.email, permissions: operator.permissions as never } };
});

afterAll(async () => { await pool.end(); });

describe("Workforce 31 local real matching acceptance", () => {
  it("runs the canonical matcher and exposes real workers in Candidate Slate", async () => {
    const operatorRepository = new PostgresOperatorRepository(client);
    const getSession = async () => session;
    const workerService = new WorkerService({ repository: new PostgresWorkerRepository(client), transactionRunner, operatorRepository, getSession });
    const demandRequirementService = new DemandRequirementService({ repository: new PostgresDemandRequirementRepository(client), transactionRunner, operatorRepository, getSession });
    const result = await evaluateDemandAgainstWorkforce(DEMAND_ID, { workerService, demandRequirementService, persistenceService: new MatchingPersistenceService({ transactionRunner }), operatorRepository, getSession, workerUniverse: "REAL" });
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") return;
    expect(result.value.failedWorkerCount).toBe(0);
    expect(result.value.eligibleWorkerCount).toBe(31);
    expect(result.value.workerUniverse).toBe("REAL");

    const realResults = await pool.query<{ outcome: string; count: number }>("select r.outcome,count(*)::int count from worker_demand_match_results r join workforce_workers w on w.id=r.worker_id where r.demand_signal_id=$1 and r.superseded_at is null and w.source_of_record='IMPORTED' and lower(w.display_name) not like '%demo%' group by r.outcome order by r.outcome", [DEMAND_ID]);
    expect(realResults.rows.reduce((sum, row) => sum + row.count, 0)).toBe(31);
    const demoResults = await pool.query<{ count: number }>("select count(*)::int count from worker_demand_match_results r join workforce_workers w on w.id=r.worker_id where r.demand_signal_id=$1 and r.superseded_at is null and w.display_name ~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)'", [DEMAND_ID]);
    expect(demoResults.rows[0].count).toBe(0);

    const { getCandidateSlate } = await import("../../server/candidate-slate/get-candidate-slate");
    const slate = await getCandidateSlate(OPPORTUNITY_ID, { client, authorize: async () => authorization });
    expect(slate.state).toBe("READY");
    if (slate.state !== "READY" || !slate.slate) return;
    const slateWorkers = slate.slate.demands.flatMap((demand) => demand.workers);
    const realWorkers = slateWorkers.filter((worker) => !/\bdemo\b/i.test(worker.displayName));
    expect(new Set(realWorkers.map((worker) => worker.workerId)).size).toBe(31);
    expect(slateWorkers.some((worker) => /\bdemo\b/i.test(worker.displayName))).toBe(false);

    console.log(JSON.stringify({ demandSignalId: DEMAND_ID, opportunityId: OPPORTUNITY_ID, matcher: result.value, realOutcomes: realResults.rows, candidateSlateRealWorkers: new Set(realWorkers.map((worker) => worker.workerId)).size }));
  }, 60_000);
});
