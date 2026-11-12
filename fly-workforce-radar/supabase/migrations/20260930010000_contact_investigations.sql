-- Contact intelligence investigations (LOCAL). One investigation per discovered signal (normalized source URL).
-- Candidates keep DISCOVERED / ATTRIBUTED facts with their source; technical validations and human decisions are
-- separate append-only records, so no single "verified" flag can conflate them. Human-confirmed contacts may be
-- bridged into the canonical contact register (contact_people) by the application, never automatically.
begin;

create table public.contact_investigations (
  id uuid primary key default gen_random_uuid(),
  normalized_candidate_url text not null unique check (length(trim(normalized_candidate_url)) > 0),
  started_by_operator_id uuid references public.workforce_operators(id) on delete restrict,
  started_at timestamptz not null default now()
);

create table public.contact_source_retrievals (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.contact_investigations(id) on delete restrict,
  url text not null,
  provider text not null check (provider in ('SIGNAL_SOURCE','OFFICIAL_WEBSITE','PUBLIC_PROCUREMENT_DOCUMENT','HUNTER_DOMAIN_SEARCH')),
  status text not null,
  http_status integer,
  retrieved_at timestamptz not null default now()
);

create table public.contact_candidates (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.contact_investigations(id) on delete restrict,
  identity_key text not null check (identity_key ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('PERSON','MAILBOX','PHONE_ROUTE')),
  person_name text,
  title text,
  contact_function public.contact_function not null default 'OTHER',
  organization text,
  email text,
  phone text,
  phone_kind text check (phone_kind is null or phone_kind in ('MAIN','DEPARTMENT','DIRECT','UNKNOWN')),
  source_url text not null,
  provider text not null check (provider in ('SIGNAL_SOURCE','OFFICIAL_WEBSITE','PUBLIC_PROCUREMENT_DOCUMENT','HUNTER_DOMAIN_SEARCH')),
  evidence_quote text check (evidence_quote is null or length(evidence_quote) <= 600),
  attributed boolean not null,
  attribution_basis text,
  historical boolean not null default false,
  discovered_at timestamptz not null default now(),
  unique (investigation_id, identity_key),
  check (person_name is not null or email is not null or phone is not null),
  check ((kind = 'PERSON') = (person_name is not null))
);

create table public.contact_validations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.contact_candidates(id) on delete restrict,
  channel text not null check (channel in ('EMAIL','PHONE')),
  provider text not null,
  result text not null check (result in ('VALID','INVALID','RISKY','UNKNOWN','FAILED')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  checked_at timestamptz not null default now()
);

create table public.contact_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.contact_candidates(id) on delete restrict,
  decision text not null check (decision in ('SELECTED_FOR_FOLLOW_UP','CONFIRMED','REJECTED')),
  note text check (note is null or length(note) <= 2000),
  decided_by_operator_id uuid references public.workforce_operators(id) on delete restrict,
  canonical_contact_person_id uuid references public.contact_people(id) on delete restrict,
  decided_at timestamptz not null default now(),
  check (decision = 'CONFIRMED' or canonical_contact_person_id is null)
);

create index contact_candidates_investigation_idx on public.contact_candidates(investigation_id);
create index contact_validations_candidate_idx on public.contact_validations(candidate_id, checked_at desc);
create index contact_decisions_candidate_idx on public.contact_decisions(candidate_id, decided_at desc);

create or replace function public.prevent_contact_intelligence_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger contact_candidates_append_only before update or delete on public.contact_candidates for each row execute function public.prevent_contact_intelligence_mutation();
create trigger contact_validations_append_only before update or delete on public.contact_validations for each row execute function public.prevent_contact_intelligence_mutation();
create trigger contact_decisions_append_only before update or delete on public.contact_decisions for each row execute function public.prevent_contact_intelligence_mutation();
create trigger contact_source_retrievals_append_only before update or delete on public.contact_source_retrievals for each row execute function public.prevent_contact_intelligence_mutation();

do $$
declare t text;
begin
  foreach t in array array['contact_investigations','contact_source_retrievals','contact_candidates','contact_validations','contact_decisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    execute format('grant select, insert on public.%I to fly_workforce_runtime', t);
    execute format('create policy fly_workforce_runtime_select on public.%I for select to fly_workforce_runtime using (true)', t);
    execute format('create policy fly_workforce_runtime_insert on public.%I for insert to fly_workforce_runtime with check (true)', t);
  end loop;
end $$;
grant execute on function public.prevent_contact_intelligence_mutation() to fly_workforce_runtime;

commit;
