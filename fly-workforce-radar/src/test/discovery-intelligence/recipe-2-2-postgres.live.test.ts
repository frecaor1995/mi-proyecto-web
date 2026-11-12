import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { AssistedCaptureValidationError, recordAssistedPosting } from "../../server/discovery-intelligence/assisted-posting-capture";
import { PostingVerificationError, loadRecordedPosting, postingVerificationGate, recordPostingVerification } from "../../server/discovery-intelligence/posting-verification";
import { SupplierAnswerValidationError, loadSupplierAnswers, recordSupplierAnswer } from "../../server/discovery-intelligence/external-supplier-answers";
import { OBSOLETE_URL_EXPLANATION, detectObsoleteAtsUrl } from "../../domain/ats-url-hygiene";
import { latestSupplierAnswer, supplierAnswerEffect } from "../../domain/external-supplier-answer";

/**
 * Recipe 2.2 against the LOCAL database; every test is rolled back and nothing is fetched. The Taleo fixture uses its
 * own org/rid so it never touches the real Walker 441 records.
 */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });

const OLD = "https://fixture.tbe.taleo.net/fx01/ats/careers/v2/requisition.jsp?org=FIXTURE&cws=9&rid=9441";
const NEW = "https://fixture.tbe.taleo.net/fx01/ats/careers/v2/viewRequisition?org=FIXTURE&cws=9&rid=9441";
const base = {
  url: OLD, company: "DEMO LOCAL Taleo Fixture Electric", title: "Apprentice Electrician", city: "Houston", state: "TX", salary: null,
  experience: "Minimum 1 year of commercial electrical experience; inexperienced electricians not accepted", licenses: "TDLR apprentice or journeyman license", observedOn: "2026-10-08",
  summary: "Fixture summary written by the operator.", provenance: "ASSISTED_MANUAL" as const, dataClass: "DEMO" as const, emailAlert: null,
};

