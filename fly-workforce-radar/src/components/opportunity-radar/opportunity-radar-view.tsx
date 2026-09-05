import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import type { DictionaryKey } from "../../i18n/dictionary-shape";
import { t } from "../../i18n/translate";
import type { OpportunityRadarItem } from "../../server/read-models/opportunity-radar";
import { opportunityRadarHref, radarAcceptanceState, radarCommercialState, type OpportunityRadarPageResult, type OpportunityRadarQuery } from "../../server/opportunity-radar/get-opportunity-radar-page";
import { CurrentnessBadge, TrustState } from "../ui/status-primitives";
import { ErrorState, PageHeader } from "../ui/foundation";

export function OpportunityRadarView({ locale, query, result }: { readonly locale: Locale; readonly query: OpportunityRadarQuery; readonly result: OpportunityRadarPageResult }) {
  return <div className="page-stack opportunity-radar-view">
    <PageHeader eyebrow={t(locale, "opportunityRadar.eyebrow")} title={t(locale, "routes.opportunities.title")} description={t(locale, "routes.opportunities.description")} marker={t(locale, `capabilityState.${result.capability}`)} locale={locale} />
    <RadarFilters locale={locale} query={query} />
    {result.capability === "UNKNOWN" ? <ErrorState locale={locale} title={t(locale,"opportunityRadar.queryErrorTitle")} description={t(locale,"opportunityRadar.queryErrorDescription")} /> : result.capability !== "OPERATIONAL" ? <CapabilityUnavailable locale={locale} /> : result.filteredCount === 0 && hasActiveFilters(query) ? <RadarEmpty locale={locale} filtered /> : result.filteredCount === 0 ? <RadarEmpty locale={locale} filtered={false} /> : <>
      <div className="radar-result-bar"><span>{t(locale, "opportunityRadar.results", { count: String(result.filteredCount) })}</span><span>{t(locale, "opportunityRadar.page", { page: String(Math.min(query.page, result.pageCount ?? 1)), pages: String(result.pageCount) })}</span></div>
      <RadarTable locale={locale} items={result.pageItems} />
      <RadarPagination locale={locale} query={query} pageCount={result.pageCount ?? 1} />
    </>}
  </div>;
}

function RadarFilters({ locale, query }: { locale: Locale; query: OpportunityRadarQuery }) {
  return <form className="radar-filters" action="/opportunities" method="get" aria-label={t(locale, "opportunityRadar.filtersLabel")}>
    <label className="radar-search"><span>{t(locale, "opportunityRadar.searchLabel")}</span><input name="q" type="search" defaultValue={query.search} placeholder={t(locale, "opportunityRadar.searchPlaceholder")} /></label>
    <RadarSelect name="sort" label={t(locale, "opportunityRadar.sortLabel")} value={query.sort} options={["company", "project"]} locale={locale} prefix="sortOption" />
    <div className="radar-filter-actions"><button type="submit">{t(locale, "opportunityRadar.applyFilters")}</button><Link href="/opportunities">{t(locale, "opportunityRadar.clearFilters")}</Link></div>
  </form>;
}

function RadarSelect({ name, label, value, options, locale, prefix }: { name: string; label: string; value: string; options: readonly string[]; locale: Locale; prefix: string }) {
  return <label><span>{label}</span><select name={name} defaultValue={value}>{options.map(option => <option key={option} value={option}>{t(locale, `opportunityRadar.${prefix}.${option}` as DictionaryKey)}</option>)}</select></label>;
}

function RadarTable({ locale, items }: { locale: Locale; items: readonly OpportunityRadarItem[] }) {
  const columns = ["company", "project", "location", "trade", "demand", "acceptance", "buyerRoute", "verification", "currentness", "commercialStatus"] as const;
  return <div className="radar-table-shell"><table className="radar-table"><thead><tr>{columns.map(column => <th key={column} scope="col">{t(locale, `opportunityRadar.column.${column}`)}</th>)}</tr></thead><tbody>{items.map(item => <RadarRow key={item.opportunityId} locale={locale} item={item} />)}</tbody></table></div>;
}

