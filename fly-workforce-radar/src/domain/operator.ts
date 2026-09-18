export const OPERATOR_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

/**
 * 3I-B3A defined the first permission; Phase 4G added one narrow second
 * permission for protected commercial economics writes ("commercial_economics.write").
 * Phase 4J adds a distinct decision authority ("commercial_economics.decide")
 * so entering/calculating economics never implicitly authorizes a consequential
 * human business disposition.
 * Each permission authorizes only its own domain's specific protected
 * mutations -- extend narrowly, never as a generic RBAC platform, and never
 * let one permission implicitly authorize another domain's writes.
 * WORKFORCE-TALENT-A3 adds three worker-domain permission pairs matching the
 * three sensitivity tiers certified in A2-A/A2-B: general profile facts,
 * contact routes (highest sensitivity), and compensation expectations
 * (commercial-sensitive) -- kept as distinct permissions rather than one
 * broad "worker.admin" so a caller can hold profile access without ever
 * being able to read or write contact or compensation data.
 */
export const OPERATOR_PERMISSIONS = [
  "human_verification.write",
  "commercial_economics.write",
  "commercial_economics.decide",
  "worker_profile.read",
  "worker_profile.write",
  "worker_contact.read",
  "worker_contact.write",
  "worker_compensation.read",
  "worker_compensation.write",
] as const;
export type OperatorPermission = (typeof OPERATOR_PERMISSIONS)[number];

export interface CreateOperatorInput {
  authUserId: string;
  email: string;
  displayName?: string | null;
  status?: OperatorStatus;
  permissions?: OperatorPermission[];
}
export interface OperatorRecord extends CreateOperatorInput {
  id: string;
  displayName: string | null;
  status: OperatorStatus;
  permissions: OperatorPermission[];
  createdAt: Date;
  updatedAt: Date;
}
