-- OPPORTUNITY-FIRST: human review of discovered signals (company_discovery_candidates).
-- A discovered candidate is never an opportunity by itself; an operator records a review decision
-- here before a signal can be promoted through Commercial Intake (recorded as a PROMOTED decision,
-- because candidate rows are insert-only for the runtime role). Signals are identified by their
-- normalized source URL (the same URL can be rediscovered by later runs); each review also points at
-- the concrete candidate row the operator looked at. Append-only: decisions are never edited.
create table public.discovery_signal_reviews (
  id uuid primary key default gen_random_uuid(),
  normalized_candidate_url text not null check (length(trim(normalized_candidate_url)) > 0),
  candidate_id uuid not null references public.company_discovery_candidates(id) on delete restrict,
  decision text not null check (decision in ('NEEDS_REVIEW', 'VERIFIED', 'REJECTED', 'PROMOTED')),
  note text check (note is null or length(note) <= 2000),
  -- Set only by the PROMOTED decision: the opportunity created from this signal via Commercial Intake.
  promoted_opportunity_id uuid references public.opportunities(id) on delete restrict,
  decided_by_operator_id uuid not null references public.workforce_operators(id) on delete restrict,
  decided_at timestamptz not null default now(),
  check ((decision = 'PROMOTED') = (promoted_opportunity_id is not null))
);

create index discovery_signal_reviews_url_idx on public.discovery_signal_reviews (normalized_candidate_url, decided_at desc);
-- A signal (source URL) can be promoted at most once: the database-level duplicate guard.
create unique index discovery_signal_reviews_one_promotion_idx on public.discovery_signal_reviews (normalized_candidate_url) where decision = 'PROMOTED';

create function public.prevent_discovery_signal_review_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'discovery_signal_reviews is append-only';
end;
$$;

create trigger discovery_signal_reviews_append_only
before update or delete on public.discovery_signal_reviews
for each row execute function public.prevent_discovery_signal_review_mutation();

alter table public.discovery_signal_reviews enable row level security;
revoke all on public.discovery_signal_reviews from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.discovery_signal_reviews from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.discovery_signal_reviews from authenticated;
  end if;
end $$;
revoke all on function public.prevent_discovery_signal_review_mutation() from public;
grant execute on function public.prevent_discovery_signal_review_mutation() to fly_workforce_runtime;

grant select, insert on public.discovery_signal_reviews to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.discovery_signal_reviews for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.discovery_signal_reviews for insert to fly_workforce_runtime with check (true);
