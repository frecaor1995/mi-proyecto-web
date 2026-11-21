-- MATCHING-B1-C: minimum demand-readiness schema for the future
-- deterministic worker-matching engine (MATCHING-B1-A/B1-B certified
-- design). The canonical workforce taxonomy foundation owns the shared
-- demand columns and their foreign keys. This migration adds only the
-- matching-specific index and runtime write capability. role_type is left
-- completely alone as a legacy/display-only field. Matching reads trade_code/
-- occupation_code exclusively; it must never read role_type.

create index demand_signals_trade_occupation_idx on public.demand_signals(trade_code, occupation_code);

-- MATCHING-B1-C / C5: the published SECURITY-RUNTIME-B2 migration granted
-- fly_workforce_runtime only SELECT+INSERT on demand_skill_requirements
-- and demand_credential_requirements -- sufficient for the existing
-- ingestion upsert path (which only ever inserts/updates individual rows
-- via ON CONFLICT), but not for this migration's replace-semantics write
-- path (delete the demand's existing requirement rows, then insert the
-- supplied current set, in one transaction), which needs DELETE. This is
-- the single narrowly-scoped additional grant B1-C requires: DELETE only,
-- on these two tables only, to fly_workforce_runtime only. No other
-- table's grants change. No anon/authenticated grant is added. No
-- existing policy is weakened or removed.
grant delete on public.demand_skill_requirements, public.demand_credential_requirements to fly_workforce_runtime;
create policy fly_workforce_runtime_delete on public.demand_skill_requirements for delete to fly_workforce_runtime using (true);
create policy fly_workforce_runtime_delete on public.demand_credential_requirements for delete to fly_workforce_runtime using (true);
