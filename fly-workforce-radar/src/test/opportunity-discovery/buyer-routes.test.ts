import { describe, expect, it } from "vitest";
import {
  BUYER_FUNCTIONS, actionableRoute, departmentEvidence, extractOfficeChannels, groupPeople, officeForPerson, pageDate, parsePeopleFromPage, personKey,
  type CorporateChannel, type PersonEvidence,
} from "../../domain/buyer-intelligence";

// Wording below is taken from the audited real pages (retrieved 2026-09-30); people are only those those pages name.
const evidence = (overrides: Partial<PersonEvidence>): PersonEvidence => ({
  candidateId: overrides.candidateId ?? "c1", name: "Pat Example", title: "Procurement Manager", personKey: personKey("Pat Example", "Acme Electric"), location: null,
  sourceUrl: "https://acme-electric.example/leadership", sourceType: "OFFICIAL_SITE", sourceDate: null, currency: "CURRENT", quote: "Pat Example — Procurement Manager",
  email: null, emailAttributed: false, emailVerified: false, phone: null, phoneKind: null, phoneValidated: false, profileUrl: null, responsibilityEvidence: null, ...overrides,
});
const construction = BUYER_FUNCTIONS.ELECTRICAL_CONSTRUCTION;
const staffing = BUYER_FUNCTIONS.STAFFING_AGENCY;

describe("channel investigation (official pages)", () => {
  it("keeps office lines, extensions, department lines and the main line apart, and skips fax numbers", () => {
    // mmrgrp.com/locations
    const mmr = extractOfficeChannels("Texas\nBeaumont - MMR Constructors, Inc.\n7065 Fannett Road, Beaumont, TX 77705\nPhone: (409) 727-0456\nFax: (409) 727-1459\nKemah - MMR Constructors, Inc.\n3240 Delesandri Lane, Kemah, TX 77565\nPhone: (281) 549-4072", "https://mmrgrp.com/locations");
    expect(mmr).toEqual([
      expect.objectContaining({ phone: "(409) 727-0456", kind: "OFFICE", label: "Beaumont - MMR Constructors, Inc." }),
      expect.objectContaining({ phone: "(281) 549-4072", kind: "OFFICE", label: "Kemah - MMR Constructors, Inc." }),
    ]);
    // mmrgrp.com/contact
    expect(extractOfficeChannels("Contact Us\nTOLL FREE (800) 880-5090", "https://mmrgrp.com/contact")[0]).toMatchObject({ phone: "(800) 880-5090", kind: "MAIN" });
    expect(extractOfficeChannels("Procurement Department\nPhone: (210) 555-0100 ext. 4410", "https://example.com/procurement")[0]).toMatchObject({ phone: "(210) 555-0100 ext. 4410", kind: "EXTENSION" });
    expect(extractOfficeChannels("Purchasing\n(409) 555-0123", "https://example.com/about")[0]).toMatchObject({ kind: "DEPARTMENT", label: "Purchasing" });
  });

  it("reads publication dates and department-level procurement evidence (never a person's authority)", () => {
    // mmrgrp.com/news/mmr-honors-longstanding-employees-for-dedicated-service
    expect(pageDate("MMR Honors Longstanding Employees\nJanuary 4, 2024\nRiley Fixturo, Operations Manager, Corpus Christi (27 years)")).toBe("2024-01-04");
    expect(pageDate("No date here")).toBeNull();
    // zachrygroup.com/procurement
    expect(departmentEvidence("The Procurement Group's primary areas include Sourcing/Buying Operations, Field Procurement, Subcontract Management, Material Control. Suppliers are qualified through ISNetworld."))
      .toContain("Subcontract Management");
    expect(departmentEvidence("We build safe projects across the Gulf Coast.")).toBeNull();
  });

  it("reads a person from a dated press-release list line, and responsibility only from that person's own bio", () => {
    expect(parsePeopleFromPage("January 4, 2024\nRiley Fixturo, Operations Manager, Corpus Christi (27 years)")).toMatchObject([{ name: "Riley Fixturo", title: "Operations Manager, Corpus Christi (27 years)" }]);
    const [pat, lee] = parsePeopleFromPage("Pat Example\nOperations Manager\nPat oversees craft labor and subcontractors for the Gulf Coast district.\nLee Sample\nSafety Manager\nLee leads our safety program.");
    expect(pat.bio).toContain("oversees craft labor");
    expect(lee.bio).not.toContain("craft labor");
    expect(parsePeopleFromPage("Pat Example\nProcurement Manager\n(713) 555-0100 ext. 214")[0].phone).toBe("(713) 555-0100 ext. 214");
  });
});

