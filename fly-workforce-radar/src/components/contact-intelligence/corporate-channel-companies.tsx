import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { getProductionSqlClient } from "../../server/database/production-sql-client";
import { loadCorporateChannelCompanies } from "../../server/contact-intelligence/company-contact-desk";
import { contactDeskCopy } from "./contact-desk-copy";
import styles from "./contact-desk.module.css";

/** /contacts: companies with hand-recorded corporate channels, shown even when no automatic investigation exists. */
export async function CorporateChannelCompanies({ locale }: { readonly locale: Locale }) {
  const t = contactDeskCopy(locale);
  const client = getProductionSqlClient();
  if (!client) return null;
  const companies = await loadCorporateChannelCompanies(client).catch(() => null);
  if (!companies) return null;
  return (
    <section className={styles.pending} id="corporate-channel-companies" aria-labelledby="corporate-channel-companies-title">
      <h2 id="corporate-channel-companies-title">{t.channelCompaniesTitle} · {companies.length}</h2>
      <p className={styles.muted}>{t.channelCompaniesLede}</p>
      {companies.length ? (
        <div className="dr-table-wrap">
          <table className="dr-table">
            <thead><tr><th scope="col">{t.columns.company}</th><th scope="col">{t.columns.channels}</th><th scope="col">{t.columns.lastCall}</th><th scope="col">{t.columns.openActions}</th></tr></thead>
            <tbody>{companies.map((c) => (
              <tr key={c.companyId}>
                <th scope="row"><Link href={`/companies/${c.companyId}#contact-desk`}>{c.companyName}</Link>{c.isDemo ? <span className={styles.demo}> {t.demoTag}</span> : null}<br /><small><Link href={`/companies/${c.companyId}#contact-desk`}>{t.openDesk}</Link></small></th>
                <td>{c.channels}</td>
                <td>{c.lastCall ?? t.noCall}</td>
                <td>{c.openActions}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className={styles.muted}>{t.channelCompaniesEmpty}</p>}
    </section>
  );
}
