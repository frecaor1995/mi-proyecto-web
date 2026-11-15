import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import { Icon } from "../ui/icon";
import { DISCOVERY_TRADE_CATEGORIES, GEOGRAPHY_TIERS, SIGNAL_CATEGORIES, type DiscoveryTradeCategory } from "../../domain/discovery-coverage";
import { SIGNAL_FRESHNESS, SIGNAL_STATUSES, type ProfessionOverview, type SignalFilters, type SignalListResult, type SignalStatus, type SignalSummary } from "../../server/opportunity-discovery/signals";
import { discoveryCopy } from "./discovery-copy";
import { SignalCard } from "./signal-list";

const tradeLabel = (trade: Pick<DiscoveryTradeCategory, "label" | "labelEs">, locale: Locale) => (locale === "es-US" ? trade.labelEs : trade.label);

/** Main Radar entry point: one card per configured profession family, counts from persisted signals only. */
export function ProfessionGrid({ locale, overview }: { readonly locale: Locale; readonly overview: ProfessionOverview }) {
  const x = discoveryCopy(locale).explorer;
  if (overview.state !== "READY") return <p className="po-empty">{discoveryCopy(locale).unavailable}</p>;
  const byTrade = new Map(overview.professions.map((profession) => [profession.tradeCategoryId, profession]));
  return (
    <section className="px-section" aria-labelledby="px-title">
      <header className="px-head">
        <h2 id="px-title">{x.title}</h2>
        <p>{x.lede}</p>
        <p className="dr-note"><strong>{x.totalsQualified(overview.totalUnique, overview.qualifiedTotal, overview.verifiedTotal)}</strong> · {x.totals(overview.totalUnique, overview.unclassified, overview.multiProfession)}</p>
      </header>
      <ul className="px-grid">
        {DISCOVERY_TRADE_CATEGORIES.map((trade) => {
          const counts = byTrade.get(trade.id);
          return (
            <li key={trade.id} className="px-card">
              <Link href={`/radar?trade=${trade.id}`} className="px-card-link">
                <span className="px-icon"><Icon name={trade.icon} /></span>
                <h3>{tradeLabel(trade, locale)}</h3>
                <dl className="px-stats">
                  <div className="px-stat-primary"><dt>{x.qualifiedSignals}</dt><dd>{counts?.qualified ?? 0}</dd></div>
                  <div><dt>{x.rawFindings}</dt><dd>{counts?.discovered ?? 0}</dd></div>
                  <div><dt>{x.humanVerified}</dt><dd>{counts?.verified ?? 0}</dd></div>
                </dl>
                <p className="px-last">{x.lastSearch}: <strong>{counts?.lastSuccessfulSearchAt ? formatDate(locale, new Date(counts.lastSuccessfulSearchAt), { dateStyle: "medium", timeStyle: "short" }) : x.neverSearched}</strong></p>
                <span className="button button-primary px-cta">{x.view} →</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type ExplorerFilters = Required<Pick<SignalFilters, "occupation" | "tier" | "category" | "freshness">> & { readonly status: SignalStatus | null };
export type ExplorerMode = "QUALIFIED" | "RAW";

/**
 * One profession. Default view = qualified commercial intelligence (human-reviewed, then primary commercial
 * review, then secondary investigation); the raw technical view lists every stored finding with its verdict.
 */
export function ProfessionResults({ locale, trade, filters, result, overview, mode = "QUALIFIED" }: {
  readonly locale: Locale; readonly trade: DiscoveryTradeCategory; readonly filters: ExplorerFilters; readonly result: SignalListResult;
  readonly overview: ProfessionOverview; readonly mode?: ExplorerMode;
}) {
  const c = discoveryCopy(locale);
  const x = c.explorer;
  const counts = overview.state === "READY" ? overview.professions.find((profession) => profession.tradeCategoryId === trade.id) : undefined;
  const base = `/radar?trade=${trade.id}${mode === "RAW" ? "&view=raw" : ""}`;
  const href = (key: keyof ExplorerFilters | "view", value: string | null, keepFilters = true) => {
    const params = new URLSearchParams({ trade: trade.id });
    if (keepFilters) for (const [name, current] of Object.entries(filters)) if (current) params.set(name, current);
    if (mode === "RAW") params.set("view", "raw");
    if (value) params.set(key, value); else params.delete(key);
    return `/radar?${params}`;
  };
  const active = Object.values(filters).some(Boolean);
  const row = (key: keyof ExplorerFilters, label: string, options: readonly (readonly [string, string])[], allLabel = x.all) => (
    <nav className="sig-filters dr-filters" aria-label={label}>
      <span className="dr-filter-label">{label}</span>
      <Link href={href(key, null)} className={filters[key] ? "" : "is-active"} aria-current={filters[key] ? undefined : "page"}>{allLabel}</Link>
      {options.map(([value, text]) => <Link key={value} href={href(key, value)} className={filters[key] === value ? "is-active" : ""} aria-current={filters[key] === value ? "page" : undefined}>{text}</Link>)}
    </nav>
  );
  const occupationLabel = (id: string) => { const occupation = trade.occupations.find((item) => item.id === id); return occupation ? (locale === "es-US" ? occupation.labelEs : occupation.label) : id; };
  const signals = result.state === "READY" ? result.signals : [];
  const total = result.state === "READY" ? result.filteredCount ?? signals.length : 0;
  const card = (signal: SignalSummary) => <SignalCard key={signal.candidateId} locale={locale} signal={signal} showQualification
    specialties={(signal.professions.find((profession) => profession.tradeCategoryId === trade.id)?.occupationIds ?? []).map(occupationLabel)} />;
  const groups = mode === "RAW" ? [] : [
    { id: "human", title: x.groupHuman, hint: x.groupHumanHint, items: signals.filter((signal) => signal.status !== "NEW") },
    { id: "primary", title: x.groupPrimary, hint: x.groupPrimaryHint, items: signals.filter((signal) => signal.status === "NEW" && signal.qualification.tier === "PRIMARY") },
    { id: "secondary", title: x.groupSecondary, hint: x.groupSecondaryHint, items: signals.filter((signal) => signal.status === "NEW" && signal.qualification.tier === "SECONDARY") },
  ].filter((group) => group.items.length > 0);
  return (
    <section className="px-section" aria-labelledby="px-trade-title">
      <Link className="sig-back" href="/radar">← {x.allProfessions}</Link>
      <header className="px-trade-head">
        <span className="px-icon"><Icon name={trade.icon} /></span>
        <div>
          <h2 id="px-trade-title">{tradeLabel(trade, locale)}</h2>
          {counts ? <p className="dr-note"><strong>{x.qualifiedSignals}: {counts.qualified}</strong> · {x.rawFindings}: {counts.discovered} · {x.humanVerified}: {counts.verified} · {x.lastSearch}: {counts.lastSuccessfulSearchAt ? formatDate(locale, new Date(counts.lastSuccessfulSearchAt), { dateStyle: "medium", timeStyle: "short" }) : x.neverSearched}</p> : null}
        </div>
      </header>
      <nav className="sig-scope-tabs" aria-label={x.commercialView}>
        <Link className={mode === "QUALIFIED" ? "is-active" : ""} href={`/radar?trade=${trade.id}`}>{x.commercialView}{counts ? ` · ${counts.qualified}` : ""}</Link>
        <Link className={mode === "RAW" ? "is-active" : ""} href={`/radar?trade=${trade.id}&view=raw`}>{x.rawView}{counts ? ` · ${counts.discovered}` : ""}</Link>
      </nav>
      {mode === "RAW" ? <p className="dr-note">{x.rawViewHint}</p> : null}
      <div className="dr-filter-bar">
        {row("occupation", x.specialty, trade.occupations.map((occupation) => [occupation.id, locale === "es-US" ? occupation.labelEs : occupation.label] as const), x.allSpecialties)}
        {row("tier", x.geography, GEOGRAPHY_TIERS.map((tier) => [tier, c.multi.tier[tier]] as const))}
        {row("category", x.signalType, SIGNAL_CATEGORIES.map((category) => [category, c.multi.category[category]] as const))}
        {row("freshness", x.freshness, SIGNAL_FRESHNESS.map((freshness) => [freshness, c.multi.freshness[freshness]] as const))}
        {row("status", x.verification, SIGNAL_STATUSES.map((status) => [status, c.status[status]] as const))}
      </div>
      <div className="px-results-bar">
        <p className="dr-note">{x.showing(signals.length, total)}</p>
        {active ? <Link className="button button-ghost" href={base}>{x.clear}</Link> : null}
      </div>
      {result.state !== "READY" ? <p className="po-empty">{c.unavailable}</p>
        : mode === "RAW" ? (signals.length ? <ul className="sig-grid">{signals.map(card)}</ul> : <Empty title={x.empty} hint={x.emptyHint} clear={active ? base : null} clearLabel={x.clear} />)
        : groups.length ? (
          <div className="sig-priority-groups">
            {groups.map((group, index) => (
              <section key={group.id} className={`sig-priority-group px-group-${group.id}`}>
                <header><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{group.title}</h2><p>{group.hint}</p></div><strong>{group.items.length}</strong></header>
                <ul className="sig-grid">{group.items.map(card)}</ul>
              </section>
            ))}
          </div>
        ) : <Empty title={active ? x.empty : x.noQualified} hint={active ? x.emptyHint : x.noQualifiedHint} clear={active ? base : null} clearLabel={x.clear}
            extra={<Link className="button button-secondary" href={`/radar?trade=${trade.id}&view=raw`}>{x.rawView} →</Link>} />}
    </section>
  );
}

function Empty({ title, hint, clear, clearLabel, extra }: { readonly title: string; readonly hint: string; readonly clear: string | null; readonly clearLabel: string; readonly extra?: ReactNode }) {
  return (
    <div className="po-empty px-empty">
      <h3>{title}</h3>
      <p>{hint}</p>
      <div className="px-empty-actions">{clear ? <Link className="button button-ghost" href={clear}>{clearLabel}</Link> : null}{extra}</div>
    </div>
  );
}
