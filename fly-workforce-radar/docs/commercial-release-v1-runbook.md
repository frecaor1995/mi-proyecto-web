# Commercial Release v1.0 operations runbook

This runbook separates repository controls from production actions. Never paste credentials, tokens, connection strings, worker contact data, or other PII into tickets or logs.

## Release ownership

The designated Release Operator owns the checklist, the Supabase Project Owner owns Auth/database/backups, and the Hosting Operator owns deployment, uptime checks, alerts, and rollback. Two people must review production operator permissions and destructive restore steps.

## Pre-deploy

1. Run focused tests, `npm run typecheck`, scoped ESLint, and `npm run build` against the release commit.
2. Configure `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `DATABASE_URL` in the hosting secret store. Production startup rejects missing, placeholder, loopback, or structurally invalid values without printing them.
3. Run the read-only database release verifier with the complete certified migration-version list. Require every result to pass: reachability, schema, migration chain, restricted role membership, non-superuser, no BYPASSRLS, RLS, and no PUBLIC/anon/authenticated table grants.
4. Separately inspect relevant routine privileges (`information_schema.routine_privileges`) and Supabase security advisors. Stop if PUBLIC, anon, or authenticated can execute a non-trigger application routine. The protected SECURITY-RLS-B0-R1 files require separate manager authorization if this check fails.
5. Confirm a current managed backup, retention policy, and successful non-production restore drill. Record only timestamps/statuses, never backup URLs or credentials.
6. Confirm one least-privilege ACTIVE operator and the alert destinations below.

## Controlled operator provisioning and revocation

Provisioning is an administrative, two-boundary operation; public signup stays disabled.

1. A Supabase Project Owner creates the Auth identity in the production Auth administration interface and securely delivers the one-time credential outside the repository.
2. A database administrator uses a parameterized transaction to insert the returned Auth UUID, work email, display name, `ACTIVE`, and the smallest reviewed `OperatorPermission[]` into `workforce_operators`. Never hard-code these values in SQL files or seed data.
3. A second reviewer verifies the Auth UUID mapping, lifecycle, and exact permission set.
4. Test login, global protected-route access, allowed operations, and denial of an operation outside the permission set.

For revocation, first update that single operator row to `INACTIVE` in a parameterized transaction. Verify a protected request fails, then revoke active Auth sessions and disable the Auth identity using Supabase administration. Existing permission-specific checks remain authoritative. Never delete engagement/audit history.

## Backup and restore

Use the production Supabase project's managed database backups/PITR appropriate to the plan. Before deployment, the Project Owner records backup freshness and retention in the release ticket. At least quarterly, restore the latest eligible backup into an isolated non-production project, run schema/migration verification and read-only record-count checks, then destroy the isolated project according to policy. A production restore requires incident approval, a maintenance window, a fresh pre-restore backup, and Supabase's documented restore procedure; application rollback alone does not reverse a migration.

## Observability, alerting, and incident response

Server request failures emit structured allow-listed metadata through Next.js instrumentation; sensitive field names are redacted. The public `/api/health` endpoint exposes only healthy/degraded database state. Supabase Auth/Postgres logs and hosting application logs remain the system sources.

Hosting Operator configures an external uptime check for `/api/health` and alerts on repeated non-200 results and elevated application errors. Supabase Project Owner configures available database/resource alerts. On incident: acknowledge, capture timestamp/release SHA/safe error digest, restrict traffic if data integrity is at risk, inspect hosting and Supabase logs, roll back application if appropriate, escalate database restore separately, verify smoke checks, and document closure without secrets/PII.

## Post-deploy smoke

Verify health; login; unauthenticated redirect; inactive/non-operator denial; Command Center; Opportunities and Opportunity Detail; Commercial Intake; Workforce; matching; engagement; Candidate Slate; and a manager-approved synthetic read/write transaction through the application. Confirm the write once, verify its audit evidence, and remove it only through an approved product path. Do not use real worker contact details.

## Rollback

For an application-only defect, stop new writes if necessary, redeploy the last certified commit through the hosting platform, retain logs, and repeat the smoke checklist. Never force-push or rewrite release history. For a migration defect, do not blindly down-migrate: stop writes, assess forward repair versus managed restore, preserve a current backup, obtain database-owner approval, and follow the certified migration-specific recovery plan. Restore is an external production operation, not an application command.

## External release actions required

- Create/configure the production Supabase and hosting resources if absent.
- Install validated production environment values in the hosting secret store.
- Verify the real migration chain, runtime identity/grants/RLS/routine privileges, and application read/write smoke.
- Provision and independently review the first production operator.
- Confirm managed backup retention and complete a non-production restore drill.
- Configure hosting/Supabase uptime and error alert destinations.
- Deploy the certified commit and execute the post-deploy smoke and rollback-readiness review.
