import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVIDENCE_LINK_TYPES, EVIDENCE_STATUSES } from "../../domain/evidence";
import { PostgresEvidenceRepository, type SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { EvidenceCaptureService } from "../../server/services/evidence/capture-evidence";
import { sha256CapturedPayload } from "../../server/services/evidence/content-hash";
import { InMemoryEvidenceStorage } from "../../server/storage/evidence-storage";

const migrations = [
  "20260817010000_canonical_model.sql",
  "20260817020000_evidence_provenance.sql",
];

describe("evidence and provenance layer", () => {
  let db: PGlite;
  let repository: PostgresEvidenceRepository;
  let captureService: EvidenceCaptureService;

  async function createSource(name: string) {
    const result = await db.query<{ id: string }>(
      "insert into sources (name) values ($1) returning id",
      [name],
    );
    return result.rows[0].id;
  }

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) {
      const sql = await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8");
      await db.exec(sql);
    }
    repository = new PostgresEvidenceRepository(db as unknown as SqlClient);
    captureService = new EvidenceCaptureService(repository);
  });

  afterAll(async () => {
    await db.close();
  });

  it("hashes captured bytes deterministically with SHA-256", () => {
    const first = sha256CapturedPayload("same captured content");
    const second = sha256CapturedPayload(Buffer.from("same captured content", "utf8"));

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256CapturedPayload("different captured content")).not.toBe(first);
  });

  it("creates a new record for every capture, including repeated URL and content", async () => {
    const sourceId = await createSource("Repeat capture source");
    const base = {
      sourceId,
      sourceUrl: "https://example.test/jobs/42",
      captureMethod: "MANUAL_UPLOAD",
      payload: "captured body",
    };

    const first = await captureService.capture({ ...base, capturedAt: new Date("2026-08-17T01:00:00Z") });
    const second = await captureService.capture({ ...base, capturedAt: new Date("2026-08-17T02:00:00Z") });

    expect(first.id).not.toBe(second.id);
    expect(first.contentHash).toBe(second.contentHash);
    await expect(repository.findByContentHash(first.contentHash)).resolves.toHaveLength(2);
    await expect(repository.listBySource(sourceId)).resolves.toHaveLength(2);
  });

  it("rejects updates and deletes of historical capture rows", async () => {
    const sourceId = await createSource("Immutable source");
    const evidence = await captureService.capture({
      sourceId,
      sourceUrl: "https://example.test/immutable",
      capturedAt: new Date("2026-08-17T03:00:00Z"),
      captureMethod: "API_IMPORT",
      payload: "immutable bytes",
    });

    await expect(
      db.query("update raw_evidence set source_url = 'https://changed.test' where id = $1", [evidence.id]),
    ).rejects.toThrow(/append-only/);
    await expect(db.query("delete from raw_evidence where id = $1", [evidence.id])).rejects.toThrow(
      /append-only/,
    );
    await expect(repository.getById(evidence.id)).resolves.toMatchObject({
      sourceUrl: "https://example.test/immutable",
    });
  });

  it("persists optional unknown metadata as null", async () => {
    const sourceId = await createSource("Unknown metadata source");
    const evidence = await captureService.capture({
      sourceId,
      sourceUrl: "https://example.test/unknowns",
      capturedAt: new Date("2026-08-17T04:00:00Z"),
      captureMethod: "MANUAL_CAPTURE",
      payload: "unknown metadata",
    });

    expect(evidence.contentType).toBeNull();
    expect(evidence.extractorVersion).toBeNull();
    expect(evidence.storageReference).toBeNull();
    expect(evidence.httpMetadata).toBeNull();
  });

  it("stores payloads behind an adapter without changing hash identity", async () => {
    const sourceId = await createSource("Storage source");
    const storage = new InMemoryEvidenceStorage();
    const service = new EvidenceCaptureService(repository, storage);
    const evidence = await service.capture({
      sourceId,
      sourceUrl: "https://example.test/stored",
      capturedAt: new Date("2026-08-17T05:00:00Z"),
      captureMethod: "MANUAL_UPLOAD",
      payload: "stored payload",
      contentType: "text/plain",
    });

    expect(evidence.storageReference).toBe(`memory://sha256/${evidence.contentHash}`);
    if (!evidence.storageReference) throw new Error("Storage reference was not persisted");
    await expect(storage.get(evidence.storageReference)).resolves.toEqual(
      Uint8Array.from(Buffer.from("stored payload")),
    );
  });

  it("links evidence relationally to every authorized domain target", async () => {
    const sourceId = await createSource("Link source");
    const evidence = await captureService.capture({
      sourceId,
      sourceUrl: "https://example.test/links",
      capturedAt: new Date("2026-08-17T06:00:00Z"),
      captureMethod: "MANUAL_CAPTURE",
      payload: "link evidence",
    });
    const company = await db.query<{ id: string }>(
      "insert into companies (legal_name) values ('Linked Company LLC') returning id",
    );
    const project = await db.query<{ id: string }>("insert into projects default values returning id");
    const signal = await db.query<{ id: string }>("insert into demand_signals default values returning id");
    const opportunity = await db.query<{ id: string }>("insert into opportunities default values returning id");
    const role = await db.query<{ id: string }>(
      "insert into company_roles (company_id, role, project_id) values ($1, 'GC', $2) returning id",
      [company.rows[0].id, project.rows[0].id],
    );
    const vendor = await db.query<{ id: string }>(
      "insert into vendor_routes (company_id, route_type) values ($1, 'OTHER') returning id",
      [company.rows[0].id],
    );
    const person = await db.query<{ id: string }>(
      "insert into contact_people (company_id, name) values ($1, 'Public Person') returning id",
      [company.rows[0].id],
    );
    const route = await db.query<{ id: string }>(
      "insert into contact_routes (company_id, route_type, target) values ($1, 'OTHER', 'public target') returning id",
      [company.rows[0].id],
    );
    const claim = await db.query<{ id: string }>(
      `insert into claims (subject_type, company_id, predicate, assertion_kind)
       values ('COMPANY', $1, 'IDENTITY', 'FACT') returning id`,
      [company.rows[0].id],
    );

    const targets = [
      { kind: "DEMAND_SIGNAL" as const, id: signal.rows[0].id },
      { kind: "CLAIM" as const, id: claim.rows[0].id },
      { kind: "COMPANY_ROLE" as const, id: role.rows[0].id },
      { kind: "VENDOR_ROUTE" as const, id: vendor.rows[0].id },
      { kind: "CONTACT_PERSON" as const, id: person.rows[0].id },
      { kind: "CONTACT_ROUTE" as const, id: route.rows[0].id },
      { kind: "PROJECT" as const, id: project.rows[0].id },
      { kind: "OPPORTUNITY" as const, id: opportunity.rows[0].id },
    ];
    for (const target of targets) await repository.link(evidence.id, target);

    const links = await repository.listLinksByEvidence(evidence.id);
    expect(links.map(({ target }) => target.kind).sort()).toEqual(
      targets.map(({ kind }) => kind).sort(),
    );
  });

  it("rejects VERIFIED claims without evidence", async () => {
    const company = await db.query<{ id: string }>(
      "insert into companies (legal_name) values ('Unsupported Claim LLC') returning id",
    );
    await db.exec("begin");
    await db.query(
      `insert into claims
         (subject_type, company_id, predicate, assertion_kind, verification_state, verified_at)
       values ('COMPANY', $1, 'IDENTITY', 'FACT', 'VERIFIED', now())`,
      [company.rows[0].id],
    );
    await expect(db.exec("commit")).rejects.toThrow(/requires at least one evidence link/);
    await db.exec("rollback").catch(() => undefined);
  });

  it("accepts VERIFIED claims with normalized evidence", async () => {
    const sourceId = await createSource("Verified claim source");
    const evidence = await captureService.capture({
      sourceId,
      sourceUrl: "https://example.test/verified",
      capturedAt: new Date("2026-08-17T07:00:00Z"),
      captureMethod: "MANUAL_CAPTURE",
      payload: "verified support",
    });
    const company = await db.query<{ id: string }>(
      "insert into companies (legal_name) values ('Supported Claim LLC') returning id",
    );

    await db.exec("begin");
    const claim = await db.query<{ id: string }>(
      `insert into claims
         (subject_type, company_id, predicate, assertion_kind, verification_state, verified_at)
       values ('COMPANY', $1, 'IDENTITY', 'FACT', 'VERIFIED', now()) returning id`,
      [company.rows[0].id],
    );
    const linkId = await repository.link(evidence.id, { kind: "CLAIM", id: claim.rows[0].id });
    await db.exec("commit");

    const verified = await db.query<{ verification_state: string }>(
      "select verification_state from claims where id = $1",
      [claim.rows[0].id],
    );
    expect(verified.rows[0].verification_state).toBe("VERIFIED");

    await db.exec("begin");
    await db.query("delete from evidence_links where id = $1", [linkId]);
    await expect(db.exec("commit")).rejects.toThrow(/requires at least one evidence link/);
    await db.exec("rollback").catch(() => undefined);
  });

  it("retains superseded evidence and its append-only lifecycle history", async () => {
    const sourceId = await createSource("Supersession source");
    const first = await captureService.capture({
      sourceId,
      sourceUrl: "https://example.test/changing",
      capturedAt: new Date("2026-08-17T08:00:00Z"),
      captureMethod: "MANUAL_CAPTURE",
      payload: "version one",
    });
    const second = await captureService.capture({
      sourceId,
      sourceUrl: "https://example.test/changing",
      capturedAt: new Date("2026-08-17T09:00:00Z"),
      captureMethod: "MANUAL_CAPTURE",
      payload: "version two",
    });

    await repository.supersede(first.id, second.id, "Content changed");

    await expect(repository.getById(first.id)).resolves.toMatchObject({ id: first.id });
    const statuses = await db.query<{ status: string }>(
      "select status from evidence_status_events where evidence_id = $1 order by recorded_at, id",
      [first.id],
    );
    expect(statuses.rows.map(({ status }) => status)).toEqual(["ACTIVE", "SUPERSEDED"]);
  });

  it("rejects ambiguous storage ownership and exposes no ingestion operations", async () => {
    const sourceId = await createSource("Boundary source");
    const service = new EvidenceCaptureService(repository, new InMemoryEvidenceStorage());
    await expect(
      service.capture({
        sourceId,
        sourceUrl: "https://example.test/boundary",
        capturedAt: new Date("2026-08-17T10:00:00Z"),
        captureMethod: "MANUAL_UPLOAD",
        payload: "boundary",
        storageReference: "external://already-stored",
      }),
    ).rejects.toThrow(/either a storage reference or a storage adapter/);

    expect(Object.getOwnPropertyNames(EvidenceCaptureService.prototype)).toEqual([
      "constructor",
      "capture",
    ]);
    expect(EVIDENCE_STATUSES).toEqual(["ACTIVE", "SUPERSEDED", "INVALID"]);
    expect(EVIDENCE_LINK_TYPES).toEqual(["SUPPORTS", "DERIVED_FROM", "OBSERVED_IN"]);
  });
});
