-- Phase 1.3: human-reviewed Discovery quantity facts and canonical demand linkage.
-- Additive only. Existing observations are intentionally not backfilled or reinterpreted.
begin;

alter type public.human_verification_target_type add value if not exists 'DISCOVERY_QUANTITY';
alter type public.human_verification_target_type add value if not exists 'DEMAND_SIGNAL';

commit;
begin;

alter table public.company_resolution_audits
  add column discovery_candidate_id uuid references public.company_discovery_candidates(id) on delete restrict,
  add column discovery_watch_observation_id uuid references public.discovery_watch_observations(id) on delete restrict;

create index company_resolution_discovery_candidate_idx
  on public.company_resolution_audits(discovery_candidate_id,resolved_at desc)
  where discovery_candidate_id is not null;
create index company_resolution_discovery_observation_idx
  on public.company_resolution_audits(discovery_watch_observation_id,resolved_at desc)
  where discovery_watch_observation_id is not null;

create table public.discovery_quantity_observations(
  id uuid primary key default gen_random_uuid(),
  discovery_watch_observation_id uuid not null references public.discovery_watch_observations(id) on delete restrict,
  candidate_id uuid not null references public.company_discovery_candidates(id) on delete restrict,
  quantity_type text not null check(quantity_type in(
    'AGGREGATE_MARKET_COUNT','POSTING_COUNT','EXPLICIT_EMPLOYER_HEADCOUNT','AMBIGUOUS_QUANTITY','NOT_A_WORKFORCE_QUANTITY'
  )),
  quantity_value integer check(quantity_value is null or quantity_value > 0),
  quantity_scope text not null check(quantity_scope in('MARKET_SEARCH_RESULTS','DISTINCT_POSTINGS','EMPLOYER_WORKERS','UNKNOWN')),
  source_excerpt text not null check(length(trim(source_excerpt)) between 1 and 1000),
  evidence_id uuid references public.raw_evidence(id) on delete restrict,
  extraction_method text not null check(extraction_method in('DETERMINISTIC_RULE','HUMAN_REVIEW')),
  extraction_rule_version text not null check(length(trim(extraction_rule_version)) between 1 and 100),
  verification_state public.verification_state not null default 'UNVERIFIED',
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check(last_observed_at >= first_observed_at),
  check(quantity_type <> 'AGGREGATE_MARKET_COUNT' or quantity_scope = 'MARKET_SEARCH_RESULTS'),
  check(quantity_type <> 'POSTING_COUNT' or quantity_scope = 'DISTINCT_POSTINGS'),
  check(quantity_type <> 'EXPLICIT_EMPLOYER_HEADCOUNT' or quantity_scope = 'EMPLOYER_WORKERS'),
  check(verification_state <> 'VERIFIED' or evidence_id is not null)
);

create unique index discovery_quantity_observation_identity_idx on public.discovery_quantity_observations(
  discovery_watch_observation_id,quantity_type,quantity_scope,coalesce(quantity_value,-1),extraction_rule_version
);
create index discovery_quantity_candidate_idx on public.discovery_quantity_observations(candidate_id,created_at desc);
create index discovery_quantity_type_idx on public.discovery_quantity_observations(quantity_type,verification_state);

create table public.discovery_observation_demand_signals(
  id uuid primary key default gen_random_uuid(),
  discovery_watch_observation_id uuid not null references public.discovery_watch_observations(id) on delete restrict,
  candidate_id uuid not null references public.company_discovery_candidates(id) on delete restrict,
  demand_signal_id uuid not null references public.demand_signals(id) on delete restrict,
  company_resolution_audit_id uuid not null references public.company_resolution_audits(id) on delete restrict,
  quantity_observation_id uuid references public.discovery_quantity_observations(id) on delete restrict,
  linked_by_operator_id uuid not null references public.workforce_operators(id) on delete restrict,
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(discovery_watch_observation_id),
  unique(demand_signal_id)
);

create index discovery_demand_candidate_idx on public.discovery_observation_demand_signals(candidate_id);
create index discovery_demand_link_idx on public.discovery_observation_demand_signals(demand_signal_id);

create function public.prevent_discovery_review_artifact_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception '% is append-only',tg_table_name;
end;
$$;

create trigger discovery_quantity_observations_append_only
before update or delete on public.discovery_quantity_observations
for each row execute function public.prevent_discovery_review_artifact_mutation();
create trigger discovery_observation_demand_signals_append_only
before update or delete on public.discovery_observation_demand_signals
for each row execute function public.prevent_discovery_review_artifact_mutation();

alter table public.discovery_quantity_observations enable row level security;
alter table public.discovery_observation_demand_signals enable row level security;
revoke all on public.discovery_quantity_observations from public;
revoke all on public.discovery_observation_demand_signals from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on public.discovery_quantity_observations from anon;
    revoke all on public.discovery_observation_demand_signals from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on public.discovery_quantity_observations from authenticated;
    revoke all on public.discovery_observation_demand_signals from authenticated;
  end if;
end $$;
revoke all on function public.prevent_discovery_review_artifact_mutation() from public;
grant execute on function public.prevent_discovery_review_artifact_mutation() to fly_workforce_runtime;
grant select,insert on public.discovery_quantity_observations to fly_workforce_runtime;
grant select,insert on public.discovery_observation_demand_signals to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.discovery_quantity_observations for select to fly_workforce_runtime using(true);
create policy fly_workforce_runtime_insert on public.discovery_quantity_observations for insert to fly_workforce_runtime with check(true);
create policy fly_workforce_runtime_select on public.discovery_observation_demand_signals for select to fly_workforce_runtime using(true);
create policy fly_workforce_runtime_insert on public.discovery_observation_demand_signals for insert to fly_workforce_runtime with check(true);

commit;
