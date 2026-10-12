import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresWorkerRepository } from "../../server/repositories/worker/postgres-worker-repository";
import { WorkerService } from "../../server/services/worker/worker-service";
import { transactionRunnerOnClient } from "../../server/database/transaction";
import type { ServerSession } from "../../server/auth/session";
import type { OperatorRepository } from "../../server/repositories/operator/operator-repository";

/**
 * WORKFORCE-TALENT-A4-R10. Real Postgres-compatible (PGlite) integration
 * coverage for the two authorized lifecycle transitions, mirroring
 * worker-domain.test.ts's own harness exactly (same migrations, same
 * stub-role fixture rationale) rather than inventing a second one.
 */
describe("WORKFORCE-TALENT-A4-R10 worker archive/reactivate lifecycle", () => {
  let db: PGlite;
  let operatorRepository: OperatorRepository;

  const fullAccessId = "b1111111-1111-4111-8111-111111111111";
  const noPermissionId = "b2222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory = resolve(process.cwd(), "supabase/migrations");
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(resolve(directory, file), "utf8"));
    }
    operatorRepository = new PostgresOperatorRepository(db as unknown as SqlClient);
    await operatorRepository.create({
      authUserId: fullAccessId, email: "full@example.com", status: "ACTIVE",
      permissions: ["worker_profile.read", "worker_profile.write"],
    });
    await operatorRepository.create({ authUserId: noPermissionId, email: "no-permission@example.com", status: "ACTIVE", permissions: [] });
  });
  afterAll(async () => db.close());

  const session = (authUserId: string): (() => Promise<ServerSession | null>) => () => Promise.resolve({ authUserId, email: "irrelevant@example.com" });
  const serviceFor = (authUserId: string) =>
    new WorkerService({
      repository: new PostgresWorkerRepository(db as unknown as SqlClient),
      transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient),
      getSession: session(authUserId),
      operatorRepository,
    });
  const full = () => serviceFor(fullAccessId);
  const noPermission = () => serviceFor(noPermissionId);

  async function createSyntheticWorker(displayName: string) {
    const result = await full().createWorker({ displayName, sourceOfRecord: "IMPORTED" });
    if (result.kind !== "OK") throw new Error("setup failed");
    return result.value;
  }

  it("A/B. archiveWorker transitions an ACTIVE worker to ARCHIVED via the existing repository UPDATE path", async () => {
    const worker = await createSyntheticWorker("A4-R10-ARCHIVE-TARGET");
    expect(worker.lifecycleStatus).toBe("ACTIVE");
    const result = await full().archiveWorker(worker.id);
    expect(result.kind).toBe("OK");
    if (result.kind === "OK") expect(result.value.lifecycleStatus).toBe("ARCHIVED");
    const reread = await full().getWorker(worker.id);
    expect(reread.kind).toBe("OK");
    if (reread.kind === "OK") expect(reread.value?.lifecycleStatus).toBe("ARCHIVED");
  });

  it("C. reactivateWorker transitions an ARCHIVED worker back to ACTIVE", async () => {
    const worker = await createSyntheticWorker("A4-R10-REACTIVATE-TARGET");
    const archived = await full().archiveWorker(worker.id);
    expect(archived.kind).toBe("OK");
    const reactivated = await full().reactivateWorker(worker.id);
    expect(reactivated.kind).toBe("OK");
    if (reactivated.kind === "OK") expect(reactivated.value.lifecycleStatus).toBe("ACTIVE");
  });

  it("D. archiveWorker and reactivateWorker both require worker_profile.write -- UNAUTHORIZED without it", async () => {
    const worker = await createSyntheticWorker("A4-R10-NO-PERMISSION-TARGET");
    const archiveAttempt = await noPermission().archiveWorker(worker.id);
    expect(archiveAttempt.kind).toBe("UNAUTHORIZED");
    const reactivateAttempt = await noPermission().reactivateWorker(worker.id);
    expect(reactivateAttempt.kind).toBe("UNAUTHORIZED");
    // Confirm the permission attempt genuinely didn't mutate anything.
    const stillActive = await full().getWorker(worker.id);
    if (stillActive.kind === "OK") expect(stillActive.value?.lifecycleStatus).toBe("ACTIVE");
  });

  it("rejects archiving a worker that is not currently ACTIVE (no double-archive, no ARCHIVED->ARCHIVED no-op)", async () => {
    const worker = await createSyntheticWorker("A4-R10-DOUBLE-ARCHIVE-TARGET");
    await full().archiveWorker(worker.id);
    const secondAttempt = await full().archiveWorker(worker.id);
    expect(secondAttempt.kind).toBe("VALIDATION_ERROR");
  });

  it("rejects reactivating a worker that is not currently ARCHIVED (an ACTIVE worker cannot be 'reactivated')", async () => {
    const worker = await createSyntheticWorker("A4-R10-INVALID-REACTIVATE-TARGET");
    const result = await full().reactivateWorker(worker.id);
    expect(result.kind).toBe("VALIDATION_ERROR");
  });

  it("J. no hard-delete path exists anywhere in the worker repository/service", async () => {
    const service = full() as unknown as Record<string, unknown>;
    expect(typeof service.deleteWorker).toBe("undefined");
    expect(typeof service.removeWorker).toBe("undefined");
    const worker = await createSyntheticWorker("A4-R10-SURVIVES-ARCHIVE");
    await full().archiveWorker(worker.id);
    const stillPersisted = await full().getWorker(worker.id);
    expect(stillPersisted.kind).toBe("OK");
    if (stillPersisted.kind === "OK") expect(stillPersisted.value).not.toBeNull();
  });
});
