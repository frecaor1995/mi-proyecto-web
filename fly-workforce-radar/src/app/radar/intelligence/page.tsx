import Link from "next/link";
import { getDiscoveryIntelligence } from "../../../server/discovery-intelligence/get-discovery-intelligence";
import { ManualMissForm } from "../../../components/discovery-intelligence/manual-miss-form";
import { AssistedPostingForm } from "../../../components/discovery-intelligence/assisted-posting-form";
import { intelligenceCopy, labelFor, opsCopy } from "../../../components/discovery-intelligence/intelligence-copy";
import { ExternalSupplierAnswerForm } from "../../../components/discovery-intelligence/external-supplier-answer-form";
import { SupplierAnswerSummary } from "../../../components/discovery-intelligence/external-supplier-answer-summary";
import { StaffingIntelligenceSection } from "../../../components/staffing-intelligence/staffing-intelligence";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { formatDate, formatNumber } from "../../../i18n/format";
import { nextPostingToWork } from "../../../domain/posting-workflow";
import styles from "./page.module.css";

const LEVELS = ["ENTRY_LEVEL", "MIXED_APPRENTICE_EXPERIENCED", "EXPERIENCED", "UNKNOWN"] as const;
const PRIORITY_KEYS = ["enterprise", "walker", "fsg"] as const;

