import { describe, expect, it } from "vitest";
import {
  ASSOCIATION_CLASS, DEFAULT_DAILY_QUERY_CAP, MAX_PIVOT_DEPTH, MAX_RESEARCH_PAGES, MAX_RESEARCH_QUERIES, NOVELTY_STOP, StageNovelty,
  affiliationConflict, canFetch, canQuery, classifyPhoneAssociation, corroboratePerson, dailyQueryCap, extractAddresses, extractOrgRelations, institutionTie,
  looksLikeInstitution, parseInstitutionListing, phoneDigits, pivotKey, procurementStatus, queries, rankPeopleForResearch, researchCategory,
} from "../../domain/research-pivots";
import { BUYER_FUNCTIONS, actionableRoute, groupPeople, isPlausibleName, matchBuyerFunction, parsePeopleFromPage, personKey, type PersonEvidence } from "../../domain/buyer-intelligence";
import { loadFixtures } from "./fixtures-contact-research";

// Real captured public pages/results (src/test/fixtures/contact-research/zachry, captured 2026-10-02) are TEST DATA ONLY.
const { pages, searches } = loadFixtures("zachry");
const page = (url: string) => pages.find((p) => p.url.includes(url))!;
const search = (name: string) => searches.find((s) => s.query.includes(name))!;
const ORG = "Zachry Group";

describe("organization-relation pivots", () => {
  it("reads a dated subsidiary/brand statement and an appositive brand line from real sources", () => {
    expect(extractOrgRelations(page("jvic.com/about-us").text, ORG)).toEqual([expect.objectContaining({ kind: "ORG_SUBSIDIARY", name: "JVIC", since: "2012" })]);
    const titles = search('"3741 Red Bluff Rd"').results.map((r) => r.title).join(". ");
    expect(extractOrgRelations(titles, ORG).map((r) => r.name)).toEqual(["JVIC"]);
  });
  it("reads an official joint-venture statement", () => {
    const lng = search('"a division of"').results.find((r) => r.url.endsWith("/lng"))!;
    expect(extractOrgRelations(`${lng.title}. ${lng.description}`, ORG)).toEqual([expect.objectContaining({ kind: "ORG_JOINT_VENTURE", name: "KBR" })]);
  });
  it("supports division, alias, operating brand and subsidiary phrasing generically (fictional organizations)", () => {
    const text = "Northwind Field Services, a division of Acme Industrial, opened a yard. Acme Industrial, formerly known as Acme Holdings, expanded. "
      + "Acme Industrial operating as Acme Craft Labor serves refineries. Blue River Fabrication is a wholly owned subsidiary of Acme Industrial.";
    const rel = extractOrgRelations(text, "Acme Industrial").map((r) => `${r.kind}:${r.name}`);
    expect(rel).toEqual(expect.arrayContaining(["ORG_DIVISION:Northwind Field Services", "ORG_ALIAS:Acme Holdings", "ORG_OPERATING_BRAND:Acme Craft Labor", "ORG_SUBSIDIARY:Blue River Fabrication"]));
  });
  it("never invents a relation from co-occurrence or from sentences that do not name the organization", () => {
    expect(extractOrgRelations("Acme Industrial worked next to Blue River Fabrication on the project.", "Acme Industrial")).toEqual([]);
    expect(extractOrgRelations("Blue River Fabrication is a subsidiary of Other Holdings.", "Acme Industrial")).toEqual([]);
  });
});

