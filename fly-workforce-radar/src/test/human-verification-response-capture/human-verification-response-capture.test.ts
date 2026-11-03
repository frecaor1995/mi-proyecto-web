import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateHumanVerificationTaskInput, HumanVerificationTaskStatus } from "../../domain/human-verification";
import { executeProtectedHumanVerificationResponseCapture, type ResponseCaptureInput } from "../../server/mutation/protected-human-verification-response-capture";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresClaimRepository } from "../../server/repositories/claims/postgres-claim-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresHumanVerificationRepository } from "../../server/repositories/human-verification/postgres-human-verification-repository";
import { PostgresIdempotencyRepository } from "../../server/repositories/idempotency/postgres-idempotency-repository";
import { PostgresManpowerAcceptanceRepository } from "../../server/repositories/manpower-acceptance/postgres-manpower-acceptance-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";
import { PostgresSourceRepository } from "../../server/repositories/source/postgres-source-repository";
import { ClaimService } from "../../server/services/claims/claim-service";
import { HumanVerificationClosureService } from "../../server/services/human-verification/human-verification-closure-service";
import { HUMAN_VERIFICATION_RULE_VERSION, HumanVerificationService } from "../../server/services/human-verification/human-verification-service";
import type { HumanVerificationTransactionalAccess } from "../../server/services/human-verification/human-verification-service";
import { ManpowerAcceptanceService } from "../../server/services/manpower-acceptance/manpower-acceptance-service";
import type { ServerSession } from "../../server/auth/session";
import type { ResponseCaptureOwnershipRunner, TransactionRunner } from "../../server/database/transaction";

/**
 * TX-INTEGRITY-02. This `service` is the TEST'S OWN setup helper (used only
 * by newTask()/newIsolatedTask() below to seed tasks) -- it is a distinct
 * instance from the one protected-human-verification-response-capture.ts
 * constructs internally for its own recordInteraction/assessResponse calls,
 * which never invoke createTask/transitionTask. Giving this test-local
 * instance a transactional boundary does not touch that production file.
 * PGlite has no real connection pooling, so reusing the single client for
 * the whole transactional callback is correct and sufficient.
 */
function pgliteTransactional(client: SqlClient): HumanVerificationTransactionalAccess {
  const run: TransactionRunner = async (fn) => {
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
  return { run, repositoryFor: (scoped) => new PostgresHumanVerificationRepository(scoped) };
}

/**
 * TX-INTEGRITY-03B. Mirrors actions.ts's own closureServiceFor exactly: the
 * composition root (here, the test) builds a fresh closure service bound to
 * whatever transaction-scoped client a TransactionRunner callback hands it.
 */
function closureServiceFor(client: SqlClient): HumanVerificationClosureService {
  const evidenceRepository = new PostgresEvidenceRepository(client);
  const sourceRepository = new PostgresSourceRepository(client);
  const claimService = new ClaimService(new PostgresClaimRepository(client), evidenceRepository);
  const manpowerAcceptanceService = new ManpowerAcceptanceService(new PostgresManpowerAcceptanceRepository(client));
  return new HumanVerificationClosureService(evidenceRepository, sourceRepository, claimService, manpowerAcceptanceService);
}

const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql", "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql", "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql", "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql", "20260817110000_eligibility_engine.sql", "20260817120000_explainable_scoring.sql",
  "20260817130000_commercial_action_engine.sql", "20260817140000_contact_grade_ordering.sql", "20260817150000_production_source_architecture.sql",
  "20260817160000_first_production_adapters.sql", "20260817170000_production_capture_closeout.sql",
  "20260904010000_human_verification_domain.sql", "20260905010000_operator_identity_and_safe_mutation.sql",
  "20260909010000_response_capture_recovery_correlation.sql",
  "20260910070755_tx_integrity_05b_active_response_capture_task_guard.sql",
];

