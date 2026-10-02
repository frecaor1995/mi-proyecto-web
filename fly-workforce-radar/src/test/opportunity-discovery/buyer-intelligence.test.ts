import { describe, expect, it } from "vitest";
import {
  BUYER_FUNCTIONS, MAX_PEOPLE_QUERIES, buildPeopleQueries, buyerPath, classifyOrganization, evidenceCurrency, functionsFor, groupPeople, isPlausibleName, matchBuyerFunction,
  parsePeopleFromPage, parsePeopleFromSearchResult, personKey, type CorporateChannel, type HumanInteraction, type PersonEvidence,
} from "../../domain/buyer-intelligence";
import { discoverPeople, MAX_DAILY_WEB_QUERIES } from "../../server/contact-intelligence/people-search";
import { providerStatuses } from "../../server/contact-intelligence/providers";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

// Synthetic people use clearly fictional names; the only real wording is the Jefferson County RFQ (see 1.0 tests).
const evidence = (overrides: Partial<PersonEvidence>): PersonEvidence => ({
  candidateId: overrides.candidateId ?? "c1", name: "Pat Example", title: "Procurement Manager", personKey: personKey("Pat Example", "Acme Electric"), location: null,
  sourceUrl: "https://acme-electric.example/leadership", sourceType: "OFFICIAL_SITE", sourceDate: null, currency: "CURRENT", quote: "Pat Example — Procurement Manager",
  email: null, emailAttributed: false, emailVerified: false, phone: null, phoneKind: null, phoneValidated: false, profileUrl: null, responsibilityEvidence: null, ...overrides,
});
const interaction = (overrides: Partial<HumanInteraction>): HumanInteraction => ({
  candidateId: "c1", personReached: true, contactDate: "2026-09-30", channel: "PHONE", handlesExternalWorkforce: "UNKNOWN", referredTo: null, responsibleDepartment: null,
  notes: null, nextAction: null, recordedAt: "2026-09-30T15:00:00.000Z", ...overrides,
});
const construction = BUYER_FUNCTIONS.ELECTRICAL_CONSTRUCTION;

describe("organization type and buyer functions", () => {
  it("classifies organizations and maps each type to its buyer functions (not senior titles)", () => {
    expect(classifyOrganization("MMR Constructors, Inc")).toBe("ELECTRICAL_CONSTRUCTION");
    expect(classifyOrganization("Trillium Staffing")).toBe("STAFFING_AGENCY");
    expect(classifyOrganization("Jefferson County")).toBe("PUBLIC_PROCUREMENT");
    expect(classifyOrganization("Acme Turnaround Services")).toBe("INDUSTRIAL_CONTRACTOR");
    expect(BUYER_FUNCTIONS.STAFFING_AGENCY.map((fn) => fn.id)).toEqual(["BRANCH_MANAGER", "REGIONAL_MANAGER", "STAFFING_MANAGER", "RECRUITING_MANAGER", "BUSINESS_DEVELOPMENT", "OPERATIONS_MANAGER"]);
    expect(BUYER_FUNCTIONS.PUBLIC_PROCUREMENT.map((fn) => fn.id)).toEqual(["PURCHASING_AGENT", "PROCUREMENT_OFFICER"]);
    expect(matchBuyerFunction("Manpower Coordinator", "ELECTRICAL_CONSTRUCTION").fn?.id).toBe("WORKFORCE_MANAGER");
    expect(matchBuyerFunction("Subcontracts Administrator", "ELECTRICAL_CONSTRUCTION").fn?.id).toBe("SUBCONTRACTS");
    expect(matchBuyerFunction("Assistant Purchasing Agent", "PUBLIC_PROCUREMENT").fn?.id).toBe("PURCHASING_AGENT");
    expect(matchBuyerFunction("President & CEO", "ELECTRICAL_CONSTRUCTION")).toEqual({ fn: null, leadership: true });
    expect(functionsFor("ELECTRICAL_CONSTRUCTION", ["PROCUREMENT"]).map((fn) => fn.id)).toEqual(["PROCUREMENT"]);
  });

  it("plans a bounded set of person-first queries", () => {
    const queries = buildPeopleQueries({ organization: "MMR Constructors, Inc", functions: construction, location: "Baton Rouge, LA", project: null, type: "ELECTRICAL_CONSTRUCTION" });
    expect(queries.length).toBeLessThanOrEqual(MAX_PEOPLE_QUERIES);
    expect(queries.every((query) => query.startsWith('"MMR Constructors"'))).toBe(true);
    expect(queries.some((query) => /manpower OR staffing/.test(query))).toBe(true);
    expect(queries.some((query) => /subcontractor OR vendor/.test(query))).toBe(true);
    expect(buildPeopleQueries({ organization: "Trillium Staffing", functions: BUYER_FUNCTIONS.STAFFING_AGENCY, location: "Houston, TX", project: null, type: "STAFFING_AGENCY" }))
      .toContain('"Trillium Staffing" branch manager Houston, TX');
  });
});

