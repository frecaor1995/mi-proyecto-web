-- Contact Intelligence 2.0 (LOCAL, additive). The operator may set the organization type that drives the buyer
-- functions (a company name alone does not always reveal it). Null = inferred at read time.
begin;
alter table public.contact_investigations
  add column organization_type text check (organization_type is null or organization_type in ('ELECTRICAL_CONSTRUCTION','STAFFING_AGENCY','INDUSTRIAL_CONTRACTOR','PUBLIC_PROCUREMENT','GENERAL'));
grant update (organization_type) on public.contact_investigations to fly_workforce_runtime;
commit;
