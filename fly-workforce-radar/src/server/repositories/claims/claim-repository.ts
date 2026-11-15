import type { ClaimCandidate, ClaimRecord, ClaimStateAuditRecord, ClaimStateTransition, ClaimSubject } from "../../../domain/claims";

export interface PersistClaimInput {
  candidate: ClaimCandidate;
  identityKey: string;
  initialEvidenceId: string | null;
}

export interface ClaimRepository {
  createOrGet(input: PersistClaimInput): Promise<ClaimRecord>;
  getById(id: string): Promise<ClaimRecord | null>;
  listBySubject(subject: ClaimSubject, currentAt?: Date): Promise<ClaimRecord[]>;
  hasEvidence(claimId: string, evidenceId?: string): Promise<boolean>;
  transition(input: ClaimStateTransition): Promise<ClaimRecord>;
  listTransitions(claimId: string): Promise<ClaimStateAuditRecord[]>;
  listStaleCandidates(at: Date): Promise<string[]>;
}
