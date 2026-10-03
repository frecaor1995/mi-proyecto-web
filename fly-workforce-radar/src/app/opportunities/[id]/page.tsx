import { OpportunityDetailView } from "../../../components/opportunity-detail/opportunity-detail-view";
import { resolveServerLocale } from "../../../i18n/server-locale";
import { getOpportunityDetailPage } from "../../../server/opportunity-detail/get-opportunity-detail-page";
import { getOpportunityWorkforceMatching } from "../../../server/opportunity-detail/get-opportunity-workforce-matching";
import { getOpportunityPursuitEntry } from "../../../server/commercial-pursuit/get-pursuit-page";
import { todayInChicago } from "../../../components/opportunity-discovery/buyer-workspace";
export default async function OpportunityDetailPage({params}:{readonly params:Promise<{id:string}>}) { const [locale,{id}]=await Promise.all([resolveServerLocale(),params]); const [result,pursuitEntry]=await Promise.all([getOpportunityDetailPage(id),getOpportunityPursuitEntry(id,todayInChicago())]); const matching=result.state==="READY"?await getOpportunityWorkforceMatching(result.detail.demand.map(demand=>demand.id)):null; return <OpportunityDetailView locale={locale} result={result} matching={matching} pursuitEntry={pursuitEntry}/>; }
