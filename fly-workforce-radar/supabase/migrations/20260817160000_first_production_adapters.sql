begin;
create table production_adapter_registrations(adapter_id text not null,adapter_version text not null,source_family text not null,capture_method text not null,capabilities text[] not null,parser_id text not null,parser_version text not null,created_at timestamptz not null default now(),primary key(adapter_id,adapter_version));
alter table source_observation_identities add column execution_id uuid references production_source_executions(id),add column evidence_id uuid references raw_evidence(id),add column normalized_observation jsonb not null default '{}';
create index source_observation_evidence_idx on source_observation_identities(evidence_id);
commit;
