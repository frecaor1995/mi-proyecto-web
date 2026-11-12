import type { EvidenceCaptureInput, EvidenceRecord } from "../../../domain/evidence";
import type { EvidenceRepository } from "../../repositories/evidence/evidence-repository";
import type { EvidenceStorage } from "../../storage/evidence-storage";
import { capturedPayloadBytes, sha256CapturedPayload } from "./content-hash";

export class EvidenceCaptureService {
  constructor(
    private readonly repository: EvidenceRepository,
    private readonly storage?: EvidenceStorage,
  ) {}

  async capture(input: EvidenceCaptureInput): Promise<EvidenceRecord> {
    const bytes = capturedPayloadBytes(input.payload);
    const contentHash = sha256CapturedPayload(bytes);

    if (input.storageReference && this.storage) {
      throw new Error("Provide either a storage reference or a storage adapter, not both");
    }

    const storageReference = this.storage
      ? await this.storage.put(contentHash, bytes, input.contentType)
      : input.storageReference;

    return this.repository.create({
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl,
      capturedAt: input.capturedAt,
      captureMethod: input.captureMethod,
      contentHash,
      payloadSizeBytes: bytes.byteLength,
      contentType: input.contentType,
      extractorVersion: input.extractorVersion,
      storageReference,
      httpMetadata: input.httpMetadata,
      metadata: input.metadata,
    });
  }
}
