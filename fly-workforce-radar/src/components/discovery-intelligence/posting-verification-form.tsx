"use client";

import { useActionState } from "react";
import type { Locale } from "../../i18n/locale";
import { recordPostingVerificationAction, type PostingVerificationState } from "../../server/discovery-intelligence/posting-verification-actions";
import { guidedCopy } from "./intelligence-copy";

const IDLE: PostingVerificationState = { status: "IDLE", error: null, decision: null };

/** Step 1: the operator's explicit decision about the posting itself. No default decision: it must be chosen. */
export function PostingVerificationForm({ locale, candidateId }: { readonly locale: Locale; readonly candidateId: string }) {
  const t = guidedCopy(locale);
  const [state, action, pending] = useActionState(recordPostingVerificationAction, IDLE);
  return (
    <form action={action} className="sig-review-form" aria-label={t.step1}>
      <input type="hidden" name="candidateId" value={candidateId} />
      <fieldset>
        <legend>{t.decision}</legend>
        {(["VERIFIED", "NEEDS_REVIEW", "REJECTED"] as const).map((decision) => (
          <label key={decision} className={`sig-decision sig-decision-${decision.toLowerCase()}`}>
            <input type="radio" name="decision" value={decision} required />
            <span>{t.decisions[decision]}</span>
          </label>
        ))}
      </fieldset>
      <label className="guided-note"><span>{t.note}</span><textarea name="note" rows={3} maxLength={2000} /></label>
      <label className="review-r1-confirm"><input type="checkbox" required /> {t.confirm}</label>
      {state.error ? <p role="alert" className="sig-form-error">{t.errors[state.error]}</p> : null}
      {state.status === "SAVED" ? <p role="status" className="sig-form-ok">{t.saved} {state.decision ? t.decisions[state.decision] : ""}</p> : null}
      <button type="submit" className="button button-primary" disabled={pending}>{pending ? t.saving : t.submit}</button>
    </form>
  );
}
