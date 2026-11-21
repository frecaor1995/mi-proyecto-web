import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import { DISCOVERY_GEOGRAPHIES, DISCOVERY_TRADE_CATEGORIES, GEOGRAPHY_TIERS, SIGNAL_CATEGORIES, type GeographyTier, type SignalCategory } from "../../domain/discovery-coverage";
import type { DiscoveryRefreshStatus } from "../../server/opportunity-search/get-discovery-refresh-status";
import { discoveryCopy } from "./discovery-copy";
import { DiscoveryCycleForm } from "./discovery-cycle-form";

const when = (locale: Locale, value: string | null | undefined) => (value ? formatDate(locale, new Date(value), { dateStyle: "medium", timeStyle: "short" }) : "—");

/**
 * Refresh controls: a compact always-visible bar (last success, next scheduled, whether automatic execution is
 * confirmed, manual cycle) and one collapsible diagnostics section so diagnostics never dominate the explorer.
 */
export function DiscoveryRefreshPanel({ locale, status, authorized, children }: { readonly locale: Locale; readonly status: DiscoveryRefreshStatus; readonly authorized: boolean; readonly children?: ReactNode }) {
  const c = discoveryCopy(locale).multi;
  const x = discoveryCopy(locale).explorer;
  const profile = status.profile?.enabled ? status.profile : null;
  const queries = status.latestQueries;
  const failed = queries.filter((query) => query.status !== "COMPLETED").length;
  const fresh = queries.reduce((sum, query) => sum + query.newCount, 0);
  const found = status.latestCycle?.findingsCount ?? 0;
  const cells = new Map(status.coverage.map((cell) => [`${cell.tradeCategory}:${cell.signalCategory}`, cell]));
  const overdue = status.nextRunOverdue;
  return (
    <section className="dr-panel" aria-label={c.title}>
      <div className="dr-bar">
        <dl>
          <div><dt>{x.configuredFrequency}</dt><dd>{profile ? c.every(profile.cadenceHours) : c.scheduleOff}</dd></div>
          <div><dt>{x.nextDue}</dt><dd>{profile ? `${when(locale, profile.nextRunAt)}${overdue ? ` · ${c.due}` : ""}` : c.scheduleOff}</dd></div>
          <div><dt>{x.lastScheduled}</dt><dd>{status.lastScheduledCycle ? `${when(locale, status.lastScheduledCycle.startedAt)} · ${status.lastScheduledCycle.status}` : c.neverScheduled}</dd></div>
          <div><dt>{x.lastManual}</dt><dd>{status.lastManualCycle ? `${when(locale, status.lastManualCycle.startedAt)} · ${status.lastManualCycle.status}` : "—"}</dd></div>
          <div><dt>{x.lastSuccessful}</dt><dd>{when(locale, status.lastSuccessfulRefreshAt)}</dd></div>
          <div><dt>{x.automatic}</dt><dd title={status.automaticConfirmed ? undefined : x.autoNotConfirmedHint} className={status.automaticConfirmed ? "dr-run-ok" : "dr-run-warn"}>{status.automaticConfirmed ? x.autoConfirmed : x.autoNotConfirmed}</dd></div>
        </dl>
        <DiscoveryCycleForm locale={locale} authorized={authorized} providerConfigured={status.providerConfigured} />
      </div>
      {status.automaticConfirmed ? null : <p className="dr-note">{x.autoNotConfirmedHint} {status.schedulerSecretConfigured ? x.secretPresent : x.secretMissing}</p>}
      <p className="dr-note">{x.budget(profile?.queriesPerCycle ?? null, profile?.cadenceHours ?? null)}{status.providerQuota ? ` ${x.quota(status.providerQuota.monthlyRemaining, status.providerQuota.monthlyLimit, status.providerQuota.perSecondLimit, when(locale, status.providerQuota.observedAt))}` : ` ${x.quotaUnknown}`}</p>
      <details className="dr-details">
      <summary>{x.diagnostics}</summary>
      <article className="sig-run-summary">
        <div>
          <p className="po-eyebrow">{c.title}</p>
          <h2>{c.frequency}: {profile ? c.every(profile.cadenceHours) : c.scheduleOff}</h2>
          <p>{c.lede}</p>
        </div>
        <dl>
          <div><dt>{c.lastSuccess}</dt><dd>{when(locale, status.lastSuccessfulRefreshAt)}</dd></div>
          <div><dt>{c.nextScheduled}</dt><dd>{profile ? `${when(locale, profile.nextRunAt)}${overdue ? ` · ${c.due}` : ""}` : c.scheduleOff}</dd></div>
          <div><dt>{c.lastScheduled}</dt><dd>{status.lastScheduledCycle ? `${when(locale, status.lastScheduledCycle.startedAt)} · ${status.lastScheduledCycle.status}` : c.neverScheduled}</dd></div>
          <div><dt>{c.providerStatus}</dt><dd>{status.providerConfigured ? c.configured : c.notConfigured}{profile?.queriesPerCycle ? ` · ${c.queriesPerCycle(profile.queriesPerCycle)}` : ""}</dd></div>
        </dl>
        <div className="sig-run-metrics">
          <strong>{status.latestCycle ? `${c.trigger[status.latestCycle.trigger]} · ${when(locale, status.latestCycle.startedAt)}` : c.never}</strong>
          <span>{c.newFindings}: {fresh}</span><span>{c.rediscovered}: {Math.max(0, found - fresh)}</span><span>{c.failedSearches}: {failed}</span>
          <span>{c.searches}: {queries.length}</span>
        </div>
      </article>
      <p className="dr-note">{c.schedulerNote}</p>

      <div className="dr-block">
        <h3>{c.coverage} · {c.gaps(status.gaps, status.totalCells)}</h3>
        <p className="dr-note">{c.coverageLede}</p>
        <div className="dr-table-wrap">
          <table className="dr-table">
            <thead><tr><th scope="col">{c.filters.trade}</th>{SIGNAL_CATEGORIES.map((category) => <th scope="col" key={category}>{c.category[category]}</th>)}</tr></thead>
            <tbody>{DISCOVERY_TRADE_CATEGORIES.map((trade) => (
              <tr key={trade.id}><th scope="row">{trade.label}</th>{SIGNAL_CATEGORIES.map((category) => {
                const cell = cells.get(`${trade.id}:${category}`);
                return <td key={category} className={cell?.lastSearchedAt ? "" : "dr-gap"}>{cell?.lastSearchedAt ? formatDate(locale, new Date(cell.lastSearchedAt), { dateStyle: "short" }) : c.never}{cell?.failures ? ` · ${cell.failures}✕` : ""}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
        <p className="dr-note"><strong>{c.geographies}:</strong> {DISCOVERY_GEOGRAPHIES.map((geo) => `${geo.label} (${status.geographyLastSearched.get(geo.id) ? formatDate(locale, new Date(status.geographyLastSearched.get(geo.id)!), { dateStyle: "short" }) : c.never})`).join(" · ")}</p>
      </div>

      {queries.length ? (
        <div className="dr-block">
          <h3>{c.latestQueries} · {queries.length}</h3>
          <div className="dr-table-wrap">
            <table className="dr-table">
              <thead><tr><th scope="col">#</th><th scope="col">{c.query}</th><th scope="col">{c.filters.trade}</th><th scope="col">{c.filters.geography}</th><th scope="col">{c.filters.category}</th><th scope="col">{c.status}</th></tr></thead>
              <tbody>{queries.map((query) => (
                <tr key={query.position}>
                  <td>{query.position}</td><td>{query.query}</td>
                  <td>{query.company ? `${c.watched}: ${query.company}` : DISCOVERY_TRADE_CATEGORIES.find((trade) => trade.id === query.tradeCategory)?.label ?? "—"}</td>
                  <td>{DISCOVERY_GEOGRAPHIES.find((geo) => geo.id === query.geographyId)?.label ?? query.geographyId}</td>
                  <td>{c.category[query.signalCategory] ?? query.signalCategory}</td>
                  <td className={query.status === "COMPLETED" ? "" : "dr-gap"}>{c.queryStatus[query.status]}{query.status === "COMPLETED" ? ` · ${c.results(query.resultCount, query.newCount)}` : query.failure ? ` · ${query.failure.replaceAll("_", " ")}` : ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ) : null}
      {children}
      </details>
    </section>
  );
}

export interface SignalFilterState {
  readonly trade: string | null;
  readonly tier: GeographyTier | null;
  readonly category: SignalCategory | null;
}

/** Trade, geography and signal-type filters. Each keeps the other active filters, status and scope. */
export function SignalFilterBar({ locale, filters, baseParams }: { readonly locale: Locale; readonly filters: SignalFilterState; readonly baseParams: Record<string, string> }) {
  const c = discoveryCopy(locale).multi;
  const href = (key: "trade" | "tier" | "category", value: string | null) => {
    const params = new URLSearchParams(baseParams);
    for (const [name, current] of Object.entries(filters)) if (current) params.set(name, current);
    if (value) params.set(key, value); else params.delete(key);
    return `/radar${params.size ? `?${params}` : ""}`;
  };
  const row = (key: "trade" | "tier" | "category", label: string, options: readonly (readonly [string, string])[]) => (
    <nav className="sig-filters dr-filters" aria-label={label}>
      <span className="dr-filter-label">{label}</span>
      <Link href={href(key, null)} className={filters[key] ? "" : "is-active"} aria-current={filters[key] ? undefined : "page"}>{c.filters.all}</Link>
      {options.map(([value, text]) => <Link key={value} href={href(key, value)} className={filters[key] === value ? "is-active" : ""} aria-current={filters[key] === value ? "page" : undefined}>{text}</Link>)}
    </nav>
  );
  return (
    <div className="dr-filter-bar">
      {row("trade", c.filters.trade, DISCOVERY_TRADE_CATEGORIES.map((trade) => [trade.id, trade.label] as const))}
      {row("tier", c.filters.geography, GEOGRAPHY_TIERS.map((tier) => [tier, c.tier[tier]] as const))}
      {row("category", c.filters.category, SIGNAL_CATEGORIES.map((category) => [category, c.category[category]] as const))}
    </div>
  );
}
