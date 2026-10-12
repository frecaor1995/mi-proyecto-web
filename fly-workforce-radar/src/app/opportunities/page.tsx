import Link from "next/link";
import { OpportunityRadarView } from "../../components/opportunity-radar/opportunity-radar-view";
import { commercialIntakeCopy } from "../../components/commercial-intake/commercial-intake-copy";
import { resolveServerLocale } from "../../i18n/server-locale";
import { getOpportunityRadarPage, parseOpportunityRadarQuery } from "../../server/opportunity-radar/get-opportunity-radar-page";

// Opportunity-first: discovery (search + discovered signals) lives on /radar; this page lists the
// opportunities that exist -- promoted from verified signals or entered manually.
export default async function OpportunitiesPage({ searchParams = Promise.resolve({}) }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const [locale, params] = await Promise.all([resolveServerLocale(), searchParams]);
  const query = parseOpportunityRadarQuery(params);
  const result = await getOpportunityRadarPage(query);
  return <div className="page-stack"><div className="page-actions"><Link className="button button-secondary" href="/radar">{locale === "es-US" ? "Abrir Radar de oportunidades" : "Open Opportunity Radar"}</Link><Link className="button button-primary" href="/opportunities/new">{commercialIntakeCopy[locale].title}</Link></div><OpportunityRadarView locale={locale} query={query} result={result} /></div>;
}
