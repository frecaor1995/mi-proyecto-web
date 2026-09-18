-- WORKFORCE-TALENT-A2-B: canonical worker schema. Schema-only -- no worker
-- repository/service/UI exists yet, no real worker data is seeded here, and
-- the application runtime (DATABASE_URL) still connects as `postgres`, not
-- `fly_workforce_app`. The grants/policies below establish the intended
-- least-privilege security model ahead of that switch, exactly as the
-- existing taxonomy/demand tables already do for features not yet built.
--
-- Mirrors the shape of the existing canonical demand side
-- (canonical_multi_profession_demand.sql) so a future deterministic matcher
-- compares like-for-like: trade/occupation via the shared workforce_trades/
-- workforce_occupations tables, skills/credentials via workforce_skills/
-- workforce_credentials, REQUIRED/PREFERRED-shaped demand vs. worker facts.
--
-- No worker_demand_match_results (MATCHING-B1), no tenant column, no second
-- taxonomy. workforce_operators is untouched -- operator provisioning
-- remains ADMIN_PROVISIONING_ONLY per SECURITY-RUNTIME-B2's finding.

create table public.workforce_workers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) > 0),
  lifecycle_status text not null default 'ACTIVE' check (lifecycle_status in ('ACTIVE','INACTIVE','ARCHIVED')),
  profile_verification_state text not null default 'UNVERIFIED' check (profile_verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  verified_at timestamptz,
  source_of_record text not null check (source_of_record in ('SELF_REGISTERED','SOURCED','IMPORTED','UNKNOWN')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (profile_verification_state <> 'VERIFIED' or verified_at is not null),
  check (last_seen_at is null or last_seen_at >= first_seen_at)
);

-- Multi-trade: one worker, many trade/occupation rows. No hard-coded
-- electrician assumption -- trade_code/occupation_code are free to be any
-- row from the shared canonical taxonomy.
create table public.worker_trade_occupations (
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  trade_code text not null references public.workforce_trades(code),
  occupation_code text not null references public.workforce_occupations(code),
  role_designation text not null check (role_designation in ('PRIMARY','SECONDARY')),
  experience_months integer check (experience_months >= 0),
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  source_evidence_id uuid references public.raw_evidence(id),
  created_at timestamptz not null default now(),
  primary key (worker_id, occupation_code, trade_code),
  foreign key (occupation_code, trade_code) references public.workforce_occupations(code, trade_code)
);
create unique index worker_trade_occupations_one_primary_idx on public.worker_trade_occupations(worker_id) where role_designation = 'PRIMARY';
create index worker_trade_occupations_trade_occupation_idx on public.worker_trade_occupations(trade_code, occupation_code);

-- Existence-join only, matching demand_skill_requirements' own vocabulary
-- (no graded proficiency -- the demand side never asks for one).
-- self_reported_note is informational only and is never read by any future
-- matching logic; it exists so free text has somewhere to go without ever
-- becoming a canonical matching field.
create table public.worker_skills (
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  skill_code text not null references public.workforce_skills(code),
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  source_evidence_id uuid references public.raw_evidence(id),
  self_reported_note text,
  created_at timestamptz not null default now(),
  primary key (worker_id, skill_code)
);
create index worker_skills_skill_code_idx on public.worker_skills(skill_code);

-- raw_identifier (e.g. a license number) is HIGH-SENSITIVITY PII. It is kept
-- in this table rather than a second one, but is deliberately excluded from
-- the runtime role's SELECT grant below (column-level) -- matching can
-- determine credential_code + verification_state + expires_at without ever
-- reading it back. Any future repository code must select explicit columns
-- here, never `select *`, or it will hit a column-privilege error by design.
create table public.worker_credentials (
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  credential_code text not null references public.workforce_credentials(code),
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  verified_at timestamptz,
  issued_at date,
  expires_at date,
  issuing_authority text,
  raw_identifier text,
  source_evidence_id uuid references public.raw_evidence(id),
  created_at timestamptz not null default now(),
  primary key (worker_id, credential_code),
  check (verification_state <> 'VERIFIED' or verified_at is not null),
  check (expires_at is null or issued_at is null or expires_at >= issued_at)
);
create index worker_credentials_credential_code_idx on public.worker_credentials(credential_code);
create index worker_credentials_expires_at_idx on public.worker_credentials(expires_at) where expires_at is not null;

-- Append-only fact history by design (never UPDATE an existing row -- INSERT
-- a new one), matching the freshness-via-timestamp discipline demand_signals
-- already uses. No row, or status='UNKNOWN', must never be read as
-- UNAVAILABLE by any future matching logic -- that distinction belongs to
-- the matcher (INSUFFICIENT_DATA), not to this table.
create table public.worker_availability (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  status text not null check (status in ('AVAILABLE','COMMITTED','UNAVAILABLE','UNKNOWN')),
  available_from date,
  available_until date,
  source text not null check (source in ('SELF_REPORTED','OPERATOR_ENTERED','INFERRED')),
  effective_at timestamptz not null default now(),
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  created_at timestamptz not null default now(),
  check (available_until is null or available_from is null or available_until >= available_from)
);
create index worker_availability_worker_effective_idx on public.worker_availability(worker_id, effective_at desc);

-- "Current" availability without exposing history-walking to every reader.
create view public.worker_current_availability_v as
  select distinct on (worker_id) worker_id, status, available_from, available_until, source, effective_at, verification_state
  from public.worker_availability
  order by worker_id, effective_at desc;

-- Matching-safe coarse location only. Deliberately no postal_code, no
-- latitude/longitude, no street address -- if precise location is ever
-- justified it belongs in a separate, more restricted table, not here.
-- Versioned (append-only), since a worker's location can change over time.
create table public.worker_locations (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  city text,
  region text,
  country text,
  travel_willing boolean not null default false,
  travel_radius_miles integer check (travel_radius_miles >= 0),
  relocation_willing boolean not null default false,
  effective_at timestamptz not null default now(),
  source text not null check (source in ('SELF_REPORTED','OPERATOR_ENTERED','INFERRED')),
  created_at timestamptz not null default now()
);
create index worker_locations_worker_effective_idx on public.worker_locations(worker_id, effective_at desc);
create index worker_locations_region_city_idx on public.worker_locations(region, city);

-- Explainable experience trail, not an HRIS. employer_label is free text and
-- deliberately not FK'd to companies -- a worker's past employer is not
-- necessarily a tracked demand-side buyer/vendor.
create table public.worker_work_history (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  employer_label text not null check (length(trim(employer_label)) > 0),
  project_label text,
  occupation_code text references public.workforce_occupations(code),
  trade_code text references public.workforce_trades(code),
  start_date date,
  end_date date,
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  source_evidence_id uuid references public.raw_evidence(id),
  created_at timestamptz not null default now(),
  foreign key (occupation_code, trade_code) references public.workforce_occupations(code, trade_code),
  check (occupation_code is null or trade_code is not null),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index worker_work_history_worker_idx on public.worker_work_history(worker_id);

-- HIGH-SENSITIVITY worker data. Never reuses contact_routes (that table's
-- company_id-not-null shape structurally assumes a company-owned contact).
-- Fail-closed: any future outreach action must treat consent_state <>
-- 'GRANTED' -- including 'UNKNOWN' -- as "do not contact". Unknown consent
-- is never implicit permission.
create table public.worker_contact_routes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  route_type text not null check (route_type in ('PHONE','EMAIL','SMS','OTHER')),
  target text not null check (length(trim(target)) > 0),
  preferred boolean not null default false,
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  consent_state text not null default 'UNKNOWN' check (consent_state in ('GRANTED','REVOKED','UNKNOWN')),
  consent_captured_at timestamptz,
  consent_source text,
  lifecycle_status text not null default 'ACTIVE' check (lifecycle_status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, route_type, target),
  check (consent_state <> 'GRANTED' or consent_captured_at is not null)
);
create index worker_contact_routes_worker_idx on public.worker_contact_routes(worker_id);

-- COMMERCIAL-SENSITIVE. Flexible across hourly/daily/salary/project without
-- building payroll. Versioned/history like availability -- append a new row
-- rather than mutating a prior expectation. Matching hardness (whether a
-- worker's rate_min above an offered rate is disqualifying) is intentionally
-- NOT encoded here -- that is a future matching-engine decision, not a
-- schema constraint. Known gap: demand_signals' canonical extension has no
-- pay/rate/per-diem column at all today (the only such fields, `pay`/
-- `perDiem`, live on the @deprecated WorkforceDemandRecord compatibility
-- façade in multi-trade-workforce.ts, not on the durable canonical model) --
-- so end-to-end compensation matching remains blocked on a demand-side gap
-- outside this migration's scope. Not solved here.
create table public.worker_compensation_expectations (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  rate_type text not null check (rate_type in ('HOURLY','DAILY','SALARY','PROJECT')),
  rate_min numeric check (rate_min >= 0),
  rate_preferred numeric check (rate_preferred >= 0),
  currency text not null default 'USD',
  per_diem_required boolean,
  overtime_expectation text,
  travel_pay_expectation text,
  negotiable boolean not null default true,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (rate_preferred is null or rate_min is null or rate_preferred >= rate_min)
);
create index worker_compensation_expectations_worker_effective_idx on public.worker_compensation_expectations(worker_id, effective_at desc);

-- Known, documented gap (not solved here): no worker-side field represents
-- shift preference or maximum hours/week capacity anywhere in this schema.
-- demand_signals carries shift/hours_per_day/hours_per_week; the worker side
-- has no counterpart yet. Left for a future, separately authorized addition.

-- RLS: enabled on every worker table, with explicit fly_workforce_runtime-
-- scoped policies from the start -- never "enabled with zero policy". No
-- policy or grant here ever names anon, authenticated, or PUBLIC.
alter table public.workforce_workers enable row level security;
alter table public.worker_trade_occupations enable row level security;
alter table public.worker_skills enable row level security;
alter table public.worker_credentials enable row level security;
alter table public.worker_availability enable row level security;
alter table public.worker_locations enable row level security;
alter table public.worker_work_history enable row level security;
alter table public.worker_contact_routes enable row level security;
alter table public.worker_compensation_expectations enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on
      public.workforce_workers, public.worker_trade_occupations, public.worker_skills,
      public.worker_credentials, public.worker_availability, public.worker_locations,
      public.worker_work_history, public.worker_contact_routes, public.worker_compensation_expectations,
      public.worker_current_availability_v
    from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on
      public.workforce_workers, public.worker_trade_occupations, public.worker_skills,
      public.worker_credentials, public.worker_availability, public.worker_locations,
      public.worker_work_history, public.worker_contact_routes, public.worker_compensation_expectations,
      public.worker_current_availability_v
    from authenticated;
  end if;
end $$;

-- worker_profile.* tier: workforce_workers, worker_trade_occupations,
-- worker_skills, worker_work_history are ordinary mutable facts.
grant select, insert, update on public.workforce_workers to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.workforce_workers for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.workforce_workers for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_update on public.workforce_workers for update to fly_workforce_runtime using (true) with check (true);

grant select, insert, update on public.worker_trade_occupations to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.worker_trade_occupations for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_trade_occupations for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_update on public.worker_trade_occupations for update to fly_workforce_runtime using (true) with check (true);

grant select, insert, update on public.worker_skills to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.worker_skills for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_skills for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_update on public.worker_skills for update to fly_workforce_runtime using (true) with check (true);

grant select, insert, update on public.worker_work_history to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.worker_work_history for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_work_history for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_update on public.worker_work_history for update to fly_workforce_runtime using (true) with check (true);

-- worker_credentials: column-scoped SELECT excludes raw_identifier.
-- INSERT/UPDATE include it -- capturing/correcting it is normal intake, the
-- restriction is specifically about broad read-back exposure.
grant select (worker_id, credential_code, verification_state, verified_at, issued_at, expires_at, issuing_authority, source_evidence_id, created_at) on public.worker_credentials to fly_workforce_runtime;
grant insert (worker_id, credential_code, verification_state, verified_at, issued_at, expires_at, issuing_authority, raw_identifier, source_evidence_id, created_at) on public.worker_credentials to fly_workforce_runtime;
grant update (verification_state, verified_at, issued_at, expires_at, issuing_authority, raw_identifier, source_evidence_id) on public.worker_credentials to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.worker_credentials for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_credentials for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_update on public.worker_credentials for update to fly_workforce_runtime using (true) with check (true);

-- worker_availability / worker_locations / worker_compensation_expectations:
-- append-only history by design -- select+insert only, no update grant.
grant select, insert on public.worker_availability to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.worker_availability for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_availability for insert to fly_workforce_runtime with check (true);
grant select on public.worker_current_availability_v to fly_workforce_runtime;

grant select, insert on public.worker_locations to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.worker_locations for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_locations for insert to fly_workforce_runtime with check (true);

grant select, insert on public.worker_compensation_expectations to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.worker_compensation_expectations for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_compensation_expectations for insert to fly_workforce_runtime with check (true);

-- worker_contact.* tier: HIGH-SENSITIVITY, kept as its own conceptual
-- permission boundary even though it shares the same DB role today. Needs
-- UPDATE (consent_state/lifecycle_status change over time).
grant select, insert, update on public.worker_contact_routes to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.worker_contact_routes for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_contact_routes for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_update on public.worker_contact_routes for update to fly_workforce_runtime using (true) with check (true);
