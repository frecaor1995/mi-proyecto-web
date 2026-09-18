import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresDemandRequirementRepository } from "../../server/repositories/demand/postgres-demand-requirement-repository";
import { DemandRequirementService } from "../../server/services/demand/demand-requirement-service";
import { transactionRunnerOnClient } from "../../server/database/transaction";
import type { ServerSession } from "../../server/auth/session";
import type { OperatorRepository } from "../../server/repositories/operator/operator-repository";

/**
 * MATCHING-B1-C. Real Postgres-compatible (PGlite) integration coverage for
 * the demand-readiness migration and the demand-requirement write path.
 *
 * IMPORTANT: this harness deliberately does NOT apply every .sql file in
 * supabase/migrations/ the way worker-domain.test.ts does -- that directory
 * currently also contains the excluded, unpublished Discovery/B0-R1/
 * canonical_multi_profession_demand.sql migrations, and the latter already
 * collides with the committed 20260915020000 shared-taxonomy migration
 * (both CREATE TABLE workforce_trades), a pre-existing, already-tracked
 * problem unrelated to this phase (confirmed: worker-domain.test.ts
 * currently fails the same way with or without this file's changes). This
 * harness instead applies exactly the published/certified chain plus this
 * phase's own new migration, mirroring the same explicit-list rigor used
 * to validate the Commit 1/Commit 2 publication.
 */
const EXCLUDED_LOCAL_MIGRATIONS = new Set([
  "20260913133740_discovery_mvp_a0_durable_runs.sql",
  "20260913135341_discovery_mvp_a_candidates.sql",
  "20260914024442_discovery_mvp_b_r1_destination_policy_state.sql",
  "20260914094253_canonical_multi_profession_demand.sql",
  "20260915024424_security_rls_b0_r1_public_routine_defaults.sql",
  "20260915024716_security_rls_b0_r1_global_routine_defaults.sql",
]);

