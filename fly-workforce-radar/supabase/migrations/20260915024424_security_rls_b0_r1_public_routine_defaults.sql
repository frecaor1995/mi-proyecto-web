-- SECURITY-RLS-B0-R1: PostgreSQL grants EXECUTE on new routines to PUBLIC
-- independently of Supabase's explicit anon/authenticated default ACLs.
-- Removing PUBLIC closes that inherited client path for existing and future
-- public-schema routines while preserving explicit service_role grants.

revoke execute on all routines in schema public from public;

alter default privileges for role postgres in schema public
  revoke execute on routines from public;
