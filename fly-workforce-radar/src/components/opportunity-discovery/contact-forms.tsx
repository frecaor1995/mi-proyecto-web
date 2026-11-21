"use client";

import { useActionState } from "react";
import type { Locale } from "../../i18n/locale";
import { decideContactAction, startContactInvestigationAction, validateContactAction, type ContactActionState } from "../../server/contact-intelligence/actions";
import { discoveryCopy } from "./discovery-copy";

const INITIAL: ContactActionState = { state: "IDLE", detail: null };

function Result({ locale, result }: { readonly locale: Locale; readonly result: ContactActionState }) {
  const c = discoveryCopy(locale).contact;
  if (result.state === "IDLE") return null;
  const detail = result.state === "NOT_CONFIGURED" ? ` ${result.detail}` : result.state === "DONE" && result.detail && c.canonical[result.detail] ? ` ${c.canonical[result.detail]}` : "";
  return <p role="status" className={result.state === "DONE" ? "dr-run-ok" : "dr-run-warn"}>{c.result[result.state]}{detail}</p>;
}

export function StartInvestigationForm({ locale, signalId, started }: { readonly locale: Locale; readonly signalId: string; readonly started: boolean }) {
  const c = discoveryCopy(locale).contact;
  const [result, action, pending] = useActionState(startContactInvestigationAction, INITIAL);
  return (
    <form action={action} className="dr-run">
      <input type="hidden" name="signalId" value={signalId} />
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? c.running : started ? c.refresh : c.start}</button>
      <Result locale={locale} result={result} />
    </form>
  );
}

export function ValidateContactForm({ locale, signalId, contactId, channel, configured, companyId }: { readonly locale: Locale; readonly signalId: string; readonly contactId: string; readonly channel: "EMAIL" | "PHONE"; readonly configured: boolean; readonly companyId?: string }) {
  const c = discoveryCopy(locale).contact;
  const [result, action, pending] = useActionState(validateContactAction, INITIAL);
  return (
    <form action={action} className="ct-inline">
      <input type="hidden" name="signalId" value={signalId} /><input type="hidden" name="contactId" value={contactId} /><input type="hidden" name="channel" value={channel} />
      {companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}
      <button className="button button-ghost" type="submit" disabled={pending || !configured} title={configured ? undefined : `${c.providerState.NOT_CONFIGURED} ${channel === "EMAIL" ? "HUNTER_API_KEY" : "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN"}`}>
        {channel === "EMAIL" ? c.validateEmail : c.validatePhone}
      </button>
      <Result locale={locale} result={result} />
    </form>
  );
}

export function ContactDecisionForm({ locale, signalId, contactId }: { readonly locale: Locale; readonly signalId: string; readonly contactId: string }) {
  const c = discoveryCopy(locale).contact;
  const [result, action, pending] = useActionState(decideContactAction, INITIAL);
  return (
    <form action={action} className="ct-decision">
      <input type="hidden" name="signalId" value={signalId} /><input type="hidden" name="contactId" value={contactId} />
      <textarea name="note" rows={2} maxLength={2000} placeholder={c.confirmNote} aria-label={c.confirmNote} />
      <div className="ct-inline">
        <button className="button button-secondary" type="submit" name="decision" value="SELECTED_FOR_FOLLOW_UP" disabled={pending}>{c.select}</button>
        <button className="button button-primary" type="submit" name="decision" value="CONFIRMED" disabled={pending}>{c.confirm}</button>
        <button className="button button-ghost" type="submit" name="decision" value="REJECTED" disabled={pending}>{c.reject}</button>
      </div>
      <Result locale={locale} result={result} />
    </form>
  );
}
