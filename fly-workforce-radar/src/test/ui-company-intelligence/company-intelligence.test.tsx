import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanyIntelligenceListView } from "../../components/company-intelligence/company-list-view";
import { CompanyIntelligenceDetailView } from "../../components/company-intelligence/company-detail-view";
import type { CompanyListResult } from "../../server/company-intelligence/get-company-intelligence";
import { getCompanyDetailPage, getCompanyListPage, parseCompanyListQuery } from "../../server/company-intelligence/get-company-intelligence";
import { assembleCompanyDetailView, assembleCompanyListItem } from "../../server/read-models/company-detail";
import type { CompanyEnumerationEntry } from "../../server/repositories/company/company-repository";
import type { CompanyRecord } from "../../domain/company";
import type { ContactPersonRecord, ContactRouteRecord } from "../../domain/contact";
import type { AcceptanceEvaluation } from "../../domain/manpower-acceptance";
import type { EvidenceRecord } from "../../domain/evidence";
import type { HumanVerificationDeskRecord } from "../../server/read-models/human-verification-desk";
import Companies from "../../app/companies/page";
import CompanyDetail from "../../app/companies/[id]/page";

const ASOF = new Date("2026-09-05T12:00:00Z");
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

function company(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return { id: COMPANY_ID, legalName: "Acme Power LLC", commonName: "Acme Power", normalizedLegalName: null, normalizedCommonName: null, mergedIntoCompanyId: null, firstSeenAt: ASOF, lastSeenAt: ASOF, ...overrides };
}
function contactPerson(overrides: Partial<ContactPersonRecord> = {}): ContactPersonRecord {
  return { id: "person-1", companyId: COMPANY_ID, fullName: "Pat Buyer", normalizedName: "pat buyer", title: "Procurement Manager", department: null, contactFunction: "PROCUREMENT", professionalProfileUrl: null, evidenceId: null, verificationState: "UNVERIFIED", observedAt: ASOF, firstSeenAt: ASOF, lastSeenAt: ASOF, staleAfter: null, verificationDueAt: null, languageStatus: "UNKNOWN", languageEvidenceId: null, notes: null, metadata: {}, ...overrides };
}
function contactRoute(overrides: Partial<ContactRouteRecord> = {}): ContactRouteRecord {
  return { id: "route-1", companyId: COMPANY_ID, contactPersonId: "person-1", routeType: "CORPORATE_PHONE", target: "555-0100", normalizedTarget: "5550100", observedTarget: "555-0100", verificationState: "CANDIDATE" as never, evidenceId: null, routeGrade: null, lifecycle: "ACTIVE", observedAt: ASOF, firstSeenAt: ASOF, lastSeenAt: ASOF, lastVerifiedAt: null, staleAfter: null, verificationDueAt: null, metadata: {}, ...overrides };
}
function acceptance(overrides: Partial<AcceptanceEvaluation> = {}): AcceptanceEvaluation {
  return { id: "af01-1", companyId: COMPANY_ID, context: null, result: "VERIFIED_POSITIVE", qualifyingCategories: [], supportingClaimIds: [], supportingEvidenceIds: [], ignoredClaimIds: [], evaluatedAt: ASOF, ruleVersion: "af-01@2.0.0", validUntil: null, reason: "explicit acceptance", explanation: {}, ...overrides };
}
function evidenceRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return { id: "ev-1", sourceId: "src-1", sourceUrl: "https://example.com/job", capturedAt: ASOF, captureMethod: "HTTP_FETCH", contentHash: "hash", payloadSizeBytes: 10, contentType: "text/html", extractorVersion: null, storageReference: null, httpMetadata: null, metadata: {}, ...overrides };
}
function verificationTask(overrides: Partial<HumanVerificationDeskRecord> = {}): HumanVerificationDeskRecord {
  return { id: "task-1", companyId: COMPANY_ID, companyName: "Acme Power", opportunityId: null, opportunityTitle: null, projectId: null, projectName: null, location: null, contactName: null, contactTitle: null, routeType: null, routeTarget: null, routeTrust: null, routeStaleAfter: null, targetType: "MANPOWER_ACCEPTANCE", verificationObjective: "Verify manpower acceptance", questionType: "MANPOWER_ACCEPTANCE", primaryQuestion: "Does Acme Power use external manpower?", followUpQuestion: null, blockerCode: null, preferredMethod: null, status: "OPEN", dueAt: null, createdAt: ASOF, packetSnapshot: {}, ...overrides };
}

