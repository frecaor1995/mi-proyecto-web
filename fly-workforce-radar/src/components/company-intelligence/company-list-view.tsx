import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import type { CompanyListItem } from "../../server/read-models/company-detail";
import { companyListHref, type CompanyListQuery, type CompanyListResult } from "../../server/company-intelligence/get-company-intelligence";
import { CurrentnessBadge, TrustState } from "../ui/status-primitives";
import { ErrorState, PageHeader } from "../ui/foundation";

export function CompanyIntelligenceListView({ locale, query, result }: { readonly locale: Locale; readonly query: CompanyListQuery; readonly result: CompanyListResult }) {
  return (
    <div className="page-stack company-list-view">
      <PageHeader eyebrow={t(locale, "companyIntelligence.eyebrow")} title={t(locale, "routes.companies.title")} description={t(locale, "routes.companies.description")} marker={t(locale, `capabilityState.${result.capability}`)} locale={locale} />
      <ListFilters locale={locale} query={query} />
      {result.capability === "UNKNOWN" ? (
        <ErrorState locale={locale} title={t(locale, "companyIntelligence.queryErrorTitle")} description={t(locale, "companyIntelligence.queryErrorDescription")} />
      ) : result.capability !== "OPERATIONAL" ? (
        <CapabilityUnavailable locale={locale} />
      ) : result.total === 0 ? (
        <ListEmpty locale={locale} filtered={!!query.search} />
      ) : (
        <>
          <div className="radar-result-bar">
            <span>{t(locale, "companyIntelligence.results", { count: String(result.total) })}</span>
            <span>{t(locale, "companyIntelligence.page", { page: String(Math.min(query.page, result.pageCount ?? 1)), pages: String(result.pageCount ?? 1) })}</span>
          </div>
          <ListTable locale={locale} items={result.items} />
          <ListPagination locale={locale} query={query} pageCount={result.pageCount ?? 1} />
        </>
      )}
    </div>
  );
}

function ListFilters({ locale, query }: { locale: Locale; query: CompanyListQuery }) {
  return (
    <form className="radar-filters" action="/companies" method="get" aria-label={t(locale, "companyIntelligence.filtersLabel")}>
      <label className="radar-search">
        <span>{t(locale, "companyIntelligence.searchLabel")}</span>
        <input name="q" type="search" defaultValue={query.search} placeholder={t(locale, "companyIntelligence.searchPlaceholder")} />
      </label>
      <div className="radar-filter-actions">
        <button type="submit">{t(locale, "companyIntelligence.applyFilters")}</button>
        <Link href="/companies">{t(locale, "companyIntelligence.clearFilters")}</Link>
      </div>
    </form>
  );
}

function ListTable({ locale, items }: { locale: Locale; items: readonly CompanyListItem[] }) {
  const columns = ["company", "opportunities", "contactRoute", "manpowerAcceptance", "verification", "currentness", "nextStep"] as const;
  return (
    <div className="radar-table-shell">
      <table className="radar-table">
        <thead>
          <tr>{columns.map((column) => <th key={column} scope="col">{t(locale, `companyIntelligence.column.${column}`)}</th>)}</tr>
        </thead>
        <tbody>{items.map((item) => <ListRow key={item.companyId} locale={locale} item={item} />)}</tbody>
      </table>
    </div>
  );
}

function ListRow({ locale, item }: { locale: Locale; item: CompanyListItem }) {
  const fallback = t(locale, "companyIntelligence.unavailableValue");
  const labels = {
    company: t(locale, "companyIntelligence.column.company"),
    opportunities: t(locale, "companyIntelligence.column.opportunities"),
    contactRoute: t(locale, "companyIntelligence.column.contactRoute"),
    manpowerAcceptance: t(locale, "companyIntelligence.column.manpowerAcceptance"),
    verification: t(locale, "companyIntelligence.column.verification"),
    currentness: t(locale, "companyIntelligence.column.currentness"),
    nextStep: t(locale, "companyIntelligence.column.nextStep"),
  };
  return (
    <tr>
      <td data-label={labels.company}>
        <Link className="radar-primary-link" href={`/companies/${encodeURIComponent(item.companyId)}`}>
          {item.displayName ?? fallback}
          <span>{t(locale, "companyIntelligence.openCompany")}</span>
        </Link>
      </td>
      <td data-label={labels.opportunities}>{item.relatedOpportunityCount}</td>
      <td data-label={labels.contactRoute}>{item.contactRouteCount === 0 ? fallback : <TrustState state={item.hasVerifiedContactRoute ? "VERIFIED" : "UNVERIFIED"} locale={locale} />}</td>
      <td data-label={labels.manpowerAcceptance}>{item.manpowerTrustState ? <TrustState state={item.manpowerTrustState} locale={locale} /> : fallback}</td>
      <td data-label={labels.verification}>{item.pendingVerificationCount}</td>
      <td data-label={labels.currentness}><CurrentnessBadge state={item.currentness} locale={locale} /></td>
      <td data-label={labels.nextStep}>{item.primaryGap ? t(locale, `companyDetail.gap.${item.primaryGap}`) : fallback}</td>
    </tr>
  );
}

function ListPagination({ locale, query, pageCount }: { locale: Locale; query: CompanyListQuery; pageCount: number }) {
  const page = Math.min(query.page, pageCount);
  return (
    <nav className="radar-pagination" aria-label={t(locale, "companyIntelligence.paginationLabel")}>
      <Link aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} href={companyListHref(query, { page: Math.max(1, page - 1) })}>{t(locale, "companyIntelligence.previous")}</Link>
      <span>{t(locale, "companyIntelligence.page", { page: String(page), pages: String(pageCount) })}</span>
      <Link aria-disabled={page >= pageCount} tabIndex={page >= pageCount ? -1 : undefined} href={companyListHref(query, { page: Math.min(pageCount, page + 1) })}>{t(locale, "companyIntelligence.next")}</Link>
    </nav>
  );
}

function ListEmpty({ locale, filtered }: { locale: Locale; filtered: boolean }) {
  return (
    <section className="radar-state-panel">
      <p className="overline">{t(locale, "companyIntelligence.emptyOverline")}</p>
      <h2>{t(locale, filtered ? "companyIntelligence.noResultsTitle" : "companyIntelligence.noCompaniesTitle")}</h2>
      <p>{t(locale, filtered ? "companyIntelligence.noResultsDescription" : "companyIntelligence.noCompaniesDescription")}</p>
      {filtered ? <Link href="/companies">{t(locale, "companyIntelligence.clearFilters")}</Link> : null}
    </section>
  );
}

function CapabilityUnavailable({ locale }: { locale: Locale }) {
  return (
    <section className="radar-state-panel radar-capability-unavailable">
      <p className="overline">{t(locale, "companyIntelligence.capabilityOverline")}</p>
      <h2>{t(locale, "companyIntelligence.capabilityTitle")}</h2>
      <p>{t(locale, "companyIntelligence.capabilityDescription")}</p>
      <span className="radar-boundary-note">{t(locale, "companyIntelligence.capabilityBoundary")}</span>
    </section>
  );
}
