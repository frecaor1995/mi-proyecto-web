import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";

export type ReleaseCheckStatus = "PASS" | "FAIL";
export interface ReleaseCheck { readonly name: string; readonly status: ReleaseCheckStatus; readonly detail: string }

type RuntimeRow = { current_user: string; rolsuper: boolean; rolbypassrls: boolean; runtime_member: boolean };
type CountRow = { count: string | number };

/** Read-only production release verification. It reports identities/counts, never connection details. */
export async function verifyDatabaseReleaseControls(
  client: SqlClient,
  expectedMigrationVersions: readonly string[],
): Promise<readonly ReleaseCheck[]> {
  const checks: ReleaseCheck[] = [];
  try {
    await client.query("select 1");
    checks.push({ name: "database_reachable", status: "PASS", detail: "read round-trip succeeded" });
  } catch {
    return [{ name: "database_reachable", status: "FAIL", detail: "read round-trip failed" }];
  }

  const runtime = (await client.query<RuntimeRow>(`
    select current_user, r.rolsuper, r.rolbypassrls,
      pg_has_role(current_user, 'fly_workforce_runtime', 'member') as runtime_member
    from pg_roles r where r.rolname = current_user
  `)).rows[0];
  checks.push({ name: "restricted_runtime_role", status: runtime && !runtime.rolsuper && !runtime.rolbypassrls && runtime.runtime_member ? "PASS" : "FAIL", detail: runtime?.current_user ?? "runtime identity unavailable" });

  const tables = (await client.query<CountRow>(`
    select count(*)::text as count from information_schema.tables
    where table_schema='public' and table_name = any($1::text[])
  `, [["workforce_operators", "opportunities", "workforce_demands", "workforce_workers", "worker_demand_engagements"]])).rows[0];
  checks.push({ name: "expected_schema", status: Number(tables?.count) === 5 ? "PASS" : "FAIL", detail: `${Number(tables?.count ?? 0)}/5 required tables present` });

  const migrations = (await client.query<{ version: string }>(
    "select version::text from supabase_migrations.schema_migrations where version = any($1::text[])",
    [expectedMigrationVersions],
  )).rows;
  checks.push({ name: "certified_migrations", status: migrations.length === expectedMigrationVersions.length ? "PASS" : "FAIL", detail: `${migrations.length}/${expectedMigrationVersions.length} certified migrations applied` });

  const leakage = (await client.query<CountRow>(`
    select count(*)::text as count from information_schema.role_table_grants
    where table_schema='public' and grantee in ('PUBLIC','anon','authenticated')
  `)).rows[0];
  checks.push({ name: "public_table_privilege_leakage", status: Number(leakage?.count) === 0 ? "PASS" : "FAIL", detail: `${Number(leakage?.count ?? 0)} prohibited grants` });

  const routineLeakage = (await client.query<CountRow>(`
    select count(*)::text as count from information_schema.routine_privileges
    where routine_schema='public' and grantee in ('PUBLIC','anon','authenticated')
  `)).rows[0];
  checks.push({ name: "public_routine_privilege_leakage", status: Number(routineLeakage?.count) === 0 ? "PASS" : "FAIL", detail: `${Number(routineLeakage?.count ?? 0)} prohibited routine grants` });

  const runtimeGrants = (await client.query<CountRow>(`
    select count(distinct table_name)::text as count from information_schema.role_table_grants
    where table_schema='public' and grantee='fly_workforce_runtime' and privilege_type='SELECT'
      and table_name = any($1::text[])
  `, [["workforce_operators", "opportunities", "workforce_demands", "workforce_workers", "worker_demand_engagements"]])).rows[0];
  checks.push({ name: "expected_runtime_grants", status: Number(runtimeGrants?.count) === 5 ? "PASS" : "FAIL", detail: `${Number(runtimeGrants?.count ?? 0)}/5 required read grants present` });

  const rls = (await client.query<CountRow>(`
    select count(*)::text as count from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
      and c.relname = any($1::text[])
  `, [["workforce_operators", "opportunities", "workforce_demands", "workforce_workers", "worker_demand_engagements"]])).rows[0];
  checks.push({ name: "rls_enabled", status: Number(rls?.count) === 0 ? "PASS" : "FAIL", detail: `${Number(rls?.count ?? 0)} required tables without RLS` });
  const policies = (await client.query<CountRow>(`
    select count(distinct tablename)::text as count from pg_policies
    where schemaname='public' and roles::text like '%fly_workforce_runtime%'
      and tablename = any($1::text[])
  `, [["workforce_operators", "opportunities", "workforce_demands", "workforce_workers", "worker_demand_engagements"]])).rows[0];
  checks.push({ name: "runtime_rls_policies", status: Number(policies?.count) === 5 ? "PASS" : "FAIL", detail: `${Number(policies?.count ?? 0)}/5 required tables covered by runtime policies` });
  return checks;
}

export function releaseChecksPass(checks: readonly ReleaseCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.status === "PASS");
}