export default async function DiscoveryIntelligencePage({ searchParams = Promise.resolve({}) }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const [snapshot, locale, params] = await Promise.all([getDiscoveryIntelligence(), resolveServerLocale(), searchParams]);
  const t = intelligenceCopy(locale);
  const o = opsCopy(locale);
  const label = (value: string) => labelFor(locale, value);
  const count = (value: number | null) => value === null ? "—" : formatNumber(locale, value);
  const date = (value: string | null) => value ? formatDate(locale, new Date(value), { month: "short", day: "numeric", year: "numeric" }) : t.unknown;
  const prefillCompany = typeof params.company === "string" ? params.company.slice(0, 200) : "";
  const levelFilter = LEVELS.find((l) => l === params.level) ?? null;
  const review = snapshot.companyDemand.filter((group) => group.resolutionState !== "RESOLVED_CANONICAL");
  const r20 = snapshot.recipe20;
  const realPostings = snapshot.individualPostings.filter((p) => p.dataClass === "REAL");
  const nextWork = nextPostingToWork(realPostings.filter((p) => p.reviewHref));
  const nextOf = (kinds: readonly string[]) => nextPostingToWork(realPostings.filter((p) => p.reviewHref && kinds.includes(p.next)));
  const nextVerify = nextOf(["VERIFY_POSTING", "RECHECK_POSTING"]);
  const nextCompany = nextOf(["CONFIRM_COMPANY", "DECIDE_DEMAND"]);
  const shownPostings = levelFilter ? snapshot.individualPostings.filter((p) => p.levelClass === levelFilter) : snapshot.individualPostings;
  const enterprise = r20?.sources.find((s) => s.key === "enterprise") ?? null;
  const unasked = r20 ? PRIORITY_KEYS.filter((k) => !r20.supplierAnswers[k]).length : 0;
  const stages = r20 ? [
    { key: "REGISTER", state: o.registerState(r20.today.registered, r20.today.goal, r20.realPostings, r20.targets.realPostings), evidence: o.registerEvidence(r20.channels.ASSISTED_MANUAL, r20.channels.EMAIL_ALERT, r20.channels.AUTOMATED_HTTP),
      pending: o.registerPending(r20.capturePriorities.slice(0, 3).map((p) => p.name).join(", ")), next: o.registerNext, href: "#register" },
    { key: "VERIFY", state: o.verifyState(r20.verifiedPostings), evidence: o.verifyEvidence, pending: o.verifyPending(r20.pendingPostingVerification, r20.obsoleteUrlsPending),
      next: nextVerify ? `${o.verifyNext}: ${nextVerify.title ?? ""} — ${nextVerify.employerName ?? ""}` : o.verifyNext, href: nextVerify?.reviewHref ? `${nextVerify.reviewHref}#guided-review` : "#individual-postings" },
    { key: "COMPANY", state: o.companyState(r20.demandVerified), evidence: o.companyEvidence(r20.commercialSignals, r20.possibleClients.length), pending: o.companyPending(r20.pendingCompanyOrDemand),
      next: nextCompany ? `${o.companyNext}: ${nextCompany.title ?? ""} — ${nextCompany.employerName ?? ""}` : o.companyNext, href: nextCompany?.reviewHref ? `${nextCompany.reviewHref}#review-r1-title` : "#recipe-2-0" },
    { key: "CONTACT", state: o.contactState(r20.supplierAnswerCounts.YES, r20.supplierAnswerCounts.NO, r20.supplierAnswerCounts.OWN_AGENCY_ONLY, r20.supplierAnswerCounts.NO_RESPONSE),
      evidence: o.contactEvidence(r20.conversations, r20.staffRequests), pending: o.contactPending(unasked), next: o.contactNext, href: "#priority-companies" },
  ] : [];
  return <div className={`page-stack ${styles.page}`}>
    <header className="app-page-header">
      <p className="po-eyebrow">{t.eyebrow}</p>
      <h1>{t.title}</h1>
      <p>{t.lede}</p>
    </header>

    {snapshot.state !== "READY" ? <section className={styles.boundary} role="status"><strong>{snapshot.state === "UNAVAILABLE" ? t.dbUnavailable : t.modelUnavailable}</strong><span>{t.noFabrication}</span></section> : null}

    <section className={styles.panel} id="daily-flow" aria-labelledby="daily-flow-title">
      <header><div><p className="po-eyebrow">{o.stagesEyebrow}</p><h2 id="daily-flow-title">{o.stagesTitle}</h2></div></header>
      <ol className={styles.stageFlow}>{stages.map((stage, index) => <li key={stage.key}>
        <b>{String(index + 1).padStart(2, "0")} · {o.stage[stage.key]}</b>
        <dl><div><dt>{o.state}</dt><dd>{stage.state}</dd></div><div><dt>{o.evidence}</dt><dd>{stage.evidence}</dd></div><div><dt>{o.pending}</dt><dd>{stage.pending}</dd></div></dl>
        <Link href={stage.href}>{o.next}: {stage.next} →</Link>
      </li>)}</ol>
      <div className={styles.nextAction} role="status">
        <small>{t.nextActionTitle}</small>
        {nextWork ? <><strong>{t.nextLabel[nextWork.next]}</strong><p>{nextWork.title ?? t.unknownTitle} — {nextWork.employerName ?? t.unknownEmployer} · {nextWork.location ?? t.unknownLocation}</p>
          <Link className="button button-primary" href={`${nextWork.reviewHref}#guided-review`}>{t.goNext}</Link></>
          : <><p>{t.nothingPending}</p><Link className="button button-secondary" href="#register">{o.registerNext} →</Link></>}
      </div>
    </section>

    {r20 ? <section className={styles.panel} id="today-goal" aria-labelledby="today-goal-title">
      <header><div><p className="po-eyebrow">{r20.today.date}</p><h2 id="today-goal-title">{o.todayTitle}</h2></div><span>{o.todayObservations(r20.today.observationsRecorded)}</span></header>
      <div className={styles.todayGoal}><strong>{o.todayLine(r20.today.registered, r20.today.goal)}</strong>
        <meter min={0} max={r20.today.goal} value={Math.min(r20.today.registered, r20.today.goal)} aria-label={o.todayTitle} />
        <p>{o.byOperator}: {r20.today.byOperator.length ? r20.today.byOperator.map((x) => `${x.name} ${x.count}`).join(" · ") : o.nobodyYet}</p>
        <p className="sig-muted">{o.todayNote}</p></div>
      <h3>{o.priorities}</h3>
      <ol className={styles.captureList}>{r20.capturePriorities.map((p) => <li key={p.key}>
        <strong>{p.name}</strong><span>{label(p.policy)} · {o.activeRoute[p.activeRoute]}</span>
        <Link href={`?company=${encodeURIComponent(p.name.replace(/\s*\(.*\)\s*$/, ""))}#register`}>{t.registerFor(p.name)} →</Link>
      </li>)}</ol>
      <p className={styles.boundaryNote}>{o.routeNote}</p>
    </section> : null}

    <StaffingIntelligenceSection locale={locale} />

    <section className={styles.panel} id="individual-postings">
      <header><div><p className="po-eyebrow">{t.postingsEyebrow}</p><h2>{t.postingsTitle}</h2></div><span>{t.postingsSummary(snapshot.individualPostings.length)}</span></header>
      <nav className={styles.levelFilter} aria-label={o.levelFilter}><span>{o.levelFilter}:</span>
        <Link href="?#individual-postings" aria-current={levelFilter ? undefined : "true"}>{o.allLevels}</Link>
        {LEVELS.map((l) => <Link key={l} href={`?level=${l}#individual-postings`} aria-current={levelFilter === l ? "true" : undefined}>{o.level[l]}</Link>)}</nav>
      {shownPostings.length === 0 ? <div className={styles.decompositionEmpty}><strong>{t.noPostingsTitle}</strong><p>{t.noPostingsBody}</p></div> :
        <div className={styles.individualPostingList}>{shownPostings.map((posting) => <article key={posting.evidenceId}>
          <div className={styles.cardTop}><span className={styles.childBadge}>{label(posting.provenance)}</span><span>{label(posting.dataClass)}</span><span>{t.stageLabel[posting.stage]}</span>{posting.observationCount > 1 ? <span>{t.observationOf(posting.observationNumber, posting.observationCount)}</span> : null}</div>
          <h3>{posting.title ?? t.unknownTitle}</h3><p>{posting.employerName ?? t.unknownEmployer} · {posting.location ?? t.unknownLocation}</p>
          <p className={styles.levelBadge}>{o.level[posting.levelClass]}{posting.urlCorrected ? ` · ${o.correctedBadge}` : ""}</p>
          {posting.obsoleteUrl && posting.stage !== "SUPERSEDED" ? <p className={styles.obsoleteNote}><b>{o.obsoleteBadge}</b> → <code>{posting.obsoleteUrl.proposedUrl}</code>{posting.reviewHref ? <> <Link href={`${posting.reviewHref}#correct-link`}>{o.fixLink}</Link></> : null}</p> : null}
          <p className={posting.open ? styles.postingNext : styles.postingClosed}><b>{t.nextStep}:</b> {t.nextLabel[posting.next]}</p>
          <dl className={styles.factGrid}>
            <div><dt>{t.profession}</dt><dd>{posting.profession ? label(posting.profession) : t.unknown}</dd></div>
            <div><dt>{posting.provenance === "AUTOMATED_HTTP" ? t.captured : t.observedByOperator}</dt><dd>{date(posting.capturedAt)}</dd></div>
            <div><dt>{t.salary}</dt><dd>{posting.compensation ?? t.salaryNone}</dd></div>
            <div><dt>{t.experience}</dt><dd>{posting.experience ?? t.unknown}</dd></div>
            <div><dt>{t.licenses}</dt><dd>{posting.licenses.length ? posting.licenses.join(" · ") : t.unknown}</dd></div>
            <div><dt>{t.vendorAcceptance}</dt><dd>{t.unknown}</dd></div>
            {posting.companyName ? <div><dt>{t.canonicalCompany}</dt><dd>{posting.decisions.companyId ? <Link href={`/companies/${posting.decisions.companyId}`}>{posting.companyName}</Link> : posting.companyName}</dd></div> : null}
            {posting.emailAlert ? <div><dt>{t.emailAlert}</dt><dd>{posting.emailAlert.sender} · {posting.emailAlert.receivedOn} · {posting.emailAlert.alertReference}</dd></div> : null}
          </dl>
          <footer><a href={posting.sourceUrl} target="_blank" rel="noreferrer">{t.openPosting}</a>{posting.reviewHref ? <Link href={`${posting.reviewHref}#guided-review`}>{t.openReview}</Link> : <span>{t.companyResolutionRequired}</span>}</footer>
        </article>)}</div>}
      <AssistedPostingForm key={prefillCompany} locale={locale} defaultCompany={prefillCompany} />
    </section>

    {r20 ? <section className={styles.panel} id="recipe-2-0">
      <header><div><p className="po-eyebrow">{t.progressEyebrow}</p><h2>{t.progressTitle}</h2></div><span>{t.goalsLine(r20.targets.realPostings, r20.targets.possibleClients)}</span></header>
      <dl className={styles.factGrid}>
        <div><dt>{o.mVacancies}</dt><dd>{r20.realPostings} / {r20.targets.realPostings} {t.mGoal}</dd></div>
        <div><dt>{t.mByChannel}</dt><dd>{t.automated} {r20.channels.AUTOMATED_HTTP} · {t.assisted} {r20.channels.ASSISTED_MANUAL} · {t.emailAlert} {r20.channels.EMAIL_ALERT}</dd></div>
        <div><dt>{o.mVerified}</dt><dd>{r20.verifiedPostings}</dd></div>
        <div><dt>{o.mPending}</dt><dd>{r20.pendingPostingVerification + r20.pendingCompanyOrDemand}</dd></div>
        <div><dt>{o.mDuplicates}</dt><dd>{r20.duplicatesPrevented} ({t.reobs} {r20.reObservations})</dd></div>
        <div><dt>{o.mCorrections}</dt><dd>{r20.urlCorrections}</dd></div>
        <div><dt>{o.mDemand}</dt><dd>{r20.demandVerified}</dd></div>
        <div><dt>{o.mSignals}</dt><dd>{r20.commercialSignals}</dd></div>
        <div><dt>{o.mPossible}</dt><dd>{r20.possibleClients.length} / {r20.targets.possibleClients} {t.mGoal}{r20.possibleClients.length ? ` — ${r20.possibleClients.map((c) => `${c.employer} (${c.signals.map(label).join(", ")})`).join("; ")}` : ""}</dd></div>
        <div><dt>{o.mConfirmed}</dt><dd>{r20.confirmedClients}</dd></div>
        <div><dt>{o.mStaff}</dt><dd>{r20.staffRequests}</dd></div>
        <div><dt>{t.mConversations}</dt><dd>{r20.conversations} · {r20.results}</dd></div>
        <div><dt>{o.mLevels}</dt><dd>{LEVELS.map((l) => `${o.level[l]} ${r20.levels[l]}`).join(" · ")}</dd></div>
        <div><dt>{o.mSuppliers}</dt><dd>{o.contactState(r20.supplierAnswerCounts.YES, r20.supplierAnswerCounts.NO, r20.supplierAnswerCounts.OWN_AGENCY_ONLY, r20.supplierAnswerCounts.NO_RESPONSE)}</dd></div>
        <div><dt>{t.mRestricted}</dt><dd>{r20.restrictedSources} {t.of} {r20.sources.length}</dd></div>
        <div><dt>{t.mDemo}</dt><dd>{r20.demoPostings}</dd></div>
      </dl>
      <p className={styles.boundaryNote}>{o.separation} {t.metricsNote}</p>

      <div id="priority-companies">
      {enterprise ? <article className={styles.priorityFocus} id="enterprise-investigation">
        <div className={styles.cardTop}><span className={styles.childBadge}>{t.priority} 1</span><span>{label(enterprise.effective.policy)}</span><span>{enterprise.platformLabel} · {o.activeRoute[enterprise.activeRoute]}</span></div>
        <h3>{t.enterpriseTitle}</h3>
        <p>{t.enterpriseLede}</p>
        <p className={styles.reasonLine}>{t.enterpriseStatus}</p>
        <ol>{t.enterpriseQuestions.map((q) => <li key={q}>{q}</li>)}</ol>
        <h4>{o.supplierTitle}</h4>
        <SupplierAnswerSummary locale={locale} answers={r20.supplierAnswers.enterprise ? [r20.supplierAnswers.enterprise] : []} />
        <ExternalSupplierAnswerForm locale={locale} catalogKey="enterprise" companyId={r20.priorityCompanies.enterprise ?? null} companyName={enterprise.name} />
        <div className={styles.safeActions}>
          <Link href={`?company=${encodeURIComponent(enterprise.name)}#register`}>{t.registerFor(enterprise.name)}</Link>
          {r20.priorityCompanies.enterprise ? <Link href={`/companies/${r20.priorityCompanies.enterprise}#commercial`}>{t.canonicalCompany} →</Link> : <span>{t.noCanonical}</span>}
          <Link href="/contacts">{t.openContacts}</Link><Link href="/opportunities/pursuits">{t.openPursuits}</Link>
        </div>
      </article> : null}

      <div className={styles.ledger}>{r20.sources.filter((s) => s.priority || s.wave === 1).sort((a, b) => (a.priority?.rank ?? 99) - (b.priority?.rank ?? 99) || a.wave - b.wave).map((s) => <article key={s.key}>
        <div className={styles.cardTop}><span className={styles.childBadge}>{s.priority ? `${t.priority} ${s.priority.rank}` : `${t.wave} ${s.wave}`}</span><span>{label(s.effective.policy)}</span><span>{s.platformLabel} · {label(s.preferredRoute)}</span></div>
        <h3>{s.name}</h3>
        <p>{s.priority ? t.priorityNotes[s.key] ?? s.priority.note : t.policyNotes[s.effective.policy] ?? s.effective.reason}</p>
        <small>{o.activeRoute[s.activeRoute]} · {s.review.state === "NOT_STARTED" ? t.reviewNotStarted : `${label(s.review.state)} · ${s.review.minutesElapsed} ${t.minSince}`}</small>
        {s.priority && s.key !== "enterprise" ? <><h4>{o.supplierTitle}</h4><SupplierAnswerSummary locale={locale} answers={r20.supplierAnswers[s.key] ? [r20.supplierAnswers[s.key]!] : []} />
          <ExternalSupplierAnswerForm locale={locale} catalogKey={s.key} companyId={r20.priorityCompanies[s.key] ?? null} companyName={s.name} /></> : null}
        {s.priority ? <div className={styles.safeActions}><Link href={`?company=${encodeURIComponent(s.name.replace(/\s*\(.*\)\s*$/, ""))}#register`}>{t.registerFor(s.name)}</Link>
          {r20.priorityCompanies[s.key] ? <Link href={`/companies/${r20.priorityCompanies[s.key]}#commercial`}>{t.canonicalCompany} →</Link> : null}</div> : null}
      </article>)}</div>
      </div>
    </section> : null}

    <section className={styles.metrics} aria-label={t.scorecard}>
      {([snapshot.metrics.uniqueObservations, snapshot.metrics.resolvedCanonical, snapshot.metrics.identifiedReview, snapshot.metrics.unresolved, snapshot.metrics.corroborated, snapshot.metrics.healthyWatchSources, snapshot.metrics.manualMisses] as const)
        .map((value, index) => <article key={t.metrics[index][0]}><small>{t.metrics[index][0]}</small><strong>{count(value)}</strong><span>{t.metrics[index][1]}</span></article>)}
    </section>

    <section className={styles.ownerSummary}>
      <div><p className="po-eyebrow">{t.ownerSummary}</p><h2>{t.observedIdentities(count(snapshot.metrics.uniqueObservations))}</h2>
        <p>{t.ownerLine(count(snapshot.metrics.resolvedCanonical), count(snapshot.metrics.identifiedReview), count(snapshot.metrics.unresolved))}</p></div>
      <div className={styles.summaryActions}><Link href="/companies">{t.reviewRegistry}</Link><Link href="/radar">{t.openRadar}</Link></div>
    </section>

    <nav className={styles.workflow} aria-label={t.workflowLabel}>
      {t.workflowSteps.map((step, index) => <span key={step}><b>{String(index + 1).padStart(2, "0")}</b>{step}</span>)}
    </nav>

    <section className={`${styles.panel} ${styles.marketPanel}`} id="market-signals">
      <header><div><p className="po-eyebrow">{t.marketEyebrow}</p><h2>{t.marketTitle}</h2></div><span>{label(snapshot.marketPressure.label)}</span></header>
      <p className={styles.marketWarning}>{t.marketWarning}</p>
      <div className={styles.marketGrid}>{snapshot.aggregateMarketSignals.map((signal) => <article key={signal.observationId}>
        <div className={styles.cardTop}><span className={styles.marketBadge}>{t.marketSignal}</span><span className={styles.health}>{label(signal.sourceRelationship)}</span></div>
        <p className={styles.marketLocation}>{signal.location ?? t.locationInTitle}</p><h3>{label(signal.level)} {label(signal.profession ?? "ELECTRICAL")}</h3>
        <div className={styles.quantitySplit}><div><small>{t.aggregateCount}</small><strong>{count(signal.count)}</strong></div><div><small>{t.employerHeadcount}</small><strong>{t.unknown}</strong></div></div>
        <dl><div><dt>{t.source}</dt><dd>{signal.domain}</dd></div><div><dt>{t.observed}</dt><dd>{date(signal.firstSeenAt)} → {date(signal.lastSeenAt)}</dd></div><div><dt>{t.decomposition}</dt><dd>{label(signal.decomposition.status)}</dd></div></dl>
        <div className={styles.decompositionBand}><div><small>{t.supportedPostings}</small><strong>{signal.decomposition.postingCount}</strong></div><div><small>{t.uniqueEmployers}</small><strong>{signal.decomposition.uniqueEmployerCount}</strong></div><div><small>{t.duplicatesSuppressed}</small><strong>{signal.decomposition.duplicateCount}</strong></div></div>
        <p className={styles.boundaryNote}>{signal.warning} {signal.decomposition.reason}</p>
        {signal.decomposition.children.length ? <div className={styles.childPostings}>{signal.decomposition.children.map((child) => <article key={child.identity}>
          <div className={styles.cardTop}><span className={styles.childBadge}>{label(child.relationship)}</span><span>{child.vendorAcceptance === "UNKNOWN" ? t.vendorUnknown : child.vendorAcceptance}</span></div>
          <h4><a href={child.normalizedUrl} target="_blank" rel="noreferrer">{child.title ?? t.postingTitleUnknown}</a></h4>
          <p>{child.employerName ?? t.employerUnknown} · {child.location ?? t.locationUnknown}</p>
          <dl><div><dt>{t.profession}</dt><dd>{child.profession ?? t.unknown}</dd></div><div><dt>{t.payPerDiem}</dt><dd>{child.pay ?? t.unknown} · {child.perDiem ?? t.unknown}</dd></div><div><dt>{t.headcount}</dt><dd>{child.explicitHeadcount ?? t.unknown}</dd></div><div><dt>{t.evidence}</dt><dd>{t.records(child.evidenceIds.length || child.provenance.length)}</dd></div></dl>
          <p className={styles.evidenceGaps}>{child.evidenceGaps.length ? child.evidenceGaps.map(label).join(" · ") : t.noGaps}</p>
          <Link href={child.reviewHref}>{t.governedReview}</Link>
        </article>)}</div> : <div className={styles.decompositionEmpty}><strong>{t.noChildTitle}</strong><p>{t.noChildBody}</p><Link href={`/radar/${signal.candidateId}`}>{t.openManual}</Link></div>}
        <a href={signal.url} target="_blank" rel="noreferrer">{t.inspectAggregate}</a>
      </article>)}</div>
    </section>

    <section className={styles.panel} id="review-queue">
      <header><div><p className="po-eyebrow">{t.workbenchEyebrow}</p><h2>{t.workbenchTitle}</h2></div><span>{t.observations(snapshot.reviewQueue.length)}</span></header>
      <div className={styles.workbench}>{snapshot.reviewQueue.map((item) => <article key={item.observationId}>
        <div className={styles.cardTop}><span className={styles.priority}>{label(item.priority)}</span><span className={styles.state}>{label(item.reviewState)}</span></div>
        <h3>{item.company}</h3><p>{item.title}</p>
        <dl className={styles.factGrid}><div><dt>{t.need}</dt><dd>{label(item.profession ?? "UNKNOWN")} · {label(item.level)}</dd></div><div><dt>{t.where}</dt><dd>{item.location ?? t.unknown}</dd></div><div><dt>{t.source}</dt><dd>{item.source} · {label(item.sourceRelationship)}</dd></div><div><dt>{t.quantity}</dt><dd>{label(item.quantity.type)}{item.quantity.value === null ? "" : ` · ${item.quantity.value}`}</dd></div><div><dt>{t.corroboration}</dt><dd>{item.corroboration}</dd></div><div><dt>{t.safeNext}</dt><dd>{item.nextAction}</dd></div></dl>
        <p className={styles.reasonLine}>{item.reasons.map(label).join(" · ")}</p>
        <div className={styles.safeActions}><Link href={`/radar/${item.candidateId}`}>{t.reviewEvidence}</Link><Link href="/companies">{t.linkCompanies}</Link><span>{t.defer}</span></div>
      </article>)}</div>
    </section>

    <section className={styles.pipeline} id="verified-demand">{t.pipeline.map(([a, b, c]) => <div key={a}><small>{a}</small><strong>{b}</strong><span>{c}</span></div>)}</section>

    <section className={styles.panel}>
      <header><div><p className="po-eyebrow">{t.concentrationEyebrow}</p><h2>{t.concentrationTitle}</h2></div><span>{t.groups(snapshot.companyDemand.length)}</span></header>
      <div className={styles.companyGrid}>{snapshot.companyDemand.map((group) => <article className={styles.companyCard} key={group.key}>
        <div className={styles.cardTop}><span className={`${styles.state} ${styles[`state${group.resolutionState}`] ?? ""}`}>{label(group.resolutionState)}</span><span className={styles.confidence}>{label(group.confidence)} {t.identity}</span></div>
        <h3>{group.canonicalCompanyId ? <Link href={`/companies/${group.canonicalCompanyId}`}>{group.displayName}</Link> : group.displayName}</h3>
        <p>{t.distinct(group.observationCount, group.sourceCount)}</p>
        <dl>
          <div><dt>{t.appearsToNeed}</dt><dd>{group.professions.map(label).join(", ") || t.unknown} · {group.levels.map(label).join(", ") || t.unknown}</dd></div>
          <div><dt>{t.where}</dt><dd>{group.locations.join(", ") || t.unknown}</dd></div>
          <div><dt>{t.sourceRelationship}</dt><dd>{group.sourceRelationships.map(label).join(", ") || t.unknown}</dd></div>
          <div><dt>{t.corroboration}</dt><dd>{group.corroboration} · {label(group.health)}</dd></div>
          <div><dt>{t.observed}</dt><dd>{date(group.firstSeenAt)} → {date(group.lastSeenAt)}</dd></div>
          <div><dt>{t.identityBasis}</dt><dd>{group.reasons.map(label).join(" · ")}</dd></div>
        </dl>
        <footer>{group.canonicalCompanyId ? <><strong>{t.linked}</strong>{group.hasContactIntelligence ? <span>{t.contactAvailable}</span> : null}</>
          : <><strong>{t.humanRequired}</strong><Link href="/companies">{t.reviewLink}</Link></>}</footer>
      </article>)}</div>
    </section>

    <section className={styles.panel}>
      <header><div><p className="po-eyebrow">{t.queueEyebrow}</p><h2>{t.queueTitle}</h2></div><span>{t.groupCount(review.length)}</span></header>
      <div className={styles.reviewQueue}>{review.map((group) => <article key={group.key}>
        <div><strong>{group.displayName}</strong><span>{label(group.resolutionState)} · {label(group.confidence)}</span></div>
        <p>{group.reasons.map(label).join(" · ")} · {t.observationCount(group.observationCount)}</p>
        <div className={styles.safeActions}><Link href="/companies">{t.linkExisting}</Link><span>{t.deferShort}</span><span>{t.keepUnresolved}</span></div>
      </article>)}</div>
    </section>

    <section className={styles.panel}>
      <header><div><p className="po-eyebrow">{t.obsEyebrow}</p><h2>{t.obsTitle}</h2></div><span>{t.unique(snapshot.observations.length)}</span></header>
      <div className={styles.observationList}>{snapshot.observations.map((item) => <article key={item.identity}>
        <div className={styles.cardTop}><span className={styles.state}>{label(item.resolution.state)}</span><span className={styles.health}>{label(item.watchState)}</span></div>
        <h3><a href={item.normalizedUrl} target="_blank" rel="noreferrer">{item.title}</a></h3>
        <p className={styles.companyLine}>{item.resolution.canonicalCompanyName ?? item.resolution.observedCompany ?? t.identityUnsupported} <small>· {label(item.resolution.confidence)} · {item.resolution.reasons.map(label).join(" / ")}</small></p>
        <dl className={styles.factGrid}>
          <div><dt>{t.professionOccupation}</dt><dd>{label(item.demand.profession ?? "UNKNOWN")} · {label(item.demand.occupation ?? "UNKNOWN")}</dd></div>
          <div><dt>{t.level}</dt><dd>{label(item.demand.level)}</dd></div><div><dt>{t.location}</dt><dd>{item.demand.location ?? t.unknown}</dd></div>
          <div><dt>{t.payPerDiem}</dt><dd>{item.demand.pay ?? t.unknown} · {item.demand.perDiem ?? t.unknown}</dd></div>
          <div><dt>{t.experienceCredentials}</dt><dd>{item.demand.experience ?? t.unknown} · {item.demand.credentials.join(", ") || t.unknown}</dd></div>
          <div><dt>{t.projectPublished}</dt><dd>{item.demand.project ?? t.unknown} · {date(item.demand.publishedAt)}</dd></div>
        </dl>
        <footer><span>{label(item.demand.sourceRelationship)} · {item.domain}</span><strong>{item.canonicalEvidence ? t.canonicalLinked : t.providerObservation}</strong></footer>
      </article>)}</div>
    </section>

    <div className={styles.columns}>
      <section className={styles.panel}><header><div><p className="po-eyebrow">{t.watchEyebrow}</p><h2>{t.watchTitle}</h2></div><span>{t.registered(snapshot.watches.length)}</span></header>
        <div className={styles.watchList}>{snapshot.watches.map((watch) => <article key={watch.id}><span className={`${styles.health} ${styles[`health${watch.health}`] ?? ""}`}>{label(watch.health)}</span>
          <h3>{watch.company ?? t.identityInsufficient}</h3><p>{label(watch.resolutionState)} · {label(watch.resolutionReason)}</p>
          <small>{label(watch.sourceType)}{watch.platform ? ` · ${watch.platform}` : ""} · {t.lastSuccessful} {date(watch.lastSuccessfulAt)}</small></article>)}</div>
      </section>
      <section className={styles.panel}><header><div><p className="po-eyebrow">{t.relEyebrow}</p><h2>{t.relTitle}</h2></div><span>{t.notBuyer}</span></header>
        <div className={styles.relationships}>{Object.entries(snapshot.sourceRelationships).map(([name, value]) => <div key={name}><span>{label(name)}</span><strong>{value}</strong></div>)}</div>
        <p className={styles.boundaryNote}>{t.relNote}</p>
      </section>
    </div>

    <details className={styles.technical}><summary>{t.technical}</summary><div className={styles.columns}>
      <section className={styles.panel}><header><div><p className="po-eyebrow">{t.recipes}</p><h2>{t.configured}</h2></div></header>{snapshot.recipes.map((recipe) => <p key={recipe.key}><strong>{recipe.name}</strong> · {recipe.executions} {t.executions} · {recipe.observations} {t.candidateRows}</p>)}</section>
      <section className={styles.panel}><header><div><p className="po-eyebrow">{t.ledger}</p><h2>{t.recent}</h2></div></header>{snapshot.recentExecutions.map((item) => <p key={item.id}><strong>{label(item.status)}</strong> · {item.results} {t.results} · {item.query}</p>)}</section>
    </div></details>

    <section className={styles.guardrails}><h2>{t.boundaries}</h2><div>{t.guardrails.map(([a, b]) => <article key={a}><strong>{a}</strong><p>{b}</p></article>)}</div></section>
    <section className={styles.panel}><header><div><p className="po-eyebrow">{t.learningEyebrow}</p><h2>{t.learningTitle}</h2></div><span>{t.learningNote}</span></header><div className={styles.form}><ManualMissForm locale={locale} /></div></section>
  </div>;
}
