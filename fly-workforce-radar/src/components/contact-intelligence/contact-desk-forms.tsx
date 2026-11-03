"use client";

import { useActionState, useState } from "react";
import type { Locale } from "../../i18n/locale";
import { CALL_OUTCOMES, CALL_SUPPLIER_ANSWERS, CORPORATE_CHANNEL_TYPES } from "../../domain/company-contact-desk";
import {
  createCompanyNextActionAction, recordCompanyCallAction, recordCorporateChannelAction, resolveCompanyNextActionAction, type DeskState,
} from "../../server/contact-intelligence/company-contact-desk-actions";
import { contactDeskCopy } from "./contact-desk-copy";
import styles from "./contact-desk.module.css";

const IDLE: DeskState = { status: "IDLE", errors: {} };
const todayLocal = () => new Date().toISOString().slice(0, 10);

function Status({ locale, state }: { readonly locale: Locale; readonly state: DeskState }) {
  const t = contactDeskCopy(locale);
  if (state.status === "SAVED") return <p role="status">{t.saved}</p>;
  if (state.status === "DUPLICATE") return <p role="status">{t.duplicate}</p>;
  if (state.status === "INVALID") return <p role="alert">{t.check} {Object.entries(state.errors).map(([k, v]) => `${t.fields[k] ?? t.fields.value}: ${t.errors[v] ?? t.errors.invalid}`).join(" · ")}</p>;
  if (state.status === "RESTRICTED") return <p role="alert">{t.restricted}</p>;
  if (state.status === "UNAVAILABLE") return <p role="alert">{t.unavailable}</p>;
  if (state.status === "FAILED") return <p role="alert">{t.failed}</p>;
  return null;
}

export function CorporateChannelForm({ locale, companyId }: { readonly locale: Locale; readonly companyId: string }) {
  const t = contactDeskCopy(locale);
  const [state, action, pending] = useActionState(recordCorporateChannelAction, IDLE);
  return (
    <details className={styles.box} open={state.status !== "IDLE" || undefined}><summary>{t.addChannel}</summary>
      <form action={action} className={styles.form} aria-label={t.addChannel}>
        <input type="hidden" name="companyId" value={companyId} />
        <label><span>{t.routeType}</span><select name="routeType" required defaultValue="OFFICE_PHONE">{CORPORATE_CHANNEL_TYPES.map((r) => <option key={r} value={r}>{t.routeTypes[r]}</option>)}</select></label>
        <label><span>{t.value}</span><input name="value" required maxLength={200} /></label>
        <label><span>{t.sourceUrl}</span><input name="sourceUrl" type="url" pattern="https://.*" required maxLength={2000} /></label>
        <label><span>{t.observedOn}</span><input name="observedOn" type="date" required max={todayLocal()} defaultValue={todayLocal()} /></label>
        <label><span>{t.locationLabel}</span><input name="locationLabel" maxLength={200} /></label>
        <label><span>{t.sourceNote}</span><input name="sourceNote" maxLength={500} /></label>
        <p className={styles.muted}>{t.channelBasis}</p>
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? t.saving : t.saveChannel}</button>
        <Status locale={locale} state={state} />
      </form>
    </details>
  );
}

