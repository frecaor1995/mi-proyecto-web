import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import { INTELLIGENCE_FIELDS, type CommercialIntelligence, type IntelligenceField } from "../../domain/signal-intelligence";
import type { SignalDetail } from "../../server/opportunity-discovery/signals";
import type { WorkforceReadiness } from "../../server/source-enrichment/workforce-readiness";
import { discoveryCopy } from "./discovery-copy";
import { SignalStatusBadge } from "./signal-list";
import { EnrichSourceForm } from "./enrich-source-form";

const REQUIREMENT_FIELDS = ["headcount", "specialty", "experience", "licenses", "certifications", "schedule", "startDate", "duration", "hourlyRate", "perDiem", "travel", "responseDeadline"] as const;

/**
 * One coherent intelligence record for a signal: WHO / WHAT / PROFESSION / WHERE / requirements / missing /
 * supplier eligibility / workforce readiness / next action / verification. Values carry their provenance.
 */
export function CommercialIntelligencePanel({ locale, signal, intelligence, readiness }: {
  readonly locale: Locale; readonly signal: SignalDetail; readonly intelligence: CommercialIntelligence; readonly readiness: WorkforceReadiness | null;
}) {
  const c = discoveryCopy(locale);
  const t = c.intel;
  const q = signal.qualification;
  const f = intelligence.fields;
  const show = (field: IntelligenceField) => field.value ?? c.notFound;
  const supported = REQUIREMENT_FIELDS.filter((key) => f[key].status === "SUPPORTED");
  const demand = q.qualified ? c.explorer.commercialCategory[q.category ?? ""] : q.noise ? `${t.notQualified} — ${c.explorer.noise[q.noise] ?? q.noise}` : `${t.notQualified} — ${q.missing.map((item) => c.explorer.missing[item]).join(" · ")}`;
  return (
    <section className="sig-panel ci-panel" aria-labelledby="ci-title">
      <h2 id="ci-title">{t.title}</h2>
      <p className="sig-panel-lede">{t.lede}</p>
      <dl className="ci-grid">
        <div><dt>{t.who}</dt><dd>{show(f.company)}{f.project.value ? ` · ${f.project.value}` : ""}</dd></div>
        <div className={q.qualified ? "ci-ok" : "ci-warn"}><dt>{t.what}</dt><dd>{demand}{q.evidenceOrigin ? <small> {t.evidence[q.evidenceOrigin]}</small> : null}
          {q.expiry ? <small className="ci-expired"> {t.expiry[q.expiry.basis]} {q.expiry.date}{t.expiryTail[q.expiry.basis]}.</small> : null}</dd></div>
        <div><dt>{t.profession}</dt><dd>{show(f.profession)}{f.specialty.value ? ` — ${f.specialty.value}` : ""}{f.profession.note ? <small> {f.profession.note}</small> : null}</dd></div>
        <div><dt>{t.where}</dt><dd>{show(f.location)}</dd></div>
        <div className="ci-wide"><dt>{t.requirements}</dt><dd>{supported.length ? <ul className="ci-list">{supported.map((key) => <li key={key}><span>{t.fieldLabel[key]}:</span> {f[key].value}</li>)}</ul> : t.noSupported}</dd></div>
        <div className="ci-wide"><dt>{t.missing}</dt><dd>{intelligence.missing.length ? intelligence.missing.map((key) => t.fieldLabel[key]).join(" · ") : t.nothingMissing}</dd></div>
        <div className={intelligence.supplierEligibility === "EXPLICIT" ? "ci-ok" : "ci-warn"}><dt>{t.eligibility}</dt><dd>{t.supplier[intelligence.supplierEligibility]}{f.supplierEligibility.quote ? <q>{f.supplierEligibility.quote}</q> : null}</dd></div>
        <div><dt>{t.workforce}</dt><dd>{readiness ? <>
          {t.readiness[readiness.state]}{Object.keys(readiness.outcomes).length ? ` (${t.outcomes(readiness.outcomes)})` : ""}
          {readiness.tradeCodes.length ? <small> {t.supply(readiness.supply.real, readiness.supply.demo)}</small> : null}{readiness.demoOnlyMatches ? <small className="ci-expired"> {t.demoOnly}</small> : null}
        </> : c.notFound}</dd></div>
        <div className="ci-wide ci-action"><dt>{t.next}</dt><dd><strong>{t.action[intelligence.nextAction]}</strong><small> {t.noOutreach}</small></dd></div>
        <div><dt>{t.verification}</dt><dd><SignalStatusBadge locale={locale} status={signal.status} /></dd></div>
        <div className="ci-wide"><dt>{t.enrichment}</dt><dd>
          {signal.page ? `${t.enrichmentStatus[signal.page.status] ?? signal.page.status} · ${t.retrievedAt} ${formatDate(locale, new Date(signal.page.fetchedAt), { dateStyle: "medium", timeStyle: "short" })}` : t.notRetrieved}
          <EnrichSourceForm locale={locale} candidateId={signal.candidateId} />
        </dd></div>
      </dl>
      <details className="dr-details ci-evidence">
        <summary>{t.fieldEvidence}</summary>
        <div className="dr-table-wrap">
          <table className="dr-table">
            <thead><tr><th scope="col">{t.field}</th><th scope="col">{t.value}</th><th scope="col">{t.status}</th><th scope="col">{t.origin}</th></tr></thead>
            <tbody>{INTELLIGENCE_FIELDS.map((key) => (
              <tr key={key}>
                <th scope="row">{t.fieldLabel[key]}</th>
                <td>{f[key].value ?? "—"}{f[key].quote ? <q className="ci-quote">{f[key].quote}</q> : null}{f[key].note ? <small> {f[key].note}</small> : null}</td>
                <td className={`ci-status-${f[key].status.toLowerCase()}`}>{t.fieldStatus[f[key].status]}</td>
                <td>{f[key].origin ? t.fieldOrigin[f[key].origin!] : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
