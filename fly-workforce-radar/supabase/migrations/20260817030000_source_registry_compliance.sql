begin;

alter type access_classification add value if not exists 'REQUIRES_LOGIN';
alter type access_classification add value if not exists 'PAYWALLED';

create type capture_method as enum (
  'MANUAL', 'HTTP_FETCH', 'API', 'RSS', 'HEADLESS_RENDER', 'CSV_IMPORT', 'PARTNER_FEED'
);
create type capture_policy_decision as enum ('ALLOWED', 'DENIED', 'REVIEW_REQUIRED');
create type compliance_review_status as enum (
  'NOT_REVIEWED', 'APPROVED', 'RESTRICTED', 'REVIEW_REQUIRED', 'UNKNOWN'
);
create type source_health_status as enum ('HEALTHY', 'DEGRADED', 'BLOCKED', 'UNKNOWN');

create table source_types (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]*$'),
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

insert into source_types (code, is_system) values
  ('JOB_BOARD', true),
  ('CORPORATE_CAREERS', true),
  ('STAFFING_BOARD', true),
  ('SUPPLIER_PORTAL', true),
  ('CORPORATE_WEBSITE', true),
  ('NEWS_PRESS', true),
  ('PUBLIC_RECORD', true),
  ('PUBLIC_SOCIAL', true),
  ('SEARCH_RESULT', true),
  ('OTHER', true);

alter table sources
  add column robots_review_status compliance_review_status not null default 'NOT_REVIEWED',
  add column robots_review_notes text,
  add column tos_review_status compliance_review_status not null default 'NOT_REVIEWED',
  add column tos_review_notes text,
  add column last_compliance_review_at timestamptz,
  add column next_compliance_review_due_at timestamptz,
  add column health_status source_health_status not null default 'UNKNOWN',
  add column source_metadata jsonb not null default '{}'::jsonb,
  add constraint sources_source_type_fk foreign key (source_type) references source_types(code),
  add constraint sources_compliance_review_range_check check (
    next_compliance_review_due_at is null
    or last_compliance_review_at is null
    or next_compliance_review_due_at >= last_compliance_review_at
  );

create table source_capture_policy_decisions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  capture_method capture_method not null,
  decision capture_policy_decision not null,
  reason text not null check (length(trim(reason)) > 0),
  reviewed_at timestamptz not null,
  reviewed_by text not null check (length(trim(reviewed_by)) > 0),
  valid_until timestamptz,
  review_due_at timestamptz,
  policy_version text not null check (length(trim(policy_version)) > 0),
  supersedes_decision_id uuid unique references source_capture_policy_decisions(id) on delete restrict,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= reviewed_at),
  check (review_due_at is null or review_due_at >= reviewed_at),
  check (supersedes_decision_id is null or supersedes_decision_id <> id)
);

create table source_health_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  health_status source_health_status not null,
  observed_at timestamptz not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table source_yield_measurements (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  opportunities_observed integer not null default 0 check (opportunities_observed >= 0),
  validated_signals integer not null default 0 check (validated_signals >= 0),
  verified_contacts integer not null default 0 check (verified_contacts >= 0),
  buyer_routes_found integer not null default 0 check (buyer_routes_found >= 0),
  hot_a_count integer not null default 0 check (hot_a_count >= 0),
  hot_b_count integer not null default 0 check (hot_b_count >= 0),
  noise_count integer not null default 0 check (noise_count >= 0),
  last_measurement_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function prevent_source_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create function apply_source_health_snapshot()
returns trigger
language plpgsql
as $$
begin
  update sources set health_status = new.health_status, updated_at = now()
   where id = new.source_id;
  return new;
end;
$$;

create trigger source_health_snapshot
after insert on source_health_events
for each row execute function apply_source_health_snapshot();

create trigger source_policy_decisions_append_only
before update or delete on source_capture_policy_decisions
for each row execute function prevent_source_audit_mutation();
create trigger source_health_events_append_only
before update or delete on source_health_events
for each row execute function prevent_source_audit_mutation();
create trigger source_yield_measurements_append_only
before update or delete on source_yield_measurements
for each row execute function prevent_source_audit_mutation();

create index source_policy_source_method_reviewed_idx
  on source_capture_policy_decisions(source_id, capture_method, reviewed_at desc, created_at desc);
create index source_policy_supersedes_idx
  on source_capture_policy_decisions(supersedes_decision_id)
  where supersedes_decision_id is not null;
create index source_health_source_observed_idx
  on source_health_events(source_id, observed_at desc);
create index source_yield_source_measured_idx
  on source_yield_measurements(source_id, last_measurement_at desc);
create index sources_compliance_due_idx on sources(enabled, next_compliance_review_due_at);
create index sources_health_status_idx on sources(health_status);

commit;
