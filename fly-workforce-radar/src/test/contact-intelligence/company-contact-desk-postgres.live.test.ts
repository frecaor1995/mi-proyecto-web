import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { ContactDeskError, createCompanyNextAction, loadCompanyContactDesk, loadCompanyNextActions, recordCompanyCall, recordCorporateChannel, resolveCompanyNextAction } from "../../server/contact-intelligence/company-contact-desk";
import { loadStaffingIntelligence } from "../../server/staffing-intelligence/get-staffing-intelligence";

/** Contact desk against the LOCAL database (migration 20261010220000 applied); every test is rolled back. No network. */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");
const wrap = (client: PoolClient): SqlClient => ({ async query<Row>(text: string, values?: unknown[]) { return { rows: (await client.query(text, values)).rows as Row[] }; } });
const DEMO_COMPANY = "40000000-0000-4000-8000-000000000001"; // existing "DEMO LOCAL Contractor"
const channel = { companyId: DEMO_COMPANY, routeType: "OFFICE_PHONE", value: "(555) 010-0100", sourceUrl: "https://demo-local.invalid/contact", observedOn: "2026-10-10", locationLabel: "DEMO office", sourceNote: null };

describe.skipIf(!databaseUrl)("Contact Intelligence company contact desk (local Postgres, rolled back)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  const inTransaction = async (fn: (client: SqlClient, session: PoolClient) => Promise<void>) => {
    const session = await pool.connect();
    try { await session.query("begin"); await fn(wrap(session), session); } finally { await session.query("rollback").catch(() => undefined); session.release(); }
  };
  const rejects = async (session: PoolClient, sql: string, params: unknown[], pattern: RegExp) => {
    await session.query("savepoint expect_failure");
    await expect(session.query(sql, params)).rejects.toThrow(pattern);
    await session.query("rollback to savepoint expect_failure");
  };
  const operatorId = async (client: SqlClient) => (await client.query<{ id: string }>("select id from workforce_operators where status='ACTIVE' order by created_at limit 1")).rows[0].id;
  const counts = async (client: SqlClient) => (await client.query<Record<string, string>>(`select (select count(*) from contact_candidates) candidates, (select count(*) from contact_people) people,
    (select count(*) from opportunities) opportunities, (select count(*) from commercial_activities) activities, (select count(*) from companies) companies, (select count(*) from workforce_workers) workers`)).rows[0];

  it("records a corporate channel without a person, evidenced and deduplicated", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const before = await counts(client);
      const created = await recordCorporateChannel(client, channel, op, new Date("2026-10-10T18:00:00Z"));
      expect(created.outcome).toBe("CREATED");
      const route = (await client.query<Record<string, unknown>>("select contact_person_id,route_type::text,normalized_target,verification_state::text,evidence_id,route_metadata from contact_routes where id=$1", [created.routeId])).rows[0];
      expect(route).toMatchObject({ contact_person_id: null, route_type: "OFFICE_PHONE", normalized_target: "+15550100100", verification_state: "VERIFIED", evidence_id: created.evidenceId });
      expect(route.route_metadata).toMatchObject({ verificationBasis: "PUBLISHED_ON_OFFICIAL_SITE", callVerified: false, personal: false, supplierChannelConfirmed: false });
      expect((await recordCorporateChannel(client, { ...channel, value: "555.010.0100" }, op)).outcome).toBe("DUPLICATE");
      expect(await counts(client)).toEqual(before); // no person, candidate or opportunity invented
    });
  });

  it("records a company-level call without a candidate or opportunity; existing rows still need a subject", async () => {
    await inTransaction(async (client, session) => {
      const op = await operatorId(client);
      const before = await counts(client);
      const { routeId } = await recordCorporateChannel(client, channel, op);
      const demo = await recordCompanyCall(client, { companyId: DEMO_COMPANY, contactRouteId: routeId, contactDate: "2026-10-10", callOutcome: "NOT_CALLED", supplierAnswer: "NOT_ASKED",
        counterpartName: null, counterpartRole: null, notes: "PRUEBA DE INTERFAZ — NO HUBO LLAMADA REAL", isDemo: true }, op, new Date("2026-10-10T18:00:00Z"));
      const row = (await client.query<Record<string, unknown>>("select candidate_id,company_id,contact_route_id,call_outcome,external_supplier_answer,is_demo,person_reached from contact_interactions where id=$1", [demo.interactionId])).rows[0];
      expect(row).toMatchObject({ candidate_id: null, company_id: DEMO_COMPANY, contact_route_id: routeId, call_outcome: "NOT_CALLED", external_supplier_answer: "NOT_ASKED", is_demo: true, person_reached: false });
      await rejects(session, "insert into contact_interactions(person_reached,contact_date,channel,handles_external_workforce) values(false,current_date,'PHONE','UNKNOWN')", [], /contact_interactions_subject_check/);
      await rejects(session, "insert into contact_interactions(company_id,person_reached,contact_date,channel,handles_external_workforce) values($1,false,current_date,'PHONE','UNKNOWN')", [DEMO_COMPANY], /contact_interactions_company_call_check/);
      await rejects(session, "update contact_interactions set notes='x' where id=$1", [demo.interactionId], /./);
      const other = (await client.query<{ id: string }>("select id from contact_routes where company_id<>$1 limit 1", [DEMO_COMPANY])).rows[0];
      if (other) await expect(recordCompanyCall(client, { companyId: DEMO_COMPANY, contactRouteId: other.id, contactDate: "2026-10-10", callOutcome: "NO_ANSWER", supplierAnswer: "NOT_ASKED",
        counterpartName: null, counterpartRole: null, notes: null, isDemo: false }, op)).rejects.toBeInstanceOf(ContactDeskError);
      expect(await counts(client)).toEqual(before);
    });
  });

  it("creates, lists as pending and resolves company next actions; a resolved action is immutable", async () => {
    await inTransaction(async (client, session) => {
      const op = await operatorId(client);
      const { actionId } = await createCompanyNextAction(client, { companyId: DEMO_COMPANY, action: "DEMO/PRUEBA: verificar la mesa de contacto", dueDate: "2026-10-10", ownerOperatorId: op, isDemo: true }, op);
      const pending = await loadCompanyNextActions(client, { pendingOn: "2026-10-10" });
      expect(pending.find((a) => a.id === actionId)).toMatchObject({ isDemo: true, status: "OPEN", companyName: "DEMO LOCAL Contractor" });
      expect((await loadCompanyNextActions(client, { pendingOn: "2026-10-09" })).some((a) => a.id === actionId)).toBe(false); // not yet due
      await resolveCompanyNextAction(client, { actionId, status: "DONE", note: "done" }, op);
      await expect(resolveCompanyNextAction(client, { actionId, status: "CANCELLED", note: null }, op)).rejects.toBeInstanceOf(ContactDeskError);
      // only the resolution columns are grantable; a resolved row is also outside the OPEN-only RLS update policy and the trigger
      await rejects(session, "update company_next_actions set action='changed' where id=$1", [actionId], /permission denied|immutable/);
      expect((await client.query("update company_next_actions set resolution_note='again' where id=$1 returning id", [actionId])).rows).toEqual([]);
      expect((await client.query<{ action: string; resolution_note: string }>("select action,resolution_note from company_next_actions where id=$1", [actionId])).rows[0])
        .toEqual({ action: "DEMO/PRUEBA: verificar la mesa de contacto", resolution_note: "done" });
      await rejects(session, "delete from company_next_actions where id=$1", [actionId], /permission denied|never deleted/);
      const desk = await loadCompanyContactDesk(client, DEMO_COMPANY);
      expect(desk.actions.find((a) => a.id === actionId)).toMatchObject({ status: "DONE", resolutionNote: "done" });
    });
  });

  it("never counts DEMO calls or actions as real staffing activity, while real ones are shown", async () => {
    await inTransaction(async (client) => {
      const op = await operatorId(client);
      const walker = (await client.query<{ id: string }>("select id from companies where common_name='Walker Engineering'")).rows[0]?.id;
      if (!walker) return;
      const before = (await loadStaffingIntelligence(client, new Date("2026-10-10T18:00:00Z"))).companies.find((c) => c.companyId === walker)!;
      await recordCompanyCall(client, { companyId: walker, contactRouteId: null, contactDate: "2026-10-10", callOutcome: "NOT_CALLED", supplierAnswer: "NOT_ASKED", counterpartName: null, counterpartRole: null,
        notes: "PRUEBA DE INTERFAZ — NO HUBO LLAMADA REAL", isDemo: true }, op);
      await createCompanyNextAction(client, { companyId: walker, action: "DEMO/PRUEBA: revisar la mesa de contacto", dueDate: "2026-10-10", ownerOperatorId: op, isDemo: true }, op);
      const withDemo = (await loadStaffingIntelligence(client, new Date("2026-10-10T18:00:00Z"))).companies.find((c) => c.companyId === walker)!;
      expect([withDemo.lastConversation, withDemo.humanNextAction, withDemo.supplierAnswer]).toEqual([before.lastConversation, before.humanNextAction, before.supplierAnswer]);
      await recordCompanyCall(client, { companyId: walker, contactRouteId: null, contactDate: "2026-10-10", callOutcome: "REACHED", supplierAnswer: "NO", counterpartName: null, counterpartRole: "Fixture",
        notes: "Fixture: real-shaped call inside a rolled-back test.", isDemo: false }, op);
      const withReal = (await loadStaffingIntelligence(client, new Date("2026-10-10T18:00:00Z"))).companies.find((c) => c.companyId === walker)!;
      expect(withReal.lastConversation?.date).toBe("2026-10-10");
      expect(withReal.supplierAnswer?.answer).toBe("NO");
      expect(withReal.priority.negatives).toContain("SUPPLIER_NO");
    });
  });
});
