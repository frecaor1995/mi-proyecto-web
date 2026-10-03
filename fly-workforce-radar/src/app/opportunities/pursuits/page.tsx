import { PursuitGate } from "../../../components/commercial-pursuit/pursuit-gate";
import { PursuitListView } from "../../../components/commercial-pursuit/pursuit-list-view";
import { todayInChicago } from "../../../components/opportunity-discovery/buyer-workspace";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { getPursuitList } from "../../../server/commercial-pursuit/get-pursuit-page";

// Phase 3A: opportunities in human pursuit, next actions (overdue filter) and the 30-day commercial evidence window.
export default async function PursuitsPage({ searchParams = Promise.resolve({}) }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const [locale, params] = await Promise.all([resolveServerLocale(), searchParams]);
  const today = todayInChicago();
  const result = await getPursuitList(today);
  if (result.state !== "READY") return <PursuitGate locale={locale} state={result.state} />;
  return <PursuitListView locale={locale} data={result.value} overdueOnly={params.view === "overdue"} />;
}
