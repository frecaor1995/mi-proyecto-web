import { WorkforceListView } from "../../components/workforce/workforce-list-view";
import { resolveServerLocale } from "../../i18n/server-locale";
import { getWorkforceListPage, parseWorkforceListQuery } from "../../server/workforce/get-workforce-list";
import { getWorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import { resolveWorkerUiPermissions } from "../../server/workforce/worker-permissions";

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
  return (
    <WorkforceListView
      locale={locale} query={query} result={result}
      trades={taxonomy.trades} occupations={taxonomy.occupations}
      canCreate={permissions.profileWrite}
    />
  );
}
