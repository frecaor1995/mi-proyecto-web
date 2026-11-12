import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import type { DictionaryKey } from "../../i18n/dictionary-shape";
import { WORKFORCE_LIST_PAGE_SIZE, workforceListHref, type WorkforceListQuery, type WorkforceListResult } from "../../server/workforce/get-workforce-list";
import type { TradeOption, OccupationOption } from "../../server/workforce/get-workforce-taxonomy";
import { PageHeader, ErrorState } from "../ui/foundation";

/**
 * WORKFORCE-TALENT-A4 primary workforce screen. Never renders raw credential
 * identifiers, contact values, or compensation -- this list only ever
 * receives WorkforceListItem, which carries none of those fields at all.
 */
export function WorkforceListView({
  locale, query, result, trades, occupations, canCreate,
}: {
  readonly locale: Locale;
  readonly query: WorkforceListQuery;
  readonly result: WorkforceListResult;
  readonly trades: readonly TradeOption[];
  readonly occupations: readonly OccupationOption[];
  readonly canCreate: boolean;
}) {
  const filtered = !!(query.lifecycleStatus || query.tradeCode || query.occupationCode);
  // WORKFORCE-TALENT-A4-R4-REM: `reason` already distinguishes "you aren't
  // signed in/authorized" from "the workforce database itself is
  // unreachable" (get-workforce-list.ts never conflated these at the data
  // level) -- this view previously ignored that distinction and rendered
  // every non-authorized result as a generic "not authorized" panel, and
  // always drove the header marker off `capability`, which is "UNAVAILABLE"
  // for both a personal auth failure and a genuine DB outage. Neither
  // conflation is truthful: a session/authorization problem is never a
  // database connectivity problem, and must never be presented as one.
  const isPersonalAuthIssue = result.reason === "UNAUTHENTICATED" || result.reason === "UNAUTHORIZED";
  return (
    <div className="page-stack workforce-list-view">
      <PageHeader
        eyebrow={t(locale, "workforce.eyebrow")} title={t(locale, "routes.workforce.title")} description={t(locale, "routes.workforce.description")}
        marker={isPersonalAuthIssue ? undefined : t(locale, `capabilityState.${result.capability}`)}
        locale={locale}
      />
      {canCreate ? <Link href="/workforce/new" className="radar-create-action">{t(locale, "workforce.newWorkerAction")}</Link> : null}
      <ListFilters locale={locale} query={query} trades={trades} occupations={occupations} />
      {result.reason === "UNAUTHENTICATED" ? (
        <ErrorState locale={locale} title={t(locale, "workforce.requiresSignIn")} />
      ) : result.reason === "UNAUTHORIZED" ? (
        <ErrorState locale={locale} title={t(locale, "workforce.requiresOperator")} />
      ) : result.reason === "DATABASE_CONNECTION_UNAVAILABLE" ? (
        <CapabilityUnavailable locale={locale} />
      ) : result.capability === "UNKNOWN" ? (
        <ErrorState locale={locale} title={t(locale, "workforce.queryErrorTitle")} description={t(locale, "workforce.queryErrorDescription")} />
      ) : result.capability !== "OPERATIONAL" ? (
        <CapabilityUnavailable locale={locale} />
      ) : result.items.length === 0 ? (
        <ListEmpty locale={locale} filtered={filtered} />
      ) : (
        <>
          <ListTable locale={locale} result={result} />
          <ListPagination locale={locale} query={query} fullPage={result.items.length === WORKFORCE_LIST_PAGE_SIZE} />
        </>
      )}
    </div>
  );
}

