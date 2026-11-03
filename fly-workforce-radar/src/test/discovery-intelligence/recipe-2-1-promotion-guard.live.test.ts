import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

/**
 * Recipe 2.1 promotion guard, exercised through the real server actions with an authenticated operator (mocked
 * authorization) against the LOCAL database inside one rolled-back transaction per test. No opportunity is ever
 * created: the guard is checked up to the point where promotion would be allowed, and the transaction is rolled back.
 */
const mocks = vi.hoisted(() => ({
  client: null as SqlClient | null,
  operatorId: "",
  authorized: true,
  revalidate: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../server/auth/authorization", () => ({
  authorizeOperator: vi.fn(async () => (mocks.authorized
    ? { state: "AUTHORIZED", operator: { operatorId: mocks.operatorId, permissions: ["human_verification.write", "company_discovery.run"] } }
    : { state: "AUTHENTICATED_BUT_UNAUTHORIZED" })),
}));
vi.mock("../../server/database/production-sql-client", () => ({
  getProductionSqlClient: () => mocks.client,
  getProductionTransactionRunner: () => (mocks.client ? async <T>(fn: (client: SqlClient) => Promise<T>) => fn(mocks.client!) : null),
}));

import { recordAssistedPosting } from "../../server/discovery-intelligence/assisted-posting-capture";
import { recordPostingVerificationAction } from "../../server/discovery-intelligence/posting-verification-actions";
import { companyReviewAction, demandReviewAction, promoteVerifiedDemandAction } from "../../server/discovery-review/actions";
import { promotionBlocker } from "../../server/discovery-review/discovery-review-workflow";
import { promoteSignalAction } from "../../server/opportunity-discovery/actions";

const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });
const form = (values: Record<string, string>) => { const data = new FormData(); for (const [k, v] of Object.entries(values)) data.set(k, v); return data; };
const IDLE = { status: "IDLE" as const, error: null };
const fixture = {
  url: "https://careers-fixture.example.com/jobs/99441/apprentice-electrician", company: "DEMO LOCAL Guard Fixture Electric", title: "Apprentice Electrician", city: "Houston", state: "TX", salary: null,
  experience: "1 year", licenses: "TDLR apprentice", observedOn: "2026-10-08", summary: "Fixture written for the promotion-guard test.", provenance: "ASSISTED_MANUAL" as const, dataClass: "DEMO" as const, emailAlert: null,
};

