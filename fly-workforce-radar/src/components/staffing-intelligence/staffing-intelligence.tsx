import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { getProductionSqlClient } from "../../server/database/production-sql-client";
import { loadStaffingIntelligence, type StaffingCompany, type StaffingSnapshot } from "../../server/staffing-intelligence/get-staffing-intelligence";
import type { ProjectSignalView } from "../../server/staffing-intelligence/project-signals";
import { supplierCopy } from "../discovery-intelligence/intelligence-copy";
import { ProjectSignalImportForm, ProjectSignalLinkForm } from "./project-signal-forms";
import { staffingCopy } from "./staffing-copy";
import styles from "./staffing-intelligence.module.css";

type Fact = { readonly value: string | null; readonly kind: string };

/** One company: priority, demand class and the four blocks (confirmed / inferences / missing / next action). */
function CompanyCard({ locale, company }: { readonly locale: Locale; readonly company: StaffingCompany }) {
  const t = staffingCopy(locale), sc = supplierCopy(locale);
  const p = company.priority, d = company.demand;
  const requirementKeys = Object.keys(d.requirements) as (keyof typeof d.requirements)[];
  return (
    <article className={`${styles.card} ${styles[`tier${p.tier}`] ?? ""}`}>
      <div className={styles.cardTop}>
        <span className={styles.tier}>{t.tier[p.tier]}</span><span>{t.demand[d.demandClass]}</span><span>{t.confidence[company.confidence]}</span>
        {company.dataClass === "DEMO" ? <span className={styles.demo}>{t.demoTag}</span> : null}
      </div>
      <h3>{company.name}</h3>
      <p className={styles.muted}>{t.evidenceLine(company.evidence.postingsVerified, company.evidence.postingsTotal, company.evidence.projects.length, company.evidence.pains, company.evidence.explicitRequests.length)}</p>
      <div className={styles.blocks}>
        <div><b>{t.confirmed}</b><ul>{p.confirmed.length ? p.confirmed.map((f) => <li key={f}>{t.factor[f]}</li>) : <li>—</li>}</ul></div>
        <div><b>{t.inferences}</b><ul>{p.inferences.length ? p.inferences.map((f) => <li key={f}>{t.factor[f]}</li>) : <li>—</li>}</ul></div>
        <div><b>{t.missing}</b><ul>{p.missing.map((f) => <li key={f}>{t.factor[f]}</li>)}{p.negatives.map((n) => <li key={n} className={styles.negative}>{t.negative[n]}</li>)}</ul></div>
        <div className={styles.next}><b>{t.nextAction}</b>
          {company.humanNextAction ? <p><small>{t.humanNext}:</small> {company.humanNextAction.text}{company.humanNextAction.due ? ` · ${company.humanNextAction.due}` : ""}</p> : null}
          <p><small>{t.suggested}:</small> {t.action[p.nextAction]}</p></div>
      </div>
      {d.ruleNotes.length ? <p className={styles.rules}>{d.ruleNotes.map((r) => t.rule[r]).join(" ")}</p> : null}
      <details><summary>{t.requirementsTitle}</summary>
        <dl className={styles.requirements}>{requirementKeys.map((k) => <div key={k}><dt>{t.req[k]}</dt><dd>{d.requirements[k].value ?? t.unknown}<small> · {t.origin[d.requirements[k].origin]}</small></dd></div>)}</dl>
      </details>
      <dl className={styles.facts}>
        <div><dt>{t.acceptance}</dt><dd>{company.supplierAnswer ? sc.answers[company.supplierAnswer.answer] : t.acceptanceNone}{company.manpowerAcceptance ? ` · ${t.manpower}: ${company.manpowerAcceptance}` : ""}</dd></div>
        <div><dt>{t.contactsLabel}</dt><dd>{company.contacts.people || company.contacts.verifiedRoutes ? t.contacts(company.contacts.people, company.contacts.verifiedRoutes) : t.contactsNone}</dd></div>
        <div><dt>{t.lastConversation}</dt><dd>{company.lastConversation ? `${company.lastConversation.date}${company.lastConversation.summary ? ` · ${company.lastConversation.summary.slice(0, 120)}` : ""}` : t.noConversation}</dd></div>
        <div><dt>{t.result}</dt><dd>{company.commercialResult ?? t.noResult}</dd></div>
        {company.networkWorkers ? <div><dt>{t.factor.NETWORK_FIT}</dt><dd>{t.network(company.networkWorkers)}</dd></div> : null}
      </dl>
      <div className={styles.links}>
        {company.companyId ? <Link href={`/companies/${company.companyId}#commercial`}>{t.openCompany}</Link> : <span className={styles.muted}>{t.noCanonical}</span>}
        <Link href="/contacts">{t.openContacts}</Link><Link href="/opportunities/pursuits">{t.openPursuits}</Link>
        {company.evidence.postingsTotal ? <Link href="/radar/intelligence#individual-postings">{t.openPostings}</Link> : null}
        {company.catalogKey && !company.companyId ? <Link href="/radar/intelligence#priority-companies">{sc.record} →</Link> : null}
      </div>
    </article>
  );
}

