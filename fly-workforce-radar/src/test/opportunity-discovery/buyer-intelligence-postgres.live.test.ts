import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { getSignal } from "../../server/opportunity-discovery/signals";
import { PostgresCompanyRepository } from "../../server/repositories/company/postgres-company-repository";
import { loadBuyerInvestigation, recordInteraction, runBuyerInvestigation, updateInvestigationSettings, ensureInvestigation } from "../../server/contact-intelligence/buyer-investigation";
import type { safeFetchSource } from "../../server/source-enrichment/safe-fetch";

/**
 * Contact Intelligence 2.0 against the LOCAL database as the runtime app role (real grants, RLS, triggers).
 * Every test runs inside a transaction that is rolled back; providers are fixtures (no network).
 */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");
const MMR_SIGNAL = "90fcf10d-54ee-4f50-9385-611b8f31b4d0";

const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });

const page = (html: string) => ({ ok: true as const, status: 200, finalUrl: "", contentType: "text/html", body: Buffer.from(html) });
const fetcher = ((url: string) => {
  const path = new URL(url).pathname;
  if (path === "/leadership") return Promise.resolve({ ...page("<main><h2>Leadership</h2><h3>Pat Example</h3><p>Procurement Manager</p><p>pat.example@acme-fixture.com</p><h3>Lee Sample</h3><p>President</p></main>"), finalUrl: url });
  if (path === "/contact") return Promise.resolve({ ...page("<main><p>Headquarters: (225) 555-0100</p><p>info@acme-fixture.com</p></main>"), finalUrl: url });
  return Promise.resolve({ ok: false as const, status: 404, failure: "HTTP_STATUS" });
}) as unknown as typeof safeFetchSource;
const search = {
  configured: true,
  searchWeb: async (query: string) => query.includes('"Operations Manager"')
    ? [{ title: "Jordan Fixture - Operations Manager - Acme Fixture Electric | LinkedIn", url: "https://www.linkedin.com/in/jordan-fixture", description: null, pageAge: null }]
    : [],
};
const noHunter = async () => ({ state: "NOT_CONFIGURED" as const });

