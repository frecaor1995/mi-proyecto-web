begin;
create type eligibility_type as enum('VAMO_ELIGIBLE','HOT_A_ELIGIBLE','HOT_B_ELIGIBLE');
alter table eligibility_evaluation_snapshots add column eligibility_type eligibility_type,add column as_of timestamptz;
update eligibility_evaluation_snapshots set eligibility_type='VAMO_ELIGIBLE',as_of=evaluated_at where eligibility_type is null or as_of is null;
alter table eligibility_evaluation_snapshots alter column eligibility_type set not null,alter column as_of set not null,add constraint eligibility_result_boolean_check check(jsonb_typeof(result->'eligible')='boolean')not valid;
create function prevent_eligibility_snapshot_mutation()returns trigger language plpgsql as $$begin raise exception 'eligibility_evaluation_snapshots is append-only';end;$$;
create trigger eligibility_snapshots_append_only before update or delete on eligibility_evaluation_snapshots for each row execute function prevent_eligibility_snapshot_mutation();
create index eligibility_snapshot_type_time_idx on eligibility_evaluation_snapshots(opportunity_id,eligibility_type,as_of desc,evaluated_at desc);
commit;
