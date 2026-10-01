import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import type { SignalListResult, SignalStatus, SignalSummary } from "../../server/opportunity-discovery/signals";
import { findTradeCategory } from "../../domain/discovery-coverage";
import { discoveryCopy } from "./discovery-copy";

const FILTERS: readonly (SignalStatus | "ALL")[] = ["ALL", "NEW", "NEEDS_REVIEW", "VERIFIED", "PROMOTED", "REJECTED"];

export function SignalStatusBadge({ locale, status }: { readonly locale: Locale; readonly status: SignalStatus }) {
  return <span className={`sig-status sig-status-${status.toLowerCase()}`} title={discoveryCopy(locale).statusHelp[status]}>{discoveryCopy(locale).status[status]}</span>;
}

export function SignalCard({ locale, signal, specialties, showQualification = false }: { readonly locale: Locale; readonly signal: SignalSummary; readonly specialties?: readonly string[]; readonly showQualification?: boolean }) {
  const c = discoveryCopy(locale);
  const q = signal.qualification;
  const verdict = !showQualification ? null : q.qualified
    ? <p className="dr-card-note dr-qualified"><strong>{c.explorer.qualifiedAs}: {c.explorer.commercialCategory[q.category ?? ""] ?? q.category}</strong>{q.organization ? ` · ${c.explorer.organization}: ${q.organization}` : ""}{q.project ? ` · ${c.explorer.project}: ${q.project}` : ""}</p>
    : <p className="dr-card-note dr-not-qualified"><strong>{c.explorer.excludedAs}:</strong> {q.noise ? c.explorer.noise[q.noise] : q.missing.map((item) => c.explorer.missing[item]).join(" · ")}</p>;
  const unknown = c.notFound;
  const evidence = [
    [c.company, Boolean(signal.company)], [c.location, Boolean(signal.location)], [c.workforceNeed, Boolean(signal.workforceNeed)],
    [c.pay, Boolean(signal.pay)], [c.facts.project, /project/i.test(`${signal.title} ${signal.description ?? ""}`)], [c.facts.contact, /contact|recruiter/i.test(signal.description ?? "")],
  ] as const;
  const missing = [[c.headcount, signal.headcount], [c.pay, signal.pay], [c.perDiem, signal.perDiem], [c.facts.contact, /contact|recruiter/i.test(signal.description ?? "") ? "found" : null]].filter(([, value]) => value == null).map(([label]) => label);
  return <li className="sig-card">
    <div className="sig-card-head"><span className={`sig-quality sig-quality-${signal.qualityGroup.toLowerCase()}`}>{c.quality[signal.qualityGroup]}</span><SignalStatusBadge locale={locale} status={signal.status} /><span className={`sig-kind sig-fresh-${signal.freshness.toLowerCase()}`} title={c.multi.freshnessHelp[signal.freshness]}>{c.multi.freshness[signal.freshness]}</span>{signal.signalCategory ? <span className="sig-kind" title={c.multi.categoryHelp[signal.signalCategory]}>{c.multi.category[signal.signalCategory]}</span> : <span className="sig-kind">{c.kind[signal.queryKind] ?? c.searchContext}</span>}</div>
    <p className="sig-company">{signal.company || unknown}</p>
    <Link className="sig-title" href={`/radar/${signal.candidateId}`}>{signal.title}</Link>
    <p className="sig-location">{signal.location ?? unknown}</p>
    {verdict}
    {specialties ? <p className="dr-card-note dr-specialties"><span>{c.explorer.specialtiesFound}:</span> {specialties.length ? specialties.join(" · ") : unknown}</p> : null}
    {signal.description ? <p className="sig-excerpt">{signal.description}</p> : null}
    <div className="sig-evidence-strip" aria-label={c.knowledgeTitle}>{evidence.map(([label, found]) => <span className={found ? "is-found" : "is-missing"} key={label}>{found ? "✓" : "○"} {label}</span>)}</div>
    <dl className="sig-commercial-facts"><div><dt>{c.workforceNeed}</dt><dd>{signal.workforceNeed ?? signal.trade ?? unknown}</dd></div>{signal.pay ? <div><dt>{c.pay}</dt><dd>{signal.pay}</dd></div> : null}{signal.headcount ? <div><dt>{c.headcount}</dt><dd>{signal.headcount}</dd></div> : null}{signal.perDiem ? <div><dt>{c.perDiem}</dt><dd>{signal.perDiem}</dd></div> : null}</dl>
    {signal.jobBoard ? <p className="sig-muted dr-card-note">{c.multi.jobBoard}</p> : null}
    {signal.tradeCategoryId && !signal.workforceTradeCode ? <p className="sig-muted dr-card-note">{c.multi.noTaxonomyTrade}</p> : null}
    {missing.length ? <p className="sig-missing"><strong>{locale === "es-US" ? "Información pendiente" : "Missing information"}</strong><span>{missing.join(" · ")}</span></p> : null}
    <div className="sig-source-line"><span>{c.source}</span><strong>{signal.domain}</strong><span>{c.discovered} {formatDate(locale, new Date(signal.lastDiscoveredAt))}</span>{signal.publicationDate ? <span>{c.multi.published} {formatDate(locale, new Date(signal.publicationDate))}</span> : null}<span>{signal.previouslySeen ? c.seenBefore : c.currentRun}</span></div>
    {signal.searchedAs ? <p className="sig-muted dr-card-note">{c.multi.searchedAs}: {signal.searchedAs.company ? `${c.multi.watched} ${signal.searchedAs.company} · ` : ""}{signal.searchedAs.signalCategory ? c.multi.category[signal.searchedAs.signalCategory] : ""}{signal.searchedAs.geographyTier ? ` · ${c.multi.tier[signal.searchedAs.geographyTier]}` : ""} — “{(signal.searchedAs.query ?? "").replace(/\s*-site:\S+/g, "")}”</p> : null}
    <div className="sig-card-actions"><Link className="button button-primary" href={`/radar/${signal.candidateId}`}>{c.openSignal}</Link><a className="button button-ghost" href={signal.url} target="_blank" rel="noreferrer noopener">{c.openSource} ↗</a>{signal.promotedOpportunityId ? <Link className="button button-secondary" href={`/opportunities/${signal.promotedOpportunityId}`}>{c.openOpportunity}</Link> : null}</div>
  </li>;
}

