import { COMPANY_ATS_CATALOG } from "../../domain/company-ats-catalog";
import { PLATFORM_ACCESS, effectivePolicy, readinessMatrix, reviewTimeboxState, type ReadinessRow } from "../../domain/ats-capture-readiness";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { resolvePersistedCapturePolicy } from "./individual-posting-capture";

/** Recipe 2.0: effective policy, review clock and commercial priority per catalog source (local reads only). */
export async function loadSourcePolicies(db: SqlClient, now = new Date()) {
  const hosts = new Set<string>();
  for (const target of COMPANY_ATS_CATALOG) {
    if (!target.jobsUrl) continue;
    const host = new URL(target.jobsUrl).hostname.toLowerCase();
    if ((await resolvePersistedCapturePolicy(db, host, now)).state === "ALLOWED") hosts.add(host);
  }
  return COMPANY_ATS_CATALOG.map((target) => {
    const platform = PLATFORM_ACCESS.find((p) => p.platform === target.ats)!;
    return { key: target.key, name: target.name, wave: target.wave, ats: target.ats, platformLabel: platform.label, preferredRoute: platform.preferredRoute, platformAuthorization: platform.authorization,
      effective: effectivePolicy(target, hosts, now), review: reviewTimeboxState(target.accessReview ?? null, now), priority: target.commercialPriority ?? null, roles: target.roles };
  });
}

/** Reads persisted policy decisions from the local database only (no external request) and builds the Stage 3 matrix. */
export async function loadAtsReadinessMatrix(db: SqlClient, now = new Date()): Promise<readonly ReadinessRow[]> {
  const hosts = new Set<string>();
  for (const target of COMPANY_ATS_CATALOG) {
    if (!target.jobsUrl) continue;
    const host = new URL(target.jobsUrl).hostname.toLowerCase();
    if ((await resolvePersistedCapturePolicy(db, host, now)).state === "ALLOWED") hosts.add(host);
  }
  return readinessMatrix(COMPANY_ATS_CATALOG, hosts);
}