describe("location and address pivots", () => {
  it("extracts street addresses across line breaks with suites ignored for identity", () => {
    const official = extractAddresses(page("zachrygroup.com/about").text);
    expect(official.length).toBeGreaterThan(10);
    const red = official.find((a) => a.number === "3741")!;
    expect(red).toMatchObject({ city: "Pasadena", state: "TX", zip: "77503", location: "Pasadena, TX" });
    // the institution prints the same place differently: same identity key
    expect(extractAddresses(page("brazoriacountyeda.com/list/member").text)[0].key).toBe(red.key);
    expect(extractAddresses("1200 Main Street, Suite 4, Springfield, TX 77000")[0].key).toBe(extractAddresses("1200 Main St.\nSpringfield, TX 77000")[0].key);
  });
  it("keeps the route number and direction of highway-style addresses", () => {
    const [hwy] = extractAddresses("Geismar Office\n36366 Hwy 30 W.\nGeismar, LA 70734");
    expect(hwy).toMatchObject({ number: "36366", street: "Hwy 30 W", city: "Geismar", state: "LA", zip: "70734", key: "36366 hwy 30 w 70734" });
    expect(extractAddresses("12000 FM 1960 Rd W, Houston, TX 77065")[0].street).toBe("FM 1960 Rd W");
    expect(extractAddresses("8800 US-59 South, Suite 300\nVictoria, TX 77905")[0]).toMatchObject({ street: "US-59 South", zip: "77905" });
    expect(extractAddresses("4400 State Highway 6, College Station, TX 77845")[0].street).toBe("State Highway 6");
    expect(extractAddresses("500 Interstate Hwy 10 E, Beaumont, TX 77702")[0].street).toBe("Interstate Hwy 10 E");
    // different route numbers on the same highway are different places
    expect(extractAddresses("100 Hwy 30, Geismar, LA 70734")[0].key).not.toBe(extractAddresses("100 Hwy 73, Geismar, LA 70734")[0].key);
  });
  it("accepts a street without a conventional suffix only when city, state and ZIP follow directly", () => {
    expect(extractAddresses("Regional Office\n1107 Broadway\nNew York, NY 10010")[0]).toMatchObject({ number: "1107", street: "Broadway", city: "New York", state: "NY", zip: "10010", location: "New York, NY" });
    expect(extractAddresses("1107 Broadway, Suite 1200, New York, NY 10010")[0].key).toBe("1107 broadway 10010");
    expect(extractAddresses("250 West Commerce, San Antonio, TX 78205")[0].street).toBe("West Commerce");
    // prose, units, counts and years are not streets
    expect(extractAddresses("Founded in 1924 Acme Example, San Antonio, TX 78221")).toEqual([]);
    expect(extractAddresses("Since 1955 Houston, TX 77002")).toEqual([]);
    expect(extractAddresses("Suite 400 Houston, TX 77042")).toEqual([]);
    expect(extractAddresses("More than 2500 Employees, Houston, TX 77002")).toEqual([]);
  });
  it("keeps the existing supported formats unchanged", () => {
    expect(extractAddresses("3741 Red Bluff Rd.,\nBldg D, Suite 100\nPasadena, TX 77503")[0]).toMatchObject({ street: "Red Bluff Rd", key: "3741 red bluff rd 77503", location: "Pasadena, TX" });
    expect(extractAddresses("539 N. Carancahua St., Suite 5100\nCorpus Christi, TX 78401")[0]).toMatchObject({ street: "N. Carancahua St", city: "Corpus Christi" });
    expect(extractAddresses("1411 Opus Place, Suite 500\nDowners Grove, IL 60515")[0].key).toBe("1411 opus pl 60515");
    expect(extractAddresses("PO Box 65103, RPO North Hill\nCalgary, Alberta\nCanada T2N 4T6")).toEqual([]);
  });
  it("never searches an address without its city (real homonym case: another state's 'Red Bluff')", () => {
    const red = extractAddresses(page("zachrygroup.com/about").text).find((a) => a.number === "3741")!;
    expect(queries.address(red)).toBe('"3741 Red Bluff Rd" "Pasadena"');
    const homonym = search('"3741 Red Bluff" (chamber').results;
    expect(homonym.every((r) => !/pasadena/i.test(`${r.title} ${r.description}`))).toBe(true);
  });
  it("deduplicates pivots by normalized key (phones, people, addresses)", () => {
    expect(pivotKey("CHANNEL", "(713) 555-0100")).toBe(pivotKey("CHANNEL", "+1 713.555.0100"));
    expect(pivotKey("PERSON", "José  Pérez")).toBe(pivotKey("PERSON", "Jose Perez"));
    expect(pivotKey("ORG_ALIAS", "Acme, Inc.")).toBe(pivotKey("ORG_ALIAS", "ACME"));
    expect(phoneDigits("1-713-555-0100")).toBe("7135550100");
  });
});