export function CompanyCallForm({ locale, companyId, channels, operators, currentOperatorId }: {
  readonly locale: Locale; readonly companyId: string; readonly channels: readonly { readonly id: string; readonly label: string }[];
  readonly operators: readonly { readonly id: string; readonly name: string }[]; readonly currentOperatorId: string | null;
}) {
  const t = contactDeskCopy(locale);
  const [state, action, pending] = useActionState(recordCompanyCallAction, IDLE);
  const [nextAction, setNextAction] = useState("");
  return (
    <details className={styles.box} open={state.status !== "IDLE" || undefined}><summary>{t.recordCall}</summary>
      <form action={action} className={styles.form} aria-label={t.recordCall}>
        <input type="hidden" name="companyId" value={companyId} />
        <label className={styles.check}><input type="checkbox" name="isDemo" /> {t.isDemo}</label>
        <label><span>{t.callDate}</span><input name="contactDate" type="date" required max={todayLocal()} defaultValue={todayLocal()} /></label>
        <label><span>{t.channelUsed}</span><select name="contactRouteId" defaultValue={channels[0]?.id ?? ""}><option value="">{t.noChannel}</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label><span>{t.outcome}</span><select name="callOutcome" required defaultValue="">{[<option key="" value="" disabled>—</option>, ...CALL_OUTCOMES.map((o) => <option key={o} value={o}>{t.outcomes[o]}</option>)]}</select></label>
        <label><span>{t.supplier}</span><select name="supplierAnswer" required defaultValue="NOT_ASKED">{CALL_SUPPLIER_ANSWERS.map((a) => <option key={a} value={a}>{t.answers[a]}</option>)}</select></label>
        <label><span>{t.counterpartName}</span><input name="counterpartName" maxLength={200} /></label>
        <label><span>{t.counterpartRole}</span><input name="counterpartRole" maxLength={200} /></label>
        <label className={styles.wide}><span>{t.notes}</span><textarea name="notes" rows={3} maxLength={4000} /></label>
        <label className={styles.wide}><span>{t.nextAction}</span><input name="nextAction" maxLength={1000} value={nextAction} onChange={(e) => setNextAction(e.target.value)} /></label>
        {nextAction.trim() ? <>
          <label><span>{t.nextActionDue}</span><input name="nextActionDue" type="date" required defaultValue={todayLocal()} /></label>
          <label><span>{t.owner}</span><select name="nextActionOwner" required defaultValue={currentOperatorId ?? ""}>{operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        </> : null}
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? t.saving : t.saveCall}</button>
        <Status locale={locale} state={state} />
      </form>
    </details>
  );
}

export function NextActionForm({ locale, companyId, operators, currentOperatorId }: {
  readonly locale: Locale; readonly companyId: string; readonly operators: readonly { readonly id: string; readonly name: string }[]; readonly currentOperatorId: string | null;
}) {
  const t = contactDeskCopy(locale);
  const [state, action, pending] = useActionState(createCompanyNextActionAction, IDLE);
  return (
    <details className={styles.box} open={state.status !== "IDLE" || undefined}><summary>{t.addAction}</summary>
      <form action={action} className={styles.form} aria-label={t.addAction}>
        <input type="hidden" name="companyId" value={companyId} />
        <label className={styles.check}><input type="checkbox" name="isDemo" /> {t.isDemo}</label>
        <label className={styles.wide}><span>{t.action}</span><input name="action" required maxLength={1000} /></label>
        <label><span>{t.dueDate}</span><input name="dueDate" type="date" required defaultValue={todayLocal()} /></label>
        <label><span>{t.owner}</span><select name="ownerOperatorId" required defaultValue={currentOperatorId ?? ""}>{operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? t.saving : t.saveAction}</button>
        <Status locale={locale} state={state} />
      </form>
    </details>
  );
}

export function ResolveActionForm({ locale, companyId, actionId }: { readonly locale: Locale; readonly companyId: string; readonly actionId: string }) {
  const t = contactDeskCopy(locale);
  const [state, action, pending] = useActionState(resolveCompanyNextActionAction, IDLE);
  return (
    <form action={action} className={styles.inline}>
      <input type="hidden" name="companyId" value={companyId} /><input type="hidden" name="actionId" value={actionId} />
      <input name="note" maxLength={1000} placeholder={t.resolutionNote} aria-label={t.resolutionNote} />
      <button className="button button-secondary" type="submit" name="status" value="DONE" disabled={pending}>{t.markDone}</button>
      <button className="button button-secondary" type="submit" name="status" value="CANCELLED" disabled={pending}>{t.cancel}</button>
      <Status locale={locale} state={state} />
    </form>
  );
}
