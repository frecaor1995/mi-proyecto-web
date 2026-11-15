import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOpportunityRepository } from "../../server/repositories/opportunity/postgres-opportunity-repository";
import { OpportunityService } from "../../server/services/opportunity/opportunity-service";
import { EligibilityService } from "../../server/services/eligibility/eligibility-service";
import { ScoringService } from "../../server/services/scoring/scoring-service";
import { CommercialActionService } from "../../server/services/commercial-action/commercial-action-service";
import { gatedCommercialActionForGraph } from "../../server/services/opportunity-actionability/opportunity-actionability-service";
import { NO_ACTIONABILITY_EVIDENCE } from "../../domain/opportunity-actionability";
import type { ActionabilityInput } from "../../domain/opportunity-actionability";
import type { EligibilityRepository } from "../../server/repositories/eligibility/eligibility-repository";
import type { ScoringRepository } from "../../server/repositories/scoring/scoring-repository";
import type { CommercialActionRepository } from "../../server/repositories/commercial-action/commercial-action-repository";
import type { EligibilityResult, EligibilitySnapshot } from "../../domain/eligibility";
import type { ScoreSnapshot } from "../../domain/scoring";
import type { OpportunityGraph } from "../../domain/opportunity";
import { classifyOperationalStatus, evaluateOpportunityOperationalResult, requirementDetails } from "../../server/opportunity-operations/get-opportunity-operational-result";
import { evaluateOperationalRadar } from "../../server/opportunity-operations/get-operational-radar-summary";

const asOf = new Date("2026-08-20T12:00:00Z");

/* -------------------------------------------------------------------- */
/* Part A: pure classification unit tests -- no database at all.         */
/* Fixture is the exact same synthetic HOT-A-eligible OpportunityGraph   */
/* pattern already used by src/test/eligibility/eligibility-engine.test.ts. */
/* -------------------------------------------------------------------- */

const noopEligibility: EligibilityRepository = { async activeEvidenceIds(ids) { return ids; }, async save(r) { return { ...r, id: "unused", createdAt: r.evaluatedAt }; }, async list() { return []; } };
const noopScoring: ScoringRepository = { async save(r) { return { ...r, id: "unused", createdAt: r.evaluatedAt }; }, async list() { return []; } };
const noopActions: CommercialActionRepository = { async save(r) { return { ...r, id: "unused", createdAt: r.evaluatedAt }; }, async list() { return []; } };

const baseGraph = (): OpportunityGraph => ({
  opportunity: { id: "opp", identityKey: "key", projectId: "project", unresolvedCompanyContext: null, title: "Electrician demand", lifecycle: "ACTIVE", firstSeenAt: asOf, lastSeenAt: asOf, staleAfter: null, verificationDueAt: null, metadata: {} },
  demandSignals: [{ id: "demand", raw_evidence_id: "evidence", stale_after: null, base_pay_min: null, base_pay_max: null, pay_currency: null }],
  claims: [{ id: "claim", verification_state: "VERIFIED" }],
  companies: [{ id: "company", common_name: "Acme Electric" }],
  companyRoles: [{ id: "role", role: "EMPLOYER" }],
  project: { id: "project", name: "Grid Project", location_text: "Houston, TX" },
  acceptance: { id: "acceptance", result: "VERIFIED_POSITIVE", valid_until: "2026-08-30T00:00:00Z" },
  vendorRoutes: [],
  contactPeople: [{ id: "person", verification_state: "VERIFIED" }],
  contactRoutes: [{ id: "route", route_type: "RECRUITER_EMAIL", verification_state: "VERIFIED", lifecycle: "ACTIVE", stale_after: null }],
  routeGrades: [{ id: "grade", contact_route_id: "route", grade: "B" }],
  evidence: [{ id: "evidence" }],
  verificationReviews: [],
  gaps: [],
  conflicts: [],
  asOf,
  descriptiveOnly: true,
});
const copy = (g: OpportunityGraph = baseGraph()): OpportunityGraph => structuredClone(g);

function evaluate(g: OpportunityGraph, actionabilityInput: ActionabilityInput) {
  const eligibility = new EligibilityService({ graph: async () => g }, noopEligibility, () => asOf).assess(g, asOf);
  const snapshots: EligibilitySnapshot[] = eligibility.map((r: EligibilityResult) => ({ ...r, id: `live:${r.eligibilityType}`, createdAt: asOf }));
  const score = new ScoringService({ graph: async () => g }, noopEligibility, noopScoring, () => asOf).assess(g, snapshots, asOf);
  const scoreSnapshot: ScoreSnapshot = { ...score, id: "live:score", createdAt: asOf };
  const action = new CommercialActionService({ graph: async () => g }, noopEligibility, noopScoring, noopActions, () => asOf).assess(g, snapshots, [scoreSnapshot], asOf);
  const gated = gatedCommercialActionForGraph(g, actionabilityInput, asOf);
  return { eligibility, score, action, gated };
}

