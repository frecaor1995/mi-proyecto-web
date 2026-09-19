import { createHash } from "node:crypto";
import type { MatchingReadyDemandInput } from "../../domain/demand-matching";
import type { MatchingReadyWorkerInput } from "../../domain/worker";

/**
 * MATCHING-B2-B. Pure, deterministic fingerprints of the exact facts
 * evaluateWorkerDemandMatch reads -- used as the durable freshness signal
 * (MATCHING-B2-A B2.6/B2.7), because this schema's `updated_at` coverage is
 * incomplete and inconsistently maintained for the tables that actually
 * feed matching (worker_credentials has no updated_at column at all;
 * demand_skill_requirements/demand_credential_requirements changes never
 * touch demand_signals.updated_at).
 *
 * Deliberately narrower than "everything on the input type": a field is
 * only included here if evaluate-worker-demand-match.ts actually reads it.
 * Excluded, with the exact reason:
 *  - worker.location, worker.knownGaps        -- never read by any rule
 *  - worker.compensation.ratePreferred        -- never used (R1.4: never a hard threshold)
 *  - worker.compensation.perDiemRequired      -- never read by evaluateCompensation
 *  - demand.credentials[].jurisdiction        -- never compared (D9: no worker jurisdiction field exists)
 *  - demand.compensation.basePayMin           -- never read (only basePayMax is compared)
 *  - workerId / demandSignalId                -- identity, tracked separately by the result row's own columns, not a "fact" the engine evaluates
 * None of contact/consent/raw credential identifiers/precise address are
 * reachable here at all -- MatchingReadyWorkerInput structurally excludes
 * them (MATCHING-B1-C), so there is nothing to additionally filter for PII.
 *
 * If a future rule change starts reading one of the excluded fields above,
 * this function must be updated in the same change -- otherwise the
 * fingerprint would silently stop detecting a now-relevant input change.
 *
 * Pure: no Date.now(), no randomness, no I/O. Arrays are always sorted
 * before serialization so logically-identical input in a different row
 * order produces an identical fingerprint, matching the engine's own D15
 * stable-ordering discipline.
 */

const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export function fingerprintWorkerInput(worker: MatchingReadyWorkerInput): string {
  const tradeOccupations = [...worker.tradeOccupations]
    .sort((a, b) => a.tradeCode.localeCompare(b.tradeCode) || a.occupationCode.localeCompare(b.occupationCode))
    .map((t) => ({ tradeCode: t.tradeCode, occupationCode: t.occupationCode, roleDesignation: t.roleDesignation, experienceMonths: t.experienceMonths }));

  const skills = [...worker.skills]
    .sort((a, b) => a.skillCode.localeCompare(b.skillCode))
    .map((s) => ({ skillCode: s.skillCode, verificationState: s.verificationState }));

  const credentials = [...worker.credentials]
    .sort((a, b) => a.credentialCode.localeCompare(b.credentialCode))
    .map((c) => ({ credentialCode: c.credentialCode, verificationState: c.verificationState, expiresAt: isoOrNull(c.expiresAt) }));

  const availability =
    worker.availability.state === "UNKNOWN"
      ? { state: "UNKNOWN" as const }
      : { state: "KNOWN" as const, status: worker.availability.value.status, availableFrom: isoOrNull(worker.availability.value.availableFrom) };

  const compensation =
    worker.compensation.state === "UNKNOWN"
      ? { state: "UNKNOWN" as const }
      : {
          state: "KNOWN" as const,
          rateType: worker.compensation.value.rateType,
          rateMin: worker.compensation.value.rateMin,
          currency: worker.compensation.value.currency,
          negotiable: worker.compensation.value.negotiable,
        };

  return canonicalHash({ tradeOccupations, skills, credentials, availability, compensation });
}

export function fingerprintDemandInput(demand: MatchingReadyDemandInput): string {
  const skills = [...demand.skills]
    .sort((a, b) => a.skillCode.localeCompare(b.skillCode) || a.requirementLevel.localeCompare(b.requirementLevel))
    .map((s) => ({ skillCode: s.skillCode, requirementLevel: s.requirementLevel }));

  const credentials = [...demand.credentials]
    .sort((a, b) => a.credentialCode.localeCompare(b.credentialCode) || a.requirementLevel.localeCompare(b.requirementLevel))
    .map((c) => ({ credentialCode: c.credentialCode, requirementLevel: c.requirementLevel }));

  const compensation =
    demand.compensation.state === "UNKNOWN"
      ? { state: "UNKNOWN" as const }
      : { state: "KNOWN" as const, payCurrency: demand.compensation.value.payCurrency, basePayMax: demand.compensation.value.basePayMax, payPeriod: demand.compensation.value.payPeriod };

  return canonicalHash({
    tradeCode: demand.tradeCode,
    occupationCode: demand.occupationCode,
    minimumExperienceMonths: demand.minimumExperienceMonths,
    skills,
    credentials,
    startDate: isoOrNull(demand.startDate),
    compensation,
  });
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