describe("3I-B3 protected human verification response capture (full stack, real Postgres)", () => {
  let db: PGlite;
  let humanVerificationRepository: PostgresHumanVerificationRepository;
  let service: HumanVerificationService;
  let operatorRepository: PostgresOperatorRepository;
  let idempotencyRepository: PostgresIdempotencyRepository;
  let transactionRunner: TransactionRunner;
  let companyId: string;
  let projectId: string;
  let activeAuthUserId: string;
  let inactiveAuthUserId: string;
  let noPermissionAuthUserId: string;
  let sequence = 0;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    const client = db as unknown as SqlClient;
    humanVerificationRepository = new PostgresHumanVerificationRepository(client);
    service = new HumanVerificationService(humanVerificationRepository, pgliteTransactional(client));
    operatorRepository = new PostgresOperatorRepository(client);
    idempotencyRepository = new PostgresIdempotencyRepository(client);
    transactionRunner = pgliteTransactional(client).run;

    companyId = (await db.query<{ id: string }>("insert into companies(common_name)values('B3 Company')returning id")).rows[0].id;
    projectId = (await db.query<{ id: string }>("insert into projects(name,location_text)values('B3 Project','Texas')returning id")).rows[0].id;

    activeAuthUserId = "11111111-1111-4111-8111-111111111111";
    inactiveAuthUserId = "22222222-2222-4222-8222-222222222222";
    noPermissionAuthUserId = "33333333-3333-4333-8333-333333333333";
    await operatorRepository.create({ authUserId: activeAuthUserId, email: "operator@example.com", status: "ACTIVE", permissions: ["human_verification.write"] });
    await operatorRepository.create({ authUserId: inactiveAuthUserId, email: "inactive@example.com", status: "INACTIVE", permissions: ["human_verification.write"] });
    await operatorRepository.create({ authUserId: noPermissionAuthUserId, email: "readonly@example.com", status: "ACTIVE", permissions: [] });
  });
  afterAll(async () => db.close());

  const newCompany = async () => (await db.query<{ id: string }>(`insert into companies(common_name)values('B3 Company ${++sequence}')returning id`)).rows[0].id;

  const newTask = async (overrides: Partial<CreateHumanVerificationTaskInput> = {}) => (await service.createTask({
    companyId, projectId, targetType: "MANPOWER_ACCEPTANCE", targetId: companyId,
    verificationObjective: `B3 task ${++sequence}`, questionType: "MANPOWER_ACCEPTANCE",
    primaryQuestion: "Does this company accept external supplemental manpower?", createdBy: "legacy:seed", ruleVersion: HUMAN_VERIFICATION_RULE_VERSION,
    scope: { companyScope: "UNKNOWN", projectId }, ...overrides,
  })).task;

  /** AF01-result-asserting tests need an isolated company: ManpowerAcceptanceService.evaluate() correctly considers ALL of a company's current claims, so sharing a company across tests would make one test's claim affect another's expected result -- this is real, correct engine behavior, not a bug to work around by any means other than isolation. */
  const newIsolatedTask = async (overrides: Partial<CreateHumanVerificationTaskInput> = {}) => {
    const isolatedCompanyId = await newCompany();
    const task = (await service.createTask({
      companyId: isolatedCompanyId, projectId, targetType: "MANPOWER_ACCEPTANCE", targetId: isolatedCompanyId,
      verificationObjective: `B3 isolated task ${++sequence}`, questionType: "MANPOWER_ACCEPTANCE",
      primaryQuestion: "Does this company accept external supplemental manpower?", createdBy: "legacy:seed", ruleVersion: HUMAN_VERIFICATION_RULE_VERSION,
      scope: { companyScope: "UNKNOWN", projectId }, ...overrides,
    })).task;
    return { task, companyId: isolatedCompanyId };
  };

  const ownershipTails = new Map<string, Promise<void>>();
  const deps = (ownedRunner: TransactionRunner = transactionRunner, ownedClient: SqlClient = db as unknown as SqlClient) => {
    const ownershipRunner: ResponseCaptureOwnershipRunner = async (idempotencyKey, fn) => {
      const prior = ownershipTails.get(idempotencyKey) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const tail = prior.then(() => held);
      ownershipTails.set(idempotencyKey, tail);
      await prior;
      try {
        return await fn({ client: ownedClient, transactionRunner: ownedRunner });
      } finally {
        release();
        if (ownershipTails.get(idempotencyKey) === tail) ownershipTails.delete(idempotencyKey);
      }
    };
    return { humanVerificationRepository, idempotencyRepository, transactionRunner: ownedRunner, ownershipRunner, closureServiceFor, operatorRepository };
  };
  const session = (authUserId: string | null): (() => Promise<ServerSession | null>) => () => Promise.resolve(authUserId ? { authUserId, email: "operator@example.com" } : null);

  const baseInput = (taskId: string, expectedTaskStatus: HumanVerificationTaskStatus, overrides: Partial<ResponseCaptureInput> = {}): ResponseCaptureInput => ({
    idempotencyKey: `key-${taskId}-${Math.random()}`, taskId, expectedTaskStatus,
    interactionMethod: "PHONE", interactionOutcome: "DECISION_MAKER_REACHED", attemptedAt: new Date("2026-09-06T12:00:00Z"),
    reachedHuman: true, personNameSnapshot: "Jamie Rivera", responseSummary: "Jamie confirmed the policy.",
    answerDisposition: "AFFIRMATIVE", authorityLevel: "AUTHORIZED_COMPANY_AUTHORITY", authorityBasis: "VP of Operations",
    commercialMechanism: "DIRECT_EXTERNAL_MANPOWER", ...overrides,
  });

  it("1/24. an authorized ACTIVE operator can submit a valid response and the resulting task state is returned", async () => {
    const { task } = await newIsolatedTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(), getSession: session(activeAuthUserId) });
    expect(outcome).toMatchObject({ kind: "EXECUTED", newTaskStatus: "READY_FOR_ASSESSMENT", canonicalOutcome: "AF01_EVALUATED", af01Result: "VERIFIED_POSITIVE" });
  });

  it("2. unauthenticated user rejected", async () => {
    const task = await newTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(), getSession: session(null) });
    expect(outcome).toEqual({ kind: "REJECTED", reason: "UNAUTHENTICATED" });
  });

  it("3. authenticated but unmapped user rejected", async () => {
    const task = await newTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(), getSession: session("99999999-9999-4999-8999-999999999999") });
    expect(outcome).toEqual({ kind: "REJECTED", reason: "UNAUTHORIZED" });
  });

  it("4. INACTIVE operator rejected", async () => {
    const task = await newTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(), getSession: session(inactiveAuthUserId) });
    expect(outcome).toEqual({ kind: "REJECTED", reason: "UNAUTHORIZED" });
  });

  it("5/27. missing human_verification.write is rejected, and no canonical closure is ever attempted for it", async () => {
    const task = await newTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(), getSession: session(noPermissionAuthUserId) });
    expect(outcome).toEqual({ kind: "REJECTED", reason: "UNAUTHORIZED" });
    const evaluations = await new PostgresManpowerAcceptanceRepository(db as unknown as SqlClient).listEvaluations(companyId);
    expect(evaluations.some((e) => e.evaluatedAt.getTime() === new Date("2026-09-06T12:00:00Z").getTime())).toBe(false);
  });

  it("6. actor identity cannot be browser-supplied -- ResponseCaptureInput carries no operator/actor field at all", async () => {
    const task = await newTask();
    const input = baseInput(task.id, "OPEN");
    expect(Object.keys(input)).not.toContain("operatorId");
    expect(Object.keys(input)).not.toContain("actorId");
    const outcome = await executeProtectedHumanVerificationResponseCapture(input, { ...deps(), getSession: session(activeAuthUserId) });
    expect(outcome.kind).toBe("EXECUTED");
  });

  it("7. an idempotent replay with the identical key returns the same result and creates no duplicate interaction/assessment", async () => {
    const task = await newTask();
    const input = { ...baseInput(task.id, "OPEN"), idempotencyKey: `replay-key-${task.id}` };
    const first = await executeProtectedHumanVerificationResponseCapture(input, { ...deps(), getSession: session(activeAuthUserId) });
    const second = await executeProtectedHumanVerificationResponseCapture(input, { ...deps(), getSession: session(activeAuthUserId) });
    expect(first.kind).toBe("EXECUTED");
    expect(second).toMatchObject({ kind: "REPLAYED", newTaskStatus: "READY_FOR_ASSESSMENT" });
    const interactions = await humanVerificationRepository.listInteractions(task.id);
    expect(interactions).toHaveLength(1);
  });

  it("8. a stale expected-task-status is rejected safely (concurrency)", async () => {
    const task = await newTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "ATTEMPTED"), { ...deps(), getSession: session(activeAuthUserId) });
    expect(outcome).toEqual({ kind: "REJECTED", reason: "STALE_STATE" });
  });

  it("9/10/11. interactions, assessments, and task events are append-only", async () => {
    const task = await newTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(), getSession: session(activeAuthUserId) });
    expect(outcome.kind).toBe("EXECUTED");
    const interactionId = outcome.kind === "EXECUTED" ? outcome.interactionId : "";
    const assessmentId = outcome.kind === "EXECUTED" ? outcome.assessmentId : null;
    await expect(db.query("update human_interactions set response_summary='tampered' where id=$1", [interactionId])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from human_interactions where id=$1", [interactionId])).rejects.toThrow(/append-only/);
    if (assessmentId) {
      await expect(db.query("update human_response_assessments set answer_disposition='NEGATIVE' where id=$1", [assessmentId])).rejects.toThrow(/append-only/);
    }
    const events = await humanVerificationRepository.listTaskEvents(task.id);
    const eventId = events.at(-1)!.id;
    await expect(db.query("update human_verification_task_events set reason='tampered' where id=$1", [eventId])).rejects.toThrow(/append-only/);
  });

  it("12. the faithful response summary is preserved verbatim, never rewritten to fit the controlled classification", async () => {
    const task = await newTask();
    const verbatimSummary = "Jamie said his office does not handle temporary labor and suggested speaking with procurement.";
    const outcome = await executeProtectedHumanVerificationResponseCapture(
      baseInput(task.id, "OPEN", { answerDisposition: "REFERRAL", commercialMechanism: null, responseSummary: verbatimSummary, followUpTarget: "Procurement department" }),
      { ...deps(), getSession: session(activeAuthUserId) },
    );
    expect(outcome).toMatchObject({ kind: "EXECUTED", canonicalOutcome: "NO_CANONICAL_CHANGE", newTaskStatus: "FOLLOW_UP_REQUIRED" });
    const interactions = await humanVerificationRepository.listInteractions(task.id);
    expect(interactions[0].responseSummary).toBe(verbatimSummary);
  });

  it("23. referral provenance (who referred, to where) is preserved on the assessment, not discarded", async () => {
    const task = await newTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(
      baseInput(task.id, "OPEN", { answerDisposition: "REFERRAL", commercialMechanism: null, followUpTarget: "Procurement — Alex Chen", assessmentNotes: "Referred by Jamie Rivera to procurement." }),
      { ...deps(), getSession: session(activeAuthUserId) },
    );
    expect(outcome.kind).toBe("EXECUTED");
    const assessmentId = outcome.kind === "EXECUTED" ? outcome.assessmentId : null;
    expect(assessmentId).not.toBeNull();
    const assessments = await humanVerificationRepository.listAssessments((await humanVerificationRepository.listInteractions(task.id))[0].id);
    expect(assessments[0]).toMatchObject({ followUpRequired: true, followUpTarget: "Procurement — Alex Chen", assessmentNotes: "Referred by Jamie Rivera to procurement." });
  });

  it("a non-substantive outcome (voicemail) records only an interaction, no assessment, no canonical change, and moves the task to ATTEMPTED", async () => {
    const task = await newTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(
      baseInput(task.id, "OPEN", { interactionOutcome: "VOICEMAIL_LEFT", reachedHuman: false, answerDisposition: null, authorityLevel: null, commercialMechanism: null, responseSummary: "Left a voicemail." }),
      { ...deps(), getSession: session(activeAuthUserId) },
    );
    expect(outcome).toMatchObject({ kind: "EXECUTED", newTaskStatus: "ATTEMPTED", assessmentId: null, canonicalOutcome: "NO_CANONICAL_CHANGE" });
  });

  it("TX-05B: a different active key for the same task is rejected before every business write", async () => {
    const task = await newTask();
    const operator = await operatorRepository.findByAuthUserId(activeAuthUserId);
    await idempotencyRepository.claim({
      idempotencyKey: `active-owner-${task.id}`, operatorId: operator!.id,
      action: "human_verification.capture_response", targetType: "HUMAN_VERIFICATION_TASK",
      targetId: task.id, requestFingerprint: "active-owner-fingerprint",
    });
    const outcome = await executeProtectedHumanVerificationResponseCapture(
      baseInput(task.id, "OPEN", { idempotencyKey: `loser-${task.id}` }),
      { ...deps(), getSession: session(activeAuthUserId) },
    );
    expect(outcome).toEqual({ kind: "REJECTED", reason: "TASK_CAPTURE_IN_PROGRESS" });
    expect(await humanVerificationRepository.listInteractions(task.id)).toHaveLength(0);
    expect((await humanVerificationRepository.listTaskEvents(task.id)).filter((event) => event.eventType === "STATE_CHANGED")).toHaveLength(0);
  });

  it("TX-05B: a different key after completion is stale before any business write", async () => {
    const task = await newTask();
    const first = await executeProtectedHumanVerificationResponseCapture(
      baseInput(task.id, "OPEN", { idempotencyKey: `completed-owner-${task.id}`, interactionOutcome: "VOICEMAIL_LEFT", reachedHuman: false, answerDisposition: null, authorityLevel: null, commercialMechanism: null }),
      { ...deps(), getSession: session(activeAuthUserId) },
    );
    expect(first).toMatchObject({ kind: "EXECUTED", newTaskStatus: "ATTEMPTED" });
    const second = await executeProtectedHumanVerificationResponseCapture(
      baseInput(task.id, "OPEN", { idempotencyKey: `post-completion-${task.id}` }),
      { ...deps(), getSession: session(activeAuthUserId) },
    );
    expect(second).toEqual({ kind: "REJECTED", reason: "STALE_STATE" });
    expect(await humanVerificationRepository.listInteractions(task.id)).toHaveLength(1);
  });

  it("28. the mutation never touches eligibility/scoring tables -- HOT/eligibility bypass is structurally impossible here", async () => {
    const task = await newTask();
    await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(), getSession: session(activeAuthUserId) });
    const eligibility = await db.query("select count(*) as c from eligibility_evaluation_snapshots");
    const scoring = await db.query("select count(*) as c from score_result_snapshots");
    expect(Number((eligibility.rows[0] as { c: string }).c)).toBe(0);
    expect(Number((scoring.rows[0] as { c: string }).c)).toBe(0);
  });

  it("a NEGATIVE authoritative response produces VERIFIED_NEGATIVE, never a positive result", async () => {
    const { task } = await newIsolatedTask();
    const outcome = await executeProtectedHumanVerificationResponseCapture(
      baseInput(task.id, "OPEN", { answerDisposition: "NEGATIVE", commercialMechanism: "DIRECT_HIRE_INTERNAL_ONLY", responseSummary: "We only hire directly." }),
      { ...deps(), getSession: session(activeAuthUserId) },
    );
    expect(outcome).toMatchObject({ kind: "EXECUTED", canonicalOutcome: "AF01_EVALUATED", af01Result: "VERIFIED_NEGATIVE" });
  });

  /**
   * TX-INTEGRITY-03B. Certifies the frozen architecture: interaction and
   * assessment are each independently durable (neither is wrapped in any
   * transaction and each must survive any downstream failure); the
   * canonical closure unit (evidence create -> claim createOrGet ->
   * evidence link -> claim transition -> AF01 evaluate+save) is one atomic
   * transaction, fully rolled back on any failure inside it, never
   * affecting the already-committed interaction/assessment; each task
   * transition hop is its own separate atomic transaction, never combined
   * with closure or with another hop. Uses the same scopedRunner/
   * failingRunner/same-connection-spy techniques already certified in
   * concurrency-and-protected-mutation.test.ts for 3I-B3R1/TX-INTEGRITY-02.
   */
  describe("TX-INTEGRITY-03B transaction integrity implementation", () => {
    function failingRunner(base: SqlClient, failWhen: RegExp): TransactionRunner {
      return async (fn) => {
        const scoped: SqlClient = {
          async query<Row>(text: string, values?: unknown[]) {
            if (failWhen.test(text)) throw new Error("INJECTED_FAILURE");
            return base.query<Row>(text, values);
          },
        };
        await base.query("begin");
        try {
          const result = await fn(scoped);
          await base.query("commit");
          return result;
        } catch (error) {
          await base.query("rollback").catch(() => {});
          throw error;
        }
      };
    }
    /**
     * Delegates every HumanVerificationRepository member to the real
     * repository except createAssessment, which is forced to throw --
     * reaches the interaction/assessment durability question from the
     * OTHER side: assessResponse is not part of any transaction at all, so
     * its failure cannot (and must not) roll back the interaction that
     * already committed before it ran.
     */
    const client = () => db as unknown as SqlClient;
    const nonSubstantive = (): Partial<ResponseCaptureInput> => ({
      interactionOutcome: "VOICEMAIL_LEFT", reachedHuman: false, answerDisposition: null, authorityLevel: null, commercialMechanism: null, responseSummary: "Left a voicemail.",
    });

    it("A. the interaction transaction persists even though the separate assessment transaction fails afterward", async () => {
      const task = await newTask();
      const failingTransactionRunner = failingRunner(client(), /^\s*insert into human_response_assessments/i);
      await expect(executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(failingTransactionRunner), getSession: session(activeAuthUserId) }))
        .rejects.toThrow("INJECTED_FAILURE");
      const interactions = await humanVerificationRepository.listInteractions(task.id);
      expect(interactions).toHaveLength(1); // committed independently before the assessment write ever ran
    });

    it("B. interaction and assessment both persist when the canonical closure transaction fails at its very first write", async () => {
      const task = await newTask();
      const failingTransactionRunner = failingRunner(client(), /^\s*insert into raw_evidence/i);
      await expect(executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(failingTransactionRunner), getSession: session(activeAuthUserId) }))
        .rejects.toThrow("INJECTED_FAILURE");
      const interactions = await humanVerificationRepository.listInteractions(task.id);
      expect(interactions).toHaveLength(1);
      const assessments = await humanVerificationRepository.listAssessments(interactions[0].id);
      expect(assessments).toHaveLength(1);
    });

    it("C/D. a failure forced at AF01 persistence rolls back the entire closure unit (evidence, claim, link, evaluation) while interaction and assessment remain committed", async () => {
      const { task, companyId: isolatedCompanyId } = await newIsolatedTask();
      const counts = async () => ({
        evidence: Number((await db.query<{ c: string }>("select count(*) as c from raw_evidence")).rows[0].c),
        claims: Number((await db.query<{ c: string }>("select count(*) as c from claims")).rows[0].c),
        links: Number((await db.query<{ c: string }>("select count(*) as c from evidence_links")).rows[0].c),
        evaluations: Number((await db.query<{ c: string }>("select count(*) as c from manpower_acceptance_evaluations where company_id=$1", [isolatedCompanyId])).rows[0].c),
      });
      const before = await counts();
      const failingTransactionRunner = failingRunner(client(), /^\s*insert into manpower_acceptance_evaluations/i);
      await expect(executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(failingTransactionRunner), getSession: session(activeAuthUserId) }))
        .rejects.toThrow("INJECTED_FAILURE");
      expect(await counts()).toEqual(before); // the whole closure unit rolled back: no orphan evidence, claim, link, or evaluation
      const interactions = await humanVerificationRepository.listInteractions(task.id);
      expect(interactions).toHaveLength(1);
      const assessments = await humanVerificationRepository.listAssessments(interactions[0].id);
      expect(assessments).toHaveLength(1);
    });

    it("E. a successful canonical closure commits every expected artifact: evidence, and a VERIFIED claim supported by it, and the AF01 evaluation", async () => {
      const { task, companyId: isolatedCompanyId } = await newIsolatedTask();
      const outcome = await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(), getSession: session(activeAuthUserId) });
      expect(outcome).toMatchObject({ kind: "EXECUTED", canonicalOutcome: "AF01_EVALUATED" });
      const evaluations = await db.query<{ c: string }>("select count(*) as c from manpower_acceptance_evaluations where company_id=$1", [isolatedCompanyId]);
      expect(Number(evaluations.rows[0].c)).toBe(1);
      const claims = await db.query<{ verification_state: string; supporting_evidence_id: string | null }>(
        "select verification_state, supporting_evidence_id from claims where company_id=$1", [isolatedCompanyId],
      );
      expect(claims.rows).toHaveLength(1);
      expect(claims.rows[0].verification_state).toBe("VERIFIED");
      expect(claims.rows[0].supporting_evidence_id).not.toBeNull(); // the claim carries real supporting evidence, not a bare assertion
      const evidence = await db.query<{ c: string }>("select count(*) as c from raw_evidence where id=$1", [claims.rows[0].supporting_evidence_id]);
      expect(Number(evidence.rows[0].c)).toBe(1);
    });

    it("F. every write inside the canonical closure transaction is issued on the identical transaction-scoped client", async () => {
      const { task } = await newIsolatedTask();
      // The claim's evidence-links insert is not exercised in this call path -- ClaimService.create()
      // seeds claims.supporting_evidence_id with the initial evidence directly, so hasEvidence() is
      // already satisfied and the separate evidence_links write never fires. Spied statements cover
      // every write this real call path DOES issue.
      const usedBy = new Map<"evidence" | "claim" | "evaluation", unknown>();
      const spyRunner: TransactionRunner = async (fn) => {
        const base = client();
        const scoped: SqlClient = {
          async query<Row>(text: string, values?: unknown[]) {
            if (/^\s*insert into raw_evidence/i.test(text)) usedBy.set("evidence", scoped);
            if (/^\s*insert into claims/i.test(text)) usedBy.set("claim", scoped);
            if (/^\s*insert into manpower_acceptance_evaluations/i.test(text)) usedBy.set("evaluation", scoped);
            return base.query<Row>(text, values);
          },
        };
        await base.query("begin");
        try {
          const result = await fn(scoped);
          await base.query("commit");
          return result;
        } catch (error) {
          await base.query("rollback").catch(() => {});
          throw error;
        }
      };
      const outcome = await executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(spyRunner), getSession: session(activeAuthUserId) });
      expect(outcome).toMatchObject({ kind: "EXECUTED", canonicalOutcome: "AF01_EVALUATED" });
      expect(usedBy.get("evidence")).toBeDefined();
      expect(usedBy.get("claim")).toBeDefined();
      expect(usedBy.get("evaluation")).toBeDefined();
      expect(new Set(usedBy.values()).size).toBe(1); // every closure write landed on the exact same scoped client
    });

    it("G. a task-transition hop's status update and event insert are issued on the identical transaction-scoped client", async () => {
      const task = await newTask();
      const usedBy = new Map<"update" | "insert", unknown>();
      const spyRunner: TransactionRunner = async (fn) => {
        const base = client();
        const scoped: SqlClient = {
          async query<Row>(text: string, values?: unknown[]) {
            if (/^\s*update human_verification_tasks/i.test(text)) usedBy.set("update", scoped);
            if (/^\s*insert into human_verification_task_events/i.test(text)) usedBy.set("insert", scoped);
            return base.query<Row>(text, values);
          },
        };
        await base.query("begin");
        try {
          const result = await fn(scoped);
          await base.query("commit");
          return result;
        } catch (error) {
          await base.query("rollback").catch(() => {});
          throw error;
        }
      };
      const outcome = await executeProtectedHumanVerificationResponseCapture(
        baseInput(task.id, "OPEN", nonSubstantive()),
        { ...deps(spyRunner), getSession: session(activeAuthUserId) },
      );
      expect(outcome).toMatchObject({ kind: "EXECUTED", newTaskStatus: "ATTEMPTED" });
      expect(usedBy.get("update")).toBeDefined();
      expect(usedBy.get("insert")).toBeDefined();
      expect(usedBy.get("update")).toBe(usedBy.get("insert"));
    });

    it("H. a task-transition hop's event-insert failure rolls back that hop's status update -- status unchanged", async () => {
      const task = await newTask();
      const failingTransactionRunner = failingRunner(client(), /^\s*insert into human_verification_task_events/i);
      await expect(executeProtectedHumanVerificationResponseCapture(
        baseInput(task.id, "OPEN", nonSubstantive()),
        { ...deps(failingTransactionRunner), getSession: session(activeAuthUserId) },
      )).rejects.toThrow("INJECTED_FAILURE");
      expect((await humanVerificationRepository.getTask(task.id))?.status).toBe("OPEN");
    });

    it("I. a failed task-transition hop does not roll back the interaction, assessment, or an already-committed canonical closure", async () => {
      const { task, companyId: isolatedCompanyId } = await newIsolatedTask();
      const failingTransactionRunner = failingRunner(client(), /^\s*insert into human_verification_task_events/i);
      await expect(executeProtectedHumanVerificationResponseCapture(baseInput(task.id, "OPEN"), { ...deps(failingTransactionRunner), getSession: session(activeAuthUserId) }))
        .rejects.toThrow("INJECTED_FAILURE");
      const interactions = await humanVerificationRepository.listInteractions(task.id);
      expect(interactions).toHaveLength(1);
      const assessments = await humanVerificationRepository.listAssessments(interactions[0].id);
      expect(assessments).toHaveLength(1);
      const evaluations = await db.query<{ c: string }>("select count(*) as c from manpower_acceptance_evaluations where company_id=$1", [isolatedCompanyId]);
      expect(Number(evaluations.rows[0].c)).toBe(1); // the already-committed closure survives the later hop failure
      expect((await humanVerificationRepository.getTask(task.id))?.status).toBe("OPEN"); // the hop itself rolled back
    });

    it("J. a successful task-transition hop creates exactly one STATE_CHANGED event per hop", async () => {
      // A single-hop scenario (voicemail: OPEN -> ATTEMPTED is a direct transition) isolates the
      // per-hop invariant cleanly; the default substantive path takes two hops (OPEN -> ATTEMPTED ->
      // READY_FOR_ASSESSMENT) and is exercised separately by test G/E, each hop still producing
      // exactly one event -- this test certifies that per-hop guarantee directly.
      const task = await newTask();
      const outcome = await executeProtectedHumanVerificationResponseCapture(
        baseInput(task.id, "OPEN", nonSubstantive()),
        { ...deps(), getSession: session(activeAuthUserId) },
      );
      expect(outcome).toMatchObject({ kind: "EXECUTED", newTaskStatus: "ATTEMPTED" });
      const events = (await humanVerificationRepository.listTaskEvents(task.id)).filter((event) => event.eventType === "STATE_CHANGED");
      expect(events).toHaveLength(1);
    });

    it("K. CLAIMED worker and same-key IN_PROGRESS worker share continuous ownership and the waiter replays", async () => {
      const task = await newTask();
      const input = baseInput(task.id, "OPEN", { ...nonSubstantive(), idempotencyKey: `owned-race-${task.id}` });
      let firstPhaseCommitted!: () => void;
      let allowOwnerToContinue!: () => void;
      const phaseCommitted = new Promise<void>((resolve) => { firstPhaseCommitted = resolve; });
      const continueOwner = new Promise<void>((resolve) => { allowOwnerToContinue = resolve; });
      let calls = 0;
      const pausedRunner: TransactionRunner = async (fn) => {
        const result = await transactionRunner(fn);
        calls += 1;
        if (calls === 1) { firstPhaseCommitted(); await continueOwner; }
        return result;
      };

      const workerA = executeProtectedHumanVerificationResponseCapture(input, { ...deps(pausedRunner), getSession: session(activeAuthUserId) });
      await phaseCommitted;
      let workerBSettled = false;
      const workerB = executeProtectedHumanVerificationResponseCapture(input, { ...deps(), getSession: session(activeAuthUserId) })
        .finally(() => { workerBSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(workerBSettled).toBe(false);
      expect(await humanVerificationRepository.listInteractions(task.id)).toHaveLength(1);

      allowOwnerToContinue();
      const [first, second] = await Promise.all([workerA, workerB]);
      expect(first.kind).toBe("EXECUTED");
      expect(second.kind).toBe("REPLAYED");
      expect(await humanVerificationRepository.listInteractions(task.id)).toHaveLength(1);
      expect((await humanVerificationRepository.listTaskEvents(task.id)).filter((event) => event.eventType === "STATE_CHANGED")).toHaveLength(1);
      expect(Number((await db.query<{ c: string }>("select count(*) as c from command_idempotency_keys where idempotency_key=$1", [input.idempotencyKey])).rows[0].c)).toBe(1);
    });

    it("L. failed separate complete() releases ownership; retry reconstructs with zero duplicate business rows, then replays", async () => {
      const { task, companyId: isolatedCompanyId } = await newIsolatedTask();
      const input = baseInput(task.id, "OPEN", { idempotencyKey: `complete-failure-${task.id}` });
      let failComplete = true;
      const base = client();
      const failingCompleteClient: SqlClient = {
        async query<Row>(text: string, values?: unknown[]) {
          if (failComplete && /^\s*update command_idempotency_keys set result/i.test(text)) {
            failComplete = false;
            throw new Error("INJECTED_COMPLETE_FAILURE");
          }
          return base.query<Row>(text, values);
        },
      };
      const failingCompleteRunner = pgliteTransactional(failingCompleteClient).run;
      await expect(executeProtectedHumanVerificationResponseCapture(
        input,
        { ...deps(failingCompleteRunner, failingCompleteClient), getSession: session(activeAuthUserId) },
      )).rejects.toThrow("INJECTED_COMPLETE_FAILURE");

      const retry = await executeProtectedHumanVerificationResponseCapture(input, { ...deps(), getSession: session(activeAuthUserId) });
      expect(retry.kind).toBe("EXECUTED");
      const replay = await executeProtectedHumanVerificationResponseCapture(input, { ...deps(), getSession: session(activeAuthUserId) });
      expect(replay.kind).toBe("REPLAYED");
      const interactionId = retry.kind === "EXECUTED" ? retry.interactionId : "";
      expect(await humanVerificationRepository.listInteractions(task.id)).toHaveLength(1);
      expect(await humanVerificationRepository.listAssessments(interactionId)).toHaveLength(1);
      expect(Number((await db.query<{ c: string }>("select count(*) as c from raw_evidence where metadata->>'interactionId'=$1", [interactionId])).rows[0].c)).toBe(1);
      expect(Number((await db.query<{ c: string }>("select count(*) as c from claims where company_id=$1", [isolatedCompanyId])).rows[0].c)).toBe(1);
      expect(Number((await db.query<{ c: string }>("select count(*) as c from evidence_links where evidence_id in (select id from raw_evidence where metadata->>'interactionId'=$1)", [interactionId])).rows[0].c)).toBe(0);
      expect(Number((await db.query<{ c: string }>("select count(*) as c from manpower_acceptance_evaluations where company_id=$1", [isolatedCompanyId])).rows[0].c)).toBe(1);
      expect((await humanVerificationRepository.listTaskEvents(task.id)).filter((event) => event.eventType === "STATE_CHANGED")).toHaveLength(2);
      expect(Number((await db.query<{ c: string }>("select count(*) as c from command_idempotency_keys where idempotency_key=$1", [input.idempotencyKey])).rows[0].c)).toBe(1);
    });
  });
});
