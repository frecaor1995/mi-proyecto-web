import type { ClaimCandidate, ClaimValue } from "../../../domain/claims";

export interface DemandSignalClaimSource {
  id: string;
  rawEvidenceId: string;
  roleType: string;
  originalTitle: string;
  unresolvedPublisherName: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  payCurrency: string | null;
  basePayMin: number | null;
  basePayMax: number | null;
  payPeriod: string | null;
  overtimeAvailable: boolean | null;
  overtimeTerms: string | null;
  perDiemAvailable: boolean | null;
  perDiemAmount: number | null;
  perDiemFrequency: string | null;
  schedule: string | null;
  headcountEstimate: number | null;
  publishedAt: Date | null;
}

function fact(source: DemandSignalClaimSource, predicate: ClaimCandidate["predicate"], value: ClaimValue): ClaimCandidate {
  return {
    subject: { type: "DEMAND_SIGNAL", id: source.id }, predicate, value,
    assertionKind: "FACT", evidenceIds: [source.rawEvidenceId],
    metadata: { builder: "demand-signal-explicit-fields@1.0.0" },
  };
}

export function buildDemandSignalClaims(source: DemandSignalClaimSource): ClaimCandidate[] {
  const claims: ClaimCandidate[] = [
    fact(source, "demand_role", { normalized: source.roleType, original: source.originalTitle }),
  ];
  if (source.city !== null || source.county !== null || source.state !== null) {
    claims.push(fact(source, "location", { city: source.city, county: source.county, state: source.state }));
  }
  if (source.basePayMin !== null || source.basePayMax !== null || source.payCurrency !== null) {
    claims.push(fact(source, "compensation", {
      minimum: source.basePayMin, maximum: source.basePayMax,
      currency: source.payCurrency, period: source.payPeriod,
    }));
  }
  if (source.overtimeAvailable !== null || source.overtimeTerms !== null) {
    claims.push(fact(source, "overtime_terms", { available: source.overtimeAvailable, terms: source.overtimeTerms }));
  }
  if (source.perDiemAvailable !== null || source.perDiemAmount !== null) {
    claims.push(fact(source, "per_diem", {
      available: source.perDiemAvailable, amount: source.perDiemAmount,
      frequency: source.perDiemFrequency,
    }));
  }
  if (source.schedule !== null) claims.push(fact(source, "schedule", source.schedule));
  if (source.headcountEstimate !== null) claims.push(fact(source, "headcount", source.headcountEstimate));
  if (source.unresolvedPublisherName !== null) {
    claims.push(fact(source, "publisher_identity_text", source.unresolvedPublisherName));
  } else {
    claims.push({
      subject: { type: "DEMAND_SIGNAL", id: source.id },
      predicate: "publisher_identity_text", value: null, assertionKind: "UNKNOWN",
      evidenceIds: [source.rawEvidenceId],
      metadata: { builder: "demand-signal-explicit-fields@1.0.0", reason: "publisher_missing" },
    });
  }
  if (source.publishedAt !== null) {
    claims.push(fact(source, "source_recency_status", { publishedAt: source.publishedAt.toISOString() }));
  }
  return claims;
}

export function buildDemandIntensityInference(
  subjectId: string,
  evidenceIds: string[],
  postingCount: number,
): ClaimCandidate {
  return {
    subject: { type: "DEMAND_SIGNAL", id: subjectId },
    predicate: "demand_intensity_indicator",
    value: { postingCount, statement: "Multiple postings may indicate elevated manpower demand" },
    assertionKind: "INFERENCE", evidenceIds,
    metadata: { builder: "deterministic-demand-intensity@1.0.0" },
  };
}
