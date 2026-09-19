import { describe, expect, it } from "vitest";
import { fingerprintDemandInput, fingerprintWorkerInput } from "../../server/matching/fingerprint";
import { knownFact, unknownFact, type MatchingReadyWorkerInput } from "../../domain/worker";
import type { MatchingReadyDemandInput } from "../../domain/demand-matching";

/**
 * MATCHING-B2-B. Pure fingerprint tests -- no PGlite, no database.
 */

function worker(overrides: Partial<MatchingReadyWorkerInput> = {}): MatchingReadyWorkerInput {
  return {
    workerId: "worker-1",
    tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 36 }],
    skills: [{ skillCode: "TIG", verificationState: "VERIFIED" }],
    credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }],
    availability: knownFact({ status: "AVAILABLE", availableFrom: null }),
    location: unknownFact(),
    compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 34, currency: "USD", perDiemRequired: null, negotiable: false }),
    knownGaps: [],
    ...overrides,
  };
}

function demand(overrides: Partial<MatchingReadyDemandInput> = {}): MatchingReadyDemandInput {
  return {
    demandSignalId: "demand-1",
    tradeCode: "ELECTRICAL",
    occupationCode: "ELECTRICIAN",
    minimumExperienceMonths: 24,
    skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }],
    credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: null }],
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    compensation: knownFact({ payCurrency: "USD", basePayMin: 28, basePayMax: 38, payPeriod: "HOURLY" }),
    ...overrides,
  };
}

