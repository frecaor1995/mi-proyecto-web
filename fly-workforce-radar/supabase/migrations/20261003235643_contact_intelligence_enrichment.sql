-- Provider-neutral Contact Intelligence enrichment batches and row decisions.
-- Preview is performed in application memory; these tables receive data only after owner confirmation.
begin;

insert into public.sources(id,name,source_type,access_classification,allowed_capture_methods,requires_auth,paywalled,enabled,yield_metadata)
values('ce000000-0000-4000-8000-000000000001','Contact Intelligence enrichment','OTHER','RESTRICTED',array['MANUAL','CSV_IMPORT'],true,false,true,'{"owner":"Fly Workforce Radar","purpose":"operator-confirmed contact enrichment"}'::jsonb)
on conflict(id) do nothing;

create table public.contact_enrichment_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  provider text not null check (length(trim(provider)) between 1 and 80),
  input_mode text not null check (input_mode in ('MANUAL','CSV')),
  source_filename text,
  file_hash text check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$'),
  column_mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(column_mapping) = 'object'),
  imported_by_operator_id uuid references public.workforce_operators(id) on delete restrict,
  imported_at timestamptz not null default now(),
  row_count integer not null check (row_count >= 0),
  confirmed_count integer not null default 0 check (confirmed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table public.contact_enrichment_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.contact_enrichment_batches(id) on delete restrict,
  row_number integer not null check (row_number > 0),
  classification text not null check (classification in ('MATCH_EXISTING','NEW_PERSON','POSSIBLE_DUPLICATE','CONFLICT_REVIEW','INVALID_ROW','NO_COMPANY_MATCH')),
  resolution text not null check (resolution in ('CONFIRMED','SKIPPED','REVIEW_REQUIRED')),
  resolved_contact_person_id uuid references public.contact_people(id) on delete restrict,
  resolved_contact_route_id uuid references public.contact_routes(id) on delete restrict,
  evidence_id uuid references public.raw_evidence(id) on delete restrict,
  provider text not null,
  acquisition_method text not null check (acquisition_method in ('PUBLICLY_FOUND','PROVIDER_DISCOVERED','PATTERN_INFERRED','MANUALLY_ENTERED','IMPORTED','UNKNOWN')),
  technical_verification text not null check (technical_verification in ('VALID','RISKY','INVALID','ACCEPT_ALL','UNKNOWN','NOT_VERIFIED')),
  accept_all text not null check (accept_all in ('YES','NO','UNKNOWN')),
  provider_score numeric check (provider_score is null or provider_score between 0 and 100),
  observed_at timestamptz not null,
  source_reference text,
  raw_values jsonb not null check (jsonb_typeof(raw_values) = 'object'),
  normalized_values jsonb not null check (jsonb_typeof(normalized_values) = 'object'),
  decision_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(decision_metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique(batch_id,row_number)
);

create index contact_enrichment_batches_company_idx on public.contact_enrichment_batches(company_id, imported_at desc);
create index contact_enrichment_rows_person_idx on public.contact_enrichment_rows(resolved_contact_person_id) where resolved_contact_person_id is not null;

create trigger contact_enrichment_batches_append_only before update or delete on public.contact_enrichment_batches
  for each row execute function public.prevent_contact_intelligence_mutation();
create trigger contact_enrichment_rows_append_only before update or delete on public.contact_enrichment_rows
  for each row execute function public.prevent_contact_intelligence_mutation();

do $$
declare t text;
begin
  foreach t in array array['contact_enrichment_batches','contact_enrichment_rows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname='anon') then execute format('revoke all on public.%I from anon',t); end if;
    if exists (select 1 from pg_roles where rolname='authenticated') then execute format('revoke all on public.%I from authenticated',t); end if;
    execute format('grant select, insert on public.%I to fly_workforce_runtime',t);
    execute format('create policy fly_workforce_runtime_select on public.%I for select to fly_workforce_runtime using (true)',t);
    execute format('create policy fly_workforce_runtime_insert on public.%I for insert to fly_workforce_runtime with check (true)',t);
  end loop;
end $$;

grant update (company_id) on public.contact_investigations to fly_workforce_runtime;

commit;
