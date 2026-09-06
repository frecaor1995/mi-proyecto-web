import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateHumanVerificationTaskInput } from "../../domain/human-verification";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresHumanVerificationRepository } from "../../server/repositories/human-verification/postgres-human-verification-repository";
import { HUMAN_VERIFICATION_RULE_VERSION, HumanVerificationService } from "../../server/services/human-verification/human-verification-service";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresIdempotencyRepository } from "../../server/repositories/idempotency/postgres-idempotency-repository";
import { executeProtectedHumanVerificationTransition } from "../../server/mutation/protected-human-verification-transition";
import type { ServerSession } from "../../server/auth/session";

const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql", "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql", "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql", "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql", "20260904010000_human_verification_domain.sql",
  "20260905010000_operator_identity_and_safe_mutation.sql",
];

describe("3I-B3A concurrency and protected-mutation foundation", () => {
  let db: PGlite;
  let humanVerificationRepository: PostgresHumanVerificationRepository;
  let service: HumanVerificationService;
  let operatorRepository: PostgresOperatorRepository;
  let idempotencyRepository: PostgresIdempotencyRepository;
  let companyId: string;
  let authorizedOperatorAuthUserId: string;
  let sequence = 0;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    const client = db as unknown as SqlClient;
    humanVerificationRepository = new PostgresHumanVerificationRepository(client);
    service = new HumanVerificationService(humanVerificationRepository);
    operatorRepository = new PostgresOperatorRepository(client);
    idempotencyRepository = new PostgresIdempotencyRepository(client);
    companyId = (await db.query<{ id: string }>("insert into companies(common_name)values('B3A Company')returning id")).rows[0].id;
    authorizedOperatorAuthUserId = "11111111-1111-4111-8111-111111111111";
    await operatorRepository.create({ authUserId: authorizedOperatorAuthUserId, email: "operator@example.com", status: "ACTIVE", permissions: ["human_verification.write"] });
  });
  afterAll(async () => db.close());

  const newTask = async () => (await service.createTask({
    companyId, targetType: "OPPORTUNITY_CONFLICT", targetId: companyId,
    verificationObjective: `B3A task ${++sequence}`, questionType: "MANPOWER_ACCEPTANCE",
    primaryQuestion: "Does this company accept external manpower?", createdBy: "legacy:seed", ruleVersion: HUMAN_VERIFICATION_RULE_VERSION,
    scope: { companyScope: "UNKNOWN" },
  } satisfies CreateHumanVerificationTaskInput)).task;

  describe("concurrency guard (reuses the existing status column, no schema change)", () => {
    it("15/16. current expected state is accepted; a stale expectation is rejected without overwriting", async () => {
      const task = await newTask();
      const applied = await humanVerificationRepository.transitionTaskIfCurrentStatus(task.id, "OPEN", "ASSIGNED", { eventType: "STATE_CHANGED", oldState: "OPEN", newState: "ASSIGNED", reason: "claimed", operatorId: "human:operator", occurredAt: new Date() });
      expect(applied?.status).toBe("ASSIGNED");

      const stale = await humanVerificationRepository.transitionTaskIfCurrentStatus(task.id, "OPEN", "ATTEMPTED", { eventType: "STATE_CHANGED", oldState: "OPEN", newState: "ATTEMPTED", reason: "stale retry", operatorId: "human:operator", occurredAt: new Date() });
      expect(stale).toBeNull();
      expect((await humanVerificationRepository.getTask(task.id))?.status).toBe("ASSIGNED");
    });

    it("17. existing closed-task immutability is preserved by the guarded path too", async () => {
      const task = await newTask();
      await service.transitionTask(task.id, "CANCELLED", "human:operator", "no longer relevant");
      await expect(humanVerificationRepository.transitionTaskIfCurrentStatus(task.id, "CANCELLED", "ASSIGNED", { eventType: "STATE_CHANGED", oldState: "CANCELLED", newState: "ASSIGNED", reason: "reopen attempt", operatorId: "human:operator", occurredAt: new Date() }))
        .rejects.toThrow();
    });
  });

  describe("executeProtectedHumanVerificationTransition (full trust chain)", () => {
    const deps = () => ({ humanVerificationRepository, idempotencyRepository, operatorRepository });
    const session = (authUserId: string | null): (() => Promise<ServerSession | null>) => () => Promise.resolve(authUserId ? { authUserId, email: "operator@example.com" } : null);

    it("1. unauthenticated request rejected", async () => {
      const task = await newTask();
      const outcome = await executeProtectedHumanVerificationTransition(
        { idempotencyKey: `k-${task.id}-a`, taskId: task.id, expectedStatus: "OPEN", newStatus: "ASSIGNED", reason: "claim" },
        { ...deps(), getSession: session(null) },
      );
      expect(outcome).toEqual({ kind: "REJECTED", reason: "UNAUTHENTICATED" });
    });

    it("2. authenticated user without operator mapping rejected", async () => {
      const task = await newTask();
      const outcome = await executeProtectedHumanVerificationTransition(
        { idempotencyKey: `k-${task.id}-a`, taskId: task.id, expectedStatus: "OPEN", newStatus: "ASSIGNED", reason: "claim" },
        { ...deps(), getSession: session("99999999-9999-4999-8999-999999999999") },
      );
      expect(outcome).toEqual({ kind: "REJECTED", reason: "UNAUTHORIZED" });
    });

    it("4/6. an authorized operator executes the transition, and the resulting audit event carries the session-derived actor -- never a caller-supplied one", async () => {
      const task = await newTask();
      const outcome = await executeProtectedHumanVerificationTransition(
        { idempotencyKey: `k-${task.id}-exec`, taskId: task.id, expectedStatus: "OPEN", newStatus: "ASSIGNED", reason: "claim" },
        { ...deps(), getSession: session(authorizedOperatorAuthUserId) },
      );
      expect(outcome).toMatchObject({ kind: "EXECUTED", status: "ASSIGNED" });
      const events = await humanVerificationRepository.listTaskEvents(task.id);
      const operator = await operatorRepository.findByAuthUserId(authorizedOperatorAuthUserId);
      expect(events.some((event) => event.operatorId === operator?.id)).toBe(true);
    });

    it("8. an idempotent retry with the identical key and context replays the stored result rather than re-executing", async () => {
      const task = await newTask();
      const request = { idempotencyKey: `k-${task.id}-replay`, taskId: task.id, expectedStatus: "OPEN" as const, newStatus: "ASSIGNED" as const, reason: "claim" };
      const first = await executeProtectedHumanVerificationTransition(request, { ...deps(), getSession: session(authorizedOperatorAuthUserId) });
      const second = await executeProtectedHumanVerificationTransition(request, { ...deps(), getSession: session(authorizedOperatorAuthUserId) });
      expect(first).toMatchObject({ kind: "EXECUTED" });
      expect(second).toEqual({ kind: "REPLAYED", taskId: task.id, status: "ASSIGNED" });
      const events = (await humanVerificationRepository.listTaskEvents(task.id)).filter((event) => event.eventType === "STATE_CHANGED");
      expect(events).toHaveLength(1);
    });

    it("9. the same key reused with a different action/payload is a rejected conflict, not a silent second execution", async () => {
      const task = await newTask();
      const key = `k-${task.id}-conflict`;
      await executeProtectedHumanVerificationTransition({ idempotencyKey: key, taskId: task.id, expectedStatus: "OPEN", newStatus: "ASSIGNED", reason: "claim" }, { ...deps(), getSession: session(authorizedOperatorAuthUserId) });
      const conflicting = await executeProtectedHumanVerificationTransition({ idempotencyKey: key, taskId: task.id, expectedStatus: "OPEN", newStatus: "CANCELLED", reason: "different action" }, { ...deps(), getSession: session(authorizedOperatorAuthUserId) });
      expect(conflicting).toEqual({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT", detail: "PAYLOAD_MISMATCH" });
    });

    it("10/11. a stale submission is rejected safely, and retrying the same stale request replays the same rejection rather than duplicating work", async () => {
      const task = await newTask();
      const claimKey = `k-${task.id}-claim`;
      await executeProtectedHumanVerificationTransition({ idempotencyKey: claimKey, taskId: task.id, expectedStatus: "OPEN", newStatus: "ASSIGNED", reason: "claim" }, { ...deps(), getSession: session(authorizedOperatorAuthUserId) });

      const staleKey = `k-${task.id}-stale`;
      const staleRequest = { idempotencyKey: staleKey, taskId: task.id, expectedStatus: "OPEN" as const, newStatus: "ATTEMPTED" as const, reason: "stale caller" };
      const first = await executeProtectedHumanVerificationTransition(staleRequest, { ...deps(), getSession: session(authorizedOperatorAuthUserId) });
      const retry = await executeProtectedHumanVerificationTransition(staleRequest, { ...deps(), getSession: session(authorizedOperatorAuthUserId) });
      expect(first).toEqual({ kind: "REJECTED", reason: "STALE_STATE" });
      expect(retry).toEqual({ kind: "REJECTED", reason: "STALE_STATE" });
      expect((await humanVerificationRepository.getTask(task.id))?.status).toBe("ASSIGNED");
    });
  });
});