function RadarRow({ locale, item }: { locale: Locale; item: OpportunityRadarItem }) {
  const fallback = t(locale, "opportunityRadar.unavailableValue");
  const acceptance = radarAcceptanceState(item), commercial = radarCommercialState(item);
  const labels = { company: t(locale, "opportunityRadar.column.company"), project: t(locale, "opportunityRadar.column.project"), location: t(locale, "opportunityRadar.column.location"), trade: t(locale, "opportunityRadar.column.trade"), demand: t(locale, "opportunityRadar.column.demand"), acceptance: t(locale, "opportunityRadar.column.acceptance"), buyerRoute: t(locale, "opportunityRadar.column.buyerRoute"), verification: t(locale, "opportunityRadar.column.verification"), currentness: t(locale, "opportunityRadar.column.currentness"), commercialStatus: t(locale, "opportunityRadar.column.commercialStatus") };
  return <tr>
    <td data-label={labels.company}><Link className="radar-primary-link" href={`/opportunities/${encodeURIComponent(item.opportunityId)}`}>{item.companyName ?? fallback}<span>{t(locale, "opportunityRadar.openOpportunity")}</span></Link></td>
    <td data-label={labels.project}><strong>{item.title ?? fallback}</strong>{item.projectRef ? <small>{item.projectRef}</small> : null}</td>
    <td data-label={labels.location}>{item.location ?? fallback}</td>
    <td data-label={labels.trade}>{item.tradeId ?? item.occupationId ?? fallback}</td>
    <td data-label={labels.demand}>{item.lifecycle}</td>
    <td data-label={labels.acceptance}><span className={`radar-state radar-state-${acceptance}`}>{t(locale, `opportunityRadar.acceptanceOption.${acceptance}`)}</span></td>
    <td data-label={labels.buyerRoute}>{item.bestContactRouteGrade ?? (item.vendorRouteState ? <TrustState state={item.vendorRouteState} locale={locale} /> : fallback)}</td>
    <td data-label={labels.verification}><TrustState state={item.verificationState} locale={locale} /></td>
    <td data-label={labels.currentness}><CurrentnessBadge state={item.currentness} locale={locale} /></td>
    <td data-label={labels.commercialStatus}>{item.readiness ? <span className={`radar-state radar-state-${commercial}`}>{t(locale, `opportunityRadar.statusOption.${commercial}`)}</span> : fallback}</td>
  </tr>;
}

function RadarPagination({ locale, query, pageCount }: { locale: Locale; query: OpportunityRadarQuery; pageCount: number }) {
  const page = Math.min(query.page, pageCount);
  return <nav className="radar-pagination" aria-label={t(locale, "opportunityRadar.paginationLabel")}><Link aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} href={opportunityRadarHref(query, { page: Math.max(1, page - 1) })}>{t(locale, "opportunityRadar.previous")}</Link><span>{t(locale, "opportunityRadar.page", { page: String(page), pages: String(pageCount) })}</span><Link aria-disabled={page >= pageCount} tabIndex={page >= pageCount ? -1 : undefined} href={opportunityRadarHref(query, { page: Math.min(pageCount, page + 1) })}>{t(locale, "opportunityRadar.next")}</Link></nav>;
}
function RadarEmpty({ locale, filtered }: { locale: Locale; filtered: boolean }) { return <section className="radar-state-panel"><p className="overline">{t(locale, "opportunityRadar.emptyOverline")}</p><h2>{t(locale, filtered ? "opportunityRadar.noResultsTitle" : "opportunityRadar.noOpportunitiesTitle")}</h2><p>{t(locale, filtered ? "opportunityRadar.noResultsDescription" : "opportunityRadar.noOpportunitiesDescription")}</p>{filtered ? <Link href="/opportunities">{t(locale, "opportunityRadar.clearFilters")}</Link> : null}</section>; }
function CapabilityUnavailable({ locale }: { locale: Locale }) { return <section className="radar-state-panel radar-capability-unavailable"><p className="overline">{t(locale, "opportunityRadar.capabilityOverline")}</p><h2>{t(locale, "opportunityRadar.capabilityTitle")}</h2><p>{t(locale, "opportunityRadar.capabilityDescription")}</p><span className="radar-boundary-note">{t(locale, "opportunityRadar.capabilityBoundary")}</span></section>; }
function hasActiveFilters(query: OpportunityRadarQuery): boolean { return !!query.search || query.state !== "all" || query.verification !== "all" || query.acceptance !== "all" || query.currentness !== "all"; }
