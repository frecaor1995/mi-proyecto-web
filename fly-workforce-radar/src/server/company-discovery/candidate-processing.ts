import type { DiscoveryCandidate } from "../../domain/company-discovery";

export interface GovernedCaptureGateway {
  captureDestination(input: { readonly runId?: string; readonly url: string; readonly target: string }): Promise<
    | { readonly state: "CAPTURED"; readonly evidenceId: string; readonly reason?: string }
    | { readonly state: "REVIEW_REQUIRED" | "REJECTED" | "FAILED"; readonly reason?: string }
  >;
}

export interface OpportunityPromotionGateway {
  promote(input: { readonly target: string; readonly candidateUrl: string; readonly evidenceId: string }): Promise<
    | { readonly state: "NOT_JUSTIFIED" }
    | { readonly state: "CREATED" | "UPDATED"; readonly opportunityId: string }
  >;
}

export interface CanonicalOperationalEvaluator {
  evaluate(opportunityId: string): Promise<"HOT" | "NEAR_READY" | "WATCH" | "NEEDS_REVIEW">;
}

export interface CandidateProcessingResult {
  readonly candidates: readonly DiscoveryCandidate[];
  readonly captureFailures: number;
  readonly evidenceCount: number;
  readonly opportunitiesCreatedCount: number;
  readonly opportunitiesUpdatedCount: number;
}

export async function processDiscoveryCandidates(
  target: string,
  candidates: readonly DiscoveryCandidate[],
  capture: GovernedCaptureGateway,
  promotion: OpportunityPromotionGateway,
  evaluator: CanonicalOperationalEvaluator,
  runId?: string,
): Promise<CandidateProcessingResult> {
  let captureFailures = 0;
  let evidenceCount = 0;
  let opportunitiesCreatedCount = 0;
  let opportunitiesUpdatedCount = 0;
  const processed: DiscoveryCandidate[] = [];
  for (const candidate of candidates) {
    // Only the governed destination URL crosses the capture boundary. Provider
    // title/description/ranking cannot become evidence.
    const captured = await capture.captureDestination({ ...(runId ? { runId } : {}), url: candidate.normalizedUrl, target });
    if (captured.state === "FAILED") captureFailures += 1;
    if (captured.state !== "CAPTURED") {
      processed.push({ ...candidate, destinationPolicyDecision: captured.state === "REJECTED" ? "DENIED" : "REVIEW_REQUIRED", processingReason: captured.reason ?? "Destination processing did not produce canonical evidence", destinationCaptureFailed: captured.state === "FAILED" });
      continue;
    }
    evidenceCount += 1;
    const promoted = await promotion.promote({
      target,
      candidateUrl: candidate.normalizedUrl,
      evidenceId: captured.evidenceId,
    });
    if (promoted.state === "NOT_JUSTIFIED") {
      processed.push({ ...candidate, evidenceCaptured: true, canonicalEvidenceId: captured.evidenceId, destinationPolicyDecision: "ALLOWED", processingReason: captured.reason ?? "Approved destination captured as canonical evidence" });
      continue;
    }
    if (promoted.state === "CREATED") opportunitiesCreatedCount += 1;
    else opportunitiesUpdatedCount += 1;
    processed.push({
      ...candidate,
      evidenceCaptured: true,
      canonicalEvidenceId: captured.evidenceId,
      correlatedOpportunityId: promoted.opportunityId,
      operationalClassification: await evaluator.evaluate(promoted.opportunityId),
      humanReviewRequired: false,
      destinationPolicyDecision: "ALLOWED",
      processingReason: captured.reason ?? "Approved destination captured as canonical evidence",
    });
  }
  return { candidates: processed, captureFailures, evidenceCount, opportunitiesCreatedCount, opportunitiesUpdatedCount };
}

export const REVIEW_ONLY_CAPTURE: GovernedCaptureGateway = {
  captureDestination: async () => ({ state: "REVIEW_REQUIRED", reason: "Destination source is not approved for capture" }),
};
export const NO_AUTOMATIC_PROMOTION: OpportunityPromotionGateway = {
  promote: async () => ({ state: "NOT_JUSTIFIED" }),
};
export const NO_UNGOVERNED_EVALUATION: CanonicalOperationalEvaluator = {
  evaluate: async () => "NEEDS_REVIEW",
};
