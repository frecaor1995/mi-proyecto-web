begin;

create type access_classification as enum (
  'PUBLIC', 'ACCOUNT_REQUIRED', 'RESTRICTED', 'UNKNOWN'
);
create type company_role_kind as enum (
  'OWNER', 'EPC', 'GC', 'ELECTRICAL_CONTRACTOR', 'EMPLOYER',
  'STAFFING_SUPPLIER', 'MANPOWER_BUYER'
);
create type assertion_kind as enum ('FACT', 'INFERENCE', 'UNKNOWN');
create type verification_state as enum ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'STALE');
create type vendor_route_type as enum (
  'SUPPLIER_PORTAL', 'ARIBA', 'TRADE_PARTNER', 'THIRD_PARTY_RECRUITER',
  'REGISTER_FORM', 'PROCUREMENT_EMAIL', 'PROCUREMENT_PHONE', 'OTHER'
);
create type external_manpower_category as enum (
  'STAFFING_VENDOR_ACCEPTED', 'SUPPLEMENTAL_LABOR_ACCEPTED',
  'CONTINGENT_WORKFORCE_ACCEPTED', 'CRAFT_LABOR_VENDOR_ACCEPTED',
  'THIRD_PARTY_RECRUITING_ACCEPTED', 'LABOR_SUBCONTRACTING_ACCEPTED'
);
create type lifecycle_state as enum ('ACTIVE', 'STALE', 'DISABLED', 'UNKNOWN');
create type contact_route_type as enum (
  'PROFESSIONAL_PROFILE', 'CORPORATE_EMAIL', 'CORPORATE_PHONE',
  'CONTACT_FORM', 'OTHER'
);
create type demand_cluster_kind as enum ('POSSIBLE_SHARED_DEMAND_CLUSTER');
create type claim_subject_type as enum (
  'SOURCE', 'RAW_EVIDENCE', 'DEMAND_SIGNAL', 'COMPANY', 'PROJECT',
  'VENDOR_ROUTE', 'CONTACT_PERSON', 'CONTACT_ROUTE', 'DEMAND_CLUSTER', 'OPPORTUNITY'
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  source_type text,
  domain text,
  base_url text,
  access_classification access_classification not null default 'UNKNOWN',
  allowed_capture_methods text[] not null default '{}',
  requires_auth boolean,
  paywalled boolean,
  robots_tos_notes text,
  enabled boolean not null default true,
  yield_metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at)
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text,
  common_name text,
  industry_metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (legal_name is not null or common_name is not null),
  check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at)
);

create table company_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  alias text not null check (length(trim(alias)) > 0),
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text,
  location_text text,
  city text,
  county text,
  state text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  owner_company_id uuid references companies(id) on delete set null,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at)
);

create table raw_evidence (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  source_url text not null check (length(trim(source_url)) > 0),
  captured_at timestamptz not null,
  capture_method text not null check (length(trim(capture_method)) > 0),
  storage_reference text,
  content_hash text not null check (length(trim(content_hash)) > 0),
  extractor_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table demand_signals (
  id uuid primary key default gen_random_uuid(),
  title text,
  role_type text,
  publisher_company_id uuid references companies(id) on delete set null,
  publisher_type text,
  city text,
  county text,
  state text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  pay_currency char(3),
  base_pay_min numeric(12, 2),
  base_pay_max numeric(12, 2),
  pay_period text,
  overtime_available boolean,
  overtime_rate numeric(8, 3),
  overtime_terms text,
  per_diem_available boolean,
  per_diem_amount numeric(12, 2),
  per_diem_frequency text,
  schedule text,
  headcount_estimate integer,
  published_at timestamptz,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  stale_after timestamptz,
  verification_due_at timestamptz,
  source_id uuid references sources(id) on delete restrict,
  raw_evidence_id uuid references raw_evidence(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (base_pay_min is null or base_pay_min >= 0),
  check (base_pay_max is null or base_pay_max >= 0),
  check (base_pay_min is null or base_pay_max is null or base_pay_max >= base_pay_min),
  check (overtime_rate is null or overtime_rate >= 0),
  check (per_diem_amount is null or per_diem_amount >= 0),
  check (headcount_estimate is null or headcount_estimate >= 0),
  check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at)
);

create table vendor_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  route_type vendor_route_type not null,
  target text,
  instructions text,
  lifecycle lifecycle_state not null default 'UNKNOWN',
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  stale_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at)
);

