import type {
  CaptureMethod,
  CapturePolicyDecisionRecord,
  CapturePolicyEvaluation,
  SourceRecord,
  TechnicalAccessState,
} from "../../../domain/source";

const automatedMethods = new Set<CaptureMethod>(["HTTP_FETCH", "API", "RSS", "HEADLESS_RENDER"]);

function technicalAccess(source: SourceRecord): TechnicalAccessState {
  switch (source.accessClassification) {
    case "PUBLIC":
      return "ACCESSIBLE";
    case "ACCOUNT_REQUIRED":
    case "REQUIRES_LOGIN":
    case "PAYWALLED":
      return "CONDITIONAL";
    case "RESTRICTED":
      return "RESTRICTED";
    default:
      return "UNKNOWN";
  }
}

function result(
  source: SourceRecord,
  value: CapturePolicyEvaluation["result"],
  reason: string,
  decision: CapturePolicyDecisionRecord | null,
): CapturePolicyEvaluation {
  return {
    result: value,
    reason,
    technicalAccess: technicalAccess(source),
    decisionId: decision?.id ?? null,
  };
}

export function evaluateCapturePolicy(
  source: SourceRecord,
  method: CaptureMethod,
  decision: CapturePolicyDecisionRecord | null,
  evaluatedAt: Date,
): CapturePolicyEvaluation {
  if (!source.enabled) return result(source, "DENY", "Source is disabled", decision);

  if (decision?.decision === "DENIED") {
    return result(source, "DENY", `Capture method explicitly denied: ${decision.reason}`, decision);
  }

  if (source.paywalled === true && decision?.decision !== "ALLOWED") {
    return result(source, "DENY", "Paywalled source lacks explicit method approval", decision);
  }

  if (!decision) {
    return result(source, "REVIEW_REQUIRED", "No policy decision exists for this capture method", null);
  }

  if (decision.decision === "REVIEW_REQUIRED") {
    return result(source, "REVIEW_REQUIRED", decision.reason, decision);
  }

  if (decision.validUntil && decision.validUntil <= evaluatedAt) {
    return result(source, "REVIEW_REQUIRED", "Capture approval has expired", decision);
  }

  if (decision.reviewDueAt && decision.reviewDueAt <= evaluatedAt) {
    return result(source, "REVIEW_REQUIRED", "Capture policy review is due", decision);
  }

  if (source.nextComplianceReviewDueAt && source.nextComplianceReviewDueAt <= evaluatedAt) {
    return result(source, "REVIEW_REQUIRED", "Source compliance review is due", decision);
  }

  if (automatedMethods.has(method)) {
    if (source.robotsReviewStatus === "RESTRICTED" || source.tosReviewStatus === "RESTRICTED") {
      return result(source, "DENY", "Robots or terms review restricts automated capture", decision);
    }
    if (source.robotsReviewStatus !== "APPROVED" || source.tosReviewStatus !== "APPROVED") {
      return result(source, "REVIEW_REQUIRED", "Automated capture compliance is not fully approved", decision);
    }
  }

  return result(source, "ALLOW", `Capture method explicitly allowed: ${decision.reason}`, decision);
}
