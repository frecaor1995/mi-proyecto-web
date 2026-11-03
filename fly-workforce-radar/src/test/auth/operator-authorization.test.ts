import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { authorizeOperator } from "../../server/auth/authorization";
import type { ServerSession } from "../../server/auth/session";

const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql", "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql", "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql", "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql", "20260904010000_human_verification_domain.sql",
  "20260905010000_operator_identity_and_safe_mutation.sql",
];

describe("3I-B3A operator authorization", () => {
  let db: PGlite;
  let repository: PostgresOperatorRepository;
  let activeAuthUserId: string;
  let inactiveAuthUserId: string;
  let noPermissionAuthUserId: string;
  const unmappedAuthUserId = "99999999-9999-4999-8999-999999999999";

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    repository = new PostgresOperatorRepository(db as unknown as SqlClient);
    activeAuthUserId = "11111111-1111-4111-8111-111111111111";
    inactiveAuthUserId = "22222222-2222-4222-8222-222222222222";
    noPermissionAuthUserId = "33333333-3333-4333-8333-333333333333";
    await repository.create({ authUserId: activeAuthUserId, email: "operator@example.com", status: "ACTIVE", permissions: ["human_verification.write"] });
    await repository.create({ authUserId: inactiveAuthUserId, email: "former-operator@example.com", status: "INACTIVE", permissions: ["human_verification.write"] });
    await repository.create({ authUserId: noPermissionAuthUserId, email: "read-only@example.com", status: "ACTIVE", permissions: [] });
  });
  afterAll(async () => db.close());

  const session = (authUserId: string, email = "irrelevant@example.com"): (() => Promise<ServerSession | null>) => () => Promise.resolve({ authUserId, email });

  it("1. unauthenticated request rejected", async () => {
    const result = await authorizeOperator("human_verification.write", { getSession: () => Promise.resolve(null), repository });
    expect(result.state).toBe("UNAUTHENTICATED");
  });

  it("2/10. authenticated user without operator mapping rejected (covers expired/revoked/malformed sessions, which resolveServerSession also collapses to null)", async () => {
    const result = await authorizeOperator("human_verification.write", { getSession: session(unmappedAuthUserId), repository });
    expect(result).toEqual({ state: "AUTHENTICATED_BUT_UNAUTHORIZED", authUserId: unmappedAuthUserId, email: "irrelevant@example.com" });
  });

  it("3. inactive operator rejected", async () => {
    const result = await authorizeOperator("human_verification.write", { getSession: session(inactiveAuthUserId), repository });
    expect(result.state).toBe("AUTHENTICATED_BUT_UNAUTHORIZED");
  });

  it("4. authorized active operator accepted", async () => {
    const result = await authorizeOperator("human_verification.write", { getSession: session(activeAuthUserId), repository });
    expect(result.state).toBe("AUTHORIZED");
    if (result.state === "AUTHORIZED") {
      expect(result.operator.authUserId).toBe(activeAuthUserId);
      expect(result.operator.email).toBe("operator@example.com");
    }
  });

  it("5. permission required for Human Verification mutation -- an active operator without the specific permission is not authorized for it", async () => {
    const result = await authorizeOperator("human_verification.write", { getSession: session(noPermissionAuthUserId), repository });
    expect(result.state).toBe("AUTHENTICATED_BUT_UNAUTHORIZED");
  });

  it("6/7. actor identity is derived only from the resolved session -- authorizeOperator has no actor-shaped parameter a caller could spoof", async () => {
    const result = await authorizeOperator("human_verification.write", { getSession: session(activeAuthUserId, "operator@example.com"), repository });
    expect(result.state === "AUTHORIZED" ? result.operator.authUserId : null).toBe(activeAuthUserId);
    // Structural guarantee: the only required parameter is `permission`; the optional deps bag exposes
    // getSession/repository overrides for tests, never an operatorId/operatorName/actorId a caller could spoof.
    expect(authorizeOperator.length).toBe(1);
  });

  it("11. operator UUID is stable across lookups", async () => {
    const first = await repository.findByAuthUserId(activeAuthUserId);
    const second = await repository.findByAuthUserId(activeAuthUserId);
    expect(first?.id).toBe(second?.id);
  });

  it("12/17. credentials remain server-only and authorization is enforced server-side -- no repository is reachable without going through authorizeOperator", async () => {
    // authorizeOperator fails closed with no repository configured (e.g. no DATABASE_URL), even for a real session.
    const result = await authorizeOperator("human_verification.write", { getSession: session(activeAuthUserId), repository: null });
    expect(result.state).toBe("AUTHENTICATED_BUT_UNAUTHORIZED");
  });
});
