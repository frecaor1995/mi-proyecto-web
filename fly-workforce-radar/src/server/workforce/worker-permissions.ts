import type { OperatorPermission } from "../../domain/operator";
import { authorizeOperator } from "../auth/authorization";
import type { ServerSession } from "../auth/session";
import type { OperatorRepository } from "../repositories/operator/operator-repository";

export interface WorkerUiPermissions {
  readonly authenticated: boolean;
  readonly profileRead: boolean;
  readonly profileWrite: boolean;
  readonly contactRead: boolean;
  readonly contactWrite: boolean;
  readonly compensationRead: boolean;
  readonly compensationWrite: boolean;
}

const NONE: WorkerUiPermissions = {
  authenticated: false, profileRead: false, profileWrite: false,
  contactRead: false, contactWrite: false, compensationRead: false, compensationWrite: false,
};

/**
 * One authorization round trip resolves every worker_* permission the UI
 * needs to decide what to fetch and render -- never a separate
 * authorizeOperator() call per section. UI checks here are defense-in-depth
 * and UX only; every mutation and every WorkerService read independently
 * re-authorizes server-side regardless of what this returns.
 */
export async function resolveWorkerUiPermissions(deps: { readonly getSession?: () => Promise<ServerSession | null>; readonly repository?: OperatorRepository | null } = {}): Promise<WorkerUiPermissions> {
  const result = await authorizeOperator("worker_profile.read", deps);
  if (result.state !== "AUTHORIZED") return { ...NONE, authenticated: result.state !== "UNAUTHENTICATED" };
  const has = (permission: OperatorPermission) => result.operator.permissions.includes(permission);
  return {
    authenticated: true,
    profileRead: true,
    profileWrite: has("worker_profile.write"),
    contactRead: has("worker_contact.read"),
    contactWrite: has("worker_contact.write"),
    compensationRead: has("worker_compensation.read"),
    compensationWrite: has("worker_compensation.write"),
  };
}
