import Link from "next/link";
import { OpportunityRadarView } from "../../components/opportunity-radar/opportunity-radar-view";
import { commercialIntakeCopy } from "../../components/commercial-intake/commercial-intake-copy";
import { resolveServerLocale } from "../../i18n/server-locale";
import { getOpportunityRadarPage, parseOpportunityRadarQuery } from "../../server/opportunity-radar/get-opportunity-radar-page";
import { OpportunitySearchPanel } from "../../components/opportunity-radar/opportunity-search-panel";
import { authorizeOperator } from "../../server/auth/authorization";
import { getOpportunitySearchStatus } from "../../server/opportunity-search/get-opportunity-search-status";

export default async function OpportunitiesPage({ searchParams = Promise.resolve({}) }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const [locale, params, authorization, searchStatus] = await Promise.all([resolveServerLocale(), searchParams, authorizeOperator("company_discovery.run"), getOpportunitySearchStatus()]);
  const query = parseOpportunityRadarQuery(params);
  const result = await getOpportunityRadarPage(query);
  return <div className="page-stack"><div className="radar-filter-actions"><Link href="/opportunities/new">{commercialIntakeCopy[locale].title}</Link></div><OpportunitySearchPanel locale={locale} authorized={authorization.state === "AUTHORIZED"} status={searchStatus} /><OpportunityRadarView locale={locale} query={query} result={result} /></div>;
}
