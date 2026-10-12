import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import type { AssistedPostingInput } from "../../domain/assisted-posting-capture";
import { AssistedCaptureValidationError, recordAssistedPosting } from "../../server/discovery-intelligence/assisted-posting-capture";
import { persistIndividualPosting } from "../../server/discovery-intelligence/individual-posting-capture";
import { toAssistedPosting } from "../../domain/assisted-posting-capture";

/** Recipe 2.0 assisted capture against the LOCAL database, every test rolled back. No network: the URL is never visited. */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });

const URL_441 = "https://phg.tbe.taleo.net/phg04/ats/careers/v2/requisition.jsp?org=WP3X5Q&cws=37&rid=441";
const input = (overrides: Partial<AssistedPostingInput> = {}): AssistedPostingInput => ({
  url: URL_441, company: "Walker Engineering", title: "Apprentice Electrician", city: "Houston", state: "TX", salary: null,
  experience: "Minimum 1 year of commercial electrical experience", licenses: "TDLR apprentice or journeyman license", observedOn: "2026-10-09",
  summary: "Test fixture summary written by the operator.", provenance: "ASSISTED_MANUAL", dataClass: "REAL", emailAlert: null, ...overrides,
});

describe.skipIf(!databaseUrl)("Recipe 2.0 assisted capture (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session)); } finally { await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const operatorId = async (client: SqlClient) => (await client.query<{ id: string }>("select id from workforce_operators where status='ACTIVE' order by created_at limit 1")).rows[0].id;
  const counts = async (client: SqlClient) => (await client.query<Record<string, string>>(`select (select count(*) from raw_evidence where metadata->>'recipe11'='true') ev,
    (select count(*) from company_discovery_candidates where provider_metadata->>'recipe11'='true') cand, (select count(*) from discovery_watch_observations where metadata->>'recipe11'='true') obs,
    (select count(*) from companies) companies, (select count(*) from opportunities) opportunities, (select count(*) from contact_people) contacts, (select count(*) from workforce_workers) workers,
    (select count(*) from demand_signals) demand_signals`)).rows[0];

  it("records an assisted posting with MANUAL provenance through evidence → candidate → observation → Human Review, without promotion", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const before = await counts(client);
      // the real Walker 441 may already be recorded locally (different date): then this is a dated re-observation
      const priorObservations = Number((await client.query<{ n: string }>("select count(*) n from discovery_watch_observations where external_posting_id='441' and metadata->>'provenance'='ASSISTED_MANUAL'")).rows[0].n);
      const result = await recordAssistedPosting(client, input(), op, new Date("2026-10-09T15:00:00Z"));
      expect(result.outcome).toBe(priorObservations ? "RE_OBSERVED" : "CREATED");
      expect(result.reviewHref).toBe(`/radar/${result.candidateId}`);
      const evidence = (await client.query<Record<string, unknown>>("select capture_method::text, extractor_version, source_url, metadata from raw_evidence where id=$1", [result.evidenceId])).rows[0];
      expect(evidence).toMatchObject({ capture_method: "MANUAL", extractor_version: "assisted-capture@1", source_url: URL_441 });
      expect(evidence.metadata).toMatchObject({ provenance: "ASSISTED_MANUAL", dataClass: "REAL", urlVisited: false, recordedByOperatorId: op, observedOn: "2026-10-09",
        posting: { externalPostingId: "441", employerName: "Walker Engineering", compensation: null, postingDate: null, vendorAcceptance: "UNKNOWN", relationship: "UNKNOWN" } });
      const candidate = (await client.query<Record<string, unknown>>("select human_review_required, canonical_evidence_id, provider_metadata from company_discovery_candidates where id=$1", [result.candidateId])).rows[0];
      expect(candidate).toMatchObject({ human_review_required: true, canonical_evidence_id: result.evidenceId });
      expect(candidate.provider_metadata).toMatchObject({ provenance: "ASSISTED_MANUAL", externalPostingId: "441" });
      const observation = (await client.query<Record<string, unknown>>("select o.external_posting_id, o.state, w.automation_policy, w.allowed_method, w.platform from discovery_watch_observations o join discovery_watch_sources w on w.id=o.watch_source_id where o.candidate_id=$1", [result.candidateId])).rows[0];
      expect(observation).toMatchObject({ external_posting_id: "441", state: "NEW", automation_policy: "MANUAL_FIRST", allowed_method: "MANUAL" });
      const run = (await client.query<Record<string, unknown>>("select trigger_kind::text, status::text, correlation_metadata from company_discovery_runs where id=$1", [result.runId])).rows[0];
      expect(run).toMatchObject({ trigger_kind: "MANUAL", status: "COMPLETED", correlation_metadata: { step: "ASSISTED_CAPTURE", assistedOutcome: result.outcome, urlVisited: false } });
      // Human Review (existing /radar/[id] read) recognizes the recorded company and location
      const { getSignal } = await import("../../server/opportunity-discovery/signals");
      const signal = await getSignal(client, result.candidateId!);
      expect(signal.state).toBe("READY");
      if (signal.state === "READY") {
        expect(signal.signal.company).toBe("Walker Engineering");
        expect(signal.signal.location).toMatch(/Houston/);
        expect(signal.signal.title).toBe("Apprentice Electrician — Walker Engineering — Houston, TX");
      }
      const after = await counts(client);
      expect([Number(after.ev) - Number(before.ev), Number(after.cand) - Number(before.cand), Number(after.obs) - Number(before.obs)]).toEqual([1, 1, 1]);
      for (const key of ["companies", "opportunities", "contacts", "workers", "demand_signals"]) expect(after[key]).toBe(before[key]); // no promotion, Workforce untouched
    });
  });

  it("deduplicates the same posting on the same observation date and adds a dated observation on a new date", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const datesQuery = "select to_char(captured_at,'YYYY-MM-DD') d from discovery_watch_observations where external_posting_id='441' and metadata->>'provenance'='ASSISTED_MANUAL' order by captured_at";
      const preexisting = (await client.query<{ d: string }>(datesQuery)).rows.map((r) => r.d); // real local records, left untouched
      const first = await recordAssistedPosting(client, input(), op, new Date("2026-10-09T15:00:00Z"));
      const before = await counts(client);
      // same posting, same day, different tracking parameter and summary: still a duplicate
      const dup = await recordAssistedPosting(client, input({ url: `${URL_441}&utm_source=email`, summary: "Second operator note." }), op, new Date("2026-10-09T16:00:00Z"));
      expect(dup).toMatchObject({ outcome: "DUPLICATE", candidateId: first.candidateId, evidenceId: null });
      const afterDup = await counts(client);
      expect([afterDup.ev, afterDup.cand, afterDup.obs]).toEqual([before.ev, before.cand, before.obs]);
      const later = await recordAssistedPosting(client, input({ observedOn: "2026-10-16" }), op, new Date("2026-10-16T15:00:00Z"));
      expect(later.outcome).toBe("RE_OBSERVED");
      const dates = (await client.query<{ d: string }>(datesQuery)).rows.map((r) => r.d);
      expect(dates).toEqual([...preexisting, "2026-10-09", "2026-10-16"].sort());
    });
  });

  it("shows company and location in Human Review for older assisted records whose title and run omit them (read-only fallback)", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      // reproduce the shape of the first Walker 441 record: plain candidate title and a run target without the company
      const fixture = input({ url: "https://careers-fixture.example.com/jobs/77777/apprentice-electrician", observedOn: "2026-10-08" });
      const { posting, identitySource } = toAssistedPosting(fixture);
      const run = (await client.query<{ id: string }>("insert into company_discovery_runs(requested_by_operator_id,trigger_kind,target_text,normalized_target_text,started_at) values($1,'MANUAL','assisted capture','assisted capture',$2) returning id", [op, "2026-10-09T15:00:00Z"])).rows[0];
      const source = (await client.query<{ id: string }>("select id from sources order by created_at limit 1")).rows[0];
      const result = await persistIndividualPosting(client, { posting, identitySource, sourceId: source.id, runId: run.id, contentType: "application/json", captureMethod: "MANUAL", extractorVersion: "assisted-capture@1",
        relevanceReason: "fixture", automationPolicy: "MANUAL_FIRST", allowedMethod: "MANUAL", policyReason: "fixture", candidateTitle: "Apprentice Electrician",
        metadata: { provenance: "ASSISTED_MANUAL", dataClass: "REAL", urlVisited: false } });
      const { getSignal } = await import("../../server/opportunity-discovery/signals");
      const signal = await getSignal(client, result.candidateId!);
      expect(signal.state).toBe("READY");
      if (signal.state === "READY") {
        expect(signal.signal.title).toBe("Apprentice Electrician");
        expect(signal.signal.company).toBe("Walker Engineering");
        expect(signal.signal.qualification.organization).toBe("Walker Engineering");
        expect(signal.signal.location).toMatch(/Houston/);
      }
    });
  });

  it("records EMAIL_ALERT provenance and keeps DEMO separate from REAL", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const alert = await recordAssistedPosting(client, input({ url: "https://careers-fixture.example.com/jobs/12345/electrician", company: "Fixture Electrical Co", title: "Electrician",
        provenance: "EMAIL_ALERT", emailAlert: { sender: "careers@fixture.example.com", receivedOn: "2026-10-09", alertReference: "Houston electrical alert" } }), op, new Date("2026-10-09T15:00:00Z"));
      const meta = (await client.query<{ metadata: Record<string, unknown> }>("select metadata from raw_evidence where id=$1", [alert.evidenceId])).rows[0].metadata;
      expect(meta).toMatchObject({ provenance: "EMAIL_ALERT", emailAlert: { sender: "careers@fixture.example.com", receivedOn: "2026-10-09", alertReference: "Houston electrical alert" } });
      const demo = await recordAssistedPosting(client, input({ url: "https://careers-fixture.example.com/jobs/99999/apprentice", company: "DEMO LOCAL Fixture Contractor", dataClass: "DEMO" }), op, new Date("2026-10-09T15:00:00Z"));
      expect((await client.query<{ c: string }>("select metadata->>'dataClass' c from raw_evidence where id=$1", [demo.evidenceId])).rows[0].c).toBe("DEMO");
      await expect(recordAssistedPosting(client, input({ dataClass: "DEMO" }), op, new Date("2026-10-09T15:00:00Z"))).rejects.toThrow(AssistedCaptureValidationError);
    });
  });
});
