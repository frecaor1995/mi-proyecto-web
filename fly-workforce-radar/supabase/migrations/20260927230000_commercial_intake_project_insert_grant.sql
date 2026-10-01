-- VISIBLE-PRODUCT-1: Commercial Intake (PostgresCommercialIntakeRepository.activate) inserts a
-- project row whenever the operator names one, but no earlier migration granted the restricted
-- runtime role any write on public.projects, so intake with a project name failed with
-- "permission denied for table projects" under fly_workforce_runtime. Grant exactly the one
-- privilege the application uses. The application never updates or deletes projects.
grant insert on table public.projects to fly_workforce_runtime;
