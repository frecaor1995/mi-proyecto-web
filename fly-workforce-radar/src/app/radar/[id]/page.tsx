import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { formatDate } from "../../../i18n/format";
import type { Locale } from "../../../i18n/locale";
import { loadSignal } from "../../../server/opportunity-discovery/signals";
import { getWorkforceTaxonomy } from "../../../server/workforce/get-workforce-taxonomy";
import { discoveryCopy } from "../../../components/opportunity-discovery/discovery-copy";
import { SignalStatusBadge } from "../../../components/opportunity-discovery/signal-list";
import { SignalPromoteForm, SignalReviewForm } from "../../../components/opportunity-discovery/signal-forms";
import { CommercialIntelligencePanel } from "../../../components/opportunity-discovery/commercial-intelligence-panel";
import { buildCommercialIntelligence } from "../../../domain/signal-intelligence";
import { getProductionSqlClient } from "../../../server/database/production-sql-client";
import { getWorkforceReadiness } from "../../../server/source-enrichment/workforce-readiness";
import { BuyerWorkspace } from "../../../components/opportunity-discovery/buyer-workspace";
import { loadBuyerInvestigation } from "../../../server/contact-intelligence/buyer-investigation";
import { providerStatuses } from "../../../server/contact-intelligence/providers";

const formatDateTime = (value: string, locale: Locale) => formatDate(locale, new Date(value), { dateStyle: "medium", timeStyle: "short" });