function factText(t: ReturnType<typeof staffingCopy>, fact: Fact) { return fact.value ? `${fact.value} (${t.fact[fact.kind]})` : t.unknown; }

function ProjectList({ locale, projects, companies }: { readonly locale: Locale; readonly projects: readonly ProjectSignalView[]; readonly companies: readonly { readonly id: string; readonly name: string }[] }) {
  const t = staffingCopy(locale);
  if (!projects.length) return <p className={styles.muted}>{t.noProjects}</p>;
  return (
    <div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th>{t.col.record}</th><th>{t.col.company}</th><th>{t.col.project}</th><th>{t.col.facts}</th><th>{t.col.link}</th></tr></thead>
      <tbody>{projects.map((p) => {
        const r = p.record;
        const eligible = companies.filter((c) => /\bDEMO LOCAL\b/i.test(c.name) === (p.dataClass === "DEMO"));
        return <tr key={p.evidenceId}>
          <td><b>{p.sourceSystem}</b> · {p.sourceRecordId}<br /><small>{t.version(p.version, p.versions)} · {p.importedAt.slice(0, 10)}{p.importedBy ? ` · ${p.importedBy}` : ""}</small>{p.dataClass === "DEMO" ? <><br /><span className={styles.demo}>{t.demoTag}</span></> : null}
            {r.officialSourceUrl ? <><br /><a href={r.officialSourceUrl} target="_blank" rel="noreferrer noopener">↗ {new URL(r.officialSourceUrl).hostname}</a></> : null}</td>
          <td>{r.company.name}<br /><small>{r.company.role ?? "—"} · {r.company.stage}</small></td>
          <td>{factText(t, r.project.name)}<br /><small>{[r.project.city.value, r.project.state.value].filter(Boolean).join(", ") || t.unknown}{r.project.trades.value?.length ? ` · ${r.project.trades.value.join(", ")}` : ""}</small></td>
          <td><small>{factText(t, r.contractStatus)} · {factText(t, r.startDate)} · {factText(t, r.duration)}</small></td>
          <td>{p.link ? <><b>{t.linkedTo}</b> {p.link.companyName ?? p.link.companyId}<br /><small>{t.roles[p.link.role] ?? p.link.role} · {p.link.decidedAt.slice(0, 10)}{p.link.decidedBy ? ` · ${p.link.decidedBy}` : ""}</small></>
            : <><span>{t.pending}</span>{p.previousLink ? <><br /><small>{t.previousLink(p.previousLink.version, p.previousLink.companyName ?? "—")}</small></> : null}
              {p.suggestedCompany ? <><br /><small>{t.suggestedMatch}: {p.suggestedCompany.name}</small></> : null}
              <ProjectSignalLinkForm locale={locale} evidenceId={p.evidenceId} companies={eligible} suggestedCompanyId={p.suggestedCompany && eligible.some((c) => c.id === p.suggestedCompany!.id) ? p.suggestedCompany.id : null}
                defaultRole={r.company.role && r.company.role !== "SUBCONTRACTOR" && r.company.role !== "OTHER" ? r.company.role : null} canCreateProject={Boolean(r.officialSourceUrl && r.project.name.value)} /></>}</td>
        </tr>;
      })}</tbody>
    </table></div>
  );
}

