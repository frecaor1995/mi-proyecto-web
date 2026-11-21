import type {
  IngestionAttemptRecord,
  IngestionOutcome,
  IngestionRequest,
  IngestionStatus,
  NormalizedDemandSignal,
} from "../../../domain/ingestion";
import type { CapturePolicyEvaluation } from "../../../domain/source";
import type { EvidenceRepository } from "../../repositories/evidence/evidence-repository";
import type { IngestionRepository } from "../../repositories/ingestion/ingestion-repository";
import type { SourceRepository } from "../../repositories/source/source-repository";
import { sha256CapturedPayload } from "../evidence/content-hash";
import type { EvidenceCaptureService } from "../evidence/capture-evidence";
import type { SourcePolicyService } from "../source/source-policy-service";

function identityKey(externalPostingId: string | null, sourceUrl: string): string {
  return externalPostingId
    ? `external:${externalPostingId}`
    : `url:${sha256CapturedPayload(sourceUrl)}`;
}

function validateSignal(signal: NormalizedDemandSignal): string | null {
  if (signal.originalTitle.trim() === "") return "Normalized signal title is empty";
  if (signal.payCurrency !== null && !/^[A-Z]{3}$/.test(signal.payCurrency)) {
    return "Pay currency must be a three-letter uppercase code";
  }
  if (
    signal.basePayMin !== null
    && signal.basePayMax !== null
    && signal.basePayMax < signal.basePayMin
  ) {
    return "Pay range is contradictory";
  }
  if (signal.headcountEstimate !== null && !Number.isInteger(signal.headcountEstimate)) {
    return "Headcount must be an integer";
  }
  return null;
}

export class ControlledIngestionService {
  constructor(
    private readonly sourceRepository: SourceRepository,
    private readonly policyService: SourcePolicyService,
    private readonly evidenceCaptureService: EvidenceCaptureService,
    private readonly evidenceRepository: EvidenceRepository,
    private readonly ingestionRepository: IngestionRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async ingest(request: IngestionRequest): Promise<IngestionOutcome> {
    const startedAt = this.clock();
    const policy = await this.policyService.evaluate(request.sourceId, request.method, startedAt);

    if (policy.result !== "ALLOW") {
      const status = policy.result === "DENY" ? "POLICY_DENIED" : "REVIEW_REQUIRED";
      return this.finish(request, policy, status, startedAt, null, null, null, null, policy.reason);
    }

    const source = await this.sourceRepository.getById(request.sourceId);
    if (!source) throw new Error("Policy allowed an unregistered source");

    if (!request.adapter.supports(request.method)) {
      return this.finish(
        request,
        policy,
        "CAPTURE_FAILED",
        startedAt,
        null,
        null,
        null,
        null,
        `Adapter ${request.adapter.id} does not support ${request.method}`,
      );
    }

    let resource;
    try {
      resource = await request.adapter.capture({
        source,
        target: request.target,
        method: request.method,
      });
    } catch (error) {
      return this.finish(
        request,
        policy,
        "CAPTURE_FAILED",
        startedAt,
        null,
        null,
        null,
        null,
        error instanceof Error ? error.message : "Capture failed",
      );
    }

    let evidenceId: string;
    try {
      const evidence = await this.evidenceCaptureService.capture({
        sourceId: request.sourceId,
        sourceUrl: resource.sourceUrl,
        capturedAt: resource.capturedAt,
        captureMethod: request.method,
        payload: resource.payload,
        contentType: resource.contentType,
        extractorVersion: request.parser.version,
        httpMetadata: resource.httpMetadata,
        metadata: { ...resource.metadata, adapterId: request.adapter.id },
      });
      evidenceId = evidence.id;
    } catch (error) {
      return this.finish(
        request,
        policy,
        "CAPTURE_FAILED",
        startedAt,
        null,
        null,
        null,
        null,
        error instanceof Error ? error.message : "Evidence capture failed",
      );
    }

    let signal: NormalizedDemandSignal;
    try {
      signal = request.parser.parse(resource);
    } catch (error) {
      return this.finish(
        request,
        policy,
        "PARSE_FAILED",
        startedAt,
        evidenceId,
        null,
        null,
        null,
        error instanceof Error ? error.message : "Parse failed",
      );
    }

    const validationFailure = validateSignal(signal);
    const sourceIdentityKey = identityKey(signal.externalPostingId, resource.sourceUrl);
    if (validationFailure) {
      return this.finish(
        request,
        policy,
        "VALIDATION_FAILED",
        startedAt,
        evidenceId,
        null,
        signal.externalPostingId,
        sourceIdentityKey,
        validationFailure,
      );
    }

    let demandSignalId: string;
    try {
      demandSignalId = await this.ingestionRepository.upsertDemandSignal({
        sourceId: request.sourceId,
        rawEvidenceId: evidenceId,
        sourceIdentityKey,
        parserVersion: request.parser.version,
        observedAt: resource.capturedAt,
        signal,
      });
      await this.evidenceRepository.link(
        evidenceId,
        { kind: "DEMAND_SIGNAL", id: demandSignalId },
        "DERIVED_FROM",
      );
    } catch (error) {
      return this.finish(
        request,
        policy,
        "VALIDATION_FAILED",
        startedAt,
        evidenceId,
        null,
        signal.externalPostingId,
        sourceIdentityKey,
        error instanceof Error ? error.message : "Demand signal persistence failed",
      );
    }

    return this.finish(
      request,
      policy,
      "SUCCESS",
      startedAt,
      evidenceId,
      demandSignalId,
      signal.externalPostingId,
      sourceIdentityKey,
      null,
    );
  }

  private async finish(
    request: IngestionRequest,
    policy: CapturePolicyEvaluation,
    status: IngestionStatus,
    startedAt: Date,
    rawEvidenceId: string | null,
    demandSignalId: string | null,
    externalPostingId: string | null,
    sourceIdentityKey: string | null,
    failureReason: string | null,
  ): Promise<IngestionOutcome> {
    const attempt: IngestionAttemptRecord = {
      sourceId: request.sourceId,
      requestedMethod: request.method,
      policyResult: policy.result,
      policyDecisionId: policy.decisionId,
      adapterId: request.adapter.id,
      requestedTarget: request.target,
      status,
      startedAt,
      endedAt: this.clock(),
      rawEvidenceId,
      demandSignalId,
      externalPostingId,
      sourceIdentityKey,
      failureReason,
      parserVersion: request.parser.version,
    };
    const auditId = await this.ingestionRepository.recordAttempt(attempt);
    return {
      status,
      auditId,
      evidenceId: rawEvidenceId,
      demandSignalId,
      reason: failureReason,
    };
  }
}
