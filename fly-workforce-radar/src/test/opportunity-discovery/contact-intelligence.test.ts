import { describe, expect, it } from "vitest";
import {
  extractContacts, mailboxFunction, nameTokens, organizationRole, phoneFormatValid, phoneKindFromQuote, priorityReason, resolveOfficialDomain, targetFunctions, type OrganizationIdentity,
} from "../../domain/contact-investigation";
import { hunterDomainSearch, hunterVerifyEmail, lookupPhone, providerStatuses, retrieveOfficialPages } from "../../server/contact-intelligence/providers";
import { mergeDuplicateRoutes, recordDecision } from "../../server/contact-intelligence/investigation";
import { executeDueOpportunitySearches } from "../../server/opportunity-search/run-opportunity-discovery";
import { REVIEW_ONLY_CAPTURE } from "../../server/company-discovery/candidate-processing";
import type { PlannedDiscoveryQuery } from "../../domain/discovery-coverage";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

// Wording of the real Jefferson County RFQ 21-045/JW (retrieved 2026-09-29), used as a fixture.
const JEFFERSON_TEXT = "J EFFERSON C OUNTY P URCHASING D EPARTMENT Deborah L. Clark, Purchasing Agent 1149 Pearl Street, 1 st Floor , Beaumont, TX 77701 409 - 835 - 8593 Fax 409 - 835 - 8456 June 29, 2021 Request for Statements of Qualification ( RFQ 21 - 04 5 /JW ). Inquiries shall be directed to\nJamey West\n,\nAssistant Purchasing\nAgent\nat 409\n-\n835\n-\n8593 or jwest@co.jefferson.tx.us .";
const jefferson: OrganizationIdentity = { name: "Jefferson County", officialDomain: "jeffersoncountytx.gov", domainBasis: "fixture", role: "PROCUREMENT_AUTHORITY", roleBasis: "fixture", project: null };

describe("organization identity", () => {
  it("derives distinctive name tokens and the official domain only from evidence", () => {
    expect(nameTokens("MMR Constructors, Inc")).toEqual(["mmr"]);
    const mmr = resolveOfficialDomain({ organization: "MMR Constructors, Inc", sourceUrl: "https://www.roaddogjobs.com/job/3pyluc", publicBody: false,
      knownPages: [{ url: "https://www.zabalist.com/projects/TABS2026026008", title: "MMR CONSTRUCTORS INC | Houston, TX | Zabalist" }, { url: "https://mmrgrp.com/", title: "MMR Group | Home" }] });
    expect(mmr.domain).toBe("mmrgrp.com");
    expect(mmr.basis).toContain("MMR Group | Home");
    expect(resolveOfficialDomain({ organization: "Jefferson County", sourceUrl: "https://jeffersoncountytx.gov/blobs/purchasing/nfb/BID/180.pdf", publicBody: true, knownPages: [] }).domain).toBe("jeffersoncountytx.gov");
    expect(resolveOfficialDomain({ organization: "Acme Industrial", sourceUrl: "https://www.indeed.com/viewjob?jk=1", publicBody: false, knownPages: [] }).domain).toBeNull();
  });

  it("never assumes the employer in a job ad owns the project", () => {
    expect(organizationRole({ category: "DIRECT_HIRING", publicBody: false, organization: "MMR Constructors, Inc", text: "Journeyman Electricians at MMR Constructors, Inc." })).toMatchObject({ role: "UNKNOWN" });
    expect(organizationRole({ category: "PROCUREMENT_BID", publicBody: true, organization: "Jefferson County", text: "" }).role).toBe("PROCUREMENT_AUTHORITY");
    expect(organizationRole({ category: "PROJECT_DEMAND", publicBody: false, organization: "Zachry", text: "Zachry is the general contractor for the Freeport LNG expansion." }).role).toBe("GENERAL_CONTRACTOR");
    expect(organizationRole({ category: "PROJECT_DEMAND", publicBody: false, organization: "MMR Constructors Inc", text: "MMR CONSTRUCTORS INC is a new construction project at 13008 Gulf Commerce Drive" }).role).toBe("UNKNOWN");
  });

  it("selects target functions by opportunity type", () => {
    expect(targetFunctions("PROCUREMENT_BID").map((target) => target.contactFunction)).toEqual(["PROCUREMENT"]);
    expect(targetFunctions("DIRECT_HIRING").map((target) => target.contactFunction)).toEqual(["TALENT_ACQUISITION", "RECRUITER", "WORKFORCE"]);
    expect(targetFunctions("PROJECT_DEMAND").map((target) => target.contactFunction)).toContain("PROJECT_MANAGEMENT");
    expect(targetFunctions(null).map((target) => target.contactFunction)).toEqual(["GENERAL_OFFICE"]);
  });
});

