import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), evaluate: vi.fn(), revalidate: vi.fn(), loadGraph: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../server/auth/authorization", () => ({ authorizeOperator: mocks.authorize }));
vi.mock("../../server/services/matching/evaluate-demand-against-workforce", () => ({ evaluateDemandAgainstWorkforce: mocks.evaluate }));
vi.mock("../../server/repositories/opportunity/postgres-opportunity-repository", () => ({
  PostgresOpportunityRepository: class { loadGraph = mocks.loadGraph; },
}));
vi.mock("../../server/opportunity-detail/get-opportunity-workforce-matching", () => ({
  createProductionMatchingServices: () => ({
    client: {}, operatorRepository: { marker: "operator" }, demandRequirementService: { marker: "demand" },
    workerService: { marker: "worker" }, persistenceService: { marker: "persistence" },
  }),
}));

import { runOpportunityWorkforceMatchingAction } from "../../server/opportunity-detail/workforce-matching-actions";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const DEMAND_ID = "22222222-2222-4222-8222-222222222222";
const initial = { status: "READY" as const, demandSignalId: null, run: null, errorKey: null };
const form = (opportunityId = OPPORTUNITY_ID, demandSignalId = DEMAND_ID) => {
  const value = new FormData(); value.set("opportunityId", opportunityId); value.set("demandSignalId", demandSignalId); return value;
};
const run = {
  demandSignalId: DEMAND_ID, startedAt: new Date("2026-09-20T12:00:00Z"), completedAt: new Date("2026-09-20T12:01:00Z"),
  eligibleWorkerCount: 2, evaluatedWorkerCount: 2, persistedWorkerCount: 2, ineligibleWorkerCount: 0, failedWorkerCount: 0,
  outcomes: { STRONG_MATCH: 1, POSSIBLE_MATCH: 1, NO_MATCH: 0, INSUFFICIENT_DATA: 0 }, failures: [],
};

describe("MATCHING-B4-B server action boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ state: "AUTHORIZED", operator: { permissions: ["matching.execute"] } });
    mocks.loadGraph.mockResolvedValue({ demandSignals: [{ id: DEMAND_ID }] });
    mocks.evaluate.mockResolvedValue({ kind: "OK", value: run });
  });

  it("rejects a malformed opportunity id before authorization", async () => {
    const result = await runOpportunityWorkforceMatchingAction(initial, form("bad", DEMAND_ID));
    expect(result.errorKey).toBe("workforceMatching.error.invalidOpportunity"); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("rejects a malformed demand id before authorization", async () => {
    const result = await runOpportunityWorkforceMatchingAction(initial, form(OPPORTUNITY_ID, "bad"));
    expect(result.errorKey).toBe("workforceMatching.error.invalidDemand"); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("rejects a demand not linked to the opportunity", async () => {
    mocks.loadGraph.mockResolvedValue({ demandSignals: [{ id: "33333333-3333-4333-8333-333333333333" }] });
    const result = await runOpportunityWorkforceMatchingAction(initial, form());
    expect(result.errorKey).toBe("workforceMatching.error.demandNotLinked"); expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it("denies an operator without matching.execute", async () => {
    mocks.authorize.mockResolvedValue({ state: "AUTHENTICATED_BUT_UNAUTHORIZED" });
    const result = await runOpportunityWorkforceMatchingAction(initial, form());
    expect(result.errorKey).toBe("workforceMatching.error.executionPermission"); expect(mocks.loadGraph).not.toHaveBeenCalled();
  });
  it("invokes B3 only after authorization and linked-demand validation", async () => {
    const result = await runOpportunityWorkforceMatchingAction(initial, form());
    expect(result.status).toBe("COMPLETED"); expect(mocks.evaluate).toHaveBeenCalledWith(DEMAND_ID, expect.objectContaining({ demandRequirementService: expect.anything(), workerService: expect.anything(), persistenceService: expect.anything() }));
  });
  it("ignores browser-supplied outcomes, workers, criteria, scores, versions, and fingerprints", async () => {
    const value = form(); for (const key of ["workerId", "outcome", "criteria", "score", "ruleVersion", "fingerprint"]) value.set(key, "ATTACKER_CONTROLLED");
    await runOpportunityWorkforceMatchingAction(initial, value);
    expect(mocks.evaluate).toHaveBeenCalledTimes(1); expect(JSON.stringify(mocks.evaluate.mock.calls[0])).not.toContain("ATTACKER_CONTROLLED");
  });
  it("sanitizes thrown errors", async () => {
    mocks.evaluate.mockRejectedValue(new Error("password=hunter2 worker@example.com 555-0199"));
    const result = await runOpportunityWorkforceMatchingAction(initial, form());
    expect(result).toEqual({ status: "FAILED", demandSignalId: DEMAND_ID, run: null, errorKey: "workforceMatching.error.runFailed" });
    expect(JSON.stringify(result)).not.toMatch(/hunter2|example\.com|555/);
  });
  it("revalidates the exact opportunity path after success", async () => {
    await runOpportunityWorkforceMatchingAction(initial, form());
    expect(mocks.revalidate).toHaveBeenCalledWith(`/opportunities/${OPPORTUNITY_ID}`);
  });
  it("returns a distinct partial-success state", async () => {
    mocks.evaluate.mockResolvedValue({ kind: "OK", value: { ...run, persistedWorkerCount: 1, failedWorkerCount: 1, failures: [{ workerId: "w", reasonCode: "PERSISTENCE_FAILED" }] } });
    expect((await runOpportunityWorkforceMatchingAction(initial, form())).status).toBe("PARTIAL_SUCCESS");
  });
});
