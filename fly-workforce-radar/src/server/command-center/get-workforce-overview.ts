import { getProductionSqlClient } from "../database/production-sql-client";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { isDemoWorkerSql } from "../../domain/demo-records";

/** Read-only product overview for the Command Center, built from real rows only (no estimates). */
export interface WorkforceOverviewOpportunity {
  readonly id: string;
  readonly title: string;
  readonly trade: string | null;
  readonly occupation: string | null;
  readonly headcount: number | null;
  readonly location: string | null;
  readonly matchedWorkers: number;
  readonly candidates: number;
  /** Local development/test record (title prefixed "DEMO LOCAL"); never presented as market intelligence. */
  readonly isDemo: boolean;
}

export interface WorkforceOverview {
  readonly opportunities: { readonly total: number; readonly real: number; readonly demo: number; readonly realWithDemand: number };
  readonly workers: { readonly total: number; readonly active: number; readonly available: number };
  readonly matching: { readonly strong: number; readonly possible: number; readonly insufficient: number; readonly noMatch: number; readonly opportunitiesMatched: number };
  /**
   * REAL candidates only: an open engagement counts when neither its opportunity (DEMO LOCAL title) nor its worker
   * (shared DEMO criterion, domain/demo-records) is DEMO. DEMO engagements are reported apart and never as real.
   */
  readonly candidates: { readonly shortlisted: number; readonly selected: number; readonly inOutreach: number; readonly demo: { readonly shortlisted: number; readonly selected: number } };
  /** Open company next actions (Contact Intelligence) due today or overdue, Houston time; DEMO counted apart. */
  readonly companyActions: { readonly realDue: number; readonly demoDue: number };
  /**
   * Workforce gap over REAL opportunities whose demand states a headcount and has been matched:
   * needed = stated headcount; covered = current strong + possible matches (capped at headcount).
   */
  readonly gap: { readonly demandsMeasured: number; readonly needed: number; readonly covered: number; readonly gap: number };
  readonly recent: readonly WorkforceOverviewOpportunity[];
}

export type WorkforceOverviewResult =
  | { readonly state: "READY"; readonly overview: WorkforceOverview }
  | { readonly state: "UNAVAILABLE" };

export const RECENT_OPPORTUNITY_LIMIT = 6;
export const DEMO_TITLE_PREFIX = "DEMO LOCAL";

const OVERVIEW_SQL = `
with current_results as (
  select r.demand_signal_id, r.worker_id, r.outcome from worker_demand_match_results r where r.superseded_at is null
), open_engagements as (
  select e.*, (coalesce(eo.title, '') ilike '${DEMO_TITLE_PREFIX}%' or coalesce(${isDemoWorkerSql("ew.display_name")}, false)) as is_demo
  from worker_demand_engagements e
  left join opportunities eo on eo.id = e.opportunity_id
  left join workforce_workers ew on ew.id = e.worker_id
  where e.closed_at is null
), opps as (
  select o.*, (coalesce(o.title, '') ilike '${DEMO_TITLE_PREFIX}%') as is_demo from opportunities o
), measured as (
  select od.demand_signal_id, ds.headcount_estimate as needed,
    least(ds.headcount_estimate, count(*) filter (where c.outcome in ('STRONG_MATCH','POSSIBLE_MATCH'))) as covered
  from opps o
  join opportunity_demand_signals od on od.opportunity_id = o.id
  join demand_signals ds on ds.id = od.demand_signal_id
  join current_results c on c.demand_signal_id = od.demand_signal_id
  where not o.is_demo and ds.headcount_estimate > 0
  group by od.demand_signal_id, ds.headcount_estimate
)
select json_build_object(
  'opportunities', json_build_object(
    'total', (select count(*) from opps),
    'real', (select count(*) from opps where not is_demo),
    'demo', (select count(*) from opps where is_demo),
    'realWithDemand', (select count(distinct o.id) from opps o join opportunity_demand_signals od on od.opportunity_id = o.id where not o.is_demo)),
  'workers', json_build_object(
    'total', (select count(*) from workforce_workers),
    'active', (select count(*) from workforce_workers where lifecycle_status = 'ACTIVE'),
    'available', (select count(*) from workforce_workers w join worker_current_availability_v a on a.worker_id = w.id
                  where w.lifecycle_status = 'ACTIVE' and a.status = 'AVAILABLE')),
  'matching', json_build_object(
    'strong', (select count(*) from current_results where outcome = 'STRONG_MATCH'),
    'possible', (select count(*) from current_results where outcome = 'POSSIBLE_MATCH'),
    'insufficient', (select count(*) from current_results where outcome = 'INSUFFICIENT_DATA'),
    'noMatch', (select count(*) from current_results where outcome = 'NO_MATCH'),
    'opportunitiesMatched', (select count(distinct od.opportunity_id) from current_results c join opportunity_demand_signals od on od.demand_signal_id = c.demand_signal_id)),
  'candidates', json_build_object(
    'shortlisted', (select count(*) from open_engagements where selection_state = 'SHORTLISTED' and not is_demo),
    'selected', (select count(*) from open_engagements where selection_state = 'SELECTED' and not is_demo),
    'inOutreach', (select count(*) from open_engagements where contact_state in ('PLANNED','ATTEMPTED','AWAITING_RESPONSE','RESPONSE_RECEIVED') and not is_demo),
    'demo', json_build_object(
      'shortlisted', (select count(*) from open_engagements where selection_state = 'SHORTLISTED' and is_demo),
      'selected', (select count(*) from open_engagements where selection_state = 'SELECTED' and is_demo))),
  'companyActions', json_build_object(
    'realDue', (select count(*) from company_next_actions where status = 'OPEN' and not is_demo and due_date <= (now() at time zone 'America/Chicago')::date),
    'demoDue', (select count(*) from company_next_actions where status = 'OPEN' and is_demo and due_date <= (now() at time zone 'America/Chicago')::date)),
  'gap', json_build_object(
    'demandsMeasured', (select count(*) from measured),
    'needed', (select coalesce(sum(needed), 0) from measured),
    'covered', (select coalesce(sum(covered), 0) from measured),
    'gap', (select coalesce(sum(needed - covered), 0) from measured)),
  'recent', coalesce((select json_agg(x) from (
    select o.id, coalesce(o.title, 'Untitled opportunity') as title, o.is_demo as "isDemo",
      t.label_en as trade, oc.label_en as occupation, d.headcount_estimate as headcount,
      nullif(concat_ws(', ', d.city, d.state), '') as location,
      (select count(*) from current_results c join opportunity_demand_signals od2 on od2.demand_signal_id = c.demand_signal_id
        where od2.opportunity_id = o.id and c.outcome in ('STRONG_MATCH','POSSIBLE_MATCH')) as "matchedWorkers",
      (select count(*) from open_engagements e where e.opportunity_id = o.id and e.selection_state in ('SHORTLISTED','SELECTED') and (o.is_demo or not e.is_demo)) as candidates
    from opps o
    left join lateral (
      select ds.* from opportunity_demand_signals od join demand_signals ds on ds.id = od.demand_signal_id
      where od.opportunity_id = o.id order by od.created_at limit 1) d on true
    left join workforce_trades t on t.code = d.trade_code
    left join workforce_occupations oc on oc.code = d.occupation_code
    order by o.is_demo, o.created_at desc, o.id limit ${RECENT_OPPORTUNITY_LIMIT}) x), '[]'::json)
) as overview`;

