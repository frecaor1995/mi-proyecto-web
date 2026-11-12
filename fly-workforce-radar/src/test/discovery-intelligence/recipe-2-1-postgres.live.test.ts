import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { recordAssistedPosting } from "../../server/discovery-intelligence/assisted-posting-capture";
import { PostingVerificationError, loadRecordedPosting, postingVerificationGate, recordPostingVerification } from "../../server/discovery-intelligence/posting-verification";
import { loadDiscoveryReviewCase } from "../../server/discovery-review/discovery-review-workflow";

/** Recipe 2.1 guided review against the LOCAL database; every test is rolled back. No network. */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });

const fixture = {
  url: "https://careers-fixture.example.com/jobs/88888/apprentice-electrician", company: "Walker Engineering", title: "Apprentice Electrician", city: "Houston", state: "TX", salary: null,
  experience: "Minimum 1 year of commercial electrical experience", licenses: "TDLR apprentice or journeyman license", observedOn: "2026-10-08",
  summary: "Test fixture summary written by the operator.", provenance: "ASSISTED_MANUAL" as const, dataClass: "REAL" as const, emailAlert: null,
};

describe.skipIf(!databaseUrl)("Recipe 2.1 guided Human Review (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session)); } finally { await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const operatorId = async (client: SqlClient) => (await client.query<{ id: string }>("select id from workforce_operators where status='ACTIVE' order by created_at limit 1")).rows[0].id;

  it("shows the recorded posting exactly as entered and gives the governed workbench its company and location", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const created = await recordAssistedPosting(client, fixture, op, new Date("2026-10-09T15:00:00Z"));
      const recorded = await loadRecordedPosting(client, created.candidateId!);
      expect(recorded).toMatchObject({ provenance: "ASSISTED_MANUAL", dataClass: "REAL", employerName: "Walker Engineering", title: "Apprentice Electrician", location: "Houston, TX",
        experience: "Minimum 1 year of commercial electrical experience", licenses: ["TDLR apprentice or journeyman license"], compensation: null, externalPostingId: null, verifications: [] }); // generic URL: no ID is invented
      const review = await loadDiscoveryReviewCase(client, created.candidateId!);
      expect(review?.observedCompany).toBe("Walker Engineering");
      expect(review?.location).toMatch(/Houston/);
      expect(review?.companyDecision).toBeNull();
      expect(review?.demandDecision).toBeNull();
    });
  });

  it("records the posting decision append-only, requires a note to verify and gates the company decision until verified", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const created = await recordAssistedPosting(client, fixture, op, new Date("2026-10-09T15:00:00Z"));
      const id = created.candidateId!;
      expect(await postingVerificationGate(client, id)).toBe("PENDING");
      await expect(recordPostingVerification(client, { candidateId: id, decision: "VERIFIED", note: "  ", operatorId: op, now: new Date("2026-10-09T16:00:00Z") })).rejects.toThrow(PostingVerificationError);
      await expect(recordPostingVerification(client, { candidateId: id, decision: "PROMOTED", note: "x", operatorId: op, now: new Date("2026-10-09T16:00:00Z") })).rejects.toThrow(PostingVerificationError);
      await recordPostingVerification(client, { candidateId: id, decision: "NEEDS_REVIEW", note: null, operatorId: op, now: new Date("2026-10-09T16:00:00Z") });
      expect(await postingVerificationGate(client, id)).toBe("PENDING");
      await recordPostingVerification(client, { candidateId: id, decision: "VERIFIED", note: "Opened the official page: same title, Houston TX, TDLR license.", operatorId: op, now: new Date("2026-10-09T17:00:00Z") });
      expect(await postingVerificationGate(client, id)).toBe("VERIFIED");
      const recorded = await loadRecordedPosting(client, id);
      expect(recorded?.verifications.map((v) => v.decision)).toEqual(["VERIFIED", "NEEDS_REVIEW"]);
      // the posting decision never resolves a company, verifies demand or promotes anything
      const review = await loadDiscoveryReviewCase(client, id);
      expect([review?.companyDecision, review?.demandDecision]).toEqual([null, null]);
      expect((await client.query<{ n: string }>("select count(*) n from discovery_signal_reviews where candidate_id=$1 and decision='PROMOTED'", [id])).rows[0].n).toBe("0");
    });
  });

  it("links a re-observation to the earlier one, keeps its decisions as history and requires a new verification", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const first = await recordAssistedPosting(client, fixture, op, new Date("2026-10-09T15:00:00Z"));
      await recordPostingVerification(client, { candidateId: first.candidateId!, decision: "VERIFIED", note: "Checked the official page on Oct 9.", operatorId: op, now: new Date("2026-10-09T16:00:00Z") });
      const second = await recordAssistedPosting(client, { ...fixture, observedOn: "2026-10-16", salary: "$18/hr" }, op, new Date("2026-10-16T15:00:00Z"));
      expect(second.outcome).toBe("RE_OBSERVED");
      expect(second.candidateId).not.toBe(first.candidateId);

      const latest = (await loadRecordedPosting(client, second.candidateId!))!;
      expect(latest.verifications).toEqual([]); // the Oct 9 verification is not reused
      expect(latest.superseded).toBe(false);
      expect(latest.changesFromPrevious).toEqual(["compensation"]);
      expect(latest.linkedObservations.map((o) => [o.candidateId, o.postingDecision, o.current, o.latest])).toEqual([
        [first.candidateId, "VERIFIED", false, false], [second.candidateId, null, true, true]]);
      expect(await postingVerificationGate(client, second.candidateId!)).toBe("PENDING");

      const older = (await loadRecordedPosting(client, first.candidateId!))!;
      expect(older.superseded).toBe(true);
      expect(older.verifications.map((v) => v.decision)).toEqual(["VERIFIED"]); // immutable history kept
      expect(await postingVerificationGate(client, first.candidateId!)).toBe("SUPERSEDED");
      await expect(recordPostingVerification(client, { candidateId: first.candidateId!, decision: "VERIFIED", note: "late", operatorId: op, now: new Date("2026-10-16T16:00:00Z") }))
        .rejects.toMatchObject({ code: "supersededObservation" });

      await recordPostingVerification(client, { candidateId: second.candidateId!, decision: "VERIFIED", note: "Re-checked on Oct 16: salary now published.", operatorId: op, now: new Date("2026-10-16T17:00:00Z") });
      expect(await postingVerificationGate(client, second.candidateId!)).toBe("VERIFIED");
      expect((await client.query<{ n: string }>("select count(*) n from discovery_signal_reviews where candidate_id=$1", [first.candidateId])).rows[0].n).toBe("1");
    });
  });

  it("does not gate observations that are not recorded postings", async () => {
    await inTransaction(async (client) => {
      const other = (await client.query<{ id: string }>(`select c.id from company_discovery_candidates c left join raw_evidence e on e.id=c.canonical_evidence_id
        where coalesce(e.metadata->>'recipe11','false')<>'true' limit 1`)).rows[0];
      if (other) expect(await postingVerificationGate(client, other.id)).toBe("NOT_RECORDED_POSTING");
      await expect(recordPostingVerification(client, { candidateId: other?.id ?? "00000000-0000-4000-8000-000000000000", decision: "VERIFIED", note: "x", operatorId: await operatorId(client), now: new Date() }))
        .rejects.toThrow(PostingVerificationError);
    });
  });
});
