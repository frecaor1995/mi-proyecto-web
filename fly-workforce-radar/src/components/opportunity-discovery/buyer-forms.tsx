"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "../../i18n/locale";
import { addStrategicCompanyAction, recordInteractionAction, startBuyerInvestigationAction, updateBuyerSettingsAction, type BuyerActionState } from "../../server/contact-intelligence/buyer-actions";
import { decideContactAction, type ContactActionState } from "../../server/contact-intelligence/actions";
import { discoveryCopy } from "./discovery-copy";

export interface BuyerSubjectRef { readonly signalId?: string; readonly companyId?: string }

const INITIAL: BuyerActionState = { state: "IDLE", detail: null };
const ORG_TYPES = ["ELECTRICAL_CONSTRUCTION", "STAFFING_AGENCY", "INDUSTRIAL_CONTRACTOR", "PUBLIC_PROCUREMENT", "GENERAL"] as const;

function SubjectInputs({ subject }: { readonly subject: BuyerSubjectRef }) {
  return <>{subject.signalId ? <input type="hidden" name="signalId" value={subject.signalId} /> : null}{subject.companyId ? <input type="hidden" name="companyId" value={subject.companyId} /> : null}</>;
}

function Result({ locale, result }: { readonly locale: Locale; readonly result: BuyerActionState }) {
  const b = discoveryCopy(locale).buyer;
  if (result.state === "IDLE") return null;
  const extra = result.state === "FAILED" && result.detail ? ` ${result.detail}` : result.state === "DONE" && result.detail && b.canonicalResult[result.detail] ? ` ${b.canonicalResult[result.detail]}` : "";
  return <p role="status" className={result.state === "DONE" || result.state === "EXISTS" ? "dr-run-ok" : "dr-run-warn"}>{b.result[result.state]}{extra}</p>;
}

export function StartBuyerForm({ locale, subject, started, askWebsite }: { readonly locale: Locale; readonly subject: BuyerSubjectRef; readonly started: boolean; readonly askWebsite: boolean }) {
  const b = discoveryCopy(locale).buyer;
  const [result, action, pending] = useActionState(startBuyerInvestigationAction, INITIAL);
  return (
    <form action={action} className="dr-run by-start">
      <SubjectInputs subject={subject} />
      {askWebsite ? <label className="by-field"><span>{b.website}</span><input name="website" type="text" inputMode="url" maxLength={200} placeholder="example.com" aria-describedby="by-website-hint" /><small id="by-website-hint">{b.websiteHint}</small></label> : null}
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? b.running : started ? b.refresh : b.start}</button>
      <Result locale={locale} result={result} />
    </form>
  );
}

export function BuyerSettingsForm({ locale, subject, organizationType, typeSource, functions, website }: {
  readonly locale: Locale; readonly subject: BuyerSubjectRef; readonly organizationType: string; readonly typeSource: "OPERATOR" | "INFERRED";
  readonly functions: readonly { readonly id: string; readonly label: string; readonly selected: boolean }[]; readonly website: string | null;
}) {
  const b = discoveryCopy(locale).buyer;
  const [result, action, pending] = useActionState(updateBuyerSettingsAction, INITIAL);
  return (
    <form action={action} className="by-settings">
      <SubjectInputs subject={subject} />
      <label className="by-field"><span>{b.orgTypeLabel}</span>
        <select name="organizationType" defaultValue={typeSource === "OPERATOR" ? organizationType : ""}>
          <option value="">{b.auto} ({b.types[organizationType]})</option>
          {ORG_TYPES.map((type) => <option key={type} value={type}>{b.types[type]}</option>)}
        </select>
      </label>
      <fieldset className="by-functions"><legend>{b.functionsLabel}</legend>
        {functions.map((fn) => <label key={fn.id}><input type="checkbox" name="functions" value={fn.id} defaultChecked={fn.selected} /> {fn.label}</label>)}
      </fieldset>
      <label className="by-field"><span>{b.website}</span><input name="website" type="text" maxLength={200} defaultValue={website ?? ""} placeholder="example.com" /><small>{b.websiteHint}</small></label>
      <button className="button button-secondary" type="submit" disabled={pending}>{b.saveSettings}</button>
      <Result locale={locale} result={result} />
    </form>
  );
}