create table contact_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  title text,
  public_professional_profile_url text,
  verification_state verification_state not null default 'UNVERIFIED',
  verified_at timestamptz,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  stale_after timestamptz,
  verification_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at),
  check (verification_state <> 'VERIFIED' or verified_at is not null)
);

create table contact_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_person_id uuid references contact_people(id) on delete restrict,
  route_type contact_route_type not null,
  target text not null check (length(trim(target)) > 0),
  route_grade text,
  lifecycle lifecycle_state not null default 'UNKNOWN',
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  stale_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (route_grade is null or route_grade in ('A', 'B', 'C', 'D', 'E')),
  check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at)
);

create table demand_clusters (
  id uuid primary key default gen_random_uuid(),
  kind demand_cluster_kind not null default 'POSSIBLE_SHARED_DEMAND_CLUSTER',
  is_tentative boolean not null default true check (is_tentative),
  verification_state verification_state not null default 'UNVERIFIED',
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (verification_state <> 'VERIFIED' or verified_at is not null)
);

create table demand_cluster_members (
  cluster_id uuid not null references demand_clusters(id) on delete cascade,
  demand_signal_id uuid not null references demand_signals(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cluster_id, demand_signal_id)
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  title text,
  project_id uuid references projects(id) on delete set null,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  stale_after timestamptz,
  verification_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at)
);

create table company_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  role company_role_kind not null,
  opportunity_id uuid references opportunities(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  demand_signal_id uuid references demand_signals(id) on delete cascade,
  raw_evidence_id uuid references raw_evidence(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(opportunity_id, project_id, demand_signal_id) = 1)
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  subject_type claim_subject_type not null,
  source_id uuid references sources(id) on delete cascade,
  raw_evidence_subject_id uuid references raw_evidence(id) on delete cascade,
  demand_signal_id uuid references demand_signals(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  vendor_route_id uuid references vendor_routes(id) on delete cascade,
  contact_person_id uuid references contact_people(id) on delete cascade,
  contact_route_id uuid references contact_routes(id) on delete cascade,
  demand_cluster_id uuid references demand_clusters(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  predicate text not null check (length(trim(predicate)) > 0),
  external_manpower_category external_manpower_category,
  claim_value jsonb,
  assertion_kind assertion_kind not null,
  verification_state verification_state not null default 'UNVERIFIED',
  asserted_at timestamptz not null default now(),
  asserted_by text,
  supporting_evidence_id uuid references raw_evidence(id) on delete restrict,
  verified_at timestamptz,
  verification_actor_reference text,
  stale_after timestamptz,
  verification_due_at timestamptz,
  notes text,
  audit_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(
    source_id, raw_evidence_subject_id, demand_signal_id, company_id, project_id,
    vendor_route_id, contact_person_id, contact_route_id, demand_cluster_id, opportunity_id
  ) = 1),
  check (
    (subject_type = 'SOURCE' and source_id is not null) or
    (subject_type = 'RAW_EVIDENCE' and raw_evidence_subject_id is not null) or
    (subject_type = 'DEMAND_SIGNAL' and demand_signal_id is not null) or
    (subject_type = 'COMPANY' and company_id is not null) or
    (subject_type = 'PROJECT' and project_id is not null) or
    (subject_type = 'VENDOR_ROUTE' and vendor_route_id is not null) or
    (subject_type = 'CONTACT_PERSON' and contact_person_id is not null) or
    (subject_type = 'CONTACT_ROUTE' and contact_route_id is not null) or
    (subject_type = 'DEMAND_CLUSTER' and demand_cluster_id is not null) or
    (subject_type = 'OPPORTUNITY' and opportunity_id is not null)
  ),
  check (verification_state <> 'VERIFIED' or verified_at is not null)
);

create table opportunity_demand_signals (
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  demand_signal_id uuid not null references demand_signals(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, demand_signal_id)
);
create table opportunity_company_roles (
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  company_role_id uuid not null references company_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, company_role_id)
);
create table opportunity_claims (
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  claim_id uuid not null references claims(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, claim_id)
);
create table opportunity_vendor_routes (
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  vendor_route_id uuid not null references vendor_routes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, vendor_route_id)
);
create table opportunity_contact_people (
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  contact_person_id uuid not null references contact_people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, contact_person_id)
);
create table opportunity_contact_routes (
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  contact_route_id uuid not null references contact_routes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, contact_route_id)
);

