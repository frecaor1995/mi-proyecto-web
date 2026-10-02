-- Contact Intelligence 2.0 (LOCAL, additive). Corporate extensions are their own phone kind (never a direct
-- line), office/branch lines keep the office they belong to, and each source can carry a short quoted note of
-- department-level procurement/supplier evidence (e.g. "Procurement … Subcontract Management").
begin;
alter table public.contact_candidates drop constraint contact_candidates_phone_kind_check;
alter table public.contact_candidates add constraint contact_candidates_phone_kind_check
  check (phone_kind is null or phone_kind in ('MAIN','DEPARTMENT','DIRECT','UNKNOWN','EXTENSION','OFFICE'));
alter table public.contact_source_retrievals
  add column evidence_note text check (evidence_note is null or length(evidence_note) <= 600);
commit;
