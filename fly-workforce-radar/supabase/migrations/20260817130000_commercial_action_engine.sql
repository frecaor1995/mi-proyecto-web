begin;
create type commercial_action as enum('CALL_TODAY','EMAIL_TODAY','CONTACT_RECRUITER','REGISTER_AS_VENDOR','VERIFY_CONTACT','VERIFY_MANPOWER_ACCEPTANCE','RESEARCH_PROJECT','RESOLVE_CONFLICT','WAIT');
create table commercial_action_snapshots(id uuid primary key default gen_random_uuid(),opportunity_id uuid not null references opportunities(id),action commercial_action not null,rule_version text not null,result jsonb not null default '{}',evaluated_at timestamptz not null,as_of timestamptz not null,created_at timestamptz not null default now());
create function prevent_commercial_action_snapshot_mutation()returns trigger language plpgsql as $$begin raise exception 'commercial_action_snapshots is append-only';end;$$;
create trigger commercial_action_snapshots_append_only before update or delete on commercial_action_snapshots for each row execute function prevent_commercial_action_snapshot_mutation();
create index commercial_action_snapshot_time_idx on commercial_action_snapshots(opportunity_id,as_of desc,evaluated_at desc);
commit;
