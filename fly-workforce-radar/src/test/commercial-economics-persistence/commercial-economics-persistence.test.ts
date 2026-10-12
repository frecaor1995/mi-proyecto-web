import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BurdenComponent, BurdenProfileScope } from "../../domain/burden-profile";
import type { CommercialTermsContract } from "../../domain/commercial-terms";
import { assumedValue, unknownValue, verifiedValue } from "../../domain/commercial-economics";
import { createMoneyAmount, createPaymentTerms, createRate } from "../../domain/commercial-economics";
import { PostgresBurdenProfileRepository } from "../../server/repositories/burden-profile/postgres-burden-profile-repository";
import { PostgresCommercialTermsRepository } from "../../server/repositories/commercial-terms/postgres-commercial-terms-repository";
import { PostgresEconomicsScenarioRepository } from "../../server/repositories/economics-scenario/postgres-economics-scenario-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresClaimRepository } from "../../server/repositories/claims/postgres-claim-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";
import { ClaimService } from "../../server/services/claims/claim-service";

const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql", "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql", "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql", "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql", "20260817110000_eligibility_engine.sql", "20260817120000_explainable_scoring.sql",
  "20260817130000_commercial_action_engine.sql", "20260817140000_contact_grade_ordering.sql", "20260817150000_production_source_architecture.sql",
  "20260817160000_first_production_adapters.sql", "20260817170000_production_capture_closeout.sql",
  "20260904010000_human_verification_domain.sql", "20260905010000_operator_identity_and_safe_mutation.sql",
  "20260907010000_commercial_economics_persistence.sql",
];
const now = new Date("2026-09-07T12:00:00Z");

