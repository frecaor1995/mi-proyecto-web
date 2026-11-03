-- Restore the intended six-hour discovery cadence for the multi-trade cycle profile (4 cycles/day,
-- 10 queries per cycle). The existing scheduler and cron endpoint are unchanged; the next due time moves to
-- the start of the current six-hour window so the next scheduler invocation runs on the new cadence.
begin;

update public.opportunity_search_profiles
   set cadence_hours = 6,
       next_run_at = to_timestamp(floor(extract(epoch from now()) / 21600) * 21600),
       updated_at = now()
 where profile_kind = 'MULTI_TRADE_CYCLE' and enabled = true;

commit;
