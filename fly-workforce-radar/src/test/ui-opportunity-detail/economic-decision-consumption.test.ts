import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { EconomicDecisionRecord } from "../../domain/economic-decision";
import { composeOpportunityDetailResult } from "../../server/opportunity-detail/get-opportunity-detail-page";
import { readOpportunityEconomicDecisions } from "../../server/opportunity-detail/get-opportunity-economic-decisions";
import type { EconomicDecisionRepository } from "../../server/repositories/economic-decision/economic-decision-repository";
import type { OpportunityIntelligenceDetail } from "../../server/read-models/opportunity-detail";

const opportunityId = "11111111-1111-4111-8111-111111111111";
const otherOpportunityId = "22222222-2222-4222-8222-222222222222";
const timestamp = new Date("2026-09-11T12:00:00Z");

function record(id: string, disposition: EconomicDecisionRecord["disposition"], supersedesDecisionId: string | null, target = opportunityId): EconomicDecisionRecord {
  return { id, opportunityId: target, scenarioSnapshotId: `scenario-${id}`, disposition, rationale: `Human rationale ${id}`, scenarioEffectiveCertainty: "OPERATOR_ASSUMPTION", scenarioBlockingReasons: ["Awaiting terms"], ruleVersion: "economic-decision@1", decidedBy: "operator-1", decidedAt: timestamp, supersedesDecisionId, createdAt: timestamp };
}

function repository(history: readonly EconomicDecisionRecord[]): EconomicDecisionRepository {
  return {
    create: async () => { throw new Error("read test must not mutate"); },
    getById: async () => { throw new Error("detail must consume Phase 4K history path"); },
    getCurrent: async () => { throw new Error("detail must consume Phase 4K history path"); },
    listHistory: async () => [...history],
  };
}

const detail = {
  opportunityId, reference: "stable-01", title: "Existing detail title", lifecycle: "ACTIVE", company: "Existing Company", project: "Existing Project", location: "Austin, TX", currentness: "CURRENT", asOf: timestamp.toISOString(), demand: [],
  commercialRoute: { capability: "UNAVAILABLE", buyerOrganizations: [], people: [], routes: [], vendorRoutes: [] }, acceptance: null,
  humanVerification: { capability: "UNAVAILABLE", decisions: [] }, evidence: [], gaps: [], conflicts: [],
} as OpportunityIntelligenceDetail;

describe("Phase 4L opportunity detail economic decision consumption", () => {
  it("exposes explicit no-decision state and preserves existing detail", async () => {
    const decisions = await readOpportunityEconomicDecisions(opportunityId, repository([]));
    const result = composeOpportunityDetailResult(detail, null, decisions);
    expect(result).toMatchObject({ state: "READY", detail: { title: "Existing detail title" }, economicDecisions: { current: null, history: [] } });
  });

  it("exposes one root as current and history without deriving a disposition", async () => {
    const decisions = await readOpportunityEconomicDecisions(opportunityId, repository([record("d1", "PROCEED", null)]));
    const result = composeOpportunityDetailResult(detail, null, decisions);
    expect(result.economicDecisions?.current?.decisionId).toBe("d1");
    expect(result.economicDecisions?.history).toHaveLength(1);
  });

  it("preserves canonical D1 -> D2 -> D3 lineage and excludes another opportunity", async () => {
    const d1 = record("d1", "PROCEED", null), d2 = record("d2", "DEFER", "d1"), d3 = record("d3", "DECLINE", "d2");
    const foreign = record("foreign", "PROCEED", null, otherOpportunityId);
    const decisions = await readOpportunityEconomicDecisions(opportunityId, repository([d3, foreign, d1, d2]));
    const result = composeOpportunityDetailResult(detail, null, decisions);
    expect(result.economicDecisions?.history.map(item => item.decisionId)).toEqual(["d1", "d2", "d3"]);
    expect(result.economicDecisions?.history.map(item => item.supersedesDecisionId)).toEqual([null, "d1", "d2"]);
    expect(result.economicDecisions?.current?.decisionId).toBe("d3");
    expect(result.detail).toBe(detail);
  });

  it("keeps read failure distinct from the valid no-decision projection", () => {
    const result = composeOpportunityDetailResult(detail, null, null);
    expect(result.state).toBe("READY");
    expect(result.economicDecisions).toBeNull();
  });

  it("wires Opportunity Detail only to the canonical Phase 4K loader", async () => {
    const source = await readFile(resolve(process.cwd(), "src/server/opportunity-detail/get-opportunity-detail-page.ts"), "utf8");
    expect(source).toContain("loadOpportunityEconomicDecisions(id)");
    expect(source).not.toMatch(/economic_decisions|supersedesDecisionId|listHistory/);
  });
});
