-- Discovery Intelligence 1.0 (LOCAL, additive).
-- Recipes and watches coordinate the existing Discovery pipeline. They are configuration/state,
-- never canonical evidence and never promote opportunities automatically.
begin;

create table public.discovery_recipes (
  id uuid primary key default gen_random_uuid(),
  recipe_key text not null,
  version integer not null check (version > 0),
  strategy_kind text not null check (strategy_kind in (
    'AGGREGATOR_SEARCH','STAFFING_AGENCY_WATCH','ATS_CAREER_DISCOVERY','SPECIALIZED_TRADE_SOURCE',
    'PROJECT_WORKFORCE_DISCOVERY','CONTRACTOR_REGISTRY','APPRENTICESHIP_SCHOOL','PUBLIC_COMMUNITY','WORKER_REFERRAL')),
  name text not null check (length(name) between 1 and 160),
  profession_scope jsonb not null default '{}'::jsonb check (jsonb_typeof(profession_scope) = 'object'),
  level_vocabulary jsonb not null default '{}'::jsonb check (jsonb_typeof(level_vocabulary) = 'object'),
  geography_scope jsonb not null default '{}'::jsonb check (jsonb_typeof(geography_scope) = 'object'),
  query_templates jsonb not null default '[]'::jsonb check (jsonb_typeof(query_templates) = 'array'),
  source_constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(source_constraints) = 'object'),
  execution_budget integer not null check (execution_budget between 1 and 20),
  reuse_window_hours integer not null check (reuse_window_hours between 1 and 720),
  cadence_hours integer check (cadence_hours is null or cadence_hours between 1 and 8760),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (recipe_key, version)
);

insert into public.discovery_recipes(
  recipe_key,version,strategy_kind,name,profession_scope,level_vocabulary,geography_scope,
  query_templates,source_constraints,execution_budget,reuse_window_hours,cadence_hours
) values
(
  'electrical-entry-staffing-texas',1,'STAFFING_AGENCY_WATCH','Electrical entry-level · staffing · Texas',
  '{"trade":"ELECTRICAL","occupation_family":"ENTRY_LEVEL_ELECTRICAL"}',
  '{"apprentice":["apprentice electrician","electrical apprentice","experienced apprentice","commercial apprentice","service apprentice","wireman apprentice","will train","entry level"],"helper":["electrician helper","electrical helper"],"mixed":["apprentice/journeyman","apprentice or journeyman"]}',
  '{"country":"US","state":"TX","metro":"Houston"}',
  '["\"apprentice electrician\" (staffing OR personnel OR workforce OR recruiting) (Houston OR Texas)","\"electrical helper\" (staffing OR personnel OR workforce OR recruiting) (Houston OR Texas)","\"experienced apprentice\" electrician (staffing OR recruiting) Texas","\"commercial apprentice\" electrician (staffing OR recruiting) Texas","\"apprentice or journeyman\" electrician (staffing OR recruiting) Texas"]',
  '{"public_indexed_only":true,"query_words_are_not_evidence":true}',5,24,24
),
(
  'electrical-entry-ats-texas',1,'ATS_CAREER_DISCOVERY','Electrical entry-level · ATS/careers · Texas',
  '{"trade":"ELECTRICAL","occupation_family":"ENTRY_LEVEL_ELECTRICAL"}',
  '{"apprentice":["apprentice electrician","electrical apprentice","experienced apprentice","commercial apprentice","service apprentice","wireman apprentice","will train","entry level"],"helper":["electrician helper","electrical helper"],"mixed":["apprentice/journeyman","apprentice or journeyman"]}',
  '{"country":"US","state":"TX","metro":"Houston"}',
  '["\"apprentice electrician\" Texas (site:jobs.lever.co OR site:apply.workable.com OR site:icims.com)","\"electrical helper\" Houston (site:myworkdayjobs.com OR site:greenhouse.io OR site:paylocity.com)","\"experienced apprentice\" electrician Texas careers","\"commercial apprentice\" electrician Texas careers","\"apprentice or journeyman\" electrician Texas careers"]',
  '{"public_indexed_only":true,"platform_detection_from_url":true,"query_words_are_not_evidence":true}',5,48,48
);

