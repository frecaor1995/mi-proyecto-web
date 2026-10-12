import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresClaimRepository } from "../../server/repositories/claims/postgres-claim-repository";
import { PostgresCompanyRepository } from "../../server/repositories/company/postgres-company-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";
import { ClaimService } from "../../server/services/claims/claim-service";
import { isUnresolvedPlaceholder, normalizeCompanyName } from "../../server/services/company/company-name-normalization";
import { CompanyResolutionService } from "../../server/services/company/company-resolution-service";

const now = new Date("2026-08-17T12:00:00Z");
const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql",
  "20260817030000_source_registry_compliance.sql", "20260817040000_controlled_ingestion.sql",
  "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
];

describe("company and contextual role resolution", () => {
  let db: PGlite;
  let repository: PostgresCompanyRepository;
  let evidenceRepository: PostgresEvidenceRepository;
  let service: CompanyResolutionService;
  let claimService: ClaimService;
  let sequence = 0;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    const client = db as unknown as SqlClient;
    repository = new PostgresCompanyRepository(client);
    evidenceRepository = new PostgresEvidenceRepository(client);
    service = new CompanyResolutionService(repository, () => now);
    claimService = new ClaimService(new PostgresClaimRepository(client), evidenceRepository, () => now);
  });
  afterAll(async () => db.close());

  async function context() {
    sequence += 1;
    const source = await db.query<{ id: string }>("insert into sources (name) values ($1) returning id", [`Company test ${sequence}`]);
    const evidence = await evidenceRepository.create({
      sourceId: source.rows[0].id, sourceUrl: `https://fixtures.example/company/${sequence}`,
      capturedAt: now, captureMethod: "HTTP_FETCH", payloadSizeBytes: 10,
      contentHash: createHash("sha256").update(`company-${sequence}`).digest("hex"),
    });
    const signal = await db.query<{ id: string }>(`insert into demand_signals (title, source_id, raw_evidence_id, source_identity_key) values ('Electrician', $1, $2, $3) returning id`, [source.rows[0].id, evidence.id, `external:company-${sequence}`]);
    return { sourceId: source.rows[0].id, evidenceId: evidence.id, signalId: signal.rows[0].id };
  }

  async function company(name: string) {
    return repository.createCompany({ commonName: name, normalized: normalizeCompanyName(name), observedAt: now });
  }

  it("resolves exact company names deterministically across safe normalization", async () => {
    const canonical = await company("PCL Industrial Services, LLC");
    const resolution = await service.resolve({ observedText: "  pcl industrial services llc.  " });
    expect(resolution).toMatchObject({ result: "RESOLVED_EXACT", method: "NORMALIZED_NAME", companyId: canonical.id });
  });

  it("resolves a verified alias to its canonical company", async () => {
    const canonical = await company("Turner Construction Company");
    const ctx = await context();
    await repository.createAlias({ companyId: canonical.id, alias: "Turner Const.", normalizedAlias: normalizeCompanyName("Turner Const."), verificationState: "VERIFIED", evidenceId: ctx.evidenceId, actor: "human:resolver", at: now, reason: "Verified corporate alias" });
    await expect(service.resolve({ observedText: "TURNER CONST" })).resolves.toMatchObject({ result: "RESOLVED_ALIAS", companyId: canonical.id });
  });

  it("keeps duplicate normalized canonical names ambiguous", async () => {
    const first = await company("National Electric LLC");
    const second = await company("National Electric Inc.");
    const resolution = await service.resolve({ observedText: "National Electric" });
    expect(resolution.result).toBe("AMBIGUOUS");
    expect(resolution.companyId).toBeNull();
    expect(new Set(resolution.candidateCompanyIds)).toEqual(new Set([first.id, second.id]));
  });

  it("keeps unknown and undisclosed publishers unresolved without fake companies", async () => {
    const before = await db.query<{ count: string }>("select count(*)::text as count from companies");
    expect(isUnresolvedPlaceholder("Confidential Client")).toBe(true);
    await expect(service.resolve({ observedText: "Confidential Client" })).resolves.toMatchObject({ result: "UNRESOLVED", method: "PLACEHOLDER_REJECTED", companyId: null });
    await expect(service.createCanonical("Client undisclosed", (await context()).evidenceId, "human:resolver")).rejects.toThrow(/placeholder/);
    const after = await db.query<{ count: string }>("select count(*)::text as count from companies");
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("does not fuzzy-merge similar company names", async () => {
    await company("Alpha Electric North");
    await company("Alpha Electric South");
    await expect(service.resolve({ observedText: "Alpha Electric" })).resolves.toMatchObject({ result: "UNRESOLVED", companyId: null });
  });

  it("assigns EMPLOYER only from explicit employer representation", async () => {
    const canonical = await company("Explicit Employer LLC");
    const ctx = await context();
    await expect(service.assignRole({ companyId: canonical.id, role: "EMPLOYER", context: { type: "DEMAND_SIGNAL", id: ctx.signalId }, evidenceId: ctx.evidenceId, assertionKind: "FACT", basis: "JOB_PUBLISHER_ONLY", actor: "system:test", observedAt: now })).rejects.toThrow(/cannot establish/);
    const assigned = await service.assignRole({ companyId: canonical.id, role: "EMPLOYER", context: { type: "DEMAND_SIGNAL", id: ctx.signalId }, evidenceId: ctx.evidenceId, assertionKind: "FACT", basis: "EXPLICIT_EMPLOYER", actor: "system:test", observedAt: now });
    expect(assigned).toMatchObject({ role: "EMPLOYER", verificationState: "UNVERIFIED" });
  });

  it("never implies MANPOWER_BUYER from an EMPLOYER role", async () => {
    const canonical = await company("Hiring Company LLC");
    const ctx = await context();
    await service.assignRole({ companyId: canonical.id, role: "EMPLOYER", context: { type: "DEMAND_SIGNAL", id: ctx.signalId }, evidenceId: ctx.evidenceId, assertionKind: "FACT", basis: "EXPLICIT_EMPLOYER", actor: "system:test", observedAt: now });
    expect((await repository.listRoles(canonical.id)).map((item) => item.role)).toEqual(["EMPLOYER"]);
  });

  it("does not derive MANPOWER_BUYER from a supplier portal", async () => {
    const canonical = await company("Portal Owner LLC");
    const ctx = await context();
    await expect(service.assignRole({ companyId: canonical.id, role: "MANPOWER_BUYER", context: { type: "DEMAND_SIGNAL", id: ctx.signalId }, evidenceId: ctx.evidenceId, assertionKind: "INFERENCE", basis: "SUPPLIER_PORTAL_ONLY", actor: "system:test", observedAt: now })).rejects.toThrow(/cannot establish/);
  });

  it("allows an explicit staffing publisher while its client remains unknown", async () => {
    const staffing = await company("Trades Staffing LLC");
    const ctx = await context();
    const assigned = await service.assignRole({ companyId: staffing.id, role: "STAFFING_SUPPLIER", context: { type: "DEMAND_SIGNAL", id: ctx.signalId }, evidenceId: ctx.evidenceId, assertionKind: "FACT", basis: "EXPLICIT_STAFFING_PUBLISHER", actor: "system:test", observedAt: now, metadata: { client: "UNKNOWN" } });
    expect(assigned.role).toBe("STAFFING_SUPPLIER");
    const fakeClient = await db.query<{ count: string }>("select count(*)::text as count from companies where common_name ilike '%unknown%' or common_name ilike '%undisclosed%'");
    expect(fakeClient.rows[0].count).toBe("0");
  });

  it("represents multiple roles and keeps different contexts distinct", async () => {
    const canonical = await company("Multi Role Corporation");
    const first = await context();
    const second = await context();
    await service.assignRole({ companyId: canonical.id, role: "EMPLOYER", context: { type: "DEMAND_SIGNAL", id: first.signalId }, evidenceId: first.evidenceId, assertionKind: "FACT", basis: "EXPLICIT_EMPLOYER", actor: "system:test", observedAt: now });
    await service.assignRole({ companyId: canonical.id, role: "EPC", context: { type: "DEMAND_SIGNAL", id: first.signalId }, evidenceId: first.evidenceId, assertionKind: "FACT", basis: "EXPLICIT_CONTEXTUAL_ROLE", actor: "system:test", observedAt: now });
    await service.assignRole({ companyId: canonical.id, role: "EMPLOYER", context: { type: "DEMAND_SIGNAL", id: second.signalId }, evidenceId: second.evidenceId, assertionKind: "FACT", basis: "EXPLICIT_EMPLOYER", actor: "system:test", observedAt: now });
    const roles = await repository.listRoles(canonical.id);
    expect(roles).toHaveLength(3);
    expect(new Set(roles.map((item) => item.role))).toEqual(new Set(["EMPLOYER", "EPC"]));
  });

  it("preserves alias history during manual reassignment", async () => {
    const oldCompany = await company("Old Canonical LLC");
    const newCompany = await company("New Canonical LLC");
    const ctx = await context();
    const oldAlias = await repository.createAlias({ companyId: oldCompany.id, alias: "Shared Alias", normalizedAlias: normalizeCompanyName("Shared Alias"), verificationState: "VERIFIED", evidenceId: ctx.evidenceId, actor: "human:a", at: now, reason: "Initial assignment" });
    const reassigned = await repository.reassignAlias({ aliasId: oldAlias.id, newCompanyId: newCompany.id, actor: "human:b", at: new Date("2026-08-18T00:00:00Z"), evidenceId: ctx.evidenceId, reason: "Correction" });
    expect(reassigned.id).not.toBe(oldAlias.id);
    const rows = await db.query<{ count: string; superseded: string }>("select count(*)::text as count, count(superseded_by_alias_id)::text as superseded from company_aliases where normalized_alias = $1", [normalizeCompanyName("Shared Alias")]);
    expect(rows.rows[0]).toEqual({ count: "2", superseded: "1" });
  });

  it("audits manual override and non-destructive merge decisions", async () => {
    const source = await company("Merge Source LLC");
    const target = await company("Merge Target LLC");
    const ctx = await context();
    const unresolved = await service.resolve({ observedText: "Special Trade Name", evidenceId: ctx.evidenceId });
    await service.manualOverride({ observedText: "Special Trade Name", companyId: target.id, reason: "Corporate registration reviewed", evidenceId: ctx.evidenceId, supersedesResolutionId: unresolved.id });
    await repository.merge({ sourceCompanyId: source.id, targetCompanyId: target.id, actor: "human:resolver", at: now, evidenceId: ctx.evidenceId, reason: "Approved legal merge" });
    const audit = await db.query<{ overrides: string; merges: string; source_exists: string }>(`select (select count(*) from company_resolution_audits where method = 'MANUAL_OVERRIDE')::text as overrides, (select count(*) from company_merge_decisions where source_company_id = $1)::text as merges, (select count(*) from companies where id = $1 and merged_into_company_id = $2)::text as source_exists`, [source.id, target.id]);
    expect(audit.rows[0]).toEqual({ overrides: "1", merges: "1", source_exists: "1" });
  });

  it("does not collapse conflicting verified alias candidates", async () => {
    const first = await company("Alias Candidate One LLC");
    const second = await company("Alias Candidate Two LLC");
    const ctx = await context();
    for (const companyId of [first.id, second.id]) await repository.createAlias({ companyId, alias: "ACE Services", normalizedAlias: normalizeCompanyName("ACE Services"), verificationState: "VERIFIED", evidenceId: ctx.evidenceId, actor: "human:test", at: now, reason: "Conflicting source records" });
    const result = await service.resolve({ observedText: "ACE Services" });
    expect(result).toMatchObject({ result: "AMBIGUOUS", companyId: null });
    expect(result.candidateCompanyIds).toHaveLength(2);
  });

  it("links every company role to evidence provenance", async () => {
    const canonical = await company("Evidence Employer LLC");
    const ctx = await context();
    const assigned = await service.assignRole({ companyId: canonical.id, role: "EMPLOYER", context: { type: "DEMAND_SIGNAL", id: ctx.signalId }, evidenceId: ctx.evidenceId, assertionKind: "FACT", basis: "EXPLICIT_EMPLOYER", actor: "system:test", observedAt: now });
    await expect(evidenceRepository.listLinksByEvidence(ctx.evidenceId)).resolves.toContainEqual(expect.objectContaining({ linkType: "SUPPORTS", target: { kind: "COMPANY_ROLE", id: assigned.id } }));
  });

  it("consumes publisher claims without rewriting them and exposes no Phase 1H logic", async () => {
    const canonical = await company("Publisher Claim Company LLC");
    const ctx = await context();
    const claim = await claimService.create({ subject: { type: "DEMAND_SIGNAL", id: ctx.signalId }, predicate: "publisher_identity_text", value: "Publisher Claim Company", assertionKind: "FACT", evidenceIds: [ctx.evidenceId] });
    await expect(service.resolvePublisherClaim(claim, ctx.evidenceId)).resolves.toMatchObject({ result: "RESOLVED_EXACT", companyId: canonical.id, claimId: claim.id });
    await expect(db.query("update claims set claim_value = '\"Changed\"'::jsonb where id = $1", [claim.id])).rejects.toThrow(/immutable/);
    expect(Object.getOwnPropertyNames(CompanyResolutionService.prototype)).toEqual(["constructor", "resolve", "resolvePublisherClaim", "createCanonical", "manualOverride", "assignRole", "ambiguous"]);
  });
});
