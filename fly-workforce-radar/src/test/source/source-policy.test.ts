import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_METHODS,
  SOURCE_HEALTH_STATUSES,
  SOURCE_TYPES,
  type CreateSourceInput,
  type RecordCapturePolicyDecisionInput,
} from "../../domain/source";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresSourceRepository } from "../../server/repositories/source/postgres-source-repository";
import { SourcePolicyService } from "../../server/services/source/source-policy-service";

const now = new Date("2026-08-17T12:00:00Z");
const migrations = [
  "20260817010000_canonical_model.sql",
  "20260817020000_evidence_provenance.sql",
  "20260817030000_source_registry_compliance.sql",
];

describe("source registry and compliance", () => {
  let db: PGlite;
  let repository: PostgresSourceRepository;
  let service: SourcePolicyService;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) {
      const sql = await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8");
      await db.exec(sql);
    }
    repository = new PostgresSourceRepository(db as unknown as SqlClient);
    service = new SourcePolicyService(repository);
  });

  afterAll(async () => {
    await db.close();
  });

  async function createSource(overrides: Partial<CreateSourceInput> = {}) {
    return repository.create({
      name: `Source ${crypto.randomUUID()}`,
      sourceType: "JOB_BOARD",
      accessClassification: "PUBLIC",
      enabled: true,
      paywalled: false,
      robotsReviewStatus: "APPROVED",
      tosReviewStatus: "APPROVED",
      lastComplianceReviewAt: new Date("2026-08-01T00:00:00Z"),
      nextComplianceReviewDueAt: new Date("2026-09-01T00:00:00Z"),
      ...overrides,
    });
  }

  async function decide(
    sourceId: string,
    overrides: Partial<RecordCapturePolicyDecisionInput> = {},
  ) {
    return repository.recordDecision({
      sourceId,
      captureMethod: "HTTP_FETCH",
      decision: "ALLOWED",
      reason: "Reviewed and authorized",
      reviewedAt: new Date("2026-08-10T00:00:00Z"),
      reviewedBy: "reviewer:test",
      validUntil: new Date("2026-09-10T00:00:00Z"),
      policyVersion: "policy-1",
      ...overrides,
    });
  }

  it("keeps the required source taxonomy explicit but extensible", async () => {
    expect(SOURCE_TYPES).toEqual([
      "JOB_BOARD",
      "CORPORATE_CAREERS",
      "STAFFING_BOARD",
      "SUPPLIER_PORTAL",
      "CORPORATE_WEBSITE",
      "NEWS_PRESS",
      "PUBLIC_RECORD",
      "PUBLIC_SOCIAL",
      "SEARCH_RESULT",
      "OTHER",
    ]);
    expect(CAPTURE_METHODS).toContain("HTTP_FETCH");
    expect(CAPTURE_METHODS).toContain("HEADLESS_RENDER");

    await db.query("insert into source_types (code) values ('REGIONAL_PERMIT_FEED')");
    await expect(
      createSource({ sourceType: "REGIONAL_PERMIT_FEED" }),
    ).resolves.toMatchObject({ sourceType: "REGIONAL_PERMIT_FEED" });
  });

  it("does not infer HTTP authorization from PUBLIC access", async () => {
    const source = await createSource();
    await expect(service.evaluate(source.id, "HTTP_FETCH", now)).resolves.toMatchObject({
      result: "REVIEW_REQUIRED",
      technicalAccess: "ACCESSIBLE",
    });
  });

  it("denies disabled sources before considering an allow decision", async () => {
    const source = await createSource({ enabled: false });
    await decide(source.id);
    await expect(service.evaluate(source.id, "HTTP_FETCH", now)).resolves.toMatchObject({
      result: "DENY",
      reason: "Source is disabled",
    });
  });

  it("allows only an explicit current approval with current compliance", async () => {
    const source = await createSource();
    const decision = await decide(source.id);
    await expect(service.evaluate(source.id, "HTTP_FETCH", now)).resolves.toMatchObject({
      result: "ALLOW",
      decisionId: decision.id,
    });
  });

  it("honors explicit denial", async () => {
    const source = await createSource();
    await decide(source.id, { decision: "DENIED", reason: "Terms prohibit automated access" });
    await expect(service.evaluate(source.id, "HTTP_FETCH", now)).resolves.toMatchObject({
      result: "DENY",
    });
  });

  it("requires review when an approval or source review has expired", async () => {
    const approvalExpired = await createSource();
    await decide(approvalExpired.id, { validUntil: new Date("2026-08-16T00:00:00Z") });
    await expect(service.evaluate(approvalExpired.id, "HTTP_FETCH", now)).resolves.toMatchObject({
      result: "REVIEW_REQUIRED",
      reason: "Capture approval has expired",
    });

    const sourceReviewExpired = await createSource({
      nextComplianceReviewDueAt: new Date("2026-08-16T00:00:00Z"),
    });
    await decide(sourceReviewExpired.id);
    await expect(service.evaluate(sourceReviewExpired.id, "HTTP_FETCH", now)).resolves.toMatchObject({
      result: "REVIEW_REQUIRED",
      reason: "Source compliance review is due",
    });
  });

  it("requires review for an unknown registry source", async () => {
    await expect(
      service.evaluate("00000000-0000-0000-0000-000000000000", "HTTP_FETCH", now),
    ).resolves.toMatchObject({ result: "REVIEW_REQUIRED", reason: "Source is not registered" });
  });

  it("denies an unapproved paywalled method but permits explicit current approval", async () => {
    const source = await createSource({
      accessClassification: "PAYWALLED",
      paywalled: true,
    });
    await expect(service.evaluate(source.id, "HTTP_FETCH", now)).resolves.toMatchObject({
      result: "DENY",
    });
    await decide(source.id, { reason: "Licensed API terms permit this method" });
    await expect(service.evaluate(source.id, "HTTP_FETCH", now)).resolves.toMatchObject({
      result: "ALLOW",
      technicalAccess: "CONDITIONAL",
    });
  });

  it("evaluates HEADLESS_RENDER independently from HTTP_FETCH", async () => {
    const source = await createSource();
    await decide(source.id, { captureMethod: "HTTP_FETCH", decision: "DENIED" });
    await decide(source.id, { captureMethod: "HEADLESS_RENDER", decision: "ALLOWED" });

    await expect(service.evaluate(source.id, "HTTP_FETCH", now)).resolves.toMatchObject({ result: "DENY" });
    await expect(service.evaluate(source.id, "HEADLESS_RENDER", now)).resolves.toMatchObject({
      result: "ALLOW",
    });
  });

  it("preserves superseded decision history while selecting the replacement", async () => {
    const source = await createSource();
    const denied = await decide(source.id, {
      decision: "DENIED",
      reason: "Initial conservative review",
      reviewedAt: new Date("2026-08-01T00:00:00Z"),
    });
    const allowed = await decide(source.id, {
      reason: "Documented authorization received",
      reviewedAt: new Date("2026-08-10T00:00:00Z"),
      supersedesDecisionId: denied.id,
    });

    await expect(repository.listDecisionHistory(source.id, "HTTP_FETCH")).resolves.toHaveLength(2);
    await expect(repository.getCurrentDecision(source.id, "HTTP_FETCH")).resolves.toMatchObject({
      id: allowed.id,
    });
    await expect(
      db.query("update source_capture_policy_decisions set reason = 'changed' where id = $1", [denied.id]),
    ).rejects.toThrow(/append-only/);
  });

  it("keeps operational health separate from compliance", async () => {
    const source = await createSource();
    await decide(source.id);
    await repository.recordHealth(source.id, "BLOCKED", now, "Endpoint unavailable");

    expect(SOURCE_HEALTH_STATUSES).toContain("BLOCKED");
    await expect(repository.getById(source.id)).resolves.toMatchObject({ healthStatus: "BLOCKED" });
    await expect(service.evaluate(source.id, "HTTP_FETCH", now)).resolves.toMatchObject({
      result: "ALLOW",
    });
  });

  it("records valuable and noisy yield without overriding compliance", async () => {
    const source = await createSource();
    await decide(source.id, { decision: "DENIED", reason: "Capture prohibited" });
    await repository.recordYield({
      sourceId: source.id,
      opportunitiesObserved: 100,
      validatedSignals: 70,
      verifiedContacts: 25,
      buyerRoutesFound: 12,
      hotACount: 8,
      hotBCount: 14,
      noiseCount: 30,
      lastMeasurementAt: now,
    });
    await repository.recordYield({
      sourceId: source.id,
      opportunitiesObserved: 4,
      noiseCount: 96,
      lastMeasurementAt: new Date("2026-08-18T12:00:00Z"),
    });

    const measurements = await db.query<{ count: string; valuable: string; noisy: string }>(
      `select count(*)::text as count,
              sum(hot_a_count)::text as valuable,
              sum(noise_count)::text as noisy
         from source_yield_measurements where source_id = $1`,
      [source.id],
    );
    expect(measurements.rows[0]).toEqual({ count: "2", valuable: "8", noisy: "126" });
    await expect(service.evaluate(source.id, "HTTP_FETCH", now)).resolves.toMatchObject({ result: "DENY" });
  });

  it("performs no network call and exposes no ingestion operation", async () => {
    const source = await createSource();
    await decide(source.id);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await service.evaluate(source.id, "HTTP_FETCH", now);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(Object.getOwnPropertyNames(SourcePolicyService.prototype)).toEqual(["constructor", "evaluate"]);
  });
});
