import type { ClaimIdempotencyKeyInput } from "../../../domain/idempotency";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { IdempotencyClaim, IdempotencyRepository } from "./idempotency-repository";

type Row = Record<string, unknown>;

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly client: SqlClient) {}

  async claim(input: ClaimIdempotencyKeyInput): Promise<IdempotencyClaim> {
    // TX-INTEGRITY-05B. A target-level partial unique index can make an
    // otherwise-valid INSERT lose to a different active idempotency key. Use
    // unqualified DO NOTHING so either uniqueness invariant is handled here,
    // then identify which invariant won. Two bounded attempts close the case
    // where the target owner completes between the failed INSERT and lookup.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const insert = await this.client.query<{ id: string }>(
        `insert into command_idempotency_keys(idempotency_key,operator_id,action,target_type,target_id,request_fingerprint)
         values($1,$2,$3,$4,$5,$6) on conflict do nothing returning id`,
        [input.idempotencyKey, input.operatorId, input.action, input.targetType, input.targetId, input.requestFingerprint],
      );
      if (insert.rows[0]) return { outcome: "CLAIMED" };

      const existing = await this.client.query<Row>(
        `select operator_id,action,target_type,target_id,request_fingerprint,result,created_at from command_idempotency_keys where idempotency_key=$1`,
        [input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (row) {
        if (String(row.operator_id) !== input.operatorId) return { outcome: "CONFLICT", reason: "ACTOR_MISMATCH" };
        if (String(row.target_type) !== input.targetType || String(row.target_id) !== input.targetId) return { outcome: "CONFLICT", reason: "TARGET_MISMATCH" };
        if (String(row.action) !== input.action || String(row.request_fingerprint) !== input.requestFingerprint) return { outcome: "CONFLICT", reason: "PAYLOAD_MISMATCH" };
        if (row.result == null) return { outcome: "IN_PROGRESS", claimedAt: new Date(String(row.created_at)) };
        return { outcome: "REPLAY", result: row.result };
      }

      if (input.action === "human_verification.capture_response" && input.targetType === "HUMAN_VERIFICATION_TASK") {
        const activeOwner = await this.client.query<{ idempotency_key: string }>(
          `select idempotency_key from command_idempotency_keys
            where action=$1 and target_type=$2 and target_id=$3 and result is null
            limit 1`,
          [input.action, input.targetType, input.targetId],
        );
        if (activeOwner.rows[0]) return { outcome: "CONFLICT", reason: "TASK_CAPTURE_IN_PROGRESS" };
      }
    }
    throw new Error("Idempotency claim conflict could not be resolved after bounded re-evaluation");
  }

  async complete(idempotencyKey: string, result: unknown): Promise<void> {
    await this.client.query(`update command_idempotency_keys set result=$2::jsonb,completed_at=now() where idempotency_key=$1`, [idempotencyKey, JSON.stringify(result)]);
  }
}