export default async function SignalPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [locale, result] = await Promise.all([resolveServerLocale(), loadSignal(id)]);
  if (result.state === "NOT_FOUND") notFound();
  const c = discoveryCopy(locale);
  if (result.state !== "READY") return <div className="page-stack"><p className="po-empty">{c.unavailable}</p></div>;
  const s = result.signal;
  const taxonomy = s.status === "VERIFIED" ? await getWorkforceTaxonomy() : null;
  const intelligence = buildCommercialIntelligence({
    url: s.url, snippet: `${s.title} ${s.description ?? ""}`, page: s.page, qualification: s.qualification, professions: s.professions,
    location: s.location, providerPublicationDate: s.publicationDate, status: s.status,
  });
  const client = getProductionSqlClient();
  const readiness = client ? await getWorkforceReadiness(client, { professions: s.professions, promotedOpportunityId: s.promotedOpportunityId }).catch(() => null) : null;
  const contacts = client ? await loadBuyerInvestigation(client, { kind: "SIGNAL", signal: s, normalizedUrl: s.normalizedUrl }).catch(() => null) : null;
  const facts = [
    ["company", s.company], ["location", s.location], ["trade", s.trade], ["headcount", s.headcount], ["pay", s.pay], ["perDiem", s.perDiem], ["project", null], ["schedule", null], ["start", null], ["credentials", null], ["contact", null],
  ] as const;
  const confirmedFacts = facts.filter(([, value]) => value !== null && value !== "");
  const unknownFacts = facts.filter(([, value]) => value === null || value === "");
  const search = [s.searchKeyword, s.searchTrade, s.searchLocation].filter(Boolean).join(" · ");

  return (
    <div className="page-stack sig-detail">
      <Link className="sig-back" href="/radar">← {c.back}</Link>
      <header className="sig-hero">
        <div className="sig-card-head"><SignalStatusBadge locale={locale} status={s.status} /><span className="sig-kind">{c.kind[s.queryKind] ?? s.queryKind}</span></div>
        <p className="po-eyebrow">{s.company ?? c.notFound}</p>
        <h1>{s.title}</h1>
        <div className="sig-hero-context"><span>{s.location ?? c.notFound}</span><span>{s.trade ?? c.notFound}</span><span>{s.workforceNeed ?? c.notFound}</span></div>
        <p className="sig-hero-excerpt">{s.description ?? c.noExcerpt}</p>
        {s.promotedOpportunityId ? <Link className="button button-primary" href={`/opportunities/${s.promotedOpportunityId}`}>{c.openOpportunity}</Link> : null}
      </header>

      <CommercialIntelligencePanel locale={locale} signal={s} intelligence={intelligence} readiness={readiness} />
      {contacts ? <BuyerWorkspace locale={locale} subject={{ signalId: s.candidateId }} view={contacts} providers={providerStatuses()} /> : null}

      <div className="sig-columns">
        <div className="sig-main">
          <section className="sig-panel">
            <p className="sig-section-index">A</p><h2>{c.foundSection}</h2>
            <div className="sig-commercial-summary"><div><span>{c.company}</span><strong>{s.company ?? c.notFound}</strong></div><div><span>{c.location}</span><strong>{s.location ?? c.notFound}</strong></div><div><span>{c.trade}</span><strong>{s.trade ?? c.notFound}</strong></div><div><span>{c.workforceNeed}</span><strong>{s.workforceNeed ?? c.notFound}</strong></div></div>
          </section>

          <section className="sig-panel">
            <p className="sig-section-index">B</p><h2>{c.sourceEvidence}</h2>
            <dl className="sig-facts">
              <div><dt>{c.source}</dt><dd>{s.domain}</dd></div>
              <div><dt>{c.facts.url}</dt><dd><a href={s.url} target="_blank" rel="noreferrer noopener">{s.url}</a></dd></div>
              <div><dt>{c.discovered}</dt><dd>{formatDateTime(s.firstDiscoveredAt, locale)} · {c.seen(s.timesSeen)}</dd></div>
              {s.providerRank ? <div><dt>{c.searchContext}</dt><dd>{search || "—"} · {c.rank(s.providerRank)}</dd></div> : null}
            </dl>
            <blockquote className="sig-excerpt-block"><small>{c.excerpt}</small>{s.description ?? c.noExcerpt}</blockquote>
            <a className="button button-secondary" href={s.url} target="_blank" rel="noreferrer noopener">{c.openSource} ↗</a>
          </section>

          <section className="sig-panel">
            <p className="sig-section-index">C</p><h2>{c.workforceSection}</h2>
            <div className="sig-need-band"><div><span>{c.trade}</span><strong>{s.trade ?? c.notFound}</strong></div><div><span>{c.headcount}</span><strong>{s.headcount ?? c.notFound}</strong></div><div><span>{c.pay}</span><strong>{s.pay ?? c.notFound}</strong></div><div><span>{c.perDiem}</span><strong>{s.perDiem ?? c.notFound}</strong></div></div>
            <p>{s.relevanceReason ?? c.unknown}</p>
          </section>

          <section className="sig-panel">
            <p className="sig-section-index">D</p><h2>{c.confirmedSection}</h2>
            <p className="sig-panel-lede">{c.knowledgeLede}</p>
            <ul className="sig-knowledge">
              <li className="is-confirmed"><span>{c.facts.title}</span><strong>{c.confirmedFromSource}</strong></li>
              <li className="is-confirmed"><span>{c.facts.url}</span><strong>{c.confirmedFromSource}</strong></li>
              {confirmedFacts.map(([fact, value]) => <li key={fact} className="is-confirmed"><span>{c.facts[fact]}</span><strong>{String(value)}</strong></li>)}
            </ul>
          </section>
          <section className="sig-panel"><p className="sig-section-index">E</p><h2>{c.unknownSection}</h2><ul className="sig-unknown-list">{unknownFacts.map(([fact]) => <li key={fact}><span>{c.facts[fact]}</span><strong>{c.notFound}</strong></li>)}</ul></section>
        </div>

        <aside className="sig-side">
          <section className="sig-panel">
            <p className="sig-section-index">F</p><h2>{c.reviewTitle}</h2>
            {s.status === "PROMOTED" ? <p>{c.promoted}</p> : <><p className="sig-panel-lede">{c.reviewLede}</p><SignalReviewForm locale={locale} candidateId={s.candidateId} /></>}
            <div className="sig-verification-boundary"><strong>{c.gapsSection}</strong><p>{c.reviewQuestion}</p><p>{c.verifyBoundary}</p></div>
            <h3>{c.history}</h3>
            {s.reviews.length ? (
              <ol className="sig-history">
                {s.reviews.map((review, index) => (
                  <li key={`${review.decidedAt}-${index}`}>
                    <SignalStatusBadge locale={locale} status={review.decision} />
                    <span>{formatDateTime(review.decidedAt, locale)}{review.decidedBy ? ` · ${review.decidedBy}` : ""}</span>
                    {review.note ? <p>{review.note}</p> : null}
                  </li>
                ))}
              </ol>
            ) : <p className="sig-muted">{c.noHistory}</p>}
          </section>
        </aside>
      </div>

      <section className="sig-panel sig-promote">
        <h2>{c.promoteTitle}</h2>
        {s.status === "PROMOTED" && s.promotedOpportunityId ? (
          <p>{c.promoted} <Link href={`/opportunities/${s.promotedOpportunityId}`}>{c.openOpportunity} →</Link></p>
        ) : s.status === "VERIFIED" && taxonomy ? (
          <><p className="sig-panel-lede">{c.promoteLede}</p><SignalPromoteForm locale={locale} candidateId={s.candidateId} title={s.title} taxonomy={taxonomy} searchArea={s.searchLocation} searchTrade={s.searchTrade} /></>
        ) : <p className="sig-locked">{c.promoteLocked}</p>}
      </section>
    </div>
  );
}