describe("institutions (local ecosystem)", () => {
  const official = () => extractAddresses(page("zachrygroup.com/about").text);
  const locations = () => [...new Set(official().map((a) => a.location))];
  it("recognizes institutional member listings generically and never fetches data brokers", () => {
    const results = search("member TX").results;
    expect(results.filter(looksLikeInstitution).map((r) => new URL(r.url).hostname)).toEqual(expect.arrayContaining(["members.brazoriacountyeda.com", "www.pasadenachamber.org"]));
    expect(looksLikeInstitution({ title: "Acme - Overview | ZoomInfo", url: "https://www.zoominfo.com/c/acme/1" })).toBe(false);
  });
  it("accepts an institution only when it names the organization AND matches a known place", () => {
    const eda = institutionTie(page("brazoriacountyeda.com/list/member").text, { names: [ORG], addresses: official(), locations: locations(), officialDomain: "zachrygroup.com" });
    expect(eda.tied).toBe(true);
    expect(eda.basis.join(" ")).toContain("same street address");
    const chamber = institutionTie(page("pasadenachamber.org").text, { names: [ORG], addresses: official(), locations: locations(), officialDomain: "zachrygroup.com" });
    expect(chamber).toMatchObject({ tied: true });
    expect(institutionTie("Member: Zachry Group. 100 Main St, Port Arthur, TX 77640", { names: [ORG], addresses: official(), locations: locations(), officialDomain: null }).tied).toBe(false);
    expect(institutionTie("Member: Other Group. 3741 Red Bluff Rd, Pasadena TX 77503", { names: [ORG], addresses: official(), locations: locations(), officialDomain: null }).tied).toBe(false);
  });
  it("turns an institutional listing into named-person pivots (member page and multi-member roster)", () => {
    const member = parseInstitutionListing(page("brazoriacountyeda.com/list/member").text, [ORG], true, parsePeopleFromPage, isPlausibleName);
    expect(member).toEqual([expect.objectContaining({ name: "Dale Kuntz", title: "Vice President, Operations Services Group", phone: "(713) 568-2612" })]);
    const roster = parseInstitutionListing(page("GroupRoster").text, [ORG], false, parsePeopleFromPage, isPlausibleName);
    expect(roster).toEqual([expect.objectContaining({ name: "Dale Kuntz", title: "Vice President, Operations Services Group", phone: null })]);
  });
});

describe("person research priority and role-aware queries", () => {
  it("orders research by function, not discovery order (title is never authority)", () => {
    const ranked = rankPeopleForResearch([
      { name: "Lee Owner", title: "President", currency: "CURRENT" as const, domains: 3 },
      { name: "Bo Sales", title: "Business Development Manager", currency: "CURRENT" as const, domains: 1 },
      { name: "Ann Ops", title: "Vice President, Operations Services Group", currency: "UNDATED" as const, domains: 2 },
      { name: "Pat Buyer", title: "Subcontracts Administrator", currency: "UNDATED" as const, domains: 1 },
      { name: "Kim Crew", title: "Craft Recruiting Lead", currency: "CURRENT" as const, domains: 1 },
    ]);
    expect(ranked.map((p) => p.name)).toEqual(["Pat Buyer", "Ann Ops", "Kim Crew", "Bo Sales", "Lee Owner"]);
    expect(researchCategory("Vice President, Operations Services Group")).toBe("OPERATIONS");
  });
  it("builds one role-aware query, and a second only through a known alias", () => {
    expect(queries.person("Dale Kuntz", ORG, "Vice President, Operations Services Group", 0, null)).toBe('"Dale Kuntz" "Zachry Group" operations');
    expect(queries.person("Pat Buyer", "Acme", "Procurement Manager", 0, null)).toBe('"Pat Buyer" "Acme" procurement');
    expect(queries.person("Pat Buyer", "Acme", "Procurement Manager", 1, "Acme Craft")).toBe('"Pat Buyer" "Acme Craft"');
    expect(queries.ecosystemState(ORG, "TX")).toBe(search("member TX").query);
    expect(queries.channel("(713) 568-2612", ORG)).toBe(search("568-2612").query);
  });
});

