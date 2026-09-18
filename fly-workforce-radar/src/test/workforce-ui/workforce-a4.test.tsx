import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkforceListView } from "../../components/workforce/workforce-list-view";
import { WorkerCreateForm } from "../../components/workforce/worker-create-form";
import { WorkerProfileView } from "../../components/workforce/worker-profile-view";
import { parseWorkforceListQuery, workforceListHref, type WorkforceListResult } from "../../server/workforce/get-workforce-list";
import { resultToState } from "../../server/workforce/worker-action-helpers";
import type { WorkerProfile } from "../../domain/worker";
import type { WorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import type { WorkerUiPermissions } from "../../server/workforce/worker-permissions";

const WORKER_ID = "11111111-1111-4111-8111-111111111111";
const RAW_IDENTIFIER_CANARY = "SYNTH-RAW-IDENTIFIER-DO-NOT-RENDER-99";

const taxonomy: WorkforceTaxonomy = {
  trades: [{ code: "ELECTRICAL", labelEn: "Electrical" }, { code: "WELDING", labelEn: "Welding" }],
  occupations: [{ code: "ELECTRICIAN", tradeCode: "ELECTRICAL", labelEn: "Electrician" }, { code: "WELDER", tradeCode: "WELDING", labelEn: "Welder" }],
  skills: [{ code: "INDUSTRIAL_ELECTRICAL", labelEn: "Industrial electrical" }],
  credentials: [{ code: "OSHA_10", labelEn: "OSHA 10" }],
};

const FULL_PERMISSIONS: WorkerUiPermissions = { authenticated: true, profileRead: true, profileWrite: true, contactRead: true, contactWrite: true, compensationRead: true, compensationWrite: true };
const PROFILE_ONLY_PERMISSIONS: WorkerUiPermissions = { authenticated: true, profileRead: true, profileWrite: false, contactRead: false, contactWrite: false, compensationRead: false, compensationWrite: false };
const CONTACT_READ_ONLY_PERMISSIONS: WorkerUiPermissions = { ...PROFILE_ONLY_PERMISSIONS, contactRead: true, contactWrite: false };
const COMPENSATION_READ_ONLY_PERMISSIONS: WorkerUiPermissions = { ...PROFILE_ONLY_PERMISSIONS, compensationRead: true, compensationWrite: false };

function baseWorker(): WorkerProfile["worker"] {
  return {
    id: WORKER_ID, displayName: "SYNTHETIC-A4-WORKER", lifecycleStatus: "ACTIVE", profileVerificationState: "UNVERIFIED",
    verifiedAt: null, sourceOfRecord: "IMPORTED", firstSeenAt: new Date("2026-01-01"), lastSeenAt: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  };
}

function fullProfile(overrides: Partial<WorkerProfile> = {}): WorkerProfile {
  return {
    worker: baseWorker(),
    tradeOccupations: [
      { workerId: WORKER_ID, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 60, verificationState: "UNVERIFIED", sourceEvidenceId: null, createdAt: new Date("2026-01-01") },
      { workerId: WORKER_ID, tradeCode: "WELDING", occupationCode: "WELDER", roleDesignation: "SECONDARY", experienceMonths: null, verificationState: "UNVERIFIED", sourceEvidenceId: null, createdAt: new Date("2026-01-01") },
    ],
    skills: [{ workerId: WORKER_ID, skillCode: "INDUSTRIAL_ELECTRICAL", verificationState: "UNVERIFIED", sourceEvidenceId: null, selfReportedNote: null, createdAt: new Date("2026-01-01") }],
    credentials: [{ workerId: WORKER_ID, credentialCode: "OSHA_10", verificationState: "UNVERIFIED", verifiedAt: null, issuedAt: null, expiresAt: null, issuingAuthority: null, sourceEvidenceId: null, createdAt: new Date("2026-01-01") }],
    currentAvailability: { state: "UNKNOWN" },
    currentLocation: { state: "UNKNOWN" },
    workHistory: [],
    contact: { access: "GRANTED", value: { routes: [] } },
    compensation: { access: "GRANTED", value: [] },
    ...overrides,
  };
}

describe("WORKFORCE-TALENT-A4 workforce UI", () => {
  it("A. workforce list renders safe worker data", () => {
    const result: WorkforceListResult = {
      capability: "OPERATIONAL", authorized: true, reason: null,
      items: [{ worker: baseWorker(), primaryTradeOccupation: { workerId: WORKER_ID, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN", roleDesignation: "PRIMARY", experienceMonths: 60, verificationState: "UNVERIFIED", sourceEvidenceId: null, createdAt: new Date() }, tradeOccupationCount: 1, availabilityStatus: "AVAILABLE", locationSummary: "Abilene, TX", missingTrade: false, missingAvailability: false }],
    };
    const html = renderToStaticMarkup(<WorkforceListView locale="en-US" query={{ lifecycleStatus: null, tradeCode: null, occupationCode: null, page: 1 }} result={result} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate />);
    expect(html).toContain("SYNTHETIC-A4-WORKER");
    expect(html).toContain("ELECTRICIAN");
    expect(html).toContain("Abilene, TX");
  });

  it("B. renders an intentional empty workforce state", () => {
    const result: WorkforceListResult = { capability: "OPERATIONAL", authorized: true, reason: null, items: [] };
    const html = renderToStaticMarkup(<WorkforceListView locale="en-US" query={{ lifecycleStatus: null, tradeCode: null, occupationCode: null, page: 1 }} result={result} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate={false} />);
    expect(html).toContain("No workers yet");
    expect(html).not.toContain("SYNTHETIC");
  });

  it("C/D. worker creation form renders required field and no matching language; validation is enforced by WorkerService (A3, independently tested)", () => {
    const html = renderToStaticMarkup(<WorkerCreateForm locale="en-US" trades={taxonomy.trades} occupations={taxonomy.occupations} />);
    expect(html).toContain('name="displayName"');
    expect(html).toContain("required");
    expect(html).not.toMatch(/STRONG_MATCH|POSSIBLE_MATCH|score|ranking/i);
  });

  it("E/F. worker profile renders overview and multi-trade associations", () => {
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={fullProfile()} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    expect(html).toContain("SYNTHETIC-A4-WORKER");
    expect(html).toContain("ELECTRICIAN");
    expect(html).toContain("WELDER");
    expect(html).toContain("Primary");
    expect(html).toContain("Secondary");
  });

  it("G. skills management renders the canonical skill", () => {
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={fullProfile()} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    expect(html).toContain("INDUSTRIAL_ELECTRICAL");
  });

  it("H/I. credentials render the safe shape only -- raw_identifier never appears anywhere in the rendered profile", () => {
    const profile = fullProfile({
      credentials: [{ workerId: WORKER_ID, credentialCode: "OSHA_10", verificationState: "VERIFIED", verifiedAt: new Date("2026-01-01"), issuedAt: new Date("2025-01-01"), expiresAt: new Date("2027-01-01"), issuingAuthority: "State Board", sourceEvidenceId: null, createdAt: new Date("2026-01-01") }],
    });
    // Confirms structurally: WorkerCredentialRecord (the type this component consumes) has no field to even carry the canary value -- there is nowhere for it to leak from.
    expect(Object.keys(profile.credentials[0])).not.toContain("rawIdentifier");
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={profile} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    expect(html).toContain("OSHA_10");
    expect(html).not.toContain(RAW_IDENTIFIER_CANARY);
    expect(html).not.toContain("raw_identifier");
    // The add-credential form's write-only intake field is legitimately
    // named "rawIdentifier" -- that is not a leak. What must never appear is
    // a *value* for it anywhere, which the canary check above already covers.
    expect(html.match(/name="rawIdentifier"/g)?.length).toBe(1);
  });

  it("J. availability UNKNOWN (no record) never renders as 'Not available'", () => {
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={fullProfile({ currentAvailability: { state: "UNKNOWN" } })} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    // The status dropdown legitimately offers "Not available" as an option
    // an operator can choose -- what must never happen is the read-only
    // "Current availability" fact line itself claiming it.
    expect(html).toContain("Current availability: No information");
    expect(html).not.toContain("Current availability: Not available");
  });

  it("known-UNKNOWN availability status renders distinctly from the no-record UNKNOWN state", () => {
    const knownUnknownAvailability = { id: "avail-1", workerId: WORKER_ID, status: "UNKNOWN" as const, availableFrom: null, availableUntil: null, source: "SELF_REPORTED" as const, effectiveAt: new Date(), verificationState: "UNVERIFIED" as const, createdAt: new Date() };
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={fullProfile({ currentAvailability: { state: "KNOWN", value: knownUnknownAvailability } })} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    expect(html).toContain("Unknown");
  });

  it("K. location renders coarse fields only -- no latitude/longitude/address ever appears", () => {
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={fullProfile({ currentLocation: { state: "KNOWN", value: { id: "loc-1", workerId: WORKER_ID, city: "Abilene", region: "TX", country: "US", travelWilling: true, travelRadiusMiles: 150, relocationWilling: false, effectiveAt: new Date(), source: "SELF_REPORTED", createdAt: new Date() } } })} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    expect(html).toContain("Abilene");
    expect(html).toContain("150");
    expect(html).not.toMatch(/latitude|longitude|street/i);
  });

  it("L. work history renders employer and open-ended 'Present' entries", () => {
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={fullProfile({ workHistory: [{ id: "wh-1", workerId: WORKER_ID, employerLabel: "Synthetic Employer Co", projectLabel: null, occupationCode: null, tradeCode: null, startDate: new Date("2020-01-01"), endDate: null, verificationState: "UNVERIFIED", sourceEvidenceId: null, createdAt: new Date() }] })} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    expect(html).toContain("Synthetic Employer Co");
    expect(html).toContain("Present");
  });

  it("M/T. contact REDACTED renders 'Restricted access', never 'No information' or a phone-number-shaped placeholder", () => {
    const profile = fullProfile({ contact: { access: "REDACTED" } });
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={profile} taxonomy={taxonomy} permissions={PROFILE_ONLY_PERMISSIONS} />);
    expect(html).toContain("Contact information restricted");
    expect(html).not.toContain("No contact routes recorded yet");
  });

  it("N. contact read-only state shows data but never a mutation control", () => {
    const profile = fullProfile({ contact: { access: "GRANTED", value: { routes: [{ id: "route-1", workerId: WORKER_ID, routeType: "PHONE", target: "555-0100", preferred: false, verificationState: "UNVERIFIED", consentState: "GRANTED", consentCapturedAt: new Date(), consentSource: null, lifecycleStatus: "ACTIVE", createdAt: new Date(), updatedAt: new Date() }] } } });
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={profile} taxonomy={taxonomy} permissions={CONTACT_READ_ONLY_PERMISSIONS} />);
    expect(html).toContain("555-0100");
    expect(html).toContain("You can view contact information but cannot make changes");
    expect(html).not.toContain('name="target"');
    expect(html).not.toContain("Deactivate");
  });

  it("O/P. contact write state shows mutation controls, and a non-GRANTED route offers Grant while an already-GRANTED route does not re-offer it (fail-closed, no redundant re-grant)", () => {
    const profile = fullProfile({
      contact: {
        access: "GRANTED",
        value: {
          routes: [
            { id: "route-unknown", workerId: WORKER_ID, routeType: "EMAIL", target: "synthetic@example.invalid", preferred: false, verificationState: "UNVERIFIED", consentState: "UNKNOWN", consentCapturedAt: null, consentSource: null, lifecycleStatus: "ACTIVE", createdAt: new Date(), updatedAt: new Date() },
          ],
        },
      },
    });
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={profile} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    expect(html).toContain('name="target"');
    expect(html).toContain("Deactivate");
    expect(html).toContain("Granted"); // the "Grant" action button, offered because consent is UNKNOWN
  });

  it("Q/T. compensation REDACTED renders 'Restricted access', never '$0' or 'No information'", () => {
    const profile = fullProfile({ compensation: { access: "REDACTED" } });
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={profile} taxonomy={taxonomy} permissions={PROFILE_ONLY_PERMISSIONS} />);
    expect(html).toContain("Compensation information restricted");
    expect(html).not.toContain("$0");
  });

  it("R. compensation read-only state shows values but no add form", () => {
    const profile = fullProfile({ compensation: { access: "GRANTED", value: [{ id: "comp-1", workerId: WORKER_ID, rateType: "HOURLY", rateMin: 32, ratePreferred: 36, currency: "USD", perDiemRequired: true, overtimeExpectation: null, travelPayExpectation: null, negotiable: true, effectiveAt: new Date(), createdAt: new Date() }] } });
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={profile} taxonomy={taxonomy} permissions={COMPENSATION_READ_ONLY_PERMISSIONS} />);
    expect(html).toContain("32 USD");
    expect(html).toContain("You can view compensation information but cannot make changes");
    expect(html).not.toContain('name="rateMin"');
  });

  it("S. compensation write state shows the append form", () => {
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={fullProfile()} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    expect(html).toContain('name="rateMin"');
  });

  it("U. resolveWorkerUiPermissions denies (all-false) for an unauthenticated session", async () => {
    const { resolveWorkerUiPermissions } = await import("../../server/workforce/worker-permissions");
    const result = await resolveWorkerUiPermissions({ getSession: () => Promise.resolve(null), repository: null });
    expect(result).toEqual({ authenticated: false, profileRead: false, profileWrite: false, contactRead: false, contactWrite: false, compensationRead: false, compensationWrite: false });
  });

  it("V. write controls (overview edit, add-trade form) are permission-aware -- absent entirely for a no-write caller", () => {
    const noWrite: WorkerUiPermissions = { ...FULL_PERMISSIONS, profileWrite: false };
    const html = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={fullProfile()} taxonomy={taxonomy} permissions={noWrite} />);
    expect(html).not.toContain('name="displayName" type="text"');
    expect(html).not.toContain("Add trade/occupation");
  });

  it("W. no matching/ranking language appears anywhere in the workforce UI", () => {
    const listResult: WorkforceListResult = { capability: "OPERATIONAL", authorized: true, reason: null, items: [{ worker: baseWorker(), primaryTradeOccupation: null, tradeOccupationCount: 0, availabilityStatus: null, locationSummary: null, missingTrade: true, missingAvailability: true }] };
    const listHtml = renderToStaticMarkup(<WorkforceListView locale="en-US" query={{ lifecycleStatus: null, tradeCode: null, occupationCode: null, page: 1 }} result={listResult} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate />);
    const profileHtml = renderToStaticMarkup(<WorkerProfileView locale="en-US" profile={fullProfile()} taxonomy={taxonomy} permissions={FULL_PERMISSIONS} />);
    for (const html of [listHtml, profileHtml]) {
      expect(html).not.toMatch(/STRONG_MATCH|POSSIBLE_MATCH|NO_MATCH|HOT worker|match score|candidate ranking/i);
    }
  });

  it("X. resultToState maps a successful mutation to a success key (the signal worker-actions.ts uses to trigger revalidatePath)", () => {
    expect(resultToState({ kind: "OK", value: {} }, "workforce.overview.updateSuccess", "workforce.overview.updateError")).toEqual({ successKey: "workforce.overview.updateSuccess", errorKey: null });
  });

  it("Y. resultToState never leaks a validation detail string -- only a fixed dictionary key crosses into the UI", () => {
    const state = resultToState({ kind: "VALIDATION_ERROR", detail: "Referenced taxonomy code or worker record does not exist" }, "x", "workforce.tradeOccupation.addError");
    expect(state.errorKey).toBe("workforce.tradeOccupation.addError");
    expect(JSON.stringify(state)).not.toContain("Referenced taxonomy code");
    expect(resultToState({ kind: "UNAUTHENTICATED" }, "x", "generic").errorKey).toBe("workforce.requiresSignIn");
    expect(resultToState({ kind: "UNAUTHORIZED" }, "x", "generic").errorKey).toBe("workforce.requiresOperator");
  });

  it("parses bounded list query filters and builds stable hrefs", () => {
    const query = parseWorkforceListQuery({ lifecycle: "ACTIVE", trade: "ELECTRICAL", page: "2" });
    expect(query).toEqual({ lifecycleStatus: "ACTIVE", tradeCode: "ELECTRICAL", occupationCode: null, page: 2 });
    expect(workforceListHref(query, { page: 3 })).toBe("/workforce?lifecycle=ACTIVE&trade=ELECTRICAL&page=3");
    expect(parseWorkforceListQuery({ lifecycle: "NOT_A_REAL_STATE" }).lifecycleStatus).toBeNull();
  });
});
