import { PursuitGate } from "../../../../components/commercial-pursuit/pursuit-gate";
import { PursuitWorkspace } from "../../../../components/commercial-pursuit/pursuit-workspace";
import { todayInChicago } from "../../../../components/opportunity-discovery/buyer-workspace";
import { resolveServerLocale } from "../../../../i18n/server-locale";
import { getPursuitPage } from "../../../../server/commercial-pursuit/get-pursuit-page";

// Phase 3A: commercial pursuit for one opportunity (a sub-route, like the candidate slate).
export default async function OpportunityPursuitPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const [locale, { id }] = await Promise.all([resolveServerLocale(), params]);
  const result = /^[0-9a-f-]{36}$/i.test(id) ? await getPursuitPage(id, todayInChicago()) : ({ state: "NOT_FOUND" } as const);
  return result.state === "READY" ? <PursuitWorkspace locale={locale} data={result.value} permissions={result.permissions} /> : <PursuitGate locale={locale} state={result.state} />;
}