const OPEN_ACTIONABILITY: ActionabilityInput = { ...NO_ACTIONABILITY_EVIDENCE("opp"), explicitStatus: "OPEN", explicitStatusFreshUntil: new Date("2026-12-01T00:00:00Z") };

describe("operational classification (pure, no database)", () => {
  it("HOT: eligible for HOT_A and actionability is OPEN -- gated active", () => {
    const g = copy();
    const { eligibility, gated } = evaluate(g, OPEN_ACTIONABILITY);
    expect(eligibility.find((e) => e.eligibilityType === "HOT_A_ELIGIBLE")!.eligible).toBe(true);
    const { classification } = classifyOperationalStatus(g, eligibility, gated);
    expect(classification).toBe("HOT");
  });

  it("NEAR_READY (a): eligible for HOT_A but actionability is unknown (no evidence) -- not currently active", () => {
    const g = copy();
    const { eligibility, gated } = evaluate(g, NO_ACTIONABILITY_EVIDENCE("opp"));
    expect(eligibility.find((e) => e.eligibilityType === "HOT_A_ELIGIBLE")!.eligible).toBe(true);
    expect(gated.countsAsActiveHotA).toBe(false);
    const { classification, reason } = classifyOperationalStatus(g, eligibility, gated);
    expect(classification).toBe("NEAR_READY");
    expect(reason).toContain("not currently actionable");
  });

  it("NEAR_READY (b): not yet eligible for either HOT type, but the closer one has only 1 named requirement remaining", () => {
    const g = copy();
    g.acceptance!.result = "NOT_VERIFIED";
    g.contactRoutes[0].route_type = "CORPORATE_PHONE";
    const { eligibility, gated } = evaluate(g, NO_ACTIONABILITY_EVIDENCE("opp"));
    const hotA = eligibility.find((e) => e.eligibilityType === "HOT_A_ELIGIBLE")!;
    const hotB = eligibility.find((e) => e.eligibilityType === "HOT_B_ELIGIBLE")!;
    expect(hotA.eligible).toBe(false);
    expect(hotB.eligible).toBe(false);
    expect(requirementDetails(hotA)).toHaveLength(1);
    expect(hotA.failedRequirements).toContain("MANPOWER_ACCEPTANCE_REQUIRED");
    const { classification, reason } = classifyOperationalStatus(g, eligibility, gated);
    expect(classification).toBe("NEAR_READY");
    expect(reason).toContain("external manpower acceptance");
  });

  it("NOT_ACTIONABLE: opportunity lifecycle is CLOSED, overriding any technical eligibility", () => {
    const g = copy();
    g.opportunity.lifecycle = "CLOSED";
    const { eligibility, gated } = evaluate(g, NO_ACTIONABILITY_EVIDENCE("opp"));
    const { classification, reason } = classifyOperationalStatus(g, eligibility, gated);
    expect(classification).toBe("NOT_ACTIONABLE");
    expect(reason).toContain("CLOSED");
  });

  it("WATCH: a legitimate but far-from-HOT opportunity with many real gaps, not fabricated as NEAR_READY or HOT", () => {
    const g = copy();
    g.demandSignals = [];
    g.companies = [];
    g.companyRoles = [];
    g.project = null;
    g.acceptance = null;
    g.contactRoutes = [];
    g.routeGrades = [];
    const { eligibility, gated, action } = evaluate(g, NO_ACTIONABILITY_EVIDENCE("opp"));
    expect(eligibility.every((e) => !e.eligible)).toBe(true);
    const { classification } = classifyOperationalStatus(g, eligibility, gated);
    expect(classification).toBe("WATCH");
    // no fabricated action: with no contact route at all, the real commercial-action
    // engine truthfully recommends finding/verifying a contact, not an invented CALL_TODAY
    expect(action.action).toBe("VERIFY_CONTACT");
  });

  it("human verification requirement is visible in failedRequirements when a required review is unresolved", () => {
    const g = copy();
    g.verificationReviews = [{ id: "review", target_type: "CONTACT_ROUTE", target_id: "route", decision: "NEEDS_MORE_EVIDENCE", decided_at: asOf.toISOString() }];
    const { eligibility } = evaluate(g, NO_ACTIONABILITY_EVIDENCE("opp"));
    expect(eligibility.some((e) => e.failedRequirements.includes("HUMAN_VERIFICATION_REQUIRED"))).toBe(true);
  });
});

/* -------------------------------------------------------------------- */
/* Part B/C: real Postgres-backed integration via PGlite.                 */
/* -------------------------------------------------------------------- */

const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql", "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql", "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql", "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql", "20260817110000_eligibility_engine.sql", "20260817120000_explainable_scoring.sql",
  "20260817130000_commercial_action_engine.sql", "20260817140000_contact_grade_ordering.sql",
];

