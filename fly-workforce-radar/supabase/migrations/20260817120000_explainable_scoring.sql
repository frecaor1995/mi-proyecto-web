begin;
create type score_state as enum('SCORED','NOT_SCORABLE');
alter table score_result_snapshots add column score_state score_state,add column as_of timestamptz,add column eligibility_snapshot_ids uuid[] not null default '{}';
update score_result_snapshots set score_state=case when score_value is null then 'NOT_SCORABLE'::score_state else 'SCORED'::score_state end,as_of=calculated_at where score_state is null or as_of is null;
alter table score_result_snapshots alter column score_state set not null,alter column as_of set not null,add constraint manpower_score_range_check check((score_state='NOT_SCORABLE' and score_value is null)or(score_state='SCORED' and score_value between 0 and 100))not valid;
create function prevent_score_snapshot_mutation()returns trigger language plpgsql as $$begin raise exception 'score_result_snapshots is append-only';end;$$;
create trigger score_snapshots_append_only before update or delete on score_result_snapshots for each row execute function prevent_score_snapshot_mutation();
create index score_snapshot_time_idx on score_result_snapshots(opportunity_id,score_name,as_of desc,calculated_at desc);
commit;
