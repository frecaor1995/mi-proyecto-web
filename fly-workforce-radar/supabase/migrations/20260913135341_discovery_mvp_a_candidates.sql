begin;

alter table company_discovery_runs add column request_key uuid;
update company_discovery_runs set request_key = gen_random_uuid() where request_key is null;
alter table company_discovery_runs alter column request_key set not null;
alter table company_discovery_runs alter column request_key set default gen_random_uuid();
alter table company_discovery_runs
  add constraint company_discovery_runs_operator_request_unique
  unique (requested_by_operator_id, request_key);

create table company_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  discovery_source_id uuid not null,
  query_kind text not null check (query_kind in (
    'EXACT_COMPANY', 'PROJECTS', 'ELECTRICAL_HIRING', 'WORKFORCE',
    'CONSTRUCTION', 'PROCUREMENT', 'TEXAS', 'DISCOVERED_LOCATION'
  )),
  title text not null check (length(trim(title)) > 0),
  candidate_url text not null check (length(trim(candidate_url)) > 0),
  normalized_candidate_url text not null check (length(trim(normalized_candidate_url)) > 0),
  source_domain text not null check (length(trim(source_domain)) > 0),
  provider_description text,
  relevance_reason text not null check (length(trim(relevance_reason)) > 0),
  provider_rank integer not null check (provider_rank between 1 and 20),
  provider_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_metadata) = 'object'),
  canonical_evidence_id uuid references raw_evidence(id) on delete restrict,
  duplicate_of_candidate_id uuid references company_discovery_candidates(id) on delete restrict,
  correlated_company_id uuid references companies(id) on delete restrict,
  correlated_project_id uuid references projects(id) on delete restrict,
  correlated_opportunity_id uuid references opportunities(id) on delete restrict,
  human_review_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (run_id, normalized_candidate_url),
  foreign key (run_id, discovery_source_id)
    references company_discovery_run_sources(run_id, source_id) on delete cascade,
  check (duplicate_of_candidate_id is null or duplicate_of_candidate_id <> id),
  check (correlated_opportunity_id is null or canonical_evidence_id is not null)
);

create index company_discovery_candidates_run_idx
  on company_discovery_candidates(run_id, provider_rank, created_at);
create index company_discovery_candidates_evidence_idx
  on company_discovery_candidates(canonical_evidence_id)
  where canonical_evidence_id is not null;
create index company_discovery_candidates_company_idx
  on company_discovery_candidates(correlated_company_id)
  where correlated_company_id is not null;
create index company_discovery_candidates_project_idx
  on company_discovery_candidates(correlated_project_id)
  where correlated_project_id is not null;
create index company_discovery_candidates_opportunity_idx
  on company_discovery_candidates(correlated_opportunity_id)
  where correlated_opportunity_id is not null;

alter table company_discovery_candidates enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on company_discovery_candidates from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on company_discovery_candidates from authenticated;
  end if;
end;
$$;

commit;
