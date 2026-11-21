-- Multi-trade discovery cycles: bounded rotating queries with an auditable per-query log.
-- Reuses the existing run, candidate, fingerprint and search-profile architecture.
begin;

create table public.discovery_query_executions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.company_discovery_runs(id) on delete restrict,
  position integer not null check (position between 1 and 20),
  query_text text not null check (length(trim(query_text)) > 0 and length(query_text) <= 300),
  query_kind text not null,
  trade_category text,
  occupation text,
  geography_id text not null,
  geography_tier text not null check (geography_tier in ('HOUSTON_METRO','TEXAS','US_MOBILIZATION')),
  signal_category text not null check (signal_category in ('DIRECT_HIRING','PROJECT_DEMAND','MANPOWER_REQUEST','SUBCONTRACTOR_VENDOR','PROCUREMENT_BID')),
  company_text text,
  status text not null check (status in ('COMPLETED','FAILED','SKIPPED')),
  result_count integer not null default 0 check (result_count >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  failure_classification text,
  executed_at timestamptz not null,
  unique (run_id, position),
  check ((status = 'COMPLETED') = (failure_classification is null))
);

create index discovery_query_executions_cell_idx
  on public.discovery_query_executions(trade_category, signal_category, executed_at desc);
create index discovery_query_executions_run_idx on public.discovery_query_executions(run_id);

alter table public.company_discovery_candidates
  add column query_execution_id uuid references public.discovery_query_executions(id) on delete restrict;

alter table public.opportunity_search_profiles
  add column profile_kind text not null default 'SINGLE_QUERY' check (profile_kind in ('SINGLE_QUERY','MULTI_TRADE_CYCLE')),
  add column queries_per_cycle integer check (queries_per_cycle between 1 and 20);

-- One daily multi-trade cycle replaces the seeded 6-hour single keyword profile (it has no scheduled run
-- history locally). The legacy row is kept, only disabled, so nothing is deleted.
update public.opportunity_search_profiles
   set enabled = false, updated_at = now()
 where profile_kind = 'SINGLE_QUERY' and keyword = 'construction workforce opportunities'
   and company is null and trade_profession is null and location is null;

insert into public.opportunity_search_profiles(keyword, cadence_hours, profile_kind, queries_per_cycle)
values ('Multi-trade discovery cycle', 24, 'MULTI_TRADE_CYCLE', 10);

-- At most one multi-trade cycle may be searching at a time (manual or scheduled).
create unique index company_discovery_one_active_cycle
  on public.company_discovery_runs((true))
  where status = 'SEARCHING' and search_request ? 'cycle';

alter table public.discovery_query_executions enable row level security;
revoke all on public.discovery_query_executions from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.discovery_query_executions from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.discovery_query_executions from authenticated; end if;
end $$;
grant select, insert on public.discovery_query_executions to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.discovery_query_executions for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.discovery_query_executions for insert to fly_workforce_runtime with check (true);

commit;
