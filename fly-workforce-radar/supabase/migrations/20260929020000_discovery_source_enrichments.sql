-- Bounded original-source enrichment for discovered signals (LOCAL). Append-only: every retrieval attempt,
-- including failures and robots refusals, is kept so the page-evidence vs snippet-evidence distinction and
-- any retrieval limitation stay auditable. This is review context for a search candidate, not canonical
-- evidence (raw_evidence remains the governed canonical store).
begin;

create table public.discovery_source_enrichments (
  id uuid primary key default gen_random_uuid(),
  normalized_candidate_url text not null check (length(trim(normalized_candidate_url)) > 0),
  requested_url text not null,
  final_url text,
  status text not null check (status in ('FETCHED','BLOCKED_BY_ROBOTS','HTTP_ERROR','TIMEOUT','TOO_LARGE','UNSUPPORTED_CONTENT','PRIVATE_ADDRESS','UNSAFE_URL','NO_TEXT','FAILED')),
  http_status integer,
  content_type text,
  page_title text check (page_title is null or length(page_title) <= 500),
  extracted_text text check (extracted_text is null or length(extracted_text) <= 20000),
  structured jsonb not null default '{}'::jsonb check (jsonb_typeof(structured) = 'object'),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer check (bytes is null or bytes >= 0),
  trigger text not null check (trigger in ('MANUAL','CYCLE','AUDIT')),
  requested_by_operator_id uuid references public.workforce_operators(id) on delete restrict,
  fetched_at timestamptz not null default now(),
  check ((status = 'FETCHED') = (extracted_text is not null))
);

create index discovery_source_enrichments_url_idx
  on public.discovery_source_enrichments(normalized_candidate_url, fetched_at desc);

create or replace function public.prevent_discovery_source_enrichment_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'discovery_source_enrichments is append-only';
end $$;

create trigger discovery_source_enrichments_append_only
  before update or delete on public.discovery_source_enrichments
  for each row execute function public.prevent_discovery_source_enrichment_mutation();

alter table public.discovery_source_enrichments enable row level security;
revoke all on public.discovery_source_enrichments from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.discovery_source_enrichments from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.discovery_source_enrichments from authenticated; end if;
end $$;
grant select, insert on public.discovery_source_enrichments to fly_workforce_runtime;
grant execute on function public.prevent_discovery_source_enrichment_mutation() to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.discovery_source_enrichments for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.discovery_source_enrichments for insert to fly_workforce_runtime with check (true);

commit;
