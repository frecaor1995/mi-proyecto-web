-- SECURITY-RLS-B0-R1: PostgreSQL's built-in PUBLIC EXECUTE default for
-- functions is global. A per-schema default ACL cannot subtract a privilege
-- inherited from that global default, so the owner of application objects
-- must revoke it without an IN SCHEMA clause. Migrations run as postgres,
-- which owns every application object; Supabase-managed platform roles are
-- outside a Hosted migration's authority and are not modified here.

alter default privileges for role postgres
  revoke execute on functions from public;
