import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const adminDatabaseUrl = process.env.SUPABASE_ADMIN_DATABASE_URL;
const clients: Client[] = [];

async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  clients.push(client);
  await client.connect();
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end().catch(() => undefined)));
});

describe.skipIf(!databaseUrl || !adminDatabaseUrl)("SECURITY-RLS-B0 local PostgreSQL", () => {
  it("removes client-role grants and creates the restricted runtime role", async () => {
    const client = await connect(databaseUrl!);
    const grants = await client.query<{ count: string }>(`
      select count(*)::text
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
    `);
    expect(grants.rows[0]?.count).toBe("0");

    const role = await client.query<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolbypassrls: boolean;
      owns_tables: boolean;
    }>(`
      select r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
             r.rolinherit, r.rolbypassrls,
             exists (
               select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relowner = r.oid
             ) as owns_tables
      from pg_roles r where r.rolname = 'fly_workforce_runtime'
    `);
    expect(role.rows).toEqual([{
      rolcanlogin: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolbypassrls: false,
      owns_tables: false,
    }]);
  });

  it.each([
    ["postgres", () => databaseUrl!],
    ["supabase_admin", () => adminDatabaseUrl!],
  ])("does not expose future objects created by %s", async (owner, getUrl) => {
    const client = await connect(getUrl());
    const suffix = owner === "postgres" ? "pg" : "admin";
    const table = `public.b0_r1_future_${suffix}_table`;
    const sequence = `public.b0_r1_future_${suffix}_seq`;
    const routine = `public.b0_r1_future_${suffix}_fn`;

    await client.query("begin");
    try {
      await client.query(`create table ${table} (id integer)`);
      await client.query(`create sequence ${sequence}`);
      await client.query(`create function ${routine}() returns integer language sql as 'select 1'`);

      const result = await client.query<{
        anon_table: boolean;
        auth_table: boolean;
        anon_sequence: boolean;
        auth_sequence: boolean;
        anon_routine: boolean;
        auth_routine: boolean;
      }>(`
        select
          has_table_privilege('anon', $1, 'select,insert,update,delete') as anon_table,
          has_table_privilege('authenticated', $1, 'select,insert,update,delete') as auth_table,
          has_sequence_privilege('anon', $2, 'usage,select,update') as anon_sequence,
          has_sequence_privilege('authenticated', $2, 'usage,select,update') as auth_sequence,
          has_function_privilege('anon', $3, 'execute') as anon_routine,
          has_function_privilege('authenticated', $3, 'execute') as auth_routine
      `, [table, sequence, `${routine}()`]);

      expect(result.rows[0]).toEqual({
        anon_table: false,
        auth_table: false,
        anon_sequence: false,
        auth_sequence: false,
        anon_routine: false,
        auth_routine: false,
      });
    } finally {
      await client.query("rollback");
    }
  });
});
