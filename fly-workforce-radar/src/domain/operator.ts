export const OPERATOR_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

/**
 * 3I-B3A defined the first permission; Phase 4G adds one narrow second
 * permission for protected commercial economics writes ("commercial_economics.write").
 * Each permission authorizes only its own domain's specific protected
 * mutations -- extend narrowly, never as a generic RBAC platform, and never
 * let one permission implicitly authorize another domain's writes.
 */
export const OPERATOR_PERMISSIONS = ["human_verification.write", "commercial_economics.write"] as const;
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
