-- Contact Intelligence closure (additive, backward compatible).
--
-- 1. Company-level calls: a call can be recorded against a canonical company (and optionally a corporate contact
--    route) without inventing a contact candidate or an opportunity. Existing candidate-based interactions are
--    unchanged: candidate_id stays required for them through the subject check below.
-- 2. Call result, optional counterpart, the five external-supplier answers and a durable is_demo marker.
-- 3. Company next actions (action, due date, owner) with a guarded resolution; DEMO rows are marked and never count
--    as real commercial activity.
-- Corporate channels without a person need no schema change: contact_routes.contact_person_id is already nullable.

alter table public.contact_interactions alter column candidate_id drop not null;
alter table public.contact_interactions
  add column company_id uuid references public.companies(id) on delete restrict,
  add column contact_route_id uuid references public.contact_routes(id) on delete restrict,
  add column call_outcome text check (call_outcome is null or call_outcome in ('REACHED','NO_ANSWER','VOICEMAIL','GATEKEEPER','WRONG_NUMBER','CALL_BACK_REQUESTED','NOT_CALLED')),
  add column external_supplier_answer text check (external_supplier_answer is null or external_supplier_answer in ('YES','NO','OWN_AGENCY_ONLY','UNKNOWN','NOT_ASKED')),
  add column counterpart_name text check (counterpart_name is null or length(trim(counterpart_name)) between 1 and 200),
  add column counterpart_role text check (counterpart_role is null or length(trim(counterpart_role)) between 1 and 200),
  add column is_demo boolean not null default false;
alter table public.contact_interactions
  add constraint contact_interactions_subject_check check (candidate_id is not null or company_id is not null),
  add constraint contact_interactions_company_call_check check (company_id is null or (call_outcome is not null and external_supplier_answer is not null));
create index contact_interactions_company_idx on public.contact_interactions(company_id, recorded_at desc) where company_id is not null;

create table public.company_next_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  action text not null check (length(trim(action)) between 1 and 1000),
  due_date date not null,
  owner_operator_id uuid not null references public.workforce_operators(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN','DONE','CANCELLED')),
  source_interaction_id uuid references public.contact_interactions(id) on delete restrict,
  is_demo boolean not null default false,
  created_by_operator_id uuid not null references public.workforce_operators(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_operator_id uuid references public.workforce_operators(id) on delete restrict,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 1000),
  check ((status = 'OPEN') = (resolved_at is null)),
  check ((status = 'OPEN') = (resolved_by_operator_id is null))
);
create index company_next_actions_open_idx on public.company_next_actions(due_date, company_id) where status = 'OPEN';
create index company_next_actions_company_idx on public.company_next_actions(company_id, created_at desc);

-- Only an OPEN action may be resolved, and only its resolution fields may change; nothing is ever deleted.
create function public.guard_company_next_action_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'company_next_actions rows are never deleted'; end if;
  if old.status <> 'OPEN' then raise exception 'a resolved company next action is immutable'; end if;
  if new.id <> old.id or new.company_id <> old.company_id or new.action <> old.action or new.due_date <> old.due_date
     or new.owner_operator_id <> old.owner_operator_id or new.source_interaction_id is distinct from old.source_interaction_id
     or new.is_demo <> old.is_demo or new.created_by_operator_id <> old.created_by_operator_id or new.created_at <> old.created_at then
    raise exception 'only the resolution of a company next action may change';
  end if;
  return new;
end;
$$;
create trigger company_next_actions_guard before update or delete on public.company_next_actions
  for each row execute function public.guard_company_next_action_update();

alter table public.company_next_actions enable row level security;
revoke all on public.company_next_actions from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.company_next_actions from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.company_next_actions from authenticated; end if;
end $$;
grant select, insert on public.company_next_actions to fly_workforce_runtime;
grant update (status, resolved_at, resolved_by_operator_id, resolution_note) on public.company_next_actions to fly_workforce_runtime;
create policy fly_workforce_runtime_select on public.company_next_actions for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.company_next_actions for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_update on public.company_next_actions for update to fly_workforce_runtime using (status = 'OPEN') with check (true);
