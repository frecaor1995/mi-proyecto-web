import { OpportunityDetailView } from "../../../components/opportunity-detail/opportunity-detail-view";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { getOpportunityDetailPage } from "../../../server/opportunity-detail/get-opportunity-detail-page";
import { getOpportunityWorkforceMatching } from "../../../server/opportunity-detail/get-opportunity-workforce-matching";
export default async function OpportunityDetailPage({params}:{readonly params:Promise<{id:string}>}) { const [locale,{id}]=await Promise.all([resolveServerLocale(),params]); const result=await getOpportunityDetailPage(id); const matching=result.state==="READY"?await getOpportunityWorkforceMatching(result.detail.demand.map(demand=>demand.id)):null; return <OpportunityDetailView locale={locale} result={result} matching={matching}/>; }
