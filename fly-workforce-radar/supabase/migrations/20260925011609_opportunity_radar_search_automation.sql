begin;

insert into public.sources(
  id,name,source_type,domain,base_url,access_classification,allowed_capture_methods,
  requires_auth,paywalled,enabled,robots_review_status,tos_review_status,health_status,source_metadata
) values (
  '30000000-0000-4000-8000-000000000002','Brave Web Search API','SEARCH_RESULT',
  'api.search.brave.com','https://api.search.brave.com','ACCOUNT_REQUIRED',array['API'],
  true,false,true,'APPROVED','APPROVED','UNKNOWN',
  '{"role":"URL_DISCOVERY_ONLY","canonical_evidence":false}'::jsonb
) on conflict(id) do nothing;

create table public.opportunity_search_profiles (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default true,
  company text,
  keyword text,
  trade_profession text,
  location text,
  cadence_hours integer not null default 6 check (cadence_hours in (6,12,24)),
  next_run_at timestamptz not null default date_trunc('hour', now()),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(company,keyword,trade_profession,location) > 0)
);

insert into public.opportunity_search_profiles(keyword,cadence_hours)
values ('construction workforce opportunities',6);

alter table public.company_discovery_runs
  alter column requested_by_operator_id drop not null,
  add column search_profile_id uuid references public.opportunity_search_profiles(id) on delete restrict,
  add column search_request jsonb,
  add column schedule_window timestamptz,
  add constraint company_discovery_run_actor_check check (
    (trigger_kind='MANUAL' and requested_by_operator_id is not null and search_profile_id is null and schedule_window is null)
    or (trigger_kind='SCHEDULED' and requested_by_operator_id is null and search_profile_id is not null and schedule_window is not null)
  ),
  add constraint company_discovery_search_request_check check (
    search_request is null or (jsonb_typeof(search_request)='object' and search_request <> '{}'::jsonb)
  );

create unique index company_discovery_scheduled_window_unique
  on public.company_discovery_runs(search_profile_id,schedule_window)
  where trigger_kind='SCHEDULED';

create table public.company_discovery_candidate_fingerprints (
  provider text not null,
  normalized_candidate_url text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  seen_count bigint not null default 1 check (seen_count > 0),
  primary key(provider,normalized_candidate_url)
);

insert into public.company_discovery_candidate_fingerprints(
  provider,normalized_candidate_url,first_seen_at,last_seen_at,seen_count
)
select 'BRAVE_WEB_SEARCH',normalized_candidate_url,min(created_at),max(created_at),count(*)
from public.company_discovery_candidates
group by normalized_candidate_url;

alter table public.company_discovery_candidates
  add column previously_seen boolean not null default false;

alter table public.opportunity_search_profiles enable row level security;
alter table public.company_discovery_candidate_fingerprints enable row level security;
revoke all on public.opportunity_search_profiles from anon,authenticated;
revoke all on public.company_discovery_candidate_fingerprints from anon,authenticated;
grant select,insert,update on public.opportunity_search_profiles to fly_workforce_runtime;
grant select,insert,update on public.company_discovery_candidate_fingerprints to fly_workforce_runtime;
grant select,insert,update on public.company_discovery_runs to fly_workforce_runtime;
grant select,insert,update on public.company_discovery_run_sources to fly_workforce_runtime;
grant select,insert,update on public.company_discovery_candidates to fly_workforce_runtime;
create policy fly_workforce_runtime_all on public.opportunity_search_profiles for all to fly_workforce_runtime using (true) with check (true);
create policy fly_workforce_runtime_all on public.company_discovery_candidate_fingerprints for all to fly_workforce_runtime using (true) with check (true);

commit;