describe("contact attribution from source text", () => {
  it("extracts the documented purchasing contacts, attaches email/phone by sentence, and skips fax numbers", () => {
    const contacts = extractContacts({ url: "https://jeffersoncountytx.gov/blobs/purchasing/nfb/BID/180.pdf", provider: "PUBLIC_PROCUREMENT_DOCUMENT", text: JEFFERSON_TEXT, official: true }, jefferson);
    const west = contacts.find((contact) => contact.personName === "Jamey West");
    expect(west).toMatchObject({ kind: "PERSON", title: "Assistant Purchasing Agent", contactFunction: "PROCUREMENT", email: "jwest@co.jefferson.tx.us", phone: "(409) 835-8593", attributed: true });
    const clark = contacts.find((contact) => contact.personName === "Deborah L. Clark");
    expect(clark).toMatchObject({ title: "Purchasing Agent", attributed: true });
    expect(contacts.some((contact) => contact.phone === "(409) 835-8456")).toBe(false);
  });

  it("skips SMS/help-desk lines and labels headquarters numbers as main lines (real MMR contact-page wording)", () => {
    const contacts = extractContacts({ url: "https://mmrgrp.com/contact", provider: "OFFICIAL_WEBSITE", official: true,
      text: "For help in the US, text HELP to 877-909-5090. You may also email helpdesk@mmrgrp.com or call 225-408-8998. Corporate Headquarters 15961 Airline Highway Baton Rouge, LA 70817 TOLL FREE (800) 880-5090" },
      { ...jefferson, name: "MMR Constructors, Inc", officialDomain: "mmrgrp.com" });
    expect(contacts.some((contact) => contact.phone === "(877) 909-5090" || contact.phone === "(225) 408-8998")).toBe(false);
    expect(contacts.find((contact) => contact.phone === "(800) 880-5090")).toMatchObject({ phoneKind: "MAIN", attributed: true });
    expect(phoneKindFromQuote("text HELP to 877-909-5090. You may also call 225-408-8998.", "(225) 408-8998", "MAIN")).toBe("NON_COMMERCIAL");
  });

  it("returns nothing when the source contains no contact information, and never invents names", () => {
    expect(extractContacts({ url: "https://example.com/a", provider: "SIGNAL_SOURCE", text: "Journeyman Electricians needed in Abilene, TX. Apply today.", official: false }, { ...jefferson, officialDomain: null })).toEqual([]);
  });

  it("keeps an email outside the official domain unattributed, and classifies mailboxes and phone kinds", () => {
    const contacts = extractContacts({ url: "https://news.example.com/x", provider: "SIGNAL_SOURCE", text: "Send bids to purchasing@other-company.com. Main office: (713) 555-0100.", official: false }, { ...jefferson, officialDomain: "acme.com" });
    expect(contacts.find((contact) => contact.email)).toMatchObject({ kind: "MAILBOX", contactFunction: "PROCUREMENT", attributed: false });
    expect(contacts.find((contact) => contact.phone)).toMatchObject({ kind: "PHONE_ROUTE", phoneKind: "MAIN", attributed: false });
    expect(mailboxFunction("careers@acme.com")).toBe("TALENT_ACQUISITION");
    expect(mailboxFunction("vendors@acme.com")).toBe("SUPPLIER_MANAGEMENT");
  });

  it("de-duplicates the same contact within a source", () => {
    const contacts = extractContacts({ url: "https://acme.com/contact", provider: "OFFICIAL_WEBSITE", text: "Email info@acme.com. Or write to info@acme.com.", official: true }, { ...jefferson, officialDomain: "acme.com" });
    expect(contacts.filter((contact) => contact.email === "info@acme.com")).toHaveLength(1);
  });

  it("orders by documented relevance without scores, and never treats format as validation", () => {
    const targets = targetFunctions("PROCUREMENT_BID");
    expect(priorityReason({ kind: "PERSON", contactFunction: "PROCUREMENT", provider: "PUBLIC_PROCUREMENT_DOCUMENT", personName: "Jamey West", historical: true }, targets).rank).toBe(1);
    expect(priorityReason({ kind: "PHONE_ROUTE", contactFunction: "GENERAL_OFFICE", provider: "OFFICIAL_WEBSITE", personName: null, historical: false }, targets).rank).toBe(6);
    expect(phoneFormatValid("(409) 835-8593")).toBe(true);
    expect(phoneFormatValid("(123) 456-7890")).toBe(false);
  });
});

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const neverCalled = (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch;

describe("provider adapters (FIXTURE responses only)", () => {
  it("reports NOT_CONFIGURED without credentials and never calls the network", async () => {
    expect(providerStatuses({}).map((provider) => [provider.id, provider.state])).toEqual([["OFFICIAL_SOURCES", "AVAILABLE"], ["HUNTER_DOMAIN_SEARCH", "NOT_CONFIGURED"], ["HUNTER_EMAIL_VERIFIER", "NOT_CONFIGURED"], ["PHONE_LOOKUP", "NOT_CONFIGURED"], ["PEOPLE_WEB_SEARCH", "NOT_CONFIGURED"]]);
    expect(await hunterDomainSearch("acme.com", { apiKey: "", transport: neverCalled })).toEqual({ state: "NOT_CONFIGURED" });
    expect(await hunterVerifyEmail("a@acme.com", { apiKey: "", transport: neverCalled })).toEqual({ state: "NOT_CONFIGURED" });
    expect(await lookupPhone("4098358593", { accountSid: "", authToken: "", transport: neverCalled })).toEqual({ state: "NOT_CONFIGURED" });
  });

  it("maps documented Hunter and phone-lookup responses, and records provider failures", async () => {
    const domain = await hunterDomainSearch("acme.com", { apiKey: "FIXTURE", transport: (async () => response({ data: { emails: [{ value: "J.Doe@acme.com", first_name: "Jane", last_name: "Doe", position: "Procurement Manager", sources: [{ uri: "https://acme.com/team" }] }] } })) as unknown as typeof fetch });
    expect(domain).toEqual({ state: "OK", value: [{ email: "j.doe@acme.com", firstName: "Jane", lastName: "Doe", position: "Procurement Manager", department: null, phone: null, sourceUrl: "https://acme.com/team" }] });
    expect(await hunterVerifyEmail("j.doe@acme.com", { apiKey: "FIXTURE", transport: (async () => response({ data: { status: "accept_all" } })) as unknown as typeof fetch })).toEqual({ state: "OK", value: { result: "RISKY", status: "accept_all" } });
    expect(await hunterVerifyEmail("x@acme.com", { apiKey: "FIXTURE", transport: (async () => response({}, 429)) as unknown as typeof fetch })).toEqual({ state: "FAILED", reason: "HTTP_429" });
    expect(await lookupPhone("(409) 835-8593", { accountSid: "FIXTURE", authToken: "FIXTURE", transport: (async () => response({ valid: true, line_type_intelligence: { type: "landline" } })) as unknown as typeof fetch }))
      .toEqual({ state: "OK", value: { result: "VALID", lineType: "landline" } });
  });

  it("retrieves only official-domain pages and refuses redirects off the official domain", async () => {
    const pages = await retrieveOfficialPages("acme.com", ["/purchasing"], { spacingMs: 0, fetcher: async (url) => url.endsWith("/contact")
      ? { ok: true, finalUrl: "https://acme.com/contact", status: 200, contentType: "text/html", body: Buffer.from("<main>Call (713) 555-0100</main>") }
      : url.endsWith("/purchasing") ? { ok: true, finalUrl: "https://elsewhere.com/x", status: 200, contentType: "text/html", body: Buffer.from("x") }
      : { ok: false, failure: "HTTP_ERROR", finalUrl: url, status: 404, contentType: null } });
    expect(pages.map((page) => page.status)).toEqual(["FETCHED", "HTTP_ERROR", "OFF_DOMAIN_REDIRECT"]);
  });
});

describe("duplicate prevention across sources", () => {
  it("shows a person's mailbox once and treats a shared organization line as a department number", () => {
    const merged = mergeDuplicateRoutes([
      { kind: "PERSON" as const, email: "jwest@co.jefferson.tx.us", phone: "(409) 835-8593", phoneKind: "DIRECT", decision: null },
      { kind: "MAILBOX" as const, email: "jwest@co.jefferson.tx.us", phone: null, phoneKind: null, decision: null },
      { kind: "PHONE_ROUTE" as const, email: null, phone: "(409) 835-8593", phoneKind: "UNKNOWN", decision: null },
      { kind: "MAILBOX" as const, email: "purchasing@co.jefferson.tx.us", phone: null, phoneKind: null, decision: null },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ kind: "PERSON", phoneKind: "DEPARTMENT" });
    expect(merged[1].email).toBe("purchasing@co.jefferson.tx.us");
  });
});

describe("human confirmation workflow", () => {
  const recorder = (companyRows: unknown[] = []) => {
    const queries: [string, unknown[]][] = [];
    const client = { query: async (sql: string, params: unknown[] = []) => {
      queries.push([sql, params]);
      if (sql.includes("from contact_candidates where id")) return { rows: [{ kind: "PERSON", person_name: "Jamey West", title: "Assistant Purchasing Agent", contact_function: "PROCUREMENT", source_url: "https://jeffersoncountytx.gov/x.pdf" }] };
      if (sql.includes("from company_roles")) return { rows: companyRows };
      return { rows: [] };
    } } as unknown as SqlClient;
    return { client, queries };
  };

  it("keeps a confirmation inside the investigation when the signal is not an opportunity", async () => {
    const { client, queries } = recorder();
    const result = await recordDecision(client, { candidateId: "c1", decision: "CONFIRMED", note: "Called the main line", operatorId: "op", promotedOpportunityId: null, contactService: { createPerson: async () => { throw new Error("must not write canonical"); } } });
    expect(result.canonical).toBe("NO_OPPORTUNITY");
    expect(queries.at(-1)?.[1]).toEqual(["c1", "CONFIRMED", "Called the main line", "op", null]);
  });

  it("bridges a human-confirmed person into the canonical register and links it to the opportunity (no duplicate link)", async () => {
    const { client, queries } = recorder([{ company_id: "company-1" }]);
    let created: unknown = null;
    const result = await recordDecision(client, { candidateId: "c1", decision: "CONFIRMED", note: "Confirmed by phone", operatorId: "op", promotedOpportunityId: "opp-1",
      contactService: { createPerson: async (candidate) => { created = candidate; return { id: "person-1" } as never; } } });
    expect(result.canonical).toBe("WRITTEN");
    expect(created).toMatchObject({ companyId: "company-1", fullName: "Jamey West", verificationState: "UNVERIFIED", metadata: { humanConfirmed: true } });
    expect(queries.some(([sql]) => sql.includes("insert into opportunity_contact_people") && sql.includes("on conflict do nothing"))).toBe(true);
  });

  it("never writes canonical records for selection or rejection", async () => {
    const { client } = recorder([{ company_id: "company-1" }]);
    for (const decision of ["SELECTED_FOR_FOLLOW_UP", "REJECTED"] as const) {
      expect((await recordDecision(client, { candidateId: "c1", decision, note: null, operatorId: "op", promotedOpportunityId: "opp-1", contactService: { createPerson: async () => { throw new Error("no"); } } })).canonical).toBe("NOT_APPLICABLE");
    }
  });
});

describe("six-hour discovery under an hourly cron", () => {
  it("runs one cycle per six-hour window when invoked every hour (never 10 searches per hour)", async () => {
    let nextRunAt = "2026-09-30T12:00:00.000Z";
    let searches = 0;
    const executions: string[] = [];
    const acquired = new Set<string>();
    const repository = {
      dueProfiles: async (now: Date) => (Date.parse(nextRunAt) <= now.getTime() ? [{ id: "p", enabled: true, cadenceHours: 6, nextRunAt, kind: "MULTI_TRADE_CYCLE" as const, queriesPerCycle: 10, request: { company: null, keyword: "Multi-trade discovery cycle", tradeProfession: null, location: null } }] : []),
      advanceProfile: async (_id: string, next: Date) => { nextRunAt = next.toISOString(); },
      abandonStaleCycles: async () => 0,
      cycleRotationState: async () => ({ cycleNumber: executions.length, lastSearched: new Map(), lastCycleStartedAt: null }),
      acquireOpportunityRun: async (input: { scheduleWindow?: Date }) => { const key = input.scheduleWindow!.toISOString(); if (acquired.has(key)) return null; acquired.add(key); executions.push(key); return `run-${key}`; },
      knownCandidateUrls: async () => new Set<string>(),
      recordQueryExecutions: async (_runId: string, records: readonly { query: PlannedDiscoveryQuery }[]) => new Map(records.map((record) => [record.query.position, `e${record.query.position}`])),
      complete: async () => ({ status: "COMPLETED", findingsCount: 0 }),
      fail: async () => ({ status: "FAILED", findingsCount: 0 }),
    };
    const cycleProvider = { searchPlanned: async (queries: readonly PlannedDiscoveryQuery[]) => { searches += queries.length; return { state: "COMPLETED" as const, duplicatesSuppressed: 0, outcomes: queries.map((query) => ({ query, state: "COMPLETED" as const, resultCount: 0, failure: null, candidates: [] })) }; } };
    for (let hour = 12; hour <= 24; hour += 1) {
      await executeDueOpportunitySearches({ repository: repository as never, capture: REVIEW_ONLY_CAPTURE, cycleProvider, now: new Date(Date.UTC(2026, 8, 30, hour, 5)) });
    }
    expect(executions).toEqual(["2026-09-30T12:00:00.000Z", "2026-09-30T18:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
    expect(searches).toBe(30);
    expect(nextRunAt).toBe("2026-10-01T06:00:00.000Z");
  });
});
