"use client";

import { useActionState } from "react";
import type { Locale } from "../../i18n/locale";
import { linkOpportunityToCompanyAction, type LinkState } from "../../server/opportunity-company-link/opportunity-company-link-actions";
import { opportunityCompanyLinkCopy } from "./opportunity-company-link-copy";
import styles from "../contact-intelligence/contact-desk.module.css";

const IDLE: LinkState = { status: "IDLE", errors: {} };

function Status({ locale, state }: { readonly locale: Locale; readonly state: LinkState }) {
  const t = opportunityCompanyLinkCopy(locale);
  if (state.status === "SAVED") return <p role="status">{t.saved}</p>;
  if (state.status === "INVALID") return <p role="alert">{t.check} {Object.entries(state.errors).map(([k, v]) => `${t.fields[k] ?? t.fields.opportunityId}: ${t.errors[v] ?? t.errors.required}`).join(" · ")}</p>;
  if (state.status === "RESTRICTED") return <p role="alert">{t.restricted}</p>;
  if (state.status === "UNAVAILABLE") return <p role="alert">{t.unavailable}</p>;
  if (state.status === "FAILED") return <p role="alert">{t.failed}</p>;
  return null;
}

/** Explicit, human-confirmed link; the aggregator acknowledgment is required when the evidence comes from a job board. */
export function OpportunityCompanyLinkForm({ locale, companyId, opportunityId, aggregatorSource }: {
  readonly locale: Locale; readonly companyId: string; readonly opportunityId: string; readonly aggregatorSource: boolean;
}) {
  const t = opportunityCompanyLinkCopy(locale);
  const [state, action, pending] = useActionState(linkOpportunityToCompanyAction, IDLE);
  if (state.status === "SAVED") return <Status locale={locale} state={state} />;
  return (
    <details className={styles.box} open={state.status !== "IDLE" || undefined}><summary>{t.open}</summary>
      <form action={action} className={styles.form} aria-label={t.open}>
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <label className={styles.wide}><span>{t.linkReason}</span><textarea name="reason" required minLength={20} maxLength={1000} rows={3} /></label>
        <label className={styles.wide}><span>{t.evidenceNote}</span><input name="evidenceNote" maxLength={1000} /></label>
        {aggregatorSource ? <label className={styles.check}><input type="checkbox" name="aggregatorAcknowledged" required /> <span>{t.ackAggregator}</span></label> : null}
        <label className={styles.check}><input type="checkbox" name="humanConfirmed" required /> <span>{t.confirm}</span></label>
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? t.saving : t.save}</button>
        <Status locale={locale} state={state} />
      </form>
    </details>
  );
}
