alter type contact_route_type add value if not exists 'PROFESSIONAL_PHONE';
alter type contact_route_type add value if not exists 'PROFESSIONAL_EMAIL';
alter type contact_route_type add value if not exists 'RECRUITER_PHONE';
alter type contact_route_type add value if not exists 'RECRUITER_EMAIL';
alter type contact_route_type add value if not exists 'OFFICE_PHONE';
alter type contact_route_type add value if not exists 'SUPPLIER_PORTAL';
alter type contact_route_type add value if not exists 'VENDOR_REGISTRATION';
alter type contact_route_type add value if not exists 'CONTACT_FORM';
alter type contact_route_type add value if not exists 'PROCUREMENT_PHONE';
alter type contact_route_type add value if not exists 'PROCUREMENT_EMAIL';

begin;
create type contact_function as enum ('RECRUITER','CRAFT_RECRUITER','TALENT_ACQUISITION','WORKFORCE','PROCUREMENT','SUBCONTRACTS','SUPPLIER_MANAGEMENT','PROJECT_MANAGEMENT','CONSTRUCTION_MANAGEMENT','OPERATIONS','HR','GENERAL_OFFICE','OTHER');
create type contact_language_status as enum ('UNKNOWN','SPANISH_CONFIRMED','BILINGUAL_CONFIRMED');

alter table contact_people
  add column normalized_name text,
  add column department text,
  add column contact_function contact_function not null default 'OTHER',
  add column evidence_id uuid references raw_evidence(id) on delete restrict,
  add column language_status contact_language_status not null default 'UNKNOWN',
  add column language_evidence_id uuid references raw_evidence(id) on delete restrict,
  add column notes text,
  add column contact_metadata jsonb not null default '{}'::jsonb,
  add column person_identity_key text,
  add constraint contact_people_verified_evidence_check check (verification_state <> 'VERIFIED' or evidence_id is not null),
  add constraint contact_people_language_evidence_check check (language_status = 'UNKNOWN' or language_evidence_id is not null);

alter table contact_routes
  add column observed_target text,
  add column normalized_target text,
  add column verification_state verification_state not null default 'UNVERIFIED',
  add column evidence_id uuid references raw_evidence(id) on delete restrict,
  add column last_verified_at timestamptz,
  add column verification_due_at timestamptz,
  add column superseded_by_route_id uuid references contact_routes(id) on delete restrict,
  add column route_metadata jsonb not null default '{}'::jsonb,
  add constraint contact_routes_verified_evidence_check check (verification_state <> 'VERIFIED' or (evidence_id is not null and last_verified_at is not null));

create unique index contact_people_identity_idx on contact_people(person_identity_key) where person_identity_key is not null;
create unique index contact_routes_identity_idx on contact_routes(company_id, coalesce(contact_person_id,'00000000-0000-0000-0000-000000000000'::uuid), route_type, normalized_target) where normalized_target is not null and superseded_by_route_id is null;
create unique index evidence_links_contact_person_unique_idx on evidence_links(evidence_id, contact_person_id, link_type) where contact_person_id is not null;
create unique index evidence_links_contact_route_unique_idx on evidence_links(evidence_id, contact_route_id, link_type) where contact_route_id is not null;

create table contact_route_grade_evaluations (
  id uuid primary key default gen_random_uuid(),
  contact_route_id uuid not null references contact_routes(id) on delete restrict,
  grade text not null check (grade in ('A','B','C','D','E')),
  reason text not null check (length(trim(reason)) > 0),
  rule_version text not null check (length(trim(rule_version)) > 0),
  evaluated_at timestamptz not null,
  inputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function prevent_contact_grade_mutation() returns trigger language plpgsql as $$ begin raise exception 'contact_route_grade_evaluations is append-only'; end; $$;
create trigger contact_route_grade_evaluations_append_only before update or delete on contact_route_grade_evaluations for each row execute function prevent_contact_grade_mutation();
create index contact_route_grade_history_idx on contact_route_grade_evaluations(contact_route_id, evaluated_at desc);
commit;
