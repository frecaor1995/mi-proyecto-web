import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import type { CompanyCommercialData, PursuitPermissions } from "../../server/commercial-pursuit/get-pursuit-page";
import { pursuitCopy } from "./pursuit-copy";
import { PainForm, PromotePainForm } from "./pursuit-forms";
import { PainCard } from "./pursuit-workspace";
import { COMPANY_ATS_CATALOG } from "../../domain/company-ats-catalog";

const normalizeName = (value: string) => value.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|co|corp|group)\b/g, " ").replace(/\s+/g, " ").trim();
/** Recipe 2.0 commercial priority for a company, when the owner catalog names it (never implies a contact, need or client). */
const priorityFor = (companyName: string) => {
  const name = normalizeName(companyName);
  return name ? COMPANY_ATS_CATALOG.find((t) => t.commercialPriority && normalizeName(t.name) === name)?.commercialPriority ?? null : null;
};

/**
 * Company Detail: pain evidence (incl. worker referrals) and this company's opportunities with their pursuit stage.
 * A verified, consented pain signal becomes an opportunity only through the existing Commercial Intake.
 */
export function CompanyCommercialPanel({ locale, companyId, companyName, data, permissions }: {
  readonly locale: Locale; readonly companyId: string; readonly companyName: string; readonly data: CompanyCommercialData; readonly permissions: PursuitPermissions;
}) {
  const c = pursuitCopy(locale);
  const day = (value: string) => formatDate(locale, new Date(`${value}T12:00:00Z`), { dateStyle: "medium" });
  const returnPath = `/companies/${companyId}`;
  return (
    <section className="sig-panel ci-panel ct-panel" aria-labelledby="cc-title" id="commercial">
      <h2 id="cc-title">{c.companyTitle}</h2>
      <p className="sig-panel-lede">{c.companyLede}</p>
      <p className="dr-note">{c.noOutreach}</p>
      {priorityFor(companyName) ? <p className="dr-card-note"><strong>Recipe 2.0 · {locale === "es-US" ? "Prioridad" : "Priority"} {priorityFor(companyName)!.rank}</strong> — {priorityFor(companyName)!.note}</p> : null}
      <dl className="ci-grid"><div><dt>{c.pain}</dt><dd>{c.painLevel[data.pain.level]}<small>{c.painCounts(data.pain.usable, data.pain.withheld)}</small></dd></div></dl>

      <h3 className="ct-heading">{c.opportunities} · {data.opportunities.length}</h3>
      {data.opportunities.length ? (
        <ul className="ci-list">{data.opportunities.map((o) => (
          <li key={o.id}><Link href={`/opportunities/${o.id}/pursuit`}>{o.title ?? o.id}</Link> · {c.stages[o.pipeline.currentStage]} · {c.maxStage}: {c.stages[o.pipeline.maxStageReached]}
            {o.nextAction ? <small className={o.nextAction.overdue ? "ci-expired" : ""}>{c.nextAction}: {o.nextAction.action} · {day(o.nextAction.due)}{o.nextAction.overdue ? ` · ${c.overdue}` : ""}</small> : null}</li>
        ))}</ul>
      ) : <p className="po-empty">{c.noOpportunities}</p>}

      <h3 className="ct-heading">{c.painEvidence} · {data.painSignals.length}</h3>
      {data.painSignals.length ? <ul className="ct-list">{data.painSignals.map((p) => (
        <PainWithPromotion key={p.id} locale={locale} pain={p} workerName={p.reportedByWorkerId ? data.workerNames[p.reportedByWorkerId] ?? null : null} permissions={permissions}
          returnPath={returnPath} companyName={companyName} />
      ))}</ul> : <p className="po-empty">{c.noPain}</p>}

      {permissions.canWrite ? <>
        <details className="dr-details"><summary>{c.recordReferral}</summary>
          {permissions.canReadWorkers ? <PainForm locale={locale} companyId={companyId} opportunityId={null} workers={data.workers} referral /> : <p className="po-empty">{c.workerHidden}</p>}
        </details>
        <details className="dr-details"><summary>{c.recordPain}</summary><PainForm locale={locale} companyId={companyId} opportunityId={null} workers={[]} referral={false} /></details>
      </> : <p className="dr-note">{c.readOnly}</p>}
    </section>
  );
}

function PainWithPromotion({ locale, pain, workerName, permissions, returnPath, companyName }: {
  readonly locale: Locale; readonly pain: CompanyCommercialData["painSignals"][number]; readonly workerName: string | null; readonly permissions: PursuitPermissions; readonly returnPath: string; readonly companyName: string;
}) {
  const c = pursuitCopy(locale);
  return <>
    <PainCard locale={locale} pain={pain} workerName={workerName} canWrite={permissions.canWrite} returnPath={returnPath} />
    {permissions.canWrite && pain.status === "VERIFIED" && pain.usableCommercially && !pain.opportunityId ? (
      <li className="ct-card"><details className="dr-details"><summary>{c.promote}</summary>
        <PromotePainForm locale={locale} painSignalId={pain.id} customerName={companyName} returnPath={returnPath} city={pain.city} state={pain.state} />
      </details></li>
    ) : pain.opportunityId ? <li className="ct-card"><Link href={`/opportunities/${pain.opportunityId}/pursuit`}>{c.openPursuit}</Link></li> : null}
  </>;
}