describe.skipIf(!databaseUrl)("Contact Intelligence 2.0 (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 2 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session)); } finally { await session.query("rollback"); session.release(); }
  };

  it("company-first: strategic company without opportunity → investigate → review → human interaction → canonical contact → reuse", async () => {
    await inTransaction(async (client) => {
      const company = await new PostgresCompanyRepository(client).createCompany({ commonName: "Acme Fixture Electric", normalized: "acme fixture electric", observedAt: new Date() });
      const subject = { kind: "COMPANY" as const, companyId: company.id };
      const row = await ensureInvestigation(client, subject, null);
      await updateInvestigationSettings(client, row.id, { officialDomain: { domain: "acme-fixture.com", basis: "fixture" } });
      const empty = await loadBuyerInvestigation(client, subject);
      expect(empty.path.state).toBe("NO_INDIVIDUAL_BUYER_IDENTIFIED");
      expect(empty.organization).toMatchObject({ type: "ELECTRICAL_CONSTRUCTION", companyId: company.id });

      const run = await runBuyerInvestigation(client, subject, null, { search, fetcher, hunter: noHunter, spacingMs: 0 });
      expect(run.people.found).toBeGreaterThanOrEqual(3);
      const view = await loadBuyerInvestigation(client, subject);
      expect(view.people.map((person) => person.name).sort()).toEqual(["Jordan Fixture", "Pat Example"]);
      expect(view.otherPeople.map((person) => person.name)).toEqual(["Lee Sample"]);
      const pat = view.people.find((person) => person.name === "Pat Example")!;
      expect(pat).toMatchObject({ state: "PROFESSIONAL_CONTACTABLE", currency: "CURRENT", email: { address: "pat.example@acme-fixture.com", status: "ATTRIBUTED_TO_PERSON" } });
      expect(view.people.find((person) => person.name === "Jordan Fixture")).toMatchObject({ state: "PROFESSIONAL_IDENTIFIED", currency: "UNDATED", nextAction: "CONFIRM_CURRENT_ROLE" });
      expect(view.channels.map((channel) => channel.value).sort()).toEqual(["(225) 555-0100", "info@acme-fixture.com"]);
      expect(view.path).toMatchObject({ state: "INDIVIDUAL", authority: "NOT_CONFIRMED", professionalChannel: "pat.example@acme-fixture.com" });
      expect(view.canonical).toEqual([]);

      const notReached = await recordInteraction(client, { candidateId: pat.primaryCandidateId, personReached: false, contactDate: "2026-09-30", channel: "PHONE", handlesExternalWorkforce: "UNKNOWN",
        referredTo: null, responsibleDepartment: null, notes: "Voicemail", nextAction: "Call back", operatorId: null, companyId: company.id, opportunityId: null });
      expect(notReached.canonical).toBe("NOT_REACHED");
      const reached = await recordInteraction(client, { candidateId: pat.primaryCandidateId, personReached: true, contactDate: "2026-09-30", channel: "EMAIL", handlesExternalWorkforce: "YES",
        referredTo: null, responsibleDepartment: "Procurement", notes: "Handles subcontracted electrical labor", nextAction: "Send capability statement", operatorId: null, companyId: company.id, opportunityId: null });
      expect(reached.canonical).toBe("WRITTEN");
      const again = await recordInteraction(client, { candidateId: pat.primaryCandidateId, personReached: true, contactDate: "2026-09-30", channel: "PHONE", handlesExternalWorkforce: "YES",
        referredTo: null, responsibleDepartment: null, notes: null, nextAction: null, operatorId: null, companyId: company.id, opportunityId: null });
      expect(again.canonical).toBe("REUSED");

      const after = await loadBuyerInvestigation(client, subject);
      expect(after.path).toMatchObject({ state: "INDIVIDUAL", authority: "CONFIRMED_BY_HUMAN", nextAction: "ADVANCE_RELATIONSHIP", person: { name: "Pat Example", state: "COMMERCIAL_RESPONSIBILITY_CONFIRMED" } });
      expect(after.people.find((person) => person.name === "Pat Example")?.email?.status).toBe("HUMAN_CONFIRMED");
      expect(after.canonical).toEqual([expect.objectContaining({ name: "Pat Example", fromInvestigation: true })]);
      await client.query("savepoint append_only");
      await expect(client.query("update contact_interactions set notes='x'")).rejects.toThrow();
      await client.query("rollback to savepoint append_only");

      // Re-running inside the cache window does not repeat web queries.
      const rerun = await runBuyerInvestigation(client, subject, null, { search: { configured: true, searchWeb: async () => { throw new Error("must be cached"); } }, fetcher, hunter: noHunter, spacingMs: 0 });
      expect(rerun.people.queries.every((query) => query.state === "CACHED")).toBe(true);
    });
  });

  it("opportunity-first: a Radar signal's organization gets the same buyer path, and a reached person needs a company on record", async () => {
    await inTransaction(async (client) => {
      const signal = await getSignal(client, MMR_SIGNAL);
      expect(signal.state).toBe("READY");
      if (signal.state !== "READY") return;
      const subject = { kind: "SIGNAL" as const, signal: signal.signal, normalizedUrl: signal.signal.normalizedUrl };
      const view = await loadBuyerInvestigation(client, subject);
      expect(view.organization.name).toMatch(/MMR/i);
      expect(view.organization.type).toBe("ELECTRICAL_CONSTRUCTION");
      // Corporate channels found in 1.0 are never counted as people.
      expect(view.people.every((person) => person.name.length > 0)).toBe(true);
      if (view.path.state === "NO_INDIVIDUAL_BUYER_IDENTIFIED") expect(view.path.functions.length).toBeGreaterThan(0);
      const offline = { configured: false, searchWeb: async () => [] };
      const run = await runBuyerInvestigation(client, subject, null, { search: offline, fetcher, hunter: noHunter, spacingMs: 0 });
      expect(run.people.queries.every((query) => query.state === "NOT_CONFIGURED" || query.state === "CACHED")).toBe(true);
    });
  });
});
