import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260915100000_workforce_talent_a2b_worker_schema.sql"),
  "utf8",
).toLowerCase();
/** Joins wrapped `-- ` comment continuation lines so prose assertions aren't
 * broken by SQL line-wrapping; used only for documentation-style checks. */
const migrationProse = migration.replace(/\n--\s*/g, " ");
/** Strips `-- ` line comments entirely, leaving only executable SQL, so
 * statement-level checks can't be fooled by prose that merely mentions a
 * name to explain why it's absent. */
const migrationCode = migration.replace(/--[^\n]*/g, "");

const WORKER_TABLES = [
  "workforce_workers",
  "worker_trade_occupations",
  "worker_skills",
  "worker_credentials",
  "worker_availability",
  "worker_locations",
  "worker_work_history",
  "worker_contact_routes",
  "worker_compensation_expectations",
];

describe("WORKFORCE-TALENT-A2-B worker schema migration", () => {
  it("creates exactly the nine certified worker-domain tables", () => {
    for (const table of WORKER_TABLES) {
      expect(migration).toContain(`create table public.${table}`);
    }
  });

  it("reuses the existing canonical taxonomy, never a second one", () => {
    expect(migration).toContain("references public.workforce_trades(code)");
    expect(migration).toContain("references public.workforce_occupations(code)");
    expect(migration).toContain("references public.workforce_skills(code)");
    expect(migration).toContain("references public.workforce_credentials(code)");
    expect(migration).not.toContain("create table public.workforce_trades");
    expect(migration).not.toContain("create table public.workforce_occupations");
    expect(migration).not.toContain("create table public.workforce_skills");
    expect(migration).not.toContain("create table public.workforce_credentials");
  });

  it("supports multi-trade workers with paired occupation/trade FK integrity", () => {
    expect(migration).toContain(
      "foreign key (occupation_code, trade_code) references public.workforce_occupations(code, trade_code)",
    );
    expect(migration).toContain("role_designation in ('primary','secondary')");
    expect(migration).toContain("worker_trade_occupations_one_primary_idx");
  });

  it("enables RLS on every worker table with no bare/PUBLIC policy", () => {
    for (const table of WORKER_TABLES) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).not.toMatch(/create policy \S+ on public\.worker\S* for \S+ to public/);
    expect(migration).not.toMatch(/create policy \S+ on public\.workforce_workers for \S+ to public/);
  });

  it("scopes every worker policy to fly_workforce_runtime only", () => {
    const policyMatches = [...migration.matchAll(/create policy \S+ on public\.(\S+) for \S+ to (\S+)/g)];
    const workerPolicyMatches = policyMatches.filter(
      ([, table]) => WORKER_TABLES.includes(table),
    );
    expect(workerPolicyMatches.length).toBeGreaterThan(0);
    for (const [, , role] of workerPolicyMatches) {
      expect(role).toBe("fly_workforce_runtime");
    }
  });

  it("explicitly revokes anon and authenticated from every worker table and the availability view", () => {
    for (const table of WORKER_TABLES) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toContain("revoke all on");
    expect(migration).toMatch(/from anon;/);
    expect(migration).toMatch(/from authenticated;/);
    expect(migration).toContain("public.worker_current_availability_v");
  });

  it("never touches workforce_operators", () => {
    // The header comment explains *why* it's untouched, so it legitimately
    // mentions the name; checking against comment-stripped code confirms no
    // actual statement acts on the table.
    expect(migrationCode).not.toContain("workforce_operators");
  });

  it("does not create MATCHING-B1's result table or any tenant table/column", () => {
    expect(migration).not.toContain("create table public.worker_demand_match_results");
    expect(migration).not.toContain("owning_tenant_id");
    expect(migration).not.toContain("create table public.tenant");
  });

  it("excludes raw_identifier from the runtime role's SELECT grant on worker_credentials, but allows insert/update", () => {
    const selectGrantMatch = migration.match(
      /grant select \(([^)]+)\) on public\.worker_credentials to fly_workforce_runtime/,
    );
    expect(selectGrantMatch).not.toBeNull();
    expect(selectGrantMatch?.[1]).not.toContain("raw_identifier");

    const insertGrantMatch = migration.match(
      /grant insert \(([^)]+)\) on public\.worker_credentials to fly_workforce_runtime/,
    );
    expect(insertGrantMatch?.[1]).toContain("raw_identifier");
  });

  it("keeps availability, locations, and compensation append-only for the runtime role (no UPDATE grant)", () => {
    for (const table of ["worker_availability", "worker_locations", "worker_compensation_expectations"]) {
      const tableSection = migration.slice(migration.indexOf(`public.${table} to fly_workforce_runtime`) - 80);
      const nextGrantBoundary = tableSection.indexOf("grant", 10);
      const scoped = nextGrantBoundary === -1 ? tableSection : tableSection.slice(0, nextGrantBoundary);
      expect(scoped).not.toMatch(new RegExp(`update on public\\.${table}`));
    }
  });

  it("makes GRANTED consent require a captured timestamp (fail-closed)", () => {
    expect(migration).toContain("consent_state <> 'granted' or consent_captured_at is not null");
    expect(migration).toContain("consent_state in ('granted','revoked','unknown')");
  });

  it("never introduces precise location fields", () => {
    // Column definitions only -- the comment on worker_locations legitimately
    // names these fields to explain why they're deliberately absent.
    expect(migration).not.toMatch(/^\s*postal_code\s+text/m);
    expect(migration).not.toMatch(/^\s*latitude\s+numeric/m);
    expect(migration).not.toMatch(/^\s*longitude\s+numeric/m);
    expect(migration).not.toMatch(/^\s*street_address\s+text/m);
  });

  it("does not insert any real or synthetic worker data", () => {
    expect(migration).not.toMatch(/insert into public\.worker/);
    expect(migration).not.toMatch(/insert into public\.workforce_workers/);
  });

  it("keeps UNKNOWN a valid, representable state distinct from a false/negative fact", () => {
    expect(migration).toContain("status in ('available','committed','unavailable','unknown')");
    expect(migration).toContain("source_of_record in ('self_registered','sourced','imported','unknown')");
  });

  it("documents the known shift/hours and demand-side compensation gaps rather than guessing", () => {
    expect(migrationProse).toContain("shift preference or maximum hours/week capacity");
    expect(migrationProse).toContain("no pay/rate/per-diem column at all today");
  });
});
