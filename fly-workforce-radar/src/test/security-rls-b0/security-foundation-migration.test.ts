import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260915022837_security_rls_b0_foundation.sql"),
  "utf8",
).toLowerCase();
const routineDefaultsMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260915024424_security_rls_b0_r1_public_routine_defaults.sql"),
  "utf8",
).toLowerCase();
const routineDefaultsSql = routineDefaultsMigration.replace(/^\s*--.*$/gm, "");
const globalRoutineDefaultsMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260915024716_security_rls_b0_r1_global_routine_defaults.sql"),
  "utf8",
).toLowerCase();
const globalRoutineDefaultsSql = globalRoutineDefaultsMigration.replace(/^\s*--.*$/gm, "");

describe("SECURITY-RLS-B0 foundation migration", () => {
  it("removes current and future public Data API privileges", () => {
    expect(migration).toContain(
      "revoke all privileges on all tables in schema public from anon, authenticated",
    );
    expect(migration).toContain(
      "alter default privileges for role postgres in schema public",
    );
    expect(migration).toContain(
      "alter default privileges for role supabase_admin in schema public",
    );
  });

  it("defines a credential-free restricted runtime role", () => {
    expect(migration).toContain("create role fly_workforce_runtime");
    expect(migration).toContain("nologin");
    expect(migration).toContain("nobypassrls");
    expect(migration).toContain("nosuperuser");
    expect(migration).not.toMatch(/password\s+/);
  });

  it("does not grant runtime mutation of operator authorization", () => {
    const runtimeWriteGrant = migration.match(
      /grant insert, update on table([\s\S]*?)to fly_workforce_runtime/,
    );
    expect(runtimeWriteGrant).not.toBeNull();
    expect(runtimeWriteGrant?.[1]).not.toContain("workforce_operators");
  });

  it("does not bulk-enable RLS or add permissive policies", () => {
    expect(migration).not.toContain("enable row level security");
    expect(migration).not.toContain("create policy");
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/);
  });

  it("removes inherited PUBLIC execution from current and future routines", () => {
    expect(routineDefaultsMigration).toContain(
      "revoke execute on all routines in schema public from public",
    );
    expect(routineDefaultsMigration).toContain(
      "alter default privileges for role postgres in schema public",
    );
    expect(routineDefaultsMigration).toContain(
      "alter default privileges for role supabase_admin in schema public",
    );
    expect(routineDefaultsMigration).not.toContain("grant execute");
    expect(globalRoutineDefaultsMigration).toContain(
      "alter default privileges for role postgres\n  revoke execute on functions from public",
    );
    expect(globalRoutineDefaultsMigration).toContain(
      "alter default privileges for role supabase_admin\n  revoke execute on functions from public",
    );
    expect(globalRoutineDefaultsSql).not.toContain("in schema");
    expect(`${routineDefaultsSql}\n${globalRoutineDefaultsSql}`).not.toMatch(
      /from\s+(anon|authenticated|service_role|fly_workforce_runtime)/,
    );
    expect(`${routineDefaultsSql}\n${globalRoutineDefaultsSql}`).not.toContain("security definer");
  });
});
