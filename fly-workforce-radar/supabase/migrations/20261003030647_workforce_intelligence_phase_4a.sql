-- PHASE 4A: additive Workforce Intelligence facts. Existing worker rows are
-- intentionally not backfilled: absence remains UNKNOWN, never an invented NO.

create table public.workforce_levels (
  code text primary key,
  label_en text not null,
  label_es text not null,
  trade_code text references public.workforce_trades(code),
  active boolean not null default true
);

insert into public.workforce_levels(code,label_en,label_es,trade_code) values
  ('APPRENTICE','Apprentice','Aprendiz',null),
  ('JOURNEYMAN','Journeyman','Oficial',null),
  ('MASTER','Master','Maestro',null),
  ('FOREMAN','Foreman','Capataz',null),
  ('TECHNICIAN','Technician','Tecnico',null),
  ('HELPER','Helper','Ayudante',null),
  ('OTHER','Other','Otro',null);

create table public.worker_level_assignments (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  trade_code text references public.workforce_trades(code),
  occupation_code text references public.workforce_occupations(code),
  level_code text not null references public.workforce_levels(code),
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  source text not null check (source in ('SELF_REPORTED','OPERATOR_ENTERED','INFERRED')),
  source_evidence_id uuid references public.raw_evidence(id),
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (occupation_code,trade_code) references public.workforce_occupations(code,trade_code),
  check (occupation_code is null or trade_code is not null)
);
create index worker_level_assignments_current_idx on public.worker_level_assignments(worker_id,effective_at desc);

-- Credential identity becomes instance-based. raw_identifier remains excluded
-- from normal runtime SELECT grants.
alter table public.worker_credentials drop constraint worker_credentials_pkey;
alter table public.worker_credentials add column id uuid default gen_random_uuid();
update public.worker_credentials set id=gen_random_uuid() where id is null;
alter table public.worker_credentials alter column id set not null;
alter table public.worker_credentials add constraint worker_credentials_pkey primary key(id);
alter table public.worker_credentials add column jurisdiction text,
  add column lifecycle_status text not null default 'CURRENT' check (lifecycle_status in ('CURRENT','SUPERSEDED','REVOKED','UNKNOWN'));
create unique index worker_credentials_instance_identity_idx on public.worker_credentials
  (worker_id,credential_code,coalesce(jurisdiction,''),coalesce(issuing_authority,''),coalesce(issued_at,'0001-01-01'::date),coalesce(raw_identifier,''));
create index worker_credentials_worker_code_idx on public.worker_credentials(worker_id,credential_code);

alter table public.demand_signals
  add column required_level_code text references public.workforce_levels(code),
  add column overtime_required boolean,
  add column transportation_required boolean,
  add column tools_required boolean;

alter table public.commercial_pain_signals
  add column unresolved_association text check (unresolved_association is null or length(trim(unresolved_association)) between 1 and 300),
  drop constraint commercial_pain_signals_check,
  add constraint commercial_pain_signals_association_check check (
    company_id is not null or opportunity_id is not null or unresolved_association is not null
  );

alter table public.worker_locations
  add column in_state_travel_state text check (in_state_travel_state in ('YES','NO','UNKNOWN')),
  add column out_of_state_travel_state text check (out_of_state_travel_state in ('YES','NO','UNKNOWN')),
  add column relocation_state text check (relocation_state in ('YES','NO','UNKNOWN'));

create table public.worker_work_conditions (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  per_diem_state text not null default 'UNKNOWN' check (per_diem_state in ('REQUIRES','ACCEPTS','NOT_REQUIRED','UNKNOWN')),
  transportation_state text not null default 'UNKNOWN' check (transportation_state in ('YES','NO','UNKNOWN')),
  tools_state text not null default 'UNKNOWN' check (tools_state in ('YES','NO','PARTIAL','UNKNOWN')),
  maximum_hours_per_week integer check (maximum_hours_per_week between 1 and 168),
  overtime_state text not null default 'UNKNOWN' check (overtime_state in ('YES','NO','UNKNOWN')),
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  source text not null check (source in ('SELF_REPORTED','OPERATOR_ENTERED','INFERRED')),
  source_evidence_id uuid references public.raw_evidence(id),
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index worker_work_conditions_current_idx on public.worker_work_conditions(worker_id,effective_at desc);

create table public.worker_shift_capabilities (
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  shift_code text not null check (shift_code in ('DAY','NIGHT','ROTATING')),
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  source text not null check (source in ('SELF_REPORTED','OPERATOR_ENTERED','INFERRED')),
  source_evidence_id uuid references public.raw_evidence(id),
  created_at timestamptz not null default now(),
  primary key(worker_id,shift_code)
);

create table public.worker_consents (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  purpose text not null check (purpose in ('DATA_USE','CANDIDATE_PRESENTATION')),
  state text not null check (state in ('GRANTED','REVOKED','UNKNOWN')),
  captured_at timestamptz,
  source text,
  recorded_by_operator_id uuid references public.workforce_operators(id) on delete restrict,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (state <> 'GRANTED' or captured_at is not null)
);
create index worker_consents_current_idx on public.worker_consents(worker_id,purpose,effective_at desc);

create table public.worker_document_readiness (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workforce_workers(id) on delete cascade,
  document_type text not null check (length(trim(document_type)) between 1 and 100),
  readiness_state text not null check (readiness_state in ('KNOWN','VERIFIED','MISSING','EXPIRED','REQUIRES_VERIFICATION','UNKNOWN')),
  expires_at date,
  verification_state text not null default 'UNVERIFIED' check (verification_state in ('UNVERIFIED','VERIFIED','REJECTED','STALE')),
  source_evidence_id uuid references public.raw_evidence(id),
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index worker_document_readiness_current_idx on public.worker_document_readiness(worker_id,document_type,effective_at desc);

do $$ declare t text; begin
  foreach t in array array['workforce_levels','worker_level_assignments','worker_work_conditions','worker_shift_capabilities','worker_consents','worker_document_readiness'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select, insert on public.%I to fly_workforce_runtime',t);
    execute format('create policy fly_workforce_runtime_select on public.%I for select to fly_workforce_runtime using (true)',t);
    execute format('create policy fly_workforce_runtime_insert on public.%I for insert to fly_workforce_runtime with check (true)',t);
  end loop;
end $$;

-- Taxonomy rows are application-managed, not operator-authored.
revoke insert on public.workforce_levels from fly_workforce_runtime;
grant delete on public.worker_shift_capabilities to fly_workforce_runtime;
create policy fly_workforce_runtime_delete on public.worker_shift_capabilities for delete to fly_workforce_runtime using(true);

revoke all on public.worker_credentials from public,anon,authenticated;
grant select (id,worker_id,credential_code,verification_state,verified_at,issued_at,expires_at,issuing_authority,jurisdiction,lifecycle_status,source_evidence_id,created_at)
  on public.worker_credentials to fly_workforce_runtime;
grant insert (id,worker_id,credential_code,verification_state,verified_at,issued_at,expires_at,issuing_authority,jurisdiction,lifecycle_status,raw_identifier,source_evidence_id,created_at)
  on public.worker_credentials to fly_workforce_runtime;
grant update (verification_state,verified_at,issued_at,expires_at,issuing_authority,jurisdiction,lifecycle_status,raw_identifier,source_evidence_id)
  on public.worker_credentials to fly_workforce_runtime;
