import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";
import { PostgresCompanyRepository } from "../../server/repositories/company/postgres-company-repository";
import { PostgresContactRepository } from "../../server/repositories/contact/postgres-contact-repository";
import { PostgresOpportunityRepository } from "../../server/repositories/opportunity/postgres-opportunity-repository";
import { PostgresHumanVerificationDeskRepository } from "../../server/repositories/human-verification-desk/postgres-human-verification-desk-repository";
import { PostgresManpowerAcceptanceRepository } from "../../server/repositories/manpower-acceptance/postgres-manpower-acceptance-repository";
import { PostgresEvidenceRepository } from "../../server/repositories/evidence/postgres-evidence-repository";

const now = new Date("2026-09-05T12:00:00Z");
const migrations = [
  "20260817010000_canonical_model.sql", "20260817020000_evidence_provenance.sql", "20260817030000_source_registry_compliance.sql",
  "20260817040000_controlled_ingestion.sql", "20260817050000_claim_assertions.sql", "20260817060000_company_resolution.sql",
  "20260817070000_manpower_acceptance.sql", "20260817080000_contacts_routes.sql", "20260817090000_opportunity_graph.sql",
  "20260817100000_human_verification.sql", "20260904010000_human_verification_domain.sql",
];

describe("UI-7 production company enumeration and detail joins", () => {
  let db: PGlite;
  let companies: PostgresCompanyRepository;
  let contacts: PostgresContactRepository;
  let opportunities: PostgresOpportunityRepository;
  let verification: PostgresHumanVerificationDeskRepository;
  let manpower: PostgresManpowerAcceptanceRepository;
  let evidence: PostgresEvidenceRepository;

  beforeAll(async () => {
    db = new PGlite();
    for (const migration of migrations) await db.exec(await readFile(resolve(process.cwd(), "supabase/migrations", migration), "utf8"));
    const client = db as unknown as SqlClient;
    companies = new PostgresCompanyRepository(client);
    contacts = new PostgresContactRepository(client);
    opportunities = new PostgresOpportunityRepository(client);
    verification = new PostgresHumanVerificationDeskRepository(client);
    manpower = new PostgresManpowerAcceptanceRepository(client);
    evidence = new PostgresEvidenceRepository(client);
  });
  afterAll(async () => db.close());

  it("returns a known empty enumeration and no getById match", async () => {
    expect(await companies.enumerate({ search: "", asOf: now, limit: 25, offset: 0 })).toEqual({ items: [], total: 0 });
    expect(await companies.getById("11111111-1111-4111-8111-111111111111")).toBeNull();
  });

  it("enumerates a persisted company with real cross-table aggregates, and composes its full detail", async () => {
    const company = (await db.query<{ id: string }>("insert into companies(common_name)values('Acme Power')returning id")).rows[0];
    const project = (await db.query<{ id: string }>("insert into projects(name,location_text)values('Grid Project','Houston, TX')returning id")).rows[0];
    const opportunity = (await db.query<{ id: string }>(
      "insert into opportunities(title,project_id,lifecycle,opportunity_identity_key)values('Grid demand',$1,'ACTIVE','grid-task')returning id",
      [project.id],
    )).rows[0];
    await db.query("insert into opportunity_companies(opportunity_id,company_id,link_reason)values($1,$2,'COMMERCIAL_CONTEXT')", [opportunity.id, company.id]);

    const person = (await db.query<{ id: string }>(
      "insert into contact_people(company_id,name,title,verification_state)values($1,'Pat Buyer','Procurement Manager','UNVERIFIED')returning id",
      [company.id],
    )).rows[0];
    const source = (await db.query<{ id: string }>("insert into sources(name)values('Test Source')returning id")).rows[0];
    const routeEvidence = await evidence.create({ sourceId: source.id, sourceUrl: "https://example.com/route", capturedAt: now, captureMethod: "MANUAL", contentHash: "a".repeat(64), payloadSizeBytes: 0, metadata: {} });
    await db.query(
      "insert into contact_routes(company_id,contact_person_id,route_type,target,observed_target,normalized_target,verification_state,evidence_id,last_verified_at)values($1,$2,'CORPORATE_PHONE','555-0199','555-0199','5550199','VERIFIED',$3,$4)",
      [company.id, person.id, routeEvidence.id, now.toISOString()],
    );

    await manpower.saveEvaluation({
      companyId: company.id, context: null, result: "VERIFIED_POSITIVE", qualifyingCategories: ["STAFFING_VENDOR_ACCEPTED"],
      supportingClaimIds: ["22222222-2222-4222-8222-222222222222"], supportingEvidenceIds: [routeEvidence.id], ignoredClaimIds: [], evaluatedAt: now, ruleVersion: "af-01@2.0.0",
      validUntil: null, reason: "explicit acceptance", explanation: {},
    });

    const task = (await db.query<{ id: string }>(
      `insert into human_verification_tasks(company_id,opportunity_id,project_id,target_type,target_id,verification_objective,question_type,primary_question,scope,deduplication_key,status,created_by,rule_version,created_at)
       values($1,$2,$3,'MANPOWER_ACCEPTANCE',$1,'Verify manpower acceptance','MANPOWER_ACCEPTANCE','Does Acme Power use external manpower?','{}','stable-company-task','OPEN','tester','v1',$4)returning id`,
      [company.id, opportunity.id, project.id, now.toISOString()],
    )).rows[0];

    const enumerated = await companies.enumerate({ search: "Acme", asOf: now, limit: 25, offset: 0 });
    expect(enumerated.total).toBe(1);
    expect(enumerated.items[0]).toMatchObject({
      relatedOpportunityCount: 1, contactRouteCount: 1, hasVerifiedContactRoute: true,
      latestManpowerResult: "VERIFIED_POSITIVE", pendingVerificationCount: 1,
    });
    expect(enumerated.items[0].company.id).toBe(company.id);

    const noMatch = await companies.enumerate({ search: "Zephyr", asOf: now, limit: 25, offset: 0 });
    expect(noMatch).toEqual({ items: [], total: 0 });

    const loaded = await companies.getById(company.id);
    expect(loaded?.commonName).toBe("Acme Power");

    const [people, routes, related, verificationItems] = await Promise.all([
      contacts.listPeople(company.id), contacts.listRoutes(company.id),
      opportunities.listByCompany(company.id), verification.listByCompany(company.id),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].fullName).toBe("Pat Buyer");
    expect(routes).toHaveLength(1);
    expect(routes[0].verificationState).toBe("VERIFIED");
    expect(related).toHaveLength(1);
    expect(related[0].opportunity.id).toBe(opportunity.id);
    expect(related[0].location).toBe("Houston, TX");
    expect(verificationItems).toHaveLength(1);
    expect(verificationItems[0].id).toBe(task.id);
    expect(verificationItems[0].companyName).toBe("Acme Power");
  });
});
