import { Pool } from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { ProductOverview } from "../../components/command-center/product-overview";
import { loadWorkforceOverview } from "../../server/command-center/get-workforce-overview";

const baseRow = {
  opportunities: { total: 6, real: 1, demo: 5, realWithDemand: 1 },
  workers: { total: 41, active: 41, available: 39 },
  matching: { strong: 0, possible: 2, insufficient: 0, noMatch: 29, opportunitiesMatched: 1 },
  gap: { demandsMeasured: 0, needed: 0, covered: 0, gap: 0 },
  recent: [],
};
const clientReturning = (overview: unknown): SqlClient => ({ query: vi.fn(async () => ({ rows: [{ overview }] })) }) as unknown as SqlClient;

describe("Command Center — REAL/DEMO candidates and company next actions", () => {
  it("shows 0 real candidates with the DEMO ones apart, and real due company actions with a link to the pending list", async () => {
    const result = await loadWorkforceOverview(clientReturning({ ...baseRow,
      candidates: { shortlisted: 0, selected: 0, inOutreach: 0, demo: { shortlisted: 1, selected: 3 } }, companyActions: { realDue: 0, demoDue: 1 } }));
    if (result.state !== "READY") throw new Error("expected READY");
    expect(result.overview.candidates).toEqual({ shortlisted: 0, selected: 0, inOutreach: 0, demo: { shortlisted: 1, selected: 3 } });
    expect(result.overview.companyActions).toEqual({ realDue: 0, demoDue: 1 });
    const html = renderToStaticMarkup(<ProductOverview locale="es-US" result={result} />);
    expect(html).toContain("4 candidatos DEMO excluidos (3 seleccionados · 1 preseleccionados)");
    expect(html).toContain('href="/opportunities/pursuits#company-actions"');
    expect(html).toContain("Próximas acciones de empresas");
    expect(html).toContain("Reales, para hoy o vencidas · 1 DEMO aparte");
  });

  it("tolerates an overview row without the new fields (older shape): zeros, nothing invented", async () => {
    const result = await loadWorkforceOverview(clientReturning({ ...baseRow, candidates: { shortlisted: 1, selected: 3, inOutreach: 2 } }));
    if (result.state !== "READY") throw new Error("expected READY");
    expect(result.overview.candidates.demo).toEqual({ shortlisted: 0, selected: 0 });
    expect(result.overview.companyActions).toEqual({ realDue: 0, demoDue: 0 });
    expect(renderToStaticMarkup(<ProductOverview locale="en-US" result={result} />)).not.toContain("DEMO candidate");
  });
});

/** Live, read-only: the real query against the LOCAL database agrees with direct counts. No writes. */
const databaseUrl = process.env.BUYER_LOCAL_DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
if (databaseUrl && host !== "127.0.0.1" && host !== "localhost") throw new Error("BUYER_LOCAL_DATABASE_URL must target localhost");

describe.skipIf(!databaseUrl)("Command Center overview against the local database (read-only)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });

  it("never counts an engagement with a DEMO worker or DEMO opportunity as a real candidate", async () => {
    const client: SqlClient = { async query<Row>(text: string, values?: unknown[]) { return { rows: (await pool.query(text, values)).rows as Row[] }; } };
    const result = await loadWorkforceOverview(client);
    if (result.state !== "READY") throw new Error("overview unavailable");
    const direct = (await pool.query<{ real: number; demo: number; real_due: number; demo_due: number }>(`
      select count(*) filter (where not d)::int real, count(*) filter (where d)::int demo,
             (select count(*)::int from company_next_actions where status='OPEN' and not is_demo and due_date <= (now() at time zone 'America/Chicago')::date) real_due,
             (select count(*)::int from company_next_actions where status='OPEN' and is_demo and due_date <= (now() at time zone 'America/Chicago')::date) demo_due
        from (select coalesce(o.title,'') ilike 'DEMO LOCAL%' or coalesce(w.display_name ~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)', false) d
                from worker_demand_engagements e left join opportunities o on o.id=e.opportunity_id left join workforce_workers w on w.id=e.worker_id
               where e.closed_at is null and e.selection_state in ('SHORTLISTED','SELECTED')) x`)).rows[0];
    const c = result.overview.candidates;
    expect(c.selected + c.shortlisted).toBe(direct.real);
    expect(c.demo.selected + c.demo.shortlisted).toBe(direct.demo);
    expect(result.overview.companyActions).toEqual({ realDue: direct.real_due, demoDue: direct.demo_due });
    expect(result.overview.workers.total).toBe(41);
    for (const row of result.overview.recent.filter((r) => !r.isDemo)) {
      const demoOnReal = (await pool.query<{ n: number }>(`select count(*)::int n from worker_demand_engagements e join workforce_workers w on w.id=e.worker_id
        where e.opportunity_id=$1 and e.closed_at is null and e.selection_state in ('SHORTLISTED','SELECTED') and w.display_name !~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)'`, [row.id])).rows[0].n;
      expect(row.candidates).toBe(demoOnReal);
    }
  });
});
