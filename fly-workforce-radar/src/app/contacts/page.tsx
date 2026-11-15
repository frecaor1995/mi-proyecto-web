import Link from "next/link";
import { resolveServerLocale } from "../../i18n/server-locale";
import { formatDate } from "../../i18n/format";
import { t } from "../../i18n/translate";
import { getProductionSqlClient } from "../../server/database/production-sql-client";
import { getSignal } from "../../server/opportunity-discovery/signals";
import { loadBuyerInvestigation, type BuyerInvestigationView } from "../../server/contact-intelligence/buyer-investigation";
import { discoveryCopy } from "../../components/opportunity-discovery/discovery-copy";
import { CorporateChannelCompanies } from "../../components/contact-intelligence/corporate-channel-companies";

/**
 * Contact Intelligence workspace: every buyer investigation — Radar signals (Entry A) and strategic companies
 * (Entry B). Named professionals are counted separately from general corporate channels, which are never people.
 * Every figure comes from the same loader as the detail views; nothing is inferred here.
 */
export default async function ContactsPage() {
  const locale = await resolveServerLocale();
  const copy = discoveryCopy(locale);
  const b = copy.buyer;
  const client = getProductionSqlClient();
  const investigations = client ? (await client.query<{ id: string; normalized_candidate_url: string | null; company_id: string | null; started_at: string | Date; signal_id: string | null; title: string | null }>(`
    select i.id, i.normalized_candidate_url, i.company_id, i.started_at, s.id as signal_id, s.title
      from contact_investigations i
      left join lateral (select id, title from company_discovery_candidates c where c.normalized_candidate_url = i.normalized_candidate_url order by created_at desc, id limit 1) s on true
     order by i.started_at desc limit 50`).catch(() => ({ rows: [] }))).rows : [];
  const rows: { key: string; kind: "SIGNAL" | "COMPANY"; href: string; label: string; startedAt: string | Date; view: BuyerInvestigationView }[] = [];
  for (const item of client ? investigations : []) {
    try {
      if (item.company_id && !item.normalized_candidate_url) {
        rows.push({ key: item.id, kind: "COMPANY", href: `/companies/${item.company_id}#contacts`, label: b.table.company, startedAt: item.started_at, view: await loadBuyerInvestigation(client!, { kind: "COMPANY", companyId: item.company_id }) });
      } else if (item.signal_id && item.normalized_candidate_url) {
        const signal = await getSignal(client!, item.signal_id);
        if (signal.state !== "READY") continue;
        rows.push({ key: item.id, kind: "SIGNAL", href: `/radar/${item.signal_id}#contacts`, label: item.title ?? b.table.signal, startedAt: item.started_at,
          view: await loadBuyerInvestigation(client!, { kind: "SIGNAL", signal: signal.signal, normalizedUrl: item.normalized_candidate_url }) });
      }
    } catch { /* one unreadable investigation never hides the others */ }
  }
  return (
    <div className="page-stack">
      <header className="app-page-header">
        <p className="po-eyebrow">{t(locale, "nav.contacts")}</p>
        <h1>{b.title}</h1>
        <p>{b.lede}</p>
        <p><Link href="/companies#by-strategic-title">{b.strategic.title}</Link> · <Link href="/radar">{b.table.signal}</Link></p>
      </header>
      {!client ? <p className="po-empty">{copy.unavailable}</p> : rows.length === 0 ? <p className="po-empty">{b.notStarted}</p> : (
        <div className="dr-table-wrap">
          <table className="dr-table">
            <thead><tr>
              <th scope="col">{b.organization}</th><th scope="col">{b.table.entry}</th><th scope="col">{b.table.path}</th><th scope="col">{b.table.named}</th>
              <th scope="col">{b.table.contactable}</th><th scope="col">{b.table.confirmed}</th><th scope="col">{b.table.channels}</th><th scope="col">{b.lastRun}</th>
            </tr></thead>
            <tbody>{rows.map(({ key, kind, href, label, startedAt, view }) => {
              const named = view.people;
              const route = view.route;
              return (
                <tr key={key}>
                  <th scope="row"><Link href={href}>{view.organization.name}</Link><br /><small>{b.types[view.organization.type]}</small></th>
                  <td>{kind === "COMPANY" ? b.table.company : <>{b.table.signal}<br /><small>{label}</small></>}</td>
                  <td>{route.person ? <>{route.person.name}<br /><small>{b.states[route.person.state]}</small></> : <><span className="by-none">{b.noBuyer}</span>{route.departmentEvidence ? <><br /><small>{b.route.departments[route.department]}</small></> : null}</>}<br /><small>{b.route.phoneClass[route.phoneClass]}</small></td>
                  <td>{named.length}</td>
                  <td>{named.filter((person) => person.facts.contactable).length}</td>
                  <td>{named.filter((person) => person.facts.responsibilityConfirmed).length}</td>
                  <td>{view.channels.length}</td>
                  <td>{formatDate(locale, new Date(view.investigation?.lastRunAt ?? startedAt), { dateStyle: "medium", timeStyle: "short" })}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {client ? <CorporateChannelCompanies locale={locale} /> : null}
    </div>
  );
}
