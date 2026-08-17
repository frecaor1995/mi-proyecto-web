import { createHash } from "node:crypto";
import type { ClaimCandidate, ClaimRecord, ClaimStateTransition } from "../../../domain/claims";
import type { EvidenceRepository } from "../../repositories/evidence/evidence-repository";
import type { ClaimRepository } from "../../repositories/claims/claim-repository";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function claimIdentity(candidate: ClaimCandidate): string {
  const material = canonical({
    subjectType: candidate.subject.type,
    subjectId: candidate.subject.id,
    predicate: candidate.predicate,
    externalManpowerCategory: candidate.externalManpowerCategory ?? null,
    value: candidate.value,
    assertionKind: candidate.assertionKind,
  });
  return createHash("sha256").update(material).digest("hex");
}

export class ClaimService {
  constructor(
    private readonly repository: ClaimRepository,
    private readonly evidenceRepository: EvidenceRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(candidate: ClaimCandidate): Promise<ClaimRecord> {
    const evidenceIds = [...new Set(candidate.evidenceIds ?? [])];
    const claim = await this.repository.createOrGet({
      candidate: {
        ...candidate,
        assertedAt: candidate.assertedAt ?? this.clock(),
        assertedBy: candidate.assertedBy ?? "system:claim-builder",
      },
      identityKey: claimIdentity(candidate),
      initialEvidenceId: evidenceIds[0] ?? null,
    });
    for (const evidenceId of evidenceIds) {
      if (!await this.repository.hasEvidence(claim.id, evidenceId)) {
        await this.evidenceRepository.link(evidenceId, { kind: "CLAIM", id: claim.id }, "SUPPORTS");
      }
    }
    return claim;
  }

  async transition(input: Omit<ClaimStateTransition, "at"> & { at?: Date }): Promise<ClaimRecord> {
    if (input.newState === "VERIFIED") {
      if (!input.evidenceId) throw new Error("VERIFIED claims require explicit supporting evidence");
      if (!await this.repository.hasEvidence(input.claimId, input.evidenceId)) {
        throw new Error("Verification evidence must already support the claim");
      }
    }
    return this.repository.transition({ ...input, at: input.at ?? this.clock() });
  }

  async markStale(at: Date = this.clock(), actor = "system:staleness-policy"): Promise<ClaimRecord[]> {
    const claimIds = await this.repository.listStaleCandidates(at);
    return Promise.all(claimIds.map((claimId) => this.repository.transition({
      claimId, newState: "STALE", actor, at,
      reason: "Claim reached its configured stale_after timestamp",
    })));
  }
}