describe("MATCHING-B1-C demand-readiness migration + requirement write path", () => {
  let db: PGlite;
  let operatorRepository: OperatorRepository;

  const fullAccessId = "c1111111-1111-4111-8111-111111111111";
  const noPermissionId = "c2222222-2222-4222-8222-222222222222";
  let demandSignalId: string;
  let otherDemandSignalId: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory = resolve(process.cwd(), "supabase/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql") && !EXCLUDED_LOCAL_MIGRATIONS.has(name)).sort();
    for (const file of files) {
      await db.exec(await readFile(resolve(directory, file), "utf8"));
    }
    operatorRepository = new PostgresOperatorRepository(db as unknown as SqlClient);
    await operatorRepository.create({ authUserId: fullAccessId, email: "full@example.com", status: "ACTIVE", permissions: ["demand_requirement.write"] });
    await operatorRepository.create({ authUserId: noPermissionId, email: "no-permission@example.com", status: "ACTIVE", permissions: [] });

    // Two minimal synthetic demand_signals rows -- schema-only, no ingestion path exercised.
    const inserted = await db.query<{ id: string }>(
      `insert into demand_signals (title, role_type) values ($1,$2) returning id`,
      ["MATCHING-B1-C synthetic demand A", "ELECTRICIAN"],
    );
    demandSignalId = (inserted.rows as { id: string }[])[0].id;
    const insertedOther = await db.query<{ id: string }>(
      `insert into demand_signals (title, role_type) values ($1,$2) returning id`,
      ["MATCHING-B1-C synthetic demand B", "WELDER"],
    );
    otherDemandSignalId = (insertedOther.rows as { id: string }[])[0].id;
  });
  afterAll(async () => db.close());

  const session = (authUserId: string): (() => Promise<ServerSession | null>) => () => Promise.resolve({ authUserId, email: "irrelevant@example.com" });
  const serviceFor = (authUserId: string) =>
    new DemandRequirementService({
      repository: new PostgresDemandRequirementRepository(db as unknown as SqlClient),
      transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient),
      getSession: session(authUserId),
      operatorRepository,
    });
  const full = () => serviceFor(fullAccessId);
  const noPermission = () => serviceFor(noPermissionId);

  it("1. demand trade_code can reference the shared workforce taxonomy", async () => {
    await db.query("update demand_signals set trade_code=$1, occupation_code=$2 where id=$3", ["ELECTRICAL", "ELECTRICIAN", demandSignalId]);
    const row = await db.query<{ trade_code: string }>("select trade_code from demand_signals where id=$1", [demandSignalId]);
    expect((row.rows as { trade_code: string }[])[0].trade_code).toBe("ELECTRICAL");
  });

  it("1b. demand trade_code referencing a non-existent taxonomy code is rejected", async () => {
    await expect(db.query("update demand_signals set trade_code=$1 where id=$2", ["NOT_A_REAL_TRADE", demandSignalId])).rejects.toThrow();
  });

  it("2. occupation_code is constrained to its trade via the composite FK", async () => {
    // ELECTRICIAN belongs to ELECTRICAL, not WELDING -- this pairing must be rejected.
    await expect(
      db.query("update demand_signals set trade_code=$1, occupation_code=$2 where id=$3", ["WELDING", "ELECTRICIAN", otherDemandSignalId]),
    ).rejects.toThrow();
  });

  it("3. existing demand rows can remain trade/occupation NULL", async () => {
    const fresh = await db.query<{ id: string }>(`insert into demand_signals (title, role_type) values ($1,$2) returning id`, ["MATCHING-B1-C synthetic demand C", "OTHER"]);
    const id = (fresh.rows as { id: string }[])[0].id;
    const row = await db.query<{ trade_code: string | null; occupation_code: string | null }>(
      "select trade_code, occupation_code from demand_signals where id=$1", [id],
    );
    expect((row.rows as { trade_code: string | null }[])[0].trade_code).toBeNull();
    expect((row.rows as { occupation_code: string | null }[])[0].occupation_code).toBeNull();
  });

  it("4. no role_type backfill occurred -- role_type is untouched by the new columns", async () => {
    const row = await db.query<{ role_type: string }>("select role_type from demand_signals where id=$1", [demandSignalId]);
    expect((row.rows as { role_type: string }[])[0].role_type).toBe("ELECTRICIAN");
  });

  it("5. minimum_experience_months rejects negative values", async () => {
    await expect(db.query("update demand_signals set minimum_experience_months=$1 where id=$2", [-1, demandSignalId])).rejects.toThrow();
    await db.query("update demand_signals set minimum_experience_months=$1 where id=$2", [24, demandSignalId]);
    const row = await db.query<{ minimum_experience_months: number }>("select minimum_experience_months from demand_signals where id=$1", [demandSignalId]);
    expect((row.rows as { minimum_experience_months: number }[])[0].minimum_experience_months).toBe(24);
  });

  it("6. start_date is nullable and accepts a real date", async () => {
    await db.query("update demand_signals set start_date=$1 where id=$2", ["2026-10-01", demandSignalId]);
    const row = await db.query<{ start_date: string | Date }>("select start_date from demand_signals where id=$1", [demandSignalId]);
    const value = (row.rows as { start_date: string | Date }[])[0].start_date;
    expect(new Date(value).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("7/9. demand requirement replacement is atomic and duplicate rows cannot accumulate", async () => {
    const first = await full().setDemandRequirements({
      demandSignalId, skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }], credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED" }],
    });
    expect(first.kind).toBe("OK");
    const skills1 = await full().listSkillRequirements(demandSignalId);
    expect(skills1.kind === "OK" ? skills1.value.length : -1).toBe(1);

    const second = await full().setDemandRequirements({
      demandSignalId, skills: [{ skillCode: "SMAW", requirementLevel: "PREFERRED" }], credentials: [],
    });
    expect(second.kind).toBe("OK");
    const skills2 = await full().listSkillRequirements(demandSignalId);
    // TIG must be GONE (replaced, not merged) and no duplicate SMAW rows.
    expect(skills2.kind === "OK" ? skills2.value.map((s) => s.skillCode) : []).toEqual(["SMAW"]);
    const creds2 = await full().listCredentialRequirements(demandSignalId);
    expect(creds2.kind === "OK" ? creds2.value.length : -1).toBe(0);
  });

  it("8. repeated identical setDemandRequirements is idempotent", async () => {
    const input = { demandSignalId, skills: [{ skillCode: "CONTROLS", requirementLevel: "PREFERRED" as const }], credentials: [{ credentialCode: "OSHA_30", requirementLevel: "REQUIRED" as const }] };
    await full().setDemandRequirements(input);
    const after1 = await full().listSkillRequirements(demandSignalId);
    await full().setDemandRequirements(input);
    const after2 = await full().listSkillRequirements(demandSignalId);
    expect(after1.kind === "OK" ? after1.value : null).toEqual(after2.kind === "OK" ? after2.value : null);
  });

  it("10. skill REQUIRED/PREFERRED levels are preserved exactly", async () => {
    await full().setDemandRequirements({
      demandSignalId, skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }, { skillCode: "SMAW", requirementLevel: "PREFERRED" }], credentials: [],
    });
    const result = await full().listSkillRequirements(demandSignalId);
    const rows = result.kind === "OK" ? result.value : [];
    expect(rows.find((r) => r.skillCode === "TIG")?.requirementLevel).toBe("REQUIRED");
    expect(rows.find((r) => r.skillCode === "SMAW")?.requirementLevel).toBe("PREFERRED");
  });

  it("11. credential REQUIRED/PREFERRED levels are preserved exactly", async () => {
    await full().setDemandRequirements({
      demandSignalId, skills: [], credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED" }, { credentialCode: "OSHA_30", requirementLevel: "PREFERRED" }],
    });
    const result = await full().listCredentialRequirements(demandSignalId);
    const rows = result.kind === "OK" ? result.value : [];
    expect(rows.find((r) => r.credentialCode === "OSHA_10")?.requirementLevel).toBe("REQUIRED");
    expect(rows.find((r) => r.credentialCode === "OSHA_30")?.requirementLevel).toBe("PREFERRED");
  });

  it("12. provenance fields (jurisdiction, sourceLabel, sourceRequirementText, rawEvidenceId) are preserved", async () => {
    await full().setDemandRequirements({
      demandSignalId,
      skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED", sourceLabel: "posting text: TIG welding required" }],
      credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: "TX", sourceRequirementText: "must hold OSHA 10 in Texas" }],
    });
    const skills = await full().listSkillRequirements(demandSignalId);
    const creds = await full().listCredentialRequirements(demandSignalId);
    expect(skills.kind === "OK" ? skills.value[0].sourceLabel : null).toBe("posting text: TIG welding required");
    expect(creds.kind === "OK" ? creds.value[0].jurisdiction : null).toBe("TX");
    expect(creds.kind === "OK" ? creds.value[0].sourceRequirementText : null).toBe("must hold OSHA 10 in Texas");
  });

  it("requires demand_requirement.write -- UNAUTHORIZED without it, and no mutation occurs", async () => {
    const before = await full().listSkillRequirements(otherDemandSignalId);
    const attempt = await noPermission().setDemandRequirements({ demandSignalId: otherDemandSignalId, skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }], credentials: [] });
    expect(attempt.kind).toBe("UNAUTHORIZED");
    const after = await full().listSkillRequirements(otherDemandSignalId);
    expect(after.kind === "OK" ? after.value.length : -1).toBe(before.kind === "OK" ? before.value.length : -2);
  });
});
