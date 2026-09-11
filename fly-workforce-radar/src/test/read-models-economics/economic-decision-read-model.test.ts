import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EconomicDecisionRecord, EconomicDisposition } from "../../domain/economic-decision";
import { readOpportunityEconomicDecisions } from "../../server/opportunity-detail/get-opportunity-economic-decisions";
import { assembleOpportunityEconomicDecisionDetail } from "../../server/read-models/economic-decisions";
import { PostgresEconomicDecisionRepository } from "../../server/repositories/economic-decision/postgres-economic-decision-repository";
import type { EconomicDecisionRepository } from "../../server/repositories/economic-decision/economic-decision-repository";
import { PostgresEconomicsScenarioRepository } from "../../server/repositories/economics-scenario/postgres-economics-scenario-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";

const migrations = [
  "20260817010000_canonical_model.sql",
  "20260817090000_opportunity_graph.sql",
  "20260905010000_operator_identity_and_safe_mutation.sql",
  "20260907010000_commercial_economics_persistence.sql",
  "20260910120000_phase_4j_durable_economic_decisions.sql",
];

describe("Phase 4K economic decision read model", () => {
  let db: PGlite;
  let client: SqlClient;
  let repository: PostgresEconomicDecisionRepository;
  let scenarioRepository: PostgresEconomicsScenarioRepository;
  let operatorId: string;
  let sequence = 0;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    client = db as unknown as SqlClient;
    repository = new PostgresEconomicDecisionRepository(client);
    scenarioRepository = new PostgresEconomicsScenarioRepository(client);
    operatorId = (await new PostgresOperatorRepository(client).create({
      authUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "phase-4k@example.com",
      permissions: ["commercial_economics.decide"],
    })).id;
  });

  afterAll(async () => db.close());

  async function basis(label: string) {
    const projectId = String((await db.query<{ id: string }>("insert into projects(name) values($1) returning id", [`4K ${label}`])).rows[0].id);
    const opportunityId = String((await db.query<{ id: string }>(
      "insert into opportunities(title,project_id,opportunity_identity_key) values($1,$2,$3) returning id",
      [`4K ${label}`, projectId, `4k-${label}-${++sequence}`],
    )).rows[0].id);
    const scenarioSnapshotId = (await scenarioRepository.createSnapshot({
      opportunityId, scenarioLabel: "BASE", commercialTermsVersionId: null, burdenProfileVersionId: null,
      basis: {}, result: { weakestTier: "OPERATOR_ASSUMPTION", blockingReasons: ["Awaiting customer terms"] },
      ruleVersion: "4f@1", assertedBy: null, evaluatedAt: new Date("2026-09-10T10:00:00Z"),
      asOf: new Date("2026-09-10T10:00:00Z"), supersedesScenarioId: null,
    })).id;
    return { opportunityId, scenarioSnapshotId };
  }

  async function decision(
    ids: Awaited<ReturnType<typeof basis>>,
    disposition: EconomicDisposition,
    supersedesDecisionId: string | null,
    minute: number,
  ) {
    return repository.create({
      ...ids,
      disposition,
      rationale: `Human rationale ${disposition}`,
      scenarioEffectiveCertainty: "OPERATOR_ASSUMPTION",
      scenarioBlockingReasons: ["Awaiting customer terms"],
      ruleVersion: "economic-decision@1",
      decidedBy: operatorId,
      decidedAt: new Date(`2026-09-10T10:${String(minute).padStart(2, "0")}:00Z`),
      supersedesDecisionId,
    });
  }

  it("represents an opportunity with no decision as a valid empty read result", async () => {
    const ids = await basis("empty");
    await expect(readOpportunityEconomicDecisions(ids.opportunityId, repository)).resolves.toEqual({
      opportunityId: ids.opportunityId,
      current: null,
      history: [],
    });
  });

  it("returns one root as both history and current with complete consumer fields", async () => {
    const ids = await basis("root");
    const root = await decision(ids, "PROCEED", null, 1);
    const detail = await readOpportunityEconomicDecisions(ids.opportunityId, repository);
    expect(detail.history).toHaveLength(1);
    expect(detail.current).toMatchObject({
      decisionId: root.id,
      opportunityId: ids.opportunityId,
      disposition: "PROCEED",
      rationale: "Human rationale PROCEED",
      decidedByOperatorId: operatorId,
      scenarioSnapshotId: ids.scenarioSnapshotId,
      scenarioEffectiveCertainty: "OPERATOR_ASSUMPTION",
      scenarioBlockingReasons: ["Awaiting customer terms"],
      supersedesDecisionId: null,
      ruleVersion: "economic-decision@1",
      lineagePosition: 1,
      isCurrent: true,
    });
    expect(detail.current?.createdAt).toBeInstanceOf(Date);
    expect(detail.current?.decidedAt).toBeInstanceOf(Date);
  });

  it("orders D1 -> D2 -> D3 by lineage and marks only D3 current", async () => {
    const ids = await basis("chain");
    const d1 = await decision(ids, "PROCEED", null, 3);
    const d2 = await decision(ids, "DEFER", d1.id, 2);
    const d3 = await decision(ids, "DECLINE", d2.id, 1);
    const unordered = [d3, d1, d2];
    const detail = assembleOpportunityEconomicDecisionDetail(ids.opportunityId, unordered);
    expect(detail.history.map((item) => item.decisionId)).toEqual([d1.id, d2.id, d3.id]);
    expect(detail.history.map((item) => item.lineagePosition)).toEqual([1, 2, 3]);
    expect(detail.history.map((item) => item.isCurrent)).toEqual([false, false, true]);
    expect(detail.history.map((item) => item.supersedesDecisionId)).toEqual([null, d1.id, d2.id]);
    expect(detail.current?.decisionId).toBe(d3.id);
  });

  it("does not include decisions belonging to another opportunity", async () => {
    const a = await basis("scope-a");
    const b = await basis("scope-b");
    const decisionA = await decision(a, "PROCEED", null, 1);
    const decisionB = await decision(b, "DECLINE", null, 1);
    const detail = assembleOpportunityEconomicDecisionDetail(a.opportunityId, [decisionB, decisionA]);
    expect(detail.history.map((item) => item.decisionId)).toEqual([decisionA.id]);
    expect(detail.history).not.toContainEqual(expect.objectContaining({ decisionId: decisionB.id }));
    await expect(readOpportunityEconomicDecisions(a.opportunityId, repository)).resolves.toMatchObject({ current: { decisionId: decisionA.id } });
  });

  it("fails closed for a malformed or mismatched lineage instead of inventing current state", () => {
    const record = (overrides: Partial<EconomicDecisionRecord> = {}): EconomicDecisionRecord => ({
      id: "d1", opportunityId: "opp", scenarioSnapshotId: "scenario", disposition: "PROCEED", rationale: "Human",
      scenarioEffectiveCertainty: "UNKNOWN", scenarioBlockingReasons: [], ruleVersion: "v1", decidedBy: "operator",
      decidedAt: new Date(0), supersedesDecisionId: null, createdAt: new Date(0), ...overrides,
    });
    expect(() => assembleOpportunityEconomicDecisionDetail("opp", [record(), record({ id: "d2" })])).toThrow(/exactly one root/);
    expect(() => assembleOpportunityEconomicDecisionDetail("opp", [record(), record({ id: "d2", supersedesDecisionId: "missing" })])).toThrow(/predecessor is missing/);
  });

  it("projects one coherent history snapshot when a supersession commits after the SELECT", async () => {
    const ids = await basis("concurrent-snapshot");
    const d1 = await decision(ids, "PROCEED", null, 1);
    let getCurrentCalled = false;
    const snapshotRepository: EconomicDecisionRepository = {
      create: (input) => repository.create(input),
      getById: (id) => repository.getById(id),
      getCurrent: async () => {
        getCurrentCalled = true;
        throw new Error("A second database read would mix snapshots");
      },
      listHistory: async (opportunityId) => {
        const snapshotA = await repository.listHistory(opportunityId);
        await decision(ids, "DEFER", d1.id, 2);
        return snapshotA;
      },
    };

    const detail = await readOpportunityEconomicDecisions(ids.opportunityId, snapshotRepository);
    expect(getCurrentCalled).toBe(false);
    expect(detail.history.map((item) => item.decisionId)).toEqual([d1.id]);
    expect(detail.current?.decisionId).toBe(d1.id);
    expect((await repository.getCurrent(ids.opportunityId))?.id).not.toBe(d1.id);
  });

  it("performs SELECT-only reads and leaves every durable decision byte-for-byte unchanged", async () => {
    const ids = await basis("immutable-read");
    const d1 = await decision(ids, "PROCEED", null, 1);
    await decision(ids, "DEFER", d1.id, 2);
    const before = (await db.query<{ value: string }>(
      "select json_agg(row_to_json(d) order by d.created_at,d.id)::text value from economic_decisions d where opportunity_id=$1",
      [ids.opportunityId],
    )).rows[0].value;
    await readOpportunityEconomicDecisions(ids.opportunityId, repository);
    const after = (await db.query<{ value: string }>(
      "select json_agg(row_to_json(d) order by d.created_at,d.id)::text value from economic_decisions d where opportunity_id=$1",
      [ids.opportunityId],
    )).rows[0].value;
    expect(after).toBe(before);
  });

  it("retains Phase 4J database invariants after read-side consumption", async () => {
    const ids = await basis("4j-regression");
    const d1 = await decision(ids, "PROCEED", null, 1);
    await expect(decision(ids, "DECLINE", null, 2)).rejects.toThrow();
    await decision(ids, "DEFER", d1.id, 2);
    await expect(decision(ids, "DECLINE", d1.id, 3)).rejects.toThrow();
    await expect(client.query("update economic_decisions set disposition='DECLINE' where id=$1", [d1.id])).rejects.toThrow(/append-only/);
    await expect(client.query("delete from economic_decisions where id=$1", [d1.id])).rejects.toThrow(/append-only/);
  });
});