describe("regressions found on the real pages (iteration 2)", () => {
  it("never reads market commentary as department evidence (real MMR wording)", () => {
    expect(departmentEvidence("Exampleton, president and CEO of Baton Rouge-based electrical contractor MMR Group, says, “Unpredictable supply chain and material costs have made lump-sum proposals more difficult.”")).toBeNull();
    // zachrygroup.com/procurement
    expect(departmentEvidence("If you would like to register your company with Zachry Group for future opportunities, please fill out the following registration form with your organization’s information. Zachry Group utilizes an online portal system, ISNetworld, to qualify suppliers and subcontractors."))
      .toContain("ISNetworld");
  });

  it("names a line after its office, never after an address line (real zachrygroup.com/about wording)", () => {
    const text = "LOCATIONS\nHome Office\n527 Logwood Avenue\nSan Antonio, TX 78221\nUnited States\n+1 210.588.5000\nDIGITAL PROJECT DELIVERY\nTrillium Advisory Group\nPO Box 65103, RPO North Hill\nCalgary, Alberta\nCanada T2N 4T6\n+1 587.900.0919";
    expect(extractOfficeChannels(text, "https://zachrygroup.com/about")).toEqual([
      expect.objectContaining({ phone: "(210) 588-5000", kind: "MAIN", label: "Home Office" }),
      expect.objectContaining({ phone: "(587) 900-0919", label: "Calgary, Alberta" }),
    ]);
  });

  it("reads people listed inside a press-release paragraph (real MMR wording, 2024-01-04)", () => {
    const text = "January 4, 2024\nBATON ROUGE, LA – MMR proudly honored several employees. MMR President and CEO Taylor R. “Sky” Exampleton recognized Quinn Testarossa, International Administrator, MMR International, Ltd. (17 years); Robin Mocklin, Data Processing (17 years); Drew Fakely, General Manager, Southwestern Power Group (22 years); Casey Sampleton, Site Manager (24 years); Sydney Fictivo, Office Manager, Southwestern Power Group (22 years); Riley Fixturo, Operations Manager, Corpus Christi (27 years); and Cameron Stubbington, Electrical Superintendent (27 years) for their longstanding commitment.";
    const people = parsePeopleFromPage(text);
    expect(people.find((person) => person.name === "Riley Fixturo")).toMatchObject({ title: "Operations Manager, Corpus Christi (27 years)" });
    expect(people.find((person) => person.name === "Cameron Stubbington")).toMatchObject({ title: "Electrical Superintendent (27 years)" });
    expect(people.some((person) => person.name === "Robin Mocklin")).toBe(false); // "Data Processing" is not a title the parser accepts
  });

  it("extracts page text when a site ships an empty <article>, and keeps phone/fax icons as labels", async () => {
    const { extractHtml } = await import("../../server/source-enrichment/source-text");
    // ies-co.com/Contact9.html structure (empty <article>, content in <body>)
    const ies = extractHtml(`<html><body><article></article><h3>Corporate Office</h3><ul><li>13131 Dairy Ashford Rd</li><li>Suite 500</li><li>Sugar Land, TX 77478</li><li>Tel: (713) 860-1500</li></ul>${"<p>IES provides infrastructure products and services to a variety of end markets.</p>".repeat(3)}</body></html>`);
    expect(ies.text).toContain("Tel: (713) 860-1500");
    expect(extractOfficeChannels(ies.text, "https://ies-co.com/Contact9.html")[0]).toMatchObject({ phone: "(713) 860-1500", kind: "MAIN", label: "Corporate Office" });
    // mmrgrp.com/locations structure (labels are icons)
    const mmr = extractHtml(`<html><body><main><h3>Beaumont, TX</h3><p>7065 Fannett Road<br>Beaumont, TX 77705</p><p><a href="tel:(409) 727-0456"><img src="/assets/icons/phoneicon.svg"> (409) 727-0456</a></p><p><a href="tel:(409) 727-1459"><img src="/assets/icons/faxicon.svg"> (409) 727-1459</a></p>${"<p>MMR Constructors offers electrical and instrumentation services.</p>".repeat(4)}</main></body></html>`);
    expect(extractOfficeChannels(mmr.text, "https://mmrgrp.com/locations")).toEqual([expect.objectContaining({ phone: "(409) 727-0456", kind: "OFFICE", label: "Beaumont, TX" })]);
  });
});

