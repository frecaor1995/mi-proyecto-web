import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { decideGlobalOperatorGate, isPublicApplicationPath } from "../../server/auth/global-operator-gate";
import { resolveActiveOperator, authorizeOperator } from "../../server/auth/authorization";
import { validateProductionConfig } from "../../server/config/production-config";
import { releaseChecksPass, verifyDatabaseReleaseControls } from "../../server/release-controls/database-release-verifier";
import { sanitizeLogFields } from "../../server/observability/safe-release-logger";
import { evaluateDatabaseConnectionHealth } from "../../server/database/connection-health";
import type { OperatorRepository } from "../../server/repositories/operator/operator-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

const activeOperator = {
  id: "operator-1", authUserId: "auth-1", email: "operator@example.invalid", displayName: "Release Operator",
  status: "ACTIVE" as const, permissions: ["matching_result.read" as const], createdAt: new Date(), updatedAt: new Date(),
};

describe("Commercial Release v1.0 minimum controls", () => {
  it("fails the global gate closed and keeps public exceptions narrow", () => {
    expect(decideGlobalOperatorGate({ authenticated: false, operatorStatus: null })).toBe("REQUIRE_LOGIN");
    expect(decideGlobalOperatorGate({ authenticated: true, operatorStatus: null })).toBe("DENY_OPERATOR");
    expect(decideGlobalOperatorGate({ authenticated: true, operatorStatus: "INACTIVE" })).toBe("DENY_OPERATOR");
    expect(decideGlobalOperatorGate({ authenticated: true, operatorStatus: "ACTIVE" })).toBe("ALLOW");
    expect(isPublicApplicationPath("/login")).toBe(true);
    expect(isPublicApplicationPath("/auth/callback")).toBe(true);
    expect(isPublicApplicationPath("/api/health")).toBe(true);
    expect(isPublicApplicationPath("/api/radar/scheduled-search")).toBe(true);
    for (const route of ["/command-center", "/opportunities", "/opportunities/id", "/commercial-intake", "/candidate-slate", "/workforce"]) {
      expect(isPublicApplicationPath(route)).toBe(false);
    }
  });

  it("requires an ACTIVE operator while preserving permission-specific denial", async () => {
    const repository = { findByAuthUserId: vi.fn().mockResolvedValue(activeOperator) } as unknown as OperatorRepository;
    const getSession = async () => ({ authUserId: "auth-1", email: activeOperator.email });
    await expect(resolveActiveOperator({ repository, getSession })).resolves.toMatchObject({ state: "ACTIVE_OPERATOR" });
    await expect(authorizeOperator("matching.execute", { repository, getSession })).resolves.toMatchObject({ state: "AUTHENTICATED_BUT_UNAUTHORIZED" });
    await expect(resolveActiveOperator({ repository: null, getSession })).resolves.toMatchObject({ state: "AUTHENTICATED_BUT_UNAUTHORIZED" });
  });

  it("validates production configuration without disclosing values", () => {
    const secret = "extremely-sensitive-value";
    const invalid = validateProductionConfig({ DATABASE_URL: secret, NEXT_PUBLIC_APP_URL: "http://localhost:3000", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret, CRON_SECRET: "", BRAVE_SEARCH_API_KEY: "" });
    expect(invalid.valid).toBe(false);
    expect(JSON.stringify(invalid)).not.toContain(secret);
    expect(validateProductionConfig({
      NEXT_PUBLIC_APP_URL: "https://workforce.flyelectricsolution.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_valid-format",
      DATABASE_URL: "postgresql://runtime@db.flyelectricsolution.com:5432/postgres",
      CRON_SECRET: "radar-scheduler-7db97165f73f4b19",
      BRAVE_SEARCH_API_KEY: "brave-production-key-shape",
    }).valid).toBe(true);
  });

  it("redacts sensitive logging fields", () => {
    expect(sanitizeLogFields({ token: "secret", workerPhone: "555", routeType: "render" })).toEqual({ token: "[REDACTED]", workerPhone: "[REDACTED]", routeType: "render" });
  });

  it("reports health without propagating database errors", async () => {
    expect(await evaluateDatabaseConnectionHealth(null)).toBe("UNKNOWN");
    expect(await evaluateDatabaseConnectionHealth({ query: vi.fn().mockRejectedValue(new Error("credential secret")) })).toBe("UNAVAILABLE");
  });

  it("verifies restricted role, schema, migrations, grants and RLS read-only", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "select 1") return { rows: [{ "?column?": 1 }] };
      if (sql.includes("pg_has_role")) return { rows: [{ current_user: "fly_workforce_app", rolsuper: false, rolbypassrls: false, runtime_member: true }] };
      if (sql.includes("information_schema.tables")) return { rows: [{ count: "5" }] };
      if (sql.includes("schema_migrations")) return { rows: [{ version: "1" }, { version: "2" }] };
      if (sql.includes("grantee='fly_workforce_runtime'")) return { rows: [{ count: "5" }] };
      if (sql.includes("from pg_policies")) return { rows: [{ count: "5" }] };
      return { rows: [{ count: "0" }] };
    });
    const checks = await verifyDatabaseReleaseControls({ query } as unknown as SqlClient, ["1", "2"]);
    expect(releaseChecksPass(checks)).toBe(true);
    expect(query.mock.calls.every(([sql]) => /^\s*select/i.test(String(sql)))).toBe(true);
  });

  it("documents operator lifecycle, backup restore, alerting, smoke and rollback", async () => {
    const runbook = await readFile("docs/commercial-release-v1-runbook.md", "utf8");
    for (const phrase of ["public signup stays disabled", "INACTIVE", "non-production", "/api/health", "Post-deploy smoke", "Rollback", "External release actions required"]) {
      expect(runbook).toContain(phrase);
    }
    expect(runbook).not.toMatch(/sb_secret_[A-Za-z0-9]+/);
  });
});
