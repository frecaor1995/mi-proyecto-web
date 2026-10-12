import type { OperatorPermission } from "../../domain/operator";
import { getProductionSqlClient } from "../database/production-sql-client";
import type { OperatorRepository } from "../repositories/operator/operator-repository";
import { PostgresOperatorRepository } from "../repositories/operator/postgres-operator-repository";
import { resolveServerSession, type ServerSession } from "./session";

export interface AuthorizedOperator {
  readonly operatorId: string;
  readonly authUserId: string;
  readonly email: string;
  readonly permissions: readonly OperatorPermission[];
}

export type AuthorizationResult =
  | { readonly state: "UNAUTHENTICATED" }
  | { readonly state: "AUTHENTICATED_BUT_UNAUTHORIZED"; readonly authUserId: string; readonly email: string | null }
  | { readonly state: "AUTHORIZED"; readonly operator: AuthorizedOperator };

export type ActiveOperatorResult =
  | { readonly state: "UNAUTHENTICATED" }
  | { readonly state: "AUTHENTICATED_BUT_UNAUTHORIZED"; readonly authUserId: string; readonly email: string | null }
  | { readonly state: "ACTIVE_OPERATOR"; readonly operator: AuthorizedOperator };

/** Fails closed: with no database connection configured, an authenticated session still resolves to AUTHENTICATED_BUT_UNAUTHORIZED, never AUTHORIZED. */
function defaultOperatorRepository(): OperatorRepository | null {
  const client = getProductionSqlClient();
  return client ? new PostgresOperatorRepository(client) : null;
}

/** Global identity-to-active-operator boundary; deliberately does not grant any permission. */
export async function resolveActiveOperator(
  deps: { readonly getSession?: () => Promise<ServerSession | null>; readonly repository?: OperatorRepository | null } = {},
): Promise<ActiveOperatorResult> {
  const session = await (deps.getSession ?? resolveServerSession)();
  if (!session) return { state: "UNAUTHENTICATED" };
  const repository = deps.repository !== undefined ? deps.repository : defaultOperatorRepository();
  const record = repository ? await repository.findByAuthUserId(session.authUserId) : null;
  if (!record || record.status !== "ACTIVE") {
    return { state: "AUTHENTICATED_BUT_UNAUTHORIZED", authUserId: session.authUserId, email: session.email };
  }
  return {
    state: "ACTIVE_OPERATOR",
    operator: { operatorId: record.id, authUserId: record.authUserId, email: record.email, permissions: record.permissions },
  };
}

/**
 * Centralized authorization boundary (3I-B3A). AUTHENTICATED != AUTHORIZED:
 * a real Supabase session only ever proves identity; whether that identity
 * maps to an active, permitted internal operator is decided here, once, on
 * the server -- callers (future B3 application services) must go through
 * this before entering repository mutation code. Never trusts a browser-
 * supplied actor field; the only external input is the `permission` to
 * check and optional dependency overrides for tests.
 */
export async function authorizeOperator(
  permission: OperatorPermission,
  deps: { readonly getSession?: () => Promise<ServerSession | null>; readonly repository?: OperatorRepository | null } = {},
): Promise<AuthorizationResult> {
  const getSession = deps.getSession ?? resolveServerSession;
  const session = await getSession();
  if (!session) return { state: "UNAUTHENTICATED" };

  const repository = deps.repository !== undefined ? deps.repository : defaultOperatorRepository();
  const operatorRecord = repository ? await repository.findByAuthUserId(session.authUserId) : null;
  if (!operatorRecord || operatorRecord.status !== "ACTIVE" || !operatorRecord.permissions.includes(permission)) {
    return { state: "AUTHENTICATED_BUT_UNAUTHORIZED", authUserId: session.authUserId, email: session.email };
  }
  return {
    state: "AUTHORIZED",
    operator: { operatorId: operatorRecord.id, authUserId: operatorRecord.authUserId, email: operatorRecord.email, permissions: operatorRecord.permissions },
  };
}
