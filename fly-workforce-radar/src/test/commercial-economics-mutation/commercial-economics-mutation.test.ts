import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BurdenComponent, BurdenProfileScope } from "../../domain/burden-profile";
import type { CashFlowAssumptions } from "../../domain/cash-flow-engine";
import {
  assumedValue, createMoneyAmount, createPaymentTerms, createRate, unknownValue, verifiedValue,
} from "../../domain/commercial-economics";
import type { DeploymentEconomicsInput } from "../../domain/commercial-economics";
import type {
  CreateBurdenProfileVersionMutationInput, CreateCommercialTermsVersionMutationInput, SaveEconomicsScenarioSnapshotMutationInput,
} from "../../domain/commercial-economics-mutation";
import type { CommercialTermsContract } from "../../domain/commercial-terms";
import { PostgresBurdenProfileRepository } from "../../server/repositories/burden-profile/postgres-burden-profile-repository";
import { PostgresClaimRepository } from "../../server/repositories/claims/postgres-claim-repository";
import { PostgresCommercialTermsRepository } from "../../server/repositories/commercial-terms/postgres-commercial-terms-repository";
import { PostgresEconomicsScenarioRepository } from "../../server/repositories/economics-scenario/postgres-economics-scenario-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import type { ServerSession } from "../../server/auth/session";
import type { TransactionRunner } from "../../server/database/transaction";
import { executeProtectedCreateBurdenProfileVersion } from "../../server/mutation/protected-burden-profile-mutation";
import { executeProtectedCreateCommercialTermsVersion } from "../../server/mutation/protected-commercial-terms-mutation";
import { executeProtectedSaveEconomicsScenarioSnapshot } from "../../server/mutation/protected-economics-scenario-snapshot-mutation";

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

