-- Credential designation is intentionally independent from the worker's
-- professional level. Existing rows remain NULL: no level-based inference.
alter table public.worker_credentials
  add column credential_designation text,
  add column professional_license_number text,
  add constraint worker_credentials_designation_check check (
    credential_designation is null or credential_designation in (
      'APPRENTICE_ELECTRICIAN',
      'JOURNEYMAN_ELECTRICIAN',
      'MASTER_ELECTRICIAN'
    )
  );

-- The professional number is a deliberately public-safe projection. The
-- generic raw_identifier remains excluded from runtime SELECT privileges.
grant select (credential_designation, professional_license_number)
  on public.worker_credentials to fly_workforce_runtime;
grant insert (credential_designation, professional_license_number)
  on public.worker_credentials to fly_workforce_runtime;
grant update (credential_designation, professional_license_number)
  on public.worker_credentials to fly_workforce_runtime;