create table public.discovery_watch_sources (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  recipe_id uuid references public.discovery_recipes(id) on delete restrict,
  strategy_kind text not null check (strategy_kind in ('STAFFING_AGENCY_WATCH','ATS_CAREER_DISCOVERY')),
  source_url text not null check (source_url ~ '^https://'),
  normalized_source_url text not null,
  source_type text not null check (source_type in ('COMPANY_CAREERS','STAFFING_JOB_BOARD','ATS_PUBLIC_BOARD','OTHER_APPROVED_PUBLIC_SOURCE')),
  platform text,
  automation_policy text not null check (automation_policy in ('AUTOMATABLE','PARTIALLY_AUTOMATABLE','MANUAL_FIRST','NOT_APPROPRIATE_FOR_AUTOMATION')),
  allowed_method text not null,
  policy_reason text not null check (length(policy_reason) between 1 and 1000),
  policy_reviewed_at timestamptz not null,
  watch_tier text not null check (watch_tier in ('A','B','C')),
  cadence_hours integer not null check (cadence_hours between 1 and 8760),
  priority_reason text,
  enabled boolean not null default true,
  baseline_established_at timestamptz,
  last_attempted_at timestamptz,
  last_successful_at timestamptz,
  next_eligible_at timestamptz not null,
  last_failure text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  health_status text not null default 'UNKNOWN' check (health_status in ('UNKNOWN','HEALTHY','DEGRADED','NEEDS_REVIEW','DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_source_url)
);

create table public.discovery_watch_observations (
  id uuid primary key default gen_random_uuid(),
  watch_source_id uuid not null references public.discovery_watch_sources(id) on delete restrict,
  observation_identity text not null,
  normalized_url text not null,
  external_posting_id text,
  content_hash text,
  state text not null check (state in ('BASELINE','NEW','STILL_OBSERVED','NO_LONGER_OBSERVED')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  published_at timestamptz,
  captured_at timestamptz not null,
  candidate_id uuid references public.company_discovery_candidates(id) on delete restrict,
  evidence_id uuid references public.raw_evidence(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (watch_source_id, observation_identity, captured_at),
  check (last_seen_at >= first_seen_at)
);
create index discovery_watch_current_idx on public.discovery_watch_observations(watch_source_id, observation_identity, captured_at desc);

create table public.discovery_manual_misses (
  id uuid primary key default gen_random_uuid(),
  found_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  recorded_by_operator_id uuid not null references public.workforce_operators(id) on delete restrict,
  strategy_kind text not null,
  summary text not null check (length(summary) between 1 and 1000),
  company_text text,
  source_text text not null,
  source_url text check (source_url is null or source_url ~ '^https://'),
  profession_text text,
  level_text text,
  location_text text,
  project_text text,
  discovery_method text not null,
  query_text text,
  notes text,
  benchmark_key text,
  matched_candidate_id uuid references public.company_discovery_candidates(id) on delete restrict,
  check (notes is null or length(notes) <= 4000)
);

alter table public.discovery_query_executions
  add column recipe_id uuid references public.discovery_recipes(id) on delete restrict,
  add column strategy_kind text,
  add column reused_execution_id uuid references public.discovery_query_executions(id) on delete restrict,
  add column skip_reason text;

alter table public.company_discovery_candidates
  add column recipe_id uuid references public.discovery_recipes(id) on delete restrict,
  add column strategy_kind text,
  add column watch_source_id uuid references public.discovery_watch_sources(id) on delete restrict,
  add column observation_state text check (observation_state is null or observation_state in ('BASELINE','NEW','STILL_OBSERVED','NO_LONGER_OBSERVED')),
  add column observation_first_seen_at timestamptz,
  add column observation_last_seen_at timestamptz,
  add column documented_published_at timestamptz;

do $$ declare t text; begin
  foreach t in array array['discovery_recipes','discovery_watch_sources','discovery_watch_observations','discovery_manual_misses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on table public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on table public.%I from authenticated', t); end if;
    execute format('grant select, insert, update on table public.%I to fly_workforce_runtime', t);
    execute format('create policy fly_workforce_runtime_select on public.%I for select to fly_workforce_runtime using (true)', t);
    execute format('create policy fly_workforce_runtime_insert on public.%I for insert to fly_workforce_runtime with check (true)', t);
    execute format('create policy fly_workforce_runtime_update on public.%I for update to fly_workforce_runtime using (true) with check (true)', t);
  end loop;
end $$;

commit;
