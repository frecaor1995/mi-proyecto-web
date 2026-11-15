import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ASSERTION_KINDS,
  COMPANY_ROLES,
  CONTACT_ROUTE_GRADES,
  DEMAND_CLUSTER_KINDS,
  EXTERNAL_MANPOWER_CATEGORIES,
  VERIFICATION_STATES,
  VENDOR_ROUTE_TYPES,
} from "../../domain/database";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260817010000_canonical_model.sql",
);

async function enumValues(db: PGlite, typeName: string) {
  const result = await db.query<{ enumlabel: string }>(
    `select e.enumlabel
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
      where t.typname = $1
      order by e.enumsortorder`,
    [typeName],
  );
  return result.rows.map(({ enumlabel }) => enumlabel);
}

describe("canonical model migration", () => {
  let db: PGlite;
  let migration: string;

  beforeEach(async () => {
    db = new PGlite();
    migration = await readFile(migrationPath, "utf8");
    await db.exec(migration);
  });

  afterEach(async () => {
    await db.close();
  });

  it("represents every frozen business enum exactly", async () => {
    await expect(enumValues(db, "company_role_kind")).resolves.toEqual(COMPANY_ROLES);
    await expect(enumValues(db, "assertion_kind")).resolves.toEqual(ASSERTION_KINDS);
    await expect(enumValues(db, "verification_state")).resolves.toEqual(VERIFICATION_STATES);
    await expect(enumValues(db, "vendor_route_type")).resolves.toEqual(VENDOR_ROUTE_TYPES);
    await expect(enumValues(db, "external_manpower_category")).resolves.toEqual(
      EXTERNAL_MANPOWER_CATEGORIES,
    );
    await expect(enumValues(db, "demand_cluster_kind")).resolves.toEqual(DEMAND_CLUSTER_KINDS);

    const company = await db.query<{ id: string }>(
      "insert into companies (legal_name) values ('Grade Test LLC') returning id",
    );
    await expect(
      db.query(
        `insert into contact_routes (company_id, route_type, target, route_grade)
         values ($1, 'OTHER', 'test', 'F')`,
        [company.rows[0].id],
      ),
    ).rejects.toThrow();
    expect(CONTACT_ROUTE_GRADES).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("allows one company to hold multiple contextual roles", async () => {
    const company = await db.query<{ id: string }>(
      "insert into companies (legal_name) values ('Example Electric') returning id",
    );
    const project = await db.query<{ id: string }>(
      "insert into projects (name) values ('Known Project') returning id",
    );

    await db.query(
      `insert into company_roles (company_id, role, project_id)
       values ($1, 'GC', $2), ($1, 'MANPOWER_BUYER', $2)`,
      [company.rows[0].id, project.rows[0].id],
    );

    const roles = await db.query<{ role: string }>(
      "select role from company_roles order by role",
    );
    expect(roles.rows.map(({ role }) => role)).toEqual(["GC", "MANPOWER_BUYER"]);
  });

  it("keeps assertion kind independent from verification state and preserves UNKNOWN", async () => {
    const company = await db.query<{ id: string }>(
      "insert into companies (common_name) values ('Unresolved Company') returning id",
    );
    const claim = await db.query<{ assertion_kind: string; verification_state: string }>(
      `insert into claims
         (subject_type, company_id, predicate, assertion_kind, verification_state)
       values ('COMPANY', $1, 'IDENTITY', 'UNKNOWN', 'UNVERIFIED')
       returning assertion_kind, verification_state`,
      [company.rows[0].id],
    );

    expect(claim.rows[0]).toEqual({ assertion_kind: "UNKNOWN", verification_state: "UNVERIFIED" });

    const unknownSignal = await db.query<{ title: string | null; base_pay_min: string | null }>(
      "insert into demand_signals default values returning title, base_pay_min",
    );
    expect(unknownSignal.rows[0]).toEqual({ title: null, base_pay_min: null });
  });

  it("separates people from actionable contact routes", async () => {
    const company = await db.query<{ id: string }>(
      "insert into companies (legal_name) values ('Route Test LLC') returning id",
    );
    const person = await db.query<{ id: string }>(
      "insert into contact_people (company_id, name) values ($1, 'Public Recruiter') returning id",
      [company.rows[0].id],
    );
    await db.query(
      `insert into contact_routes (company_id, contact_person_id, route_type, target, route_grade)
       values ($1, $2, 'PROFESSIONAL_PROFILE', 'https://example.test/profile', 'B')`,
      [company.rows[0].id, person.rows[0].id],
    );

    await expect(
      db.query("delete from contact_people where id = $1", [person.rows[0].id]),
    ).rejects.toThrow();
  });

  it("does not treat a vendor route as verified manpower acceptance", async () => {
    const columns = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where column_name = 'external_manpower_acceptance'`,
    );
    expect(columns.rows).toEqual([]);

    const company = await db.query<{ id: string }>(
      "insert into companies (legal_name) values ('Portal Company') returning id",
    );
    await db.query(
      "insert into vendor_routes (company_id, route_type, target) values ($1, 'SUPPLIER_PORTAL', 'https://example.test')",
      [company.rows[0].id],
    );
    const acceptanceClaims = await db.query(
      "select id from claims where external_manpower_category is not null",
    );
    expect(acceptanceClaims.rows).toEqual([]);
  });

  it("keeps demand clusters tentative and prevents orphan members", async () => {
    const cluster = await db.query<{ id: string; kind: string; is_tentative: boolean }>(
      "insert into demand_clusters default values returning id, kind, is_tentative",
    );
    expect(cluster.rows[0]).toMatchObject({
      kind: "POSSIBLE_SHARED_DEMAND_CLUSTER",
      is_tentative: true,
    });

    await expect(
      db.query(
        "insert into demand_cluster_members (cluster_id, demand_signal_id) values ($1, gen_random_uuid())",
        [cluster.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it("stores eligibility and score snapshots without HOT classifications", async () => {
    const forbidden = await db.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_name in ('eligibility_evaluation_snapshots', 'score_result_snapshots')
          and column_name in ('hot', 'is_hot', 'classification')`,
    );
    expect(forbidden.rows).toEqual([]);
  });

  it("enforces contextual roles and typed claim subjects", async () => {
    const company = await db.query<{ id: string }>(
      "insert into companies (legal_name) values ('Constraint Test LLC') returning id",
    );
    await expect(
      db.query("insert into company_roles (company_id, role) values ($1, 'GC')", [
        company.rows[0].id,
      ]),
    ).rejects.toThrow();

    const project = await db.query<{ id: string }>(
      "insert into projects default values returning id",
    );
    await expect(
      db.query(
        `insert into claims
           (subject_type, company_id, predicate, assertion_kind)
         values ('PROJECT', $1, 'IDENTITY', 'FACT')`,
        [company.rows[0].id],
      ),
    ).rejects.toThrow();

    await db.query(
      `insert into claims
         (subject_type, project_id, predicate, assertion_kind)
       values ('PROJECT', $1, 'IDENTITY', 'UNKNOWN')`,
      [project.rows[0].id],
    );
  });

  it("is forward-only, deterministic, and additive", () => {
    expect(migration).not.toMatch(/\b(drop|truncate)\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).toMatch(/^begin;/i);
    expect(migration.trimEnd()).toMatch(/commit;$/i);
    expect(migrationPath).toContain("20260817010000_canonical_model.sql");
  });
});
