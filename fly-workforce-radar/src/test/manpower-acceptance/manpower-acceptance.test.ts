import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClaimCandidate } from "../../domain/claims";
import type { ExternalManpowerCategory } from "../../domain/database";
import { MANPOWER_ACCEPTANCE_RULE_VERSION } from "../../domain/manpower-acceptance";
import { buildManpowerAcceptanceClaims } from "../../server/claims/builders/manpower-acceptance-claim-builder";
import { PostgresClaimRepository } from "../../server/repositories/claims/postgres-claim-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresManpowerAcceptanceRepository } from "../../server/repositories/manpower-acceptance/postgres-manpower-acceptance-repository";
import { ClaimService } from "../../server/services/claims/claim-service";
import { ManpowerAcceptanceService } from "../../server/services/manpower-acceptance/manpower-acceptance-service";

const now = new Date("2026-08-17T12:00:00Z");
const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql",
  "20260817030000_source_registry_compliance.sql", "20260817040000_controlled_ingestion.sql",
  "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql",
];

describe("vendor and external manpower acceptance", () => {
  let db: PGlite;
  let evidenceRepository: PostgresEvidenceRepository;
  let claimService: ClaimService;
  let repository: PostgresManpowerAcceptanceRepository;
  let service: ManpowerAcceptanceService;
  let sequence = 0;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    const client = db as unknown as SqlClient;
    evidenceRepository = new PostgresEvidenceRepository(client);
    claimService = new ClaimService(new PostgresClaimRepository(client), evidenceRepository, () => now);
    repository = new PostgresManpowerAcceptanceRepository(client);
    service = new ManpowerAcceptanceService(repository, () => now);
  });
  afterAll(async () => db.close());

  async function context() {
    sequence += 1;
    const source = await db.query<{ id: string }>("insert into sources (name) values ($1) returning id", [`AF source ${sequence}`]);
    const evidence = await evidenceRepository.create({
      sourceId: source.rows[0].id, sourceUrl: `https://fixtures.example/af/${sequence}`,
      capturedAt: now, captureMethod: "HTTP_FETCH", payloadSizeBytes: 10,
      contentHash: createHash("sha256").update(`af-${sequence}`).digest("hex"),
    });
    const company = await db.query<{ id: string }>("insert into companies (common_name) values ($1) returning id", [`AF Company ${sequence}`]);
    const signal = await db.query<{ id: string }>("insert into demand_signals (title, source_id, raw_evidence_id, source_identity_key) values ('Electrician', $1, $2, $3) returning id", [source.rows[0].id, evidence.id, `external:af-${sequence}`]);
    return { companyId: company.rows[0].id, evidenceId: evidence.id, signalId: signal.rows[0].id };
  }

  function afCandidate(companyId: string, evidenceId: string, category: ExternalManpowerCategory = "STAFFING_VENDOR_ACCEPTED", overrides: Partial<ClaimCandidate> = {}): ClaimCandidate {
    return { subject: { type: "COMPANY", id: companyId }, predicate: "external_manpower_acceptance_category", externalManpowerCategory: category, value: { accepted: true }, assertionKind: "FACT", evidenceIds: [evidenceId], ...overrides };
  }

  async function verified(candidate: ClaimCandidate) {
    const claim = await claimService.create(candidate);
    await claimService.transition({ claimId: claim.id, newState: "VERIFIED", actor: "human:reviewer", reason: "Explicit source language verified", evidenceId: candidate.evidenceIds![0] });
    return claim;
  }

  it("does not infer acceptance from EMPLOYER status", async () => {
    const ctx = await context();
    await db.query("insert into company_roles (company_id, role, demand_signal_id, raw_evidence_id) values ($1, 'EMPLOYER', $2, $3)", [ctx.companyId, ctx.signalId, ctx.evidenceId]);
    await expect(service.evaluate(ctx.companyId)).resolves.toMatchObject({ result: "NOT_VERIFIED", supportingClaimIds: [] });
  });

  it("does not infer acceptance from a job posting", async () => {
    const ctx = await context();
    await expect(service.evaluate(ctx.companyId)).resolves.toMatchObject({ result: "NOT_VERIFIED", reason: expect.stringContaining("not denial") });
  });

  it("keeps supplier portal existence separate from acceptance", async () => {
    const ctx = await context();
    const route = await db.query<{ id: string }>("insert into vendor_routes (company_id, route_type, target) values ($1, 'SUPPLIER_PORTAL', 'https://portal.example') returning id", [ctx.companyId]);
    await claimService.create({ subject: { type: "VENDOR_ROUTE", id: route.rows[0].id }, predicate: "vendor_route", value: { routeType: "SUPPLIER_PORTAL" }, assertionKind: "FACT", evidenceIds: [ctx.evidenceId] });
    await expect(service.evaluate(ctx.companyId)).resolves.toMatchObject({ result: "NOT_VERIFIED" });
  });

  it("derives VERIFIED only from a verified AF-01 FACT with active evidence", async () => {
    const ctx = await context();
    const claim = await verified(afCandidate(ctx.companyId, ctx.evidenceId));
    const result = await service.evaluate(ctx.companyId);
    expect(result).toMatchObject({ result: "VERIFIED", supportingClaimIds: [claim.id], supportingEvidenceIds: [ctx.evidenceId], qualifyingCategories: ["STAFFING_VENDOR_ACCEPTED"] });
  });

  it("does not qualify an UNVERIFIED AF-01 claim", async () => {
    const ctx = await context();
    const claim = await claimService.create(afCandidate(ctx.companyId, ctx.evidenceId));
    const result = await service.evaluate(ctx.companyId);
    expect(result).toMatchObject({ result: "INSUFFICIENT_EVIDENCE", supportingClaimIds: [], ignoredClaimIds: [claim.id] });
  });

  it("does not silently qualify a VERIFIED INFERENCE", async () => {
    const ctx = await context();
    const claim = await verified(afCandidate(ctx.companyId, ctx.evidenceId, "CONTINGENT_WORKFORCE_ACCEPTED", { assertionKind: "INFERENCE" }));
    const result = await service.evaluate(ctx.companyId);
    expect(result).toMatchObject({ result: "INSUFFICIENT_EVIDENCE", ignoredClaimIds: [claim.id] });
  });

  it("returns STALE when all otherwise qualifying positive claims expired", async () => {
    const ctx = await context();
    const claim = await verified(afCandidate(ctx.companyId, ctx.evidenceId, "STAFFING_VENDOR_ACCEPTED", { staleAfter: new Date("2026-08-16T00:00:00Z") }));
    const result = await service.evaluate(ctx.companyId);
    expect(result).toMatchObject({ result: "STALE", supportingClaimIds: [], ignoredClaimIds: [claim.id] });
  });

  it("does not qualify REJECTED claims", async () => {
    const ctx = await context();
    const claim = await claimService.create(afCandidate(ctx.companyId, ctx.evidenceId));
    await claimService.transition({ claimId: claim.id, newState: "REJECTED", actor: "human:reviewer", reason: "Language did not support acceptance" });
    await expect(service.evaluate(ctx.companyId)).resolves.toMatchObject({ result: "INSUFFICIENT_EVIDENCE", ignoredClaimIds: [claim.id] });
  });

  it("retains multiple verified AF-01 categories and their explanation", async () => {
    const ctx = await context();
    const staffing = await verified(afCandidate(ctx.companyId, ctx.evidenceId));
    const recruiters = await verified(afCandidate(ctx.companyId, ctx.evidenceId, "THIRD_PARTY_RECRUITING_ACCEPTED"));
    const result = await service.evaluate(ctx.companyId);
    expect(new Set(result.qualifyingCategories)).toEqual(new Set(["STAFFING_VENDOR_ACCEPTED", "THIRD_PARTY_RECRUITING_ACCEPTED"]));
    expect(new Set(result.supportingClaimIds)).toEqual(new Set([staffing.id, recruiters.id]));
  });

  it("returns insufficient evidence for conflicting current verified statements", async () => {
    const ctx = await context();
    const positive = await verified(afCandidate(ctx.companyId, ctx.evidenceId));
    const negative = await verified(afCandidate(ctx.companyId, ctx.evidenceId, "STAFFING_VENDOR_ACCEPTED", { value: { accepted: false, text: "No agencies accepted" } }));
    const result = await service.evaluate(ctx.companyId);
    expect(result).toMatchObject({ result: "INSUFFICIENT_EVIDENCE", supportingClaimIds: [] });
    expect(result.explanation).toMatchObject({ qualifyingPositiveClaims: [positive.id], conflictingNegativeClaims: [negative.id] });
  });

  it("preserves historical evaluation snapshots and rule versions", async () => {
    const ctx = await context();
    await service.evaluate(ctx.companyId);
    const claim = await verified(afCandidate(ctx.companyId, ctx.evidenceId));
    await service.evaluate(ctx.companyId);
    const history = await repository.listEvaluations(ctx.companyId);
    expect(history.map((item) => item.result)).toEqual(["NOT_VERIFIED", "VERIFIED"]);
    expect(history.every((item) => item.ruleVersion === MANPOWER_ACCEPTANCE_RULE_VERSION)).toBe(true);
    await expect(db.query("delete from manpower_acceptance_evaluations where company_id = $1", [ctx.companyId])).rejects.toThrow(/append-only/);
    expect(claim.id).toBeTruthy();
  });

  it("explicit third-party recruiter language generates an unverified AF-01 FACT", async () => {
    const ctx = await context();
    const candidates = buildManpowerAcceptanceClaims({ companyId: ctx.companyId, evidenceId: ctx.evidenceId, text: "Third-party recruiters may submit candidates through our approved channel." });
    expect(candidates).toEqual([expect.objectContaining({ externalManpowerCategory: "THIRD_PARTY_RECRUITING_ACCEPTED", assertionKind: "FACT", value: expect.objectContaining({ accepted: true }) })]);
    const claim = await claimService.create(candidates[0]);
    expect(claim.verificationState).toBe("UNVERIFIED");
  });

  it("generic supplier language creates no AF-01 acceptance claim", async () => {
    const ctx = await context();
    expect(buildManpowerAcceptanceClaims({ companyId: ctx.companyId, evidenceId: ctx.evidenceId, text: "Become a supplier through our registration portal." })).toEqual([]);
  });

  it("builds explicit rejection as conflicting FACT rather than silently discarding it", async () => {
    const ctx = await context();
    const candidates = buildManpowerAcceptanceClaims({ companyId: ctx.companyId, evidenceId: ctx.evidenceId, text: "No agencies accepted." });
    expect(candidates[0]).toMatchObject({ assertionKind: "FACT", externalManpowerCategory: "STAFFING_VENDOR_ACCEPTED", value: { accepted: false } });
  });

  it("does not assign MANPOWER_BUYER from verified acceptance", async () => {
    const ctx = await context();
    await verified(afCandidate(ctx.companyId, ctx.evidenceId));
    await expect(service.evaluate(ctx.companyId)).resolves.toMatchObject({ result: "VERIFIED" });
    const roles = await db.query<{ count: string }>("select count(*)::text as count from company_roles where company_id = $1 and role = 'MANPOWER_BUYER'", [ctx.companyId]);
    expect(roles.rows[0].count).toBe("0");
  });

  it("exposes no Phase 1I+ contact, scoring, or opportunity operations", () => {
    expect(Object.getOwnPropertyNames(ManpowerAcceptanceService.prototype)).toEqual(["constructor", "evaluate"]);
  });
});
