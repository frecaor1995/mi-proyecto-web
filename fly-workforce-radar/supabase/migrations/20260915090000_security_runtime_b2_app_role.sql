-- SECURITY-RUNTIME-B2: closes the verified opportunity-edge grant gaps and
-- replaces "RLS enabled with zero policies" on the nine tables that trapped
-- fly_workforce_runtime with intentional, role-scoped policies.
--
-- The migration deliberately creates no LOGIN role. fly_workforce_runtime is
-- the portable NOLOGIN permission group established by B0; each environment
-- provisions its own restricted login and grants membership separately.
-- workforce_operators remains untouched -- no write grant, no policy -- per
-- the explicit Manager decision that operator provisioning stays outside the
-- ordinary application runtime surface.

-- Verified (by direct repository inspection) INSERT-only requirement: these
-- five opportunity-edge junction tables are only ever written via
-- PostgresOpportunityRepository.linkEdges()'s `insert ... on conflict do
-- nothing` helper -- no UPDATE call site exists anywhere in the repository.
grant insert on table
  public.opportunity_demand_signals,
  public.opportunity_company_roles,
  public.opportunity_vendor_routes,
  public.opportunity_contact_people,
  public.opportunity_contact_routes
to fly_workforce_runtime;

-- Taxonomy reference tables: read-only for the runtime role. Verified
-- active consumer: postgres-project-intelligence-repository.ts left-joins
-- workforce_trades/workforce_occupations today: without a permitting
-- policy this join silently returns null labels rather than erroring.
create policy fly_workforce_runtime_select on public.workforce_trades for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_select on public.workforce_occupations for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_select on public.workforce_skills for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_select on public.workforce_credentials for select to fly_workforce_runtime using (true);

-- Demand requirement junctions: verified insert-only (ingestion repository),
-- never updated or deleted anywhere in the repository.
create policy fly_workforce_runtime_select on public.demand_skill_requirements for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.demand_skill_requirements for insert to fly_workforce_runtime with check (true);
create policy fly_workforce_runtime_select on public.demand_credential_requirements for select to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_insert on public.demand_credential_requirements for insert to fly_workforce_runtime with check (true);

-- Discovery candidates: verified insert-only (discovery-repository.ts,
-- governed-destination-capture.ts) -- no UPDATE call site found.
-- WORKFORCE PUBLICATION R3-C: Discovery's own migrations are a separate,
-- independently-published feature, not a Workforce Talent dependency --
-- this table is genuinely optional from Workforce Talent's point of view.
-- Guarded with to_regclass() so a fresh database that has NOT yet applied
-- Discovery's migrations still completes this migration cleanly; if/when
-- Discovery's table is present (this local database, or after Discovery's
-- own migrations are applied), the intended policy is created exactly as
-- before. Every mandatory Workforce/runtime statement above and below this
-- block remains unconditional and fail-closed.
do $$ begin
  if to_regclass('public.company_discovery_candidates') is not null then
    execute 'create policy fly_workforce_runtime_select on public.company_discovery_candidates for select to fly_workforce_runtime using (true)';
    execute 'create policy fly_workforce_runtime_insert on public.company_discovery_candidates for insert to fly_workforce_runtime with check (true)';
  end if;
end $$;

-- Discovery runs/run sources: verified select+insert+update usage (status
-- transitions, evidence/finding counters) in the same two files. Same
-- optional-relation guard as company_discovery_candidates above.
do $$ begin
  if to_regclass('public.company_discovery_runs') is not null then
    execute 'create policy fly_workforce_runtime_select on public.company_discovery_runs for select to fly_workforce_runtime using (true)';
    execute 'create policy fly_workforce_runtime_insert on public.company_discovery_runs for insert to fly_workforce_runtime with check (true)';
    execute 'create policy fly_workforce_runtime_update on public.company_discovery_runs for update to fly_workforce_runtime using (true) with check (true)';
  end if;
end $$;
do $$ begin
  if to_regclass('public.company_discovery_run_sources') is not null then
    execute 'create policy fly_workforce_runtime_select on public.company_discovery_run_sources for select to fly_workforce_runtime using (true)';
    execute 'create policy fly_workforce_runtime_insert on public.company_discovery_run_sources for insert to fly_workforce_runtime with check (true)';
    execute 'create policy fly_workforce_runtime_update on public.company_discovery_run_sources for update to fly_workforce_runtime using (true) with check (true)';
  end if;
end $$;