describe("person discovery from sources (never fabricated)", () => {
  it("reads public profile listing titles only when the organization is named in the same listing", () => {
    const listing = { title: "Pat Example - Operations Manager - MMR Group | LinkedIn", url: "https://www.linkedin.com/in/pat-example", description: "Location: Baton Rouge, Louisiana · MMR Group" };
    const [person] = parsePeopleFromSearchResult(listing, ["mmr"], "mmrgrp.com");
    expect(person).toMatchObject({ name: "Pat Example", title: "Operations Manager", sourceType: "PROFESSIONAL_PROFILE_LISTING", profileUrl: listing.url, location: "Baton Rouge, Louisiana" });
    expect(parsePeopleFromSearchResult({ ...listing, title: "Pat Example - Operations Manager - Other Industrial | LinkedIn" }, ["mmr"], "mmrgrp.com")).toEqual([]);
    expect(parsePeopleFromSearchResult({ title: "Careers - MMR Group", url: "https://mmrgrp.com/careers", description: "Join MMR. Apply now." }, ["mmr"], "mmrgrp.com")).toEqual([]);
  });

  it("reads a named person from a snippet sentence that also names the organization", () => {
    const result = { title: "Trillium opens new branch", url: "https://news.example/trillium", description: "Lee Sample, Branch Manager at Trillium Staffing, said the office will serve industrial clients." };
    expect(parsePeopleFromSearchResult(result, ["trillium"], "trilliumstaffing.com")).toMatchObject([{ name: "Lee Sample", title: "Branch Manager", sourceType: "NEWS_ARTICLE" }]);
  });

  it("reads leadership pages and attaches a channel only from the person's own entry", () => {
    const page = "Our Team\nPat Example\nProcurement Manager\npat.example@acme-electric.example\n(713) 555-0100\nLee Sample\nPresident\nFax (713) 555-0199";
    const people = parsePeopleFromPage(page);
    expect(people).toMatchObject([
      { name: "Pat Example", title: "Procurement Manager", quote: "Pat Example — Procurement Manager", email: "pat.example@acme-electric.example", phone: "(713) 555-0100" },
      { name: "Lee Sample", title: "President", quote: "Lee Sample — President", email: null, phone: null },
    ]);
    expect(parsePeopleFromPage("Pat Example\nProcurement Manager\n(713) 555-0100 ext. 214")[0].phone).toBe("(713) 555-0100 ext. 214");
  });

  it("does not invent a person from a role, a department or a page without names", () => {
    expect(parsePeopleFromPage("Contact our Procurement Manager\nPurchasing Department\nprocurement@acme.example")).toEqual([]);
    expect(isPlausibleName("Procurement Manager")).toBe(false);
    expect(isPlausibleName("Houston Texas")).toBe(false);
    expect(isPlausibleName("Jamey West")).toBe(true);
    // Real LINK Staffing page wording that an earlier parser misread as a person.
    expect(parsePeopleFromPage("Send Us Your Resume\nOr call 1-800-848-LINK to speak with a recruiter.")).toEqual([]);
    expect(isPlausibleName("Send Us Your Resume")).toBe(false);
  });
});

