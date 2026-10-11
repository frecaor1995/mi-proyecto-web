import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { countOpenHumanVerificationTasks } from "../../server/human-verification-desk/get-human-verification-desk";

const migrations = [
  "20260817010000_canonical_model.sql",
  "20260817020000_evidence_provenance.sql",
  "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql",
  "20260817050000_claim_assertions.sql",
  "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql",
  "20260817080000_contacts_routes.sql",
  "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql",
  "20260904010000_human_verification_domain.sql",
];

describe("Command Center Human Verification workload count", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
  });

  afterAll(async () => db.close());

  async function createCompany(name: string) {
    return (await db.query<{ id: string }>("insert into companies(common_name) values($1) returning id", [name])).rows[0].id;
  }

  async function createTask(companyId: string, dedupKey: string, status: string, closedAt: string | null) {
    await db.query(
      `insert into human_verification_tasks(company_id,target_type,target_id,verification_objective,question_type,primary_question,scope,packet_snapshot,deduplication_key,status,created_by,rule_version,created_at,closed_at)
       values($1,'CONTACT_ROUTE',$1,'Verify route','CONTACT_ROUTE','Who owns this route?','{}','{}',$2,$3,'tester','v1',now(),$4)`,
      [companyId, dedupKey, status, closedAt],
    );
  }

  it("zero is KNOWN 0 when the table is empty, not UNAVAILABLE", async () => {
    const result = await countOpenHumanVerificationTasks(db as unknown as SqlClient);
    expect(result).toEqual({ state: "READY", openCount: 0 });
  });

  it("counts only tasks that are not yet closed, using the DB's own terminal-state predicate", async () => {
    const companyId = await createCompany("Workload Co");
    await createTask(companyId, "open-task-1", "OPEN", null);
    await createTask(companyId, "assigned-task-1", "ASSIGNED", null);
    await createTask(companyId, "completed-task-1", "COMPLETED", new Date().toISOString());

    const result = await countOpenHumanVerificationTasks(db as unknown as SqlClient);
    expect(result.state).toBe("READY");
    expect(result).toMatchObject({ state: "READY", openCount: 2 });
  });

  it("UNAVAILABLE when no database client is configured", async () => {
    expect(await countOpenHumanVerificationTasks(null)).toEqual({
      state: "UNAVAILABLE",
      openCount: null,
      reason: "DATABASE_CONNECTION_UNAVAILABLE",
    });
  });

  it("zero and UNAVAILABLE are never confused", async () => {
    const empty = new PGlite();
    for (const migration of migrations) await empty.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    try {
      const known = await countOpenHumanVerificationTasks(empty as unknown as SqlClient);
      const unavailable = await countOpenHumanVerificationTasks(null);
      expect(known.state).toBe("READY");
      expect(unavailable.state).toBe("UNAVAILABLE");
      expect(known).not.toEqual(unavailable);
    } finally {
      await empty.close();
    }
  });
});
