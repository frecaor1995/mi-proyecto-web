begin;

alter type capture_method add value if not exists 'HUMAN_INTERACTION';
alter type manpower_acceptance_result add value if not exists 'VERIFIED_POSITIVE';
alter type manpower_acceptance_result add value if not exists 'VERIFIED_NEGATIVE';

-- PostgreSQL requires newly-added enum values to be committed before use in
-- constraints or inserted rows. Keep this compatibility boundary explicit.
commit;
begin;

insert into source_types(code,description,is_system) values
  ('HUMAN_INTERACTION','Approved human conversation or written-response artifact',true)
on conflict(code)do nothing;

alter table manpower_acceptance_evaluations drop constraint if exists manpower_acceptance_evaluations_check;
alter table manpower_acceptance_evaluations add constraint manpower_acceptance_evaluations_supported_result_check check(
  (result in('VERIFIED','VERIFIED_POSITIVE','VERIFIED_NEGATIVE')
    and cardinality(supporting_claim_ids)>0 and cardinality(supporting_evidence_ids)>0
    and cardinality(qualifying_categories)>0)
  or result in('NOT_VERIFIED','INSUFFICIENT_EVIDENCE','STALE')
)not valid;

create type human_verification_task_status as enum(
  'OPEN','ASSIGNED','ATTEMPTED','AWAITING_RESPONSE','FOLLOW_UP_REQUIRED',
  'READY_FOR_ASSESSMENT','READY_FOR_APPROVAL','COMPLETED','CANCELLED','DUPLICATE','UNRESOLVABLE'
);
create type human_verification_question_type as enum(
  'CLAIM_CONFIRMATION','BLOCKER_RESOLUTION','CONTACT_ROUTE','CONTACT_AUTHORITY',
  'MANPOWER_ACCEPTANCE','RELATIONSHIP','QUALIFICATION_REQUIREMENT','OTHER'
);
create type human_interaction_method as enum('PHONE','EMAIL','IN_PERSON','VIDEO','OTHER');
create type human_interaction_direction as enum('OUTBOUND','INBOUND');
create type human_interaction_outcome as enum(
  'NO_ANSWER','VOICEMAIL_LEFT','WRONG_NUMBER','EMAIL_SENT','EMAIL_BOUNCED',
  'RECEPTION_REACHED','TRANSFERRED','REFERRAL_RECEIVED','DECISION_MAKER_REACHED',
  'EMAIL_RESPONSE_RECEIVED','CONVERSATION_COMPLETED','DECLINED_TO_ANSWER'
);
create type human_answer_disposition as enum(
  'AFFIRMATIVE','NEGATIVE','REFERRAL','CONFIDENTIAL_NO_DISCLOSURE',
  'UNKNOWN_DONT_KNOW','QUALIFIED_OR_CONDITIONAL','OTHER'
);
create type human_commercial_mechanism as enum(
  'DIRECT_EXTERNAL_MANPOWER','MSP_OR_STAFFING_PROGRAM','FULL_SCOPE_SUBCONTRACTORS_ONLY',
  'DIRECT_HIRE_INTERNAL_ONLY','NO_EXTERNAL_MANPOWER','WORKFORCE_PARTNER_OR_SUBVENDOR',
  'RECRUITING_ONLY','PAYROLL_ONLY','OTHER_MECHANISM','MECHANISM_UNKNOWN'
);
create type human_authority_level as enum(
  'UNKNOWN','ROUTING_ONLY','SUBJECT_MATTER_INFORMED','PROCESS_PARTICIPANT',
  'DECISION_PATH_AUTHORITY','AUTHORIZED_COMPANY_AUTHORITY'
);
create type human_assessment_approval_state as enum(
  'PROPOSED','HUMAN_REVIEW_REQUIRED','APPROVED','REJECTED','NEEDS_MORE_EVIDENCE','SUPERSEDED'
);
create type human_actor_kind as enum('HUMAN','SOFTWARE');
create type human_verification_task_event_type as enum(
  'CREATED','STATE_CHANGED','ASSIGNED','DUE_DATE_CHANGED','FOLLOW_UP_CREATED','MATERIAL_CHANGE'
);

