import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import type { PostingCaptureRequest } from "../../domain/individual-posting-capture";
import { IndividualPostingCaptureCoordinator, parseJobPosting, resolvePersistedCapturePolicy, type CaptureTransport } from "../../server/discovery-intelligence/individual-posting-capture";

/**
 * Recipe 1.1 v2 — Stage 1 (Strike / JazzHR) end to end against the LOCAL database, every test rolled back.
 * The transport is a local fake serving SYNTHETIC fixtures: no request leaves the machine.
 */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");

const STRIKE_URL = "https://strike.applytojob.com/apply/5DyLJo3Zgw/Journeyman-Electrician";
const fixture = (name: string) => readFileSync(resolve(process.cwd(), "src/test/fixtures/recipe-1-1", name), "utf8");
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });
const fakeTransport = (body: string) => {
  const calls: string[] = [];
  const transport: CaptureTransport = { fetch: async (url) => { calls.push(url); return { status: 200, url, contentType: "text/html; charset=utf-8", body, redirect: null }; } };
  return { transport, calls };
};

describe.skipIf(!databaseUrl)("Recipe 1.1 v2 Strike/JazzHR capture path (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session)); } finally { await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const newRun = async (client: SqlClient) => {
    const operator = (await client.query<{ id: string }>("select id from workforce_operators where status='ACTIVE' order by created_at limit 1")).rows[0];
    return (await client.query<{ id: string }>(
      `insert into company_discovery_runs(requested_by_operator_id,trigger_kind,target_text,normalized_target_text,started_at)
       values($1,'MANUAL','Recipe 1.1 local fixture run','recipe 1 1 local fixture run',now()) returning id`, [operator.id])).rows[0].id;
  };
  const request = (runId: string, overrides: Partial<PostingCaptureRequest> = {}): PostingCaptureRequest => ({
    profession: "Electricians and Electrical Apprentices", geography: "Houston, Texas", query: "Strike Journeyman Electrician Houston", source: STRIKE_URL, maximumResults: 20,
    maximumExternalRequests: 10, costCeilingUsd: 0, maximumRuntimeMs: 10000, captureMethod: "PUBLIC_HTTP", recipeIdentity: "RECIPE_1_1_V2", parentAggregateObservationId: null, runId,
    queryId: null, operatorAuthorization: "LOCAL FIXTURE TEST — no external request", ...overrides,
  });
  const counts = async (client: SqlClient) => (await client.query<Record<string, string>>(
    `select (select count(*) from raw_evidence where metadata->>'recipe11'='true') ev, (select count(*) from company_discovery_candidates where provider_metadata->>'recipe11'='true') cand,
            (select count(*) from discovery_watch_observations where metadata->>'recipe11'='true') obs, (select count(*) from discovery_watch_sources where normalized_source_url=$1) watch,
            (select count(*) from companies) companies, (select count(*) from opportunities) opportunities`, [STRIKE_URL])).rows[0];

  it("uses the persisted, current ALLOW for strike.applytojob.com", async () => {
    await inTransaction(async (client) => {
      const policy = await resolvePersistedCapturePolicy(client, "strike.applytojob.com", new Date("2026-10-08T12:00:00Z"));
      expect(policy.state).toBe("ALLOWED");
      const row = (await client.query<{ reviewed_by: string; policy_version: string; metadata: Record<string, unknown> }>(
        "select reviewed_by, policy_version, metadata from source_capture_policy_decisions where id=$1", [policy.decisionId])).rows[0];
      expect(row.policy_version).toBe("recipe-1.1-strike-jazzhr-v1");
      expect(row.metadata).toMatchObject({ host: "strike.applytojob.com", externalRequestsAuthorized: false });
    });
  });

  it("captures, persists and links evidence → candidate → observation → Human Review, idempotently, without creating companies or opportunities", async () => {
    await inTransaction(async (client) => {
      const runId = await newRun(client);
      const before = await counts(client);
      const at = new Date("2026-10-08T12:00:00Z");
      const { transport, calls } = fakeTransport(fixture("strike-jazzhr-detail-jsonld.html"));
      const first = await new IndividualPostingCaptureCoordinator(client, transport, () => at).run(request(runId), "ALLOWED", 0);
      expect(calls).toEqual([STRIKE_URL]);
      expect(first.ledger).toEqual({ requestsUsed: 1, postingsCaptured: 1, additionalCostUsd: 0 });
      const posting = first.postings[0];
      expect(posting).toMatchObject({ externalPostingId: "5DyLJo3Zgw", employerName: "Strike", title: "Journeyman Electrician", location: "Houston, TX", postingDate: "2026-09-30",
        relationship: "DIRECT_HIRE_POSTING", vendorAcceptance: "UNKNOWN", explicitEmployerHeadcount: null, compensation: null });
      expect(posting.externalPostingId).not.toBe("strike"); // the board slug identifies the catalog, never the posting

      const evidence = (await client.query<Record<string, unknown>>("select * from raw_evidence where id=$1", [posting.evidenceId])).rows[0];
      expect(evidence).toMatchObject({ source_url: STRIKE_URL, capture_method: "HTTP_FETCH", extractor_version: "recipe-1.1@1" });
      expect((evidence.metadata as Record<string, unknown>).posting).toMatchObject({ externalPostingId: "5DyLJo3Zgw" });
      const candidate = (await client.query<Record<string, unknown>>("select * from company_discovery_candidates where run_id=$1", [runId])).rows[0];
      expect(candidate).toMatchObject({ canonical_evidence_id: posting.evidenceId, human_review_required: true, normalized_candidate_url: STRIKE_URL });
      expect(candidate.provider_metadata).toMatchObject({ externalPostingId: "5DyLJo3Zgw" });
      const observation = (await client.query<Record<string, unknown>>("select o.*, w.platform from discovery_watch_observations o join discovery_watch_sources w on w.id=o.watch_source_id where o.candidate_id=$1", [candidate.id])).rows[0];
      expect(observation).toMatchObject({ external_posting_id: "5DyLJo3Zgw", evidence_id: posting.evidenceId, state: "NEW", platform: "JAZZHR" });
      expect(posting.reviewHref).toBe(`/radar/${candidate.id}`);

      const afterFirst = await counts(client);
      expect(Number(afterFirst.ev) - Number(before.ev)).toBe(1);
      expect(Number(afterFirst.cand) - Number(before.cand)).toBe(1);
      expect(Number(afterFirst.obs) - Number(before.obs)).toBe(1);
      expect(afterFirst.companies).toBe(before.companies); // no canonical company created
      expect(afterFirst.opportunities).toBe(before.opportunities); // no opportunity created

      // Replay of the same capture: nothing duplicated.
      await new IndividualPostingCaptureCoordinator(client, fakeTransport(fixture("strike-jazzhr-detail-jsonld.html")).transport, () => at).run(request(runId), "ALLOWED", 0);
      expect(await counts(client)).toEqual(afterFirst);

      // A capture one week later: a new DATED observation of the same posting; unchanged content reuses the evidence.
      const later = new Date("2026-10-15T12:00:00Z");
      const second = await new IndividualPostingCaptureCoordinator(client, fakeTransport(fixture("strike-jazzhr-detail-jsonld.html")).transport, () => later).run(request(runId), "ALLOWED", 0);
      expect(second.postings[0].evidenceId).toBe(posting.evidenceId);
      const afterLater = await counts(client);
      expect(Number(afterLater.obs) - Number(afterFirst.obs)).toBe(1);
      expect(afterLater.ev).toBe(afterFirst.ev);
      expect(afterLater.watch).toBe("1");
      const dates = (await client.query<{ captured_at: Date }>("select captured_at from discovery_watch_observations where external_posting_id='5DyLJo3Zgw' and metadata->>'recipe11'='true' order by captured_at")).rows
        .map((r) => r.captured_at.toISOString().slice(0, 10));
      expect(dates.slice(-2)).toEqual(["2026-10-08", "2026-10-15"]);
    });
  }, 60_000);

  it("blocks before any request when the latest decision is not ALLOW, is expired, or no decision exists", async () => {
    await inTransaction(async (client) => {
      const runId = await newRun(client);
      // expired: the ALLOW is valid until 2026-10-29
      const expired = fakeTransport(fixture("strike-jazzhr-detail-html.html"));
      await expect(new IndividualPostingCaptureCoordinator(client, expired.transport, () => new Date("2026-11-02T00:00:00Z")).run(request(runId), "ALLOWED", 0)).rejects.toThrow("POLICY_EXPIRED");
      expect(expired.calls).toEqual([]);
      // a newer DENY (append-only, superseding the ALLOW) outranks the older ALLOW
      const allow = await resolvePersistedCapturePolicy(client, "strike.applytojob.com", new Date("2026-10-08T12:00:00Z"));
      await client.query(
        `insert into source_capture_policy_decisions(source_id,capture_method,decision,reason,reviewed_at,reviewed_by,policy_version,supersedes_decision_id,metadata)
         values($1,'HTTP_FETCH','DENIED','Local test: access withdrawn','2026-10-08T06:00:00Z','local test','test-deny',$2,'{}'::jsonb)`, [allow.sourceId, allow.decisionId]);
      const denied = fakeTransport(fixture("strike-jazzhr-detail-html.html"));
      await expect(new IndividualPostingCaptureCoordinator(client, denied.transport, () => new Date("2026-10-08T12:00:00Z")).run(request(runId), "ALLOWED", 0)).rejects.toThrow("POLICY_NOT_ALLOWED");
      expect(denied.calls).toEqual([]);
      // no decision: a registered source without any persisted decision, and a host with no source at all
      await client.query("insert into sources(name,source_type,access_classification,enabled,requires_auth,paywalled,domain) values('Local test board','OTHER','PUBLIC',true,false,false,'jobs.houston-fixture.example')");
      const none = fakeTransport("<html></html>");
      await expect(new IndividualPostingCaptureCoordinator(client, none.transport).run(request(runId, { source: "https://jobs.houston-fixture.example/job/1" }), "ALLOWED", 0)).rejects.toThrow("PERSISTED_ALLOW_REQUIRED");
      await expect(new IndividualPostingCaptureCoordinator(client, none.transport).run(request(runId, { source: "https://unregistered.example/job/1" }), "ALLOWED", 0)).rejects.toThrow("PERSISTED_ALLOW_REQUIRED");
      expect(none.calls).toEqual([]);
      // catalog access UNCONFIRMED or out-of-scope requests fail before touching the database
      await expect(new IndividualPostingCaptureCoordinator(client, none.transport).run(request(runId), "UNCONFIRMED", 0)).rejects.toThrow("SOURCE_ACCESS_UNCONFIRMED");
      await expect(new IndividualPostingCaptureCoordinator(client, none.transport).run(request(runId, { maximumExternalRequests: 11 }), "ALLOWED", 0)).rejects.toThrow("CAPTURE_SCOPE_EXCEEDED");
    });
  }, 60_000);

  it("builds the Stage 3 readiness matrix from the persisted policies in the local database", async () => {
    await inTransaction(async (client) => {
      const { loadAtsReadinessMatrix } = await import("../../server/discovery-intelligence/ats-readiness");
      const matrix = await loadAtsReadinessMatrix(client, new Date("2026-10-08T12:00:00Z"));
      expect(matrix).toHaveLength(30);
      expect(matrix.filter((r) => r.capability === "READY").map((r) => r.key)).toEqual(["strike"]);
      expect(matrix.find((r) => r.key === "strike")).toMatchObject({ access: "PERSISTED_ALLOW", host: "strike.applytojob.com" });
      // after the ALLOW expires, the pilot is no longer READY
      const expired = await loadAtsReadinessMatrix(client, new Date("2026-11-02T00:00:00Z"));
      expect(expired.find((r) => r.key === "strike")).toMatchObject({ capability: "NEEDS_VERIFICATION", access: "NO_PERSISTED_ALLOW" });
    });
  });

  it("parses the JazzHR detail page from fixtures without inventing fields", () => {
    const html = parseJobPosting(fixture("strike-jazzhr-detail-html.html"), STRIKE_URL, "2026-10-08T12:00:00Z", null)!;
    expect(html).toMatchObject({ externalPostingId: "5DyLJo3Zgw", employerName: "Strike", title: "Journeyman Electrician", location: "Houston, TX", professionalLevel: "JOURNEYMAN",
      postingDate: null, compensation: null, perDiem: null, experience: null, explicitEmployerHeadcount: null, vendorAcceptance: "UNKNOWN", evidenceCompleteness: "PARTIAL", applicationUrl: STRIKE_URL });
    expect(html.evidenceExcerpt).toContain("SYNTHETIC PLACEHOLDER DESCRIPTION");
    const ld = parseJobPosting(fixture("strike-jazzhr-detail-jsonld.html"), STRIKE_URL, "2026-10-08T12:00:00Z", null)!;
    expect(ld).toMatchObject({ externalPostingId: "5DyLJo3Zgw", postingDate: "2026-09-30", evidenceCompleteness: "COMPLETE" });
    // the board listing URL and other boards are not individual Strike postings
    expect(parseJobPosting(fixture("strike-jazzhr-detail-html.html"), "https://strike.applytojob.com/apply/", "2026-10-08T12:00:00Z", null)).toBeNull();
    expect(parseJobPosting(fixture("strike-jazzhr-detail-html.html"), "https://other.applytojob.com/apply/5DyLJo3Zgw/Journeyman-Electrician", "2026-10-08T12:00:00Z", null)).toBeNull();
    // outside Houston (e.g. Midland) stays out of this recipe's scope
    expect(parseJobPosting(fixture("strike-jazzhr-detail-html.html").replace("Houston, TX", "Midland, TX").replace("Houston area", "Permian area"), STRIKE_URL, "2026-10-08T12:00:00Z", null)).toBeNull();
  });
});
