/**
 * 3I-B3A safe-mutation foundation. A logical submission is identified by a
 * caller-supplied `idempotencyKey`; the stored context (operator/action/
 * target/payload fingerprint) is compared on every reuse so retries replay
 * safely and any mismatch is a rejected conflict, never a silent overwrite.
 */
export interface ClaimIdempotencyKeyInput {
  idempotencyKey: string;
  operatorId: string;
  action: string;
  targetType: string;
  targetId: string;
  requestFingerprint: string;
}
export interface IdempotencyKeyRecord extends ClaimIdempotencyKeyInput {
  id: string;
  result: unknown | null;
  createdAt: Date;
  completedAt: Date | null;
}
