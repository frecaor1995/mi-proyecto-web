-- SECURITY-RLS-B0-R1: PostgreSQL's built-in PUBLIC EXECUTE default for
-- functions is global. A per-schema default ACL cannot subtract a privilege
-- inherited from that global default, so both object owners must revoke it
-- without an IN SCHEMA clause.

alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role supabase_admin
  revoke execute on functions from public;
