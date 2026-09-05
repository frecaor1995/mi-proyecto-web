import { CompanyIntelligenceDetailView } from "../../../components/company-intelligence/company-detail-view";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { getCompanyDetailPage } from "../../../server/company-intelligence/get-company-intelligence";
export default async function CompanyDetailPage({params}:{readonly params:Promise<{id:string}>}) { const [locale,{id}]=await Promise.all([resolveServerLocale(),params]); const result=await getCompanyDetailPage(id); return <CompanyIntelligenceDetailView locale={locale} result={result}/>; }
