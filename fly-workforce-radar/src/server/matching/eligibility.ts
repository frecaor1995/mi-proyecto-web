import type { WorkerLifecycleStatus } from "../../domain/worker";

/**
 * MATCHING-B1-C. Eligibility to be MATCHED, not ability to be CONTACTED --
 * those are deliberately separate concerns (MATCHING-B1-A/B1-B). Contact
 * consent (worker_contact_routes.consent_state) is never consulted here and
 * must never be: a technically eligible, well-matched worker can still be
 * non-contactable, and that's a Contact/Selection/Mobilization-phase
 * question, not a qualification one.
 *
 * Pure, deterministic, and total over WorkerLifecycleStatus's three values
 * -- ACTIVE is the only eligible state; INACTIVE and ARCHIVED are both
 * ineligible (Manager decision, MATCHING-B1-C authorization). Does not
 * change or read anything about lifecycle schema.
 */
export function isEligibleForMatching(lifecycleStatus: WorkerLifecycleStatus): boolean {
  return lifecycleStatus === "ACTIVE";
}
