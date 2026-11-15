"use client";

import { useActionState, useState } from "react";
import type { Locale } from "../../i18n/locale";
import { recordSupplierAnswerAction, type SupplierAnswerState } from "../../server/discovery-intelligence/external-supplier-answer-actions";
import { SUPPLIER_ANSWERS, SUPPLIER_CHANNELS } from "../../domain/external-supplier-answer";
import { supplierCopy } from "./intelligence-copy";

const IDLE: SupplierAnswerState = { status: "IDLE", errors: {}, answer: null };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Records the human answer to "Does the company use external suppliers or agencies to hire electrical staff?".
 * Every field is what the operator heard or saw: nothing is pre-filled except the company being asked about.
 */
export function ExternalSupplierAnswerForm({ locale, catalogKey, companyId, companyName }: {
  readonly locale: Locale; readonly catalogKey: string | null; readonly companyId: string | null; readonly companyName: string;
}) {
  const t = supplierCopy(locale);
  const [state, action, pending] = useActionState(recordSupplierAnswerAction, IDLE);
  const [answer, setAnswer] = useState("");
  const asked = answer !== "" && answer !== "NOT_INVESTIGATED";
  const err = (name: string) => (state.errors[name] ? <small role="alert">{t.errors[state.errors[name]] ?? state.errors[name]}</small> : null);
  return (
    <details className="supplier-answer" open={state.status !== "IDLE" || undefined}><summary>{t.record}</summary>
      <form action={action} aria-label={t.question}>
        <p><strong>{t.question}</strong></p>
        <p className="sig-muted">{t.rules}</p>
        <input type="hidden" name="catalogKey" value={catalogKey ?? ""} /><input type="hidden" name="companyId" value={companyId ?? ""} /><input type="hidden" name="companyName" value={companyName} />
        <div className="sig-form-grid">
          <label><span>{t.answer} *</span><select name="answer" required value={answer} onChange={(e) => setAnswer(e.target.value)}>
            <option value="" disabled>{t.select}</option>{SUPPLIER_ANSWERS.map((a) => <option key={a} value={a}>{t.answers[a]}</option>)}</select>{err("answer")}</label>
          <label><span>{t.conversationDate}{asked ? " *" : ""}</span><input name="conversationDate" type="date" max={today()} required={asked} />{err("conversationDate")}</label>
          <label><span>{t.channel}{asked ? " *" : ""}</span><select name="channel" defaultValue="" required={asked}><option value="">{t.select}</option>{SUPPLIER_CHANNELS.map((c) => <option key={c} value={c}>{t.channels[c]}</option>)}</select>{err("channel")}</label>
          <label><span>{t.responderName}</span><input name="responderName" maxLength={200} />{err("responderName")}</label>
          <label><span>{t.responderRole}</span><input name="responderRole" maxLength={200} />{err("responderRole")}</label>
          <label><span>{t.evidence}{answer === "YES" ? " *" : ""}</span><input name="evidenceReference" maxLength={500} required={answer === "YES"} placeholder={t.evidencePlaceholder} />{err("evidenceReference")}</label>
          <label><span>{t.summary}{asked ? " *" : ""}</span><textarea name="summary" maxLength={1000} rows={3} required={asked} />{err("summary")}</label>
          <label><span>{t.nextAction} *</span><input name="nextAction" maxLength={300} required />{err("nextAction")}</label>
        </div>
        {err("subject")}
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? t.saving : t.submit}</button>
        {state.status === "SAVED" && state.answer ? <p role="status">{t.saved} {t.answers[state.answer as keyof typeof t.answers]}</p> : null}
        {state.status === "INVALID" ? <p role="status">{t.check}</p> : null}
        {state.status === "RESTRICTED" ? <p role="status">{t.restricted}</p> : null}
        {state.status === "UNAVAILABLE" ? <p role="status">{t.unavailable}</p> : null}
        {state.status === "FAILED" ? <p role="status">{t.failed} {state.errors.form}</p> : null}
      </form>
    </details>
  );
}
