import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureAdapter, DemandSignalParser } from "../../domain/ingestion";
import type { CreateSourceInput, RecordCapturePolicyDecisionInput } from "../../domain/source";
import { CorporateCareersHtmlFixtureAdapter, StructuredFixtureCaptureAdapter } from "../../server/ingestion/adapters/fixture-adapters";
import { CorporateCareersHtmlParser } from "../../server/ingestion/parsers/corporate-careers-html-parser";
import { StructuredFixtureParser } from "../../server/ingestion/parsers/structured-fixture-parser";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresIngestionRepository } from "../../server/repositories/ingestion/postgres-ingestion-repository";
import { PostgresSourceRepository } from "../../server/repositories/source/postgres-source-repository";
import { ControlledIngestionService } from "../../server/services/ingestion/controlled-ingestion-service";
import { EvidenceCaptureService } from "../../server/services/evidence/capture-evidence";
import { SourcePolicyService } from "../../server/services/source/source-policy-service";

const now = new Date("2026-08-17T12:00:00Z");
const migrations = [
  "20260817010000_canonical_model.sql",
  "20260817020000_evidence_provenance.sql",
  "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql",
];

const structuredTarget = "fixture://structured/journeyman";
const htmlTarget = "fixture://careers/apprentice";
const structuredPosting = {
  externalPostingId: "TX-JE-100",
  title: "Journeyman Electrician",
  publisherName: "Example Staffing Publisher",
  publisherType: "STAFFING_AGENCY",
  city: "Houston",
  county: "Harris",
  state: "TX",
  hourlyPayMin: 34,
  hourlyPayMax: 39,
  currency: "USD",
  overtimeAvailable: true,
  overtimeTerms: "Overtime available after 40 hours",
  perDiemAvailable: true,
  perDiemAmount: 120,
  perDiemUnit: "DAY",
  schedule: "6x10",
  headcountEstimate: 8,
  publishedAt: "2026-08-15T09:00:00Z",
  compensationText: "$34-$39/hour; $120/day per diem; overtime after 40 hours",
};
const apprenticeHtml = `
  <article data-job-id="APP-200">
    <h1>Electrical Apprentice</h1>
    <div data-field="publisher">Example Electrical Contractor</div>
    <div data-field="publisher-type">DIRECT_EMPLOYER</div>
    <div data-field="city">Austin</div><div data-field="state">TX</div>
    <div data-field="schedule">Monday-Friday</div>
    <time data-field="published-at">not-a-date</time>
  </article>`;

