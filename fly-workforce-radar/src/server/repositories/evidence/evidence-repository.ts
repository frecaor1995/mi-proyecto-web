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
  /** TX-INTEGRITY-04B recovery lookup: evidence correlated to a given human-verification interaction, via the existing metadata.interactionId already stamped by HumanVerificationClosureService.close(). Because canonical closure is one atomic transaction (TX-INTEGRITY-03B), any match here proves the entire closure committed. */
  findByInteractionId(interactionId: string): Promise<EvidenceRecord[]>;
  listBySource(sourceId: string): Promise<EvidenceRecord[]>;
  link(evidenceId: string, target: EvidenceTarget, linkType?: EvidenceLinkType): Promise<string>;
  listLinksByEvidence(evidenceId: string): Promise<EvidenceLinkRecord[]>;
  recordStatus(evidenceId: string, status: EvidenceStatus, reason?: string): Promise<string>;
  supersede(supersededEvidenceId: string, supersedingEvidenceId: string, reason?: string): Promise<void>;
}
