import { resolveActiveOperator } from "../auth/authorization";
import { getProductionSqlClient } from "../database/production-sql-client";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { listPursuits, loadCompanyCommercial, loadPursuit, type PursuitView } from "./pursuit-store";

/**
 * Read side of the commercial pursuit pages. Viewing needs an active operator; writing needs
 * "commercial_pursuit.write"; a referring worker's NAME is shown only with "worker_profile.read" (otherwise only that a
 * worker reported it). Nothing on these pages contacts anyone.
 */
export interface PursuitPermissions { readonly canWrite: boolean; readonly canReadWorkers: boolean; readonly canExecuteMatching: boolean; readonly operatorId: string }
export type PageState<T> = { readonly state: "READY"; readonly value: T; readonly permissions: PursuitPermissions } | { readonly state: "UNAUTHENTICATED" | "UNAUTHORIZED" | "UNAVAILABLE" | "NOT_FOUND" };

async function access(): Promise<{ readonly client: SqlClient; readonly permissions: PursuitPermissions } | { readonly state: "UNAUTHENTICATED" | "UNAUTHORIZED" | "UNAVAILABLE" }> {
  const operator = await resolveActiveOperator();
  if (operator.state === "UNAUTHENTICATED") return { state: "UNAUTHENTICATED" };
  if (operator.state !== "ACTIVE_OPERATOR") return { state: "UNAUTHORIZED" };
  const client = getProductionSqlClient();
  if (!client) return { state: "UNAVAILABLE" };
  const has = (permission: string) => operator.operator.permissions.includes(permission as never);
  return { client, permissions: { canWrite: has("commercial_pursuit.write"), canReadWorkers: has("worker_profile.read"), canExecuteMatching: has("matching.execute"), operatorId: operator.operator.operatorId } };
}

async function operators(client: SqlClient) {
  return (await client.query<{ id: string; label: string }>("select id, coalesce(display_name, email) as label from workforce_operators where status='ACTIVE' order by 2")).rows;
}

async function workerNames(client: SqlClient, ids: readonly string[], allowed: boolean): Promise<Readonly<Record<string, string>>> {
  if (!allowed || !ids.length) return {};
  // Display name only — no contact, compensation, identity or authorization data is read here.
  return Object.fromEntries((await client.query<{ id: string; display_name: string }>("select id, display_name from workforce_workers where id = any($1::uuid[])", [ids])).rows.map((r) => [r.id, r.display_name]));
}

export interface PursuitPageData { readonly view: PursuitView; readonly operators: readonly { readonly id: string; readonly label: string }[]; readonly workerNames: Readonly<Record<string, string>> }
export async function getPursuitPage(opportunityId: string, today: string): Promise<PageState<PursuitPageData>> {
  const ctx = await access();
  if ("state" in ctx) return { state: ctx.state };
  const view = await loadPursuit(ctx.client, opportunityId, today);
  if (!view) return { state: "NOT_FOUND" };
  const ids = [...new Set(view.painSignals.map((p) => p.reportedByWorkerId).filter((id): id is string => Boolean(id)))];
  return { state: "READY", permissions: ctx.permissions, value: { view, operators: await operators(ctx.client), workerNames: await workerNames(ctx.client, ids, ctx.permissions.canReadWorkers) } };
}

export interface OpportunityPursuitEntry { readonly mode: "START" | "OPEN"; readonly href: string }
/** Uses the same pursuit read model as the detail workspace; no second pursuit state is introduced. */
export async function getOpportunityPursuitEntry(opportunityId: string, today: string): Promise<PageState<OpportunityPursuitEntry>> {
  if (!/^[0-9a-f-]{36}$/i.test(opportunityId)) return { state: "NOT_FOUND" };
  const result = await getPursuitPage(opportunityId, today);
  if (result.state !== "READY") return result;
  return {
    state: "READY",
    permissions: result.permissions,
    value: { mode: result.value.view.pipeline.status === "NOT_PURSUED" ? "START" : "OPEN", href: `/opportunities/${opportunityId}/pursuit` },
  };
}

export async function getPursuitList(today: string) {
  const ctx = await access();
  if ("state" in ctx) return { state: ctx.state } as const;
  const list = await listPursuits(ctx.client, today);
  return { state: "READY", permissions: ctx.permissions, value: { ...list, operators: await operators(ctx.client) } } as const;
}

export interface CompanyCommercialData extends Awaited<ReturnType<typeof loadCompanyCommercial>> {
  readonly workers: readonly { readonly id: string; readonly label: string }[];
  readonly workerNames: Readonly<Record<string, string>>;
  readonly companyName: string;
}
export async function getCompanyCommercial(companyId: string, today: string): Promise<PageState<CompanyCommercialData>> {
  const ctx = await access();
  if ("state" in ctx) return { state: ctx.state };
  const data = await loadCompanyCommercial(ctx.client, companyId, today);
  const workers = ctx.permissions.canReadWorkers
    ? (await ctx.client.query<{ id: string; label: string }>("select id, display_name as label from workforce_workers where lifecycle_status='ACTIVE' order by display_name")).rows : [];
  const ids = [...new Set(data.painSignals.map((p) => p.reportedByWorkerId).filter((id): id is string => Boolean(id)))];
  const name = (await ctx.client.query<{ name: string | null }>("select coalesce(common_name, legal_name) as name from companies where id=$1", [companyId])).rows[0]?.name ?? "";
  return { state: "READY", permissions: ctx.permissions, value: { ...data, workers, companyName: name, workerNames: await workerNames(ctx.client, ids, ctx.permissions.canReadWorkers) } };
}
