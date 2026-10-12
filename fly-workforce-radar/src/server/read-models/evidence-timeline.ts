import type { EvidenceRecord, EvidenceLinkRecord } from "@/domain/evidence";
import type { ClaimRecord } from "@/domain/claims";
import type { ProvenanceRef, ReadModelCurrentness, ReadModelTrustState } from "./shared";
import { currentnessFromStaleAfter, mapDatabaseVerificationState } from "./shared";

/**
 * Deliberately excludes EvidenceRecord.httpMetadata / .metadata / .contentHash
 * / .payloadSizeBytes / .storageReference -- raw capture-pipeline payload
 * that never needs to cross the frontend boundary. See UI-2 section 14.
 */
export interface EvidenceTimelineItem {
  readonly evidenceId: string;
  readonly sourceUrl: string;
  readonly capturedAt: string;
  readonly evidenceType: string;
  readonly linkType: string | null;
  readonly supportedStatementSummary: string | null;
  readonly factOrInference: "FACT" | "INFERENCE" | "UNKNOWN";
  readonly verificationState: ReadModelTrustState;
  readonly currentness: ReadModelCurrentness;
  readonly conflictState: "CONFLICT" | "NONE";
  readonly provenanceRef: ProvenanceRef;
}

export interface EvidenceTimelineAssemblyInput {
  readonly evidence: EvidenceRecord;
  readonly link?: EvidenceLinkRecord | null;
  readonly claim?: ClaimRecord | null;
  readonly hasConflict?: boolean;
  readonly asOf: Date;
}

export function assembleEvidenceTimelineItem(input: EvidenceTimelineAssemblyInput): EvidenceTimelineItem {
  const { evidence, link, claim, hasConflict = false, asOf } = input;
  return {
    evidenceId: evidence.id,
    sourceUrl: evidence.sourceUrl,
    capturedAt: evidence.capturedAt.toISOString(),
    evidenceType: evidence.captureMethod,
    linkType: link?.linkType ?? null,
    supportedStatementSummary: claim ? String(claim.predicate) : null,
    factOrInference: claim?.assertionKind ?? "UNKNOWN",
    verificationState: claim ? mapDatabaseVerificationState(claim.verificationState) : "UNVERIFIED",
    currentness: currentnessFromStaleAfter(asOf, claim?.staleAfter),
    conflictState: hasConflict ? "CONFLICT" : "NONE",
    provenanceRef: { evidenceId: evidence.id, claimId: claim?.id ?? null, sourceUrl: evidence.sourceUrl },
  };
}
