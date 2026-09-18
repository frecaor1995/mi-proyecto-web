-- MATCHING-B1-C: minimum demand-readiness schema for the future
-- deterministic worker-matching engine (MATCHING-B1-A/B1-B certified
-- design). Purely additive -- every new column is nullable, no existing
-- row is touched, no backfill runs, and role_type is left completely
-- alone as a legacy/display-only field. Matching reads trade_code/
-- occupation_code exclusively; it must never read role_type.
--
-- COLLISION DEBT (tracked, not resolved here): the excluded, unpublished
-- 20260914094253_canonical_multi_profession_demand.sql independently adds
-- its own demand_signals.trade_code / occupation_code /
-- minimum_experience_months / start_date / expected_end_date columns
-- (plus several others this migration does not touch: travel_required,
-- relocation_required, shift, hours_per_day, hours_per_week,
-- duration_text, demand_status, verification_state, last_verified_at,
-- evidence_tier). If that excluded migration is ever published as-is
-- after this one, its "add column trade_code ..." / "add column
-- occupation_code ..." / "add column minimum_experience_months ..." /
-- "add column start_date ..." statements will fail with a duplicate-
-- column error, because this migration will have already added them.
-- Reconciling that file (dropping its now-redundant column additions,
-- keeping only what this migration does not cover) is a prerequisite for
-- ever publishing it, exactly as MATCHING-B1-B already flagged for the
-- taxonomy tables. Not resolved here per explicit instruction not to
-- edit the excluded migration.

alter table public.demand_signals
  add column trade_code text references public.workforce_trades(code),
  add column occupation_code text,
  add column minimum_experience_months integer check (minimum_experience_months >= 0),
  add column start_date date,
  add constraint demand_signals_occupation_trade_fk
    foreign key (occupation_code, trade_code) references public.workforce_occupations(code, trade_code);

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
