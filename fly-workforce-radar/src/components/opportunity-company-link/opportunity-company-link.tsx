import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { getProductionSqlClient } from "../../server/database/production-sql-client";
import { loadOpportunityCompanyLinks } from "../../server/opportunity-company-link/opportunity-company-link";
import { opportunityCompanyLinkCopy } from "./opportunity-company-link-copy";
import { OpportunityCompanyLinkForm } from "./opportunity-company-link-form";
import styles from "../contact-intelligence/contact-desk.module.css";

/** Company Detail: opportunities linked to the company and the human link action for unlinked ones (no auto-link). */
export async function CompanyOpportunityLinks({ locale, companyId, canWrite }: { readonly locale: Locale; readonly companyId: string; readonly canWrite: boolean }) {
  const t = opportunityCompanyLinkCopy(locale);
  const client = getProductionSqlClient();
  if (!client) return null;
  const view = await loadOpportunityCompanyLinks(client, companyId).catch(() => null);
  if (!view) return null;
  return (
    <section className={styles.desk} id="opportunity-links" aria-labelledby="opportunity-links-title">
      <h3 id="opportunity-links-title">{t.title}</h3>
      <p className={styles.muted}>{t.lede}</p>

      <h4>{t.linked} · {view.linked.length}</h4>
      {view.linked.length ? <ul className={styles.list}>{view.linked.map((l) => <li key={l.opportunityId}>
        <div><Link href={`/opportunities/${l.opportunityId}`}><b>{l.title ?? l.opportunityId}</b></Link></div>
        <small>{t.linkedOn} {l.linkedOn} · {t.reason}: {l.linkReason}</small>
        {l.aggregatorSource ? <small className={styles.muted}>{t.aggregatorLinked}</small> : null}
      </li>)}</ul> : <p className={styles.muted}>{t.noLinked}</p>}

      <h4>{t.candidates} · {view.candidates.length}</h4>
      {view.candidates.length ? <ul className={styles.list}>{view.candidates.map((o) => <li key={o.opportunityId} className={o.isDemo ? styles.demoItem : undefined}>
        <div><Link href={`/opportunities/${o.opportunityId}`}><b>{o.title ?? o.opportunityId}</b></Link>{o.isDemo ? <span className={styles.demo}> {t.demoTag}</span> : null}
          {o.suggested ? <span className={styles.demo}> · {t.suggested}</span> : null}</div>
        {o.suggested ? <small className={styles.muted}>{t.suggestedNote}</small> : null}
        <small>{t.companyText}: {o.companyContext ?? "—"}{o.demandTitles.length ? ` · ${t.demand}: ${o.demandTitles.join(" / ")}` : ""}</small>
        <small>{t.sources}: {o.sources.length ? o.sources.map((s, i) => <span key={s.url}>{i ? " · " : ""}<a href={s.url} target="_blank" rel="noreferrer noopener">{s.host ?? s.url}</a></span>) : t.noSources}</small>
        {o.publishedPay ? <small>{t.pay}: {o.publishedPay} — {t.payNote}</small> : null}
        {o.aggregatorSource ? <p role="note"><b>⚠ </b>{t.aggregatorWarning}</p> : null}
        {canWrite ? <OpportunityCompanyLinkForm locale={locale} companyId={companyId} opportunityId={o.opportunityId} aggregatorSource={o.aggregatorSource} /> : null}
      </li>)}</ul> : <p className={styles.muted}>{t.noCandidates}</p>}
      {canWrite ? null : <p className={styles.muted}>{t.readOnly}</p>}
    </section>
  );
}
