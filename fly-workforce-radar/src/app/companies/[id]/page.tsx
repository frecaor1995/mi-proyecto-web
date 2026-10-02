import { CompanyIntelligenceDetailView } from "../../../components/company-intelligence/company-detail-view";
import { BuyerWorkspace } from "../../../components/opportunity-discovery/buyer-workspace";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { getCompanyDetailPage } from "../../../server/company-intelligence/get-company-intelligence";
import { getProductionSqlClient } from "../../../server/database/production-sql-client";
import { loadBuyerInvestigation } from "../../../server/contact-intelligence/buyer-investigation";
import { providerStatuses } from "../../../server/contact-intelligence/providers";

export default async function CompanyDetailPage({params}:{readonly params:Promise<{id:string}>}) {
  const [locale,{id}]=await Promise.all([resolveServerLocale(),params]);
  const result=await getCompanyDetailPage(id);
  const client=result.state==="READY"?getProductionSqlClient():null;
  // Company-first Contact Intelligence: works with or without any opportunity for this company.
  const buyers=client?await loadBuyerInvestigation(client,{kind:"COMPANY",companyId:id}).catch(()=>null):null;
  return <CompanyIntelligenceDetailView locale={locale} result={result} contacts={buyers?<BuyerWorkspace locale={locale} subject={{companyId:id}} view={buyers} providers={providerStatuses()}/>:null}/>;
}
