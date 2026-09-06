begin;

-- Phase 4C: persistence for the certified Phase 4B economics domain
-- (EconomicValue<T>/EconomicFactTier/CommercialTermsContract/BurdenProfile/
-- EconomicScenario). All three tables are append-only, immutable-version
-- history -- there is no mutable "current pointer" column anywhere; "current"
-- is always derived as "the newest row not superseded by anything", exactly
-- mirroring the existing source_capture_policy_decisions.getCurrentDecision
-- convention (20260817030000_source_registry_compliance.sql).
--
-- Field-level tier/UNKNOWN-vs-zero fidelity (EconomicValue<T>'s "no `value`
-- key when tier is UNKNOWN" shape) is preserved by storing each contract as
-- a jsonb payload of literal EconomicValue<T> shapes -- the same "structural
-- fields as real columns, business content as jsonb" split every existing
-- snapshot table in this schema already uses (commercial_action_snapshots,
-- eligibility_evaluation_snapshots, ...). No calculation/resolution logic is
-- implemented here; this migration is persistence only.

create table commercial_terms_versions(
  id uuid primary key default gen_random_uuid(),
  context_type text not null check(context_type in('COMPANY','OPPORTUNITY')),
  company_id uuid references companies(id) on delete restrict,
  opportunity_id uuid references opportunities(id) on delete restrict,
  -- terms is a serialized CommercialTermsContract: every field an EconomicValue<T> shape.
  terms jsonb not null check(jsonb_typeof(terms)='object'),
  supporting_claim_ids uuid[] not null default '{}',
  supporting_evidence_ids uuid[] not null default '{}',
  rule_version text not null check(length(trim(rule_version))>0),
  asserted_by text,
  evaluated_at timestamptz not null,
  supersedes_commercial_terms_id uuid references commercial_terms_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(
    (context_type='COMPANY' and company_id is not null and opportunity_id is null) or
    (context_type='OPPORTUNITY' and opportunity_id is not null)
  ),
  check(supersedes_commercial_terms_id is null or supersedes_commercial_terms_id<>id)
);
-- At most one version may supersede a given prior version -- this is the
-- concurrency guard: two concurrent "supersede version X" writers cannot
-- both succeed: the second violates this unique partial index and is
-- rejected safely rather than silently overwriting. Immutable-version
-- history means there is no other race to protect against.
create unique index commercial_terms_supersedes_unique_idx
  on commercial_terms_versions(supersedes_commercial_terms_id)
  where supersedes_commercial_terms_id is not null;
create index commercial_terms_company_idx on commercial_terms_versions(company_id, created_at desc) where company_id is not null;
create index commercial_terms_opportunity_idx on commercial_terms_versions(opportunity_id, created_at desc) where opportunity_id is not null;

create function prevent_commercial_terms_version_mutation()returns trigger language plpgsql as $$
begin raise exception 'commercial_terms_versions is append-only'; end;$$;
create trigger commercial_terms_versions_append_only
  before update or delete on commercial_terms_versions
  for each row execute function prevent_commercial_terms_version_mutation();

create table burden_profile_versions(
  id uuid primary key default gen_random_uuid(),
  scope_level text not null check(scope_level in('PLATFORM_DEFAULT','JURISDICTION','TRADE_OCCUPATION','COMPANY_OVERRIDE','SCENARIO_OVERRIDE')),
  jurisdiction text,
  trade_id text,
  occupation_id text,
  company_id uuid references companies(id) on delete restrict,
  -- Real FK to economics_scenario_snapshots, added via ALTER TABLE at the end
  -- of this migration (after that table exists) to resolve the creation-order
  -- cycle: economics_scenario_snapshots.burden_profile_version_id references
  -- this table, and this column references economics_scenario_snapshots.
  -- Both relationships are intentional; see the ALTER TABLE below.
  scenario_id uuid,
  -- components is a serialized BurdenComponent[]: {type, rate: EconomicValue<Rate>, appliesTo}[].
  components jsonb not null check(jsonb_typeof(components)='array'),
  rule_version text not null check(length(trim(rule_version))>0),
  asserted_by text,
  evaluated_at timestamptz not null,
  supersedes_burden_profile_id uuid references burden_profile_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(supersedes_burden_profile_id is null or supersedes_burden_profile_id<>id),
  check(
    (scope_level='PLATFORM_DEFAULT' and jurisdiction is null and trade_id is null and occupation_id is null and company_id is null and scenario_id is null) or
    (scope_level='JURISDICTION' and jurisdiction is not null and company_id is null and scenario_id is null) or
    (scope_level='TRADE_OCCUPATION' and trade_id is not null and company_id is null and scenario_id is null) or
    (scope_level='COMPANY_OVERRIDE' and company_id is not null and scenario_id is null) or
    (scope_level='SCENARIO_OVERRIDE' and scenario_id is not null)
  )
);
create unique index burden_profile_supersedes_unique_idx
  on burden_profile_versions(supersedes_burden_profile_id)
  where supersedes_burden_profile_id is not null;
create index burden_profile_scope_idx on burden_profile_versions(scope_level, jurisdiction, trade_id, occupation_id, company_id, created_at desc);

create function prevent_burden_profile_version_mutation()returns trigger language plpgsql as $$
begin raise exception 'burden_profile_versions is append-only'; end;$$;
create trigger burden_profile_versions_append_only
  before update or delete on burden_profile_versions
  for each row execute function prevent_burden_profile_version_mutation();

create table economics_scenario_snapshots(
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete restrict,
  scenario_label text not null check(scenario_label in('BASE','CONSERVATIVE','TARGET')),
  commercial_terms_version_id uuid references commercial_terms_versions(id) on delete restrict,
  burden_profile_version_id uuid references burden_profile_versions(id) on delete restrict,
  -- basis captures the full labor/deployment input the scenario was evaluated
  -- against (enough to reproduce what was believed at evaluated_at); result
  -- captures any DerivedEconomicResult values computed at that time -- empty
  -- by default since 4C does not implement the calculation engine.
  basis jsonb not null check(jsonb_typeof(basis)='object'),
  result jsonb not null default '{}'::jsonb check(jsonb_typeof(result)='object'),
  rule_version text not null check(length(trim(rule_version))>0),
  asserted_by text,
  evaluated_at timestamptz not null,
  as_of timestamptz not null,
  supersedes_scenario_id uuid references economics_scenario_snapshots(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(supersedes_scenario_id is null or supersedes_scenario_id<>id)
);
create unique index economics_scenario_supersedes_unique_idx
  on economics_scenario_snapshots(supersedes_scenario_id)
  where supersedes_scenario_id is not null;
create index economics_scenario_opportunity_idx on economics_scenario_snapshots(opportunity_id, scenario_label, created_at desc);

create function prevent_economics_scenario_snapshot_mutation()returns trigger language plpgsql as $$
begin raise exception 'economics_scenario_snapshots is append-only'; end;$$;
create trigger economics_scenario_snapshots_append_only
  before update or delete on economics_scenario_snapshots
  for each row execute function prevent_economics_scenario_snapshot_mutation();

-- Resolves the creation-order cycle noted on burden_profile_versions.scenario_id
-- above: economics_scenario_snapshots now exists, so the real FK can be added.
-- ON DELETE RESTRICT (not CASCADE): a scenario must never be deletable out
-- from under a burden-profile version that records it as its scope basis --
-- historical economics must not silently lose its basis. This is a plain ALTER
-- TABLE ADD CONSTRAINT (DDL), which does not fire the row-level append-only
-- triggers on either table, so it does not weaken append-only enforcement.
alter table burden_profile_versions
  add constraint burden_profile_versions_scenario_id_fkey
  foreign key (scenario_id) references economics_scenario_snapshots(id) on delete restrict;

commit;
