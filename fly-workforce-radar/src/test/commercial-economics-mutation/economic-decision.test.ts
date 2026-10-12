import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ECONOMIC_DISPOSITIONS, type CreateEconomicDecisionMutationInput } from "../../domain/economic-decision";
import { executeProtectedCreateEconomicDecision } from "../../server/mutation/protected-economic-decision-mutation";
import type { ServerSession } from "../../server/auth/session";
import type { TransactionRunner } from "../../server/database/transaction";
import { PostgresEconomicDecisionRepository } from "../../server/repositories/economic-decision/postgres-economic-decision-repository";
import { PostgresEconomicsScenarioRepository } from "../../server/repositories/economics-scenario/postgres-economics-scenario-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";

const migrations = [
  "20260817010000_canonical_model.sql",
  "20260817070000_manpower_acceptance.sql",
  "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql",
  "20260905010000_operator_identity_and_safe_mutation.sql",
  "20260907010000_commercial_economics_persistence.sql",
  "20260910120000_phase_4j_durable_economic_decisions.sql",
];

describe("Phase 4J durable economic decision", () => {
  let db: PGlite;
  let client: SqlClient;
  let transactionRunner: TransactionRunner;
  let operatorRepository: PostgresOperatorRepository;
  let decisionRepository: PostgresEconomicDecisionRepository;
  let scenarioRepository: PostgresEconomicsScenarioRepository;
  let opportunityId: string;
  let otherOpportunityId: string;
  let snapshotId: string;
  let assumptionSnapshotId: string;
  let decisionAuthUserId: string;
  let economicsOnlyAuthUserId: string;
  let sequence = 0;
  const now = new Date("2026-09-10T18:00:00.000Z");

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    client = db as unknown as SqlClient;
    transactionRunner = async <T>(fn: (txClient: SqlClient) => Promise<T>): Promise<T> => {
      await client.query("begin");
      try {
        const result = await fn(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    };
    operatorRepository = new PostgresOperatorRepository(client);
    decisionRepository = new PostgresEconomicDecisionRepository(client);
    scenarioRepository = new PostgresEconomicsScenarioRepository(client);

    const projectId = (await db.query<{ id: string }>("insert into projects(name) values('4J Project') returning id")).rows[0].id;
    opportunityId = (await db.query<{ id: string }>("insert into opportunities(title,project_id,opportunity_identity_key) values('4J Opportunity',$1,'4j-opportunity') returning id", [projectId])).rows[0].id;
    otherOpportunityId = (await db.query<{ id: string }>("insert into opportunities(title,project_id,opportunity_identity_key) values('Other Opportunity',$1,'4j-other') returning id", [projectId])).rows[0].id;

    snapshotId = (await scenarioRepository.createSnapshot({
      opportunityId, scenarioLabel: "BASE", commercialTermsVersionId: null, burdenProfileVersionId: null,
      basis: { immutable: true }, result: { weakestTier: "VERIFIED", blockingReasons: [] },
      ruleVersion: "4f@1", assertedBy: null, evaluatedAt: now, asOf: now, supersedesScenarioId: null,
    })).id;
    assumptionSnapshotId = (await scenarioRepository.createSnapshot({
      opportunityId, scenarioLabel: "CONSERVATIVE", commercialTermsVersionId: null, burdenProfileVersionId: null,
      basis: { immutable: true }, result: { weakestTier: "OPERATOR_ASSUMPTION", blockingReasons: ["complete.workingCapital: UNKNOWN"] },
      ruleVersion: "4f@1", assertedBy: null, evaluatedAt: now, asOf: now, supersedesScenarioId: null,
    })).id;

    decisionAuthUserId = "88888888-8888-4888-8888-888888888888";
    economicsOnlyAuthUserId = "99999999-9999-4999-8999-999999999999";
    await operatorRepository.create({ authUserId: decisionAuthUserId, email: "decision@example.com", permissions: ["commercial_economics.decide"] });
    await operatorRepository.create({ authUserId: economicsOnlyAuthUserId, email: "economics@example.com", permissions: ["commercial_economics.write"] });
  });

  afterAll(async () => db.close());

  const session = (authUserId: string | null): (() => Promise<ServerSession | null>) => async () => authUserId ? { authUserId, email: "operator@example.com" } : null;
  const deps = () => ({ transactionRunner, operatorRepository, getSession: session(decisionAuthUserId), clock: () => now });
  const input = (overrides: Partial<CreateEconomicDecisionMutationInput> = {}): CreateEconomicDecisionMutationInput => ({
    opportunityId,
    scenarioSnapshotId: snapshotId,
    disposition: "PROCEED",
    rationale: "Authorized business judgment based on the referenced scenario.",
    ruleVersion: "economic-decision@1",
    expectedCurrentDecisionId: null,
    idempotencyKey: `decision-${++sequence}`,
    ...overrides,
  });
  const isolatedBasis = async () => {
    const projectId = (await db.query<{ id: string }>("insert into projects(name) values($1) returning id", [`Isolated 4J ${++sequence}`])).rows[0].id;
    const isolatedOpportunityId = (await db.query<{ id: string }>("insert into opportunities(title,project_id,opportunity_identity_key) values($1,$2,$3) returning id", [`Isolated 4J ${sequence}`, projectId, `isolated-4j-${sequence}`])).rows[0].id;
    const isolatedSnapshotId = (await scenarioRepository.createSnapshot({
      opportunityId: isolatedOpportunityId, scenarioLabel: "BASE", commercialTermsVersionId: null, burdenProfileVersionId: null,
      basis: {}, result: { weakestTier: "VERIFIED", blockingReasons: [] }, ruleVersion: "4f@1", assertedBy: null,
      evaluatedAt: now, asOf: now, supersedesScenarioId: null,
    })).id;
    return { opportunityId: isolatedOpportunityId, scenarioSnapshotId: isolatedSnapshotId };
  };

  it("defines only the manager-approved human disposition vocabulary", () => {
    expect(ECONOMIC_DISPOSITIONS).toEqual(["PROCEED", "DECLINE", "DEFER"]);
  });

  it("requires a rationale and rejects a runtime disposition outside the canonical vocabulary", async () => {
    expect(await executeProtectedCreateEconomicDecision(input({ rationale: "  " }), deps())).toMatchObject({ kind: "REJECTED", reason: "VALIDATION_ERROR" });
    expect(await executeProtectedCreateEconomicDecision(input({ disposition: "GO" as "PROCEED" }), deps())).toMatchObject({ kind: "REJECTED", reason: "VALIDATION_ERROR" });
  });

  it("requires authentication and the distinct decision permission", async () => {
    expect(await executeProtectedCreateEconomicDecision(input(), { ...deps(), getSession: session(null) })).toMatchObject({ kind: "REJECTED", reason: "UNAUTHENTICATED" });
    expect(await executeProtectedCreateEconomicDecision(input(), { ...deps(), getSession: session(economicsOnlyAuthUserId) })).toMatchObject({ kind: "REJECTED", reason: "UNAUTHORIZED" });
  });

  it("derives actor, time, certainty, and blocking reasons on the server", async () => {
    const outcome = await executeProtectedCreateEconomicDecision(input({ scenarioSnapshotId: assumptionSnapshotId, disposition: "DEFER" }), deps());
    expect(outcome.kind).toBe("EXECUTED");
    if (outcome.kind !== "EXECUTED") return;
    const operator = await operatorRepository.findByAuthUserId(decisionAuthUserId);
    expect(outcome.decision).toMatchObject({
      decidedBy: operator?.id,
      decidedAt: now,
      scenarioEffectiveCertainty: "OPERATOR_ASSUMPTION",
      scenarioBlockingReasons: ["complete.workingCapital: UNKNOWN"],
    });
  });

  it("fails closed when the snapshot belongs to another opportunity", async () => {
    const outcome = await executeProtectedCreateEconomicDecision(input({ opportunityId: otherOpportunityId }), deps());
    expect(outcome).toMatchObject({ kind: "REJECTED", reason: "SNAPSHOT_OPPORTUNITY_MISMATCH" });
    expect(await decisionRepository.listHistory(otherOpportunityId)).toHaveLength(0);
  });

  it("fails closed for a missing or malformed scenario snapshot", async () => {
    const current = await decisionRepository.getCurrent(opportunityId);
    expect(await executeProtectedCreateEconomicDecision(input({ scenarioSnapshotId: "00000000-0000-0000-0000-000000000000", expectedCurrentDecisionId: current?.id ?? null }), deps())).toMatchObject({ kind: "REJECTED", reason: "SNAPSHOT_NOT_FOUND" });
    const malformed = await scenarioRepository.createSnapshot({
      opportunityId: otherOpportunityId, scenarioLabel: "TARGET", commercialTermsVersionId: null, burdenProfileVersionId: null,
      basis: {}, result: {}, ruleVersion: "legacy", assertedBy: null, evaluatedAt: now, asOf: now, supersedesScenarioId: null,
    });
    expect(await executeProtectedCreateEconomicDecision(input({ opportunityId: otherOpportunityId, scenarioSnapshotId: malformed.id }), deps())).toMatchObject({ kind: "REJECTED", reason: "SNAPSHOT_INTEGRITY_ERROR" });
  });

  it("replays an identical request and rejects changed material under the same key", async () => {
    const request = input({ opportunityId: otherOpportunityId, scenarioSnapshotId: (await scenarioRepository.createSnapshot({
      opportunityId: otherOpportunityId, scenarioLabel: "BASE", commercialTermsVersionId: null, burdenProfileVersionId: null,
      basis: {}, result: { weakestTier: null, blockingReasons: ["UNKNOWN"] }, ruleVersion: "4f@1", assertedBy: null,
      evaluatedAt: now, asOf: now, supersedesScenarioId: null,
    })).id });
    const first = await executeProtectedCreateEconomicDecision(request, deps());
    const replay = await executeProtectedCreateEconomicDecision(request, deps());
    const conflict = await executeProtectedCreateEconomicDecision({ ...request, disposition: "DECLINE" }, deps());
    expect(first.kind).toBe("EXECUTED");
    expect(replay).toMatchObject({ kind: "REPLAYED" });
    expect(conflict).toMatchObject({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
    expect(await decisionRepository.listHistory(otherOpportunityId)).toHaveLength(1);
  });

  it("creates append-only supersession history without changing the prior record", async () => {
    const isolated = await isolatedBasis();
    const first = await executeProtectedCreateEconomicDecision(input(isolated), deps());
    expect(first.kind).toBe("EXECUTED");
    if (first.kind !== "EXECUTED") return;
    const second = await executeProtectedCreateEconomicDecision(input({ ...isolated, disposition: "DECLINE", rationale: "New human judgment.", expectedCurrentDecisionId: first.decision.id }), deps());
    expect(second.kind).toBe("EXECUTED");
    if (second.kind !== "EXECUTED") return;
    expect(second.decision.supersedesDecisionId).toBe(first.decision.id);
    expect((await decisionRepository.getById(first.decision.id))?.disposition).toBe("PROCEED");
    expect((await decisionRepository.getCurrent(isolated.opportunityId))?.id).toBe(second.decision.id);
    expect(await decisionRepository.listHistory(isolated.opportunityId)).toHaveLength(2);
    await expect(client.query("update economic_decisions set disposition='DEFER' where id=$1", [first.decision.id])).rejects.toThrow(/append-only/);
    await expect(client.query("delete from economic_decisions where id=$1", [first.decision.id])).rejects.toThrow(/append-only/);
  });

  it("rejects a stale concurrent premise and the database forbids two successors", async () => {
    const isolated = await isolatedBasis();
    const initial = await executeProtectedCreateEconomicDecision(input(isolated), deps());
    expect(initial.kind).toBe("EXECUTED");
    if (initial.kind !== "EXECUTED") return;
    const winner = await executeProtectedCreateEconomicDecision(input({ ...isolated, disposition: "DEFER", expectedCurrentDecisionId: initial.decision.id }), deps());
    expect(winner.kind).toBe("EXECUTED");
    const loser = await executeProtectedCreateEconomicDecision(input({ ...isolated, disposition: "PROCEED", expectedCurrentDecisionId: initial.decision.id }), deps());
    expect(loser).toMatchObject({ kind: "REJECTED", reason: "CONCURRENCY_CONFLICT" });
    expect((await decisionRepository.listHistory(isolated.opportunityId)).filter((decision) => decision.supersedesDecisionId === initial.decision.id)).toHaveLength(1);
    await expect(decisionRepository.create({
      opportunityId: isolated.opportunityId,
      scenarioSnapshotId: isolated.scenarioSnapshotId,
      disposition: "DECLINE",
      rationale: "Competing direct successor must fail at the database invariant.",
      scenarioEffectiveCertainty: "VERIFIED",
      scenarioBlockingReasons: [],
      ruleVersion: "economic-decision@1",
      decidedBy: initial.decision.decidedBy,
      decidedAt: now,
      supersedesDecisionId: initial.decision.id,
    })).rejects.toThrow();
  });

  it("rolls back both the decision and idempotency claim after a post-callback failure", async () => {
    const rollbackOpportunityId = otherOpportunityId;
    const rollbackSnapshotId = (await scenarioRepository.listByOpportunity(rollbackOpportunityId)).find((snapshot) => snapshot.result.weakestTier === null)!.id;
    const request = input({ opportunityId: rollbackOpportunityId, scenarioSnapshotId: rollbackSnapshotId, expectedCurrentDecisionId: (await decisionRepository.getCurrent(rollbackOpportunityId))?.id ?? null });
    const forcedRollback: TransactionRunner = async (fn) => {
      await client.query("begin");
      try {
        await fn(client);
        throw new Error("simulated post-write failure");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    };
    const before = (await decisionRepository.listHistory(rollbackOpportunityId)).length;
    await expect(executeProtectedCreateEconomicDecision(request, { ...deps(), transactionRunner: forcedRollback })).rejects.toThrow("simulated post-write failure");
    expect(await decisionRepository.listHistory(rollbackOpportunityId)).toHaveLength(before);
    expect((await client.query("select id from command_idempotency_keys where idempotency_key=$1", [request.idempotencyKey])).rows).toHaveLength(0);
  });

  it("does not mutate HOT, eligibility, scoring, AF01, or human-verification state", async () => {
    const before = await client.query<{ table_name: string; count: number }>(
      `select 'eligibility_evaluation_snapshots' table_name,count(*)::int count from eligibility_evaluation_snapshots
       union all select 'score_result_snapshots',count(*)::int from score_result_snapshots
       union all select 'human_verification_decisions',count(*)::int from human_verification_decisions
       union all select 'manpower_acceptance_evaluations',count(*)::int from manpower_acceptance_evaluations`,
    );
    const current = await decisionRepository.getCurrent(opportunityId);
    expect(await executeProtectedCreateEconomicDecision(input({ disposition: "DECLINE", expectedCurrentDecisionId: current?.id ?? null }), deps())).toMatchObject({ kind: "EXECUTED" });
    const after = await client.query<{ table_name: string; count: number }>(
      `select 'eligibility_evaluation_snapshots' table_name,count(*)::int count from eligibility_evaluation_snapshots
       union all select 'score_result_snapshots',count(*)::int from score_result_snapshots
       union all select 'human_verification_decisions',count(*)::int from human_verification_decisions
       union all select 'manpower_acceptance_evaluations',count(*)::int from manpower_acceptance_evaluations`,
    );
    expect(after.rows).toEqual(before.rows);
  });
});