type Row = { overview: unknown };

const num = (value: unknown) => Number(value ?? 0);

export async function loadWorkforceOverview(client: SqlClient | null): Promise<WorkforceOverviewResult> {
  if (!client) return { state: "UNAVAILABLE" };
  try {
    const result = await client.query<Row>(OVERVIEW_SQL);
    const raw = result.rows[0]?.overview;
    const o = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, Record<string, unknown>> & { recent: Record<string, unknown>[] };
    const gap = o.gap ?? {};
    const demoCandidates = (o.candidates.demo ?? {}) as Record<string, unknown>;
    const companyActions = o.companyActions ?? {};
    return {
      state: "READY",
      overview: {
        opportunities: { total: num(o.opportunities.total), real: num(o.opportunities.real), demo: num(o.opportunities.demo), realWithDemand: num(o.opportunities.realWithDemand) },
        workers: { total: num(o.workers.total), active: num(o.workers.active), available: num(o.workers.available) },
        matching: {
          strong: num(o.matching.strong), possible: num(o.matching.possible), insufficient: num(o.matching.insufficient),
          noMatch: num(o.matching.noMatch), opportunitiesMatched: num(o.matching.opportunitiesMatched),
        },
        candidates: {
          shortlisted: num(o.candidates.shortlisted), selected: num(o.candidates.selected), inOutreach: num(o.candidates.inOutreach),
          demo: { shortlisted: num(demoCandidates.shortlisted), selected: num(demoCandidates.selected) },
        },
        companyActions: { realDue: num(companyActions.realDue), demoDue: num(companyActions.demoDue) },
        gap: { demandsMeasured: num(gap.demandsMeasured), needed: num(gap.needed), covered: num(gap.covered), gap: num(gap.gap) },
        recent: o.recent.map((r) => ({
          id: String(r.id), title: String(r.title),
          trade: r.trade == null ? null : String(r.trade), occupation: r.occupation == null ? null : String(r.occupation),
          headcount: r.headcount == null ? null : num(r.headcount), location: r.location == null ? null : String(r.location),
          matchedWorkers: num(r.matchedWorkers), candidates: num(r.candidates), isDemo: r.isDemo === true,
        })),
      },
    };
  } catch {
    return { state: "UNAVAILABLE" };
  }
}

export function getWorkforceOverview(): Promise<WorkforceOverviewResult> {
  return loadWorkforceOverview(getProductionSqlClient());
}
