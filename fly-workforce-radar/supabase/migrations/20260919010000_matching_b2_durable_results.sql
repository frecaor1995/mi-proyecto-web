-- MATCHING-B2-B: durable persistence for deterministic worker-demand
-- matching results (the MATCHING-B1-D/B1-D-R1 pure engine's output).
-- Append-only; the current result per (demand_signal_id, worker_id) is
-- tracked with a single nullable `superseded_at` column and a partial
-- unique index -- deliberately not a redundant `is_current` boolean
-- (MATCHING-B2-A). Follows this project's existing append-only trigger
-- convention (raw_evidence_append_only, claim_state_transitions_append_only,
-- etc.) and existing column-scoped grant convention (worker_credentials'
-- raw_identifier exclusion). No score/percentage/rank/AI confidence, no
-- tenant_id, no full worker/demand snapshot, no worker_demand_match_runs --
-- all deliberately deferred per MATCHING-B2-A's recommended minimum
-- package.

create table public.worker_demand_match_results (
  id uuid primary key default gen_random_uuid(),
  demand_signal_id uuid not null references public.demand_signals(id),
  worker_id uuid not null references public.workforce_workers(id),
  outcome text not null check (outcome in ('STRONG_MATCH','POSSIBLE_MATCH','NO_MATCH','INSUFFICIENT_DATA')),
  rule_version text not null,
  evaluation_date timestamptz not null,
  evaluated_at timestamptz not null default now(),
  worker_input_fingerprint text not null,
  demand_input_fingerprint text not null,
  worker_lifecycle_status_at_evaluation text not null check (worker_lifecycle_status_at_evaluation in ('ACTIVE','INACTIVE','ARCHIVED')),
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);

-- Exactly one current (non-superseded) result per demand/worker pair;
-- historical superseded rows may coexist freely.
create unique index worker_demand_match_results_current_unique_idx
  on public.worker_demand_match_results(demand_signal_id, worker_id)
  where superseded_at is null;

create index worker_demand_match_results_demand_current_idx
  on public.worker_demand_match_results(demand_signal_id)
  where superseded_at is null;

create table public.worker_demand_match_criteria (
  id uuid primary key default gen_random_uuid(),
  match_result_id uuid not null references public.worker_demand_match_results(id) on delete cascade,
  criterion text not null,
  subject text,
  importance text not null check (importance in ('HARD','PREFERRED')),
  state text not null check (state in ('SATISFIED','SATISFIED_WITH_LIMITATION','VIOLATED','UNKNOWN','NOT_APPLICABLE')),
  reason_code text not null,
  observed_demand text,
  observed_worker text,
  created_at timestamptz not null default now()
);

create index worker_demand_match_criteria_result_idx
  on public.worker_demand_match_criteria(match_result_id);

-- Append-only enforcement --------------------------------------------------
-- Results: DELETE is always rejected; UPDATE is rejected unless the only
-- column changing is `superseded_at` (the one sanctioned lifecycle
-- operation -- see the persistence service). Every historical fact --
-- outcome, rule_version, evaluation_date, both fingerprints, the lifecycle
-- snapshot, created_at -- is immutable once written.

create function public.prevent_worker_demand_match_result_rewrite()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'worker_demand_match_results is append-only: delete is not permitted';
  end if;
  if NEW.id <> OLD.id
    or NEW.demand_signal_id <> OLD.demand_signal_id
    or NEW.worker_id <> OLD.worker_id
    or NEW.outcome <> OLD.outcome
    or NEW.rule_version <> OLD.rule_version
    or NEW.evaluation_date <> OLD.evaluation_date
    or NEW.evaluated_at <> OLD.evaluated_at
    or NEW.worker_input_fingerprint <> OLD.worker_input_fingerprint
    or NEW.demand_input_fingerprint <> OLD.demand_input_fingerprint
    or NEW.worker_lifecycle_status_at_evaluation <> OLD.worker_lifecycle_status_at_evaluation
    or NEW.created_at <> OLD.created_at
  then
    raise exception 'worker_demand_match_results historical facts are immutable -- only superseded_at may be updated';
  end if;
  return NEW;
end;
$$;

create trigger worker_demand_match_results_append_only
before update or delete on public.worker_demand_match_results
for each row execute function public.prevent_worker_demand_match_result_rewrite();

-- Criteria: fully append-only, no exception (they are never individually
-- corrected -- a corrected evaluation is always a brand new result row).
create function public.prevent_worker_demand_match_criteria_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'worker_demand_match_criteria is append-only';
end;
$$;

create trigger worker_demand_match_criteria_append_only
before update or delete on public.worker_demand_match_criteria
for each row execute function public.prevent_worker_demand_match_criteria_mutation();

-- Security ------------------------------------------------------------------
-- Server-only / operator-scoped, same tier as worker-profile-adjacent data.
-- anon/authenticated get nothing (no grant is ever made to them, and RLS is
-- enabled regardless as a second layer, matching every other table in this
-- schema). fly_workforce_runtime gets SELECT+INSERT on both tables, and on
-- results, UPDATE restricted at the grant layer to exactly the
-- `superseded_at` column -- the trigger above is a second, independent
-- layer enforcing the same restriction at the row level.

alter table public.worker_demand_match_results enable row level security;
alter table public.worker_demand_match_criteria enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.worker_demand_match_results, public.worker_demand_match_criteria from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.worker_demand_match_results, public.worker_demand_match_criteria from authenticated;
  end if;
end $$;

grant select, insert on public.worker_demand_match_results to fly_workforce_runtime;
grant update (superseded_at) on public.worker_demand_match_results to fly_workforce_runtime;
grant select, insert on public.worker_demand_match_criteria to fly_workforce_runtime;

create policy fly_workforce_runtime_select on public.worker_demand_match_results for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_demand_match_results for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_update on public.worker_demand_match_results for update to fly_workforce_runtime using (true) with check (true);

create policy fly_workforce_runtime_select on public.worker_demand_match_criteria for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_demand_match_criteria for insert to fly_workforce_runtime with check (true);