describe("operational evaluation against a real (PGlite) database", () => {
  let db: PGlite, repo: PostgresOpportunityRepository, service: OpportunityService, ev: PostgresEvidenceRepository, n = 0;

  beforeAll(async () => {
    db = new PGlite();
    for (const m of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", m), "utf8"));
    const client = db as unknown as SqlClient;
    repo = new PostgresOpportunityRepository(client);
    service = new OpportunityService(repo, () => asOf);
    ev = new PostgresEvidenceRepository(client);
  });
  afterAll(async () => db.close());

  async function ctx(stale = false) {
    n++;
    const s = await db.query<{ id: string }>("insert into sources(name)values($1)returning id", [`Op-source ${n}`]);
    const e = await ev.create({ sourceId: s.rows[0].id, sourceUrl: `https://fixture/op/${n}`, capturedAt: asOf, captureMethod: "HTTP_FETCH", contentHash: createHash("sha256").update(`op-${n}`).digest("hex"), payloadSizeBytes: 12 });
    const d = await db.query<{ id: string }>("insert into demand_signals(title,role_type,source_id,raw_evidence_id,source_identity_key,last_seen_at,stale_after)values('Electrician','ELECTRICIAN',$1,$2,$3,$4,$5)returning id", [s.rows[0].id, e.id, `external:op-${n}`, asOf.toISOString(), stale ? "2026-08-19T00:00:00Z" : null]);
    return { evidenceId: e.id, demandId: d.rows[0].id };
  }

  it("evaluates a minimal real opportunity as WATCH, with truthful gaps, and mutates nothing", async () => {
    // A project (so HOT_B's UNKNOWN_BUYER requirement, which passes when there is
    // no project, correctly fails here too) plus a stale demand signal pushes the
    // closer HOT type (HOT_B) to 3 failed requirements -- genuinely past the
    // NEAR_READY threshold, not an artificially-tuned fixture.
    const project = await db.query<{ id: string }>("insert into projects(name,location_text)values('Watch Project','Dallas, TX')returning id");
    const c = await ctx(true);
    const opportunity = await service.create({ demandSignalIds: [c.demandId], unresolvedCompanyContext: "Unresolved Co", projectId: project.rows[0].id, observedAt: asOf });
    const client = db as unknown as SqlClient;

    const countsBefore = await Promise.all([
      db.query<{ count: string }>("select count(*)::text count from opportunity_completeness_snapshots"),
      db.query<{ count: string }>("select count(*)::text count from eligibility_evaluation_snapshots"),
      db.query<{ count: string }>("select count(*)::text count from score_result_snapshots"),
      db.query<{ count: string }>("select count(*)::text count from commercial_action_snapshots"),
    ]);

    const result = await evaluateOpportunityOperationalResult(opportunity.id, asOf, client);

    expect(result.classification).toBe("WATCH");
    expect(result.gaps.length).toBeGreaterThan(0);
    // no fabricated active action for a WATCH opportunity -- a real internal
    // verification step is recommended, never CALL_TODAY/EMAIL_TODAY/etc.
    expect(["VERIFY_MANPOWER_ACCEPTANCE", "VERIFY_CONTACT", "RESEARCH_PROJECT", "WAIT"]).toContain(result.commercialAction.action);
    expect(result.missing.length).toBeGreaterThan(0);

    const countsAfter = await Promise.all([
      db.query<{ count: string }>("select count(*)::text count from opportunity_completeness_snapshots"),
      db.query<{ count: string }>("select count(*)::text count from eligibility_evaluation_snapshots"),
      db.query<{ count: string }>("select count(*)::text count from score_result_snapshots"),
      db.query<{ count: string }>("select count(*)::text count from commercial_action_snapshots"),
    ]);
    for (let i = 0; i < countsBefore.length; i++) {
      expect(countsAfter[i].rows[0].count).toBe(countsBefore[i].rows[0].count);
    }
  });

  it("NOT_FOUND semantics for an id that does not exist", async () => {
    const client = db as unknown as SqlClient;
    await expect(evaluateOpportunityOperationalResult("00000000-0000-4000-8000-000000000000", asOf, client)).rejects.toThrow(/not found/i);
  });

  it("cross-opportunity radar aggregates real opportunities with truthful coverage accounting", async () => {
    const a = await ctx();
    const b = await ctx();
    await service.create({ demandSignalIds: [a.demandId], unresolvedCompanyContext: "Radar Co A", observedAt: asOf });
    await service.create({ demandSignalIds: [b.demandId], unresolvedCompanyContext: "Radar Co B", observedAt: asOf });
    const client = db as unknown as SqlClient;

    const summary = await evaluateOperationalRadar(asOf, client);
    expect(summary.totalOpportunities).toBeGreaterThanOrEqual(3); // includes the opportunity from the prior test
    expect(summary.evaluatedCount).toBe(summary.items.length);
    expect(summary.coverageComplete).toBe(true);
    expect(summary.failedCount).toBe(0);
    expect(summary.items.every((item) => ["HOT", "NEAR_READY", "WATCH", "NOT_ACTIONABLE"].includes(item.classification))).toBe(true);
  });
});
