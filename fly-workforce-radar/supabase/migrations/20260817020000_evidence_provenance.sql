begin;

create type evidence_status as enum ('ACTIVE', 'SUPERSEDED', 'INVALID');
create type evidence_link_type as enum ('SUPPORTS', 'DERIVED_FROM', 'OBSERVED_IN');

alter table raw_evidence
  add column content_type text,
  add column payload_size_bytes bigint,
  add column http_metadata jsonb,
  add constraint raw_evidence_content_hash_sha256_check
    check (content_hash ~ '^[0-9a-f]{64}$'),
  add constraint raw_evidence_payload_size_check
    check (payload_size_bytes is null or payload_size_bytes >= 0);

create table evidence_status_events (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references raw_evidence(id) on delete restrict,
  status evidence_status not null,
  recorded_at timestamptz not null default now(),
  reason text,
  actor_reference text,
  metadata jsonb not null default '{}'::jsonb
);

create table evidence_supersessions (
  superseded_evidence_id uuid not null references raw_evidence(id) on delete restrict,
  superseding_evidence_id uuid not null references raw_evidence(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  primary key (superseded_evidence_id, superseding_evidence_id),
  check (superseded_evidence_id <> superseding_evidence_id)
);

create table evidence_links (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references raw_evidence(id) on delete restrict,
  link_type evidence_link_type not null default 'SUPPORTS',
  demand_signal_id uuid references demand_signals(id) on delete cascade,
  claim_id uuid references claims(id) on delete cascade,
  company_role_id uuid references company_roles(id) on delete cascade,
  vendor_route_id uuid references vendor_routes(id) on delete cascade,
  contact_person_id uuid references contact_people(id) on delete cascade,
  contact_route_id uuid references contact_routes(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  check (num_nonnulls(
    demand_signal_id, claim_id, company_role_id, vendor_route_id,
    contact_person_id, contact_route_id, project_id, opportunity_id
  ) = 1)
);

create function record_initial_evidence_status()
returns trigger
language plpgsql
as $$
begin
  insert into evidence_status_events (evidence_id, status)
  values (new.id, 'ACTIVE');
  return new;
end;
$$;

create trigger raw_evidence_initial_status
after insert on raw_evidence
for each row execute function record_initial_evidence_status();

create function prevent_raw_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'raw_evidence is append-only; create a new capture instead';
end;
$$;

create trigger raw_evidence_append_only
before update or delete on raw_evidence
for each row execute function prevent_raw_evidence_mutation();

create function enforce_verified_claim_evidence()
returns trigger
language plpgsql
as $$
declare
  target_claim_id uuid;
begin
  if tg_table_name = 'claims' then
    target_claim_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_claim_id := case when tg_op = 'DELETE' then old.claim_id else new.claim_id end;
  end if;

  if target_claim_id is not null and exists (
    select 1
      from claims c
     where c.id = target_claim_id
       and c.verification_state = 'VERIFIED'
       and c.supporting_evidence_id is null
       and not exists (
         select 1 from evidence_links el
          where el.claim_id = c.id
       )
  ) then
    raise exception 'VERIFIED claim % requires at least one evidence link', target_claim_id;
  end if;

  return null;
end;
$$;

create constraint trigger verified_claim_requires_evidence
after insert or update of verification_state, supporting_evidence_id on claims
deferrable initially deferred
for each row execute function enforce_verified_claim_evidence();

create constraint trigger verified_claim_link_must_remain_supported
after delete or update of claim_id, evidence_id on evidence_links
deferrable initially deferred
for each row execute function enforce_verified_claim_evidence();

create index evidence_status_events_evidence_time_idx
  on evidence_status_events(evidence_id, recorded_at desc);
create index evidence_supersessions_superseding_idx
  on evidence_supersessions(superseding_evidence_id);
create index evidence_links_evidence_id_idx on evidence_links(evidence_id);
create index evidence_links_demand_signal_id_idx on evidence_links(demand_signal_id);
create index evidence_links_claim_id_idx on evidence_links(claim_id);
create index evidence_links_company_role_id_idx on evidence_links(company_role_id);
create index evidence_links_vendor_route_id_idx on evidence_links(vendor_route_id);
create index evidence_links_contact_person_id_idx on evidence_links(contact_person_id);
create index evidence_links_contact_route_id_idx on evidence_links(contact_route_id);
create index evidence_links_project_id_idx on evidence_links(project_id);
create index evidence_links_opportunity_id_idx on evidence_links(opportunity_id);

commit;