describe("budgets, depth, novelty and the daily cap", () => {
  it("has the approved bounds and a configurable daily cap that defaults to 60", () => {
    expect([MAX_RESEARCH_QUERIES, MAX_RESEARCH_PAGES, MAX_PIVOT_DEPTH, NOVELTY_STOP, DEFAULT_DAILY_QUERY_CAP]).toEqual([24, 20, 3, 2, 60]);
    expect(dailyQueryCap({})).toBe(60);
    expect(dailyQueryCap({ CONTACT_RESEARCH_DAILY_QUERY_CAP: "40" })).toBe(40);
    expect(dailyQueryCap({ CONTACT_RESEARCH_DAILY_QUERY_CAP: "nonsense" })).toBe(60);
  });
  it("stops a stage after two consecutive unproductive queries or at its cap", () => {
    const stage = new StageNovelty(5);
    stage.record(2); stage.record(0); expect(stage.open).toBe(true);
    stage.record(0); expect(stage.open).toBe(false);
    const capped = new StageNovelty(2); capped.record(1); capped.record(1); expect(capped.open).toBe(false);
  });
  it("refuses queries/pages once the per-investigation budget is spent", () => {
    expect(canQuery({ queriesUsed: 24, pagesUsed: 0, maxQueries: 24, maxPages: 20 })).toBe(false);
    expect(canFetch({ queriesUsed: 0, pagesUsed: 20, maxQueries: 24, maxPages: 20 })).toBe(false);
    expect(canQuery({ queriesUsed: 23, pagesUsed: 0, maxQueries: 24, maxPages: 20 })).toBe(true);
  });
});

// ---- field corroboration, phone association, procurement, state integrity --------------------------------
const evidence = (overrides: Partial<PersonEvidence>): PersonEvidence => ({
  candidateId: overrides.candidateId ?? "c1", name: "Dale Kuntz", title: "Vice President, Operations Services Group", personKey: personKey("Dale Kuntz", ORG), location: null,
  sourceUrl: "https://members.brazoriacountyeda.com/list/member/zachry-group-119", sourceType: "DIRECTORY_LISTING", sourceDate: null, currency: "UNDATED",
  quote: "Dale Kuntz — Vice President, Operations Services Group", email: null, emailAttributed: false, emailVerified: false, phone: null, phoneKind: null, phoneValidated: false,
  profileUrl: null, responsibilityEvidence: null, ...overrides,
});
const industrial = BUYER_FUNCTIONS.INDUSTRIAL_CONTRACTOR;
const institutionUrls = new Set(["https://members.brazoriacountyeda.com/list/member/zachry-group-119"]);

