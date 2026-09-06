export const OPERATOR_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

/** 3I-B3A: the only permission this foundation defines. Extend narrowly, never as a generic RBAC platform. */
export const OPERATOR_PERMISSIONS = ["human_verification.write"] as const;
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