create table human_verification_tasks(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id)on delete restrict,
  opportunity_id uuid references opportunities(id)on delete restrict,
  project_id uuid references projects(id)on delete restrict,
  claim_id uuid references claims(id)on delete restrict,
  contact_person_id uuid references contact_people(id)on delete restrict,
  contact_route_id uuid references contact_routes(id)on delete restrict,
  parent_task_id uuid references human_verification_tasks(id)on delete restrict,
  target_type human_verification_target_type not null,
  target_id uuid not null,
  verification_objective text not null check(length(trim(verification_objective))>0),
  question_type human_verification_question_type not null,
  primary_question text not null check(length(trim(primary_question))>0),
  follow_up_question text,
  blocker_code text,
  preferred_method human_interaction_method,
  assigned_operator_id text,
  trade_id text,
  occupation_id text,
  scope jsonb not null check(jsonb_typeof(scope)='object'),
  packet_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(packet_snapshot)='object'),
  deduplication_key text not null check(length(trim(deduplication_key))>0),
  status human_verification_task_status not null default 'OPEN',
  due_at timestamptz,
  closed_at timestamptz,
  created_by text not null check(length(trim(created_by))>0),
  rule_version text not null check(length(trim(rule_version))>0),
  created_at timestamptz not null default now(),
  check(parent_task_id is null or parent_task_id<>id),
  check((status in('COMPLETED','CANCELLED','DUPLICATE','UNRESOLVABLE'))=(closed_at is not null))
);

create table human_interactions(
  id uuid primary key default gen_random_uuid(),
  verification_task_id uuid not null references human_verification_tasks(id)on delete restrict,
  contact_route_id uuid references contact_routes(id)on delete restrict,
  contact_person_id uuid references contact_people(id)on delete restrict,
  company_represented_id uuid references companies(id)on delete restrict,
  interaction_method human_interaction_method not null,
  interaction_outcome human_interaction_outcome not null,
  direction human_interaction_direction,
  attempted_at timestamptz not null,
  operator_id text not null check(length(trim(operator_id))>0),
  route_snapshot jsonb not null check(jsonb_typeof(route_snapshot)='object'),
  reached_human boolean not null,
  person_name_snapshot text,
  person_title_snapshot text,
  department_snapshot text,
  company_represented_text text,
  response_verbatim text,
  response_summary text,
  effective_date_stated timestamptz,
  artifact_storage_reference text,
  consent_or_recording_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check(interaction_outcome not in('NO_ANSWER','VOICEMAIL_LEFT','EMAIL_SENT','EMAIL_BOUNCED') or reached_human=false),
  check(interaction_outcome not in('RECEPTION_REACHED','TRANSFERRED','REFERRAL_RECEIVED','DECISION_MAKER_REACHED','EMAIL_RESPONSE_RECEIVED','CONVERSATION_COMPLETED','DECLINED_TO_ANSWER') or reached_human=true),
  check(interaction_outcome not in('NO_ANSWER','VOICEMAIL_LEFT','EMAIL_SENT','EMAIL_BOUNCED') or response_verbatim is null)
);

create table human_response_assessments(
  id uuid primary key default gen_random_uuid(),
  interaction_id uuid not null references human_interactions(id)on delete restrict,
  company_id uuid references companies(id)on delete restrict,
  project_id uuid references projects(id)on delete restrict,
  opportunity_id uuid references opportunities(id)on delete restrict,
  proposed_evidence_id uuid references raw_evidence(id)on delete restrict,
  supersedes_assessment_id uuid unique references human_response_assessments(id)on delete restrict,
  answer_disposition human_answer_disposition not null,
  commercial_mechanism human_commercial_mechanism,
  authority_level human_authority_level not null,
  authority_basis text not null check(length(trim(authority_basis))>0),
  scope jsonb not null check(jsonb_typeof(scope)='object'),
  geographic_scope text,
  trade_id text,
  occupation_id text,
  effective_from timestamptz,
  effective_until timestamptz,
  confidence numeric(5,4) not null check(confidence between 0 and 1),
  supported_claim_candidates jsonb not null default '[]'::jsonb check(jsonb_typeof(supported_claim_candidates)='array'),
  unsupported_claims text[] not null default '{}',
  unresolved_claims text[] not null default '{}',
  conflict_ids uuid[] not null default '{}',
  follow_up_required boolean not null default false,
  follow_up_target text,
  assessment_notes text,
  assessed_by text not null check(length(trim(assessed_by))>0),
  assessor_kind human_actor_kind not null,
  assessed_at timestamptz not null,
  approval_state human_assessment_approval_state not null,
  approved_by text,
  rule_version text not null check(length(trim(rule_version))>0),
  created_at timestamptz not null default now(),
  check(supersedes_assessment_id is null or supersedes_assessment_id<>id),
  check(effective_until is null or effective_from is null or effective_until>=effective_from),
  check(approval_state<>'APPROVED' or(assessor_kind='HUMAN' and length(trim(approved_by))>0)),
  check(not follow_up_required or length(trim(follow_up_target))>0),
  check(answer_disposition<>'OTHER' or length(trim(assessment_notes))>0)
);

