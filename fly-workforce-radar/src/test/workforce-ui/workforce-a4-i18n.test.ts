import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import type { DictionaryKey } from "../../i18n/dictionary-shape";
import { resultToState } from "../../server/workforce/worker-action-helpers";

/**
 * WORKFORCE-TALENT-A4-R1. Every (successKey, genericErrorKey) pair actually
 * passed to resultToState() by worker-actions.ts, enumerated by hand against
 * that file rather than re-deriving it dynamically -- this test's whole job
 * is to catch exactly the class of defect that slipped through before: a key
 * referenced in code that was never added to the dictionary. resultToState's
 * own successKey/errorKey fields are plain `string`, not `DictionaryKey`, so
 * nothing at the type level would have caught a typo or omission here.
 */
const FEEDBACK_KEY_PAIRS: readonly [success: DictionaryKey, error: DictionaryKey][] = [
  ["workforce.overview.updateSuccess", "workforce.overview.updateError"],
  ["workforce.tradeOccupation.addSuccess", "workforce.tradeOccupation.addError"],
  ["workforce.skills.addSuccess", "workforce.skills.addError"],
  ["workforce.credentials.addSuccess", "workforce.credentials.addError"],
  ["workforce.availability.addSuccess", "workforce.availability.addError"],
  ["workforce.location.addSuccess", "workforce.location.addError"],
  ["workforce.workHistory.addSuccess", "workforce.workHistory.addError"],
  ["workforce.contact.addSuccess", "workforce.contact.addError"],
  ["workforce.compensation.addSuccess", "workforce.compensation.addError"],
];

const AUTH_FAILURE_KEYS: readonly DictionaryKey[] = ["workforce.requiresSignIn", "workforce.requiresOperator"];
const CREATE_FAILURE_KEYS: readonly DictionaryKey[] = ["workforce.create.validationError", "workforce.create.submissionFailed"];

function isMissing(rendered: string): boolean {
  return rendered.startsWith("[[missing:");
}

describe("WORKFORCE-TALENT-A4-R1 feedback key coverage", () => {
  it("every worker mutation's success and error key resolves to real text in both locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [successKey, errorKey] of FEEDBACK_KEY_PAIRS) {
        const successText = t(locale, successKey);
        const errorText = t(locale, errorKey);
        expect(isMissing(successText), `${locale} ${successKey} -> "${successText}"`).toBe(false);
        expect(isMissing(errorText), `${locale} ${errorKey} -> "${errorText}"`).toBe(false);
        expect(successText.length).toBeGreaterThan(0);
        expect(errorText.length).toBeGreaterThan(0);
      }
    }
  });

  it("auth-failure and create-failure keys resolve in both locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of [...AUTH_FAILURE_KEYS, ...CREATE_FAILURE_KEYS]) {
        expect(isMissing(t(locale, key)), `${locale} ${key}`).toBe(false);
      }
    }
  });

  it("no [[missing: workforce. ]] fallback occurs for any known worker feedback key", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [successKey, errorKey] of FEEDBACK_KEY_PAIRS) {
        expect(t(locale, successKey)).not.toMatch(/^\[\[missing: workforce\./);
        expect(t(locale, errorKey)).not.toMatch(/^\[\[missing: workforce\./);
      }
    }
  });

  it("success messages describe completed persistence, distinct per domain (not one generic string copy-pasted everywhere)", () => {
    const successTexts = FEEDBACK_KEY_PAIRS.map(([successKey]) => t("en-US", successKey));
    expect(new Set(successTexts).size).toBe(successTexts.length);
    for (const text of successTexts) expect(text).not.toMatch(/error|fail|restricted/i);
  });

  it("error messages clearly state the operation did not complete, and never leak internals", () => {
    for (const [, errorKey] of FEEDBACK_KEY_PAIRS) {
      const text = t("en-US", errorKey);
      expect(text).toMatch(/could not|not completed|failed/i);
      expect(text).not.toMatch(/sql|postgres|constraint|stack|exception|null|undefined/i);
    }
  });

  it("resultToState selects a success key only for an OK result, and the matching error key otherwise -- for every real mutation pair", () => {
    for (const [successKey, errorKey] of FEEDBACK_KEY_PAIRS) {
      const ok = resultToState({ kind: "OK", value: {} }, successKey, errorKey);
      expect(ok).toEqual({ successKey, errorKey: null });

      const validationFailure = resultToState({ kind: "VALIDATION_ERROR", detail: "synthetic detail, never surfaced" }, successKey, errorKey);
      expect(validationFailure).toEqual({ successKey: null, errorKey });

      const unauthenticated = resultToState({ kind: "UNAUTHENTICATED" }, successKey, errorKey);
      expect(unauthenticated.errorKey).toBe("workforce.requiresSignIn");
      expect(unauthenticated.successKey).toBeNull();

      const unauthorized = resultToState({ kind: "UNAUTHORIZED" }, successKey, errorKey);
      expect(unauthorized.errorKey).toBe("workforce.requiresOperator");
      expect(unauthorized.successKey).toBeNull();
    }
  });
});