describe("field-by-field corroboration (independent domains, not URLs)", () => {
  it("counts registrable domains: two pages on one site are one source", () => {
    const [sameSite] = groupPeople([evidence({ candidateId: "a" }), evidence({ candidateId: "b", sourceUrl: "https://members.brazoriacountyeda.com/groups/GroupRoster/board-members-2" })], [], "INDUSTRIAL_CONTRACTOR", industrial);
    expect(corroboratePerson(sameSite, { officialLines: new Map(), institutionUrls, affiliationConflicts: [], interactions: [] }).fields.identity.status).toBe("SINGLE_SOURCE");
    const [two] = groupPeople([evidence({ candidateId: "a" }), evidence({ candidateId: "b", sourceUrl: "https://theorg.com/org/x/dale-kuntz", sourceType: "PROFESSIONAL_PROFILE_LISTING" })], [], "INDUSTRIAL_CONTRACTOR", industrial);
    const c = corroboratePerson(two, { officialLines: new Map(), institutionUrls, affiliationConflicts: [], interactions: [] });
    expect(c.fields.identity).toMatchObject({ status: "CORROBORATED", domains: ["brazoriacountyeda.com", "theorg.com"] });
    expect(c.fields.affiliation.status).toBe("CORROBORATED");
  });
  it("keeps current role UNKNOWN when only undated/historical sources exist, and flags stale risk", () => {
    const [p] = groupPeople([evidence({}), evidence({ candidateId: "h", sourceUrl: "https://news.example/2019", sourceType: "NEWS_ARTICLE", sourceDate: "2019-05-01", currency: "HISTORICAL" })], [], "INDUSTRIAL_CONTRACTOR", industrial);
    const c = corroboratePerson(p, { officialLines: new Map(), institutionUrls, affiliationConflicts: [], interactions: [] });
    expect(c.fields.currentRole.status).toBe("UNKNOWN");
    expect(c.stale).toBe("STALE_RISK");
    const [undated] = groupPeople([evidence({})], [], "INDUSTRIAL_CONTRACTOR", industrial);
    expect(corroboratePerson(undated, { officialLines: new Map(), institutionUrls, affiliationConflicts: [], interactions: [] }).stale).toBe("UNDATED_ONLY");
  });
  it("detects a possibly stale contact only from an explicit departure from THIS organization (namesakes are ignored)", () => {
    expect(affiliationConflict({ title: "Dale Kuntz - Audit Senior Manager - Example Audit Partners LLP | LinkedIn", description: null }, "Dale Kuntz", [ORG])).toBeNull();
    expect(affiliationConflict({ title: "Pat Example joins Beta Corp", description: "Pat Example, formerly operations director at Acme Industrial, joined Beta." }, "Pat Example", ["Acme Industrial"])).toContain("formerly");
    const [p] = groupPeople([evidence({})], [], "INDUSTRIAL_CONTRACTOR", industrial);
    expect(corroboratePerson(p, { officialLines: new Map(), institutionUrls, affiliationConflicts: [{ url: "x", note: "formerly at", currency: "UNDATED" }], interactions: [] }))
      .toMatchObject({ stale: "POSSIBLY_MOVED", fields: { affiliation: { status: "CONFLICTING" } } });
  });
  it("keeps commercial and external-workforce responsibility UNKNOWN without explicit evidence", () => {
    const [p] = groupPeople([evidence({ title: "Procurement Manager" })], [], "INDUSTRIAL_CONTRACTOR", industrial);
    const c = corroboratePerson(p, { officialLines: new Map(), institutionUrls, affiliationConflicts: [], interactions: [] });
    expect(c.fields.commercialResponsibility.status).toBe("UNKNOWN");
    expect(c.fields.externalWorkforceResponsibility.status).toBe("UNKNOWN");
    const [q] = groupPeople([evidence({ responsibilityEvidence: "oversees procurement for maintenance" })], [], "INDUSTRIAL_CONTRACTOR", industrial);
    const d = corroboratePerson(q, { officialLines: new Map(), institutionUrls, affiliationConflicts: [], interactions: [] });
    expect(d.fields.commercialResponsibility.status).toBe("CORROBORATED");
    expect(d.fields.externalWorkforceResponsibility.status).toBe("UNKNOWN"); // procurement is not labor-specific
  });
});

