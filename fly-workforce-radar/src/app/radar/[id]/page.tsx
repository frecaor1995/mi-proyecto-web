import Link from "next/link";
import "./guided-review.css";
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
import { loadDiscoveryReviewCase } from "../../../server/discovery-review/discovery-review-workflow";
import { DiscoveryReviewWorkbench } from "../../../components/discovery-review/discovery-review-workbench";
import { loadRecordedPosting } from "../../../server/discovery-intelligence/posting-verification";
import { PostingVerificationForm } from "../../../components/discovery-intelligence/posting-verification-form";
import { guidedCopy, intelligenceCopy, labelFor, queryKindLabel, supplierCopy } from "../../../components/discovery-intelligence/intelligence-copy";
import { asCompanyOutcome, asDemandDecision, asPostingReview, postingProgress } from "../../../domain/posting-workflow";
import { OBSOLETE_URL_EXPLANATION, detectObsoleteAtsUrl } from "../../../domain/ats-url-hygiene";
import { AssistedPostingForm } from "../../../components/discovery-intelligence/assisted-posting-form";
import { SupplierAnswerSummary } from "../../../components/discovery-intelligence/external-supplier-answer-summary";
import { loadSupplierAnswers } from "../../../server/discovery-intelligence/external-supplier-answers";

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
  // No catch-to-null here: null means this candidate has no governed Discovery
  // observation. A database/query regression must surface through the route's
  // error boundary rather than silently restoring the legacy mutation path.
  const phase13Review = client ? await loadDiscoveryReviewCase(client, s.candidateId) : null;
  // Recorded postings (Recipe 2.x) get the guided review: verify posting -> confirm company -> documented demand.
  const recorded = client && phase13Review ? await loadRecordedPosting(client, s.candidateId) : null;
  const supplierAnswers = client && recorded?.employerName ? await loadSupplierAnswers(client, { companyName: recorded.employerName, companyId: phase13Review?.companyDecision?.companyId ?? null }).catch(() => []) : [];
  const readiness = client ? await getWorkforceReadiness(client, { professions: s.professions, promotedOpportunityId: s.promotedOpportunityId }).catch(() => null) : null;
  const contacts = client ? await loadBuyerInvestigation(client, { kind: "SIGNAL", signal: s, normalizedUrl: s.normalizedUrl }).catch(() => null) : null;
  const facts = [
    ["company", s.company], ["location", s.location], ["trade", s.trade], ["headcount", s.headcount], ["pay", s.pay], ["perDiem", s.perDiem], ["project", null], ["schedule", null], ["start", null], ["credentials", null], ["contact", null],
  ] as const;
  const confirmedFacts = facts.filter(([, value]) => value !== null && value !== "");
  const unknownFacts = facts.filter(([, value]) => value === null || value === "");
  const search = [s.searchKeyword, s.searchTrade, s.searchLocation].filter(Boolean).join(" · ");

  const q = s.qualification;
  const documentedDemand = q.qualified ? c.explorer.commercialCategory[q.category ?? ""] ?? q.category : q.noise ? `${c.intel.notQualified} — ${c.explorer.noise[q.noise] ?? q.noise}` : `${c.intel.notQualified} — ${q.missing.map((item) => c.explorer.missing[item]).join(" · ")}`;
  const g = guidedCopy(locale);
  const it = intelligenceCopy(locale);
  const postingReview = recorded ? asPostingReview(recorded.verifications[0]?.decision) : null;
  const progress = recorded ? postingProgress({ postingReview, companyOutcome: asCompanyOutcome(phase13Review?.companyDecision?.outcome), companyId: phase13Review?.companyDecision?.companyId ?? null, demandDecision: asDemandDecision(phase13Review?.demandDecision?.decision) }, { superseded: recorded.superseded }) : null;
  const newest = recorded?.linkedObservations.find((o) => o.latest) ?? null;
  const previousObservation = recorded ? recorded.linkedObservations[recorded.linkedObservations.findIndex((o) => o.current) - 1] ?? null : null;
  const companyId = phase13Review?.companyDecision?.companyId ?? null;
  const obsolete = recorded ? detectObsoleteAtsUrl(recorded.sourceUrl) : null;
  const supplierLatest = supplierAnswers[0] ?? null;
  const verifiedNow = postingReview === "VERIFIED" && !recorded?.superseded;
  const lastVerification = recorded?.verifications[0] ?? null;
  const stageTrack = !recorded ? [] : [
    { key: "REGISTER", status: "done", state: g.done, evidence: `${recorded.provenance} · ${recorded.observedOn ?? recorded.recordedAt.slice(0, 10)}`, pending: "—", href: "#guided-title" },
    { key: "VERIFY", status: verifiedNow ? "done" : "open", state: postingReview ? g.decisions[postingReview] : g.pending,
      evidence: lastVerification ? `${lastVerification.linkCategory ? `${g.linkCategories[lastVerification.linkCategory]} · ` : ""}${(lastVerification.note ?? "").slice(0, 90)}` : g.noneYet,
      pending: verifiedNow ? "—" : obsolete ? g.obsoleteTitle : g.step1, href: obsolete && !recorded.superseded ? "#correct-link" : "#posting-step" },
    { key: "COMPANY", status: !verifiedNow ? "locked" : phase13Review?.demandDecision?.decision === "VERIFY" ? "done" : "open",
      state: phase13Review?.companyDecision ? `${labelFor(locale, phase13Review.companyDecision.outcome)}${phase13Review.companyDecision.companyName ? ` · ${phase13Review.companyDecision.companyName}` : ""}` : !verifiedNow ? g.lockedShort : g.pendingShort,
      evidence: phase13Review?.demandDecision ? `${g.demandCol}: ${labelFor(locale, phase13Review.demandDecision.decision)}` : g.noneYet, pending: !verifiedNow ? g.step1 : g.pendingShort, href: "#review-r1-title" },
    { key: "CONTACT", status: supplierLatest && supplierLatest.answer !== "NOT_INVESTIGATED" ? "done" : "open",
      state: supplierLatest ? supplierCopy(locale).answers[supplierLatest.answer] : supplierCopy(locale).answers.NOT_INVESTIGATED,
      evidence: supplierLatest?.evidenceReference ?? g.noneYet, pending: supplierLatest?.nextAction ?? supplierCopy(locale).question, href: companyId ? `/companies/${companyId}#external-suppliers` : "#supplier-question" },
  ];
  const nextHref = !progress ? null : progress.next === "VERIFY_POSTING" || progress.next === "RECHECK_POSTING" ? "#posting-step" : progress.next === "CONFIRM_COMPANY" || progress.next === "DECIDE_DEMAND" ? "#review-r1-title"
    : progress.next === "EVALUATE_CLIENT_AND_CONTACT" ? (companyId ? `/companies/${companyId}#commercial` : "/contacts")
    : progress.next === "SUPERSEDED_BY_NEWER_OBSERVATION" && newest ? `/radar/${newest.candidateId}#guided-review` : "/radar/intelligence#daily-flow";

  const evidence = <>
      <CommercialIntelligencePanel locale={locale} signal={s} intelligence={intelligence} readiness={readiness} />
      {phase13Review && !recorded ? <DiscoveryReviewWorkbench review={phase13Review} locale={locale} /> : null}
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
            {phase13Review ? <div className="sig-verification-boundary"><strong>{locale === "es-US" ? "Revisión humana gobernada" : "Governed Human Review"}</strong><p>{locale === "es-US" ? "Este elemento se decide en la revisión empresa → demanda → promoción." : "This Discovery Intelligence item is governed by the Company → Demand → Promotion workbench."}</p><p>{locale === "es-US" ? "Los controles antiguos de verificación de señales están desactivados para que no puedan saltarse la revisión de empresa y demanda." : "The legacy signal-verification controls are disabled so they cannot bypass company and demand review."}</p></div>
              : s.status === "PROMOTED" ? <p>{c.promoted}</p> : <><p className="sig-panel-lede">{c.reviewLede}</p><SignalReviewForm locale={locale} candidateId={s.candidateId} /></>}
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
        {phase13Review ? <p className="sig-locked">{locale === "es-US" ? "Este elemento gobernado solo puede promoverse desde la revisión empresa → demanda → promoción, después de resolver la empresa canónica y verificar la demanda." : "This governed Discovery item can be promoted only from the Phase 1.3 workbench after canonical company resolution and demand verification."}</p>
          : s.status === "PROMOTED" && s.promotedOpportunityId ? (
          <p>{c.promoted} <Link href={`/opportunities/${s.promotedOpportunityId}`}>{c.openOpportunity} →</Link></p>
        ) : s.status === "VERIFIED" && taxonomy ? (
          <><p className="sig-panel-lede">{c.promoteLede}</p><SignalPromoteForm locale={locale} candidateId={s.candidateId} title={s.title} taxonomy={taxonomy} searchArea={s.searchLocation} searchTrade={s.searchTrade} /></>
        ) : <p className="sig-locked">{c.promoteLocked}</p>}
      </section>
  </>;

  return (
    <div className="page-stack sig-detail">
      <Link className="sig-back" href={recorded ? "/radar/intelligence#individual-postings" : "/radar"}>{recorded ? g.backToRadar : `← ${c.back}`}</Link>
      <header className="sig-hero">
        <div className="sig-card-head"><SignalStatusBadge locale={locale} status={recorded ? (s.status === "PROMOTED" ? "PROMOTED" : postingReview ?? "NEW") : s.status} /><span className="sig-kind">{queryKindLabel(locale, s.queryKind, c.kind[s.queryKind] ?? s.queryKind)}</span></div>
        <p className="po-eyebrow">{s.company ?? c.notFound}</p>
        <h1>{recorded?.title ?? s.title}</h1>
        <div className="sig-hero-context"><span>{s.location ?? c.notFound}</span><span>{s.trade ?? c.notFound}</span><span>{s.workforceNeed ?? c.notFound}</span></div>
        <p className="sig-hero-excerpt">{s.description ?? c.noExcerpt}</p>
        {s.promotedOpportunityId ? <Link className="button button-primary" href={`/opportunities/${s.promotedOpportunityId}`}>{c.openOpportunity}</Link> : null}
      </header>
      {recorded && phase13Review && progress ? <>
        <section className="sig-panel guided-review" id="guided-review" aria-labelledby="guided-title">
          <p className="po-eyebrow">{g.eyebrow}</p><h2 id="guided-title">{g.title}</h2><p className="sig-panel-lede">{g.lede}</p>
          {recorded.superseded && newest ? <p className="review-r1-warning" role="status">{g.supersededNotice} <Link href={`/radar/${newest.candidateId}#guided-review`}>{g.openLatest}</Link></p> : null}
          <div className="guided-next" role="status"><small>{g.nextAction}</small><strong>{it.nextLabel[progress.next]}</strong>{nextHref ? <Link className="button button-primary" href={nextHref}>{it.goNext}</Link> : null}</div>
          <h3>{g.stagesTitle}</h3>
          <ol className="guided-stages">{stageTrack.map((stage, index) => <li key={stage.key} className={`is-${stage.status}`}>
            <b>{String(index + 1).padStart(2, "0")} · {g.stages[stage.key]}</b>
            <dl><div><dt>{g.stageState}</dt><dd>{stage.state}</dd></div><div><dt>{g.stageEvidence}</dt><dd>{stage.evidence}</dd></div><div><dt>{g.stagePending}</dt><dd>{stage.pending}</dd></div></dl>
            <Link href={stage.href}>{g.stageNext}: {g.stageGo}</Link>
          </li>)}</ol>
          {recorded.urlCorrection ? <div className="guided-changes"><b>{g.correctionOf}.</b> {g.previousLink}: <code>{recorded.urlCorrection.previousUrl}</code> · <Link href={`/radar/${recorded.urlCorrection.previousCandidateId}#guided-review`}>{g.open}</Link><br />{g.correctionReasonLabel}: {recorded.urlCorrection.reason}</div> : null}
          {obsolete && !recorded.superseded ? <div className="review-r1-warning guided-obsolete" role="status">
            <strong>{g.obsoleteTitle}</strong> <span>{g.obsoleteBody}</span>
            <a href={obsolete.proposedUrl} target="_blank" rel="noreferrer noopener"><code>{obsolete.proposedUrl}</code></a>
            <small>{g.obsoleteExplanation}: {OBSOLETE_URL_EXPLANATION[obsolete.rule]}</small>
          </div> : null}
          {recorded.linkedObservations.length > 1 ? <div className="guided-linked">
            <h3>{g.linkedTitle}</h3><p className="sig-muted">{g.linkedLede}</p>
            <div className="guided-table-wrap"><table>
              <thead><tr><th>{g.observation}</th><th>{g.postingCol}</th><th>{g.companyCol}</th><th>{g.demandCol}</th><th></th></tr></thead>
              <tbody>{recorded.linkedObservations.map((o, index) => <tr key={o.observationId} className={o.current ? "is-current" : undefined}>
                <td>{index + 1}. {o.observedOn ?? o.capturedAt.slice(0, 10)}{o.current ? ` · ${g.thisOne}` : ""}{o.latest ? ` · ${g.latestTag}` : ""}{o.urlCorrection ? ` · ${g.correctedTag}` : ""}</td>
                <td>{o.postingDecision ? g.decisions[o.postingDecision] ?? o.postingDecision : g.pending}</td>
                <td>{o.companyOutcome ? `${labelFor(locale, o.companyOutcome)}${o.companyName ? ` · ${o.companyName}` : ""}` : g.none}</td>
                <td>{o.demandDecision ? labelFor(locale, o.demandDecision) : g.none}</td>
                <td>{o.current ? null : <Link href={`/radar/${o.candidateId}#guided-review`}>{g.open}</Link>}</td>
              </tr>)}</tbody>
            </table></div>
            {recorded.changesFromPrevious && previousObservation ? <p className="guided-changes"><b>{g.changesTitle} ({previousObservation.observedOn ?? previousObservation.capturedAt.slice(0, 10)}):</b> {recorded.changesFromPrevious.length ? recorded.changesFromPrevious.map((f) => g.fields[f] ?? f).join(" · ") : g.noChanges}</p> : null}
            {previousObservation?.postingDecision && !recorded.superseded ? <p className="sig-muted">{g.previousDecision(g.decisions[previousObservation.postingDecision] ?? previousObservation.postingDecision, previousObservation.observedOn ?? previousObservation.capturedAt.slice(0, 10))}</p> : null}
          </div> : null}
          <h3>{g.recorded}</h3>
          <dl className="guided-facts">
            <div><dt>{g.company}</dt><dd>{recorded.employerName ?? g.unknown}</dd></div>
            <div><dt>{g.jobTitle}</dt><dd>{recorded.title ?? g.unknown}</dd></div>
            <div><dt>{g.location}</dt><dd>{recorded.location ?? g.unknown}</dd></div>
            <div><dt>{g.experience}</dt><dd>{recorded.experience ?? g.unknown}</dd></div>
            <div><dt>{g.licenses}</dt><dd>{recorded.licenses.length ? recorded.licenses.join(" · ") : g.unknown}</dd></div>
            <div><dt>{g.salary}</dt><dd>{recorded.compensation ?? g.salaryNone}</dd></div>
            <div><dt>{g.level}</dt><dd>{g.levels[recorded.levelClass]}<small> {g.levelNote}</small></dd></div>
            <div><dt>{g.provenance}</dt><dd>{recorded.provenance}{locale === "es-US" ? ` · ${labelFor(locale, recorded.provenance)}` : ""}</dd></div>
            <div><dt>{g.dataClass}</dt><dd>{recorded.dataClass}</dd></div>
            <div><dt>{g.postingId}</dt><dd>{recorded.externalPostingId ?? g.unknown}</dd></div>
            <div><dt>{g.observedOn}</dt><dd>{recorded.observedOn ?? g.unknown} · {g.recordedAt} {formatDateTime(recorded.recordedAt, locale)}</dd></div>
            {recorded.emailAlert ? <div><dt>{g.emailAlert}</dt><dd>{recorded.emailAlert.sender} · {recorded.emailAlert.receivedOn} · {recorded.emailAlert.alertReference}</dd></div> : null}
            <div className="guided-wide"><dt>{g.summary}</dt><dd>{recorded.summary ?? g.unknown}</dd></div>
          </dl>
          <p className="sig-muted">{g.urlNotVisited}</p>

          <div className="review-r1-card guided-step" id="posting-step">
            <span className="review-r1-number">01</span><h3>{g.step1}</h3><p>{g.step1Lede}</p>
            <a className="button button-secondary" href={recorded.sourceUrl} target="_blank" rel="noreferrer noopener">{g.openOfficial}</a>
            <p className="review-r1-current"><b>{g.current}:</b> {postingReview ? g.decisions[postingReview] : g.pending}</p>
            {recorded.superseded ? null : <PostingVerificationForm locale={locale} candidateId={s.candidateId} />}
            <h4>{g.history}</h4>
            {recorded.verifications.length ? <ol className="sig-history">{recorded.verifications.map((v, index) => <li key={`${v.decidedAt}-${index}`}><strong>{g.decisions[v.decision] ?? v.decision}</strong>{v.linkCategory ? <em> · {g.linkCategories[v.linkCategory]}</em> : null}<span> {formatDateTime(v.decidedAt, locale)}{v.decidedBy ? ` · ${v.decidedBy}` : ""}</span>{v.note ? <p>{v.note}</p> : null}</li>)}</ol> : <p className="sig-muted">{g.noHistory}</p>}
          </div>

          {recorded.superseded ? null : <div className="guided-correction">
            <p className="sig-muted">{g.correctLinkHint}</p>
            <AssistedPostingForm locale={locale} prefill={{ url: obsolete?.proposedUrl ?? "", company: recorded.employerName ?? "", title: recorded.title ?? "", city: (recorded.location ?? "").split(",")[0]?.trim() ?? "",
              state: (recorded.location ?? "").split(",")[1]?.trim() ?? "", salary: recorded.compensation, experience: recorded.experience, licenses: recorded.licenses.join("; ") || null, summary: recorded.summary }}
              correction={{ candidateId: s.candidateId, rule: obsolete?.rule ?? null, reason: obsolete ? OBSOLETE_URL_EXPLANATION[obsolete.rule] : "" }} />
          </div>}

          <dl className="guided-facts">
            <div className="guided-wide"><dt>{g.documented}</dt><dd>{documentedDemand}<small> {g.documentedNote}</small></dd></div>
            <div className="guided-wide"><dt>{g.supplier}</dt><dd>{c.intel.supplier[intelligence.supplierEligibility]}</dd></div>
          </dl>
          <div id="supplier-question"><h3>{supplierCopy(locale).question}</h3><SupplierAnswerSummary locale={locale} answers={supplierAnswers} />
            <Link href={companyId ? `/companies/${companyId}#external-suppliers` : "/radar/intelligence#priority-companies"}>{supplierCopy(locale).record} →</Link></div>
        </section>
        <DiscoveryReviewWorkbench review={phase13Review} locale={locale} postingVerified={postingReview === "VERIFIED" && !recorded.superseded} firstStep={2} />
        <details className="sig-panel guided-evidence"><summary>{g.allEvidence}</summary>{evidence}</details>
      </> : evidence}
    </div>
  );
}