describe("controlled ingestion core", () => {
  let db: PGlite;
  let sourceRepository: PostgresSourceRepository;
  let evidenceRepository: PostgresEvidenceRepository;
  let service: ControlledIngestionService;
  let structuredAdapter: StructuredFixtureCaptureAdapter;
  let htmlAdapter: CorporateCareersHtmlFixtureAdapter;
  const structuredParser = new StructuredFixtureParser();
  const htmlParser = new CorporateCareersHtmlParser();

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) {
      const sql = await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8");
      await db.exec(sql);
    }
    const client = db as unknown as SqlClient;
    sourceRepository = new PostgresSourceRepository(client);
    evidenceRepository = new PostgresEvidenceRepository(client);
    service = new ControlledIngestionService(
      sourceRepository,
      new SourcePolicyService(sourceRepository),
      new EvidenceCaptureService(evidenceRepository),
      evidenceRepository,
      new PostgresIngestionRepository(client),
      () => now,
    );
  });

  beforeEach(() => {
    structuredAdapter = new StructuredFixtureCaptureAdapter(
      new Map([[structuredTarget, {
        sourceUrl: "https://fixtures.example/jobs/TX-JE-100",
        payload: JSON.stringify(structuredPosting),
        contentType: "application/json",
      }]]),
      new Set(["HTTP_FETCH"]),
      () => now,
    );
    htmlAdapter = new CorporateCareersHtmlFixtureAdapter(
      new Map([[htmlTarget, {
        sourceUrl: "https://careers.example/jobs/APP-200",
        payload: apprenticeHtml,
        contentType: "text/html",
      }]]),
      new Set(["HTTP_FETCH"]),
      () => now,
    );
  });

  afterAll(async () => db.close());

  async function createSource(overrides: Partial<CreateSourceInput> = {}) {
    return sourceRepository.create({
      name: `Ingestion source ${crypto.randomUUID()}`,
      sourceType: "CORPORATE_CAREERS",
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

  async function decide(sourceId: string, overrides: Partial<RecordCapturePolicyDecisionInput> = {}) {
    return sourceRepository.recordDecision({
      sourceId,
      captureMethod: "HTTP_FETCH",
      decision: "ALLOWED",
      reason: "Controlled fixture capture approved",
      reviewedAt: new Date("2026-08-10T00:00:00Z"),
      reviewedBy: "reviewer:test",
      validUntil: new Date("2026-09-10T00:00:00Z"),
      policyVersion: "policy-1",
      ...overrides,
    });
  }

  const request = (sourceId: string, adapter: CaptureAdapter = structuredAdapter, parser: DemandSignalParser = structuredParser, target = structuredTarget) => ({
    sourceId, target, method: "HTTP_FETCH" as const, adapter, parser,
  });

  it("prevents adapter execution when policy denies capture", async () => {
    const source = await createSource({ enabled: false });
    const capture = vi.spyOn(structuredAdapter, "capture");
    await expect(service.ingest(request(source.id))).resolves.toMatchObject({ status: "POLICY_DENIED", evidenceId: null });
    expect(capture).not.toHaveBeenCalled();
  });

  it("prevents adapter execution when policy requires review", async () => {
    const source = await createSource();
    const capture = vi.spyOn(structuredAdapter, "capture");
    await expect(service.ingest(request(source.id))).resolves.toMatchObject({ status: "REVIEW_REQUIRED", evidenceId: null });
    expect(capture).not.toHaveBeenCalled();
  });

  it("allows an approved adapter and creates linked evidence and a normalized signal", async () => {
    const source = await createSource();
    await decide(source.id);
    const capture = vi.spyOn(structuredAdapter, "capture");
    const outcome = await service.ingest(request(source.id));
    expect(capture).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ status: "SUCCESS" });
    expect(outcome.evidenceId).not.toBeNull();
    expect(outcome.demandSignalId).not.toBeNull();
    await expect(evidenceRepository.listLinksByEvidence(outcome.evidenceId!)).resolves.toEqual([
      expect.objectContaining({ linkType: "DERIVED_FROM", target: { kind: "DEMAND_SIGNAL", id: outcome.demandSignalId } }),
    ]);
    const result = await db.query<Record<string, unknown>>("select * from demand_signals where id = $1", [outcome.demandSignalId]);
    expect(result.rows[0]).toMatchObject({
      original_title: "Journeyman Electrician", role_type: "JOURNEYMAN_ELECTRICIAN",
      city: "Houston", county: "Harris", state: "TX", base_pay_min: "34.00",
      base_pay_max: "39.00", pay_currency: "USD", per_diem_amount: "120.00",
      publisher_company_id: null, unresolved_publisher_name: "Example Staffing Publisher",
    });
  });

  it("preserves evidence but creates no signal when parsing fails", async () => {
    const source = await createSource();
    await decide(source.id);
    const malformedAdapter = new CorporateCareersHtmlFixtureAdapter(
      new Map([["fixture://malformed", { sourceUrl: "https://careers.example/broken", payload: "<h1>Missing id</h1>" }]]),
      new Set(["HTTP_FETCH"]), () => now,
    );
    const outcome = await service.ingest(request(source.id, malformedAdapter, htmlParser, "fixture://malformed"));
    expect(outcome).toMatchObject({ status: "PARSE_FAILED", demandSignalId: null });
    expect(outcome.evidenceId).not.toBeNull();
    const count = await db.query<{ count: string }>("select count(*)::text as count from demand_signals where source_id = $1", [source.id]);
    expect(count.rows[0].count).toBe("0");
  });

  it("keeps missing compensation, county, headcount, and invalid dates null", async () => {
    const source = await createSource();
    await decide(source.id);
    const outcome = await service.ingest(request(source.id, htmlAdapter, htmlParser, htmlTarget));
    const result = await db.query<Record<string, unknown>>("select * from demand_signals where id = $1", [outcome.demandSignalId]);
    expect(result.rows[0]).toMatchObject({
      role_type: "APPRENTICE_ELECTRICIAN", county: null, base_pay_min: null,
      base_pay_max: null, overtime_available: null, per_diem_available: null,
      headcount_estimate: null, published_at: null,
    });
  });

  it("maps an ambiguous title conservatively to OTHER", () => {
    const signal = structuredParser.parse({
      sourceUrl: "fixture://ambiguous", capturedAt: now,
      payload: JSON.stringify({ externalPostingId: "AMB-1", title: "Facilities Specialist" }),
    });
    expect(signal.roleType).toBe("OTHER");
  });

  it("does not fabricate values from conflicting compensation or unstated benefits", () => {
    const signal = htmlParser.parse({
      sourceUrl: "fixture://conflict", capturedAt: now,
      payload: `<article data-job-id="CON-1"><h1>Electrician</h1><div data-field="compensation">$45 - $30 per hour</div><div data-field="publisher">Staffing Firm; client undisclosed</div></article>`,
    });
    expect(signal).toMatchObject({
      roleType: "ELECTRICIAN", basePayMin: null, basePayMax: null,
      payCurrency: null, overtimeAvailable: null, perDiemAvailable: null,
      unresolvedPublisherName: "Staffing Firm; client undisclosed",
    });
  });

  it("re-captures evidence while retaining one logical signal for the same external ID", async () => {
    const source = await createSource();
    await decide(source.id);
    const first = await service.ingest(request(source.id));
    const second = await service.ingest(request(source.id));
    expect(second.demandSignalId).toBe(first.demandSignalId);
    const counts = await db.query<{ evidence: string; signals: string; links: string }>(
      `select (select count(*) from raw_evidence where source_id = $1)::text as evidence,
              (select count(*) from demand_signals where source_id = $1)::text as signals,
              (select count(*) from evidence_links where demand_signal_id = $2)::text as links`,
      [source.id, first.demandSignalId],
    );
    expect(counts.rows[0]).toEqual({ evidence: "2", signals: "1", links: "2" });
  });

  it("keeps different external posting IDs separate", async () => {
    const source = await createSource();
    await decide(source.id);
    const secondTarget = "fixture://structured/other";
    structuredAdapter = new StructuredFixtureCaptureAdapter(new Map([
      [structuredTarget, { sourceUrl: "https://fixtures.example/jobs/1", payload: JSON.stringify(structuredPosting) }],
      [secondTarget, { sourceUrl: "https://fixtures.example/jobs/2", payload: JSON.stringify({ ...structuredPosting, externalPostingId: "TX-JE-101" }) }],
    ]), new Set(["HTTP_FETCH"]), () => now);
    const first = await service.ingest(request(source.id));
    const second = await service.ingest(request(source.id, structuredAdapter, structuredParser, secondTarget));
    expect(second.demandSignalId).not.toBe(first.demandSignalId);
  });

  it("uses an exact source URL fingerprint only when an external ID is absent", async () => {
    const source = await createSource();
    await decide(source.id);
    const target = "fixture://no-id";
    const adapter = new StructuredFixtureCaptureAdapter(new Map([[target, {
      sourceUrl: "https://fixtures.example/jobs/no-id", payload: JSON.stringify({ title: "Electrician" }),
    }]]), new Set(["HTTP_FETCH"]), () => now);
    const first = await service.ingest(request(source.id, adapter, structuredParser, target));
    const second = await service.ingest(request(source.id, adapter, structuredParser, target));
    expect(second.demandSignalId).toBe(first.demandSignalId);
    const row = await db.query<{ source_identity_key: string }>("select source_identity_key from demand_signals where id = $1", [first.demandSignalId]);
    expect(row.rows[0].source_identity_key).toMatch(/^url:[a-f0-9]{64}$/);
  });

  it("records success and failure audits with policy and parser versions", async () => {
    const allowed = await createSource();
    await decide(allowed.id);
    const denied = await createSource({ enabled: false });
    await service.ingest(request(allowed.id));
    await service.ingest(request(denied.id));
    const result = await db.query<Record<string, unknown>>(
      "select status, policy_result, parser_version, raw_evidence_id, demand_signal_id from ingestion_attempts where source_id in ($1, $2) order by status",
      [allowed.id, denied.id],
    );
    expect(result.rows).toEqual([
      expect.objectContaining({ status: "POLICY_DENIED", policy_result: "DENY", parser_version: structuredParser.version, raw_evidence_id: null }),
      expect.objectContaining({ status: "SUCCESS", policy_result: "ALLOW", parser_version: structuredParser.version }),
    ]);
  });

  it("audits capture failures without evidence or a demand signal", async () => {
    const source = await createSource();
    await decide(source.id);
    const outcome = await service.ingest(request(source.id, structuredAdapter, structuredParser, "fixture://missing"));
    expect(outcome).toMatchObject({ status: "CAPTURE_FAILED", evidenceId: null, demandSignalId: null });
  });

  it("preserves evidence and audits validation failures without creating a signal", async () => {
    const source = await createSource();
    await decide(source.id);
    const target = "fixture://invalid-currency";
    const adapter = new StructuredFixtureCaptureAdapter(new Map([[target, {
      sourceUrl: "https://fixtures.example/jobs/invalid-currency",
      payload: JSON.stringify({
        externalPostingId: "BAD-CURRENCY-1", title: "Electrician",
        hourlyPayMin: 30, currency: "usd",
      }),
    }]]), new Set(["HTTP_FETCH"]), () => now);
    const outcome = await service.ingest(request(source.id, adapter, structuredParser, target));
    expect(outcome).toMatchObject({ status: "VALIDATION_FAILED", demandSignalId: null });
    expect(outcome.evidenceId).not.toBeNull();
    const count = await db.query<{ count: string }>("select count(*)::text as count from demand_signals where source_id = $1", [source.id]);
    expect(count.rows[0].count).toBe("0");
  });

  it("keeps evidence and ingestion audits append-only", async () => {
    const source = await createSource();
    await decide(source.id);
    const outcome = await service.ingest(request(source.id));
    await expect(db.query("update raw_evidence set source_url = 'changed' where id = $1", [outcome.evidenceId])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from ingestion_attempts where id = $1", [outcome.auditId])).rejects.toThrow(/append-only/);
  });

  it("performs no network calls and exposes no Phase 1F business operations", async () => {
    const source = await createSource();
    await decide(source.id);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await service.ingest(request(source.id));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(Object.getOwnPropertyNames(ControlledIngestionService.prototype)).toEqual(["constructor", "ingest", "finish"]);
    const columns = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'ingestion_attempts'");
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(expect.arrayContaining(["claim_id", "opportunity_id", "score", "hot_label"]));
  });
});