function Metrics({ locale, metrics }: { readonly locale: Locale; readonly metrics: StaffingSnapshot["metrics"] }) {
  const t = staffingCopy(locale), r = metrics.real;
  return <>
    <p className={styles.metricsLabel}>{t.metricsReal}</p>
    <dl className={styles.metrics}>
      <div><dt>{t.m.companies}</dt><dd>{r.companies}</dd></div>
      <div><dt>{t.m.tiers}</dt><dd>{r.high} · {r.medium} · {r.low} · {r.insufficient}</dd></div>
      <div><dt>{t.m.explicit}</dt><dd>{r.explicit}</dd></div>
      <div><dt>{t.m.inferred}</dt><dd>{r.inferred}</dd></div>
      <div><dt>{t.m.projects}</dt><dd>{r.projectsReceived} <small>({r.projectsPendingLink} {t.m.pendingLink})</small></dd></div>
      <div><dt>{t.m.contacts}</dt><dd>{r.verifiedContacts}</dd></div>
      <div><dt>{t.m.conversations}</dt><dd>{r.pendingConversations}</dd></div>
      <div><dt>{t.m.requests}</dt><dd>{r.staffRequests}</dd></div>
    </dl>
    <p className={styles.metricsLabel}>{t.metricsDemo}: {t.m.demoCompanies} {metrics.demo.companies} · {t.m.demoProjects} {metrics.demo.projectsReceived}</p>
  </>;
}

async function companiesForLinking() {
  const client = getProductionSqlClient();
  return client ? (await client.query<{ id: string; name: string }>("select id,coalesce(common_name,legal_name) name from companies where merged_into_company_id is null order by 2")).rows : [];
}

/** Radar Intelligence section "Inteligencia comercial de personal" (no new screen). Real companies first, DEMO apart. */
export async function StaffingIntelligenceSection({ locale }: { readonly locale: Locale }) {
  const t = staffingCopy(locale);
  const client = getProductionSqlClient();
  if (!client) return null;
  const [snapshot, companies] = await Promise.all([loadStaffingIntelligence(client), companiesForLinking()]);
  const real = snapshot.companies.filter((c) => c.dataClass === "REAL"), demo = snapshot.companies.filter((c) => c.dataClass === "DEMO");
  return (
    <section className={styles.section} id="staffing-intelligence" aria-labelledby="staffing-title">
      <header><p className="po-eyebrow">{t.eyebrow}</p><h2 id="staffing-title">{t.title}</h2><p className={styles.muted}>{t.lede}</p></header>
      <Metrics locale={locale} metrics={snapshot.metrics} />
      <h3>{t.companiesTitle}</h3>
      {real.length ? <div className={styles.cards}>{real.map((c) => <CompanyCard key={c.key} locale={locale} company={c} />)}</div> : <p className={styles.muted}>{t.noCompanies}</p>}
      <h3>{t.projectsTitle}</h3><p className={styles.muted}>{t.projectsLede}</p>
      <ProjectList locale={locale} projects={snapshot.projects} companies={companies} />
      <ProjectSignalImportForm locale={locale} />
      {demo.length ? <details className={styles.demoBox}><summary>{t.metricsDemo} · {demo.length}</summary><div className={styles.cards}>{demo.map((c) => <CompanyCard key={c.key} locale={locale} company={c} />)}</div></details> : null}
    </section>
  );
}

/** Company Detail block: the same reading for one canonical company, next to its buyers and follow-up. */
export async function CompanyStaffingBlock({ locale, companyId }: { readonly locale: Locale; readonly companyId: string }) {
  const t = staffingCopy(locale);
  const client = getProductionSqlClient();
  if (!client) return null;
  const [snapshot, companies] = await Promise.all([loadStaffingIntelligence(client, new Date(), { companyId }), companiesForLinking()]);
  const company = snapshot.companies[0] ?? null;
  return (
    <section className={styles.block} id="staffing-intelligence" aria-labelledby="staffing-block-title">
      <h3 id="staffing-block-title">{t.blockTitle}</h3>
      {company ? <CompanyCard locale={locale} company={company} /> : <p className={styles.muted}>{t.noCompanies}</p>}
      {snapshot.projects.length ? <><h4>{t.projectsTitle}</h4><ProjectList locale={locale} projects={snapshot.projects} companies={companies} /></> : null}
    </section>
  );
}
