begin;

alter table company_discovery_candidates
  add column destination_policy_decision capture_policy_decision not null default 'REVIEW_REQUIRED',
  add column processing_reason text not null default 'Destination policy review is required'
    check (length(trim(processing_reason)) > 0),
  add column destination_capture_failed boolean not null default false;

commit;
