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

const EXCLUDED_LOCAL_MIGRATIONS = new Set([
  "20260913133740_discovery_mvp_a0_durable_runs.sql",
  "20260913135341_discovery_mvp_a_candidates.sql",
  "20260914024442_discovery_mvp_b_r1_destination_policy_state.sql",
  "20260914094253_canonical_multi_profession_demand.sql",
  "20260915024424_security_rls_b0_r1_public_routine_defaults.sql",
  "20260915024716_security_rls_b0_r1_global_routine_defaults.sql",
]);

/**
 * MATCHING-B1-C / C7 verification. WorkforceService.buildMatchingReadyInput
 * already exists (A3, published) and already has core coverage in
 * worker-domain.test.ts (determinism, knownGaps, authorization). This file
 * adds the finer-grained sanitization assertions C10.17-19 ask for, plus
 * contract tests for the two Manager corrections (B1-C authorization) that
 * the future matching engine must honor -- proven here only as "the data
 * layer faithfully preserves the raw fact, never pre-judging it", with NO
 * outcome aggregation implemented.
 */
describe("MATCHING-B1-C WorkerMatchingInput sanitization + correction contracts", () => {
  let db: PGlite;
  let operatorRepository: OperatorRepository;
  const fullAccessId = "d1111111-1111-4111-8111-111111111111";

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory = resolve(process.cwd(), "supabase/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql") && !EXCLUDED_LOCAL_MIGRATIONS.has(name)).sort();
    for (const file of files) await db.exec(await readFile(resolve(directory, file), "utf8"));
    operatorRepository = new PostgresOperatorRepository(db as unknown as SqlClient);
    await operatorRepository.create({
      authUserId: fullAccessId, email: "full@example.com", status: "ACTIVE",
      permissions: ["worker_profile.read", "worker_profile.write", "worker_contact.read", "worker_contact.write", "worker_compensation.read", "worker_compensation.write"],
    });
  });
  afterAll(async () => db.close());

  const session = (): (() => Promise<ServerSession | null>) => () => Promise.resolve({ authUserId: fullAccessId, email: "irrelevant@example.com" });
  const service = () =>
    new WorkerService({
      repository: new PostgresWorkerRepository(db as unknown as SqlClient),
      transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient),
      getSession: session(),
      operatorRepository,
    });

  async function createWorker(displayName: string) {
    const result = await service().createWorker({ displayName, sourceOfRecord: "IMPORTED" });
    if (result.kind !== "OK") throw new Error("setup failed");
    return result.value;
  }

  it("17. WorkerMatchingInput's own type excludes worker_contact_routes/consent -- verified by object-key inspection, not just the type system", async () => {
    const worker = await createWorker("SYNTHETIC-MATCHING-INPUT-BASIC");
    await service().addContactRoute({ workerId: worker.id, routeType: "PHONE", target: "555-0100" });
    const result = await service().buildMatchingReadyInput(worker.id);
    expect(result.kind).toBe("OK");
    const value = result.kind === "OK" ? result.value : null;
    expect(value).not.toBeNull();
    const keys = Object.keys(value as object);
    expect(keys).not.toContain("contact");
    expect(keys).not.toContain("contactRoutes");
    expect(keys).not.toContain("consentState");
    expect(JSON.stringify(value)).not.toContain("555-0100");
  });

  it("18. WorkerMatchingInput never carries raw_identifier even when a credential has one on file", async () => {
    const worker = await createWorker("SYNTHETIC-MATCHING-INPUT-CREDENTIAL");
    await service().addCredential({ workerId: worker.id, credentialCode: "OSHA_10", rawIdentifier: "LICENSE-SECRET-12345" });
    const result = await service().buildMatchingReadyInput(worker.id);
    expect(JSON.stringify(result)).not.toContain("LICENSE-SECRET-12345");
    expect(JSON.stringify(result)).not.toContain("rawIdentifier");
  });

  it("19. WorkerMatchingInput location is coarse-only -- no latitude/longitude/street/postal fields exist on the shape", async () => {
    const worker = await createWorker("SYNTHETIC-MATCHING-INPUT-LOCATION");
    await service().appendLocation({ workerId: worker.id, city: "Houston", region: "TX", country: "US", travelWilling: true, travelRadiusMiles: 75, relocationWilling: false, source: "SELF_REPORTED" });
    const result = await service().buildMatchingReadyInput(worker.id);
    const value = result.kind === "OK" ? result.value : null;
    expect(value?.location.state).toBe("KNOWN");
    if (value?.location.state === "KNOWN") {
      const locationKeys = Object.keys(value.location.value);
      expect(locationKeys).not.toContain("latitude");
      expect(locationKeys).not.toContain("longitude");
      expect(locationKeys).not.toContain("postalCode");
      expect(locationKeys).not.toContain("streetAddress");
      expect(value.location.value.travelRadiusMiles).toBe(75);
    }
  });

  it("Manager correction contract: a worker's raw availability status of COMMITTED is preserved as-is, not collapsed into UNAVAILABLE or any other value by the data layer", async () => {
    const worker = await createWorker("SYNTHETIC-COMMITTED-AVAILABILITY");
    await service().appendAvailability({ workerId: worker.id, status: "COMMITTED", source: "OPERATOR_ENTERED" });
    const result = await service().buildMatchingReadyInput(worker.id);
    const value = result.kind === "OK" ? result.value : null;
    expect(value?.availability.state).toBe("KNOWN");
    if (value?.availability.state === "KNOWN") expect(value.availability.value.status).toBe("COMMITTED");
    // Deliberately NOT asserting any outcome/interpretation here -- the future
    // engine (not this phase) is responsible for treating COMMITTED as
    // UNKNOWN unless its own available_until explicitly conflicts, per the
    // Manager's B1-C correction. This test only proves the raw fact survives
    // unmodified through the data layer, which is a prerequisite for that.
  });

  it("Manager correction contract: a worker with zero trade rows produces a genuinely empty tradeOccupations array, never a synthesized conflict marker", async () => {
    const worker = await createWorker("SYNTHETIC-NO-TRADE-ROWS");
    const result = await service().buildMatchingReadyInput(worker.id);
    const value = result.kind === "OK" ? result.value : null;
    expect(value?.tradeOccupations).toEqual([]);
    // Absence must remain plain, empty absence -- not VIOLATED, not any
    // special sentinel -- so the future engine's own UNKNOWN-not-VIOLATED
    // rule (B1-B.7 / B1-C authorization) has a clean, honest signal to work from.
  });
});
