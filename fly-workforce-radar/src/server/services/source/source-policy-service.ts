import type { CaptureMethod, CapturePolicyEvaluation } from "../../../domain/source";
import type { SourceRepository } from "../../repositories/source/source-repository";
import { evaluateCapturePolicy } from "./capture-policy";

export class SourcePolicyService {
  constructor(private readonly repository: SourceRepository) {}

  async evaluate(sourceId: string, method: CaptureMethod, evaluatedAt: Date): Promise<CapturePolicyEvaluation> {
    const source = await this.repository.getById(sourceId);
    if (!source) {
      return {
        result: "REVIEW_REQUIRED",
        reason: "Source is not registered",
        technicalAccess: "UNKNOWN",
        decisionId: null,
      };
    }

    const decision = await this.repository.getCurrentDecision(sourceId, method);
    return evaluateCapturePolicy(source, method, decision, evaluatedAt);
  }
}
