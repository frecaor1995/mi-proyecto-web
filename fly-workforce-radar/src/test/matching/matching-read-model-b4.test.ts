import { describe, expect, it } from "vitest";
import type { MatchingReadyDemandInput } from "../../domain/demand-matching";
import type { MatchingReadyWorkerInput } from "../../domain/worker";
import { knownFact, unknownFact } from "../../domain/worker";
import { MatchingReadModelService } from "../../server/services/matching/matching-read-model-service";

const DEMAND_ID = "11111111-1111-4111-8111-111111111111";
const WORKER_ID = "22222222-2222-4222-8222-222222222222";
const demand: MatchingReadyDemandInput = { demandSignalId: DEMAND_ID, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", minimumExperienceMonths: 24, skills: [], credentials: [], startDate: null, compensation: knownFact({ payCurrency: "USD", basePayMin: 25, basePayMax: 35, payPeriod: "HOURLY" }) };
const worker: MatchingReadyWorkerInput = { workerId: WORKER_ID, tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 36 }], skills: [], credentials: [], availability: knownFact({ status: "AVAILABLE", availableFrom: null, availableUntil: null }), location: unknownFact(), compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: null, currency: "USD", perDiemRequired: null, negotiable: false }), knownGaps: [] };

describe("MATCHING-B4-B display-safe B2 explanation projection", () => {
  it("projects all canonical criteria while dropping observed raw values", async () => {
    const service = new MatchingReadModelService({
      repository: {
        listCurrentResultsForDemand: async () => [{ id: "result-1", demandSignalId: DEMAND_ID, workerId: WORKER_ID, outcome: "POSSIBLE_MATCH", ruleVersion: "matching-b1-d-v1", evaluationDate: new Date(), evaluatedAt: new Date(), workerInputFingerprint: "old", demandInputFingerprint: "old", workerLifecycleStatusAtEvaluation: "ACTIVE", supersededAt: null, createdAt: new Date() }],
        listCriteriaForResult: async () => [
          { id: "c1", matchResultId: "result-1", criterion: "TRADE", subject: null, importance: "HARD", state: "SATISFIED", reasonCode: "TRADE_MATCH_PRIMARY", observedDemand: "SENSITIVE_DEMAND", observedWorker: "SENSITIVE_WORKER", createdAt: new Date() },
          { id: "c2", matchResultId: "result-1", criterion: "PREFERRED_SKILL", subject: "PLC", importance: "PREFERRED", state: "SATISFIED_WITH_LIMITATION", reasonCode: "PREFERRED_SKILL_UNVERIFIED", observedDemand: "SECRET", observedWorker: "SECRET", createdAt: new Date() },
        ],
      } as never,
      workerService: { getWorker: async () => ({ kind: "OK", value: { displayName: "Avery", lifecycleStatus: "ACTIVE" } }), buildMatchingReadyInput: async () => ({ kind: "OK", value: worker }) } as never,
      demandRequirementService: { getMatchingReadyInput: async () => ({ kind: "OK", value: demand }) } as never,
      getSession: async () => ({ authUserId: "operator", email: "operator@example.com" }),
      operatorRepository: { findByAuthUserId: async () => ({ id: "operator", authUserId: "operator", email: "operator@example.com", displayName: null, status: "ACTIVE", permissions: ["matching_result.read"], createdAt: new Date(), updatedAt: new Date() }) } as never,
    });
    const result = await service.getDemandMatchReadModel(DEMAND_ID);
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") throw new Error("unreachable");
    expect(result.value.workers[0].explanations).toEqual([
      { criterion: "TRADE", subject: null, importance: "HARD", state: "SATISFIED", reasonCode: "TRADE_MATCH_PRIMARY" },
      { criterion: "PREFERRED_SKILL", subject: "PLC", importance: "PREFERRED", state: "SATISFIED_WITH_LIMITATION", reasonCode: "PREFERRED_SKILL_UNVERIFIED" },
    ]);
    expect(JSON.stringify(result.value)).not.toMatch(/SENSITIVE|SECRET|observedDemand|observedWorker/);
  });
});
