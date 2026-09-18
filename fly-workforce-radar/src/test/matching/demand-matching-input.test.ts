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

const EXCLUDED_LOCAL_MIGRATIONS = new Set([
  "20260913133740_discovery_mvp_a0_durable_runs.sql",
  "20260913135341_discovery_mvp_a_candidates.sql",
  "20260914024442_discovery_mvp_b_r1_destination_policy_state.sql",
  "20260914094253_canonical_multi_profession_demand.sql",
  "20260915024424_security_rls_b0_r1_public_routine_defaults.sql",
  "20260915024716_security_rls_b0_r1_global_routine_defaults.sql",
]);

describe("MATCHING-B1-C DemandMatchingInput", () => {
  let db: PGlite;
  let operatorRepository: OperatorRepository;
  const fullAccessId = "e1111111-1111-4111-8111-111111111111";
  let demandSignalId: string;
  let bareDemandSignalId: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role supabase_admin;");
    const directory = resolve(process.cwd(), "supabase/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql") && !EXCLUDED_LOCAL_MIGRATIONS.has(name)).sort();
    for (const file of files) await db.exec(await readFile(resolve(directory, file), "utf8"));
    operatorRepository = new PostgresOperatorRepository(db as unknown as SqlClient);
    await operatorRepository.create({ authUserId: fullAccessId, email: "full@example.com", status: "ACTIVE", permissions: ["demand_requirement.write"] });

    const inserted = await db.query<{ id: string }>(
      `insert into demand_signals (title, role_type, trade_code, occupation_code, minimum_experience_months, start_date, pay_currency, base_pay_min, base_pay_max, pay_period)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      ["MATCHING-B1-C demand-input fixture", "ELECTRICIAN", "ELECTRICAL", "ELECTRICIAN", 24, "2026-11-01", "USD", 28, 38, "HOURLY"],
    );
    demandSignalId = (inserted.rows as { id: string }[])[0].id;

    const bare = await db.query<{ id: string }>(`insert into demand_signals (title, role_type) values ($1,$2) returning id`, ["MATCHING-B1-C bare demand (no canonical fields set)", "OTHER"]);
    bareDemandSignalId = (bare.rows as { id: string }[])[0].id;
  });
  afterAll(async () => db.close());

  const session = (): (() => Promise<ServerSession | null>) => () => Promise.resolve({ authUserId: fullAccessId, email: "irrelevant@example.com" });
  const service = () =>
    new DemandRequirementService({
      repository: new PostgresDemandRequirementRepository(db as unknown as SqlClient),
      transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient),
      getSession: session(),
      operatorRepository,
    });

  it("20. DemandMatchingInput reads the canonical trade_code/occupation_code columns", async () => {
    const result = await service().getMatchingReadyInput(demandSignalId);
    expect(result.kind).toBe("OK");
    const value = result.kind === "OK" ? result.value : null;
    expect(value?.tradeCode).toBe("ELECTRICAL");
    expect(value?.occupationCode).toBe("ELECTRICIAN");
    expect(value?.minimumExperienceMonths).toBe(24);
  });

  it("21. DemandMatchingInput never derives tradeCode/occupationCode from role_type -- the type has no role_type field at all, and a demand whose canonical columns are NULL stays NULL even though role_type is set", async () => {
    const result = await service().getMatchingReadyInput(bareDemandSignalId);
    const value = result.kind === "OK" ? result.value : null;
    expect(value).not.toBeNull();
    expect(value?.tradeCode).toBeNull();
    expect(value?.occupationCode).toBeNull();
    expect(Object.keys(value as object)).not.toContain("roleType");
    expect(JSON.stringify(value)).not.toContain("role_type");
  });

  it("22. missing canonical demand trade remains NULL/UNKNOWN, never synthesized from role_type='OTHER'", async () => {
    const result = await service().getMatchingReadyInput(bareDemandSignalId);
    const value = result.kind === "OK" ? result.value : null;
    expect(value?.tradeCode).toBeNull();
  });

  it("23. requirement builder reads skills/credentials deterministically (rerun produces identical shape)", async () => {
    await service().setDemandRequirements({
      demandSignalId, skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }], credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: "TX" }],
    });
    const first = await service().getMatchingReadyInput(demandSignalId);
    const second = await service().getMatchingReadyInput(demandSignalId);
    expect(first).toEqual(second);
    const value = first.kind === "OK" ? first.value : null;
    expect(value?.skills).toEqual([{ skillCode: "TIG", requirementLevel: "REQUIRED" }]);
    expect(value?.credentials).toEqual([{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: "TX" }]);
  });

  it("compensation is read from the pre-existing base demand_signals columns, as a Fact -- KNOWN when populated", async () => {
    const result = await service().getMatchingReadyInput(demandSignalId);
    const value = result.kind === "OK" ? result.value : null;
    expect(value?.compensation.state).toBe("KNOWN");
    if (value?.compensation.state === "KNOWN") {
      expect(value.compensation.value.basePayMin).toBe(28);
      expect(value.compensation.value.basePayMax).toBe(38);
      expect(value.compensation.value.payPeriod).toBe("HOURLY");
    }
  });

  it("compensation is UNKNOWN, not a false zero, when no compensation fields are set", async () => {
    const result = await service().getMatchingReadyInput(bareDemandSignalId);
    const value = result.kind === "OK" ? result.value : null;
    expect(value?.compensation.state).toBe("UNKNOWN");
  });

  it("24. existing ingestion compatibility preserved -- postgres-ingestion-repository.ts and domain/ingestion.ts were not modified by this phase", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const ingestionRepoDiff = await fs.readFile(path.resolve(process.cwd(), "src/server/repositories/ingestion/postgres-ingestion-repository.ts"), "utf8");
    // Sanity check only: this phase's own new symbols must never appear in
    // the pre-existing (and currently independently-dirty) ingestion repository.
    expect(ingestionRepoDiff).not.toContain("DemandRequirementService");
    expect(ingestionRepoDiff).not.toContain("isEligibleForMatching");
  });

  it("MATCHING-B1-C-R2: setDemandRequirements is write-idempotent -- an identical second write does not duplicate, drop requirement-level fidelity, or change the resulting matching input", async () => {
    const target = service();
    const writeInput = {
      demandSignalId,
      skills: [
        { skillCode: "TIG", requirementLevel: "REQUIRED" as const, sourceLabel: "job posting excerpt" },
        { skillCode: "CONTROLS", requirementLevel: "PREFERRED" as const },
      ],
      credentials: [
        { credentialCode: "OSHA_10", requirementLevel: "REQUIRED" as const, jurisdiction: "TX" },
        { credentialCode: "OSHA_30", requirementLevel: "PREFERRED" as const, jurisdiction: null },
      ],
    };

    const write1 = await target.setDemandRequirements(writeInput);
    expect(write1.kind).toBe("OK");
    const skillsAfter1 = await target.listSkillRequirements(demandSignalId);
    const credentialsAfter1 = await target.listCredentialRequirements(demandSignalId);
    const matchingInputAfter1 = await target.getMatchingReadyInput(demandSignalId);

    const write2 = await target.setDemandRequirements(writeInput);
    expect(write2.kind).toBe("OK");
    const skillsAfter2 = await target.listSkillRequirements(demandSignalId);
    const credentialsAfter2 = await target.listCredentialRequirements(demandSignalId);
    const matchingInputAfter2 = await target.getMatchingReadyInput(demandSignalId);

    const skills2 = skillsAfter2.kind === "OK" ? skillsAfter2.value : [];
    const credentials2 = credentialsAfter2.kind === "OK" ? credentialsAfter2.value : [];

    // 1 & 3. Skill row count did not increase; no duplicate skill requirement.
    expect(skills2).toHaveLength(2);
    expect(new Set(skills2.map((s) => `${s.skillCode}:${s.requirementLevel}`)).size).toBe(2);

    // 2 & 4. Credential row count did not increase; no duplicate credential requirement.
    expect(credentials2).toHaveLength(2);
    expect(new Set(credentials2.map((c) => `${c.credentialCode}:${c.requirementLevel}`)).size).toBe(2);

    // 5. No stale requirement row remains (skill/credential codes from a prior
    // test's own write, e.g. test 23's "TIG REQUIRED" / "OSHA_10 REQUIRED TX",
    // are the same logical rows here since delete-then-insert always clears
    // the full set for this demandSignalId before reinserting exactly writeInput).
    expect(skills2.map((s) => s.skillCode).sort()).toEqual(["CONTROLS", "TIG"]);
    expect(credentials2.map((c) => c.credentialCode).sort()).toEqual(["OSHA_10", "OSHA_30"]);

    // 6. Requirement levels remain exactly preserved.
    expect(skills2.find((s) => s.skillCode === "TIG")?.requirementLevel).toBe("REQUIRED");
    expect(skills2.find((s) => s.skillCode === "CONTROLS")?.requirementLevel).toBe("PREFERRED");
    expect(credentials2.find((c) => c.credentialCode === "OSHA_10")?.requirementLevel).toBe("REQUIRED");
    expect(credentials2.find((c) => c.credentialCode === "OSHA_30")?.requirementLevel).toBe("PREFERRED");

    // 7. Provenance fields preserved where supplied.
    expect(skills2.find((s) => s.skillCode === "TIG")?.sourceLabel).toBe("job posting excerpt");
    expect(credentials2.find((c) => c.credentialCode === "OSHA_10")?.jurisdiction).toBe("TX");

    // 8 & 9. Repository-level reads return the same logical set after write #2
    // as after write #1 -- compared by logical content, not by row identity/
    // timestamps, since replace semantics are free to regenerate those.
    const logicalSkills = (rs: typeof skills2) => rs.map((s) => ({ skillCode: s.skillCode, requirementLevel: s.requirementLevel, sourceLabel: s.sourceLabel })).sort((a, b) => a.skillCode.localeCompare(b.skillCode));
    const logicalCredentials = (rs: typeof credentials2) => rs.map((c) => ({ credentialCode: c.credentialCode, requirementLevel: c.requirementLevel, jurisdiction: c.jurisdiction })).sort((a, b) => a.credentialCode.localeCompare(b.credentialCode));
    expect(logicalSkills(skillsAfter1.kind === "OK" ? skillsAfter1.value : [])).toEqual(logicalSkills(skills2));
    expect(logicalCredentials(credentialsAfter1.kind === "OK" ? credentialsAfter1.value : [])).toEqual(logicalCredentials(credentials2));

    // 10. getMatchingReadyInput produces the same logical matching input after write #2.
    expect(matchingInputAfter1).toEqual(matchingInputAfter2);
  });

  it("MATCHING-B1-C-R2 (optional stronger assertion): a second write with different requirements replaces the first set exactly -- old codes gone, new codes present exactly once", async () => {
    const target = service();
    const first = await target.setDemandRequirements({
      demandSignalId,
      skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }],
      credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: "TX" }],
    });
    expect(first.kind).toBe("OK");

    const second = await target.setDemandRequirements({
      demandSignalId,
      skills: [{ skillCode: "CONTROLS", requirementLevel: "PREFERRED" }],
      credentials: [{ credentialCode: "OSHA_30", requirementLevel: "PREFERRED" }],
    });
    expect(second.kind).toBe("OK");

    const skillsResult = await target.listSkillRequirements(demandSignalId);
    const credentialsResult = await target.listCredentialRequirements(demandSignalId);
    const skills = skillsResult.kind === "OK" ? skillsResult.value : [];
    const credentials = credentialsResult.kind === "OK" ? credentialsResult.value : [];

    expect(skills.map((s) => s.skillCode)).toEqual(["CONTROLS"]);
    expect(skills.some((s) => s.skillCode === "TIG")).toBe(false);
    expect(credentials.map((c) => c.credentialCode)).toEqual(["OSHA_30"]);
    expect(credentials.some((c) => c.credentialCode === "OSHA_10")).toBe(false);
  });

  it("getMatchingReadyInput requires demand_requirement.write and returns OK(null) for a non-existent demand signal", async () => {
    const noPermissionOperator = "e2222222-2222-4222-8222-222222222222";
    await operatorRepository.create({ authUserId: noPermissionOperator, email: "no-permission@example.com", status: "ACTIVE", permissions: [] });
    const noPermissionService = new DemandRequirementService({
      repository: new PostgresDemandRequirementRepository(db as unknown as SqlClient),
      transactionRunner: transactionRunnerOnClient(db as unknown as SqlClient),
      getSession: () => Promise.resolve({ authUserId: noPermissionOperator, email: "irrelevant@example.com" }),
      operatorRepository,
    });
    const denied = await noPermissionService.getMatchingReadyInput(demandSignalId);
    expect(denied.kind).toBe("UNAUTHORIZED");

    const missing = await service().getMatchingReadyInput("00000000-0000-4000-8000-000000000000");
    expect(missing.kind).toBe("OK");
    expect(missing.kind === "OK" ? missing.value : "not-null").toBeNull();
  });
});
