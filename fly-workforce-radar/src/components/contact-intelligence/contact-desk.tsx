import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { authorizeOperator } from "../../server/auth/authorization";
import { getProductionSqlClient } from "../../server/database/production-sql-client";
import { loadCompanyContactDesk, loadCompanyNextActions, type CompanyNextActionView } from "../../server/contact-intelligence/company-contact-desk";
import { contactDeskCopy } from "./contact-desk-copy";
import { CompanyCallForm, CorporateChannelForm, NextActionForm, ResolveActionForm } from "./contact-desk-forms";
import styles from "./contact-desk.module.css";

async function currentOperatorId() {
  const auth = await authorizeOperator("company_discovery.run").catch(() => null);
  return auth && auth.state === "AUTHORIZED" ? auth.operator.operatorId : null;
}

function ActionItem({ locale, item, today, canWrite }: { readonly locale: Locale; readonly item: CompanyNextActionView; readonly today: string; readonly canWrite: boolean }) {
  const t = contactDeskCopy(locale);
  const overdue = item.status === "OPEN" && item.dueDate < today;
  return (
    <li className={item.isDemo ? styles.demoItem : undefined}>
      <div><b>{item.action}</b>{item.isDemo ? <span className={styles.demo}> {t.demoTag}</span> : null}</div>
      <small>{t.status[item.status]} · {t.due} {item.dueDate}{overdue ? ` · ${t.overdue}` : ""} · {t.by} {item.owner ?? "—"}{item.resolutionNote ? ` · ${item.resolutionNote}` : ""}</small>
      {canWrite && item.status === "OPEN" ? <ResolveActionForm locale={locale} companyId={item.companyId} actionId={item.id} /> : null}
    </li>
  );
}

/** Company Detail: corporate channels, company-level calls and next actions (Contact Intelligence). */
export async function CompanyContactDesk({ locale, companyId, today, canWrite }: { readonly locale: Locale; readonly companyId: string; readonly today: string; readonly canWrite: boolean }) {
  const t = contactDeskCopy(locale);
  const client = getProductionSqlClient();
  if (!client) return null;
  const [desk, operatorId] = await Promise.all([loadCompanyContactDesk(client, companyId), currentOperatorId()]);
  const channelOptions = desk.channels.map((c) => ({ id: c.id, label: `${t.routeTypes[c.routeType] ?? c.routeType} · ${c.target}${c.locationLabel ? ` · ${c.locationLabel}` : ""}` }));
  return (
    <section className={styles.desk} id="contact-desk" aria-labelledby="contact-desk-title">
      <h3 id="contact-desk-title">{t.title}</h3>
      <p className={styles.muted}>{t.lede}</p>

      <h4>{t.channels}</h4>
      {desk.channels.length ? <ul className={styles.list}>{desk.channels.map((c) => <li key={c.id}>
        <div><b>{c.target}</b> · {t.routeTypes[c.routeType] ?? c.routeType}{c.locationLabel ? ` · ${c.locationLabel}` : ""}</div>
        <small>{c.sourceUrl ? <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener">{c.sourceUrl}</a> : "—"} · {c.observedOn ?? "—"}</small>
        <small className={styles.muted}>{t.channelBasis}</small>
      </li>)}</ul> : <p className={styles.muted}>{t.noChannels}</p>}
      {canWrite ? <CorporateChannelForm locale={locale} companyId={companyId} /> : null}

      <h4>{t.calls}</h4>
      {desk.calls.length ? <ul className={styles.list}>{desk.calls.map((c) => <li key={c.id} className={c.isDemo ? styles.demoItem : undefined}>
        <div><b>{c.contactDate}</b> · {t.outcomes[c.callOutcome] ?? c.callOutcome} · {t.supplier.replace(" *", "")}: <b>{t.answers[c.supplierAnswer] ?? c.supplierAnswer}</b>{c.isDemo ? <span className={styles.demo}> {t.demoTag}</span> : null}</div>
        <small>{c.channel ?? "—"}{c.counterpartName || c.counterpartRole ? ` · ${[c.counterpartName, c.counterpartRole].filter(Boolean).join(" · ")}` : ""} · {c.recordedBy ?? "—"}</small>
        {c.notes ? <p>{c.notes}</p> : null}
      </li>)}</ul> : <p className={styles.muted}>{t.noCalls}</p>}
      {canWrite ? <CompanyCallForm locale={locale} companyId={companyId} channels={channelOptions} operators={desk.operators} currentOperatorId={operatorId} /> : null}

      <h4>{t.actions}</h4>
      {desk.actions.length ? <ul className={styles.list}>{desk.actions.map((a) => <ActionItem key={a.id} locale={locale} item={a} today={today} canWrite={canWrite} />)}</ul> : <p className={styles.muted}>{t.noActions}</p>}
      {canWrite ? <NextActionForm locale={locale} companyId={companyId} operators={desk.operators} currentOperatorId={operatorId} /> : null}
    </section>
  );
}

/** Existing pending view (/opportunities/pursuits): company next actions due today or overdue, DEMO apart. */
export async function CompanyPendingActions({ locale, today }: { readonly locale: Locale; readonly today: string }) {
  const t = contactDeskCopy(locale);
  const client = getProductionSqlClient();
  if (!client) return null;
  const items = await loadCompanyNextActions(client, { pendingOn: today });
  const real = items.filter((i) => !i.isDemo), demo = items.filter((i) => i.isDemo);
  const group = (list: readonly CompanyNextActionView[]) => list.length ? <ul className={styles.list}>{list.map((a) => <li key={a.id} className={a.isDemo ? styles.demoItem : undefined}>
    <div><b>{a.companyName}</b> — {a.action}{a.isDemo ? <span className={styles.demo}> {t.demoTag}</span> : null}</div>
    <small>{t.due} {a.dueDate}{a.dueDate < today ? ` · ${t.overdue}` : ""} · {t.by} {a.owner ?? "—"} · <Link href={`/companies/${a.companyId}#contact-desk`}>{t.openCompany}</Link></small>
  </li>)}</ul> : <p className={styles.muted}>{t.noPending}</p>;
  return (
    <section className={styles.pending} id="company-actions" aria-labelledby="company-actions-title">
      <h2 id="company-actions-title">{t.pendingTitle}</h2>
      <p className={styles.muted}>{t.pendingLede}</p>
      <h3>{t.pendingReal} · {real.length}</h3>{group(real)}
      <h3>{t.pendingDemo} · {demo.length}</h3>{group(demo)}
    </section>
  );
}