describe.skipIf(!databaseUrl)("Recipe 2.1 promotion guard with an authenticated operator (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(() => { mocks.authorized = true; mocks.redirect.mockClear(); });
  const inTransaction = async (fn: (client: SqlClient) => Promise<void>) => {
    const session = await pool.connect();
    try {
      await session.query("begin"); mocks.client = wrap(session);
      mocks.operatorId = (await mocks.client.query<{ id: string }>("select id from workforce_operators where status='ACTIVE' order by created_at limit 1")).rows[0].id;
      await fn(mocks.client);
    } finally { mocks.client = null; await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const promote = (candidateId: string) => promoteVerifiedDemandAction(IDLE, form({ candidateId }));
  const opportunities = async (client: SqlClient) => (await client.query<{ n: string }>("select count(*) n from opportunities")).rows[0].n;

  it("rejects promotion while the posting, the company or the demand is not confirmed, and never creates an opportunity", async () => {
    await inTransaction(async (client) => {
      const before = await opportunities(client);
      const { candidateId } = await recordAssistedPosting(client, fixture, mocks.operatorId, new Date("2026-10-09T15:00:00Z"));
      const id = candidateId!;
      expect(await promote(id)).toEqual({ status: "REJECTED", error: "Verify the posting before promotion." });
      // company and demand decisions are also refused before the posting is verified
      expect(await companyReviewAction(IDLE, form({ candidateId: id, outcome: "CREATE", companyName: fixture.company, reason: "fixture" }))).toEqual({ status: "REJECTED", error: "Verify the posting before the company decision." });
      expect(await demandReviewAction(IDLE, form({ candidateId: id, outcome: "VERIFY", reason: "fixture" }))).toEqual({ status: "REJECTED", error: "Verify the posting before the company decision." });

      expect(await recordPostingVerificationAction({ status: "IDLE", error: null, decision: null }, form({ candidateId: id, decision: "VERIFIED", note: "Fixture: page checked." })))
        .toEqual({ status: "SAVED", error: null, decision: "VERIFIED" });
      // the legacy signal path cannot promote a governed item even though the URL now has a VERIFIED review
      expect(await promoteSignalAction({ status: "IDLE", error: null, fieldErrors: {} }, form({ candidateId: id }))).toMatchObject({ status: "REJECTED", error: "invalid" });
      expect(await promote(id)).toEqual({ status: "REJECTED", error: "Confirm the canonical company before promotion." });

      expect(await companyReviewAction(IDLE, form({ candidateId: id, outcome: "CREATE", companyName: fixture.company, reason: "fixture company" }))).toEqual({ status: "SAVED", error: null });
      expect(await promote(id)).toEqual({ status: "REJECTED", error: "Verify the canonical demand before promotion." });
      expect(await demandReviewAction(IDLE, form({ candidateId: id, outcome: "DEFER", reason: "fixture defer" }))).toEqual({ status: "SAVED", error: null });
      expect(await promote(id)).toEqual({ status: "REJECTED", error: "Verify the canonical demand before promotion." });

      expect(await demandReviewAction(IDLE, form({ candidateId: id, outcome: "VERIFY", reason: "fixture verify" }))).toEqual({ status: "SAVED", error: null });
      expect(await promotionBlocker(client, id)).toBeNull(); // all three human decisions present: only now could a person promote

      // a later posting decision that is not VERIFIED blocks promotion again
      await recordPostingVerificationAction({ status: "IDLE", error: null, decision: null }, form({ candidateId: id, decision: "NEEDS_REVIEW", note: "Posting changed." }));
      expect(await promote(id)).toEqual({ status: "REJECTED", error: "Verify the posting before promotion." });
      // a later company decision without a company blocks promotion
      await recordPostingVerificationAction({ status: "IDLE", error: null, decision: null }, form({ candidateId: id, decision: "VERIFIED", note: "Re-checked." }));
      expect(await companyReviewAction(IDLE, form({ candidateId: id, outcome: "DEFER", reason: "fixture defer company" }))).toEqual({ status: "SAVED", error: null });
      expect(await promote(id)).toEqual({ status: "REJECTED", error: "Confirm the canonical company before promotion." });

      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(await opportunities(client)).toBe(before);
    });
  });

  it("rejects promotion of an observation superseded by a newer one, even if it was fully reviewed", async () => {
    await inTransaction(async (client) => {
      const { candidateId } = await recordAssistedPosting(client, fixture, mocks.operatorId, new Date("2026-10-09T15:00:00Z"));
      const id = candidateId!;
      await recordPostingVerificationAction({ status: "IDLE", error: null, decision: null }, form({ candidateId: id, decision: "VERIFIED", note: "Fixture: page checked." }));
      await companyReviewAction(IDLE, form({ candidateId: id, outcome: "CREATE", companyName: fixture.company, reason: "fixture company" }));
      await demandReviewAction(IDLE, form({ candidateId: id, outcome: "VERIFY", reason: "fixture verify" }));
      expect(await promotionBlocker(client, id)).toBeNull();
      await recordAssistedPosting(client, { ...fixture, observedOn: "2026-10-15" }, mocks.operatorId, new Date("2026-10-15T15:00:00Z"));
      expect(await promote(id)).toEqual({ status: "REJECTED", error: "Verify the posting before promotion." });
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  });

  it("requires an authorized operator", async () => {
    await inTransaction(async (client) => {
      const { candidateId } = await recordAssistedPosting(client, fixture, mocks.operatorId, new Date("2026-10-09T15:00:00Z"));
      mocks.authorized = false;
      expect(await promote(candidateId!)).toEqual({ status: "REJECTED", error: "This action requires Human Verification permission." });
      expect(await recordPostingVerificationAction({ status: "IDLE", error: null, decision: null }, form({ candidateId: candidateId!, decision: "VERIFIED", note: "x" }))).toMatchObject({ status: "REJECTED", error: "restricted" });
    });
  });
});
