begin;
alter table production_source_executions add column readiness text,add column requested_target text,add column captured_target text,add column retryable boolean,add column observation_id uuid;
create index production_execution_policy_audit_idx on production_source_executions(source_id,policy_decision_id,started_at desc);
commit;
