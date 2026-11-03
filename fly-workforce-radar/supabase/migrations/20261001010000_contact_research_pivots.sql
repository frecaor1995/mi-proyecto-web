-- Contact Intelligence 2.1A (LOCAL, additive). Iterative research graph: every discovery that generates further
-- research is recorded as a pivot (what it is, which source produced it, which pivot it came from, and at which
-- research depth). Retrievals record the pivot that generated them, plus a content hash and a bounded excerpt so
-- a page can be audited and re-parsed without being fetched again. Persons and channels stay in contact_candidates.
begin;

create table public.contact_research_pivots (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.contact_investigations(id) on delete restrict,
  kind text not null check (kind in (
    'COMPANY', 'ORG_ALIAS', 'ORG_DIVISION', 'ORG_SUBSIDIARY', 'ORG_OPERATING_BRAND', 'ORG_JOINT_VENTURE',
    'LOCATION', 'ADDRESS', 'INSTITUTION', 'PERSON', 'CHANNEL', 'DEPARTMENT')),
  value text not null check (length(value) between 1 and 300),
  normalized_key text not null check (length(normalized_key) between 1 and 300),
  parent_pivot_id uuid references public.contact_research_pivots(id) on delete restrict,
  source_retrieval_id uuid references public.contact_source_retrievals(id) on delete restrict,
  depth smallint not null check (depth between 0 and 3),
  discovered_at timestamptz not null default now(),
  check ((kind = 'COMPANY') = (parent_pivot_id is null))
);
-- One pivot per (investigation, kind, normalized value): deduplication and loop prevention.
create unique index contact_research_pivots_identity_idx on public.contact_research_pivots(investigation_id, kind, normalized_key);
create index contact_research_pivots_parent_idx on public.contact_research_pivots(parent_pivot_id);
create trigger contact_research_pivots_append_only before update or delete on public.contact_research_pivots
  for each row execute function public.prevent_contact_intelligence_mutation();

alter table public.contact_research_pivots enable row level security;
revoke all on public.contact_research_pivots from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.contact_research_pivots from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.contact_research_pivots from authenticated; end if;
end $$;
grant select, insert on public.contact_research_pivots to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.contact_research_pivots for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.contact_research_pivots for insert to fly_workforce_runtime with check (true);

-- Provenance and page cache on retrievals (nullable: existing rows keep their content; table stays append-only).
alter table public.contact_source_retrievals
  add column pivot_id uuid references public.contact_research_pivots(id) on delete restrict,
  add column content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  add column excerpt text check (excerpt is null or length(excerpt) <= 20000);
create index contact_source_retrievals_pivot_idx on public.contact_source_retrievals(pivot_id) where pivot_id is not null;

commit;
