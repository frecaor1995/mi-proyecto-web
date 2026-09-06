import type { ClaimIdempotencyKeyInput } from "../../../domain/idempotency";

export type IdempotencyClaim =
  | { readonly outcome: "CLAIMED" }
  | { readonly outcome: "REPLAY"; readonly result: unknown }
  | { readonly outcome: "IN_PROGRESS" }
  | { readonly outcome: "CONFLICT"; readonly reason: "ACTOR_MISMATCH" | "TARGET_MISMATCH" | "PAYLOAD_MISMATCH" };

export interface IdempotencyRepository {
  /** Atomically claims the key for this context, or reports why it cannot be (replay/in-progress/conflict). Never duplicates a claim. */
  claim(input: ClaimIdempotencyKeyInput): Promise<IdempotencyClaim>;
  complete(idempotencyKey: string, result: unknown): Promise<void>;
}