create table eligibility_evaluation_snapshots (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  rule_version text not null check (length(trim(rule_version)) > 0),
  result jsonb not null,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table score_result_snapshots (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  score_name text not null check (length(trim(score_name)) > 0),
  rule_version text not null check (length(trim(rule_version)) > 0),
  score_value numeric,
  result jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index company_aliases_company_id_idx on company_aliases(company_id);
create index projects_owner_company_id_idx on projects(owner_company_id);
create index raw_evidence_source_id_captured_at_idx on raw_evidence(source_id, captured_at desc);
create index raw_evidence_content_hash_idx on raw_evidence(content_hash);
create index demand_signals_publisher_company_id_idx on demand_signals(publisher_company_id);
create index demand_signals_source_id_idx on demand_signals(source_id);
create index demand_signals_raw_evidence_id_idx on demand_signals(raw_evidence_id);
create index demand_signals_location_idx on demand_signals(state, city);
create index demand_signals_temporal_idx on demand_signals(last_seen_at, verification_due_at);
create index vendor_routes_company_id_idx on vendor_routes(company_id);
create index contact_people_company_id_idx on contact_people(company_id);
create index contact_routes_company_id_idx on contact_routes(company_id);
create index contact_routes_contact_person_id_idx on contact_routes(contact_person_id);
create index demand_cluster_members_signal_id_idx on demand_cluster_members(demand_signal_id);
create index opportunities_project_id_idx on opportunities(project_id);
create index opportunities_temporal_idx on opportunities(last_seen_at, verification_due_at);
create index company_roles_company_id_role_idx on company_roles(company_id, role);
create index company_roles_opportunity_id_idx on company_roles(opportunity_id);
create index company_roles_project_id_idx on company_roles(project_id);
create index company_roles_demand_signal_id_idx on company_roles(demand_signal_id);
create index claims_source_id_idx on claims(source_id);
create index claims_raw_evidence_subject_id_idx on claims(raw_evidence_subject_id);
create index claims_demand_signal_id_idx on claims(demand_signal_id);
create index claims_company_id_idx on claims(company_id);
create index claims_project_id_idx on claims(project_id);
create index claims_vendor_route_id_idx on claims(vendor_route_id);
create index claims_contact_person_id_idx on claims(contact_person_id);
create index claims_contact_route_id_idx on claims(contact_route_id);
create index claims_demand_cluster_id_idx on claims(demand_cluster_id);
create index claims_opportunity_id_idx on claims(opportunity_id);
create index claims_verification_due_at_idx on claims(verification_state, verification_due_at);
create index claims_external_manpower_category_idx
  on claims(external_manpower_category, verification_state)
  where external_manpower_category is not null;
create index eligibility_snapshots_opportunity_idx
  on eligibility_evaluation_snapshots(opportunity_id, evaluated_at desc);
create index score_snapshots_opportunity_idx
  on score_result_snapshots(opportunity_id, calculated_at desc);

commit;
