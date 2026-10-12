-- MATCHING-B5-C: canonical worker-demand engagement foundation.
-- One durable root per demand/worker pair plus immutable event history.

create table public.worker_demand_engagements (
  id uuid primary key default gen_random_uuid(),
  demand_signal_id uuid not null references public.demand_signals(id) on delete restrict,
  worker_id uuid not null references public.workforce_workers(id) on delete restrict,
  opportunity_id uuid,
  originating_match_result_id uuid references public.worker_demand_match_results(id) on delete restrict,
  selection_state text not null default 'REVIEWING' check (selection_state in ('REVIEWING','SHORTLISTED','SELECTED','NOT_SELECTED')),
  contact_state text not null default 'NOT_STARTED' check (contact_state in ('NOT_STARTED','PLANNED','ATTEMPTED','AWAITING_RESPONSE','RESPONSE_RECEIVED','BLOCKED')),
  response_state text not null default 'UNKNOWN' check (response_state in ('UNKNOWN','NO_RESPONSE','NEEDS_INFORMATION','INTERESTED','NOT_INTERESTED')),
  demand_availability_state text not null default 'UNKNOWN' check (demand_availability_state in ('UNKNOWN','CONFIRMED_AVAILABLE','CONFIRMED_UNAVAILABLE')),
  available_from date,
  available_until date,
  compensation_resolution_state text not null default 'UNKNOWN' check (compensation_resolution_state in ('UNKNOWN','NOT_REQUIRED','COMPATIBLE','ACCEPTED_CONFLICT','UNRESOLVED_CONFLICT')),
  travel_resolution_state text not null default 'UNKNOWN' check (travel_resolution_state in ('UNKNOWN','NOT_REQUIRED','COMPATIBLE','ACCEPTED_CONFLICT','UNRESOLVED_CONFLICT')),
  mobilization_state text not null default 'NOT_READY' check (mobilization_state in ('NOT_READY','CANDIDATE','REVIEW_REQUIRED')),
  closed_at timestamptz,
  closure_reason text check (closure_reason in ('NOT_SELECTED','WORKER_DECLINED','WORKER_UNAVAILABLE','WORKER_INACTIVE','WORKER_ARCHIVED','DEMAND_TERMINAL','OTHER')),
  created_by_operator_id uuid not null references public.workforce_operators(id) on delete restrict,
  updated_by_actor_type text not null default 'OPERATOR' check (updated_by_actor_type in ('OPERATOR','SYSTEM')),
  updated_by_operator_id uuid references public.workforce_operators(id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (demand_signal_id, worker_id),
  foreign key (opportunity_id, demand_signal_id)
    references public.opportunity_demand_signals(opportunity_id, demand_signal_id) on delete restrict,
  check (available_until is null or available_from is null or available_until >= available_from),
  check (demand_availability_state <> 'UNKNOWN' or (available_from is null and available_until is null)),
  check ((closed_at is null) = (closure_reason is null)),
  check (mobilization_state <> 'CANDIDATE' or closed_at is null),
  check ((updated_by_actor_type = 'OPERATOR' and updated_by_operator_id is not null)
      or (updated_by_actor_type = 'SYSTEM' and updated_by_operator_id is null))
);

create index worker_demand_engagements_demand_idx on public.worker_demand_engagements(demand_signal_id);
create index worker_demand_engagements_worker_idx on public.worker_demand_engagements(worker_id);
create index worker_demand_engagements_opportunity_idx on public.worker_demand_engagements(opportunity_id) where opportunity_id is not null;
create index worker_demand_engagements_open_idx on public.worker_demand_engagements(updated_at desc) where closed_at is null;
create index worker_demand_engagements_selected_idx on public.worker_demand_engagements(demand_signal_id, updated_at desc) where selection_state = 'SELECTED';
create index worker_demand_engagements_mobilization_idx on public.worker_demand_engagements(mobilization_state, updated_at desc) where mobilization_state <> 'NOT_READY';

create table public.worker_demand_engagement_events (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.worker_demand_engagements(id) on delete restrict,
  engagement_version bigint not null check (engagement_version > 0),
  event_type text not null check (event_type in (
    'ENGAGEMENT_CREATED','REVIEW_STARTED','SELECTION_CHANGED','CONTACT_PLANNED','CONTACT_ATTEMPT_RECORDED',
    'RESPONSE_RECORDED','DEMAND_AVAILABILITY_CHANGED','RESOLUTIONS_CHANGED','MOBILIZATION_CHANGED',
    'MATCH_REVIEW_REQUIRED','WORKER_LIFECYCLE_REVIEW_REQUIRED','ENGAGEMENT_CLOSED','ENGAGEMENT_REOPENED'
  )),
  actor_type text not null check (actor_type in ('OPERATOR','SYSTEM')),
  actor_operator_id uuid references public.workforce_operators(id) on delete restrict,
  occurred_at timestamptz not null,
  state_dimension text check (state_dimension in ('SELECTION','CONTACT','RESPONSE','AVAILABILITY','RESOLUTIONS','MOBILIZATION','ENGAGEMENT')),
  previous_state text,
  new_state text,
  worker_contact_route_id uuid references public.worker_contact_routes(id) on delete restrict,
  route_type_snapshot text check (route_type_snapshot in ('PHONE','EMAIL','SMS','OTHER')),
  consent_state_snapshot text check (consent_state_snapshot in ('GRANTED','REVOKED','UNKNOWN')),
  route_lifecycle_snapshot text check (route_lifecycle_snapshot in ('ACTIVE','INACTIVE')),
  contact_direction text check (contact_direction in ('OUTBOUND','INBOUND')),
  contact_outcome text check (contact_outcome in ('NO_ANSWER','VOICEMAIL_LEFT','MESSAGE_SENT','EMAIL_SENT','WRONG_ROUTE','CONVERSATION_COMPLETED','RESPONSE_RECEIVED')),
  available_from date,
  available_until date,
  match_result_id uuid references public.worker_demand_match_results(id) on delete restrict,
  command_idempotency_key_id uuid not null unique references public.command_idempotency_keys(id) on delete restrict,
  reason_code text,
  notes varchar(1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  created_at timestamptz not null default now(),
  unique (engagement_id, engagement_version),
  check ((actor_type = 'OPERATOR' and actor_operator_id is not null) or (actor_type = 'SYSTEM' and actor_operator_id is null)),
  check (available_until is null or available_from is null or available_until >= available_from),
  check (notes is null or length(trim(notes)) > 0)
);

create index worker_demand_engagement_events_timeline_idx on public.worker_demand_engagement_events(engagement_id, engagement_version);
create index worker_demand_engagement_events_match_idx on public.worker_demand_engagement_events(match_result_id) where match_result_id is not null;

create function public.validate_worker_demand_engagement_references()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.originating_match_result_id is not null and not exists (
    select 1 from public.worker_demand_match_results r
    where r.id = new.originating_match_result_id and r.demand_signal_id = new.demand_signal_id and r.worker_id = new.worker_id
  ) then raise exception 'originating match result does not belong to engagement pair'; end if;
  return new;
end; $$;

create trigger worker_demand_engagement_reference_guard
before insert or update on public.worker_demand_engagements
for each row execute function public.validate_worker_demand_engagement_references();

create function public.protect_worker_demand_engagement_root()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'worker_demand_engagements cannot be deleted'; end if;
  if old.id <> new.id or old.demand_signal_id <> new.demand_signal_id or old.worker_id <> new.worker_id
    or old.opportunity_id is distinct from new.opportunity_id
    or old.originating_match_result_id is distinct from new.originating_match_result_id
    or old.created_by_operator_id <> new.created_by_operator_id or old.created_at <> new.created_at
  then raise exception 'worker_demand_engagement identity and creation provenance are immutable'; end if;
  if new.version <> old.version + 1 then raise exception 'worker_demand_engagement version must increment exactly once'; end if;
  if new.updated_at < old.updated_at then raise exception 'worker_demand_engagement updated_at cannot move backward'; end if;
  return new;
end; $$;

create trigger worker_demand_engagement_root_guard
before update or delete on public.worker_demand_engagements
for each row execute function public.protect_worker_demand_engagement_root();

create function public.validate_worker_demand_engagement_event()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare e public.worker_demand_engagements%rowtype;
begin
  select * into e from public.worker_demand_engagements where id = new.engagement_id;
  if not found then raise exception 'engagement not found'; end if;
  if new.engagement_version <> e.version then raise exception 'event version must equal current engagement version'; end if;
  if new.worker_contact_route_id is not null and not exists (
    select 1 from public.worker_contact_routes r where r.id = new.worker_contact_route_id and r.worker_id = e.worker_id
  ) then raise exception 'contact route does not belong to engagement worker'; end if;
  if new.match_result_id is not null and not exists (
    select 1 from public.worker_demand_match_results r
    where r.id = new.match_result_id and r.demand_signal_id = e.demand_signal_id and r.worker_id = e.worker_id
  ) then raise exception 'event match result does not belong to engagement pair'; end if;
  return new;
end; $$;

create trigger worker_demand_engagement_event_reference_guard
before insert on public.worker_demand_engagement_events
for each row execute function public.validate_worker_demand_engagement_event();

create function public.prevent_worker_demand_engagement_event_mutation()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin raise exception 'worker_demand_engagement_events are append-only'; end; $$;

create trigger worker_demand_engagement_events_append_only
before update or delete on public.worker_demand_engagement_events
for each row execute function public.prevent_worker_demand_engagement_event_mutation();

alter table public.worker_demand_engagements enable row level security;
alter table public.worker_demand_engagement_events enable row level security;

revoke all on public.worker_demand_engagements, public.worker_demand_engagement_events from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.worker_demand_engagements, public.worker_demand_engagement_events from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.worker_demand_engagements, public.worker_demand_engagement_events from authenticated;
  end if;
end $$;

grant select, insert, update on public.worker_demand_engagements to fly_workforce_runtime;
grant select, insert on public.worker_demand_engagement_events to fly_workforce_runtime;

create policy fly_workforce_runtime_select on public.worker_demand_engagements for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_demand_engagements for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_update on public.worker_demand_engagements for update to fly_workforce_runtime using (true) with check (true);
create policy fly_workforce_runtime_select on public.worker_demand_engagement_events for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.worker_demand_engagement_events for insert to fly_workforce_runtime with check (true);

revoke all on function public.validate_worker_demand_engagement_references() from public;
revoke all on function public.protect_worker_demand_engagement_root() from public;
revoke all on function public.validate_worker_demand_engagement_event() from public;
revoke all on function public.prevent_worker_demand_engagement_event_mutation() from public;
grant execute on function public.validate_worker_demand_engagement_references() to fly_workforce_runtime;
grant execute on function public.protect_worker_demand_engagement_root() to fly_workforce_runtime;
grant execute on function public.validate_worker_demand_engagement_event() to fly_workforce_runtime;
grant execute on function public.prevent_worker_demand_engagement_event_mutation() to fly_workforce_runtime;