describe("phone association semantics and the A–E mapping", () => {
  const lines = new Map([["2105885000", "MAIN"], ["7134556700", "OFFICE"]]);
  it("distinguishes all association kinds and never upgrades a number printed near a name", () => {
    const c = (o: Partial<Parameters<typeof classifyPhoneAssociation>[0]>) => classifyPhoneAssociation({ phone: "(713) 568-2612", phoneKind: "UNKNOWN", officialLines: lines, institutionListing: false, inPersonEntry: false, ...o });
    expect(c({ institutionListing: true, inPersonEntry: true })).toBe("PUBLISHED_WITH_CONTACT_BY_INSTITUTION");
    expect(c({ inPersonEntry: true })).toBe("PUBLISHED_IN_PERSON_ENTRY");
    expect(c({})).toBe("TYPE_UNKNOWN");
    expect(c({ phone: null })).toBe("NOT_FOUND");
    expect(c({ phoneKind: "DIRECT" })).toBe("DIRECT_VERIFIED");
    expect(c({ phone: "210-588-5000", institutionListing: true })).toBe("CORPORATE_SWITCHBOARD"); // official main line wins
    expect(c({ phone: "(713) 455-6700", inPersonEntry: true })).toBe("DEPARTMENT_BRANCH"); // official office line wins
    expect(c({ phone: "(210) 588-5000", phoneKind: "DIRECT" })).toBe("CORPORATE_SWITCHBOARD"); // a switchboard is never direct
  });
  it("maps to the 2.0 route classes without creating any new path to A", () => {
    expect(ASSOCIATION_CLASS).toEqual({ DIRECT_VERIFIED: "A_DIRECT", DEPARTMENT_BRANCH: "C_DEPARTMENT", CORPORATE_SWITCHBOARD: "D_MAIN", NOT_FOUND: "E_NOT_FOUND",
      PUBLISHED_IN_PERSON_ENTRY: null, PUBLISHED_WITH_CONTACT_BY_INSTITUTION: null, TYPE_UNKNOWN: null });
  });
});

describe("procurement / supplier route", () => {
  it("separates supplier route, subcontract route and external-workforce purchasing (real official wording)", () => {
    const text = page("zachrygroup.com/procurement").text;
    const status = procurementStatus([{ quote: text.split("\n").filter((l) => /Procurement Group|register your company|ISNetworld/.test(l)).join(" "), url: "https://zachrygroup.com/procurement" }]);
    expect(status).toMatchObject({ supplierRoute: true, subcontractRoute: true, externalWorkforcePurchasing: "UNKNOWN" });
    expect(procurementStatus([{ quote: "Vendors register through our supplier portal.", url: "x" }])).toMatchObject({ supplierRoute: true, subcontractRoute: false, externalWorkforcePurchasing: "UNKNOWN" });
    expect(procurementStatus([{ quote: "We contract craft labor suppliers for turnarounds.", url: "x" }]).externalWorkforcePurchasing).toBe("CONFIRMED");
    expect(procurementStatus([]).supplierRoute).toBe(false);
  });
});

describe("2.0 state and route integrity with 2.1A evidence", () => {
  it("an institution-listed person with an institution-published phone stays State 2 and is not the buyer of a departmental route", () => {
    const people = groupPeople([evidence({ phone: "(713) 568-2612", phoneKind: "UNKNOWN" }), evidence({ candidateId: "o", sourceUrl: "https://theorg.com/org/x/dale-kuntz", sourceType: "PROFESSIONAL_PROFILE_LISTING" })], [], "INDUSTRIAL_CONTRACTOR", industrial);
    expect(people[0].state).toBe("PROFESSIONAL_IDENTIFIED");
    expect(people[0].phone?.status).toBe("UNCLASSIFIED");
    const route = actionableRoute({ organization: ORG, type: "INDUSTRIAL_CONTRACTOR", people, channels: [{ candidateId: "m", kind: "PHONE_ROUTE", value: "(210) 588-5000", label: "Home Office", phoneKind: "MAIN", sourceUrl: "https://zachrygroup.com/about" }],
      departmentEvidence: [{ quote: "Procurement Group … Subcontract Management", url: "https://zachrygroup.com/procurement" }] });
    expect(route).toMatchObject({ person: null, phoneClass: "D_MAIN", department: "PROCUREMENT_SUBCONTRACTS", responsibility: null });
  });
});

