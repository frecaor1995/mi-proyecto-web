import type {
  CreateEvidenceRecord,
  EvidenceLinkType,
  EvidenceLinkRecord,
  EvidenceRecord,
  EvidenceStatus,
  EvidenceTarget,
} from "../../../domain/evidence";

export interface EvidenceRepository {
  create(input: CreateEvidenceRecord): Promise<EvidenceRecord>;
  getById(id: string): Promise<EvidenceRecord | null>;
  findByContentHash(contentHash: string): Promise<EvidenceRecord[]>;
  listBySource(sourceId: string): Promise<EvidenceRecord[]>;
  link(evidenceId: string, target: EvidenceTarget, linkType?: EvidenceLinkType): Promise<string>;
  listLinksByEvidence(evidenceId: string): Promise<EvidenceLinkRecord[]>;
  recordStatus(evidenceId: string, status: EvidenceStatus, reason?: string): Promise<string>;
  supersede(supersededEvidenceId: string, supersedingEvidenceId: string, reason?: string): Promise<void>;
}