describe.skipIf(!databaseUrl)("Recipe 2.2 official-link correction and supplier answers (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session)); } finally { await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const operatorId = async (client: SqlClient) => (await client.query<{ id: string }>("select id from workforce_operators where status='ACTIVE' order by created_at limit 1")).rows[0].id;
  const counts = async (client: SqlClient) => (await client.query<Record<string, string>>(`select (select count(*) from companies) companies, (select count(*) from opportunities) opportunities,
    (select count(*) from contact_people) contacts, (select count(*) from commercial_activities) activities, (select count(*) from workforce_workers) workers,
    (select count(*) from source_capture_policy_decisions) policies`)).rows[0];

  it("records the corrected URL as a new linked observation of the same posting, keeping the old one, its 404 decision and its URL", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const before = await counts(client);
      const old = await recordAssistedPosting(client, base, op, new Date("2026-10-08T15:00:00Z"));
      await recordPostingVerification(client, { candidateId: old.candidateId!, decision: "NEEDS_REVIEW", linkCategory: "ACCESS_ERROR", note: "Taleo shows 404 on the official URL.", operatorId: op, now: new Date("2026-10-09T10:05:00Z") });
      const finding = detectObsoleteAtsUrl(OLD)!;
      expect(finding.proposedUrl).toBe(NEW);

      // same day as the old observation on purpose: a correction is not a duplicate because the URL differs
      const corrected = await recordAssistedPosting(client, { ...base, url: finding.proposedUrl, correction: { previousCandidateId: old.candidateId!, reason: OBSOLETE_URL_EXPLANATION[finding.rule], rule: finding.rule } }, op, new Date("2026-10-09T16:00:00Z"));
      expect(corrected.outcome).toBe("URL_CORRECTED");
      expect(corrected.identity).toBe(old.identity); // rid=9441 → same posting, no duplicate posting
      expect(corrected.candidateId).not.toBe(old.candidateId);

      const oldView = (await loadRecordedPosting(client, old.candidateId!))!;
      expect(oldView).toMatchObject({ sourceUrl: OLD, superseded: true, urlCorrection: null });
      expect(oldView.verifications).toEqual([expect.objectContaining({ decision: "NEEDS_REVIEW", linkCategory: "ACCESS_ERROR", note: "Taleo shows 404 on the official URL." })]);
      const newView = (await loadRecordedPosting(client, corrected.candidateId!))!;
      expect(newView).toMatchObject({ sourceUrl: NEW, superseded: false, verifications: [], levelClass: "MIXED_APPRENTICE_EXPERIENCED",
        urlCorrection: { previousCandidateId: old.candidateId, previousUrl: OLD, reason: OBSOLETE_URL_EXPLANATION.TALEO_BE_REQUISITION_JSP, rule: "TALEO_BE_REQUISITION_JSP" } });
      expect(newView.linkedObservations.map((o) => [o.candidateId, o.sourceUrl, o.postingDecision, o.latest])).toEqual([[old.candidateId, OLD, "NEEDS_REVIEW", false], [corrected.candidateId, NEW, null, true]]);
      // the new observation needs its own human review; the owner's manual check is not a verification
      expect(await postingVerificationGate(client, corrected.candidateId!)).toBe("PENDING");
      expect(await postingVerificationGate(client, old.candidateId!)).toBe("SUPERSEDED");

      // the same corrected URL on the same day is a duplicate; other identities or the same URL are refused
      expect((await recordAssistedPosting(client, { ...base, url: NEW, correction: { previousCandidateId: old.candidateId!, reason: "again", rule: null } }, op, new Date("2026-10-09T17:00:00Z"))).outcome).toBe("DUPLICATE");
      await expect(recordAssistedPosting(client, { ...base, url: NEW.replace("rid=9441", "rid=9442"), correction: { previousCandidateId: old.candidateId!, reason: "x", rule: null } }, op, new Date("2026-10-09T17:00:00Z")))
        .rejects.toMatchObject({ errors: { url: "correctionIdentityMismatch" } });
      await expect(recordAssistedPosting(client, { ...base, observedOn: "2026-10-09", url: OLD, correction: { previousCandidateId: old.candidateId!, reason: "x", rule: null } }, op, new Date("2026-10-09T17:00:00Z")))
        .rejects.toBeInstanceOf(AssistedCaptureValidationError);
      const after = await counts(client);
      expect(after).toEqual(before); // no company, opportunity, contact, activity, worker or access policy created or changed
    });
  });

  it("never closes a posting on a 404 or an obsolete URL; only a withdrawn posting can be closed", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const { candidateId } = await recordAssistedPosting(client, { ...base, url: NEW }, op, new Date("2026-10-09T15:00:00Z"));
      const at = new Date("2026-10-09T16:00:00Z");
      for (const linkCategory of ["ACCESS_ERROR", "OBSOLETE_URL", "UNKNOWN", null]) {
        await expect(recordPostingVerification(client, { candidateId: candidateId!, decision: "REJECTED", linkCategory, note: "404", operatorId: op, now: at })).rejects.toMatchObject({ code: "notEnoughToClose" });
      }
      await expect(recordPostingVerification(client, { candidateId: candidateId!, decision: "VERIFIED", linkCategory: "OBSOLETE_URL", note: "ok", operatorId: op, now: at })).rejects.toBeInstanceOf(PostingVerificationError);
      await recordPostingVerification(client, { candidateId: candidateId!, decision: "REJECTED", linkCategory: "POSTING_WITHDRAWN", note: "The official page says the posting is no longer available.", operatorId: op, now: at });
      expect((await loadRecordedPosting(client, candidateId!))!.verifications[0]).toMatchObject({ decision: "REJECTED", linkCategory: "POSTING_WITHDRAWN" });
    });
  });

  it("records supplier answers as append-only evidence with author, date, channel, evidence and result, creating nothing else", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const before = await counts(client);
      const subject = { catalogKey: "enterprise", companyId: null, companyName: "Enterprise Electrical" };
      await expect(recordSupplierAnswer(client, { ...subject, answer: "YES", conversationDate: "2026-10-09", responderName: null, responderRole: "Operations", channel: "CALL", summary: "Fixture.", evidenceReference: null, nextAction: "x" }, op))
        .rejects.toBeInstanceOf(SupplierAnswerValidationError);
      await recordSupplierAnswer(client, { ...subject, answer: "NO_RESPONSE", conversationDate: "2026-10-08", responderName: null, responderRole: null, channel: "EMAIL", summary: "Fixture: no reply yet.", evidenceReference: null, nextAction: "Call operations" }, op, new Date("2026-10-08T18:00:00Z"));
      await recordSupplierAnswer(client, { ...subject, answer: "YES", conversationDate: "2026-10-09", responderName: "Fixture Person", responderRole: "Operations", channel: "CALL", summary: "Fixture: uses labor suppliers.", evidenceReference: "Fixture call log 2026-10-09", nextAction: "Send vendor packet" }, op, new Date("2026-10-09T18:00:00Z"));
      const answers = await loadSupplierAnswers(client, { catalogKey: "enterprise" });
      expect(answers.map((a) => a.answer).slice(0, 2)).toEqual(["YES", "NO_RESPONSE"]); // newest first, history kept
      const latest = latestSupplierAnswer(answers)!;
      expect(latest).toMatchObject({ answer: "YES", companyName: "Enterprise Electrical", conversationDate: "2026-10-09", channel: "CALL", responderRole: "Operations", evidenceReference: "Fixture call log 2026-10-09", nextAction: "Send vendor packet", recordedByOperatorId: op });
      expect(supplierAnswerEffect(latest)).toMatchObject({ commercialSignal: true, investigationOpen: false });
      expect((await loadSupplierAnswers(client, { catalogKey: "walker" })).filter((a) => a.summary?.startsWith("Fixture"))).toEqual([]); // never applied to another company
      const evidence = (await client.query<{ capture_method: string; source_url: string }>("select capture_method::text,source_url from raw_evidence where id=$1", [latest.evidenceId])).rows[0];
      expect(evidence.capture_method).toBe("MANUAL");
      expect(evidence.source_url).toMatch(/^urn:fly-workforce-radar:external-supplier-answer:enterprise:/);
      expect(await counts(client)).toEqual(before); // no client, opportunity, contact or commercial activity created
    });
  });
});
