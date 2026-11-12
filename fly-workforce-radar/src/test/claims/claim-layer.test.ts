import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXTERNAL_MANPOWER_CATEGORIES } from "../../domain/database";
import type { ClaimCandidate } from "../../domain/claims";
import { buildDemandIntensityInference, buildDemandSignalClaims, type DemandSignalClaimSource } from "../../server/claims/builders/demand-signal-claim-builder";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresClaimRepository } from "../../server/repositories/claims/postgres-claim-repository";
import { ClaimService } from "../../server/services/claims/claim-service";

const now = new Date("2026-08-17T12:00:00Z");
const migrations = [
  "20260817010000_canonical_model.sql",
  "20260817020000_evidence_provenance.sql",
  "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql",
  "20260817050000_claim_assertions.sql",
];

describe("claims and assertions", () => {
  let db: PGlite;
  let repository: PostgresClaimRepository;
  let evidenceRepository: PostgresEvidenceRepository;
  let service: ClaimService;
  let sequence = 0;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) {
      await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    }
    const client = db as unknown as SqlClient;
    repository = new PostgresClaimRepository(client);
    evidenceRepository = new PostgresEvidenceRepository(client);
    service = new ClaimService(repository, evidenceRepository, () => now);
  });

  afterAll(async () => db.close());

  async function context(overrides: Partial<DemandSignalClaimSource> = {}) {
    sequence += 1;
    const source = await db.query<{ id: string }>(
      "insert into sources (name, access_classification) values ($1, 'PUBLIC') returning id",
      [`Claim source ${sequence}`],
    );
    const sourceId = source.rows[0].id;
    const evidence = await evidenceRepository.create({
      sourceId, sourceUrl: `https://fixtures.example/claims/${sequence}`,
      capturedAt: now, captureMethod: "HTTP_FETCH",
      contentHash: createHash("sha256").update(`evidence-${sequence}`).digest("hex"),
      payloadSizeBytes: 20, contentType: "text/plain", extractorVersion: "claim-test@1",
    });
    const signal = await db.query<{ id: string }>(
      `insert into demand_signals (
         title, original_title, role_type, source_id, raw_evidence_id,
         first_seen_at, last_seen_at, source_identity_key, parser_version
       ) values ($1, $1, 'JOURNEYMAN_ELECTRICIAN', $2, $3, $4, $4, $5, 'fixture@1') returning id`,
      ["Journeyman Electrician", sourceId, evidence.id, now.toISOString(), `external:claim-${sequence}`],
    );
    return {
      id: signal.rows[0].id, rawEvidenceId: evidence.id,
      roleType: "JOURNEYMAN_ELECTRICIAN", originalTitle: "Journeyman Electrician",
      unresolvedPublisherName: "Publisher text only", city: "Houston", county: "Harris",
      state: "TX", payCurrency: "USD", basePayMin: 40, basePayMax: 45,
      payPeriod: "HOUR", overtimeAvailable: true, overtimeTerms: "OT after 40 hours",
      perDiemAvailable: true, perDiemAmount: 120, perDiemFrequency: "DAY",
      schedule: "6x10", headcountEstimate: 12, publishedAt: new Date("2026-08-15T00:00:00Z"),
      ...overrides,
    } satisfies DemandSignalClaimSource;
  }

  function candidate(source: DemandSignalClaimSource, overrides: Partial<ClaimCandidate> = {}): ClaimCandidate {
    return {
      subject: { type: "DEMAND_SIGNAL", id: source.id }, predicate: "compensation",
      value: { minimum: 40, maximum: 45, currency: "USD", period: "HOUR" },
      assertionKind: "FACT", evidenceIds: [source.rawEvidenceId], ...overrides,
    };
  }

  async function secondEvidence(source: DemandSignalClaimSource) {
    sequence += 1;
    const sourceRow = await db.query<{ source_id: string }>("select source_id from demand_signals where id = $1", [source.id]);
    return evidenceRepository.create({
      sourceId: sourceRow.rows[0].source_id, sourceUrl: `https://fixtures.example/claims/recapture/${sequence}`,
      capturedAt: new Date("2026-08-18T12:00:00Z"), captureMethod: "HTTP_FETCH",
      contentHash: createHash("sha256").update(`recapture-${sequence}`).digest("hex"),
      payloadSizeBytes: 30,
    });
  }

  it("keeps FACT and VERIFIED as independent dimensions", async () => {
    const source = await context();
    const claim = await service.create(candidate(source));
    expect(claim).toMatchObject({ assertionKind: "FACT", verificationState: "UNVERIFIED" });
    const verified = await service.transition({
      claimId: claim.id, newState: "VERIFIED", actor: "human:reviewer",
      reason: "Compared to captured posting", evidenceId: source.rawEvidenceId,
    });
    expect(verified).toMatchObject({ assertionKind: "FACT", verificationState: "VERIFIED" });
  });

  it("never silently promotes an INFERENCE to FACT", async () => {
    const source = await context();
    const inference = await service.create(buildDemandIntensityInference(source.id, [source.rawEvidenceId], 3));
    const verified = await service.transition({
      claimId: inference.id, newState: "VERIFIED", actor: "human:reviewer",
      reason: "Reviewed inference provenance", evidenceId: source.rawEvidenceId,
    });
    expect(verified).toMatchObject({ assertionKind: "INFERENCE", verificationState: "VERIFIED" });
    await expect(db.query("update claims set assertion_kind = 'FACT' where id = $1", [inference.id])).rejects.toThrow(/immutable/);
  });

  it("represents UNKNOWN independently and does not fabricate a company", async () => {
    const source = await context({ unresolvedPublisherName: null });
    const publisher = buildDemandSignalClaims(source).find((item) => item.predicate === "publisher_identity_text")!;
    const claim = await service.create(publisher);
    expect(claim).toMatchObject({ assertionKind: "UNKNOWN", value: null, verificationState: "UNVERIFIED" });
    expect(claim.subject.type).toBe("DEMAND_SIGNAL");
    const companies = await db.query<{ count: string }>("select count(*)::text as count from companies");
    expect(companies.rows[0].count).toBe("0");
  });

  it("defaults all automated claim creation to UNVERIFIED", async () => {
    const source = await context();
    const claims = await Promise.all(buildDemandSignalClaims(source).map((item) => service.create(item)));
    expect(new Set(claims.map((claim) => claim.verificationState))).toEqual(new Set(["UNVERIFIED"]));
  });

  it("rejects VERIFIED transition without explicit supporting evidence", async () => {
    const source = await context();
    const claim = await service.create(candidate(source, { evidenceIds: [] }));
    await expect(service.transition({
      claimId: claim.id, newState: "VERIFIED", actor: "human:reviewer", reason: "Unsupported",
    })).rejects.toThrow(/require explicit supporting evidence/);
  });

  it("rejects verification using evidence that does not support the claim", async () => {
    const source = await context();
    const unrelated = await context();
    const claim = await service.create(candidate(source));
    await expect(service.transition({
      claimId: claim.id, newState: "VERIFIED", actor: "human:reviewer",
      reason: "Wrong evidence", evidenceId: unrelated.rawEvidenceId,
    })).rejects.toThrow(/must already support/);
  });

  it("lets one logical claim accumulate multiple provenance records", async () => {
    const source = await context();
    const first = await service.create(candidate(source));
    const recapture = await secondEvidence(source);
    const repeated = await service.create(candidate(source, { evidenceIds: [recapture.id] }));
    expect(repeated.id).toBe(first.id);
    expect(await repository.hasEvidence(first.id, source.rawEvidenceId)).toBe(true);
    expect(await repository.hasEvidence(first.id, recapture.id)).toBe(true);
  });

  it("does not create uncontrolled duplicates from repeated ingestion", async () => {
    const source = await context();
    const first = await service.create(candidate(source));
    const second = await service.create(candidate(source));
    expect(second.id).toBe(first.id);
    const count = await db.query<{ count: string }>("select count(*)::text as count from claims where demand_signal_id = $1", [source.id]);
    expect(count.rows[0].count).toBe("1");
  });

  it("keeps conflicting values as separate claims", async () => {
    const source = await context();
    const fortyTwo = await service.create(candidate(source, { value: { rate: 42, currency: "USD" } }));
    const fortyFive = await service.create(candidate(source, { value: { rate: 45, currency: "USD" } }));
    expect(fortyFive.id).not.toBe(fortyTwo.id);
  });

  it("retains rejected claims and audits the state transition", async () => {
    const source = await context();
    const claim = await service.create(candidate(source));
    await service.transition({
      claimId: claim.id, newState: "REJECTED", actor: "human:reviewer",
      reason: "Source text was misread",
    });
    await expect(repository.getById(claim.id)).resolves.toMatchObject({ verificationState: "REJECTED" });
    await expect(repository.listTransitions(claim.id)).resolves.toEqual([
      expect.objectContaining({ priorState: "UNVERIFIED", newState: "REJECTED", actor: "human:reviewer" }),
    ]);
  });

  it("retains stale claims while excluding them from current results", async () => {
    const source = await context();
    const claim = await service.create(candidate(source, { staleAfter: new Date("2026-08-16T00:00:00Z") }));
    expect(await repository.listBySubject(claim.subject, now)).toHaveLength(0);
    await service.markStale(now);
    await expect(repository.getById(claim.id)).resolves.toMatchObject({ verificationState: "STALE" });
    await expect(repository.listTransitions(claim.id)).resolves.toEqual([
      expect.objectContaining({ priorState: "UNVERIFIED", newState: "STALE", actor: "system:staleness-policy" }),
    ]);
  });

  it("keeps transition audit rows append-only", async () => {
    const source = await context();
    const claim = await service.create(candidate(source));
    await service.transition({ claimId: claim.id, newState: "REJECTED", actor: "human:a", reason: "Invalid" });
    await expect(db.query("delete from claim_state_transitions where claim_id = $1", [claim.id])).rejects.toThrow(/append-only/);
  });

  it("represents every AF-01 category without deriving acceptance", async () => {
    const source = await context();
    const claims = await Promise.all(EXTERNAL_MANPOWER_CATEGORIES.map((category) => service.create(candidate(source, {
      predicate: "external_manpower_acceptance_category", value: category,
      externalManpowerCategory: category, assertionKind: "UNKNOWN",
    }))));
    expect(claims.map((claim) => claim.externalManpowerCategory)).toEqual(EXTERNAL_MANPOWER_CATEGORIES);
    expect(claims.every((claim) => claim.verificationState === "UNVERIFIED")).toBe(true);
  });

  it("builds explicit demand fields as FACT candidates with evidence", () => {
    const source: DemandSignalClaimSource = {
      id: "00000000-0000-0000-0000-000000000001",
      rawEvidenceId: "00000000-0000-0000-0000-000000000002",
      roleType: "JOURNEYMAN_ELECTRICIAN", originalTitle: "Journeyman Electrician",
      unresolvedPublisherName: "Publisher text", city: "Houston", county: null, state: "TX",
      payCurrency: "USD", basePayMin: 42, basePayMax: 42, payPeriod: "HOUR",
      overtimeAvailable: null, overtimeTerms: null, perDiemAvailable: null,
      perDiemAmount: null, perDiemFrequency: null, schedule: null,
      headcountEstimate: null, publishedAt: null,
    };
    const claims = buildDemandSignalClaims(source);
    expect(claims.find((claim) => claim.predicate === "compensation")).toMatchObject({
      assertionKind: "FACT", evidenceIds: [source.rawEvidenceId], value: { minimum: 42 },
    });
    expect(claims.every((claim) => claim.assertionKind === "FACT")).toBe(true);
  });

  it("labels demand-intensity language as INFERENCE and exposes no Phase 1G+ service", () => {
    const inference = buildDemandIntensityInference("signal-id", ["evidence-id"], 4);
    expect(inference).toMatchObject({ assertionKind: "INFERENCE", predicate: "demand_intensity_indicator" });
    expect(Object.getOwnPropertyNames(ClaimService.prototype)).toEqual(["constructor", "create", "transition", "markStale"]);
  });
});