export function SignalList({ locale, result, active, scope = "LATEST", filterParams = {} }: { readonly locale: Locale; readonly result: SignalListResult; readonly active: SignalStatus | null; readonly scope?: "LATEST" | "HISTORICAL"; readonly filterParams?: Record<string, string> }) {
  const c = discoveryCopy(locale);
  if (result.state !== "READY") return <p className="po-empty">{c.unavailable}</p>;
  const scopeHref = (historical: boolean) => {
    const params = new URLSearchParams(filterParams);
    if (historical) params.set("scope", "historical");
    return `/radar${params.size ? `?${params}` : ""}`;
  };
  const statusHref = (filter: SignalStatus | "ALL") => {
    const params = new URLSearchParams(filterParams);
    if (filter !== "ALL") params.set("status", filter);
    if (scope === "HISTORICAL") params.set("scope", "historical");
    return `/radar${params.size ? `?${params}` : ""}`;
  };
  return <section className="sig-list-section" aria-label={c.radarTitle}>
    {result.latestRun ? <article className="sig-run-summary">
      <div><p className="po-eyebrow">{c.realDiscovery}</p><h2>{c.latestRun}</h2><p>{c.latestRunNote}</p></div>
      <dl><div><dt>{c.provider}</dt><dd>{result.latestRun.provider.replaceAll("_", " ")}</dd></div><div><dt>{c.target}</dt><dd>{result.latestRun.target}</dd></div><div><dt>{c.completed}</dt><dd>{formatDate(locale, new Date(result.latestRun.completedAt))}</dd></div></dl>
      <div className="sig-run-metrics"><strong>{c.findings(result.latestRun.findingsCount)}</strong><span>{c.newlySeen(result.latestRun.newlySeenCount)}</span><span>{c.rediscovered(result.latestRun.rediscoveredCount)}</span></div>
    </article> : null}
    <nav className="sig-scope-tabs" aria-label={c.realDiscovery}><Link className={scope === "LATEST" ? "is-active" : ""} href={scopeHref(false)}>{c.realDiscovery}{result.latestRun ? ` · ${result.latestRun.findingsCount}` : ""}</Link><Link className={scope === "HISTORICAL" ? "is-active" : ""} href={scopeHref(true)}>{c.historical}{result.latestRun ? ` · ${result.latestRun.historicalUniqueCount}` : ""}</Link><span title={c.noDemo}>{c.demoTest} · 0</span></nav>
    <nav className="sig-filters" aria-label={c.radarTitle}>{FILTERS.map((filter) => { const current = (filter === "ALL" && active === null) || filter === active; const count = filter === "ALL" ? result.counts.total : result.counts[filter]; return <Link key={filter} href={statusHref(filter)} className={current ? "is-active" : ""} aria-current={current ? "page" : undefined}>{c.status[filter]} <span>{count}</span></Link>; })}</nav>
    {Object.keys(filterParams).length && result.filteredCount !== undefined ? <p className="sig-muted dr-card-note">{result.filteredCount} · {Object.values(filterParams).map((value) => c.multi.category[value] ?? c.multi.tier[value] ?? findTradeCategory(value)?.label ?? value).join(" · ")}</p> : null}
    {result.signals.length ? <div className="sig-priority-groups">{(["READY_FOR_REVIEW", "NEEDS_MORE_EVIDENCE", "LOW_INFORMATION"] as const).map((quality) => {
      const signals = result.signals.filter((signal) => signal.qualityGroup === quality);
      if (!signals.length) return null;
      return <section key={quality} className={`sig-priority-group sig-priority-${quality.toLowerCase()}`}><header><span>{quality === "READY_FOR_REVIEW" ? "01" : quality === "NEEDS_MORE_EVIDENCE" ? "02" : "03"}</span><div><h2>{c.quality[quality]}</h2><p>{locale === "es-US" ? (quality === "READY_FOR_REVIEW" ? "Prioridad de revisión" : quality === "NEEDS_MORE_EVIDENCE" ? "Señales que requieren validación adicional" : "Información insuficiente para priorizar") : (quality === "READY_FOR_REVIEW" ? "Review priority" : quality === "NEEDS_MORE_EVIDENCE" ? "Signals requiring additional evidence" : "Not enough information to prioritize")}</p></div><strong>{signals.length}</strong></header><ul className="sig-grid">{signals.map((signal) => <SignalCard key={signal.candidateId} locale={locale} signal={signal} />)}</ul></section>;
    })}</div> : <p className="po-empty">{c.emptyList}</p>}
  </section>;
}
