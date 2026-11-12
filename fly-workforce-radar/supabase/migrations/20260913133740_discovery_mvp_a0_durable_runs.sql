begin;

create type company_discovery_trigger_kind as enum ('MANUAL', 'SCHEDULED');
create type company_discovery_target_resolution_state as enum (
  'UNRESOLVED', 'MATCHED_EXISTING', 'AMBIGUOUS', 'CONFIRMED'
);
create type company_discovery_run_status as enum (
  'SEARCHING', 'COMPLETED', 'PARTIAL', 'FAILED'
);
create type company_discovery_source_status as enum (
  'SELECTED', 'SEARCHING', 'COMPLETED', 'FAILED', 'SKIPPED'
);

create table company_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by_operator_id uuid not null references workforce_operators(id) on delete restrict,
  trigger_kind company_discovery_trigger_kind not null,
  target_text text not null check (length(trim(target_text)) > 0),
  normalized_target_text text not null check (
    length(trim(normalized_target_text)) > 0
    and normalized_target_text = lower(trim(normalized_target_text))
  ),
  target_resolution_state company_discovery_target_resolution_state not null default 'UNRESOLVED',
  resolved_company_id uuid references companies(id) on delete restrict,
  status company_discovery_run_status not null default 'SEARCHING',
  started_at timestamptz not null,
  completed_at timestamptz,
  findings_count bigint not null default 0 check (findings_count >= 0),
  evidence_count bigint not null default 0 check (evidence_count >= 0),
  duplicates_suppressed_count bigint not null default 0 check (duplicates_suppressed_count >= 0),
  opportunities_created_count bigint not null default 0 check (opportunities_created_count >= 0),
  opportunities_updated_count bigint not null default 0 check (opportunities_updated_count >= 0),
  sanitized_failure jsonb,
  correlation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint company_discovery_runs_resolution_check check (
    (target_resolution_state in ('MATCHED_EXISTING', 'CONFIRMED') and resolved_company_id is not null)
    or (target_resolution_state in ('UNRESOLVED', 'AMBIGUOUS') and resolved_company_id is null)
  ),
  constraint company_discovery_runs_completion_check check (
    (status = 'SEARCHING' and completed_at is null)
    or (status <> 'SEARCHING' and completed_at is not null and completed_at >= started_at)
  ),
  constraint company_discovery_runs_failure_check check (
    (status in ('PARTIAL', 'FAILED') and sanitized_failure is not null)
    or (status in ('SEARCHING', 'COMPLETED') and sanitized_failure is null)
  ),
  constraint company_discovery_runs_failure_shape_check check (
    sanitized_failure is null or (
      jsonb_typeof(sanitized_failure) = 'object'
      and sanitized_failure ? 'classification'
      and sanitized_failure ? 'message'
      and not sanitized_failure ?| array[
        'password', 'password_hash', 'token', 'access_token', 'refresh_token',
        'jwt', 'secret', 'api_key', 'service_role_key', 'connection_string', 'database_url'
      ]
    )
  ),
  constraint company_discovery_runs_correlation_shape_check
    check (jsonb_typeof(correlation_metadata) = 'object')
);

-- Composite keys below let run-source rows prove that linked executions and
-- ingestion attempts belong to the selected source, not merely that they exist.
alter table production_source_executions
  add constraint production_source_executions_id_source_unique unique (id, source_id);
alter table ingestion_attempts
  add constraint ingestion_attempts_id_source_unique unique (id, source_id);

