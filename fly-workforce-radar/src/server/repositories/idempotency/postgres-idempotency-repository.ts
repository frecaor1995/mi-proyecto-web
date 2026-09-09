import type { ClaimIdempotencyKeyInput } from "../../../domain/idempotency";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { IdempotencyClaim, IdempotencyRepository } from "./idempotency-repository";

type Row = Record<string, unknown>;

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly client: SqlClient) {}

  async claim(input: ClaimIdempotencyKeyInput): Promise<IdempotencyClaim> {
    const insert = await this.client.query<{ id: string }>(
      `insert into command_idempotency_keys(idempotency_key,operator_id,action,target_type,target_id,request_fingerprint)
       values($1,$2,$3,$4,$5,$6) on conflict(idempotency_key) do nothing returning id`,
      [input.idempotencyKey, input.operatorId, input.action, input.targetType, input.targetId, input.requestFingerprint],
    );
    if (insert.rows[0]) return { outcome: "CLAIMED" };

    const existing = await this.client.query<Row>(
      `select operator_id,action,target_type,target_id,request_fingerprint,result,created_at from command_idempotency_keys where idempotency_key=$1`,
      [input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) return { outcome: "CLAIMED" };
    if (String(row.operator_id) !== input.operatorId) return { outcome: "CONFLICT", reason: "ACTOR_MISMATCH" };
    if (String(row.target_type) !== input.targetType || String(row.target_id) !== input.targetId) return { outcome: "CONFLICT", reason: "TARGET_MISMATCH" };
    if (String(row.action) !== input.action || String(row.request_fingerprint) !== input.requestFingerprint) return { outcome: "CONFLICT", reason: "PAYLOAD_MISMATCH" };
    if (row.result == null) return { outcome: "IN_PROGRESS", claimedAt: new Date(String(row.created_at)) };
    return { outcome: "REPLAY", result: row.result };
  }

  async complete(idempotencyKey: string, result: unknown): Promise<void> {
    await this.client.query(`update command_idempotency_keys set result=$2::jsonb,completed_at=now() where idempotency_key=$1`, [idempotencyKey, JSON.stringify(result)]);
  }
}
