import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorkerCredentialRecord } from "../../domain/worker";

describe("credential designation domain separation", () => {
  it("represents Journeyman worker evidence with an Apprentice Electrician credential", () => {
    const workerLevel = "JOURNEYMAN";
    const credential: WorkerCredentialRecord = {
      workerId: "worker-1", credentialCode: "ELECTRICAL_LICENSE",
      credentialDesignation: "APPRENTICE_ELECTRICIAN", professionalLicenseNumber: "TEST-LICENSE-000001",
      verificationState: "UNVERIFIED", verifiedAt: null, issuedAt: null,
      expiresAt: new Date("2027-06-26"), issuingAuthority: "Texas Department of Licensing and Regulation",
      jurisdiction: "TX", sourceEvidenceId: null, createdAt: new Date("2026-10-05"),
    };
    expect(workerLevel).toBe("JOURNEYMAN");
    expect(credential.credentialDesignation).toBe("APPRENTICE_ELECTRICIAN");
  });

  it("keeps the migration nullable and forbids level-derived backfill", () => {
    const sql = readFileSync("supabase/migrations/20261005021611_credential_designation_and_public_number.sql", "utf8");
    expect(sql).toContain("add column credential_designation text");
    expect(sql).toContain("credential_designation is null");
    expect(sql).not.toMatch(/update\s+public\.worker_credentials[\s\S]*level_code/i);
  });
});