describe("evidence currency and identity", () => {
  it("separates current, historical and undated evidence", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(evidenceCurrency("PROCUREMENT_DOCUMENT", "2021-06-29", false, now)).toBe("HISTORICAL");
    expect(evidenceCurrency("NEWS_ARTICLE", "2026-05-01", false, now)).toBe("CURRENT");
    expect(evidenceCurrency("PROFESSIONAL_PROFILE_LISTING", null, false, now)).toBe("UNDATED");
    expect(evidenceCurrency("OFFICIAL_SITE", null, true, now)).toBe("CURRENT");
  });

  it("treats historical evidence as identification only, not current employment", () => {
    const [person] = groupPeople([evidence({ currency: "HISTORICAL", sourceDate: "2021-06-29", sourceType: "PROCUREMENT_DOCUMENT", email: "pat@acme-electric.example", emailAttributed: true })], [], "ELECTRICAL_CONSTRUCTION", construction);
    expect(person.facts).toMatchObject({ identified: true, currentlyAssociated: false, relevant: true, contactable: true, responsibilityConfirmed: false });
    expect(person.nextAction).toBe("CONFIRM_CURRENT_ROLE");
  });

  it("never merges same-name people without evidence they are the same person", () => {
    const groups = groupPeople([
      evidence({ candidateId: "a", location: "Houston, TX" }), evidence({ candidateId: "b", location: "Baton Rouge, LA" }), evidence({ candidateId: "c", location: "Houston, TX", sourceUrl: "https://news.example/a" }),
    ], [], "ELECTRICAL_CONSTRUCTION", construction);
    expect(groups.map((group) => group.candidateIds)).toEqual([["a", "c"], ["b"]]);
    expect(personKey("Pat Example", "Acme Electric")).not.toBe(personKey("Pat Example", "Other Industrial"));
  });
});

describe("email and phone status", () => {
  it("keeps found, attributed, technically verified and human-confirmed email separate", () => {
    const status = (overrides: Partial<PersonEvidence>, interactions: HumanInteraction[] = []) => groupPeople([evidence({ email: "pat@acme-electric.example", ...overrides })], interactions, "ELECTRICAL_CONSTRUCTION", construction)[0].email?.status;
    expect(status({})).toBe("FOUND");
    expect(status({ emailAttributed: true })).toBe("ATTRIBUTED_TO_PERSON");
    expect(status({ emailAttributed: true, emailVerified: true })).toBe("TECHNICALLY_VERIFIED");
    expect(status({ emailAttributed: true }, [interaction({ channel: "EMAIL" })])).toBe("HUMAN_CONFIRMED");
  });

  it("never relabels a switchboard as a direct number", () => {
    const phone = (kind: string, validated = false, interactions: HumanInteraction[] = []) => groupPeople([evidence({ phone: "(713) 555-0100", phoneKind: kind, phoneValidated: validated })], interactions, "ELECTRICAL_CONSTRUCTION", construction)[0];
    expect(phone("MAIN", true, [interaction({})]).phone?.status).toBe("CORPORATE_MAIN");
    expect(phone("MAIN").facts.contactable).toBe(false);
    expect(phone("DEPARTMENT").phone?.status).toBe("DEPARTMENT");
    expect(phone("DIRECT", true).phone?.status).toBe("TECHNICALLY_VALIDATED");
    expect(phone("DIRECT", false, [interaction({ channel: "PHONE" })]).phone?.status).toBe("OWNERSHIP_HUMAN_CONFIRMED");
    expect(phone("UNKNOWN").phone?.status).toBe("UNCLASSIFIED");
    expect(phone("UNKNOWN").facts.contactable).toBe(false);
  });
});