describe("UI-7 Company Intelligence (section 14)", () => {
  it("1. company list READY state renders known rows", () => {
    const entry: CompanyEnumerationEntry = { company: company(), relatedOpportunityCount: 2, contactRouteCount: 1, hasVerifiedContactRoute: true, latestManpowerResult: "VERIFIED_POSITIVE", pendingVerificationCount: 1 };
    const item = assembleCompanyListItem(entry, ASOF);
    const result: CompanyListResult = { capability: "OPERATIONAL", items: [item], total: 1, pageCount: 1, reason: null };
    const html = renderToStaticMarkup(<CompanyIntelligenceListView locale="en-US" query={{ search: "", page: 1 }} result={result} />);
    expect(html).toContain("Acme Power");
    expect(html).toContain(`/companies/${COMPANY_ID}`);
  });

  it("2. legitimate empty list is distinct from unavailable", () => {
    const empty: CompanyListResult = { capability: "OPERATIONAL", items: [], total: 0, pageCount: 1, reason: null };
    const html = renderToStaticMarkup(<CompanyIntelligenceListView locale="en-US" query={{ search: "", page: 1 }} result={empty} />);
    expect(html).toContain("No companies are available");
    expect(html).not.toContain("is not connected yet");
  });

  it("3. enumeration UNAVAILABLE is distinct from empty", () => {
    const unavailable: CompanyListResult = { capability: "UNAVAILABLE", items: [], total: null, pageCount: null, reason: "DATABASE_CONNECTION_UNAVAILABLE" };
    const html = renderToStaticMarkup(<CompanyIntelligenceListView locale="en-US" query={{ search: "", page: 1 }} result={unavailable} />);
    expect(html).toContain("The company list is not connected yet");
    expect(html).not.toContain("No companies are available");
  });

  it("4. query ERROR is distinct from empty/unavailable", async () => {
    const failing = () => Promise.reject(new Error("boom"));
    const result = await getCompanyListPage(parseCompanyListQuery({}), failing as never);
    expect(result.capability).toBe("UNKNOWN");
    const html = renderToStaticMarkup(<CompanyIntelligenceListView locale="en-US" query={{ search: "", page: 1 }} result={result} />);
    expect(html).toContain("Company query failed");
  });

  it("5. company detail READY renders overview, contacts, and evidence", () => {
    const detail = assembleCompanyDetailView({ company: company(), roles: [], contactPeople: [contactPerson()], contactRoutes: [contactRoute({ verificationState: "VERIFIED" })], manpowerAcceptanceHistory: [acceptance()], relatedOpportunities: [], humanVerificationTasks: [], evidence: [evidenceRecord()], asOf: ASOF });
    const html = renderToStaticMarkup(<CompanyIntelligenceDetailView locale="en-US" result={{ state: "READY", detail }} />);
    expect(html).toContain("Acme Power");
    expect(html).toContain("Pat Buyer");
    expect(html).toContain("https://example.com/job");
  });

  it("6. company NOT_FOUND is distinct from unavailable/error", async () => {
    expect(await getCompanyDetailPage("not-a-uuid")).toMatchObject({ state: "NOT_FOUND", reason: "INVALID_COMPANY_ID" });
    const html = renderToStaticMarkup(<CompanyIntelligenceDetailView locale="en-US" result={{ state: "NOT_FOUND", detail: null, reason: "x" }} />);
    expect(html).toContain("does not identify a known company");
  });

  it("7. company detail UNAVAILABLE is distinct from not-found", () => {
    const html = renderToStaticMarkup(<CompanyIntelligenceDetailView locale="en-US" result={{ state: "UNAVAILABLE", detail: null, reason: "x" }} />);
    expect(html).toContain("Company Intelligence is unavailable");
    expect(html).not.toContain("does not identify a known company");
  });

  it("8. candidate contact is not presented as verified", () => {
    const detail = assembleCompanyDetailView({ company: company(), contactPeople: [contactPerson()], contactRoutes: [contactRoute({ verificationState: "CANDIDATE" as never })], asOf: ASOF });
    expect(detail.contacts[0].trustState).not.toBe("VERIFIED");
  });

  it("9. missing AF01 is not presented as negative", () => {
    const detail = assembleCompanyDetailView({ company: company(), manpowerAcceptanceHistory: [], asOf: ASOF });
    expect(detail.manpowerAcceptance).toBeNull();
    const html = renderToStaticMarkup(<CompanyIntelligenceDetailView locale="en-US" result={{ state: "READY", detail }} />);
    expect(html).not.toContain("Verified non-acceptance");
  });

  it("10. VERIFIED_NEGATIVE remains explicitly negative", () => {
    const detail = assembleCompanyDetailView({ company: company(), manpowerAcceptanceHistory: [acceptance({ result: "VERIFIED_NEGATIVE" })], asOf: ASOF });
    expect(detail.manpowerAcceptance?.accepted).toBe(false);
    expect(detail.manpowerAcceptance?.trustState).toBe("VERIFIED");
    const html = renderToStaticMarkup(<CompanyIntelligenceDetailView locale="en-US" result={{ state: "READY", detail }} />);
    expect(html).toContain("Verified non-acceptance");
  });

  it("11. unknown related-opportunity count is not shown as zero, and known zero remains zero", () => {
    const zero = assembleCompanyListItem({ company: company(), relatedOpportunityCount: 0, contactRouteCount: 0, hasVerifiedContactRoute: false, latestManpowerResult: null, pendingVerificationCount: 0 }, ASOF);
    expect(zero.relatedOpportunityCount).toBe(0);
    const detail = assembleCompanyDetailView({ company: company(), relatedOpportunities: [], asOf: ASOF });
    expect(detail.relatedOpportunities).toHaveLength(0);
    expect(detail.gaps).toContain("NO_RELATED_OPPORTUNITIES");
  });

  it("12. evidence original language is preserved verbatim", () => {
    const detail = assembleCompanyDetailView({ company: company(), evidence: [evidenceRecord({ sourceUrl: "https://example.com/aviso-de-empleo" })], asOf: ASOF });
    expect(detail.evidence[0].sourceUrl).toBe("https://example.com/aviso-de-empleo");
  });

  it("13. Human Verification link uses the canonical stable task id", () => {
    const detail = assembleCompanyDetailView({ company: company(), humanVerificationTasks: [verificationTask()], asOf: ASOF });
    const html = renderToStaticMarkup(<CompanyIntelligenceDetailView locale="en-US" result={{ state: "READY", detail }} />);
    expect(html).toContain("/verification/task-1");
  });

  it("14. en-US renders correctly", async () => {
    const html = renderToStaticMarkup(await Companies());
    expect(html).toContain("The company list is not connected yet");
  });

  it("15. es-US renders correctly", () => {
    const detail = assembleCompanyDetailView({ company: company(), asOf: ASOF });
    const html = renderToStaticMarkup(<CompanyIntelligenceDetailView locale="es-US" result={{ state: "READY", detail }} />);
    expect(html).toContain("Inteligencia de Empresa");
    expect(html).toContain("Solo lectura");
  });

  it("16. responsive structural behavior is present", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain(".radar-table{display:block;min-width:0}");
    expect(css).toContain(".detail-hero{display:block;padding:22px 18px}");
  });

  it("17. no write controls exist anywhere in the new UI-7 surface", async () => {
    const files = [
      "src/components/company-intelligence/company-list-view.tsx",
      "src/components/company-intelligence/company-detail-view.tsx",
      "src/server/company-intelligence/get-company-intelligence.ts",
    ];
    for (const file of files) {
      const source = (await readFile(resolve(process.cwd(), file), "utf8")).toLowerCase();
      expect(source).not.toMatch(/fetch\(|useeffect|insert into|update |delete from|mark verified|accept\(|reject\(/);
    }
    const repoSource = (await readFile(resolve(process.cwd(), "src/server/repositories/company/postgres-company-repository.ts"), "utf8")).toLowerCase();
    const newMethods = repoSource.split("async enumerate")[1]?.split("async findbynormalizedname")[0] ?? "";
    expect(newMethods).not.toMatch(/insert into|update |delete from/);
  });

  it("company detail page composes real end-to-end for an invalid id without a database configured", async () => {
    const html = renderToStaticMarkup(await CompanyDetail({ params: Promise.resolve({ id: "not-a-uuid" }) }));
    expect(html).toContain("does not identify a known company");
  });
});
