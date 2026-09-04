import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAIM_PREDICATES, type QualificationRequirementValue } from "../../domain/claims";
import { HUMAN_INTERACTION_CAPTURE_METHOD, HUMAN_INTERACTION_SOURCE_TYPE } from "../../domain/database";
import type { CreateHumanResponseAssessmentInput, CreateHumanVerificationTaskInput } from "../../domain/human-verification";
import { normalizeManpowerAcceptanceResult } from "../../domain/manpower-acceptance";
import { PostgresHumanVerificationRepository } from "../../server/repositories/human-verification/postgres-human-verification-repository";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { HUMAN_VERIFICATION_RULE_VERSION, HumanVerificationService, humanVerificationTaskDeduplicationKey } from "../../server/services/human-verification/human-verification-service";

const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql",
  "20260817030000_source_registry_compliance.sql", "20260817040000_controlled_ingestion.sql",
  "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql",
  "20260817090000_opportunity_graph.sql", "20260817100000_human_verification.sql",
  "20260904010000_human_verification_domain.sql",
];
const at = new Date("2026-09-04T12:00:00Z");

describe("Phase 3I-B1 human verification domain and persistence", () => {
  let db: PGlite, repository: PostgresHumanVerificationRepository, service: HumanVerificationService;
  let companyId: string, opportunityId: string;
  let sequence = 0;
  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    repository = new PostgresHumanVerificationRepository(db as unknown as SqlClient);
    service = new HumanVerificationService(repository);
    companyId = (await db.query<{id:string}>("insert into companies(common_name)values('B1 Company')returning id")).rows[0].id;
    opportunityId = (await db.query<{id:string}>("insert into opportunities(title)values('B1 Opportunity')returning id")).rows[0].id;
  });
  afterAll(async () => db.close());

  const input = (overrides: Partial<CreateHumanVerificationTaskInput> = {}): CreateHumanVerificationTaskInput => ({
    companyId, opportunityId, targetType: "OPPORTUNITY_CONFLICT", targetId: opportunityId,
    verificationObjective: `Verify bounded fact ${++sequence}`, questionType: "MANPOWER_ACCEPTANCE",
    primaryQuestion: "Do you use approved external supplemental craft providers?", followUpQuestion: "Who manages qualification?",
    createdBy: "human:operator", ruleVersion: HUMAN_VERIFICATION_RULE_VERSION, scope: { companyScope: "UNKNOWN", exactText: "Scope was not stated" }, ...overrides,
  });

  it("creates a bounded task and its audit event", async () => {
    const created = await service.createTask(input());
    expect(created).toMatchObject({ created: true, task: { status: "OPEN", companyId, targetId: opportunityId } });
    await expect(repository.listTaskEvents(created.task.id)).resolves.toEqual([expect.objectContaining({ eventType: "CREATED", newState: "OPEN", operatorId: "human:operator" })]);
  });

  it("deduplicates equivalent open tasks deterministically despite scope key order", async () => {
    const base = input({ scope: { geographicScope: "Texas", companyScope: "UNKNOWN" } });
    const first = await service.createTask(base);
    const second = await service.createTask({ ...base, scope: { companyScope: "UNKNOWN", geographicScope: "Texas" } });
    expect(first.created).toBe(true); expect(second.created).toBe(false); expect(second.task.id).toBe(first.task.id);
    expect(humanVerificationTaskDeduplicationKey(base)).toBe(second.task.deduplicationKey);
  });

  it("enforces open-task deduplication in the database", async () => {
    const base = input(); const key = humanVerificationTaskDeduplicationKey(base);
    await repository.createTask({ ...base, deduplicationKey: key });
    await expect(repository.createTask({ ...base, deduplicationKey: key })).rejects.toThrow();
  });

  it("represents parent/child follow-up without rewriting the parent", async () => {
    const parent = (await service.createTask(input())).task;
    const child = (await service.createTask(input({ parentTaskId: parent.id, questionType: "CONTACT_ROUTE", verificationObjective: "Follow the authorized referral" }))).task;
    expect(child.parentTaskId).toBe(parent.id); expect((await repository.getTask(parent.id))?.parentTaskId).toBeNull();
  });

  it("persists immutable attempts and rejects mutation/deletion", async () => {
    const task = (await service.createTask(input())).task;
    const interaction = await service.recordInteraction({ verificationTaskId: task.id, interactionMethod: "PHONE", interactionOutcome: "NO_ANSWER", attemptedAt: at, operatorId: "human:operator", routeSnapshot: { phone: "business-route" }, reachedHuman: false });
    expect(interaction.interactionOutcome).toBe("NO_ANSWER");
    await expect(db.query("update human_interactions set operator_id='changed' where id=$1", [interaction.id])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from human_interactions where id=$1", [interaction.id])).rejects.toThrow(/append-only/);
  });

  it("does not turn NO_ANSWER or VOICEMAIL_LEFT into substantive evidence", async () => {
    const task = (await service.createTask(input())).task;
    expect(service.canInteractionSupportSubstantiveEvidence("NO_ANSWER")).toBe(false);
    expect(service.canInteractionSupportSubstantiveEvidence("VOICEMAIL_LEFT")).toBe(false);
    await expect(service.recordInteraction({ verificationTaskId: task.id, interactionMethod: "PHONE", interactionOutcome: "NO_ANSWER", attemptedAt: at, operatorId: "human:operator", routeSnapshot: {}, reachedHuman: true, responseVerbatim: "yes" })).rejects.toThrow(/cannot be a human response/);
    expect((await db.query<{count:string}>("select count(*)::text count from raw_evidence")).rows[0].count).toBe("0");
  });

  it("represents receptionist and referral outcomes without AF01 or M4 promotion", async () => {
    const task = (await service.createTask(input())).task;
    for (const outcome of ["RECEPTION_REACHED", "REFERRAL_RECEIVED"] as const) await service.recordInteraction({ verificationTaskId: task.id, interactionMethod: "PHONE", interactionOutcome: outcome, attemptedAt: at, operatorId: "human:operator", routeSnapshot: {}, reachedHuman: true, departmentSnapshot: "Reception" });
    expect(await repository.listInteractions(task.id)).toHaveLength(2);
    expect((await db.query<{count:string}>("select count(*)::text count from claims")).rows[0].count).toBe("0");
    expect((await db.query<{count:string}>("select count(*)::text count from manpower_acceptance_evaluations")).rows[0].count).toBe("0");
  });

  it("stores response disposition and commercial mechanism as independent axes", async () => {
    const task = (await service.createTask(input())).task;
    const interaction = await service.recordInteraction({ verificationTaskId: task.id, interactionMethod: "EMAIL", interactionOutcome: "EMAIL_RESPONSE_RECEIVED", attemptedAt: at, operatorId: "human:operator", routeSnapshot: {}, reachedHuman: true, responseVerbatim: "Our MSP manages supplemental craft." });
    const assessed = await service.assessResponse({ interactionId: interaction.id, answerDisposition: "QUALIFIED_OR_CONDITIONAL", commercialMechanism: "MSP_OR_STAFFING_PROGRAM", authorityLevel: "PROCESS_PARTICIPANT", authorityBasis: "Respondent stated process role; not yet independently verified", scope: { companyScope: "UNKNOWN" }, confidence: .7, assessedBy: "software:classifier", assessorKind: "SOFTWARE", assessedAt: at, approvalState: "HUMAN_REVIEW_REQUIRED", ruleVersion: HUMAN_VERIFICATION_RULE_VERSION });
    expect(assessed).toMatchObject({ answerDisposition: "QUALIFIED_OR_CONDITIONAL", commercialMechanism: "MSP_OR_STAFFING_PROGRAM", approvalState: "HUMAN_REVIEW_REQUIRED" });
  });

  it("keeps authority assessment- and scope-specific and blocks software approval", async () => {
    const task = (await service.createTask(input())).task;
    const interaction = await service.recordInteraction({ verificationTaskId: task.id, interactionMethod: "PHONE", interactionOutcome: "CONVERSATION_COMPLETED", attemptedAt: at, operatorId: "human:operator", routeSnapshot: {}, reachedHuman: true, responseVerbatim: "Only this project uses the program." });
    const candidate: CreateHumanResponseAssessmentInput = { interactionId: interaction.id, answerDisposition: "AFFIRMATIVE", commercialMechanism: "DIRECT_EXTERNAL_MANPOWER", authorityLevel: "PROCESS_PARTICIPANT", authorityBasis: "Project responsibility stated", scope: { projectId: opportunityId, companyScope: "UNKNOWN", exactText: "this project" }, confidence: .8, assessedBy: "software:classifier", assessorKind: "SOFTWARE", assessedAt: at, approvalState: "APPROVED", ruleVersion: HUMAN_VERIFICATION_RULE_VERSION };
    await expect(service.assessResponse(candidate)).rejects.toThrow(/identified human/);
    const approved = await service.assessResponse({ ...candidate, assessedBy: "human:reviewer", assessorKind: "HUMAN", approvedBy: "human:reviewer" });
    expect(approved.scope).toMatchObject({ projectId: opportunityId });
    expect(approved.authorityLevel).toBe("PROCESS_PARTICIPANT");
  });

  it("appends reassessments instead of overwriting prior interpretation", async () => {
    const task = (await service.createTask(input())).task;
    const interaction = await service.recordInteraction({ verificationTaskId: task.id, interactionMethod: "PHONE", interactionOutcome: "CONVERSATION_COMPLETED", attemptedAt: at, operatorId: "human:operator", routeSnapshot: {}, reachedHuman: true, responseVerbatim: "Sometimes." });
    const common: CreateHumanResponseAssessmentInput = { interactionId: interaction.id, answerDisposition: "UNKNOWN_DONT_KNOW", authorityLevel: "UNKNOWN", authorityBasis: "Authority not established", scope: { companyScope: "UNKNOWN" }, confidence: .3, assessedBy: "human:reviewer", assessorKind: "HUMAN", assessedAt: at, approvalState: "NEEDS_MORE_EVIDENCE", ruleVersion: HUMAN_VERIFICATION_RULE_VERSION };
    const first = await service.assessResponse(common); const second = await service.assessResponse({ ...common, answerDisposition: "QUALIFIED_OR_CONDITIONAL", supersedesAssessmentId: first.id });
    const history = await repository.listAssessments(interaction.id);
    expect(history).toHaveLength(2); expect(second.supersedesAssessmentId).toBe(first.id); expect(history[0].answerDisposition).toBe("UNKNOWN_DONT_KNOW");
    await expect(db.query("update human_response_assessments set confidence=.9 where id=$1", [first.id])).rejects.toThrow(/append-only/);
  });

  it("audits task old/new state and actor and prevents reopening terminal tasks", async () => {
    const task = (await service.createTask(input())).task;
    const attempted = await service.transitionTask(task.id, "ATTEMPTED", "human:operator", "Call attempted");
    expect(attempted.status).toBe("ATTEMPTED");
    const events = await repository.listTaskEvents(task.id);
    expect(events.at(-1)).toMatchObject({ oldState: "OPEN", newState: "ATTEMPTED", operatorId: "human:operator" });
    await db.query("update human_verification_tasks set status='UNRESOLVABLE',closed_at=$2 where id=$1", [task.id, at.toISOString()]);
    await expect(db.query("update human_verification_tasks set status='OPEN',closed_at=null where id=$1", [task.id])).rejects.toThrow(/cannot be reopened/);
    await expect(db.query("delete from human_verification_task_events where verification_task_id=$1", [task.id])).rejects.toThrow(/append-only/);
  });

  it("registers HUMAN_INTERACTION evidence classification without auto-creating evidence", async () => {
    const source = await db.query<{code:string}>("select code from source_types where code=$1", [HUMAN_INTERACTION_SOURCE_TYPE]);
    const capture = await db.query<{value:string}>("select enumlabel value from pg_enum join pg_type on pg_type.oid=enumtypid where typname='capture_method' and enumlabel=$1", [HUMAN_INTERACTION_CAPTURE_METHOD]);
    expect(source.rows[0].code).toBe("HUMAN_INTERACTION"); expect(capture.rows[0].value).toBe("HUMAN_INTERACTION");
  });

  it("represents relationship predicates without storing M-level truth", () => {
    expect(CLAIM_PREDICATES).toEqual(expect.arrayContaining(["contractor_project_participation", "commercial_ecosystem_relationship", "manpower_vendor_relationship", "workforce_partner_subvendor_relationship"]));
    expect(CLAIM_PREDICATES).not.toEqual(expect.arrayContaining(["m1", "m2", "m3", "m4"]));
  });

  it("represents qualification requirements while Fly satisfaction remains UNKNOWN", () => {
    const requirement: QualificationRequirementValue = { requirementType: "AVETTA", requirementText: "Buyer requires Avetta", flySatisfaction: "UNKNOWN", scope: { region: "Texas" } };
    expect(CLAIM_PREDICATES).toContain("qualification_requirement"); expect(requirement.flySatisfaction).toBe("UNKNOWN");
  });

  it("normalizes legacy VERIFIED without fabricating historical evidence", async () => {
    expect(normalizeManpowerAcceptanceResult("VERIFIED")).toBe("VERIFIED_POSITIVE");
    expect((await db.query<{count:string}>("select count(*)::text count from raw_evidence")).rows[0].count).toBe("0");
  });

  it("supports a non-electrical trade and occupation with the same task model", async () => {
    const created = await service.createTask(input({ tradeId: "PIPEFITTING", occupationId: "PIPEFITTER", scope: { companyScope: "UNKNOWN", tradeId: "PIPEFITTING", occupationId: "PIPEFITTER" } }));
    expect(created.task).toMatchObject({ tradeId: "PIPEFITTING", occupationId: "PIPEFITTER", scope: { tradeId: "PIPEFITTING" } });
  });
});