describe("interaction form date", () => {
  it("defaults to today's date in America/Chicago, not UTC", async () => {
    const { todayInChicago } = await import("../../components/opportunity-discovery/buyer-workspace");
    expect(todayInChicago(new Date("2026-10-01T03:30:00Z"))).toBe("2026-09-30"); // 10:30 PM CDT on Sep 30
    expect(todayInChicago(new Date("2026-10-01T15:00:00Z"))).toBe("2026-10-01");
    expect(todayInChicago(new Date("2026-12-01T05:30:00Z"))).toBe("2026-11-30"); // 11:30 PM CST
  });
});

describe("actionable commercial route", () => {
  const office: CorporateChannel = { candidateId: "o", kind: "PHONE_ROUTE", value: "(713) 455-6700", label: "LINK Staffing Houston East", phoneKind: "OFFICE", sourceUrl: "https://linkstaffing.com/locations/houston-east/" };
  const main: CorporateChannel = { candidateId: "m", kind: "PHONE_ROUTE", value: "(800) 848-5465", label: "LINK Staffing Corporate Office", phoneKind: "MAIN", sourceUrl: "https://linkstaffing.com/locations/houston-tx/" };
  // linkstaffing.com/east-houston-supply-chain-staffing/ (2026-04-01)
  const sampleford = evidence({ candidateId: "d", name: "Rowan Sampleford", title: "Branch Manager", personKey: personKey("Rowan Sampleford", "LINK Staffing"), sourceUrl: "https://linkstaffing.com/east-houston-supply-chain-staffing/",
    sourceDate: "2026-04-01", quote: "I’m Rowan Sampleford, Branch Manager at LINK Staffing East Houston." });

  it("routes to the person's own branch line (C) without promoting the person to State 3", () => {
    const people = groupPeople([sampleford], [], "STAFFING_AGENCY", staffing);
    expect(officeForPerson(people[0], [main, office], "LINK Staffing")?.candidateId).toBe("o");
    const route = actionableRoute({ organization: "LINK Staffing", type: "STAFFING_AGENCY", people, channels: [main, office], departmentEvidence: [] });
    expect(route).toMatchObject({ phoneClass: "C_DEPARTMENT", instruction: "CALL_OFFICE_ASK_PERSON", phone: { number: "(713) 455-6700", matchedOffice: true }, department: "BRANCH_OFFICE", alternative: { candidateId: "m" } });
    expect(route.person?.state).toBe("PROFESSIONAL_IDENTIFIED");
    expect(route.verified).toEqual(expect.arrayContaining(["PERSON_NAMED", "CURRENT_SOURCE", "TITLE_IN_TARGET_FUNCTION", "OFFICE_LINE_PUBLISHED"]));
    expect(route.pending).toEqual(expect.arrayContaining(["RESPONSIBILITY", "DIRECT_LINE", "PROFESSIONAL_EMAIL"]));
  });

  it("never ties an office line to a person from another office", () => {
    const irving = groupPeople([evidence({ name: "Emerson Fixtureman", title: "Branch Manager", personKey: personKey("Emerson Fixtureman", "LINK Staffing"), quote: "Emerson Fixtureman, Branch Manager of our Irving, Texas, office" })], [], "STAFFING_AGENCY", staffing);
    expect(officeForPerson(irving[0], [office], "LINK Staffing")).toBeNull();
  });

  it("with only a main line, asks the central for the function and the named person (D)", () => {
    const fixturo = evidence({ name: "Riley Fixturo", title: "Operations Manager", personKey: personKey("Riley Fixturo", "MMR"), sourceType: "PRESS_RELEASE", sourceDate: "2024-01-04", currency: "HISTORICAL", quote: "Riley Fixturo, Operations Manager, Corpus Christi (27 years)" });
    const mmrMain: CorporateChannel = { candidateId: "x", kind: "PHONE_ROUTE", value: "(800) 880-5090", label: "Contact Us", phoneKind: "MAIN", sourceUrl: "https://mmrgrp.com/contact" };
    const route = actionableRoute({ organization: "MMR Constructors", type: "ELECTRICAL_CONSTRUCTION", people: groupPeople([fixturo], [], "ELECTRICAL_CONSTRUCTION", construction), channels: [mmrMain], departmentEvidence: [] });
    expect(route).toMatchObject({ phoneClass: "D_MAIN", instruction: "ASK_CENTRAL_FOR_PERSON", department: "FIELD_OPERATIONS_MANPOWER" });
    expect(route.person?.state).toBe("PROFESSIONAL_IDENTIFIED");
    expect(route.pending).toContain("CURRENT_ROLE");
  });

  it("uses department evidence and the supplier process when no phone exists (E)", () => {
    const route = actionableRoute({ organization: "Zachry Group", type: "INDUSTRIAL_CONTRACTOR", people: [], channels: [],
      departmentEvidence: [{ quote: "The Procurement Group's primary areas include … Subcontract Management. Suppliers are qualified through ISNetworld.", url: "https://zachrygroup.com/procurement" }] });
    expect(route).toMatchObject({ phoneClass: "E_NOT_FOUND", instruction: "USE_SUPPLIER_PROCESS", department: "PROCUREMENT_SUBCONTRACTS", person: null });
    expect(route.pending).toContain("NAMED_PERSON");
  });

  it("keeps a departmental route when the official site names the buying department (Zachry: Project Manager is not presented as the buyer)", () => {
    const jamieDummett = evidence({ name: "Jamie Dummett", title: "Project Manager", personKey: personKey("Jamie Dummett", "Zachry Group"), sourceType: "PROFESSIONAL_PROFILE_LISTING", currency: "UNDATED", quote: "Jamie Dummett - Project Manager at Zachry Group | LinkedIn" });
    const people = groupPeople([jamieDummett], [], "INDUSTRIAL_CONTRACTOR", BUYER_FUNCTIONS.INDUSTRIAL_CONTRACTOR);
    const home: CorporateChannel = { candidateId: "h", kind: "PHONE_ROUTE", value: "(210) 588-5000", label: "Home Office", phoneKind: "MAIN", sourceUrl: "https://zachrygroup.com/about" };
    const procurement = [{ quote: "Primary functional areas within the Procurement Group include … Subcontract Management. … register your company with Zachry Group …", url: "https://zachrygroup.com/procurement" }];
    const route = actionableRoute({ organization: "Zachry Group", type: "INDUSTRIAL_CONTRACTOR", people, channels: [home], departmentEvidence: procurement });
    expect(route).toMatchObject({ person: null, phoneClass: "D_MAIN", instruction: "ASK_CENTRAL_FOR_FUNCTION", department: "PROCUREMENT_SUBCONTRACTS", phone: { number: "(210) 588-5000" } });
    expect(route.verified).toEqual(expect.arrayContaining(["DEPARTMENT_EVIDENCE", "CORPORATE_LINE_PUBLISHED"]));
    expect(route.pending).toContain("NAMED_PERSON");
    expect(people[0].state).toBe("PROFESSIONAL_IDENTIFIED"); // the person keeps their own state
    // A named buyer in the documented buying function stays the target.
    const buyer = groupPeople([evidence({ name: "Pat Example", title: "Procurement Manager", currency: "CURRENT" })], [], "INDUSTRIAL_CONTRACTOR", BUYER_FUNCTIONS.INDUSTRIAL_CONTRACTOR);
    expect(actionableRoute({ organization: "Zachry Group", type: "INDUSTRIAL_CONTRACTOR", people: buyer, channels: [home], departmentEvidence: procurement }).person?.name).toBe("Pat Example");
  });

  it("separates a corporate extension (B) from a direct line (A), and only explicit evidence reaches State 4", () => {
    const withExtension = groupPeople([evidence({ phone: "(713) 555-0100 ext. 214", phoneKind: "EXTENSION" })], [], "ELECTRICAL_CONSTRUCTION", construction)[0];
    expect(withExtension.phone).toMatchObject({ status: "CORPORATE_EXTENSION" });
    expect(withExtension.state).toBe("PROFESSIONAL_CONTACTABLE");
    expect(actionableRoute({ organization: "Acme", type: "ELECTRICAL_CONSTRUCTION", people: [withExtension], channels: [], departmentEvidence: [] }).phoneClass).toBe("B_EXTENSION");
    const titleOnly = groupPeople([evidence({})], [], "ELECTRICAL_CONSTRUCTION", construction)[0];
    expect(titleOnly.state).toBe("PROFESSIONAL_IDENTIFIED");
    const documented = groupPeople([evidence({ responsibilityEvidence: "oversees craft labor and subcontractors" })], [], "ELECTRICAL_CONSTRUCTION", construction)[0];
    expect(documented.state).toBe("COMMERCIAL_RESPONSIBILITY_CONFIRMED");
    expect(actionableRoute({ organization: "Acme", type: "ELECTRICAL_CONSTRUCTION", people: [documented], channels: [], departmentEvidence: [] }).responsibility).toMatchObject({ kind: "EVIDENCE" });
  });
});
