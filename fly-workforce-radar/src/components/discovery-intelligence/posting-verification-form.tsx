"use client";

import { useActionState, useState } from "react";
import type { Locale } from "../../i18n/locale";
import { recordPostingVerificationAction, type PostingVerificationState } from "../../server/discovery-intelligence/posting-verification-actions";
import { LINK_ISSUE_CATEGORIES } from "../../domain/ats-url-hygiene";
import { guidedCopy } from "./intelligence-copy";

const IDLE: PostingVerificationState = { status: "IDLE", error: null, decision: null };

/**
 * Step 1: the operator's explicit decision about the posting itself. No default decision: it must be chosen.
 * When the posting cannot be verified, the operator says why (obsolete URL, withdrawn, access error, unknown);
 * only "withdrawn" — stated by the official page — can close it as not confirmed.
 */
export function PostingVerificationForm({ locale, candidateId }: { readonly locale: Locale; readonly candidateId: string }) {
  const t = guidedCopy(locale);
  const [state, action, pending] = useActionState(recordPostingVerificationAction, IDLE);
  const [decision, setDecision] = useState<string>("");
  return (
    <form action={action} className="sig-review-form" aria-label={t.step1}>
      <input type="hidden" name="candidateId" value={candidateId} />
      <fieldset>
        <legend>{t.decision}</legend>
        {(["VERIFIED", "NEEDS_REVIEW", "REJECTED"] as const).map((value) => (
          <label key={value} className={`sig-decision sig-decision-${value.toLowerCase()}`}>
            <input type="radio" name="decision" value={value} required checked={decision === value} onChange={() => setDecision(value)} />
            <span>{t.decisions[value]}</span>
          </label>
        ))}
      </fieldset>
      {decision && decision !== "VERIFIED" ? (
        <label className="guided-note"><span>{t.linkCategory}</span>
          <select name="linkCategory" required={decision === "REJECTED"} defaultValue="">
            <option value="">{t.linkCategoryNone}</option>
            {LINK_ISSUE_CATEGORIES.map((c) => <option key={c} value={c}>{t.linkCategories[c]}</option>)}
          </select>
          <small>{t.linkCategoryRule}</small>
        </label>
      ) : null}
      <label className="guided-note"><span>{t.note}</span><textarea name="note" rows={3} maxLength={1900} /></label>
      <label className="review-r1-confirm"><input type="checkbox" required /> {t.confirm}</label>
      {state.error ? <p role="alert" className="sig-form-error">{t.errors[state.error]}</p> : null}
      {state.status === "SAVED" ? <p role="status" className="sig-form-ok">{t.saved} {state.decision ? t.decisions[state.decision] : ""}</p> : null}
      <button type="submit" className="button button-primary" disabled={pending}>{pending ? t.saving : t.submit}</button>
    </form>
  );
}
