import { describe, expect, it } from "vitest";
import { isPendingOn, normalizeCorporatePhone, supplierAnswerFromCall, validateCompanyCall, validateCorporateChannel, validateNextAction } from "../../domain/company-contact-desk";

const NOW = new Date("2026-10-10T18:00:00Z");
const call = { companyId: "c", contactRouteId: null, contactDate: "2026-10-10", callOutcome: "REACHED", supplierAnswer: "YES", counterpartName: null, counterpartRole: "Operations", notes: "Spoke with operations.", isDemo: false };

describe("Company contact desk — rules", () => {
  it("normalizes US corporate phones and validates published channels with an https source", () => {
    expect(normalizeCorporatePhone("713-864-3801")).toBe("+17138643801");
    expect(normalizeCorporatePhone("+1 (713) 864-3801")).toBe("+17138643801");
    expect(normalizeCorporatePhone("864-3801")).toBeNull();
    const ok = { companyId: "c", routeType: "OFFICE_PHONE", value: "713-864-3801", sourceUrl: "https://www.walkertx.com/contact/", observedOn: "2026-10-10", locationLabel: "Houston", sourceNote: null };
    expect(validateCorporateChannel(ok, NOW)).toEqual({});
    expect(validateCorporateChannel({ ...ok, sourceUrl: "http://walkertx.com" }, NOW)).toEqual({ sourceUrl: "httpsRequired" });
    expect(validateCorporateChannel({ ...ok, routeType: "PROFESSIONAL_PHONE" }, NOW)).toEqual({ routeType: "invalid" }); // never a person's channel
    expect(validateCorporateChannel({ ...ok, routeType: "CORPORATE_EMAIL", value: "not-an-email" }, NOW)).toEqual({ value: "invalidEmail" });
  });
  it("keeps real calls real: NOT_CALLED only for DEMO, supplier answers only when someone was reached, DEMO notes say so", () => {
    expect(validateCompanyCall(call, NOW)).toEqual({});
    expect(validateCompanyCall({ ...call, callOutcome: "NOT_CALLED", supplierAnswer: "NOT_ASKED" }, NOW)).toEqual({ callOutcome: "notCalledOnlyForDemo" });
    expect(validateCompanyCall({ ...call, callOutcome: "VOICEMAIL", supplierAnswer: "YES" }, NOW)).toEqual({ supplierAnswer: "answerNeedsReachedCall" });
    expect(validateCompanyCall({ ...call, callOutcome: "VOICEMAIL", supplierAnswer: "NOT_ASKED" }, NOW)).toEqual({});
    expect(validateCompanyCall({ ...call, isDemo: true, callOutcome: "NOT_CALLED", supplierAnswer: "NOT_ASKED", notes: "PRUEBA DE INTERFAZ — NO HUBO LLAMADA REAL" }, NOW)).toEqual({});
    expect(validateCompanyCall({ ...call, isDemo: true, notes: "looks real" }, NOW)).toEqual({ notes: "demoNotesMustSayDemo" });
    expect(validateCompanyCall({ ...call, contactDate: "2026-10-20" }, NOW)).toEqual({ contactDate: "future" });
    expect(validateCompanyCall({ ...call, supplierAnswer: "MAYBE" }, NOW)).toEqual({ supplierAnswer: "invalid" });
  });
  it("requires action, due date and owner for next actions, and DEMO actions must say so", () => {
    const action = { companyId: "c", action: "Call operations", dueDate: "2026-10-10", ownerOperatorId: "20000000-0000-4000-8000-000000000001", isDemo: false };
    expect(validateNextAction(action)).toEqual({});
    expect(validateNextAction({ ...action, action: " ", ownerOperatorId: "" })).toEqual({ action: "required", ownerOperatorId: "required" });
    expect(validateNextAction({ ...action, isDemo: true })).toEqual({ action: "demoActionMustSayDemo" });
    expect(isPendingOn({ status: "OPEN", dueDate: "2026-10-09" }, "2026-10-10")).toBe(true);
    expect(isPendingOn({ status: "OPEN", dueDate: "2026-10-11" }, "2026-10-10")).toBe(false);
    expect(isPendingOn({ status: "DONE", dueDate: "2026-10-09" }, "2026-10-10")).toBe(false);
  });
  it("maps the five call answers to the supplier-answer vocabulary (NOT_ASKED is not an answer)", () => {
    expect(["YES", "NO", "OWN_AGENCY_ONLY", "UNKNOWN", "NOT_ASKED"].map((a) => supplierAnswerFromCall(a as never))).toEqual(["YES", "NO", "OWN_AGENCY_ONLY", "NO_RESPONSE", null]);
  });
});