create table human_verification_task_events(
  id uuid primary key default gen_random_uuid(),
  verification_task_id uuid not null references human_verification_tasks(id)on delete restrict,
  interaction_id uuid references human_interactions(id)on delete restrict,
  assessment_id uuid references human_response_assessments(id)on delete restrict,
  event_type human_verification_task_event_type not null,
  old_state human_verification_task_status,
  new_state human_verification_task_status,
  reason text not null check(length(trim(reason))>0),
  operator_id text not null check(length(trim(operator_id))>0),
  occurred_at timestamptz not null,
  evidence_ids uuid[] not null default '{}',
  claim_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check(event_type<>'STATE_CHANGED' or(old_state is not null and new_state is not null and old_state<>new_state))
);

create function protect_human_verification_task()returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception '% history cannot be deleted',tg_table_name;end if;
  if old.company_id<>new.company_id or old.target_type<>new.target_type or old.target_id<>new.target_id
    or old.verification_objective<>new.verification_objective or old.question_type<>new.question_type
    or old.primary_question<>new.primary_question or old.follow_up_question is distinct from new.follow_up_question
    or old.created_by<>new.created_by or old.created_at<>new.created_at or old.rule_version<>new.rule_version
    or old.scope<>new.scope or old.packet_snapshot<>new.packet_snapshot or old.deduplication_key<>new.deduplication_key
    or old.parent_task_id is distinct from new.parent_task_id then
    raise exception 'human_verification_tasks immutable task definition cannot be changed';
  end if;
  if old.status in('COMPLETED','CANCELLED','DUPLICATE','UNRESOLVABLE')and new.status<>old.status then
    raise exception 'closed human verification task cannot be reopened';
  end if;
  return new;
end;$$;
create trigger human_verification_task_protection before update or delete on human_verification_tasks for each row execute function protect_human_verification_task();
create trigger human_interactions_append_only before update or delete on human_interactions for each row execute function prevent_human_verification_mutation();
create trigger human_response_assessments_append_only before update or delete on human_response_assessments for each row execute function prevent_human_verification_mutation();
create trigger human_verification_task_events_append_only before update or delete on human_verification_task_events for each row execute function prevent_human_verification_mutation();

create function require_assessable_human_interaction()returns trigger language plpgsql as $$
declare outcome human_interaction_outcome;
begin
  select interaction_outcome into outcome from human_interactions where id=new.interaction_id;
  if outcome not in('RECEPTION_REACHED','TRANSFERRED','REFERRAL_RECEIVED','DECISION_MAKER_REACHED','EMAIL_RESPONSE_RECEIVED','CONVERSATION_COMPLETED','DECLINED_TO_ANSWER')then
    raise exception 'interaction outcome % cannot have a response assessment',outcome;
  end if;
  return new;
end;$$;
create trigger human_response_assessment_interaction_gate before insert on human_response_assessments for each row execute function require_assessable_human_interaction();

create unique index human_verification_open_task_dedup_idx on human_verification_tasks(deduplication_key)
where status in('OPEN','ASSIGNED','ATTEMPTED','AWAITING_RESPONSE','FOLLOW_UP_REQUIRED','READY_FOR_ASSESSMENT','READY_FOR_APPROVAL');
create index human_verification_task_queue_idx on human_verification_tasks(status,due_at,assigned_operator_id);
create index human_verification_task_company_idx on human_verification_tasks(company_id,created_at desc);
create index human_verification_task_opportunity_idx on human_verification_tasks(opportunity_id,created_at desc)where opportunity_id is not null;
create index human_verification_task_parent_idx on human_verification_tasks(parent_task_id)where parent_task_id is not null;
create index human_interaction_task_time_idx on human_interactions(verification_task_id,attempted_at,created_at);
create index human_interaction_route_time_idx on human_interactions(contact_route_id,attempted_at desc)where contact_route_id is not null;
create index human_assessment_interaction_time_idx on human_response_assessments(interaction_id,assessed_at,created_at);
create index human_assessment_review_queue_idx on human_response_assessments(approval_state,assessed_at);
create index human_task_event_history_idx on human_verification_task_events(verification_task_id,occurred_at,created_at);

commit;
