begin;

create type ingestion_status as enum (
  'POLICY_DENIED', 'REVIEW_REQUIRED', 'CAPTURE_FAILED',
  'PARSE_FAILED', 'VALIDATION_FAILED', 'SUCCESS'
);
create type ingestion_policy_result as enum ('ALLOW', 'DENY', 'REVIEW_REQUIRED');

alter table demand_signals
  add column original_title text,
  add column unresolved_publisher_name text,
  add column external_posting_id text,
  add column source_identity_key text,
  add column parser_version text,
  add column source_compensation_text text,
  add column normalized_metadata jsonb not null default '{}'::jsonb,
  add constraint demand_signals_identity_key_nonempty_check
    check (source_identity_key is null or length(trim(source_identity_key)) > 0),
  add constraint demand_signals_external_posting_id_nonempty_check
    check (external_posting_id is null or length(trim(external_posting_id)) > 0);

create unique index demand_signals_source_identity_unique_idx
  on demand_signals(source_id, source_identity_key)
  where source_id is not null and source_identity_key is not null;
create index demand_signals_external_posting_idx
  on demand_signals(source_id, external_posting_id)
  where external_posting_id is not null;

create table ingestion_attempts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  requested_method capture_method not null,
  policy_result ingestion_policy_result not null,
  policy_decision_id uuid references source_capture_policy_decisions(id) on delete restrict,
  adapter_id text not null check (length(trim(adapter_id)) > 0),
  requested_target text not null check (length(trim(requested_target)) > 0),
  status ingestion_status not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  raw_evidence_id uuid references raw_evidence(id) on delete restrict,
  demand_signal_id uuid references demand_signals(id) on delete restrict,
  external_posting_id text,
  source_identity_key text,
  failure_reason text,
  parser_version text not null check (length(trim(parser_version)) > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (ended_at >= started_at),
  check (
    (status = 'SUCCESS' and policy_result = 'ALLOW'
      and raw_evidence_id is not null and demand_signal_id is not null and failure_reason is null)
    or
    (status = 'POLICY_DENIED' and policy_result = 'DENY'
      and raw_evidence_id is null and demand_signal_id is null and failure_reason is not null)
    or
    (status = 'REVIEW_REQUIRED' and policy_result = 'REVIEW_REQUIRED'
      and raw_evidence_id is null and demand_signal_id is null and failure_reason is not null)
    or
    (status = 'CAPTURE_FAILED' and policy_result = 'ALLOW'
      and raw_evidence_id is null and demand_signal_id is null and failure_reason is not null)
    or
    (status in ('PARSE_FAILED', 'VALIDATION_FAILED') and policy_result = 'ALLOW'
      and raw_evidence_id is not null and demand_signal_id is null and failure_reason is not null)
  )
);

create function prevent_ingestion_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ingestion_attempts is append-only';
end;
$$;

create trigger ingestion_attempts_append_only
before update or delete on ingestion_attempts
for each row execute function prevent_ingestion_audit_mutation();

create index ingestion_attempts_source_started_idx
  on ingestion_attempts(source_id, started_at desc);
create index ingestion_attempts_status_started_idx
  on ingestion_attempts(status, started_at desc);
create index ingestion_attempts_evidence_idx
  on ingestion_attempts(raw_evidence_id) where raw_evidence_id is not null;
create index ingestion_attempts_signal_idx
  on ingestion_attempts(demand_signal_id) where demand_signal_id is not null;

commit;