describe("4C commercial economics persistence (real Postgres via PGlite)", () => {
  let db: PGlite;
  let terms: PostgresCommercialTermsRepository;
  let burden: PostgresBurdenProfileRepository;
  let scenarios: PostgresEconomicsScenarioRepository;
  let claimService: ClaimService;
  let evidenceRepository: PostgresEvidenceRepository;
  let companyId: string;
  let opportunityId: string;
  let sourceId: string;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    const client = db as unknown as SqlClient;
    terms = new PostgresCommercialTermsRepository(client);
    burden = new PostgresBurdenProfileRepository(client);
    scenarios = new PostgresEconomicsScenarioRepository(client);
    evidenceRepository = new PostgresEvidenceRepository(client);
    claimService = new ClaimService(new PostgresClaimRepository(client), evidenceRepository);

    companyId = (await db.query<{ id: string }>("insert into companies(common_name)values('4C Company')returning id")).rows[0].id;
    const project = (await db.query<{ id: string }>("insert into projects(name)values('4C Project')returning id")).rows[0];
    opportunityId = (await db.query<{ id: string }>("insert into opportunities(title,project_id,opportunity_identity_key)values('4C Opportunity',$1,'4c-opportunity')returning id", [project.id])).rows[0].id;
    sourceId = (await db.query<{ id: string }>("insert into sources(name)values('4C Test Source')returning id")).rows[0].id;
  });
  afterAll(async () => db.close());

  const fullTerms = (overrides: Partial<CommercialTermsContract> = {}): CommercialTermsContract => ({
    billRate: verifiedValue(createMoneyAmount(85, "USD")),
    overtimeBillBasis: verifiedValue({ kind: "MULTIPLIER", multiplier: createRate(1.5) }),
    reimbursablePerDiem: verifiedValue(createMoneyAmount(75, "USD")),
    perDiemMarkup: unknownValue(),
    paymentTerms: verifiedValue(createPaymentTerms(45)),
    billingCadence: verifiedValue("WEEKLY"),
    ...overrides,
  });

  describe("commercial terms persistence", () => {
    it("1/3/22. money round-trips with explicit currency, no USD default, multiple currencies coexist without FX", async () => {
      const usdVersion = await terms.createVersion({
        contextType: "OPPORTUNITY", companyId: null, opportunityId, terms: fullTerms(),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      expect(usdVersion.terms.billRate).toMatchObject({ tier: "VERIFIED", value: { amount: 85, currency: "USD" } });

      const project2 = (await db.query<{ id: string }>("insert into projects(name)values('4C CAD Project')returning id")).rows[0];
      const cadOpportunity = (await db.query<{ id: string }>("insert into opportunities(title,project_id,opportunity_identity_key)values('4C CAD Opportunity',$1,'4c-cad-opportunity')returning id", [project2.id])).rows[0].id;
      const cadVersion = await terms.createVersion({
        contextType: "OPPORTUNITY", companyId: null, opportunityId: cadOpportunity,
        terms: fullTerms({ billRate: verifiedValue(createMoneyAmount(60, "CAD")) }),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      expect(cadVersion.terms.billRate).toMatchObject({ tier: "VERIFIED", value: { amount: 60, currency: "CAD" } });
      // no default currency exists anywhere in the schema -- both persisted independently, correctly, with no coercion toward one another
    });

    it("2. zero money remains distinct from UNKNOWN through a full round-trip", async () => {
      const version = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null,
        terms: fullTerms({ reimbursablePerDiem: verifiedValue(createMoneyAmount(0, "USD")), perDiemMarkup: unknownValue() }),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      const reloaded = await terms.getById(version.id);
      expect(reloaded?.terms.reimbursablePerDiem).toEqual({ tier: "VERIFIED", value: { amount: 0, currency: "USD" } });
      expect(reloaded?.terms.perDiemMarkup).toEqual({ tier: "UNKNOWN" });
      expect("value" in (reloaded!.terms.perDiemMarkup as object)).toBe(false);
    });

    it("4. decimal-fraction rates round-trip without reinterpretation (150% OT multiplier stays 1.5, not 150)", async () => {
      const version = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null,
        terms: fullTerms({ overtimeBillBasis: verifiedValue({ kind: "MULTIPLIER", multiplier: createRate(1.5) }) }),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      const reloaded = await terms.getById(version.id);
      const basis = reloaded!.terms.overtimeBillBasis as { tier: string; value: { kind: string; multiplier: { value: number } } };
      expect(basis.value.multiplier.value).toBe(1.5);
    });

    it("5/6. VERIFIED/UNVERIFIED_SOURCED/OPERATOR_ASSUMPTION/UNKNOWN remain distinguishable, and an assumption never round-trips as verified", async () => {
      const version = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null,
        terms: fullTerms({ reimbursablePerDiem: assumedValue(createMoneyAmount(75, "USD")) }),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      const reloaded = await terms.getById(version.id);
      expect(reloaded?.terms.reimbursablePerDiem).toMatchObject({ tier: "OPERATOR_ASSUMPTION" });
      expect(reloaded?.terms.reimbursablePerDiem).not.toMatchObject({ tier: "VERIFIED" });
      expect(reloaded?.terms.billRate).toMatchObject({ tier: "VERIFIED" }); // sibling field, independently tiered
    });

    it("17. paymentTermsDays supports values outside 15/30/45/60", async () => {
      const version = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null,
        terms: fullTerms({ paymentTerms: verifiedValue(createPaymentTerms(7)) }),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      const reloaded = await terms.getById(version.id);
      expect(reloaded?.terms.paymentTerms).toMatchObject({ tier: "VERIFIED", value: { days: 7 } });
    });

    it("18. billing cadence persists correctly", async () => {
      const version = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null,
        terms: fullTerms({ billingCadence: verifiedValue("MONTHLY") }),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      expect((await terms.getById(version.id))?.terms.billingCadence).toEqual({ tier: "VERIFIED", value: "MONTHLY" });
    });

    it("20/21. evidence/claim provenance and company/opportunity context are preserved", async () => {
      const evidence = await evidenceRepository.create({ sourceId, sourceUrl: "https://example.com/rate-sheet", capturedAt: now, captureMethod: "MANUAL", contentHash: "a".repeat(64), payloadSizeBytes: 10, metadata: {} });
      const claim = await claimService.create({
        subject: { type: "COMPANY", id: companyId }, predicate: "client_bill_rate", value: { amount: 85, currency: "USD" },
        assertionKind: "FACT", evidenceIds: [evidence.id], assertedAt: now, assertedBy: "operator:test",
      });
      const version = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null, terms: fullTerms(),
        supportingClaimIds: [claim.id], supportingEvidenceIds: [evidence.id],
        ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      const reloaded = await terms.getById(version.id);
      expect(reloaded?.supportingClaimIds).toEqual([claim.id]);
      expect(reloaded?.supportingEvidenceIds).toEqual([evidence.id]);
      expect(reloaded?.companyId).toBe(companyId);
      expect(reloaded?.opportunityId).toBeNull();
    });

    it("11/13. commercial terms history is non-destructive; supersession preserves the prior version and getCurrent resolves the newest", async () => {
      const v1 = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null, terms: fullTerms({ billRate: verifiedValue(createMoneyAmount(80, "USD")) }),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:a", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      const v2 = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null, terms: fullTerms({ billRate: verifiedValue(createMoneyAmount(90, "USD")) }),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:b", evaluatedAt: new Date(now.getTime() + 1000), supersedesCommercialTermsId: v1.id,
      });
      expect(await terms.getById(v1.id)).toMatchObject({ id: v1.id, terms: { billRate: { value: { amount: 80 } } } }); // still there, untouched
      const current = await terms.getCurrent("COMPANY", companyId);
      expect(current?.id).toBe(v2.id);
      const history = await terms.listHistory("COMPANY", companyId);
      expect(history.map((h) => h.id)).toContain(v1.id);
      expect(history.map((h) => h.id)).toContain(v2.id);
    });

    it("14. self-supersession is rejected", async () => {
      await expect(db.query(
        `insert into commercial_terms_versions(id,context_type,company_id,terms,rule_version,evaluated_at,supersedes_commercial_terms_id)
         values($1,'COMPANY',$2,'{}'::jsonb,'x',now(),$1)`,
        ["11111111-1111-4111-8111-111111111111", companyId],
      )).rejects.toThrow();
    });

    it("concurrency guard: two versions cannot both claim to supersede the same prior version", async () => {
      const base = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null, terms: fullTerms(),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:a", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null, terms: fullTerms(),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:b", evaluatedAt: now, supersedesCommercialTermsId: base.id,
      });
      await expect(terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null, terms: fullTerms(),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:c", evaluatedAt: now, supersedesCommercialTermsId: base.id,
      })).rejects.toThrow();
    });

    it("15/16. commercial_terms_versions is append-only: update and delete are both rejected", async () => {
      const version = await terms.createVersion({
        contextType: "COMPANY", companyId, opportunityId: null, terms: fullTerms(),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      await expect(db.query("update commercial_terms_versions set rule_version='tampered' where id=$1", [version.id])).rejects.toThrow(/append-only/);
      await expect(db.query("delete from commercial_terms_versions where id=$1", [version.id])).rejects.toThrow(/append-only/);
    });
  });

  describe("burden profile persistence", () => {
    it("7/8. scope level, jurisdiction, trade, occupation, and company remain distinct and are not confused with one another", async () => {
      const jurisdictionScope: BurdenProfileScope = { level: "JURISDICTION", jurisdiction: "TX", tradeId: null, occupationId: null, companyId: null, scenarioId: null };
      const tradeScope: BurdenProfileScope = { level: "TRADE_OCCUPATION", jurisdiction: null, tradeId: "ELECTRICAL", occupationId: "ELECTRICIAN", companyId: null, scenarioId: null };
      const companyScope: BurdenProfileScope = { level: "COMPANY_OVERRIDE", jurisdiction: null, tradeId: null, occupationId: null, companyId, scenarioId: null };

      await burden.createVersion({ scope: jurisdictionScope, components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null });
      await burden.createVersion({ scope: tradeScope, components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null });
      await burden.createVersion({ scope: companyScope, components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null });

      expect((await burden.getCurrentForScope(jurisdictionScope))?.scope).toEqual(jurisdictionScope);
      expect((await burden.getCurrentForScope(tradeScope))?.scope).toEqual(tradeScope);
      expect((await burden.getCurrentForScope(companyScope))?.scope).toEqual(companyScope);
      expect(await burden.getCurrentForScope({ level: "PLATFORM_DEFAULT", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: null })).toBeNull();
    });

    it("23. multiple distinct trade/occupation contexts work without any hardcoded trade", async () => {
      const electrical: BurdenProfileScope = { level: "TRADE_OCCUPATION", jurisdiction: null, tradeId: "ELECTRICAL", occupationId: "ELECTRICIAN", companyId: null, scenarioId: null };
      const welding: BurdenProfileScope = { level: "TRADE_OCCUPATION", jurisdiction: null, tradeId: "WELDING", occupationId: null, companyId: null, scenarioId: null };
      const electricalVersion = await burden.createVersion({ scope: electrical, components: [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.14)), appliesTo: ["REGULAR_WAGES"] }], ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null });
      const weldingVersion = await burden.createVersion({ scope: welding, components: [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.22)), appliesTo: ["REGULAR_WAGES"] }], ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null });
      expect(electricalVersion.scope.tradeId).toBe("ELECTRICAL");
      expect(weldingVersion.scope.tradeId).toBe("WELDING");
      expect((await burden.getCurrentForScope(electrical))?.components[0].rate).toMatchObject({ value: { value: 0.14 } });
      expect((await burden.getCurrentForScope(welding))?.components[0].rate).toMatchObject({ value: { value: 0.22 } });
    });

    it("9. burden component applicability to regular / OT base / OT premium persists correctly", async () => {
      const scope: BurdenProfileScope = { level: "PLATFORM_DEFAULT", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: null };
      const version = await burden.createVersion({ scope, components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null });
      const reloaded = await burden.getById(version.id);
      const payrollTax = reloaded!.components.find((c) => c.type === "PAYROLL_TAX")!;
      const workersComp = reloaded!.components.find((c) => c.type === "WORKERS_COMPENSATION")!;
      expect(payrollTax.appliesTo).toEqual(["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"]);
      expect(workersComp.appliesTo).toEqual(["REGULAR_WAGES"]);
    });

    it("10. burden history is non-destructive across a supersession chain", async () => {
      const scope: BurdenProfileScope = { level: "JURISDICTION", jurisdiction: "CA", tradeId: null, occupationId: null, companyId: null, scenarioId: null };
      const v1 = await burden.createVersion({ scope, components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:a", evaluatedAt: now, supersedesBurdenProfileId: null });
      const v2 = await burden.createVersion({ scope, components: components(), ruleVersion: "burden@4c.2", assertedBy: "operator:b", evaluatedAt: new Date(now.getTime() + 1000), supersedesBurdenProfileId: v1.id });
      expect(await burden.getById(v1.id)).not.toBeNull();
      expect((await burden.getCurrentForScope(scope))?.id).toBe(v2.id);
      const history = await burden.listHistoryForScope(scope);
      expect(history).toHaveLength(2);
    });

    it("append-only: update and delete on burden_profile_versions are rejected", async () => {
      const scope: BurdenProfileScope = { level: "PLATFORM_DEFAULT", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: null };
      const version = await burden.createVersion({ scope, components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null });
      await expect(db.query("update burden_profile_versions set rule_version='tampered' where id=$1", [version.id])).rejects.toThrow(/append-only/);
      await expect(db.query("delete from burden_profile_versions where id=$1", [version.id])).rejects.toThrow(/append-only/);
    });
  });

  describe("economics scenario snapshots", () => {
    it("19. BASE/CONSERVATIVE/TARGET persist as scenario labels, never confused with a fact tier", async () => {
      const snapshot = await scenarios.createSnapshot({
        opportunityId, scenarioLabel: "TARGET", commercialTermsVersionId: null, burdenProfileVersionId: null,
        basis: { headcount: { tier: "VERIFIED", value: 4 } }, result: {},
        ruleVersion: "scenario@4c.1", assertedBy: "operator:test", evaluatedAt: now, asOf: now, supersedesScenarioId: null,
      });
      expect(snapshot.scenarioLabel).toBe("TARGET");
      expect(["VERIFIED", "UNVERIFIED_SOURCED", "OPERATOR_ASSUMPTION", "UNKNOWN"]).not.toContain(snapshot.scenarioLabel);
    });

    it("12/13. scenario history is non-destructive; supersession preserves the prior snapshot", async () => {
      const v1 = await scenarios.createSnapshot({
        opportunityId, scenarioLabel: "BASE", commercialTermsVersionId: null, burdenProfileVersionId: null,
        basis: { note: "first pass" }, result: {}, ruleVersion: "scenario@4c.1", assertedBy: "operator:a", evaluatedAt: now, asOf: now, supersedesScenarioId: null,
      });
      const v2 = await scenarios.createSnapshot({
        opportunityId, scenarioLabel: "BASE", commercialTermsVersionId: null, burdenProfileVersionId: null,
        basis: { note: "revised" }, result: {}, ruleVersion: "scenario@4c.2", assertedBy: "operator:b", evaluatedAt: new Date(now.getTime() + 1000), asOf: now, supersedesScenarioId: v1.id,
      });
      expect((await scenarios.getById(v1.id))?.basis).toEqual({ note: "first pass" }); // untouched
      expect((await scenarios.getById(v2.id))?.supersedesScenarioId).toBe(v1.id);
    });

    it("self-supersession is rejected for scenarios too", async () => {
      await expect(db.query(
        `insert into economics_scenario_snapshots(id,opportunity_id,scenario_label,basis,rule_version,evaluated_at,as_of,supersedes_scenario_id)
         values($1,$2,'BASE','{}'::jsonb,'x',now(),now(),$1)`,
        ["22222222-2222-4222-8222-222222222222", opportunityId],
      )).rejects.toThrow();
    });

    it("append-only: update and delete on economics_scenario_snapshots are rejected", async () => {
      const snapshot = await scenarios.createSnapshot({
        opportunityId, scenarioLabel: "CONSERVATIVE", commercialTermsVersionId: null, burdenProfileVersionId: null,
        basis: {}, result: {}, ruleVersion: "scenario@4c.1", assertedBy: "operator:test", evaluatedAt: now, asOf: now, supersedesScenarioId: null,
      });
      await expect(db.query("update economics_scenario_snapshots set rule_version='tampered' where id=$1", [snapshot.id])).rejects.toThrow(/append-only/);
      await expect(db.query("delete from economics_scenario_snapshots where id=$1", [snapshot.id])).rejects.toThrow(/append-only/);
    });

    it("a scenario snapshot can reference the real commercial-terms and burden-profile versions it was evaluated against", async () => {
      const termsVersion = await terms.createVersion({
        contextType: "OPPORTUNITY", companyId: null, opportunityId, terms: fullTerms(),
        supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "commercial-terms@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesCommercialTermsId: null,
      });
      const burdenVersion = await burden.createVersion({
        scope: { level: "PLATFORM_DEFAULT", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: null },
        components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null,
      });
      const snapshot = await scenarios.createSnapshot({
        opportunityId, scenarioLabel: "TARGET", commercialTermsVersionId: termsVersion.id, burdenProfileVersionId: burdenVersion.id,
        basis: {}, result: {}, ruleVersion: "scenario@4c.1", assertedBy: "operator:test", evaluatedAt: now, asOf: now, supersedesScenarioId: null,
      });
      expect(snapshot.commercialTermsVersionId).toBe(termsVersion.id);
      expect(snapshot.burdenProfileVersionId).toBe(burdenVersion.id);
    });
  });

  describe("burden_profile_versions.scenario_id real foreign key (pre-commit correction)", () => {
    it("7. the full migration -- including the ALTER TABLE adding this FK -- applied cleanly through PGlite (implicit in every test above via beforeAll; asserted explicitly here)", async () => {
      const constraintCheck = await db.query<{ conname: string }>(
        `select conname from pg_constraint where conname = 'burden_profile_versions_scenario_id_fkey'`,
      );
      expect(constraintCheck.rows).toHaveLength(1);
    });

    it("1/3. a burden profile whose scenario_id references an existing scenario snapshot can be persisted and round-trips correctly", async () => {
      const scenario = await scenarios.createSnapshot({
        opportunityId, scenarioLabel: "TARGET", commercialTermsVersionId: null, burdenProfileVersionId: null,
        basis: {}, result: {}, ruleVersion: "scenario@4c.1", assertedBy: "operator:test", evaluatedAt: now, asOf: now, supersedesScenarioId: null,
      });
      const scope: BurdenProfileScope = { level: "SCENARIO_OVERRIDE", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: scenario.id };
      const version = await burden.createVersion({ scope, components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null });

      const reloaded = await burden.getById(version.id);
      expect(reloaded?.scope.scenarioId).toBe(scenario.id);
      expect((await burden.getCurrentForScope(scope))?.id).toBe(version.id);
    });

    it("2. a burden profile with a nonexistent scenario_id is rejected by the real database foreign-key constraint, not merely TypeScript validation", async () => {
      const randomScenarioId = "99999999-9999-4999-8999-999999999999";
      await expect(db.query(
        `insert into burden_profile_versions(scope_level,scenario_id,components,rule_version,evaluated_at)
         values('SCENARIO_OVERRIDE',$1,'[]'::jsonb,'burden@4c.1',now())`,
        [randomScenarioId],
      )).rejects.toThrow(/foreign key|violates/i);
    });

    it("4. the existing reverse relationship (economics_scenario_snapshots.burden_profile_version_id) still works unaffected by the new FK", async () => {
      const burdenVersion = await burden.createVersion({
        scope: { level: "PLATFORM_DEFAULT", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: null },
        components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null,
      });
      const scenario = await scenarios.createSnapshot({
        opportunityId, scenarioLabel: "BASE", commercialTermsVersionId: null, burdenProfileVersionId: burdenVersion.id,
        basis: {}, result: {}, ruleVersion: "scenario@4c.1", assertedBy: "operator:test", evaluatedAt: now, asOf: now, supersedesScenarioId: null,
      });
      expect((await scenarios.getById(scenario.id))?.burdenProfileVersionId).toBe(burdenVersion.id);
    });

    it("5. the new FK does not weaken append-only enforcement on either table", async () => {
      const scenario = await scenarios.createSnapshot({
        opportunityId, scenarioLabel: "CONSERVATIVE", commercialTermsVersionId: null, burdenProfileVersionId: null,
        basis: {}, result: {}, ruleVersion: "scenario@4c.1", assertedBy: "operator:test", evaluatedAt: now, asOf: now, supersedesScenarioId: null,
      });
      const scope: BurdenProfileScope = { level: "SCENARIO_OVERRIDE", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: scenario.id };
      const version = await burden.createVersion({ scope, components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:test", evaluatedAt: now, supersedesBurdenProfileId: null });

      await expect(db.query("update burden_profile_versions set rule_version='tampered' where id=$1", [version.id])).rejects.toThrow(/append-only/);
      await expect(db.query("delete from burden_profile_versions where id=$1", [version.id])).rejects.toThrow(/append-only/);
      await expect(db.query("update economics_scenario_snapshots set rule_version='tampered' where id=$1", [scenario.id])).rejects.toThrow(/append-only/);
      await expect(db.query("delete from economics_scenario_snapshots where id=$1", [scenario.id])).rejects.toThrow(/append-only/);
    });

    it("6. existing supersession behavior (including the supersedes-uniqueness concurrency guard) remains intact for scenario-scoped burden profiles", async () => {
      const scenario = await scenarios.createSnapshot({
        opportunityId, scenarioLabel: "TARGET", commercialTermsVersionId: null, burdenProfileVersionId: null,
        basis: {}, result: {}, ruleVersion: "scenario@4c.1", assertedBy: "operator:test", evaluatedAt: now, asOf: now, supersedesScenarioId: null,
      });
      const scope: BurdenProfileScope = { level: "SCENARIO_OVERRIDE", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: scenario.id };
      const v1 = await burden.createVersion({ scope, components: components(), ruleVersion: "burden@4c.1", assertedBy: "operator:a", evaluatedAt: now, supersedesBurdenProfileId: null });
      const v2 = await burden.createVersion({ scope, components: components(), ruleVersion: "burden@4c.2", assertedBy: "operator:b", evaluatedAt: new Date(now.getTime() + 1000), supersedesBurdenProfileId: v1.id });

      expect(await burden.getById(v1.id)).not.toBeNull();
      expect((await burden.getCurrentForScope(scope))?.id).toBe(v2.id);
      await expect(burden.createVersion({ scope, components: components(), ruleVersion: "burden@4c.3", assertedBy: "operator:c", evaluatedAt: now, supersedesBurdenProfileId: v1.id }))
        .rejects.toThrow();
    });
  });
});

function components(): BurdenComponent[] {
  return [
    { type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"] },
    { type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.14)), appliesTo: ["REGULAR_WAGES"] },
  ];
}