export function InteractionForm({ locale, subject, contactId, today }: { readonly locale: Locale; readonly subject: BuyerSubjectRef; readonly contactId: string; readonly today: string }) {
  const b = discoveryCopy(locale).buyer;
  const [result, action, pending] = useActionState(recordInteractionAction, INITIAL);
  return (
    <form action={action} className="by-interaction">
      <SubjectInputs subject={subject} /><input type="hidden" name="contactId" value={contactId} />
      <div className="by-row">
        <label className="by-field"><span>{b.reached}</span><select name="reached" defaultValue="NO"><option value="YES">{b.yes}</option><option value="NO">{b.no}</option></select></label>
        <label className="by-field"><span>{b.date}</span><input type="date" name="contactDate" defaultValue={today} max={today} required /></label>
        <label className="by-field"><span>{b.channel}</span><select name="channel" defaultValue="PHONE">{Object.entries(b.channelLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="by-field"><span>{b.handles}</span><select name="handles" defaultValue="UNKNOWN">{Object.entries(b.handlesLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="by-row">
        <label className="by-field"><span>{b.referredTo}</span><input name="referredTo" maxLength={300} /></label>
        <label className="by-field"><span>{b.correctContact}</span><input name="department" maxLength={300} /></label>
      </div>
      <label className="by-field"><span>{b.notes}</span><textarea name="notes" rows={2} maxLength={4000} /></label>
      <label className="by-field"><span>{b.nextActionField}</span><input name="nextAction" maxLength={1000} /></label>
      <button className="button button-primary" type="submit" disabled={pending}>{b.saveInteraction}</button>
      <Result locale={locale} result={result} />
    </form>
  );
}

const REJECT_INITIAL: ContactActionState = { state: "IDLE", detail: null };

export function RejectPersonForm({ locale, subject, contactId }: { readonly locale: Locale; readonly subject: BuyerSubjectRef; readonly contactId: string }) {
  const c = discoveryCopy(locale).contact;
  const [result, action, pending] = useActionState(decideContactAction, REJECT_INITIAL);
  return (
    <form action={action} className="ct-inline">
      <SubjectInputs subject={subject} /><input type="hidden" name="contactId" value={contactId} /><input type="hidden" name="decision" value="REJECTED" />
      <button className="button button-ghost" type="submit" disabled={pending}>{c.reject}</button>
      {result.state !== "IDLE" ? <p role="status" className={result.state === "DONE" ? "dr-run-ok" : "dr-run-warn"}>{c.result[result.state]}</p> : null}
    </form>
  );
}

export function StrategicCompanyForm({ locale }: { readonly locale: Locale }) {
  const b = discoveryCopy(locale).buyer;
  const router = useRouter();
  const [result, action, pending] = useActionState(addStrategicCompanyAction, INITIAL);
  useEffect(() => { if ((result.state === "DONE" || result.state === "EXISTS") && result.href) router.push(result.href); }, [result, router]);
  return (
    <form action={action} className="by-strategic">
      <div className="by-row">
        <label className="by-field"><span>{b.strategic.name}</span><input name="name" required maxLength={160} /></label>
        <label className="by-field"><span>{b.website}</span><input name="website" maxLength={200} placeholder="example.com" /></label>
        <label className="by-field"><span>{b.strategic.location}</span><input name="location" maxLength={120} /></label>
        <label className="by-field"><span>{b.orgTypeLabel}</span>
          <select name="organizationType" defaultValue=""><option value="">{b.auto}</option>{ORG_TYPES.map((type) => <option key={type} value={type}>{b.types[type]}</option>)}</select>
        </label>
      </div>
      <button className="button button-primary" type="submit" disabled={pending}>{b.strategic.submit}</button>
      <Result locale={locale} result={result} />
      {result.href ? <Link href={result.href}>{b.strategic.open}</Link> : null}
    </form>
  );
}