function ListFilters({ locale, query, trades, occupations }: { locale: Locale; query: WorkforceListQuery; trades: readonly TradeOption[]; occupations: readonly OccupationOption[] }) {
  return (
    <form className="radar-filters" action="/workforce" method="get" aria-label={t(locale, "workforce.filtersLabel")}>
      <label>
        <span>{t(locale, "workforce.filterLifecycleLabel")}</span>
        <select name="lifecycle" defaultValue={query.lifecycleStatus ?? ""}>
          <option value="">{t(locale, "workforce.filterLifecycleAll")}</option>
          {(["ACTIVE", "INACTIVE", "ARCHIVED"] as const).map((state) => <option key={state} value={state}>{t(locale, `workforce.lifecycleState.${state}` as DictionaryKey)}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.filterTradeLabel")}</span>
        <select name="trade" defaultValue={query.tradeCode ?? ""}>
          <option value="">{t(locale, "workforce.filterTradeAll")}</option>
          {trades.map((trade) => <option key={trade.code} value={trade.code}>{trade.labelEn}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.filterOccupationLabel")}</span>
        <select name="occupation" defaultValue={query.occupationCode ?? ""}>
          <option value="">{t(locale, "workforce.filterOccupationAll")}</option>
          {occupations.map((occupation) => <option key={occupation.code} value={occupation.code}>{occupation.labelEn}</option>)}
        </select>
      </label>
      <div className="radar-filter-actions">
        <button type="submit">{t(locale, "workforce.applyFilters")}</button>
        <Link href="/workforce">{t(locale, "workforce.clearFilters")}</Link>
      </div>
    </form>
  );
}

function ListTable({ locale, result }: { locale: Locale; result: WorkforceListResult }) {
  const unknown = t(locale, "workforce.unknownValue");
  const columns = ["name", "lifecycle", "verification", "trade", "availability", "location", "completeness"] as const;
  return (
    <div className="radar-table-shell">
      <table className="radar-table">
        <thead><tr>{columns.map((column) => <th key={column} scope="col">{t(locale, `workforce.column.${column}`)}</th>)}</tr></thead>
        <tbody>
          {result.items.map((item) => (
            <tr key={item.worker.id}>
              <td data-label={t(locale, "workforce.column.name")}>
                <Link className="radar-primary-link" href={`/workforce/${encodeURIComponent(item.worker.id)}`}>{item.worker.displayName}</Link>
              </td>
              <td data-label={t(locale, "workforce.column.lifecycle")}>{t(locale, `workforce.lifecycleState.${item.worker.lifecycleStatus}` as DictionaryKey)}</td>
              <td data-label={t(locale, "workforce.column.verification")}>{item.worker.profileVerificationState}</td>
              <td data-label={t(locale, "workforce.column.trade")}>
                {item.primaryTradeOccupation ? (
                  <span className="workforce-primary-cell">
                    <strong>{item.primaryTradeOccupation.occupationCode}</strong>
                    <small>{item.tradeOccupationCount > 1 ? `+${item.tradeOccupationCount - 1}` : ""}</small>
                  </span>
                ) : unknown}
              </td>
              <td data-label={t(locale, "workforce.column.availability")}>
                {item.availabilityStatus ? t(locale, `workforce.availability.statusOption.${item.availabilityStatus}` as DictionaryKey) : unknown}
              </td>
              <td data-label={t(locale, "workforce.column.location")}>{item.locationSummary ?? unknown}</td>
              <td data-label={t(locale, "workforce.column.completeness")}>
                {item.missingTrade || item.missingAvailability ? (
                  <ul className="workforce-completeness">
                    {item.missingTrade ? <li>{t(locale, "workforce.completeness.missingTrade")}</li> : null}
                    {item.missingAvailability ? <li>{t(locale, "workforce.completeness.missingAvailability")}</li> : null}
                  </ul>
                ) : <span className="workforce-completeness"><span className="workforce-complete">{t(locale, "workforce.completeness.allGood")}</span></span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListPagination({ locale, query, fullPage }: { locale: Locale; query: WorkforceListQuery; fullPage: boolean }) {
  const hasPrevious = query.page > 1;
  if (!hasPrevious && !fullPage) return null;
  return (
    <nav className="radar-pagination" aria-label={t(locale, "workforce.filtersLabel")}>
      <Link aria-disabled={!hasPrevious} tabIndex={hasPrevious ? undefined : -1} href={workforceListHref(query, { page: Math.max(1, query.page - 1) })}>{t(locale, "companyIntelligence.previous")}</Link>
      <span>{query.page}</span>
      <Link aria-disabled={!fullPage} tabIndex={fullPage ? undefined : -1} href={workforceListHref(query, { page: query.page + 1 })}>{t(locale, "companyIntelligence.next")}</Link>
    </nav>
  );
}

function ListEmpty({ locale, filtered }: { locale: Locale; filtered: boolean }) {
  return (
    <section className="radar-state-panel">
      <h2>{t(locale, filtered ? "workforce.emptyFilteredTitle" : "workforce.emptyTitle")}</h2>
      <p>{t(locale, filtered ? "workforce.emptyFilteredDescription" : "workforce.emptyDescription")}</p>
      {filtered ? <Link href="/workforce">{t(locale, "workforce.clearFilters")}</Link> : <Link href="/workforce/new">{t(locale, "workforce.newWorkerAction")}</Link>}
    </section>
  );
}

function CapabilityUnavailable({ locale }: { locale: Locale }) {
  return <ErrorState locale={locale} title={t(locale, "workforce.capabilityUnavailableTitle")} description={t(locale, "workforce.capabilityUnavailableDescription")} />;
}
