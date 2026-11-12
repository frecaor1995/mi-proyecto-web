import Link from "next/link";
import { resolveServerLocale } from "../../i18n/server-locale";
import { authorizeOperator } from "../../server/auth/authorization";
import { getOpportunitySearchStatus } from "../../server/opportunity-search/get-opportunity-search-status";
import { getDiscoveryRefreshStatus } from "../../server/opportunity-search/get-discovery-refresh-status";
import { isSignalFreshness, isSignalStatus, loadProfessionOverview, loadSignals } from "../../server/opportunity-discovery/signals";
import { findTradeCategory, isGeographyTier, isSignalCategory } from "../../domain/discovery-coverage";
import { OpportunitySearchPanel } from "../../components/opportunity-radar/opportunity-search-panel";
import { SignalList } from "../../components/opportunity-discovery/signal-list";
import { DiscoveryRefreshPanel, SignalFilterBar } from "../../components/opportunity-discovery/discovery-refresh";
import { ProfessionGrid, ProfessionResults } from "../../components/opportunity-discovery/profession-explorer";
import { discoveryCopy } from "../../components/opportunity-discovery/discovery-copy";

export default async function RadarPage({ searchParams = Promise.resolve({}) }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = await searchParams;
  const status = isSignalStatus(params.status) ? params.status : null;
  const trade = typeof params.trade === "string" ? findTradeCategory(params.trade) : null;
  const tier = isGeographyTier(params.tier) ? params.tier : null;
  const category = isSignalCategory(params.category) ? params.category : null;
  const freshness = isSignalFreshness(params.freshness) ? params.freshness : null;
  const occupation = trade && typeof params.occupation === "string" && trade.occupations.some((item) => item.id === params.occupation) ? params.occupation : null;
  // The mixed list is secondary: only an explicit request (or a legacy link carrying list filters) opens it.
  const mixed = !trade && (params.view === "all" || Boolean(status || params.scope || tier || category));
  const scope = params.scope === "historical" ? "HISTORICAL" as const : "LATEST" as const;

  const [locale, authorization, searchStatus, refresh, overview] = await Promise.all([
    resolveServerLocale(), authorizeOperator("company_discovery.run"), getOpportunitySearchStatus(), getDiscoveryRefreshStatus(), loadProfessionOverview(),
  ]);
  const mode = params.view === "raw" ? "RAW" as const : "QUALIFIED" as const;
  const signals = trade
    ? await loadSignals(status, "ALL", { trade: trade.id, occupation, tier, category, freshness, qualifiedOnly: mode === "QUALIFIED", statusRequested: Boolean(status) })
    : mixed ? await loadSignals(status, scope, { tier, category }) : null;
  const c = discoveryCopy(locale);
  const authorized = authorization.state === "AUTHORIZED";
  const mixedFilters = { trade: null, tier, category };
  const mixedParams: Record<string, string> = { ...(tier ? { tier } : {}), ...(category ? { category } : {}) };
  const baseParams: Record<string, string> = { view: "all", ...(status ? { status } : {}), ...(scope === "HISTORICAL" ? { scope: "historical" } : {}) };

  return (
    <div className="page-stack">
      <header className="app-page-header">
        <p className="po-eyebrow">{c.radarEyebrow}</p>
        <h1>{c.radarTitle}</h1>
        <p>{c.radarLede}</p>
      </header>
      {trade && signals ? (
        <ProfessionResults locale={locale} trade={trade} result={signals} overview={overview} mode={mode} filters={{ occupation, tier, category, freshness, status }} />
      ) : mixed && signals ? (
        <>
          <Link className="sig-back" href="/radar">← {c.explorer.allProfessions}</Link>
          <SignalFilterBar locale={locale} filters={mixedFilters} baseParams={baseParams} />
          <SignalList locale={locale} result={signals} active={status} scope={scope} filterParams={{ view: "all", ...mixedParams }} />
        </>
      ) : (
        <>
          <ProfessionGrid locale={locale} overview={overview} />
          <p className="dr-note"><Link href="/radar?view=all">{c.explorer.viewMixed} →</Link></p>
        </>
      )}
      <DiscoveryRefreshPanel locale={locale} status={refresh} authorized={authorized}>
        <OpportunitySearchPanel locale={locale} authorized={authorized} status={searchStatus} />
      </DiscoveryRefreshPanel>
    </div>
  );
}
