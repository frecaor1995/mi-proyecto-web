begin;

-- Phase 4J: immutable human commercial/economic dispositions. A decision
-- references one immutable scenario snapshot and never stores client-supplied
-- economics. Certainty and blocking reasons are copied only from that snapshot
-- by the protected server mutation for direct audit visibility.
create table economic_decisions(
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete restrict,
  scenario_snapshot_id uuid not null references economics_scenario_snapshots(id) on delete restrict,
  disposition text not null check(disposition in('PROCEED','DECLINE','DEFER')),
  rationale text not null check(length(trim(rationale))>0),
  scenario_effective_certainty text not null check(scenario_effective_certainty in('VERIFIED','UNVERIFIED_SOURCED','OPERATOR_ASSUMPTION','UNKNOWN')),
  scenario_blocking_reasons text[] not null default '{}',
  rule_version text not null check(length(trim(rule_version))>0),
  decided_by uuid not null references workforce_operators(id) on delete restrict,
  decided_at timestamptz not null,
  supersedes_decision_id uuid references economic_decisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(supersedes_decision_id is null or supersedes_decision_id<>id)
);

create unique index economic_decisions_supersedes_unique_idx
  on economic_decisions(supersedes_decision_id)
  where supersedes_decision_id is not null;
-- NULL predecessors are excluded from the successor index above. A separate
-- per-opportunity root invariant prevents two competing initial heads.
create unique index economic_decisions_one_root_per_opportunity_idx
  on economic_decisions(opportunity_id)
  where supersedes_decision_id is null;
-- The composite candidate key lets PostgreSQL enforce that a successor and
-- its predecessor belong to the same opportunity, not merely that the
-- predecessor decision id exists somewhere in the table.
alter table economic_decisions
  add constraint economic_decisions_opportunity_id_id_unique unique(opportunity_id,id);
alter table economic_decisions
  add constraint economic_decisions_same_opportunity_supersession_fkey
  foreign key(opportunity_id,supersedes_decision_id)
  references economic_decisions(opportunity_id,id) on delete restrict;
create index economic_decisions_opportunity_history_idx
  on economic_decisions(opportunity_id,decided_at desc,created_at desc);
create index economic_decisions_snapshot_idx on economic_decisions(scenario_snapshot_id);

create function prevent_economic_decision_mutation() returns trigger language plpgsql as $$
begin raise exception 'economic_decisions is append-only'; end;$$;
create trigger economic_decisions_append_only
  before update or delete on economic_decisions
  for each row execute function prevent_economic_decision_mutation();

commit;
