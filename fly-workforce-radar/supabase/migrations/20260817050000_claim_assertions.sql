begin;

alter table claims
  add column claim_identity_key text,
  add constraint claims_identity_key_nonempty_check
    check (claim_identity_key is null or length(trim(claim_identity_key)) > 0);

create unique index claims_logical_identity_unique_idx
  on claims(claim_identity_key)
  where claim_identity_key is not null;

create unique index evidence_links_claim_provenance_unique_idx
  on evidence_links(evidence_id, claim_id, link_type)
  where claim_id is not null;

create table claim_state_transitions (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(id) on delete restrict,
  prior_state verification_state not null,
  new_state verification_state not null,
  actor text not null check (length(trim(actor)) > 0),
  transitioned_at timestamptz not null,
  reason text not null check (length(trim(reason)) > 0),
  evidence_id uuid references raw_evidence(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (prior_state <> new_state),
  check (new_state <> 'VERIFIED' or evidence_id is not null)
);

create function prevent_claim_state_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'claim_state_transitions is append-only';
end;
$$;

create trigger claim_state_transitions_append_only
before update or delete on claim_state_transitions
for each row execute function prevent_claim_state_audit_mutation();

create function prevent_claim_assertion_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.subject_type is distinct from old.subject_type
     or new.source_id is distinct from old.source_id
     or new.raw_evidence_subject_id is distinct from old.raw_evidence_subject_id
     or new.demand_signal_id is distinct from old.demand_signal_id
     or new.company_id is distinct from old.company_id
     or new.project_id is distinct from old.project_id
     or new.vendor_route_id is distinct from old.vendor_route_id
     or new.contact_person_id is distinct from old.contact_person_id
     or new.contact_route_id is distinct from old.contact_route_id
     or new.demand_cluster_id is distinct from old.demand_cluster_id
     or new.opportunity_id is distinct from old.opportunity_id
     or new.predicate is distinct from old.predicate
     or new.external_manpower_category is distinct from old.external_manpower_category
     or new.claim_value is distinct from old.claim_value
     or new.assertion_kind is distinct from old.assertion_kind
     or new.claim_identity_key is distinct from old.claim_identity_key then
    raise exception 'claim assertion identity is immutable; create a conflicting claim instead';
  end if;
  return new;
end;
$$;

create trigger claim_assertion_identity_immutable
before update on claims
for each row execute function prevent_claim_assertion_rewrite();

create index claim_state_transitions_claim_time_idx
  on claim_state_transitions(claim_id, transitioned_at desc);
create index claims_current_subject_idx
  on claims(subject_type, demand_signal_id, verification_state);
create index claims_stale_due_idx
  on claims(stale_after)
  where verification_state not in ('REJECTED', 'STALE') and stale_after is not null;

commit;
