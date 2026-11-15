import { WorkforceIntelligenceList } from "../../components/workforce/workforce-intelligence-list";
import { resolveServerLocale } from "../../i18n/server-locale";
import { getWorkforceListPage, parseWorkforceListQuery } from "../../server/workforce/get-workforce-list";
import { getWorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import { resolveWorkerUiPermissions } from "../../server/workforce/worker-permissions";
import { getWorkforceIntelligenceSummaries } from "../../server/workforce/get-workforce-intelligence";

/**
 * WORKFORCE-TALENT-A4-R6: this route reads the authenticated session and the
 * live worker roster on every request. Without an explicit route-segment
 * config, Next.js's client-side Router Cache is free to serve a previously
 * cached RSC response for soft navigations (e.g. the sidebar <Link>) instead
 * of re-invoking this Server Component -- a full reload always re-fetches
 * and is therefore unaffected, which is why a hard reload / View Source
 * always showed the correct roster while in-app navigation could not.
 */
export const dynamic = "force-dynamic";

export default async function WorkforcePage({ searchParams = Promise.resolve({}) }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const [locale, params, permissions, taxonomy] = await Promise.all([
    resolveServerLocale(), searchParams, resolveWorkerUiPermissions(), getWorkforceTaxonomy(),
  ]);
  const query = parseWorkforceListQuery(params);
  const result = await getWorkforceListPage(query);
  const summaries = await getWorkforceIntelligenceSummaries(result.items.map((item) => item.worker.id));
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "").replaceAll(" ", "_");
  const filters = {
    availability: first(params.availability).toUpperCase(),
    level: first(params.level).toUpperCase(),
    credential: first(params.credential).toUpperCase(),
    readiness: first(params.readiness).toUpperCase(),
  };
  const filteredResult = { ...result, items: result.items.filter((item) => {
    const summary = summaries.get(item.worker.id);
    return (!filters.availability || (item.availabilityStatus ?? "UNKNOWN") === filters.availability)
      && (!filters.level || (summary?.level ?? "UNKNOWN") === filters.level)
      && (!filters.credential || summary?.expirationBand === filters.credential)
      && (!filters.readiness || summary?.readiness === filters.readiness);
  }) };
  return (
    <WorkforceIntelligenceList
      locale={locale} query={query} result={filteredResult} filters={filters}
      summaries={summaries} trades={taxonomy.trades}
      canCreate={permissions.profileWrite}
    />
  );
}
