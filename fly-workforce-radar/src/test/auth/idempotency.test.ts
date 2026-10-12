import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresIdempotencyRepository } from "../../server/repositories/idempotency/postgres-idempotency-repository";

const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql", "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql", "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql", "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql", "20260904010000_human_verification_domain.sql",
  "20260905010000_operator_identity_and_safe_mutation.sql",
  "20260910070755_tx_integrity_05b_active_response_capture_task_guard.sql",
];

describe("3I-B3A idempotency foundation", () => {
  let db: PGlite;
  let idempotency: PostgresIdempotencyRepository;
  let operatorAId: string;
  let operatorBId: string;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    const client = db as unknown as SqlClient;
    idempotency = new PostgresIdempotencyRepository(client);
    const operators = new PostgresOperatorRepository(client);
    operatorAId = (await operators.create({ authUserId: "11111111-1111-4111-8111-111111111111", email: "a@example.com", permissions: ["human_verification.write"] })).id;
    operatorBId = (await operators.create({ authUserId: "22222222-2222-4222-8222-222222222222", email: "b@example.com", permissions: ["human_verification.write"] })).id;
  });
  afterAll(async () => db.close());

  const context = (overrides: Partial<Parameters<PostgresIdempotencyRepository["claim"]>[0]> = {}) => ({
    idempotencyKey: "key-1", operatorId: operatorAId, action: "human_verification.transition_task",
    targetType: "HUMAN_VERIFICATION_TASK", targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", requestFingerprint: "fingerprint-1",
    ...overrides,
  });

  it("8/9. a fresh key claims, and completing then replaying the identical context returns the stored result without re-executing", async () => {
    expect(await idempotency.claim(context())).toEqual({ outcome: "CLAIMED" });
    await idempotency.complete("key-1", { taskId: "t1", status: "ATTEMPTED" });
    expect(await idempotency.claim(context())).toEqual({ outcome: "REPLAY", result: { taskId: "t1", status: "ATTEMPTED" } });
  });

  it("13/14. conflicting reuse is rejected, never silently applied -- distinct reasons for actor, target, and payload mismatches", async () => {
    await idempotency.claim(context({ idempotencyKey: "key-2" }));
    await idempotency.complete("key-2", { ok: true });
    expect(await idempotency.claim(context({ idempotencyKey: "key-2", operatorId: operatorBId }))).toEqual({ outcome: "CONFLICT", reason: "ACTOR_MISMATCH" });
    expect(await idempotency.claim(context({ idempotencyKey: "key-2", targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }))).toEqual({ outcome: "CONFLICT", reason: "TARGET_MISMATCH" });
    expect(await idempotency.claim(context({ idempotencyKey: "key-2", requestFingerprint: "different-fingerprint" }))).toEqual({ outcome: "CONFLICT", reason: "PAYLOAD_MISMATCH" });
  });

  it("a key claimed but never completed reports IN_PROGRESS rather than being re-executed or silently replayed", async () => {
    await idempotency.claim(context({ idempotencyKey: "key-3" }));
    expect(await idempotency.claim(context({ idempotencyKey: "key-3" }))).toMatchObject({ outcome: "IN_PROGRESS", claimedAt: expect.any(Date) });
  });

  it("no fuzzy dedupe: two different logical actions never collide just because their keys differ", async () => {
    await idempotency.claim(context({ idempotencyKey: "key-4a" }));
    expect(await idempotency.claim(context({ idempotencyKey: "key-4b" }))).toEqual({ outcome: "CLAIMED" });
  });

  it("TX-05B: a different active response-capture key cannot claim the same task", async () => {
    const targetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const first = context({ idempotencyKey: "capture-key-a", action: "human_verification.capture_response", targetId });
    const second = context({ idempotencyKey: "capture-key-b", action: "human_verification.capture_response", targetId, requestFingerprint: "fingerprint-b" });
    expect(await idempotency.claim(first)).toEqual({ outcome: "CLAIMED" });
    expect(await idempotency.claim(second)).toEqual({ outcome: "CONFLICT", reason: "TASK_CAPTURE_IN_PROGRESS" });
  });

  it("TX-05B: completion releases active task ownership for a bounded re-evaluation", async () => {
    const targetId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const first = context({ idempotencyKey: "capture-complete-a", action: "human_verification.capture_response", targetId });
    const second = context({ idempotencyKey: "capture-complete-b", action: "human_verification.capture_response", targetId, requestFingerprint: "fingerprint-b" });
    expect(await idempotency.claim(first)).toEqual({ outcome: "CLAIMED" });
    await idempotency.complete(first.idempotencyKey, { kind: "EXECUTED" });
    expect(await idempotency.claim(second)).toEqual({ outcome: "CLAIMED" });
  });

  it("TX-05B: bounded re-evaluation claims when the prior owner completes between conflict and lookup", async () => {
    let insertAttempts = 0;
    const client: SqlClient = {
      async query<Row>(text: string) {
        if (/insert into command_idempotency_keys/i.test(text)) {
          insertAttempts += 1;
          return { rows: (insertAttempts === 2 ? [{ id: "new-owner" }] : []) as Row[] };
        }
        return { rows: [] };
      },
    };
    const repository = new PostgresIdempotencyRepository(client);
    expect(await repository.claim(context({ idempotencyKey: "visibility-race", action: "human_verification.capture_response" })))
      .toEqual({ outcome: "CLAIMED" });
    expect(insertAttempts).toBe(2);
  });

  it("TX-05B migration fails clearly rather than choosing among duplicate active task owners", async () => {
    const isolated = new PGlite();
    try {
      for (const migration of migrations.slice(0, -1)) await isolated.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
      const operatorId = String((await isolated.query<{ id: string }>("insert into workforce_operators(auth_user_id,email,permissions) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','migration@example.com','{}') returning id")).rows[0].id);
      const targetId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
      await isolated.query(
        "insert into command_idempotency_keys(idempotency_key,operator_id,action,target_type,target_id,request_fingerprint) values('duplicate-a',$1,'human_verification.capture_response','HUMAN_VERIFICATION_TASK',$2,'a'),('duplicate-b',$1,'human_verification.capture_response','HUMAN_VERIFICATION_TASK',$2,'b')",
        [operatorId, targetId],
      );
      await expect(isolated.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migrations.at(-1)!), "utf8")))
        .rejects.toThrow(/duplicate active response-capture claims exist/);
    } finally {
      await isolated.close();
    }
  });
});
