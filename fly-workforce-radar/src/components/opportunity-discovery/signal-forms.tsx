"use client";
import { useActionState, useState } from "react";
import type { Locale } from "../../i18n/locale";
import { promoteSignalAction, reviewSignalAction, type SignalActionState } from "../../server/opportunity-discovery/actions";
import type { WorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import { discoveryCopy } from "./discovery-copy";

const IDLE: SignalActionState = { status: "IDLE", error: null, fieldErrors: {} };

export function SignalReviewForm({ locale, candidateId }: { readonly locale: Locale; readonly candidateId: string }) {
  const c = discoveryCopy(locale);
  const [state, action, pending] = useActionState(reviewSignalAction, IDLE);
  return (
    <form action={action} className="sig-review-form">
      <input type="hidden" name="candidateId" value={candidateId} />
      <fieldset>
        <legend className="sr-only">{c.reviewTitle}</legend>
        {(["VERIFIED", "NEEDS_REVIEW", "REJECTED"] as const).map((decision) => (
          <label key={decision} className={`sig-decision sig-decision-${decision.toLowerCase()}`}>
            <input type="radio" name="decision" value={decision} required defaultChecked={decision === "VERIFIED"} />
            <span>{c.decision[decision]}</span>
          </label>
        ))}
      </fieldset>
      <textarea name="note" rows={3} maxLength={2000} placeholder={c.notePlaceholder} aria-invalid={Boolean(state.fieldErrors.note)} />
      {state.error ? <p role="alert" className="sig-form-error">{c.errors[state.error]}</p> : null}
      {state.status === "SAVED" ? <p role="status" className="sig-form-ok">{c.saved}</p> : null}
      <button type="submit" className="button button-primary" disabled={pending}>{c.saveDecision}</button>
    </form>
  );
}

function RequirementPicker({ locale, name, options, label }: { readonly locale: Locale; readonly name: string; readonly options: readonly { code: string; labelEn: string; labelEs?: string }[]; readonly label: string }) {
  const c = discoveryCopy(locale);
  return (
    <label>
      <span>{label}</span>
      <select name={name} defaultValue="">
        <option value="">{c.field.none}</option>
        {options.flatMap((item) => {
          const text = locale === "es-US" ? item.labelEs ?? item.labelEn : item.labelEn;
          return [
            <option key={`${item.code}-R`} value={`${item.code}|REQUIRED`}>{text} — {c.field.required}</option>,
            <option key={`${item.code}-P`} value={`${item.code}|PREFERRED`}>{text} — {c.field.preferred}</option>,
          ];
        })}
      </select>
    </label>
  );
}

export function SignalPromoteForm({ locale, candidateId, title, taxonomy, searchArea, searchTrade }: {
  readonly locale: Locale; readonly candidateId: string; readonly title: string; readonly taxonomy: WorkforceTaxonomy;
  readonly searchArea: string | null; readonly searchTrade: string | null;
}) {
  const c = discoveryCopy(locale);
  const [state, action, pending] = useActionState(promoteSignalAction, IDLE);
  const [trade, setTrade] = useState("");
  const label = (item: { labelEn: string; labelEs?: string }) => (locale === "es-US" ? item.labelEs ?? item.labelEn : item.labelEn);
  const err = (field: string) => (state.fieldErrors[field] ? <em className="sig-field-error">{c.errors.invalid}</em> : null);
  return (
    <form action={action} className="sig-promote-form">
      <input type="hidden" name="candidateId" value={candidateId} />
      {(searchArea || searchTrade) ? (
        <p className="sig-hints">
          {searchArea ? <span>{c.hint.searchArea}: <b>{searchArea}</b></span> : null}
          {searchTrade ? <span>{c.hint.searchTrade}: <b>{searchTrade}</b></span> : null}
        </p>
      ) : null}
      <div className="sig-form-grid">
        <label className="sig-span-2"><span>{c.field.opportunityTitle}</span><input name="opportunityTitle" required defaultValue={title} maxLength={300} />{err("opportunityTitle")}</label>
        <label><span>{c.field.customerName}</span><input name="customerName" required maxLength={200} />{err("customerName")}</label>
        <label><span>{c.field.projectName}</span><input name="projectName" maxLength={200} /></label>
        <label><span>{c.field.city}</span><input name="city" maxLength={120} /></label>
        <label><span>{c.field.state}</span><input name="state" maxLength={60} /></label>
        <label><span>{c.field.tradeCode}</span>
          <select name="tradeCode" required value={trade} onChange={(event) => setTrade(event.target.value)}>
            <option value="">{c.field.select}</option>
            {taxonomy.trades.map((item) => <option key={item.code} value={item.code}>{label(item)}</option>)}
          </select>{err("tradeCode")}
        </label>
        <label><span>{c.field.occupationCode}</span>
          <select name="occupationCode" required defaultValue="" key={trade}>
            <option value="">{c.field.select}</option>
            {taxonomy.occupations.filter((item) => item.tradeCode === trade).map((item) => <option key={item.code} value={item.code}>{label(item)}</option>)}
          </select>{err("occupationCode")}
        </label>
        <label><span>{c.field.headcount}</span><input name="headcount" type="number" min={1} step={1} /><small>{c.field.headcountHint}</small>{err("headcount")}</label>
        <label><span>{c.field.minimumExperienceMonths}</span><input name="minimumExperienceMonths" type="number" min={0} step={1} />{err("minimumExperienceMonths")}</label>
        <label><span>{c.field.startDate}</span><input name="startDate" type="date" />{err("startDate")}</label>
        <label><span>{c.field.schedule}</span><input name="schedule" maxLength={200} /></label>
        <RequirementPicker locale={locale} name="skills" label={c.field.skills} options={taxonomy.skills} />
        <RequirementPicker locale={locale} name="credentials" label={c.field.credentials} options={taxonomy.credentials} />
        <label className="sig-span-2"><span>{c.field.needSummary}</span><textarea name="needSummary" rows={3} maxLength={1500} /></label>
      </div>
      {state.error ? <p role="alert" className="sig-form-error">{c.errors[state.error]}</p> : null}
      <button type="submit" className="button button-primary" disabled={pending}>{pending ? c.promoting : c.promote}</button>
    </form>
  );
}