describe("MATCHING-B2-B fingerprintWorkerInput / fingerprintDemandInput", () => {
  it("R1.7.2-ish / 2. same logical worker input -> same fingerprint", () => {
    expect(fingerprintWorkerInput(worker())).toBe(fingerprintWorkerInput(worker()));
  });

  it("3. same logical demand input -> same fingerprint", () => {
    expect(fingerprintDemandInput(demand())).toBe(fingerprintDemandInput(demand()));
  });

  it("4. different array ordering (trade occupations, skills, credentials) -> same fingerprint", () => {
    const a = worker({
      tradeOccupations: [
        { tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 36 },
        { tradeCode: "WELDING", occupationCode: "WELDER", roleDesignation: "SECONDARY", experienceMonths: 12 },
      ],
      skills: [{ skillCode: "TIG", verificationState: "VERIFIED" }, { skillCode: "SMAW", verificationState: "UNVERIFIED" }],
      credentials: [{ credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }, { credentialCode: "OSHA_30", verificationState: "VERIFIED", expiresAt: null }],
    });
    const b = worker({
      tradeOccupations: [
        { tradeCode: "WELDING", occupationCode: "WELDER", roleDesignation: "SECONDARY", experienceMonths: 12 },
        { tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 36 },
      ],
      skills: [{ skillCode: "SMAW", verificationState: "UNVERIFIED" }, { skillCode: "TIG", verificationState: "VERIFIED" }],
      credentials: [{ credentialCode: "OSHA_30", verificationState: "VERIFIED", expiresAt: null }, { credentialCode: "OSHA_10", verificationState: "VERIFIED", expiresAt: null }],
    });
    expect(fingerprintWorkerInput(a)).toBe(fingerprintWorkerInput(b));
  });

  it("demand-side array ordering does not change fingerprint", () => {
    const a = demand({
      skills: [{ skillCode: "TIG", requirementLevel: "REQUIRED" }, { skillCode: "CONTROLS", requirementLevel: "PREFERRED" }],
      credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: null }, { credentialCode: "OSHA_30", requirementLevel: "PREFERRED", jurisdiction: "TX" }],
    });
    const b = demand({
      skills: [{ skillCode: "CONTROLS", requirementLevel: "PREFERRED" }, { skillCode: "TIG", requirementLevel: "REQUIRED" }],
      credentials: [{ credentialCode: "OSHA_30", requirementLevel: "PREFERRED", jurisdiction: "TX" }, { credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: null }],
    });
    expect(fingerprintDemandInput(a)).toBe(fingerprintDemandInput(b));
  });

  it("5. a different matching-relevant worker fact (skill verification state) -> different fingerprint", () => {
    const a = worker({ skills: [{ skillCode: "TIG", verificationState: "VERIFIED" }] });
    const b = worker({ skills: [{ skillCode: "TIG", verificationState: "UNVERIFIED" }] });
    expect(fingerprintWorkerInput(a)).not.toBe(fingerprintWorkerInput(b));
  });

  it("a different matching-relevant worker fact (experienceMonths) -> different fingerprint", () => {
    const a = worker({ tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 36 }] });
    const b = worker({ tradeOccupations: [{ tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 6 }] });
    expect(fingerprintWorkerInput(a)).not.toBe(fingerprintWorkerInput(b));
  });

  it("a different matching-relevant worker fact (compensation.negotiable) -> different fingerprint", () => {
    const a = worker({ compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 34, currency: "USD", perDiemRequired: null, negotiable: false }) });
    const b = worker({ compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 34, currency: "USD", perDiemRequired: null, negotiable: true }) });
    expect(fingerprintWorkerInput(a)).not.toBe(fingerprintWorkerInput(b));
  });

  it("6. a different matching-relevant demand fact (minimumExperienceMonths) -> different fingerprint", () => {
    expect(fingerprintDemandInput(demand({ minimumExperienceMonths: 24 }))).not.toBe(fingerprintDemandInput(demand({ minimumExperienceMonths: 48 })));
  });

  it("a different matching-relevant demand fact (basePayMax) -> different fingerprint", () => {
    const a = demand({ compensation: knownFact({ payCurrency: "USD", basePayMin: 28, basePayMax: 38, payPeriod: "HOURLY" }) });
    const b = demand({ compensation: knownFact({ payCurrency: "USD", basePayMin: 28, basePayMax: 50, payPeriod: "HOURLY" }) });
    expect(fingerprintDemandInput(a)).not.toBe(fingerprintDemandInput(b));
  });

  it("an irrelevant field (worker.location) does not affect the fingerprint -- the engine never reads it", () => {
    const a = worker({ location: unknownFact() });
    const b = worker({ location: knownFact({ city: "Houston", region: "TX", country: "US", travelWilling: true, travelRadiusMiles: 50, relocationWilling: false }) });
    expect(fingerprintWorkerInput(a)).toBe(fingerprintWorkerInput(b));
  });

  it("an irrelevant field (worker.compensation.ratePreferred) does not affect the fingerprint -- never a hard threshold (R1.4)", () => {
    const a = worker({ compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 34, currency: "USD", perDiemRequired: null, negotiable: false }) });
    const b = worker({ compensation: knownFact({ rateType: "HOURLY", rateMin: 30, ratePreferred: 99, currency: "USD", perDiemRequired: null, negotiable: false }) });
    expect(fingerprintWorkerInput(a)).toBe(fingerprintWorkerInput(b));
  });

  it("an irrelevant field (demand credential jurisdiction) does not affect the fingerprint -- never compared (D9)", () => {
    const a = demand({ credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: null }] });
    const b = demand({ credentials: [{ credentialCode: "OSHA_10", requirementLevel: "REQUIRED", jurisdiction: "TX" }] });
    expect(fingerprintDemandInput(a)).toBe(fingerprintDemandInput(b));
  });

  it("an irrelevant field (demand.compensation.basePayMin) does not affect the fingerprint -- never read by the engine", () => {
    const a = demand({ compensation: knownFact({ payCurrency: "USD", basePayMin: 10, basePayMax: 38, payPeriod: "HOURLY" }) });
    const b = demand({ compensation: knownFact({ payCurrency: "USD", basePayMin: 25, basePayMax: 38, payPeriod: "HOURLY" }) });
    expect(fingerprintDemandInput(a)).toBe(fingerprintDemandInput(b));
  });

  it("7. contact/PII has no field on the input type to influence the fingerprint -- structurally guaranteed, not just by convention", () => {
    const fp = fingerprintWorkerInput(worker());
    expect(fp).not.toMatch(/555-0100|@|consent|rawIdentifier/i);
    // The fingerprint is a hex SHA-256 digest -- assert its shape too, as a
    // sanity check that it is actually a hash, not an accidental passthrough.
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fingerprints are pure: no Date.now()/randomness -- calling twice from the same process gives the same result regardless of timing", async () => {
    const first = fingerprintWorkerInput(worker());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = fingerprintWorkerInput(worker());
    expect(first).toBe(second);
  });
});
