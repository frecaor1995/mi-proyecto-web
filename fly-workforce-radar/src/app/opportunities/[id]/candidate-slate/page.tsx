import type { CandidateSlateGroup } from "../../../../domain/candidate-slate";
import { CandidateSlateView } from "../../../../components/candidate-slate/candidate-slate-view";
import { resolveServerLocale } from "../../../../i18n/server-locale";
import { getCandidateSlate } from "../../../../server/candidate-slate/get-candidate-slate";

const groups:readonly CandidateSlateGroup[]=["CANDIDATE","SELECTED","IN_PROGRESS","BLOCKED"];
export default async function CandidateSlatePage({params,searchParams}:{readonly params:Promise<{id:string}>;readonly searchParams:Promise<{group?:string}>}){
  const [locale,{id},query]=await Promise.all([resolveServerLocale(),params,searchParams]);
  const group=groups.includes(query.group as CandidateSlateGroup)?query.group as CandidateSlateGroup:null;
  return <CandidateSlateView locale={locale} result={await getCandidateSlate(id)} group={group}/>;
}
