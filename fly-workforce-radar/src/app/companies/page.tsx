import { CompanyIntelligenceListView } from "../../components/company-intelligence/company-list-view";
import { resolveServerLocale } from "../../i18n/server-locale";
import { getCompanyListPage, parseCompanyListQuery } from "../../server/company-intelligence/get-company-intelligence";

export default async function CompaniesPage({ searchParams = Promise.resolve({}) }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const [locale, params] = await Promise.all([resolveServerLocale(), searchParams]);
  const query = parseCompanyListQuery(params);
  const result = await getCompanyListPage(query);
  return <CompanyIntelligenceListView locale={locale} query={query} result={result} />;
}
