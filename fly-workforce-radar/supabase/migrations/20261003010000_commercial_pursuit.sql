-- Phase 3A (LOCAL, additive): commercial pursuit on top of the existing opportunity graph.
-- DEMAND  : commercial_pain_signals  — why an organization may need labor (observed / reported / inferred), with
--           provenance through raw_evidence and, for worker referrals, two separate consents.
-- PURSUIT : commercial_activities    — what Fly does (human-performed; the software only records), access channel,
--           outcome, next action, offer hypothesis; plus commercial_pursuit_roles (pain owner vs commercial contact).
-- RESULT  : outcomes / results recorded on activities from real human interaction only.
-- Stage and max stage reached are DERIVED from this append-only history (no mutable stage column).
-- Staff requests are demand_signals (publisher_type 'STAFF_REQUEST') linked to the opportunity, so the existing
-- matching engine evaluates them unchanged. Human referrals enter Contact Intelligence as contact_candidates.
begin;

create function public.prevent_commercial_pursuit_mutation() returns trigger
  language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
revoke all on function public.prevent_commercial_pursuit_mutation() from public;

-- ---------------------------------------------------------------------------------------------------------
-- DEMAND: pain / need evidence
create table public.commercial_pain_signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete restrict,
  pain_type text not null check (pain_type in (
    'OPEN_ROLES_PERSISTENT', 'JOB_REPOSTED', 'STAFFING_AGENCY_BACKLOG', 'WORKER_REFERRAL', 'WORKFORCE_EXIT', 'PROJECT_LOAD',
    'PERMIT_LOAD', 'ABSENCE_COVERAGE', 'INBOUND_REQUEST', 'OTHER', 'UNKNOWN')),
  assertion_basis text not null check (assertion_basis in ('OBSERVED', 'REPORTED', 'INFERRED')),
  status text not null check (status in ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
  summary text not null check (length(summary) between 1 and 2000),
  source_kind text not null check (source_kind in ('PUBLIC_SOURCE', 'WORKER_REPORT', 'HUMAN_INTERACTION', 'OPERATOR_OBSERVATION', 'DEMAND_SIGNAL')),
  source_url text check (source_url is null or length(source_url) <= 2000),
  raw_evidence_id uuid not null references public.raw_evidence(id) on delete restrict,
  demand_signal_id uuid references public.demand_signals(id) on delete restrict,
  observed_at timestamptz,
  recorded_at timestamptz not null default now(),
  entered_by_kind text not null check (entered_by_kind in ('HUMAN', 'SOFTWARE')),
  recorded_by_operator_id uuid references public.workforce_operators(id) on delete restrict,
  supersedes_id uuid references public.commercial_pain_signals(id) on delete restrict,
  -- worker referral (professional/commercial facts only; no identity documents or private worker data)
  reported_by_worker_id uuid references public.workforce_workers(id) on delete restrict,
  site_text text check (site_text is null or length(site_text) <= 300),
  city text check (city is null or length(city) <= 120),
  state text check (state is null or length(state) <= 40),
  supervisor_name text check (supervisor_name is null or length(supervisor_name) <= 200),
  supervisor_title text check (supervisor_title is null or length(supervisor_title) <= 200),
  needed_headcount integer check (needed_headcount is null or needed_headcount > 0),
  needed_role_text text check (needed_role_text is null or length(needed_role_text) <= 300),
  consent_use_intelligence boolean,
  consent_identify_worker boolean,
  check (company_id is not null or opportunity_id is not null),
  check (entered_by_kind = 'SOFTWARE' or recorded_by_operator_id is not null),
  check ((pain_type = 'WORKER_REFERRAL') = (reported_by_worker_id is not null)),
  check (pain_type <> 'WORKER_REFERRAL' or (consent_use_intelligence is not null and consent_identify_worker is not null and source_kind = 'WORKER_REPORT' and assertion_basis = 'REPORTED')),
  -- the referral may only be named to the prospect if the intelligence itself may be used
  check (not coalesce(consent_identify_worker, false) or coalesce(consent_use_intelligence, false)),
  -- intelligence the worker did not consent to use can never be verified for commercial use
  check (status <> 'VERIFIED' or consent_use_intelligence is distinct from false)
);
create unique index commercial_pain_signals_single_successor_idx on public.commercial_pain_signals(supersedes_id) where supersedes_id is not null;
create index commercial_pain_signals_company_idx on public.commercial_pain_signals(company_id);
create index commercial_pain_signals_opportunity_idx on public.commercial_pain_signals(opportunity_id);