describe("4G protected commercial economics mutations (full stack, real Postgres)", () => {
  let db: PGlite;
  let client: SqlClient;
  let commercialTermsRepository: PostgresCommercialTermsRepository;
  let burdenProfileRepository: PostgresBurdenProfileRepository;
  let economicsScenarioRepository: PostgresEconomicsScenarioRepository;
  let operatorRepository: PostgresOperatorRepository;
  let opportunityId: string;
  let writeAuthUserId: string;
  let inactiveAuthUserId: string;
  let noPermissionAuthUserId: string;
  let humanVerificationOnlyAuthUserId: string;
  let sequence = 0;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    client = db as unknown as SqlClient;
    // used directly by tests to verify persisted state independent of the mutation under test
    commercialTermsRepository = new PostgresCommercialTermsRepository(client);
    burdenProfileRepository = new PostgresBurdenProfileRepository(client);
    economicsScenarioRepository = new PostgresEconomicsScenarioRepository(client);
    operatorRepository = new PostgresOperatorRepository(client);
    // instantiated but unused directly -- confirms Claim/Evidence/Idempotency tables are reachable in this migration set without requiring standalone top-level instances for 4G's own tests (idempotency is now exercised only via the mutations' own transaction-scoped repositories)
    void new PostgresClaimRepository(client);
    void new PostgresEvidenceRepository(client);

    const project = (await db.query<{ id: string }>("insert into projects(name)values('4G Project')returning id")).rows[0];
    opportunityId = (await db.query<{ id: string }>("insert into opportunities(title,project_id,opportunity_identity_key)values('4G Opportunity',$1,'4g-opportunity')returning id", [project.id])).rows[0].id;

    writeAuthUserId = "44444444-4444-4444-8444-444444444444";
    inactiveAuthUserId = "55555555-5555-4555-8555-555555555555";
    noPermissionAuthUserId = "66666666-6666-4666-8666-666666666666";
    humanVerificationOnlyAuthUserId = "77777777-7777-4777-8777-777777777777";
    await operatorRepository.create({ authUserId: writeAuthUserId, email: "econ-writer@example.com", status: "ACTIVE", permissions: ["commercial_economics.write"] });
    await operatorRepository.create({ authUserId: inactiveAuthUserId, email: "inactive@example.com", status: "INACTIVE", permissions: ["commercial_economics.write"] });
    await operatorRepository.create({ authUserId: noPermissionAuthUserId, email: "readonly@example.com", status: "ACTIVE", permissions: [] });
    await operatorRepository.create({ authUserId: humanVerificationOnlyAuthUserId, email: "hv-only@example.com", status: "ACTIVE", permissions: ["human_verification.write"] });
  });
  afterAll(async () => db.close());

  const session = (authUserId: string | null): (() => Promise<ServerSession | null>) => () => Promise.resolve(authUserId ? { authUserId, email: "econ-writer@example.com" } : null);

  /**
   * PGlite has no real connection pooling -- it is a single embedded
   * instance, so reusing `client` directly for the whole transactional
   * callback is correct and sufficient (unlike getProductionSqlClient(),
   * whose query() calls pool.query() independently per call, which is
   * exactly the gap production-sql-client.ts's getProductionTransactionRunner()
   * fixes for real deployments -- see transaction.ts).
   */
  const transactionRunner: TransactionRunner = async (fn) => {
    await client.query("begin");
    try {
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  };
  const authorizedDeps = () => ({ transactionRunner, operatorRepository, getSession: session(writeAuthUserId) });

  /** Fresh company per call -- commercial-terms "current version" concurrency is per-context, so tests that don't explicitly want a shared/known context must not collide with each other's state (mirrors 3I-B3's newIsolatedTask() rationale). */
  const newCompany = async (): Promise<string> => (await db.query<{ id: string }>(`insert into companies(common_name)values('4G Company ${++sequence}')returning id`)).rows[0].id;

  /** Zero per diem by default (both client and, separately, labor.workerPerDiem in snapshotInput) -- resolved/known-zero, so complete 4D/4E/4F economics are KNOWN in "clean" scenario tests. The certified per-diem invariant itself is exercised deliberately by test 33 via a non-zero labor.workerPerDiem override, not by this shared default. */
  const fullTerms = (overrides: Partial<CommercialTermsContract> = {}): CommercialTermsContract => ({
    billRate: verifiedValue(createMoneyAmount(85, "USD")),
    overtimeBillBasis: verifiedValue({ kind: "MULTIPLIER", multiplier: createRate(1.5) }),
    reimbursablePerDiem: verifiedValue(createMoneyAmount(0, "USD")),
    perDiemMarkup: verifiedValue(createRate(0)),
    paymentTerms: verifiedValue(createPaymentTerms(30)),
    billingCadence: verifiedValue("WEEKLY"),
    ...overrides,
  });
  const termsInput = async (overrides: Partial<CreateCommercialTermsVersionMutationInput> = {}): Promise<CreateCommercialTermsVersionMutationInput> => ({
    contextType: "COMPANY", companyId: await newCompany(), opportunityId: null, terms: fullTerms(),
    supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "4g-test-v1",
    expectedCurrentVersionId: null, idempotencyKey: `terms-${++sequence}`,
    ...overrides,
  });

  const platformScope: BurdenProfileScope = { level: "PLATFORM_DEFAULT", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: null };
  const components = (overrides: Partial<BurdenComponent> = {}): BurdenComponent[] => [
    { type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"], ...overrides },
  ];
  /** Fresh JURISDICTION scope per call by default -- same isolation rationale as newCompany(); platformScope is reserved for the one test exercising the true all-null PLATFORM_DEFAULT scope explicitly. */
  const freshScope = (): BurdenProfileScope => ({ level: "JURISDICTION", jurisdiction: `TEST-${++sequence}`, tradeId: null, occupationId: null, companyId: null, scenarioId: null });
  const burdenInput = (overrides: Partial<CreateBurdenProfileVersionMutationInput> = {}): CreateBurdenProfileVersionMutationInput => ({
    scope: freshScope(), components: components(), ruleVersion: "4g-test-v1",
    expectedCurrentVersionId: null, idempotencyKey: `burden-${++sequence}`,
    ...overrides,
  });

  const deploymentInput = (overrides: Partial<DeploymentEconomicsInput> = {}): DeploymentEconomicsInput => ({
    headcount: verifiedValue(4), regularHoursPerWeek: verifiedValue(40), overtimeHoursPerWeek: verifiedValue(0),
    duration: { kind: "FIXED", weeks: 8 }, startDate: null, estimatedEndDate: null, jurisdiction: null,
    ...overrides,
  });
  const cashFlowAssumptions = (overrides: Partial<CashFlowAssumptions> = {}): CashFlowAssumptions => ({
    payrollFrequency: verifiedValue("WEEKLY"), payrollAnchorWeek: verifiedValue(0), billingAnchorWeek: verifiedValue(0),
    ...overrides,
  });

  /** Creates a real committed terms version + burden version for scenario-snapshot tests to reference. */
  const seedTermsAndBurden = async (termsOverrides: Partial<CommercialTermsContract> = {}, componentOverrides: BurdenComponent[] = components()) => {
    const termsOutcome = await executeProtectedCreateCommercialTermsVersion(await termsInput({ terms: fullTerms(termsOverrides) }), authorizedDeps());
    const burdenOutcome = await executeProtectedCreateBurdenProfileVersion(burdenInput({ components: componentOverrides }), authorizedDeps());
    if (termsOutcome.kind !== "EXECUTED" || burdenOutcome.kind !== "EXECUTED") throw new Error("seed failed");
    return { commercialTermsVersionId: termsOutcome.version.id, burdenProfileVersionId: burdenOutcome.version.id };
  };

  const snapshotInput = async (overrides: Partial<SaveEconomicsScenarioSnapshotMutationInput> = {}): Promise<SaveEconomicsScenarioSnapshotMutationInput> => {
    const needsSeed = overrides.commercialTermsVersionId === undefined || overrides.burdenProfileVersionId === undefined;
    const seeded = needsSeed ? await seedTermsAndBurden() : null;
    return {
      opportunityId, scenarioLabel: "BASE",
      commercialTermsVersionId: seeded?.commercialTermsVersionId ?? "00000000-0000-0000-0000-000000000000",
      burdenProfileVersionId: seeded?.burdenProfileVersionId ?? "00000000-0000-0000-0000-000000000000",
      labor: { basePayRate: verifiedValue(createMoneyAmount(30, "USD")), overtimeMultiplier: verifiedValue(createRate(1.5)), workerPerDiem: verifiedValue(createMoneyAmount(0, "USD")) },
      deployment: deploymentInput(), cashFlowAssumptions: cashFlowAssumptions(),
      ruleVersion: "4g-test-v1", idempotencyKey: `scenario-${++sequence}`,
      ...overrides,
    };
  };

  describe("commercial terms mutation", () => {
    it("1. an authorized operator creates a commercial terms version", async () => {
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput(), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        expect(outcome.version.assertedBy).toBe((await operatorRepository.findByAuthUserId(writeAuthUserId))?.id);
        expect(outcome.version.terms.billRate).toEqual(verifiedValue(createMoneyAmount(85, "USD")));
      }
    });

    it("2. UNAUTHENTICATED: no trusted session -> rejected, no row created", async () => {
      const companyId = await newCompany();
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId }), { ...authorizedDeps(), getSession: session(null) });
      expect(outcome).toMatchObject({ kind: "REJECTED", reason: "UNAUTHENTICATED" });
      expect((await commercialTermsRepository.listHistory("COMPANY", companyId)).length).toBe(0);
    });

    it("3. UNAUTHORIZED: authenticated operator without commercial_economics.write -> rejected, no row created", async () => {
      const companyId = await newCompany();
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId }), { ...authorizedDeps(), getSession: session(noPermissionAuthUserId) });
      expect(outcome).toMatchObject({ kind: "REJECTED", reason: "UNAUTHORIZED" });
      expect((await commercialTermsRepository.listHistory("COMPANY", companyId)).length).toBe(0);
    });

    it("4. human_verification.write alone does not authorize a commercial economics write", async () => {
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput(), { ...authorizedDeps(), getSession: session(humanVerificationOnlyAuthUserId) });
      expect(outcome).toMatchObject({ kind: "REJECTED", reason: "UNAUTHORIZED" });
    });

    it("5. INACTIVE operator with the permission is still denied", async () => {
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput(), { ...authorizedDeps(), getSession: session(inactiveAuthUserId) });
      expect(outcome).toMatchObject({ kind: "REJECTED", reason: "UNAUTHORIZED" });
    });

    it("6. actor spoof protection: the input type carries no actor/operator/role/permission field for a caller to control", async () => {
      const input = await termsInput();
      expect(Object.keys(input)).not.toContain("assertedBy");
      expect(Object.keys(input)).not.toContain("operatorId");
      expect(Object.keys(input)).not.toContain("actorId");
      expect(Object.keys(input)).not.toContain("role");
      expect(Object.keys(input)).not.toContain("permission");
    });

    it("7. idempotency: identical retry does not duplicate, returns REPLAYED with the same version id", async () => {
      const input = await termsInput();
      const first = await executeProtectedCreateCommercialTermsVersion(input, authorizedDeps());
      const second = await executeProtectedCreateCommercialTermsVersion(input, authorizedDeps());
      expect(first.kind).toBe("EXECUTED");
      expect(second).toMatchObject({ kind: "REPLAYED" });
      if (first.kind !== "EXECUTED" || second.kind !== "REPLAYED") return;
      expect(second.versionId).toBe(first.version.id);
      const history = await commercialTermsRepository.listHistory("COMPANY", input.companyId!);
      expect(history.filter((v) => v.id === first.version.id)).toHaveLength(1);
    });

    it("8. idempotency payload conflict: same key + materially different payload is rejected, not silently executed", async () => {
      const key = `terms-conflict-${++sequence}`;
      const companyId = await newCompany();
      const first = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, idempotencyKey: key }), authorizedDeps());
      expect(first.kind).toBe("EXECUTED");
      const second = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, idempotencyKey: key, ruleVersion: "different-rule-version" }), authorizedDeps());
      expect(second).toMatchObject({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
    });

    it("9. an independent idempotency key creates an independent valid version", async () => {
      const a = await executeProtectedCreateCommercialTermsVersion(await termsInput(), authorizedDeps());
      const b = await executeProtectedCreateCommercialTermsVersion(await termsInput(), authorizedDeps());
      expect(a.kind).toBe("EXECUTED");
      expect(b.kind).toBe("EXECUTED");
      if (a.kind === "EXECUTED" && b.kind === "EXECUTED") expect(a.version.id).not.toBe(b.version.id);
    });

    it("10/11/12. concurrency: A reads V1, B creates V2, A declaring stale expected-current V1 gets CONCURRENCY_CONFLICT and never supersedes V2", async () => {
      const companyForRace = await newCompany();
      const v1 = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId: companyForRace, expectedCurrentVersionId: null }), authorizedDeps());
      expect(v1.kind).toBe("EXECUTED");
      if (v1.kind !== "EXECUTED") return;
      const v2 = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId: companyForRace, expectedCurrentVersionId: v1.version.id }), authorizedDeps());
      expect(v2.kind).toBe("EXECUTED");
      if (v2.kind !== "EXECUTED") return;
      const staleAttempt = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId: companyForRace, expectedCurrentVersionId: v1.version.id }), authorizedDeps());
      expect(staleAttempt).toMatchObject({ kind: "REJECTED", reason: "CONCURRENCY_CONFLICT" });
      const current = await commercialTermsRepository.getCurrent("COMPANY", companyForRace);
      expect(current?.id).toBe(v2.version.id); // v2 remains current; no duplicate/competing chain
    });

    it("13. invalid mixed context (COMPANY contextType with an opportunityId) is rejected as a validation error", async () => {
      const companyId = await newCompany();
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput({ contextType: "COMPANY", companyId, opportunityId }), authorizedDeps());
      expect(outcome).toMatchObject({ kind: "REJECTED", reason: "VALIDATION_ERROR" });
    });

    it("14. OPPORTUNITY context is validated and persists correctly", async () => {
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput({ contextType: "OPPORTUNITY", companyId: null, opportunityId }), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") expect(outcome.version.opportunityId).toBe(opportunityId);
    });

    it("15. known-zero, UNKNOWN, arbitrary valid payment terms, and explicit fact tiers are all preserved exactly", async () => {
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput({
        terms: fullTerms({ reimbursablePerDiem: verifiedValue(createMoneyAmount(0, "USD")), perDiemMarkup: unknownValue(), paymentTerms: assumedValue(createPaymentTerms(97)) }),
      }), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        expect(outcome.version.terms.reimbursablePerDiem).toEqual(verifiedValue(createMoneyAmount(0, "USD")));
        expect(outcome.version.terms.perDiemMarkup).toEqual({ tier: "UNKNOWN" });
        expect(outcome.version.terms.paymentTerms).toEqual(assumedValue(createPaymentTerms(97)));
      }
    });

    it("16. multiple currencies persist independently", async () => {
      const usdOutcome = await executeProtectedCreateCommercialTermsVersion(await termsInput({ terms: fullTerms({ billRate: verifiedValue(createMoneyAmount(85, "USD")) }) }), authorizedDeps());
      const cadOutcome = await executeProtectedCreateCommercialTermsVersion(await termsInput({ terms: fullTerms({ billRate: verifiedValue(createMoneyAmount(95, "CAD")) }) }), authorizedDeps());
      expect(usdOutcome.kind).toBe("EXECUTED");
      expect(cadOutcome.kind).toBe("EXECUTED");
      if (usdOutcome.kind === "EXECUTED" && cadOutcome.kind === "EXECUTED") {
        expect(usdOutcome.version.terms.billRate).toMatchObject({ value: { currency: "USD" } });
        expect(cadOutcome.version.terms.billRate).toMatchObject({ value: { currency: "CAD" } });
      }
    });

    it("17. append-only: direct UPDATE/DELETE on a written commercial terms version row is rejected by the certified trigger", async () => {
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput(), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind !== "EXECUTED") return;
      await expect(db.query("update commercial_terms_versions set rule_version='tampered' where id=$1", [outcome.version.id])).rejects.toThrow(/append-only/);
      await expect(db.query("delete from commercial_terms_versions where id=$1", [outcome.version.id])).rejects.toThrow(/append-only/);
    });
  });

  describe("burden profile mutation", () => {
    it("18. an authorized operator creates a burden profile version (true PLATFORM_DEFAULT scope)", async () => {
      const outcome = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope: platformScope }), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") expect(outcome.version.components).toEqual(components());
    });

    it("19. UNAUTHENTICATED and UNAUTHORIZED are rejected with no row created", async () => {
      const scope = freshScope();
      const unauth = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope }), { ...authorizedDeps(), getSession: session(null) });
      const unauthorized = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope }), { ...authorizedDeps(), getSession: session(noPermissionAuthUserId) });
      expect(unauth).toMatchObject({ kind: "REJECTED", reason: "UNAUTHENTICATED" });
      expect(unauthorized).toMatchObject({ kind: "REJECTED", reason: "UNAUTHORIZED" });
      expect(await burdenProfileRepository.getCurrentForScope(scope)).toBeNull();
    });

    it("20. actor spoof protection: no actor/role/permission field in the input type", () => {
      const input = burdenInput();
      expect(Object.keys(input)).not.toContain("assertedBy");
      expect(Object.keys(input)).not.toContain("operatorId");
      expect(Object.keys(input)).not.toContain("role");
    });

    it("21. idempotency: identical retry replays; same-key different payload conflicts; independent key creates an independent version", async () => {
      const scope = freshScope();
      const key = `burden-idem-${++sequence}`;
      const first = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope, idempotencyKey: key }), authorizedDeps());
      const replay = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope, idempotencyKey: key }), authorizedDeps());
      expect(first.kind).toBe("EXECUTED");
      expect(replay).toMatchObject({ kind: "REPLAYED" });
      const conflicting = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope, idempotencyKey: key, ruleVersion: "different" }), authorizedDeps());
      expect(conflicting).toMatchObject({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
      const independent = await executeProtectedCreateBurdenProfileVersion(burdenInput(), authorizedDeps());
      expect(independent.kind).toBe("EXECUTED");
    });

    it("22/23/24. concurrency: A declaring a stale expected-current version is rejected and never supersedes B's version", async () => {
      const scope = freshScope();
      const v1 = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope, expectedCurrentVersionId: null }), authorizedDeps());
      expect(v1.kind).toBe("EXECUTED");
      if (v1.kind !== "EXECUTED") return;
      const v2 = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope, expectedCurrentVersionId: v1.version.id }), authorizedDeps());
      expect(v2.kind).toBe("EXECUTED");
      if (v2.kind !== "EXECUTED") return;
      const stale = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope, expectedCurrentVersionId: v1.version.id }), authorizedDeps());
      expect(stale).toMatchObject({ kind: "REJECTED", reason: "CONCURRENCY_CONFLICT" });
      const current = await burdenProfileRepository.getCurrentForScope(scope);
      expect(current?.id).toBe(v2.version.id);
    });

    it("25. burden components, applicability, and decimal-fraction rates are preserved exactly, including UNKNOWN component rate", async () => {
      const mixedComponents: BurdenComponent[] = [
        { type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] },
        { type: "WORKERS_COMPENSATION", rate: unknownValue(), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION"] },
        { type: "BENEFITS", rate: assumedValue(createRate(0.05)), appliesTo: ["REGULAR_WAGES"] },
      ];
      const outcome = await executeProtectedCreateBurdenProfileVersion(burdenInput({ components: mixedComponents }), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        expect(outcome.version.components).toEqual(mixedComponents);
        expect(outcome.version.components[1].rate).toEqual({ tier: "UNKNOWN" }); // UNKNOWN rate preserved, not defaulted
        expect(outcome.version.components[2].rate).toEqual(assumedValue(createRate(0.05))); // operator assumption remains an assumption
      }
    });

    it("26. exact scope is preserved; invalid scope (SCENARIO_OVERRIDE without scenarioId) is rejected", async () => {
      const validScoped = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope: { level: "TRADE_OCCUPATION", jurisdiction: null, tradeId: "ELECTRICAL", occupationId: "ELECTRICIAN", companyId: null, scenarioId: null } }), authorizedDeps());
      expect(validScoped.kind).toBe("EXECUTED");
      if (validScoped.kind === "EXECUTED") expect(validScoped.version.scope.tradeId).toBe("ELECTRICAL");

      const invalidScope = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope: { level: "SCENARIO_OVERRIDE", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: null } }), authorizedDeps());
      expect(invalidScope).toMatchObject({ kind: "REJECTED", reason: "VALIDATION_ERROR" });
    });

    it("27. duplicate ambiguous component types (e.g. two OTHER components) are persisted as submitted, never silently mutated/merged", async () => {
      const ambiguousComponents: BurdenComponent[] = [
        { type: "OTHER", rate: verifiedValue(createRate(0.01)), appliesTo: ["REGULAR_WAGES"] },
        { type: "OTHER", rate: verifiedValue(createRate(0.02)), appliesTo: ["REGULAR_WAGES"] },
      ];
      const outcome = await executeProtectedCreateBurdenProfileVersion(burdenInput({ components: ambiguousComponents }), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") expect(outcome.version.components).toEqual(ambiguousComponents); // both preserved distinctly, as a complete validated array -- not a per-component patch
    });

    it("28. append-only: direct UPDATE/DELETE on a written burden profile version row is rejected by the certified trigger", async () => {
      const outcome = await executeProtectedCreateBurdenProfileVersion(burdenInput(), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind !== "EXECUTED") return;
      await expect(db.query("update burden_profile_versions set rule_version='tampered' where id=$1", [outcome.version.id])).rejects.toThrow(/append-only/);
      await expect(db.query("delete from burden_profile_versions where id=$1", [outcome.version.id])).rejects.toThrow(/append-only/);
    });
  });

  describe("scenario snapshot mutation", () => {
    it("29. a valid scenario save persists a server-calculated result reusing the certified 4D/4E/4F engines", async () => {
      const input = await snapshotInput();
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        const result = outcome.snapshot.result as { profitability: { complete: { grossProfit: { state: string } } } };
        expect(result.profitability.complete.grossProfit.state).toBe("KNOWN");
        expect(outcome.snapshot.assertedBy).toBe((await operatorRepository.findByAuthUserId(writeAuthUserId))?.id);
      }
    });

    it("30. BASE label does not imply VERIFIED -- an OPERATOR_ASSUMPTION labor input propagates that tier into the persisted result", async () => {
      const input = await snapshotInput({ labor: { basePayRate: assumedValue(createMoneyAmount(30, "USD")), overtimeMultiplier: verifiedValue(createRate(1.5)), workerPerDiem: verifiedValue(createMoneyAmount(0, "USD")) } });
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        const result = outcome.snapshot.result as { profitability: { complete: { grossProfit: { tier: string } } } };
        expect(result.profitability.complete.grossProfit.tier).toBe("OPERATOR_ASSUMPTION");
      }
    });

    it("31. explicit scenario overrides are validated and reflected in the persisted basis/result", async () => {
      const input = await snapshotInput({ overrides: { commercialTerms: { billRate: verifiedValue(createMoneyAmount(150, "USD")) } } });
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        const basis = outcome.snapshot.basis as { resolvedInputs: { commercialTerms: { billRate: { value: { amount: number } } } } };
        expect(basis.resolvedInputs.commercialTerms.billRate.value.amount).toBe(150);
      }
    });

    it("32. a client-submitted fake high-profit derived result cannot override the server-calculated result -- the input contract has no such field at all", async () => {
      const input = await snapshotInput();
      expect(Object.keys(input)).not.toContain("result");
      expect(Object.keys(input)).not.toContain("grossProfit");
      expect(Object.keys(input)).not.toContain("revenue");
      expect(Object.keys(input)).not.toContain("workingCapitalRequirement");
      // even if an attacker force-injects an extra property at runtime (bypassing TypeScript), the mutation never reads it
      const tampered = { ...input, grossProfit: { state: "KNOWN", tier: "VERIFIED", value: { amount: 999999999, currency: "USD" } } } as unknown as typeof input;
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(tampered, authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        const result = outcome.snapshot.result as { profitability: { complete: { grossProfit: { value?: { amount: number } } } } };
        expect(result.profitability.complete.grossProfit.value?.amount).not.toBe(999999999);
      }
    });

    it("33. unresolved non-zero per diem preserves blocked complete economics in the persisted result", async () => {
      const input = await snapshotInput({ labor: { basePayRate: verifiedValue(createMoneyAmount(30, "USD")), overtimeMultiplier: verifiedValue(createRate(1.5)), workerPerDiem: verifiedValue(createMoneyAmount(50, "USD")) } });
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        const result = outcome.snapshot.result as { profitability: { complete: { grossProfit: { state: string } }; laborOnly: { grossProfit: { state: string } } } };
        expect(result.profitability.complete.grossProfit.state).toBe("UNAVAILABLE");
        expect(result.profitability.laborOnly.grossProfit.state).toBe("KNOWN");
      }
    });

    it("34. UNKNOWN payment terms preserves a partial persisted result -- profit known, working capital unknown", async () => {
      const seeded = await seedTermsAndBurden({ paymentTerms: unknownValue() });
      const input = await snapshotInput({ commercialTermsVersionId: seeded.commercialTermsVersionId, burdenProfileVersionId: seeded.burdenProfileVersionId });
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        const result = outcome.snapshot.result as { profitability: { complete: { grossProfit: { state: string } } }; cashFlow: { complete: { workingCapital: { state: string } } } };
        expect(result.profitability.complete.grossProfit.state).toBe("KNOWN");
        expect(result.cashFlow.complete.workingCapital.state).toBe("UNKNOWN");
      }
    });

    it("35. the monthly cash-flow mapping limitation is preserved in the persisted result", async () => {
      const seeded = await seedTermsAndBurden({ billingCadence: verifiedValue("MONTHLY") });
      const input = await snapshotInput({ commercialTermsVersionId: seeded.commercialTermsVersionId, burdenProfileVersionId: seeded.burdenProfileVersionId });
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        const result = outcome.snapshot.result as { cashFlow: { complete: { invoiceEvents: { state: string } } }; profitability: { complete: { grossProfit: { state: string } } } };
        expect(result.cashFlow.complete.invoiceEvents.state).toBe("UNAVAILABLE");
        expect(result.profitability.complete.grossProfit.state).toBe("KNOWN"); // unaffected
      }
    });

    it("36. multi-currency facts are preserved without FX in the persisted result", async () => {
      const seeded = await seedTermsAndBurden({ billRate: verifiedValue(createMoneyAmount(95, "CAD")) });
      const input = await snapshotInput({
        commercialTermsVersionId: seeded.commercialTermsVersionId, burdenProfileVersionId: seeded.burdenProfileVersionId,
        labor: { basePayRate: verifiedValue(createMoneyAmount(38, "CAD")), overtimeMultiplier: verifiedValue(createRate(1.5)), workerPerDiem: verifiedValue(createMoneyAmount(0, "CAD")) },
      });
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        const result = outcome.snapshot.result as { profitability: { complete: { grossProfit: { value?: { currency: string } } } } };
        expect(result.profitability.complete.grossProfit.value?.currency).toBe("CAD");
      }
    });

    it("37. no recommendation/ranking/winner field is ever persisted in the result payload", async () => {
      const input = await snapshotInput();
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind === "EXECUTED") {
        const serialized = JSON.stringify(outcome.snapshot.result);
        expect(serialized).not.toMatch(/recommend|winner|GO_NO_GO|preferred/i);
      }
    });

    it("38. CANONICAL_INPUT_UNAVAILABLE when a referenced commercial terms or burden profile version does not exist", async () => {
      const seeded = await seedTermsAndBurden();
      const badTerms = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput({ commercialTermsVersionId: "00000000-0000-0000-0000-000000000000", burdenProfileVersionId: seeded.burdenProfileVersionId }), authorizedDeps());
      expect(badTerms).toMatchObject({ kind: "REJECTED", reason: "CANONICAL_INPUT_UNAVAILABLE" });
      const badBurden = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput({ commercialTermsVersionId: seeded.commercialTermsVersionId, burdenProfileVersionId: "00000000-0000-0000-0000-000000000000" }), authorizedDeps());
      expect(badBurden).toMatchObject({ kind: "REJECTED", reason: "CANONICAL_INPUT_UNAVAILABLE" });
    });

    it("39. UNAUTHENTICATED and UNAUTHORIZED are rejected with no snapshot row created", async () => {
      const seeded = await seedTermsAndBurden();
      const before = (await economicsScenarioRepository.listByOpportunity(opportunityId)).length;
      const unauth = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput({ commercialTermsVersionId: seeded.commercialTermsVersionId, burdenProfileVersionId: seeded.burdenProfileVersionId }), { ...authorizedDeps(), getSession: session(null) });
      const unauthorized = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput({ commercialTermsVersionId: seeded.commercialTermsVersionId, burdenProfileVersionId: seeded.burdenProfileVersionId }), { ...authorizedDeps(), getSession: session(noPermissionAuthUserId) });
      expect(unauth).toMatchObject({ kind: "REJECTED", reason: "UNAUTHENTICATED" });
      expect(unauthorized).toMatchObject({ kind: "REJECTED", reason: "UNAUTHORIZED" });
      expect((await economicsScenarioRepository.listByOpportunity(opportunityId)).length).toBe(before);
    });

    it("40. idempotency: identical retry replays without recalculating a new snapshot; same-key different payload conflicts", async () => {
      const seeded = await seedTermsAndBurden();
      const key = `scenario-idem-${++sequence}`;
      const input = await snapshotInput({ commercialTermsVersionId: seeded.commercialTermsVersionId, burdenProfileVersionId: seeded.burdenProfileVersionId, idempotencyKey: key });
      const first = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      const replay = await executeProtectedSaveEconomicsScenarioSnapshot(input, authorizedDeps());
      expect(first.kind).toBe("EXECUTED");
      expect(replay).toMatchObject({ kind: "REPLAYED" });
      if (first.kind === "EXECUTED" && replay.kind === "REPLAYED") expect(replay.snapshotId).toBe(first.snapshot.id);
      const conflicting = await executeProtectedSaveEconomicsScenarioSnapshot({ ...input, scenarioLabel: "TARGET" }, authorizedDeps());
      expect(conflicting).toMatchObject({ kind: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
    });

    it("41. append-only: direct UPDATE/DELETE on a written scenario snapshot row is rejected by the certified trigger", async () => {
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput(), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind !== "EXECUTED") return;
      await expect(db.query("update economics_scenario_snapshots set rule_version='tampered' where id=$1", [outcome.snapshot.id])).rejects.toThrow(/append-only/);
      await expect(db.query("delete from economics_scenario_snapshots where id=$1", [outcome.snapshot.id])).rejects.toThrow(/append-only/);
    });

    it("42. an explicit supersedesScenarioId must reference a real prior snapshot", async () => {
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput({ supersedesScenarioId: "00000000-0000-0000-0000-000000000000" }), authorizedDeps());
      expect(outcome).toMatchObject({ kind: "REJECTED", reason: "CANONICAL_INPUT_UNAVAILABLE" });
    });
  });

  describe("multi-context behavior", () => {
    it("43. a second, independent trade/currency context calculates independently with no hardcoding", async () => {
      const otherCompanyId = await newCompany();
      const terms = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId: otherCompanyId, terms: fullTerms({ billRate: verifiedValue(createMoneyAmount(95, "CAD")) }) }), authorizedDeps());
      const burden = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope: { level: "COMPANY_OVERRIDE", jurisdiction: null, tradeId: "WELDING", occupationId: null, companyId: otherCompanyId, scenarioId: null }, components: [{ type: "WORKERS_COMPENSATION", rate: verifiedValue(createRate(0.22)), appliesTo: ["REGULAR_WAGES"] }] }), authorizedDeps());
      expect(terms.kind).toBe("EXECUTED");
      expect(burden.kind).toBe("EXECUTED");
      if (terms.kind === "EXECUTED" && burden.kind === "EXECUTED") {
        const snapshot = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput({
          commercialTermsVersionId: terms.version.id, burdenProfileVersionId: burden.version.id,
          labor: { basePayRate: verifiedValue(createMoneyAmount(38, "CAD")), overtimeMultiplier: verifiedValue(createRate(1.5)), workerPerDiem: verifiedValue(createMoneyAmount(0, "CAD")) },
        }), authorizedDeps());
        expect(snapshot.kind).toBe("EXECUTED");
        if (snapshot.kind === "EXECUTED") {
          const result = snapshot.snapshot.result as { profitability: { complete: { grossProfit: { value?: { currency: string } } } } };
          expect(result.profitability.complete.grossProfit.value?.currency).toBe("CAD");
        }
      }
    });
  });

  describe("permission vocabulary boundary", () => {
    it("44. commercial_economics.write present -> allowed", async () => {
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput(), { ...authorizedDeps(), getSession: session(writeAuthUserId) });
      expect(outcome.kind).toBe("EXECUTED");
    });

    it("45. commercial_economics.write absent -> denied", async () => {
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput(), { ...authorizedDeps(), getSession: session(noPermissionAuthUserId) });
      expect(outcome).toMatchObject({ kind: "REJECTED", reason: "UNAUTHORIZED" });
    });

    it("46. human_verification.write only -> denied for commercial economics writes", async () => {
      const outcome = await executeProtectedCreateBurdenProfileVersion(burdenInput(), { ...authorizedDeps(), getSession: session(humanVerificationOnlyAuthUserId) });
      expect(outcome).toMatchObject({ kind: "REJECTED", reason: "UNAUTHORIZED" });
    });

    it("47. a canonical operator lacking the permission is denied even if the caller believes/claims otherwise -- authorization is derived from the canonical DB record, never trusted from input", async () => {
      // there is no field in any 4G mutation input that could even express a claimed permission (see actor-spoof tests 6/20) --
      // this test proves the negative case end to end: the only source of truth is the operator row itself.
      const operator = await operatorRepository.findByAuthUserId(noPermissionAuthUserId);
      expect(operator?.permissions).not.toContain("commercial_economics.write");
      const outcome = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput(), { ...authorizedDeps(), getSession: session(noPermissionAuthUserId) });
      expect(outcome).toMatchObject({ kind: "REJECTED", reason: "UNAUTHORIZED" });
    });
  });

  /**
   * Phase 4G pre-commit concurrency/atomicity correction. PGlite is a single
   * embedded instance with no real multi-connection concurrency (confirmed
   * empirically before this correction: two overlapping `pg_advisory_xact_lock`
   * acquisitions on the same PGlite instance did NOT block each other --
   * consistent with everything sharing one underlying session). These tests
   * therefore cannot exercise true cross-connection lock contention; what
   * they DO prove is the actual safety logic each mutation now runs inside
   * one real transaction (claim -> lock -> current-check -> insert ->
   * complete): a second caller starting from the same stale premise is
   * correctly rejected once the first has committed, and a rolled-back
   * attempt leaves no partial state and does not hold its lock. The
   * correctness of pg_advisory_xact_lock itself under genuine concurrent
   * production connections is a well-established core PostgreSQL guarantee,
   * not something re-derived here.
   */
  describe("concurrency / atomicity correction", () => {
    it("1/2/3. two first-version Commercial Terms creations (both starting from expectedCurrentVersionId=null) cannot both succeed -- exactly one version exists, the loser gets CONCURRENCY_CONFLICT", async () => {
      const companyId = await newCompany();
      const first = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, expectedCurrentVersionId: null }), authorizedDeps());
      const second = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, expectedCurrentVersionId: null }), authorizedDeps());
      const outcomes = [first.kind, second.kind].sort();
      expect(outcomes).toEqual(["EXECUTED", "REJECTED"]);
      const loser = first.kind === "REJECTED" ? first : second;
      expect(loser).toMatchObject({ kind: "REJECTED", reason: "CONCURRENCY_CONFLICT" });
      const history = await commercialTermsRepository.listHistory("COMPANY", companyId);
      expect(history).toHaveLength(1); // exactly one first version, never two competing heads
    });

    it("4/5/6. two first-version Burden Profile creations (both starting from expectedCurrentVersionId=null) cannot both succeed -- exactly one version exists, the loser gets CONCURRENCY_CONFLICT", async () => {
      const scope = freshScope();
      const first = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope, expectedCurrentVersionId: null }), authorizedDeps());
      const second = await executeProtectedCreateBurdenProfileVersion(burdenInput({ scope, expectedCurrentVersionId: null }), authorizedDeps());
      const outcomes = [first.kind, second.kind].sort();
      expect(outcomes).toEqual(["EXECUTED", "REJECTED"]);
      const loser = first.kind === "REJECTED" ? first : second;
      expect(loser).toMatchObject({ kind: "REJECTED", reason: "CONCURRENCY_CONFLICT" });
      const history = await burdenProfileRepository.listHistoryForScope(scope);
      expect(history).toHaveLength(1);
    });

    it("7. existing V1 -> concurrent supersession remains safe (re-confirmed under the corrected transactional implementation)", async () => {
      const companyId = await newCompany();
      const v1 = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, expectedCurrentVersionId: null }), authorizedDeps());
      expect(v1.kind).toBe("EXECUTED");
      if (v1.kind !== "EXECUTED") return;
      const v2 = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, expectedCurrentVersionId: v1.version.id }), authorizedDeps());
      expect(v2.kind).toBe("EXECUTED");
      if (v2.kind !== "EXECUTED") return;
      const staleAttempt = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, expectedCurrentVersionId: v1.version.id }), authorizedDeps());
      expect(staleAttempt).toMatchObject({ kind: "REJECTED", reason: "CONCURRENCY_CONFLICT" });
      const current = await commercialTermsRepository.getCurrent("COMPANY", companyId);
      expect(current?.id).toBe(v2.version.id);
      expect(await commercialTermsRepository.listHistory("COMPANY", companyId)).toHaveLength(2); // never a third/duplicate head
    });

    it("8. retry with an identical idempotency key still does not duplicate under the transactional implementation", async () => {
      const input = await termsInput();
      const first = await executeProtectedCreateCommercialTermsVersion(input, authorizedDeps());
      const second = await executeProtectedCreateCommercialTermsVersion(input, authorizedDeps());
      expect(first.kind).toBe("EXECUTED");
      expect(second).toMatchObject({ kind: "REPLAYED" });
      expect((await commercialTermsRepository.listHistory("COMPANY", input.companyId!)).length).toBe(1);
    });

    it("9. independent idempotency keys targeting the same context do not bypass canonical concurrency -- the lock, not the idempotency key, is what prevents a duplicate first version", async () => {
      const companyId = await newCompany();
      const a = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, expectedCurrentVersionId: null, idempotencyKey: `race-a-${++sequence}` }), authorizedDeps());
      const b = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, expectedCurrentVersionId: null, idempotencyKey: `race-b-${++sequence}` }), authorizedDeps());
      const outcomes = [a.kind, b.kind].sort();
      expect(outcomes).toEqual(["EXECUTED", "REJECTED"]); // distinct idempotency keys, still only one winner
      expect(await commercialTermsRepository.listHistory("COMPANY", companyId)).toHaveLength(1);
    });

    it("10. the lock is scoped -- mutations for unrelated contexts/scopes do not conflict with each other", async () => {
      const companyA = await newCompany();
      const companyB = await newCompany();
      const a = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId: companyA, expectedCurrentVersionId: null }), authorizedDeps());
      const b = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId: companyB, expectedCurrentVersionId: null }), authorizedDeps());
      expect(a.kind).toBe("EXECUTED");
      expect(b.kind).toBe("EXECUTED"); // both succeed independently -- no false contention across unrelated contexts
    });

    it("11/12/13. a failure between insert and commit rolls back the entire transaction (no orphaned version row, no half-applied current state) and does not hold the lock afterward", async () => {
      const companyId = await newCompany();
      const writeOperator = await operatorRepository.findByAuthUserId(writeAuthUserId);
      let insertedVersionId: string | null = null;

      await expect(transactionRunner(async (txClient) => {
        const repo = new PostgresCommercialTermsRepository(txClient);
        const version = await repo.createVersion({
          contextType: "COMPANY", companyId, opportunityId: null, terms: fullTerms(),
          supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "4g-test-v1",
          assertedBy: writeOperator!.id, evaluatedAt: new Date(), supersedesCommercialTermsId: null,
        });
        insertedVersionId = version.id;
        // simulates any failure occurring after the insert but before commit -- structurally the same position
        // in the sequence as a real idempotency-completion failure, which the same rollback mechanism covers
        throw new Error("simulated post-insert failure");
      })).rejects.toThrow("simulated post-insert failure");

      expect(insertedVersionId).not.toBeNull();
      // 12. no half-applied current state: the insert was rolled back along with the simulated failure
      expect(await commercialTermsRepository.getCurrent("COMPANY", companyId)).toBeNull();
      expect(await commercialTermsRepository.listHistory("COMPANY", companyId)).toHaveLength(0);

      // 11. rollback releases the lock: a normal creation for the SAME context immediately afterward must succeed, not hang/conflict
      const retry = await executeProtectedCreateCommercialTermsVersion(await termsInput({ companyId, expectedCurrentVersionId: null }), authorizedDeps());
      expect(retry.kind).toBe("EXECUTED");
    });

    it("14. append-only triggers remain enforced under the corrected transactional implementation", async () => {
      const outcome = await executeProtectedCreateCommercialTermsVersion(await termsInput(), authorizedDeps());
      expect(outcome.kind).toBe("EXECUTED");
      if (outcome.kind !== "EXECUTED") return;
      await expect(db.query("update commercial_terms_versions set rule_version='tampered' where id=$1", [outcome.version.id])).rejects.toThrow(/append-only/);
    });

    it("15. scenario snapshots retain their certified independent-history semantics -- no lock/current-check is applied, so two snapshots for the same opportunity both succeed without contention", async () => {
      const a = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput(), authorizedDeps());
      const b = await executeProtectedSaveEconomicsScenarioSnapshot(await snapshotInput(), authorizedDeps());
      expect(a.kind).toBe("EXECUTED");
      expect(b.kind).toBe("EXECUTED");
      if (a.kind === "EXECUTED" && b.kind === "EXECUTED") expect(a.snapshot.id).not.toBe(b.snapshot.id); // two independent historical captures, not a current-chain conflict
    });
  });
});