create table company_discovery_run_sources (
  run_id uuid not null references company_discovery_runs(id) on delete cascade,
  source_id uuid not null references sources(id) on delete restrict,
  production_execution_id uuid,
  ingestion_attempt_id uuid,
  status company_discovery_source_status not null default 'SELECTED',
  findings_count bigint not null default 0 check (findings_count >= 0),
  evidence_count bigint not null default 0 check (evidence_count >= 0),
  duplicates_suppressed_count bigint not null default 0 check (duplicates_suppressed_count >= 0),
  sanitized_failure jsonb,
  created_at timestamptz not null default now(),
  primary key (run_id, source_id),
  constraint company_discovery_run_sources_execution_fk
    foreign key (production_execution_id, source_id)
    references production_source_executions(id, source_id) on delete restrict,
  constraint company_discovery_run_sources_ingestion_fk
    foreign key (ingestion_attempt_id, source_id)
    references ingestion_attempts(id, source_id) on delete restrict,
  constraint company_discovery_run_sources_failure_check check (
    (status = 'FAILED' and sanitized_failure is not null)
    or (status <> 'FAILED' and sanitized_failure is null)
  ),
  constraint company_discovery_run_sources_failure_shape_check check (
    sanitized_failure is null or (
      jsonb_typeof(sanitized_failure) = 'object'
      and sanitized_failure ? 'classification'
      and sanitized_failure ? 'message'
      and not sanitized_failure ?| array[
        'password', 'password_hash', 'token', 'access_token', 'refresh_token',
        'jwt', 'secret', 'api_key', 'service_role_key', 'connection_string', 'database_url'
      ]
    )
  )
);

create function enforce_company_discovery_run_transition()
returns trigger language plpgsql as $$
begin
  if old.status <> new.status and not (
    old.status = 'SEARCHING' and new.status in ('COMPLETED', 'PARTIAL', 'FAILED')
  ) then
    raise exception 'illegal company discovery run status transition: % -> %', old.status, new.status;
  end if;

  if old.target_resolution_state <> new.target_resolution_state and not (
    (old.target_resolution_state = 'UNRESOLVED' and new.target_resolution_state in ('MATCHED_EXISTING', 'AMBIGUOUS', 'CONFIRMED'))
    or (old.target_resolution_state = 'AMBIGUOUS' and new.target_resolution_state in ('UNRESOLVED', 'MATCHED_EXISTING', 'CONFIRMED'))
    or (old.target_resolution_state = 'MATCHED_EXISTING' and new.target_resolution_state in ('AMBIGUOUS', 'CONFIRMED'))
  ) then
    raise exception 'illegal company discovery target transition: % -> %', old.target_resolution_state, new.target_resolution_state;
  end if;

  return new;
end;
$$;

create trigger company_discovery_runs_transition_guard
before update on company_discovery_runs
for each row execute function enforce_company_discovery_run_transition();

create function enforce_company_discovery_source_transition()
returns trigger language plpgsql as $$
begin
  if old.status <> new.status and not (
    (old.status = 'SELECTED' and new.status in ('SEARCHING', 'FAILED', 'SKIPPED'))
    or (old.status = 'SEARCHING' and new.status in ('COMPLETED', 'FAILED', 'SKIPPED'))
  ) then
    raise exception 'illegal company discovery source status transition: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger company_discovery_run_sources_transition_guard
before update on company_discovery_run_sources
for each row execute function enforce_company_discovery_source_transition();

create index company_discovery_runs_operator_started_idx
  on company_discovery_runs(requested_by_operator_id, started_at desc);
create index company_discovery_runs_status_started_idx
  on company_discovery_runs(status, started_at desc);
create index company_discovery_runs_resolved_company_idx
  on company_discovery_runs(resolved_company_id)
  where resolved_company_id is not null;
create index company_discovery_run_sources_source_idx
  on company_discovery_run_sources(source_id, created_at desc);
create unique index company_discovery_run_sources_execution_unique_idx
  on company_discovery_run_sources(production_execution_id)
  where production_execution_id is not null;
create unique index company_discovery_run_sources_ingestion_unique_idx
  on company_discovery_run_sources(ingestion_attempt_id)
  where ingestion_attempt_id is not null;

alter table company_discovery_runs enable row level security;
alter table company_discovery_run_sources enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on company_discovery_runs from anon;
    revoke all on company_discovery_run_sources from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on company_discovery_runs from authenticated;
    revoke all on company_discovery_run_sources from authenticated;
  end if;
end;
$$;

commit;