describe("contact states, authority and buyer path", () => {
  const channels: CorporateChannel[] = [
    { candidateId: "m", kind: "PHONE_ROUTE", value: "(800) 555-0100", label: null, phoneKind: "MAIN", sourceUrl: "https://acme.example/contact" },
    { candidateId: "s", kind: "PHONE_ROUTE", value: "(800) 555-0111", label: null, phoneKind: "NON_COMMERCIAL", sourceUrl: "https://acme.example/contact" },
    { candidateId: "d", kind: "PHONE_ROUTE", value: "(800) 555-0122", label: null, phoneKind: "DEPARTMENT", sourceUrl: "https://acme.example/contact" },
  ];

  it("never confirms authority from a title alone", () => {
    const [person] = groupPeople([evidence({ email: "pat@acme-electric.example", emailAttributed: true })], [], "ELECTRICAL_CONSTRUCTION", construction);
    expect(person.state).toBe("PROFESSIONAL_CONTACTABLE");
    const path = buyerPath({ organization: "Acme Electric", people: [person], channels, functions: construction, sourcesChecked: 4 });
    expect(path).toMatchObject({ state: "INDIVIDUAL", authority: "NOT_CONFIRMED", professionalChannel: "pat@acme-electric.example", nextAction: "CONFIRM_RESPONSIBILITY" });
    expect(path.state === "INDIVIDUAL" && path.missing).toContain("COMMERCIAL_RESPONSIBILITY");
  });

  it("confirms responsibility from explicit evidence or a recorded human interaction only", () => {
    const byEvidence = groupPeople([evidence({ responsibilityEvidence: "manages subcontractor procurement" })], [], "ELECTRICAL_CONSTRUCTION", construction)[0];
    expect(byEvidence.state).toBe("COMMERCIAL_RESPONSIBILITY_CONFIRMED");
    const byHuman = groupPeople([evidence({})], [interaction({ handlesExternalWorkforce: "YES" })], "ELECTRICAL_CONSTRUCTION", construction)[0];
    expect(buyerPath({ organization: "Acme Electric", people: [byHuman], channels, functions: construction, sourcesChecked: 1 })).toMatchObject({ authority: "CONFIRMED_BY_HUMAN", nextAction: "ADVANCE_RELATIONSHIP" });
    const declined = groupPeople([evidence({})], [interaction({ handlesExternalWorkforce: "NO" })], "ELECTRICAL_CONSTRUCTION", construction)[0];
    expect(declined.facts.responsibilityConfirmed).toBe(false);
    const notReached = groupPeople([evidence({})], [interaction({ personReached: false, handlesExternalWorkforce: "YES" })], "ELECTRICAL_CONSTRUCTION", construction)[0];
    expect(notReached.facts.responsibilityConfirmed).toBe(false);
  });

  it("reports NO INDIVIDUAL BUYER IDENTIFIED with a separate corporate fallback when only leadership or channels exist", () => {
    const leadership = groupPeople([evidence({ title: "President & CEO" })], [], "ELECTRICAL_CONSTRUCTION", construction);
    expect(leadership[0].facts.relevant).toBe(false);
    const path = buyerPath({ organization: "Acme Electric", people: leadership, channels, functions: construction, sourcesChecked: 7 });
    expect(path).toMatchObject({ state: "NO_INDIVIDUAL_BUYER_IDENTIFIED", sourcesChecked: 7, nextAction: "IDENTIFY_PERSON", fallback: { candidateId: "d" } });
    expect(path.state === "NO_INDIVIDUAL_BUYER_IDENTIFIED" && path.functions).toContain("Superintendent");
    expect(buyerPath({ organization: "Acme Electric", people: [], channels: [channels[1]], functions: construction, sourcesChecked: 2 })).toMatchObject({ fallback: null });
    // Real MMR contact-page mailboxes: benefits/help-desk boxes never become the fallback; the main line does.
    const mmr: CorporateChannel[] = [
      { candidateId: "h", kind: "MAILBOX", value: "healthinsurance@mmrgrp.com", label: null, phoneKind: null, sourceUrl: "https://mmrgrp.com/contact" },
      { candidateId: "k", kind: "MAILBOX", value: "helpdesk@mmrgrp.com", label: null, phoneKind: null, sourceUrl: "https://mmrgrp.com/contact" },
      channels[0],
    ];
    expect(buyerPath({ organization: "MMR", people: [], channels: mmr, functions: construction, sourcesChecked: 3 })).toMatchObject({ fallback: { candidateId: "m" } });
  });
});

