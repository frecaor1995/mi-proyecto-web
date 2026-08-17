begin;

create type company_resolution_result as enum (
  'RESOLVED_EXACT', 'RESOLVED_ALIAS', 'AMBIGUOUS', 'UNRESOLVED'
);
create type company_resolution_method as enum (
  'NORMALIZED_NAME', 'VERIFIED_ALIAS', 'MANUAL_OVERRIDE', 'NO_MATCH', 'PLACEHOLDER_REJECTED'
);

alter table companies
  add column normalized_legal_name text,
  add column normalized_common_name text,
  add column merged_into_company_id uuid references companies(id) on delete restrict,
  add column merge_metadata jsonb not null default '{}'::jsonb,
  add constraint companies_not_merged_into_self_check
    check (merged_into_company_id is null or merged_into_company_id <> id);

alter table company_aliases
  add column normalized_alias text,
  add column original_observed_alias text,
  add column verification_state verification_state not null default 'UNVERIFIED',
  add column evidence_id uuid references raw_evidence(id) on delete restrict,
  add column first_seen_at timestamptz,
  add column last_seen_at timestamptz,
  add column superseded_by_alias_id uuid references company_aliases(id) on delete restrict,
  add column alias_metadata jsonb not null default '{}'::jsonb,
  add constraint company_aliases_seen_order_check
    check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at);

create table company_resolution_audits (
  id uuid primary key default gen_random_uuid(),
  observed_text text not null check (length(trim(observed_text)) > 0),
  normalized_text text,
  result company_resolution_result not null,
  method company_resolution_method not null,
  candidate_company_id uuid references companies(id) on delete restrict,
  candidate_company_ids jsonb not null default '[]'::jsonb,
  actor text not null check (length(trim(actor)) > 0),
  resolved_at timestamptz not null,
  evidence_id uuid references raw_evidence(id) on delete restrict,
  claim_id uuid references claims(id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  confidence_metadata jsonb not null default '{}'::jsonb,
  supersedes_resolution_id uuid references company_resolution_audits(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((result in ('RESOLVED_EXACT', 'RESOLVED_ALIAS')) = (candidate_company_id is not null))
);

create table company_alias_assignment_events (
  id uuid primary key default gen_random_uuid(),
  alias_id uuid not null references company_aliases(id) on delete restrict,
  prior_company_id uuid references companies(id) on delete restrict,
  new_company_id uuid not null references companies(id) on delete restrict,
  actor text not null check (length(trim(actor)) > 0),
  recorded_at timestamptz not null,
  evidence_id uuid references raw_evidence(id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);

create table company_merge_decisions (
  id uuid primary key default gen_random_uuid(),
  source_company_id uuid not null references companies(id) on delete restrict,
  target_company_id uuid not null references companies(id) on delete restrict,
  actor text not null check (length(trim(actor)) > 0),
  decided_at timestamptz not null,
  evidence_id uuid references raw_evidence(id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (source_company_id <> target_company_id)
);

alter table company_roles
  add column assertion_kind assertion_kind not null default 'UNKNOWN',
  add column verification_state verification_state not null default 'UNVERIFIED',
  add column claim_id uuid references claims(id) on delete restrict,
  add column asserted_by text,
  add column first_seen_at timestamptz,
  add column last_seen_at timestamptz,
  add column role_basis text,
  add column role_metadata jsonb not null default '{}'::jsonb,
  add constraint company_roles_seen_order_check
    check (last_seen_at is null or first_seen_at is null or last_seen_at >= first_seen_at),
  add constraint company_roles_verified_evidence_check
    check (verification_state <> 'VERIFIED' or raw_evidence_id is not null);

create unique index company_roles_context_identity_idx
  on company_roles (
    company_id, role,
    coalesce(opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(demand_signal_id, '00000000-0000-0000-0000-000000000000'::uuid),
    assertion_kind
  );

create unique index evidence_links_company_role_provenance_unique_idx
  on evidence_links(evidence_id, company_role_id, link_type)
  where company_role_id is not null;

create function prevent_company_resolution_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;
create trigger company_resolution_audits_append_only
before update or delete on company_resolution_audits
for each row execute function prevent_company_resolution_audit_mutation();
create trigger company_alias_assignment_events_append_only
before update or delete on company_alias_assignment_events
for each row execute function prevent_company_resolution_audit_mutation();
create trigger company_merge_decisions_append_only
before update or delete on company_merge_decisions
for each row execute function prevent_company_resolution_audit_mutation();

create index companies_normalized_legal_idx on companies(normalized_legal_name);
create index companies_normalized_common_idx on companies(normalized_common_name);
create index company_aliases_normalized_idx on company_aliases(normalized_alias, verification_state);
create index company_resolution_observed_idx on company_resolution_audits(normalized_text, resolved_at desc);

commit;
