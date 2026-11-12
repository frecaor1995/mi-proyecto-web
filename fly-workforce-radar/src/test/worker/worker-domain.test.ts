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

describe("WORKFORCE-TALENT-A3 worker repositories, services & validation", () => {
  let db: PGlite;
  let operatorRepository: OperatorRepository;

  const fullAccessId = "a1111111-1111-4111-8111-111111111111";
  const profileOnlyId = "a2222222-2222-4222-8222-222222222222";
  const noPermissionId = "a3333333-3333-4333-8333-333333333333";
  const inactiveId = "a4444444-4444-4444-8444-444444444444";
  const unmappedId = "a5555555-5555-4555-8555-555555555555";

  beforeAll(async () => {
    db = new PGlite();
    // PGlite ships with neither `anon` nor `authenticated` -- unlike a real
    // Supabase Postgres, which always has both. The pre-existing (untracked)
    // SECURITY-RLS-B0 migration unconditionally revokes privileges from
    // both, so without stub roles here the entire migration run fails
    // before a single worker table exists. This mirrors real Postgres
    // reality rather than working around a defect: those roles always
    // exist outside PGlite, so creating stand-ins is the accurate fixture,
    // not a patch over broken product code.
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory = resolve(process.cwd(), "supabase/migrations");
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(resolve(directory, file), "utf8"));
    }
    operatorRepository = new PostgresOperatorRepository(db as unknown as SqlClient);
    await operatorRepository.create({
      authUserId: fullAccessId, email: "full@example.com", status: "ACTIVE",
      permissions: ["worker_profile.read", "worker_profile.write", "worker_contact.read", "worker_contact.write", "worker_compensation.read", "worker_compensation.write"],
    });
    await operatorRepository.create({ authUserId: profileOnlyId, email: "profile-only@example.com", status: "ACTIVE", permissions: ["worker_profile.read", "worker_profile.write"] });
    await operatorRepository.create({ authUserId: noPermissionId, email: "no-permission@example.com", status: "ACTIVE", permissions: [] });
    await operatorRepository.create({ authUserId: inactiveId, email: "inactive@example.com", status: "INACTIVE", permissions: ["worker_profile.read", "worker_profile.write"] });
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
  const profileOnly = () => serviceFor(profileOnlyId);

  async function createSyntheticWorker(displayName: string) {
    const result = await full().createWorker({ displayName, sourceOfRecord: "IMPORTED" });
    if (result.kind !== "OK") throw new Error("setup failed");
    return result.value;
  }

  it("A. creates a worker and rejects an empty display name", async () => {
    const created = await full().createWorker({ displayName: "SYNTHETIC-A", sourceOfRecord: "IMPORTED" });
    expect(created.kind).toBe("OK");
    const empty = await full().createWorker({ displayName: "   ", sourceOfRecord: "IMPORTED" });
    expect(empty.kind).toBe("VALIDATION_ERROR");
  });

  it("B. retrieves a worker by id, and returns null for an unknown id", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-B");
    const found = await full().getWorker(worker.id);
    expect(found).toEqual({ kind: "OK", value: expect.objectContaining({ id: worker.id, displayName: "SYNTHETIC-B" }) });
    const missing = await full().getWorker("00000000-0000-4000-8000-000000000000");
    expect(missing).toEqual({ kind: "OK", value: null });
  });

  it("C. updates allowed mutable fields, and enforces VERIFIED requires verifiedAt", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-C");
    const updated = await full().updateWorker(worker.id, { displayName: "SYNTHETIC-C-RENAMED" });
    expect(updated.kind).toBe("OK");
    if (updated.kind === "OK") expect(updated.value.displayName).toBe("SYNTHETIC-C-RENAMED");
    const invalidVerify = await full().updateWorker(worker.id, { profileVerificationState: "VERIFIED" });
    expect(invalidVerify.kind).toBe("VALIDATION_ERROR");
  });

  it("D. supports a worker with multiple trades (PRIMARY + SECONDARY), rejecting a second PRIMARY", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-D");
    const primary = await full().addTradeOccupation({ workerId: worker.id, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 60 });
    const secondary = await full().addTradeOccupation({ workerId: worker.id, tradeCode: "WELDING", occupationCode: "WELDER", roleDesignation: "SECONDARY" });
    expect(primary.kind).toBe("OK");
    expect(secondary.kind).toBe("OK");
    const list = await full().listTradeOccupations(worker.id);
    expect(list.kind === "OK" ? list.value.length : -1).toBe(2);
    const secondPrimary = await full().addTradeOccupation({ workerId: worker.id, tradeCode: "WELDING", occupationCode: "WELDER", roleDesignation: "PRIMARY" });
    expect(secondPrimary.kind).toBe("VALIDATION_ERROR");
  });

  it("E. adds, lists, and removes a skill association", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-E");
    await full().addSkill({ workerId: worker.id, skillCode: "TIG" });
    const listed = await full().listSkills(worker.id);
    expect(listed.kind === "OK" ? listed.value.map((s) => s.skillCode) : []).toEqual(["TIG"]);
    await full().removeSkill(worker.id, "TIG");
    const afterRemoval = await full().listSkills(worker.id);
    expect(afterRemoval.kind === "OK" ? afterRemoval.value.length : -1).toBe(0);
  });

  it("F. adds a credential with a raw identifier, and never returns raw_identifier from any read", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-F");
    const added = await full().addCredential({ workerId: worker.id, credentialCode: "OSHA_10", rawIdentifier: "SYNTH-LICENSE-000" });
    expect(added.kind).toBe("OK");
    if (added.kind === "OK") expect(Object.keys(added.value)).not.toContain("rawIdentifier");
    const listed = await full().listCredentials(worker.id);
    if (listed.kind === "OK") {
      for (const record of listed.value) expect(Object.keys(record)).not.toContain("rawIdentifier");
    }
    const verified = await full().updateCredentialVerification({ workerId: worker.id, credentialCode: "OSHA_10", verificationState: "VERIFIED", verifiedAt: new Date() });
    expect(verified.kind).toBe("OK");
  });

  it("G/S. availability UNKNOWN (no row) is distinct from a known UNKNOWN status row, and never collapses to a negative fact", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-G");
    const beforeAny = await full().getCurrentAvailability(worker.id);
    expect(beforeAny).toEqual({ kind: "OK", value: { state: "UNKNOWN" } });

    const appended = await full().appendAvailability({ workerId: worker.id, status: "UNKNOWN", source: "SELF_REPORTED" });
    expect(appended.kind).toBe("OK");
    const afterKnownUnknown = await full().getCurrentAvailability(worker.id);
    expect(afterKnownUnknown.kind).toBe("OK");
    if (afterKnownUnknown.kind === "OK") {
      expect(afterKnownUnknown.value.state).toBe("KNOWN");
      if (afterKnownUnknown.value.state === "KNOWN") expect(afterKnownUnknown.value.value.status).toBe("UNKNOWN");
    }
  });

  it("H. location is coarse-only and represents no-record as UNKNOWN", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-H");
    const before = await full().getCurrentLocation(worker.id);
    expect(before).toEqual({ kind: "OK", value: { state: "UNKNOWN" } });
    const appended = await full().appendLocation({ workerId: worker.id, city: "Abilene", region: "TX", country: "US", travelWilling: true, travelRadiusMiles: 150, source: "SELF_REPORTED" });
    expect(appended.kind).toBe("OK");
    if (appended.kind === "OK") {
      expect(Object.keys(appended.value)).not.toContain("latitude");
      expect(Object.keys(appended.value)).not.toContain("postalCode");
    }
  });

  it("I. adds, lists, and updates work history", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-I");
    const added = await full().addWorkHistory({ workerId: worker.id, employerLabel: "Synthetic Employer", startDate: new Date("2020-01-01") });
    expect(added.kind).toBe("OK");
    if (added.kind === "OK") {
      const updated = await full().updateWorkHistory({ id: added.value.id, endDate: new Date("2021-01-01") });
      expect(updated.kind).toBe("OK");
    }
    const listed = await full().listWorkHistory(worker.id);
    expect(listed.kind === "OK" ? listed.value.length : -1).toBe(1);
  });

  it("J. fails closed: GRANTED consent without consentCapturedAt is rejected", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-J");
    const rejected = await full().addContactRoute({ workerId: worker.id, routeType: "PHONE", target: "555-0100", consentState: "GRANTED" });
    expect(rejected.kind).toBe("VALIDATION_ERROR");
    const accepted = await full().addContactRoute({ workerId: worker.id, routeType: "PHONE", target: "555-0100", consentState: "GRANTED", consentCapturedAt: new Date() });
    expect(accepted.kind).toBe("OK");
  });

  it("K. denies contact operations to a caller without worker_contact permissions", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-K");
    const read = await profileOnly().listContactRoutes(worker.id);
    expect(read.kind).toBe("UNAUTHORIZED");
    const write = await profileOnly().addContactRoute({ workerId: worker.id, routeType: "EMAIL", target: "synthetic@example.invalid" });
    expect(write.kind).toBe("UNAUTHORIZED");
  });

  it("L. denies compensation operations to a caller without worker_compensation permissions", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-L");
    const read = await profileOnly().listCompensationExpectations(worker.id);
    expect(read.kind).toBe("UNAUTHORIZED");
    const write = await profileOnly().appendCompensationExpectation({ workerId: worker.id, rateType: "HOURLY", rateMin: 30 });
    expect(write.kind).toBe("UNAUTHORIZED");
  });

  it("M. a profile-only caller's worker profile omits contact and compensation values entirely", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-M");
    await full().addContactRoute({ workerId: worker.id, routeType: "PHONE", target: "555-0100" });
    await full().appendCompensationExpectation({ workerId: worker.id, rateType: "HOURLY", rateMin: 32 });

    const profile = await profileOnly().getWorkerProfile(worker.id);
    expect(profile.kind).toBe("OK");
    if (profile.kind === "OK" && profile.value) {
      expect(profile.value.contact).toEqual({ access: "REDACTED" });
      expect(profile.value.compensation).toEqual({ access: "REDACTED" });
      expect(profile.value.worker.id).toBe(worker.id);
    }

    const fullProfile = await full().getWorkerProfile(worker.id);
    if (fullProfile.kind === "OK" && fullProfile.value) {
      expect(fullProfile.value.contact.access).toBe("GRANTED");
      expect(fullProfile.value.compensation.access).toBe("GRANTED");
    }
  });

  it("N. raw_identifier is never present anywhere in the canonical worker profile", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-N");
    await full().addCredential({ workerId: worker.id, credentialCode: "OSHA_10", rawIdentifier: "SYNTH-LICENSE-111" });
    const profile = await full().getWorkerProfile(worker.id);
    expect(profile.kind).toBe("OK");
    if (profile.kind === "OK" && profile.value) {
      expect(JSON.stringify(profile.value)).not.toContain("SYNTH-LICENSE-111");
      for (const credential of profile.value.credentials) expect(Object.keys(credential)).not.toContain("rawIdentifier");
    }
  });

  it("O. an inactive operator, a no-permission operator, and an unmapped session are all denied", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-O");
    expect((await serviceFor(inactiveId).getWorker(worker.id)).kind).toBe("UNAUTHORIZED");
    expect((await serviceFor(noPermissionId).getWorker(worker.id)).kind).toBe("UNAUTHORIZED");
    expect((await serviceFor(unmappedId).getWorker(worker.id)).kind).toBe("UNAUTHORIZED");
  });

  it("P. an invalid/mismatched taxonomy reference is rejected, not silently accepted", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-P");
    const bogus = await full().addTradeOccupation({ workerId: worker.id, tradeCode: "NOT_A_REAL_TRADE", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY" });
    expect(bogus.kind).toBe("VALIDATION_ERROR");
    const mismatched = await full().addTradeOccupation({ workerId: worker.id, tradeCode: "WELDING", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY" });
    expect(mismatched.kind).toBe("VALIDATION_ERROR");
  });

  it("Q. invalid date ranges are rejected", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-Q");
    const badHistory = await full().addWorkHistory({ workerId: worker.id, employerLabel: "Synthetic Employer", startDate: new Date("2022-01-01"), endDate: new Date("2020-01-01") });
    expect(badHistory.kind).toBe("VALIDATION_ERROR");
    const badCredential = await full().addCredential({ workerId: worker.id, credentialCode: "OSHA_10", issuedAt: new Date("2022-01-01"), expiresAt: new Date("2020-01-01") });
    expect(badCredential.kind).toBe("VALIDATION_ERROR");
  });

  it("R. the matching-ready DTO is deterministic and always carries documented known gaps", async () => {
    const worker = await createSyntheticWorker("SYNTHETIC-R");
    await full().addTradeOccupation({ workerId: worker.id, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 84 });
    await full().addSkill({ workerId: worker.id, skillCode: "INDUSTRIAL_ELECTRICAL" });
    await full().addCredential({ workerId: worker.id, credentialCode: "OSHA_10" });

    const first = await full().buildMatchingReadyInput(worker.id);
    const second = await full().buildMatchingReadyInput(worker.id);
    expect(first).toEqual(second);
    if (first.kind === "OK" && first.value) {
      expect(first.value.knownGaps).toEqual(["WORKER_SHIFT_HOURS_CAPACITY_NOT_REPRESENTED", "DEMAND_CANONICAL_COMPENSATION_FIELD_MISSING"]);
      expect(first.value.tradeOccupations).toEqual([{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 84 }]);
    }

    const deniedForProfileOnly = await profileOnly().buildMatchingReadyInput(worker.id);
    expect(deniedForProfileOnly.kind).toBe("UNAUTHORIZED");
  });

  it("T. a multi-table write failure rolls back atomically -- no partial worker is left behind", async () => {
    const before = await full().searchWorkers({ limit: 200, offset: 0 });
    const beforeCount = before.kind === "OK" ? before.value.length : -1;

    const failed = await full().createWorkerWithPrimaryTrade(
      { displayName: "SYNTHETIC-T-SHOULD-NOT-PERSIST", sourceOfRecord: "IMPORTED" },
      { tradeCode: "WELDING", occupationCode: "ELECTRICIAN" }, // mismatched pair -- must fail
    );
    expect(failed.kind).toBe("VALIDATION_ERROR");

    const after = await full().searchWorkers({ limit: 200, offset: 0 });
    const afterCount = after.kind === "OK" ? after.value.length : -1;
    expect(afterCount).toBe(beforeCount);
    expect(after.kind === "OK" ? after.value.some((w) => w.displayName === "SYNTHETIC-T-SHOULD-NOT-PERSIST") : true).toBe(false);

    const succeeded = await full().createWorkerWithPrimaryTrade(
      { displayName: "SYNTHETIC-T-PERSISTS", sourceOfRecord: "IMPORTED" },
      { tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN" },
    );
    expect(succeeded.kind).toBe("OK");
  });
});
