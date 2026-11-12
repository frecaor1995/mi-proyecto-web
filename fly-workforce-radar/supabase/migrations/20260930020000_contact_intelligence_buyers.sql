-- Contact Intelligence 2.0 (LOCAL, additive). Company-first investigations, person-level evidence facts,
-- bounded web-search people discovery, and an auditable log of human commercial interactions.
begin;

-- Company-first investigations reuse the same investigation/candidate/decision infrastructure.
alter table public.contact_investigations
  alter column normalized_candidate_url drop not null,
  add column company_id uuid references public.companies(id) on delete restrict,
  add column official_domain text check (official_domain is null or official_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  add column domain_basis text,
  add column target_functions text[],
  add constraint contact_investigations_subject_check check (normalized_candidate_url is not null or company_id is not null);
create unique index contact_investigations_company_idx on public.contact_investigations(company_id) where normalized_candidate_url is null;

-- Person-level evidence facts (all nullable: earlier rows keep their original content).
alter table public.contact_candidates
  add column person_key text,
  add column source_type text check (source_type is null or source_type in ('OFFICIAL_SITE','PROCUREMENT_DOCUMENT','PRESS_RELEASE','NEWS_ARTICLE','PROFESSIONAL_PROFILE_LISTING','DIRECTORY_LISTING','PROVIDER','SIGNAL_DOCUMENT')),
  add column source_date date,
  add column evidence_currency text check (evidence_currency is null or evidence_currency in ('CURRENT','HISTORICAL','UNDATED')),
  add column department text,
  add column location text,
  add column project_relationship text,
  add column profile_url text,
  add column responsibility_evidence text;
create index contact_candidates_person_key_idx on public.contact_candidates(person_key) where person_key is not null;

alter table public.contact_candidates drop constraint contact_candidates_provider_check;
alter table public.contact_candidates add constraint contact_candidates_provider_check
  check (provider in ('SIGNAL_SOURCE','OFFICIAL_WEBSITE','PUBLIC_PROCUREMENT_DOCUMENT','HUNTER_DOMAIN_SEARCH','WEB_SEARCH_RESULT'));
alter table public.contact_source_retrievals drop constraint contact_source_retrievals_provider_check;
alter table public.contact_source_retrievals add constraint contact_source_retrievals_provider_check
  check (provider in ('SIGNAL_SOURCE','OFFICIAL_WEBSITE','PUBLIC_PROCUREMENT_DOCUMENT','HUNTER_DOMAIN_SEARCH','WEB_SEARCH_RESULT'));
alter table public.contact_source_retrievals add column query_text text;

-- Auditable human commercial interactions (append-only). Nothing here is created automatically.
create table public.contact_interactions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.contact_candidates(id) on delete restrict,
  person_reached boolean not null,
  contact_date date not null,
  channel text not null check (channel in ('PHONE','EMAIL','IN_PERSON','VIDEO','OTHER')),
  handles_external_workforce text not null check (handles_external_workforce in ('YES','NO','UNKNOWN')),
  referred_to text check (referred_to is null or length(referred_to) <= 300),
  responsible_department text check (responsible_department is null or length(responsible_department) <= 300),
  notes text check (notes is null or length(notes) <= 4000),
  next_action text check (next_action is null or length(next_action) <= 1000),
  recorded_by_operator_id uuid references public.workforce_operators(id) on delete restrict,
  canonical_contact_person_id uuid references public.contact_people(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  check (contact_date <= (now() at time zone 'utc')::date + 1)
);
create index contact_interactions_candidate_idx on public.contact_interactions(candidate_id, recorded_at desc);
create trigger contact_interactions_append_only before update or delete on public.contact_interactions
  for each row execute function public.prevent_contact_intelligence_mutation();

alter table public.contact_interactions enable row level security;
revoke all on public.contact_interactions from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.contact_interactions from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.contact_interactions from authenticated; end if;
end $$;
grant select, insert on public.contact_interactions to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.contact_interactions for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.contact_interactions for insert to fly_workforce_runtime with check (true);

-- Selected target functions may be changed by the operator on an investigation.
grant update (target_functions, official_domain, domain_basis) on public.contact_investigations to fly_workforce_runtime;
create policy fly_workforce_runtime_update on public.contact_investigations for update to fly_workforce_runtime using (true) with check (true);

commit;
