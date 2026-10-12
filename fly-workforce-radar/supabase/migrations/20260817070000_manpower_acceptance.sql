begin;

create type manpower_acceptance_result as enum (
  'VERIFIED', 'NOT_VERIFIED', 'INSUFFICIENT_EVIDENCE', 'STALE'
);

create table manpower_acceptance_evaluations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  project_id uuid references projects(id) on delete restrict,
  opportunity_id uuid references opportunities(id) on delete restrict,
  result manpower_acceptance_result not null,
  qualifying_categories external_manpower_category[] not null default '{}',
  supporting_claim_ids uuid[] not null default '{}',
  supporting_evidence_ids uuid[] not null default '{}',
  ignored_claim_ids uuid[] not null default '{}',
  evaluated_at timestamptz not null,
  rule_version text not null check (length(trim(rule_version)) > 0),
  valid_until timestamptz,
  reason text not null check (length(trim(reason)) > 0),
  explanation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (num_nonnulls(project_id, opportunity_id) <= 1),
  check (valid_until is null or valid_until > evaluated_at),
  check (
    (result = 'VERIFIED' and cardinality(supporting_claim_ids) > 0
      and cardinality(supporting_evidence_ids) > 0 and cardinality(qualifying_categories) > 0)
    or result <> 'VERIFIED'
  )
);

create function prevent_manpower_acceptance_evaluation_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'manpower_acceptance_evaluations is append-only';
end;
$$;
create trigger manpower_acceptance_evaluations_append_only
before update or delete on manpower_acceptance_evaluations
for each row execute function prevent_manpower_acceptance_evaluation_mutation();

create index manpower_acceptance_company_time_idx
  on manpower_acceptance_evaluations(company_id, evaluated_at desc);
create index manpower_acceptance_project_idx
  on manpower_acceptance_evaluations(project_id, evaluated_at desc)
  where project_id is not null;
create index manpower_acceptance_opportunity_idx
  on manpower_acceptance_evaluations(opportunity_id, evaluated_at desc)
  where opportunity_id is not null;

commit;
