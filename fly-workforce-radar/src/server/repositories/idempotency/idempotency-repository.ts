import type { ClaimIdempotencyKeyInput } from "../../../domain/idempotency";

export type IdempotencyClaim =
  | { readonly outcome: "CLAIMED" }
  | { readonly outcome: "REPLAY"; readonly result: unknown }
  /**
   * TX-INTEGRITY-04B: `claimedAt` is the row's own `created_at`, added as a minimal,
   * backward-compatible extra field (existing consumers that only check `.outcome`
   * are unaffected) so a recovery-capable caller can distinguish "was this row's
   * business effects, if any, created before or after this claim" without a
   * separate read -- see protected-human-verification-response-capture.ts's
   * recovery path.
   */
  | { readonly outcome: "IN_PROGRESS"; readonly claimedAt: Date }
  | { readonly outcome: "CONFLICT"; readonly reason: "ACTOR_MISMATCH" | "TARGET_MISMATCH" | "PAYLOAD_MISMATCH" | "TASK_CAPTURE_IN_PROGRESS" };

export interface IdempotencyRepository {
  /** Atomically claims the key for this context, or reports why it cannot be (replay/in-progress/conflict). Never duplicates a claim. */
  claim(input: ClaimIdempotencyKeyInput): Promise<IdempotencyClaim>;
  complete(idempotencyKey: string, result: unknown): Promise<void>;
}
