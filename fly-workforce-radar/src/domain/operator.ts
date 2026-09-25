export const OPERATOR_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

/**
 * 3I-B3A defined the first permission; Phase 4G added one narrow second
 * permission for protected commercial economics writes ("commercial_economics.write").
 * Phase 4J adds a distinct decision authority ("commercial_economics.decide")
 * so entering/calculating economics never implicitly authorizes a consequential
 * human business disposition.
 * Each permission authorizes only its own domain's specific protected
 * mutations -- extend narrowly, never as a generic RBAC platform, and never
 * let one permission implicitly authorize another domain's writes.
 * Discovery MVP A0 adds "company_discovery.run" because initiating external
 * discovery is neither a verification nor a commercial-economics mutation.
 * WORKFORCE-TALENT-A3 adds three worker-domain permission pairs matching the
 * three sensitivity tiers certified in A2-A/A2-B: general profile facts,
 * contact routes (highest sensitivity), and compensation expectations
 * (commercial-sensitive) -- kept as distinct permissions rather than one
 * broad "worker.admin" so a caller can hold profile access without ever
 * being able to read or write contact or compensation data.
 * MATCHING-B1-C adds "demand_requirement.write" for the narrow
 * demand_skill_requirements/demand_credential_requirements replace-semantics
 * write path -- distinct from every worker_* permission (it never touches
 * worker data) and from commercial_economics.* (it's structural requirement
 * data, not a commercial decision).
 * MATCHING-B2-B adds "matching_result.read" for reading durable
 * worker_demand_match_results/criteria -- read-only, because matching
 * results are server-computed facts operators can never author; a separate
 * write path deliberately does not exist as an operator permission at all
 * (the persistence service writes with the fly_workforce_runtime role, not
 * on behalf of an operator's own authorization).
 * MATCHING-B3-B adds "matching.execute" for TRIGGERING a demand-to-workforce
 * evaluation run. It is deliberately distinct from "matching_result.read":
 * execute permits starting a run, read permits reading persisted results,
 * and neither implicitly grants the other.
 */
export const OPERATOR_PERMISSIONS = [
  "human_verification.write",
  "commercial_economics.write",
  "commercial_economics.decide",
  "company_discovery.run",
  "worker_profile.read",
  "worker_profile.write",
  "worker_contact.read",
  "worker_contact.write",
  "worker_compensation.read",
  "worker_compensation.write",
  "demand_requirement.write",
  "matching_result.read",
  "matching.execute",
  "worker_engagement.read",
  "worker_engagement.write",
  "worker_contact.execute",
] as const;
export type OperatorPermission = (typeof OPERATOR_PERMISSIONS)[number];

export interface CreateOperatorInput {
  authUserId: string;
  email: string;
  displayName?: string | null;
  status?: OperatorStatus;
  permissions?: OperatorPermission[];
}
export interface OperatorRecord extends CreateOperatorInput {
  id: string;
  displayName: string | null;
  status: OperatorStatus;
  permissions: OperatorPermission[];
  createdAt: Date;
  updatedAt: Date;
}