-- ---------------------------------------------------------------------------------------------------------
-- PURSUIT / RESULT: human commercial activity log (append-only)
create table public.commercial_activities (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  activity_type text not null check (activity_type in (
    'PURSUIT_STARTED', 'OUTREACH', 'MEETING', 'FOLLOW_UP', 'STAFF_REQUEST_RECEIVED', 'PROPOSAL_SENT', 'CANDIDATES_PRESENTED',
    'RESULT', 'NEXT_ACTION_UPDATE', 'NOTE')),
  access_channel text check (access_channel in (
    'CALL', 'EMAIL', 'WORKER_REFERRAL', 'EXISTING_RELATIONSHIP', 'JOBSITE_VISIT', 'DISTRIBUTOR_REFERRAL', 'INBOUND', 'MEETING', 'OTHER')),
  outcome text check (outcome in (
    'NO_ANSWER', 'VOICEMAIL', 'GATEKEEPER', 'WRONG_PERSON', 'REFERRED_TO_OTHER_PERSON', 'CALL_BACK', 'CONVERSATION',
    'ACCEPTS_EXTERNAL_LABOR', 'DOES_NOT_ACCEPT_EXTERNAL_LABOR', 'NO_CURRENT_NEED', 'VENDOR_REGISTRATION_REQUIRED',
    'STAFF_REQUEST', 'NOT_INTERESTED', 'OTHER')),
  result text check (result in ('WON', 'LOST', 'NO_DECISION')),
  handles_external_workforce text not null default 'UNKNOWN' check (handles_external_workforce in ('YES', 'NO', 'UNKNOWN')),
  contact_candidate_id uuid references public.contact_candidates(id) on delete restrict,
  contact_person_id uuid references public.contact_people(id) on delete restrict,
  contact_name_snapshot text check (contact_name_snapshot is null or length(contact_name_snapshot) <= 200),
  contact_title_snapshot text check (contact_title_snapshot is null or length(contact_title_snapshot) <= 200),
  performed_by_operator_id uuid not null references public.workforce_operators(id) on delete restrict,
  performed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  notes text check (notes is null or length(notes) <= 4000),
  next_action text check (next_action is null or length(next_action) between 1 and 500),
  next_action_due date,
  next_action_owner_operator_id uuid references public.workforce_operators(id) on delete restrict,
  offer_hypothesis text check (offer_hypothesis in (
    'STAFFING_SUBCONTRACTOR', 'ABSENCE_COVERAGE', 'SMALL_TRIAL_CREW', 'TEMP_TO_HIRE', 'EVALUATED_ELECTRICIANS', 'BILINGUAL_CREW', 'OTHER')),
  offer_note text check (offer_note is null or length(offer_note) <= 1000),
  referred_name text check (referred_name is null or length(referred_name) <= 200),
  referred_title text check (referred_title is null or length(referred_title) <= 200),
  referred_department text check (referred_department is null or length(referred_department) <= 200),
  referred_phone text check (referred_phone is null or length(referred_phone) <= 40),
  referred_email text check (referred_email is null or length(referred_email) <= 254),
  referred_candidate_id uuid references public.contact_candidates(id) on delete restrict,
  contact_interaction_id uuid references public.contact_interactions(id) on delete restrict,
  staff_request_demand_signal_id uuid references public.demand_signals(id) on delete restrict,
  -- contact activities carry how Fly reached the organization and what happened
  check (activity_type not in ('OUTREACH', 'MEETING', 'FOLLOW_UP') or (access_channel is not null and outcome is not null)),
  check ((activity_type = 'RESULT') = (result is not null)),
  -- while a pursuit stays open every recorded step carries the next action, its date and its owner
  check (activity_type in ('RESULT', 'NOTE') or (next_action is not null and next_action_due is not null and next_action_owner_operator_id is not null)),
  check ((next_action is null) = (next_action_due is null) and (next_action is null) = (next_action_owner_operator_id is null)),
  check (outcome is distinct from 'REFERRED_TO_OTHER_PERSON' or referred_name is not null or referred_department is not null),
  check ((outcome = 'STAFF_REQUEST' or activity_type = 'STAFF_REQUEST_RECEIVED') = (staff_request_demand_signal_id is not null))
);
create index commercial_activities_opportunity_idx on public.commercial_activities(opportunity_id, performed_at, recorded_at);
create index commercial_activities_company_idx on public.commercial_activities(company_id, performed_at desc) where company_id is not null;
create index commercial_activities_next_action_idx on public.commercial_activities(next_action_due) where next_action_due is not null;
create unique index commercial_activities_staff_request_idx on public.commercial_activities(staff_request_demand_signal_id) where staff_request_demand_signal_id is not null;