describe("people search service (fake client — bounded, cached, provider-aware)", () => {
  const fakeClient = (state: { dailyUsed?: number; cached?: string[] } = {}) => {
    const statements: { text: string; values: unknown[] }[] = [];
    const client: SqlClient = {
      async query<Row>(text: string, values: unknown[] = []) {
        statements.push({ text, values });
        if (/count\(\*\) as n from contact_source_retrievals where provider='WEB_SEARCH_RESULT'/.test(text)) return { rows: [{ n: state.dailyUsed ?? 0 }] as Row[] };
        if (/query_text=\$2/.test(text)) return { rows: [{ n: state.cached?.includes(String(values[1])) ? 1 : 0 }] as Row[] };
        if (/insert into contact_candidates/.test(text)) return { rows: [{ id: `id-${statements.length}` }] as Row[] };
        return { rows: [] as Row[] };
      },
    };
    return { client, statements };
  };
  const organization = { name: "Acme Electric", officialDomain: null, type: "ELECTRICAL_CONSTRUCTION" as const, location: null, project: null };

  it("reports the provider as NOT CONFIGURED and continues without inventing anyone", async () => {
    expect(providerStatuses({}).find((provider) => provider.id === "PEOPLE_WEB_SEARCH")?.state).toBe("NOT_CONFIGURED");
    const { client, statements } = fakeClient();
    const outcome = await discoverPeople(client, { investigationId: "i", organization, functions: construction, search: { configured: false, searchWeb: async () => { throw new Error("must not be called"); } }, spacingMs: 0 });
    expect(outcome.found).toBe(0);
    expect(outcome.queries.every((query) => query.state === "NOT_CONFIGURED")).toBe(true);
    expect(statements.some((statement) => /insert into contact_candidates/.test(statement.text))).toBe(false);
  });

  it("records provider failures, stops on rate limits, honours the cache and the daily limit", async () => {
    let calls = 0;
    const failing = { configured: true, searchWeb: async () => { calls += 1; throw new Error("Provider HTTP 429"); } };
    const first = fakeClient();
    const outcome = await discoverPeople(first.client, { investigationId: "i", organization, functions: construction, search: failing, spacingMs: 0 });
    expect(calls).toBe(1);
    expect(outcome.queries).toEqual([expect.objectContaining({ state: "FAILED" })]);
    expect(first.statements.some((statement) => /'WEB_SEARCH_RESULT',\$2,\$3/.test(statement.text))).toBe(true);

    const planned = buildPeopleQueries({ organization: "Acme Electric", functions: construction, type: "ELECTRICAL_CONSTRUCTION" });
    const ok = { configured: true, searchWeb: async () => { calls += 1; return [] as const; } };
    calls = 0;
    const cached = await discoverPeople(fakeClient({ cached: planned.slice(0, 2) }).client, { investigationId: "i", organization, functions: construction, search: ok, spacingMs: 0 });
    expect(cached.queries.filter((query) => query.state === "CACHED")).toHaveLength(2);
    expect(calls).toBe(planned.length - 2);
    calls = 0;
    const limited = await discoverPeople(fakeClient({ dailyUsed: MAX_DAILY_WEB_QUERIES }).client, { investigationId: "i", organization, functions: construction, search: ok, spacingMs: 0 });
    expect(calls).toBe(0);
    expect(limited.queries.every((query) => query.state === "DAILY_LIMIT")).toBe(true);
  });

  it("stores only people named with the organization, one evidence row per person and source", async () => {
    const { client, statements } = fakeClient();
    const search = { configured: true, searchWeb: async (query: string) => query.includes('"Operations Manager"') ? [
      { title: "Pat Example - Operations Manager - Acme Electric | LinkedIn", url: "https://www.linkedin.com/in/pat-example", description: null, pageAge: null },
      { title: "Lee Sample - Operations Manager - Different Company | LinkedIn", url: "https://www.linkedin.com/in/lee-sample", description: null, pageAge: null },
    ] : [] };
    const outcome = await discoverPeople(client, { investigationId: "i", organization, functions: construction, search, spacingMs: 0 });
    const inserts = statements.filter((statement) => /insert into contact_candidates/.test(statement.text));
    expect(outcome.found).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values.slice(2, 4)).toEqual(["Pat Example", "Operations Manager"]);
    expect(inserts[0].values).toContain("PROFESSIONAL_PROFILE_LISTING");
    expect(inserts[0].values).toContain("UNDATED");
  });
});
