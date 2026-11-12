import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresCompanyRepository } from "../../server/repositories/company/postgres-company-repository";
import { ensureInvestigation, loadBuyerInvestigation } from "../../server/contact-intelligence/buyer-investigation";
import {
  PursuitValidationError, designateRole, listPursuits, loadPursuit, promotePainSignal, recordActivity, recordPainSignal, recordStaffRequest, supersedePainSignal, type ActivityWrite,
} from "../../server/commercial-pursuit/pursuit-store";
import { evaluateDemandAgainstWorkforce } from "../../server/services/matching/evaluate-demand-against-workforce";
import { DemandRequirementService } from "../../server/services/demand/demand-requirement-service";
import { WorkerService } from "../../server/services/worker/worker-service";
import { MatchingPersistenceService } from "../../server/services/matching/matching-persistence-service";
import { PostgresDemandRequirementRepository } from "../../server/repositories/demand/postgres-demand-requirement-repository";
import { PostgresWorkerRepository } from "../../server/repositories/worker/postgres-worker-repository";
import { PostgresOperatorRepository } from "../../server/repositories/operator/postgres-operator-repository";

/**
 * Phase 3A end to end against the LOCAL database (real grants, append-only triggers, checks); every test rolls back.
 * Fictional organization and people. Humans perform contacts; the test only records what a human would record.
 * WORKER_REFERRAL → VERIFIED SIGNAL → OPPORTUNITY → CONTACT ROUTE → FIRST TOUCH → WRONG PERSON → HUMAN REFERRAL →
 * CONVERSATION → STAFF REQUEST → EXISTING MATCHING INVOKED → RESULT.
 */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");

const ORG = "Acme Fixture Industrial Services";
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });
const NEXT = (operatorId: string, action = "Follow up", due = "2026-10-08") => ({ nextAction: action, nextActionDue: due, nextActionOwnerOperatorId: operatorId });
const activity = (opportunityId: string, operatorId: string, overrides: Partial<ActivityWrite>): ActivityWrite => ({
  opportunityId, activityType: "OUTREACH", accessChannel: "CALL", outcome: "NO_ANSWER", result: null, handlesExternalWorkforce: "UNKNOWN", contactCandidateId: null, contactPersonId: null,
  contactName: null, contactTitle: null, performedAt: "2026-09-21T15:00:00Z", notes: null, offerHypothesis: null, offerNote: null, referral: null, ...NEXT(operatorId), ...overrides,
});