-- Pain owner (experiences the operational problem) vs primary commercial contact (route to buying authority).
-- Designation never changes Contact Intelligence states; buyer authority stays evidence-based there.
create table public.commercial_pursuit_roles (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  role text not null check (role in ('PAIN_OWNER', 'COMMERCIAL_CONTACT')),
  person_name text not null check (length(person_name) between 1 and 200),
  person_title text check (person_title is null or length(person_title) <= 200),
  contact_candidate_id uuid references public.contact_candidates(id) on delete restrict,
  contact_person_id uuid references public.contact_people(id) on delete restrict,
  basis text not null check (length(basis) between 1 and 600),
  source_activity_id uuid references public.commercial_activities(id) on delete restrict,
  source_pain_signal_id uuid references public.commercial_pain_signals(id) on delete restrict,
  recorded_by_operator_id uuid not null references public.workforce_operators(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create index commercial_pursuit_roles_opportunity_idx on public.commercial_pursuit_roles(opportunity_id, role, recorded_at);

do $$
declare t text;
begin
  foreach t in array array['commercial_pain_signals', 'commercial_activities', 'commercial_pursuit_roles'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.prevent_commercial_pursuit_mutation()', t || '_append_only', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    execute format('grant select, insert on public.%I to fly_workforce_runtime', t);
    execute format('create policy fly_workforce_runtime_select on public.%I for select to fly_workforce_runtime using (true)', t);
    execute format('create policy fly_workforce_runtime_insert on public.%I for insert to fly_workforce_runtime with check (true)', t);
  end loop;
end $$;

-- Human referrals enter Contact Intelligence as person candidates with human provenance (state rules unchanged).
alter table public.contact_candidates drop constraint contact_candidates_provider_check;
alter table public.contact_candidates add constraint contact_candidates_provider_check
  check (provider = any (array['SIGNAL_SOURCE', 'OFFICIAL_WEBSITE', 'PUBLIC_PROCUREMENT_DOCUMENT', 'HUNTER_DOMAIN_SEARCH', 'WEB_SEARCH_RESULT', 'HUMAN_INTERACTION']));
alter table public.contact_candidates drop constraint contact_candidates_source_type_check;
alter table public.contact_candidates add constraint contact_candidates_source_type_check
  check (source_type is null or source_type = any (array['OFFICIAL_SITE', 'PROCUREMENT_DOCUMENT', 'PRESS_RELEASE', 'NEWS_ARTICLE',
    'PROFESSIONAL_PROFILE_LISTING', 'DIRECTORY_LISTING', 'PROVIDER', 'SIGNAL_DOCUMENT', 'HUMAN_REFERRAL']));

commit;