describe("supply chain / procurement / subcontract / vendor-management function family (research relevance only)", () => {
  it("matches the family in either word order for contractors and general organizations", () => {
    for (const title of ["Director, Supply Chain", "Supply Chain Manager", "VP of Supply Chain", "Head of Procurement", "Chief Procurement Officer", "Director of Strategic Sourcing", "Purchasing Manager", "Buyer"]) {
      expect(matchBuyerFunction(title, "INDUSTRIAL_CONTRACTOR").fn?.id, title).toBe("PROCUREMENT");
      expect(matchBuyerFunction(title, "ELECTRICAL_CONSTRUCTION").fn?.id, title).toBe("PROCUREMENT");
    }
    for (const title of ["Subcontract Management Lead", "Manager, Subcontracts", "Director of Vendor Management", "Supplier Management Lead", "Subcontracts Administrator"]) {
      expect(matchBuyerFunction(title, "INDUSTRIAL_CONTRACTOR").fn?.id, title).toBe("SUBCONTRACTS");
    }
    expect(matchBuyerFunction("Director, Supply Chain", "GENERAL").fn?.id).toBe("PROCUREMENT");
    expect(matchBuyerFunction("Purchasing Agent", "GENERAL").fn?.id).toBe("PROCUREMENT");
    // not widened: unrelated or leadership-only titles stay unmatched
    expect(matchBuyerFunction("Supply Chain Analyst Intern", "INDUSTRIAL_CONTRACTOR").fn).toBeNull();
    expect(matchBuyerFunction("Board Director", "INDUSTRIAL_CONTRACTOR")).toEqual({ fn: null, leadership: false });
    expect(matchBuyerFunction("Media Buyer", "GENERAL").fn).toBeNull();
    expect(matchBuyerFunction("Executive Chairman", "INDUSTRIAL_CONTRACTOR").fn).toBeNull();
    expect(researchCategory("Director, Supply Chain")).toBe("PROCUREMENT");
  });
  it("makes a Supply Chain title relevant for research while authority and workforce responsibility stay unconfirmed", () => {
    const [person] = groupPeople([evidence({ name: "Morgan Example", title: "Director, Supply Chain", personKey: personKey("Morgan Example", ORG), quote: "Morgan Example — Director, Supply Chain" })], [], "INDUSTRIAL_CONTRACTOR", BUYER_FUNCTIONS.INDUSTRIAL_CONTRACTOR);
    expect(person.fn?.id).toBe("PROCUREMENT");
    expect(person.facts).toMatchObject({ identified: true, relevant: true, contactable: false, responsibilityConfirmed: false });
    expect(person.state).toBe("PROFESSIONAL_IDENTIFIED");
    const corroboration = corroboratePerson(person, { officialLines: new Map(), institutionUrls: new Set(), affiliationConflicts: [], interactions: [] });
    expect(corroboration.fields.commercialResponsibility.status).toBe("UNKNOWN");
    expect(corroboration.fields.externalWorkforceResponsibility.status).toBe("UNKNOWN");
    // with an institution-published phone the person is still not State 3/4 and the route is not a direct line
    const withPhone = groupPeople([evidence({ name: "Morgan Example", title: "Director, Supply Chain", personKey: personKey("Morgan Example", ORG), phone: "(361) 555-0142", phoneKind: "UNKNOWN" })], [], "INDUSTRIAL_CONTRACTOR", BUYER_FUNCTIONS.INDUSTRIAL_CONTRACTOR)[0];
    expect(withPhone.state).not.toBe("COMMERCIAL_RESPONSIBILITY_CONFIRMED");
    expect(withPhone.facts.responsibilityConfirmed).toBe(false);
    // only explicit evidence or a recorded human interaction confirms responsibility (unchanged 2.0 rule)
    const confirmed = groupPeople([evidence({ name: "Morgan Example", title: "Director, Supply Chain", personKey: personKey("Morgan Example", ORG), responsibilityEvidence: "manages subcontracted craft labor suppliers" })], [], "INDUSTRIAL_CONTRACTOR", BUYER_FUNCTIONS.INDUSTRIAL_CONTRACTOR)[0];
    expect(confirmed.state).toBe("COMMERCIAL_RESPONSIBILITY_CONFIRMED");
  });
});