describe.skipIf(!databaseUrl)("Phase 3A commercial pursuit (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient, session: PoolClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session), session); } finally { await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const fixtures = async (client: SqlClient) => {
    const operator = (await client.query<{ id: string; auth_user_id: string }>("select id, auth_user_id from workforce_operators where status='ACTIVE' order by created_at limit 1")).rows[0];
    const company = await new PostgresCompanyRepository(client).createCompany({ commonName: ORG, normalized: "acme fixture industrial services 3a", observedAt: new Date() });
    const worker = (await client.query<{ id: string }>(
      "insert into workforce_workers(display_name,lifecycle_status,profile_verification_state,source_of_record,first_seen_at) values('Fixture Referral Worker','ACTIVE','UNVERIFIED','SOURCED',now()) returning id")).rows[0];
    return { operatorId: operator.id, authUserId: operator.auth_user_id, companyId: company.id, workerId: worker.id };
  };
  const referral = (companyId: string, workerId: string, consentUse: boolean, consentIdentify: boolean) => ({
    companyId, opportunityId: null, painType: "WORKER_REFERRAL" as const, assertionBasis: "REPORTED" as const, confidence: "MEDIUM" as const,
    summary: "Former crew member reports the unit shutdown team is still short of journeyman electricians.", sourceKind: "WORKER_REPORT" as const, sourceUrl: null, observedAt: "2026-09-28T00:00:00Z",
    workerReferral: { reportedByWorkerId: workerId, siteText: "Unit 3 shutdown", city: "Pasadena", state: "TX", supervisorName: "Casey Foreman", supervisorTitle: "Electrical Superintendent",
      neededHeadcount: 6, neededRoleText: "Journeyman electricians", consentUseIntelligence: consentUse, consentIdentifyWorker: consentIdentify },
  });

  it("runs the full human commercial flow with provenance, Contact Intelligence feedback and the existing matching engine", async () => {
    await inTransaction(async (client) => {
      const { operatorId, authUserId, companyId, workerId } = await fixtures(client);
      // 1. WORKER_REFERRAL (intelligence usable internally; the worker may NOT be named to the prospect)
      const pain = await recordPainSignal(client, referral(companyId, workerId, true, false), operatorId);
      const raw = (await client.query<{ capture_method: string; metadata: Record<string, unknown>; content_hash: string }>("select capture_method, metadata, content_hash from raw_evidence where id=$1", [pain.rawEvidenceId])).rows[0];
      expect(raw).toMatchObject({ capture_method: "MANUAL", metadata: { kind: "commercial-pain", operatorRecorded: true, actorOperatorId: operatorId } });
      expect(raw.content_hash).toMatch(/^[0-9a-f]{64}$/);
      const stored = (await client.query<Record<string, unknown>>("select * from commercial_pain_signals where id=$1", [pain.id])).rows[0];
      expect(stored).toMatchObject({ reported_by_worker_id: workerId, consent_use_intelligence: true, consent_identify_worker: false, source_kind: "WORKER_REPORT", assertion_basis: "REPORTED", entered_by_kind: "HUMAN" });
      expect(Object.keys(stored).join(" ")).not.toMatch(/ssn|passport|a_number|authorization|immigration|birth/i);
      // 2. verify, then promote through the existing Commercial Intake (signal ≠ B2B opportunity until promoted)
      const verified = await supersedePainSignal(client, { painSignalId: pain.id, status: "VERIFIED", note: "Confirmed by a second crew member" }, operatorId);
      const promoted = await promotePainSignal(client, { painSignalId: verified.id, intake: {
        idempotencyKey: randomUUID(), evidenceSummary: "Worker-reported electrician shortage at a unit shutdown (referral identity withheld from prospect).", customerName: ORG,
        opportunityTitle: `${ORG} — journeyman electricians (worker referral)`, projectName: null, city: "Pasadena", state: "TX", tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN",
        headcount: 6, minimumExperienceMonths: null, startDate: null, schedule: null, skills: [], credentials: [] } }, operatorId);
      const opportunityId = promoted.opportunityId;
      let view = (await loadPursuit(client, opportunityId, "2026-10-02"))!;
      expect(view.pipeline).toMatchObject({ status: "NOT_PURSUED", currentStage: "SIGNAL" });
      expect(view.truth).toEqual({ laborDemandEvidence: true, externalLaborPurchasing: "UNKNOWN", conversationConfirmed: false, staffRequest: false });
      expect(view.pain).toMatchObject({ level: "VERIFIED", types: ["WORKER_REFERRAL"] });
      expect(view.painSignals[0]).toMatchObject({ usableCommercially: true, mayNameWorkerToProspect: false, status: "VERIFIED" });
      expect(view.opportunity.companyId).toBe(companyId); // the opportunity is tied to the company the referral named
      expect(view.painHistory).toBe(3); // reported → verified → linked to the opportunity: the chain stays auditable
      expect(view.fit.level).toBe("UNKNOWN"); // no staff request yet: never estimated from workforce size

      // 3. contact route from Contact Intelligence (a web-found person) — a found contact does NOT advance human stages
      const investigation = await ensureInvestigation(client, { kind: "COMPANY", companyId }, operatorId);
      const jordan = (await client.query<{ id: string }>(
        `insert into contact_candidates(investigation_id,identity_key,kind,person_name,title,contact_function,organization,source_url,provider,evidence_quote,attributed,attribution_basis,
           historical,person_key,source_type,evidence_currency) values($1,$2,'PERSON','Jordan Fixture','Project Manager','PROJECT_MANAGEMENT',$3,'https://acme-fixture.example/team',
           'OFFICIAL_WEBSITE','Jordan Fixture — Project Manager',true,'Named on the official team page.',false,'k-jordan','OFFICIAL_SITE','UNDATED') returning id`,
        [investigation.id, "a".repeat(64), ORG])).rows[0];
      view = (await loadPursuit(client, opportunityId, "2026-10-02"))!;
      expect(view.route?.person?.name).toBe("Jordan Fixture");
      expect(view.pipeline.currentStage).toBe("ROUTE_IDENTIFIED");
      expect(view.activities).toEqual([]);

      // 4. pain owner ≠ commercial authority
      await designateRole(client, { opportunityId, role: "PAIN_OWNER", personName: "Casey Foreman", personTitle: "Electrical Superintendent", contactCandidateId: null, contactPersonId: null,
        basis: "Supervisor named in the worker referral", sourceActivityId: null, sourcePainSignalId: verified.id }, operatorId);
      await recordActivity(client, activity(opportunityId, operatorId, { activityType: "PURSUIT_STARTED", accessChannel: null, outcome: null, offerHypothesis: "SMALL_TRIAL_CREW",
        offerNote: "Test a 2-person evaluated crew for the shutdown", ...NEXT(operatorId, "Call the project team", "2026-10-03") }), operatorId);
      const startedList = await listPursuits(client, "2026-10-02");
      expect(startedList.items.find((item) => item.opportunityId === opportunityId)?.pipeline).toMatchObject({ status: "ACTIVE", currentStage: "ROUTE_IDENTIFIED", result: null });

      // 5. FIRST TOUCH → WRONG PERSON (human evidence in Contact Intelligence; web evidence kept)
      const wrong = await recordActivity(client, activity(opportunityId, operatorId, { contactCandidateId: jordan.id, outcome: "WRONG_PERSON",
        notes: "Says labor vendors are not his function", ...NEXT(operatorId, "Ask Jordan who handles labor vendors", "2026-10-03") }), operatorId);
      expect(wrong.contactInteractionId).toBeTruthy();
      const ciAfterWrong = await loadBuyerInvestigation(client, { kind: "COMPANY", companyId });
      expect(ciAfterWrong.route.person).toBeNull(); // the commercial route reflects the human answer
      expect([...ciAfterWrong.people, ...ciAfterWrong.otherPeople].find((p) => p.name === "Jordan Fixture")?.interactions[0]).toMatchObject({ personReached: true, handlesExternalWorkforce: "NO" });

      // 6. HUMAN REFERRAL → enters Contact Intelligence with human provenance; Contact A and the referring step are preserved
      const referred = await recordActivity(client, activity(opportunityId, operatorId, { activityType: "FOLLOW_UP", contactCandidateId: jordan.id, outcome: "REFERRED_TO_OTHER_PERSON",
        performedAt: "2026-09-22T14:00:00Z", referral: { name: "Morgan Example", title: "Supply Chain Manager", department: "Procurement", phone: "(713) 555-0144", email: null },
        ...NEXT(operatorId, "Call Morgan in Procurement", "2026-10-06") }), operatorId);
      expect(referred.referredCandidateId).toBeTruthy();
      const morganRow = (await client.query<{ provider: string; source_type: string; attribution_basis: string; evidence_currency: string }>(
        "select provider, source_type, attribution_basis, evidence_currency from contact_candidates where id=$1", [referred.referredCandidateId])).rows[0];
      expect(morganRow).toMatchObject({ provider: "HUMAN_INTERACTION", source_type: "HUMAN_REFERRAL", evidence_currency: "CURRENT" });
      expect(morganRow.attribution_basis).toContain("Named by Jordan Fixture");
      const ciAfterReferral = await loadBuyerInvestigation(client, { kind: "COMPANY", companyId });
      const morgan = [...ciAfterReferral.people, ...ciAfterReferral.otherPeople].find((p) => p.name === "Morgan Example")!;
      expect(morgan.fn?.id).toBe("PROCUREMENT");
      expect(morgan.state).not.toBe("COMMERCIAL_RESPONSIBILITY_CONFIRMED"); // a referral is not authority
      expect([...ciAfterReferral.people, ...ciAfterReferral.otherPeople].some((p) => p.name === "Jordan Fixture")).toBe(true);

      // 7. CONVERSATION with the referred person; designate the commercial contact (no authority inferred)
      await recordActivity(client, activity(opportunityId, operatorId, { contactCandidateId: referred.referredCandidateId, outcome: "CONVERSATION", performedAt: "2026-09-24T16:00:00Z",
        notes: "Open to hearing about a trial crew; will check shutdown needs", ...NEXT(operatorId, "Send capability summary", "2026-10-08") }), operatorId);
      await designateRole(client, { opportunityId, role: "COMMERCIAL_CONTACT", personName: "Morgan Example", personTitle: "Supply Chain Manager", contactCandidateId: referred.referredCandidateId,
        contactPersonId: null, basis: "Referred by Jordan Fixture; conversation held", sourceActivityId: referred.id, sourcePainSignalId: null }, operatorId);

      // 8. STAFF REQUEST (unknown fields stay unknown)
      const request = await recordStaffRequest(client, {
        opportunityId, receivedAt: "2026-09-25T17:00:00Z", accessChannel: "CALL", contactCandidateId: referred.referredCandidateId, contactName: "Morgan Example", contactTitle: "Supply Chain Manager",
        tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", level: "Journeyman", headcount: 4, specialty: null, projectSite: "Unit 3 shutdown", city: "Pasadena", state: "TX",
        startDate: "2026-10-20", expectedEndDate: null, durationText: null, schedule: null, shift: null, minimumExperienceMonths: null, requiredCredentials: ["OSHA_10"], preferredCredentials: [],
        requiredSkills: [], payRateMin: null, payRateMax: null, payPeriod: null, billRate: null, perDiemAvailable: null, perDiemAmount: null, travelRequired: null, additionalRequirements: null,
        notes: "Asked for 4 journeymen for the shutdown", ...NEXT(operatorId, "Present evaluated candidates", "2026-10-09"),
      }, operatorId);
      expect(request.unknownFields).toEqual(expect.arrayContaining(["specialty", "durationText", "schedule", "minimumExperienceMonths", "payRate", "billRate", "perDiem", "travelRequired"]));
      const demand = (await client.query<Record<string, unknown>>("select * from demand_signals where id=$1", [request.demandSignalId])).rows[0];
      expect(demand).toMatchObject({ publisher_type: "STAFF_REQUEST", publisher_company_id: companyId, headcount_estimate: 4, base_pay_min: null, per_diem_available: null, travel_required: null, minimum_experience_months: null, schedule: null });
      const requestActivity = (await client.query<{ contact_candidate_id: string | null }>("select contact_candidate_id from commercial_activities where id=$1", [request.activityId])).rows[0];
      expect(requestActivity.contact_candidate_id).toBe(referred.referredCandidateId);
      view = (await loadPursuit(client, opportunityId, "2026-10-07"))!;
      expect(view.fit.level).toBe("NOT_EVALUATED");
      expect(view.staffRequests[0].credentials).toEqual([{ code: "OSHA_10", level: "REQUIRED" }]);

      // 9. EXISTING MATCHING invoked unchanged against the staff request
      const operatorRepository = new PostgresOperatorRepository(client);
      const runner = <T>(fn: (c: SqlClient) => Promise<T>) => fn(client);
      const getSession = async () => ({ authUserId, email: null });
      const run = await evaluateDemandAgainstWorkforce(request.demandSignalId, {
        demandRequirementService: new DemandRequirementService({ repository: new PostgresDemandRequirementRepository(client), transactionRunner: runner, operatorRepository, getSession }),
        workerService: new WorkerService({ repository: new PostgresWorkerRepository(client), transactionRunner: runner, operatorRepository, getSession }),
        persistenceService: new MatchingPersistenceService({ transactionRunner: runner }), getSession, operatorRepository,
      });
      expect(run.kind).toBe("OK");
      view = (await loadPursuit(client, opportunityId, "2026-10-07"))!;
      expect(["COVERABLE", "PARTIAL", "NOT_COVERED"]).toContain(view.fit.level);
      const counted = Object.values(view.staffRequests[0].matchCounts!).reduce((n, v) => n + v, 0);
      expect(counted).toBeGreaterThan(0);

      // Pipeline, truth and the three separate dimensions
      expect(view.pipeline).toMatchObject({ status: "ACTIVE", currentStage: "STAFF_REQUEST", maxStageReached: "STAFF_REQUEST" });
      expect(view.truth).toEqual({ laborDemandEvidence: true, externalLaborPurchasing: "CONFIRMED", conversationConfirmed: true, staffRequest: true });
      expect(view.access.factors).toEqual(expect.arrayContaining(["WORKER_REFERRAL", "HUMAN_CONVERSATION", "NAMED_CONTACT"]));
      expect(view.roles.painOwner?.personName).toBe("Casey Foreman");
      expect(view.roles.commercialContact?.personName).toBe("Morgan Example");
      expect(view.referralChain).toEqual([expect.objectContaining({ from: "Jordan Fixture", toName: "Morgan Example", toDepartment: "Procurement" })]);
      expect(view.nextAction).toMatchObject({ action: "Present evaluated candidates", due: "2026-10-09", overdue: false });
      expect((await loadPursuit(client, opportunityId, "2026-10-12"))!.nextAction?.overdue).toBe(true);

      // 10. RESULT: lost — max stage reached is preserved; the closed pursuit accepts no further steps
      await recordActivity(client, activity(opportunityId, operatorId, { activityType: "RESULT", accessChannel: null, outcome: null, result: "LOST", nextAction: null, nextActionDue: null,
        nextActionOwnerOperatorId: null, performedAt: "2026-09-28T15:00:00Z", notes: "Shutdown staffed internally" }), operatorId);
      view = (await loadPursuit(client, opportunityId, "2026-10-12"))!;
      expect(view.pipeline).toMatchObject({ status: "CLOSED", currentStage: "RESULT", maxStageReached: "STAFF_REQUEST", result: "LOST" });
      expect(view.nextAction).toBeNull();
      await expect(recordActivity(client, activity(opportunityId, operatorId, {}), operatorId)).rejects.toThrow(PursuitValidationError);

      // No authority fabricated anywhere in the flow
      const finalCi = await loadBuyerInvestigation(client, { kind: "COMPANY", companyId });
      expect([...finalCi.people, ...finalCi.otherPeople].some((p) => p.state === "COMMERCIAL_RESPONSIBILITY_CONFIRMED")).toBe(false);
      await expect(client.query("update commercial_activities set notes='x' where opportunity_id=$1", [opportunityId])).rejects.toThrow(/permission denied|append-only/); // runtime role has no UPDATE grant; the trigger is the second layer
    });
  }, 120_000);

  it("keeps the two referral consents separate and never uses intelligence the worker did not consent to use", async () => {
    await inTransaction(async (client, session) => {
      const { operatorId, companyId, workerId } = await fixtures(client);
      await expect(recordPainSignal(client, referral(companyId, workerId, false, true), operatorId)).rejects.toThrow(PursuitValidationError);
      const noUse = await recordPainSignal(client, referral(companyId, workerId, false, false), operatorId);
      await expect(supersedePainSignal(client, { painSignalId: noUse.id, status: "VERIFIED" }, operatorId)).rejects.toThrow(PursuitValidationError);
      await session.query("savepoint s1");
      await expect(session.query(`insert into commercial_pain_signals(company_id,pain_type,assertion_basis,status,confidence,summary,source_kind,raw_evidence_id,entered_by_kind,recorded_by_operator_id,
        reported_by_worker_id,consent_use_intelligence,consent_identify_worker) select company_id,pain_type,assertion_basis,'VERIFIED',confidence,summary,source_kind,raw_evidence_id,'HUMAN',
        recorded_by_operator_id,reported_by_worker_id,false,false from commercial_pain_signals where id=$1`, [noUse.id])).rejects.toThrow(/check constraint/);
      await session.query("rollback to savepoint s1");
      const named = await recordPainSignal(client, referral(companyId, workerId, true, true), operatorId);
      const rows = (await client.query<{ id: string; consent_use_intelligence: boolean; consent_identify_worker: boolean }>(
        "select id, consent_use_intelligence, consent_identify_worker from commercial_pain_signals where id = any($1)", [[noUse.id, named.id]])).rows;
      expect(rows.find((r) => r.id === named.id)).toMatchObject({ consent_use_intelligence: true, consent_identify_worker: true });
      const { loadCompanyCommercial } = await import("../../server/commercial-pursuit/pursuit-store");
      const company = await loadCompanyCommercial(client, companyId, "2026-10-02");
      expect(company.painSignals.find((p) => p.id === noUse.id)).toMatchObject({ usableCommercially: false, mayNameWorkerToProspect: false });
      expect(company.painSignals.find((p) => p.id === named.id)).toMatchObject({ usableCommercially: true, mayNameWorkerToProspect: true });
      expect(company.pain).toMatchObject({ usable: 1, withheld: 1 });
    });
  }, 60_000);

  it("records explicit commercial responsibility only as human evidence and requires a next action while pursuing", async () => {
    await inTransaction(async (client, session) => {
      const { operatorId, companyId } = await fixtures(client);
      const promoted = await (async () => {
        const pain = await recordPainSignal(client, { companyId, opportunityId: null, painType: "INBOUND_REQUEST", assertionBasis: "OBSERVED", confidence: "HIGH", summary: "Inbound call asking about electricians",
          sourceKind: "HUMAN_INTERACTION", sourceUrl: null, observedAt: null }, operatorId);
        const verified = await supersedePainSignal(client, { painSignalId: pain.id, status: "VERIFIED" }, operatorId);
        return promotePainSignal(client, { painSignalId: verified.id, intake: { idempotencyKey: randomUUID(), evidenceSummary: "Inbound inquiry", customerName: ORG, opportunityTitle: `${ORG} — inbound`,
          projectName: null, city: null, state: null, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", headcount: null, minimumExperienceMonths: null, startDate: null, schedule: null, skills: [], credentials: [] } }, operatorId);
      })();
      const opportunityId = promoted.opportunityId;
      const investigation = await ensureInvestigation(client, { kind: "COMPANY", companyId }, operatorId);
      const lee = (await client.query<{ id: string }>(
        `insert into contact_candidates(investigation_id,identity_key,kind,person_name,title,contact_function,organization,source_url,provider,evidence_quote,attributed,attribution_basis,historical,person_key,source_type,evidence_currency)
         values($1,$2,'PERSON','Lee Sample','Procurement Manager','PROCUREMENT',$3,'https://acme-fixture.example/team','OFFICIAL_WEBSITE','Lee Sample — Procurement Manager',true,'Team page',false,'k-lee','OFFICIAL_SITE','UNDATED') returning id`,
        [investigation.id, "b".repeat(64), ORG])).rows[0];
      // next action is required while the pursuit is open (domain validation and database check)
      await expect(recordActivity(client, activity(opportunityId, operatorId, { nextAction: null, nextActionDue: null, nextActionOwnerOperatorId: null }), operatorId)).rejects.toThrow(PursuitValidationError);
      await session.query("savepoint s2");
      await expect(session.query(`insert into commercial_activities(opportunity_id,activity_type,access_channel,outcome,performed_by_operator_id,performed_at) values($1,'OUTREACH','CALL','NO_ANSWER',$2,now())`,
        [opportunityId, operatorId])).rejects.toThrow(/check constraint/);
      await session.query("rollback to savepoint s2");
      // a title (Procurement Manager) is not authority
      let ci = await loadBuyerInvestigation(client, { kind: "COMPANY", companyId });
      expect(ci.people.find((p) => p.name === "Lee Sample")?.state).toBe("PROFESSIONAL_IDENTIFIED");
      // the person explicitly states they manage staffing vendors → human commercial-responsibility evidence (2.0 rule)
      await recordActivity(client, activity(opportunityId, operatorId, { contactCandidateId: lee.id, outcome: "ACCEPTS_EXTERNAL_LABOR", handlesExternalWorkforce: "YES",
        notes: "Manages the approved staffing-vendor list for craft labor", ...NEXT(operatorId, "Send vendor packet", "2026-10-05") }), operatorId);
      ci = await loadBuyerInvestigation(client, { kind: "COMPANY", companyId });
      expect(ci.people.find((p) => p.name === "Lee Sample")?.state).toBe("COMMERCIAL_RESPONSIBILITY_CONFIRMED");
      expect(ci.route.responsibility?.kind).toBe("HUMAN");
      // YES without an identified person cannot be recorded (no authority from conversational context)
      await expect(recordActivity(client, activity(opportunityId, operatorId, { outcome: "CONVERSATION", handlesExternalWorkforce: "YES" }), operatorId)).rejects.toThrow(PursuitValidationError);
      const view = (await loadPursuit(client, opportunityId, "2026-10-02"))!;
      expect(view.truth.externalLaborPurchasing).toBe("CONFIRMED");
      expect(view.truth.staffRequest).toBe(false); // accepting external labor is not a staff request
      expect(view.fit.level).toBe("UNKNOWN");
    });
  }, 60_000);
});
