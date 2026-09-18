-- SECURITY-RLS-B0: close the public Data API grant surface without
-- mechanically enabling RLS or adding placeholder policies.
--
-- Runtime database access remains separate from migration ownership. This
-- group role deliberately has no login credential; infrastructure must
-- provision a login role and grant it membership only after compatibility
-- validation.

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all routines in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on routines from anon, authenticated;

alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on routines from anon, authenticated;

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'fly_workforce_runtime') then
    create role fly_workforce_runtime
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      nobypassrls;
  end if;
end
$role$;

grant usage on schema public to fly_workforce_runtime;
grant select on all tables in schema public to fly_workforce_runtime;
grant usage, select on all sequences in schema public to fly_workforce_runtime;

-- Controlled application and ingestion writes observed in server repositories.
grant insert, update on table
  public.burden_profile_versions,
  public.claim_state_transitions,
  public.claims,
  public.command_idempotency_keys,
  public.commercial_action_snapshots,
  public.commercial_terms_versions,
  public.companies,
  public.company_alias_assignment_events,
  public.company_aliases,
  public.company_merge_decisions,
  public.company_resolution_audits,
  public.company_roles,
  public.contact_people,
  public.contact_route_grade_evaluations,
  public.contact_routes,
  public.demand_credential_requirements,
  public.demand_signals,
  public.demand_skill_requirements,
  public.economic_decisions,
  public.economics_scenario_snapshots,
  public.eligibility_evaluation_snapshots,
  public.evidence_links,
  public.evidence_status_events,
  public.evidence_supersessions,
  public.human_interactions,
  public.human_response_assessments,
  public.human_verification_decision_evidence,
  public.human_verification_decisions,
  public.human_verification_task_events,
  public.human_verification_tasks,
  public.ingestion_attempts,
  public.manpower_acceptance_evaluations,
  public.opportunities,
  public.opportunity_claims,
  public.opportunity_companies,
  public.opportunity_completeness_snapshots,
  public.opportunity_evidence,
  public.production_adapter_registrations,
  public.production_source_executions,
  public.raw_evidence,
  public.score_result_snapshots,
  public.source_capture_policy_decisions,
  public.source_health_events,
  public.source_observation_identities,
  public.source_yield_measurements,
  public.sources
to fly_workforce_runtime;

-- WORKFORCE PUBLICATION R3-R2: Discovery's own tables are a separate,
-- independently-published feature, not a Workforce Talent dependency --
-- genuinely optional from this migration's point of view. Guarded with
-- to_regclass() so a fresh database that has not yet applied Discovery's
-- migrations still completes this migration cleanly; if/when Discovery's
-- tables are present, the intended insert/update grant is applied exactly
-- as it would be unconditionally. Every mandatory relation above remains
-- unconditional and fail-closed.
do $$ begin
  if to_regclass('public.company_discovery_candidates') is not null then
    execute 'grant insert, update on table public.company_discovery_candidates to fly_workforce_runtime';
  end if;
  if to_regclass('public.company_discovery_run_sources') is not null then
    execute 'grant insert, update on table public.company_discovery_run_sources to fly_workforce_runtime';
  end if;
  if to_regclass('public.company_discovery_runs') is not null then
    execute 'grant insert, update on table public.company_discovery_runs to fly_workforce_runtime';
  end if;
end $$;

-- Security administration and destructive operations remain outside the
-- runtime role. In particular, it receives no write privilege on
-- workforce_operators and no DELETE/TRUNCATE/REFERENCES/TRIGGER privileges.
