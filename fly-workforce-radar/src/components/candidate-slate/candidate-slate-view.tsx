import Link from "next/link";
import type { CandidateSlateGroup, CandidateSlatePageData, CandidateSlateWorker } from "../../domain/candidate-slate";
import type { Locale } from "../../i18n/locale";
import { candidateSlateCopy } from "./candidate-slate-copy";
import { PrintCandidateSlateButton } from "./print-candidate-slate-button";
import styles from "./candidate-slate.module.css";

const GROUPS:readonly CandidateSlateGroup[]=["CANDIDATE","SELECTED","IN_PROGRESS","BLOCKED"];
const state=(value:string|null|undefined,unknown:string)=>value??unknown;
const label=(locale:Locale,en:string|null,es:string|null,code:string|null,unknown:string)=>locale==="es-US"?(es??en??code??unknown):(en??es??code??unknown);
const years=(months:number|null,unknown:string)=>months===null?unknown:(months/12).toLocaleString(undefined,{maximumFractionDigits:1});
const humanize=(value:string)=>value.toLowerCase().replaceAll("_"," ").replace(/^./,c=>c.toUpperCase());

export function CandidateSlateView({locale,result,group}:{readonly locale:Locale;readonly result:CandidateSlatePageData;readonly group:CandidateSlateGroup|null}){
  const c=candidateSlateCopy(locale);
  if(result.state!=="READY")return <main className={styles.shell}><Link href="/opportunities" className={styles.back}>← {c.back}</Link><section className={styles.state}><p className={styles.eyebrow}>{c.eyebrow}</p><h1>{c.title}</h1><p>{result.state==="RESTRICTED"?c.restricted:result.state==="NOT_FOUND"?c.notFound:result.state==="UNAVAILABLE"?c.unavailable:c.error}</p></section></main>;
  const slate=result.slate;
  return <main className={styles.shell}>
    <nav className={styles.topline}><Link href={`/opportunities/${slate.opportunityId}`} className={styles.back}>← {c.back}</Link><PrintCandidateSlateButton className={styles.print} label={c.print}/></nav>
    <header className={styles.hero}><div><p className={styles.eyebrow}>{c.eyebrow}</p><h1>{c.title}</h1><p>{c.description}</p></div><dl className={styles.context}><div><dt>{c.customer}</dt><dd>{slate.customer??c.unknown}</dd></div><div><dt>{c.project}</dt><dd>{slate.project??slate.opportunityTitle??c.unknown}</dd></div><div><dt>ID</dt><dd>{slate.opportunityId}</dd></div></dl></header>
    <nav className={styles.filters} aria-label={c.title}><Link className={!group?styles.active:""} href={`/opportunities/${slate.opportunityId}/candidate-slate`}>{c.all}</Link>{GROUPS.map(value=><Link className={group===value?styles.active:""} key={value} href={`/opportunities/${slate.opportunityId}/candidate-slate?group=${value}`}>{c[value]}</Link>)}</nav>
    {!slate.demands.length?<section className={styles.empty}>{c.noDemand}</section>:slate.demands.map((demand,index)=>{
      const visible=group?demand.workers.filter(worker=>worker.group===group):demand.workers;
      return <section className={styles.demand} key={demand.demandId}>
        <header className={styles.demandHeader}><div><p className={styles.kicker}>{c.demand} {String(index+1).padStart(2,"0")}</p><h2>{label(locale,demand.tradeLabelEn,demand.tradeLabelEs,demand.tradeCode,c.unknown)} · {label(locale,demand.occupationLabelEn,demand.occupationLabelEs,demand.occupationCode,c.unknown)}</h2><p>{c.location}: {demand.location??slate.location??c.unknown} · {c.start}: {demand.startDate??c.unknown}</p></div><div className={styles.gap}><strong>{demand.remainingPositions??"—"}</strong><span>{c.remaining}</span></div></header>
        <div className={styles.metrics}><Metric label={c.requested} value={demand.requestedHeadcount??"—"}/><Metric label={c.matching} value={demand.matchingCount}/><Metric label={c.engaged} value={demand.engagedCount}/><Metric label={c.selected} value={demand.selectedCount}/><Metric label={c.candidates} value={demand.candidateCount}/>{demand.surplusCandidates>0?<Metric label={c.surplus} value={`+${demand.surplusCandidates}`}/>:null}</div>
        <div className={styles.rows}>{visible.length?visible.map(worker=><WorkerCard key={worker.workerId} worker={worker} locale={locale}/>):<div className={styles.empty}>{demand.workers.length?c.noFilter:c.noWorkers}</div>}</div>
        <section className={styles.handoff}><div><p className={styles.kicker}>{c.handoff}</p><p>{c.handoffDescription}</p></div><div className={styles.handoffRows}>{demand.workers.filter(w=>w.group==="CANDIDATE").length?demand.workers.filter(w=>w.group==="CANDIDATE").map(worker=><HandoffRow key={worker.workerId} worker={worker} locale={locale}/>):<p>{c.noCandidates}</p>}</div></section>
      </section>;
    })}
  </main>;
}
function Metric({label,value}:{label:string;value:string|number}){return <div><span>{label}</span><strong>{value}</strong></div>}
function WorkerCard({worker,locale}:{worker:CandidateSlateWorker;locale:Locale}){const c=candidateSlateCopy(locale);return <article className={`${styles.worker} ${styles[worker.group.toLowerCase()]}`}>
  <header><div><span className={styles.group}>{c[worker.group]}</span><h3>{worker.displayName}</h3><p>{label(locale,worker.tradeLabelEn,worker.tradeLabelEs,worker.tradeCode,c.unknown)} · {label(locale,worker.occupationLabelEn,worker.occupationLabelEs,worker.occupationCode,c.unknown)}</p></div><div className={styles.experience}><strong>{years(worker.experienceMonths,c.unknown)}</strong><span>{worker.experienceMonths===null?"":c.years}</span></div></header>
  <div className={styles.stateGrid}><Fact label={c.match} value={state(worker.matchOutcome,c.unknown)}/><Fact label={c.selection} value={state(worker.selectionState,c.unknown)}/><Fact label={c.contact} value={state(worker.contactState,c.unknown)}/><Fact label={c.response} value={state(worker.responseState,c.unknown)}/><Fact label={c.availability} value={state(worker.availabilityState,c.unknown)}/><Fact label={c.compensation} value={state(worker.compensationState,c.unknown)}/><Fact label={c.travel} value={state(worker.travelState,c.unknown)}/><Fact label={c.readiness} value={state(worker.mobilizationState,c.unknown)}/></div>
  <div className={styles.lower}><div><h4>{c.qualifications}</h4><p><b>{c.skills}:</b> {worker.skills.length?worker.skills.map(q=>label(locale,q.labelEn,q.labelEs,q.code,c.unknown)).join(", "):c.unknown}</p><p><b>{c.credentials}:</b> {worker.credentials.length?worker.credentials.map(q=>label(locale,q.labelEn,q.labelEs,q.code,c.unknown)).join(", "):c.unknown}</p></div><div><h4>{c.blockers}</h4><p>{worker.blockers.length?worker.blockers.map(humanize).join(" · "):c.none}</p><p className={styles.next}><b>{c.next}:</b> {humanize(worker.nextAction)}</p></div></div>
  <Link className={styles.workerLink} href={`/workforce/${worker.workerId}`}>{worker.displayName} →</Link>
 </article>}
function Fact({label,value}:{label:string;value:string}){return <div><span>{label}</span><strong>{humanize(value)}</strong></div>}
function HandoffRow({worker,locale}:{worker:CandidateSlateWorker;locale:Locale}){const c=candidateSlateCopy(locale);return <article><div><strong>{worker.displayName}</strong><span>{label(locale,worker.occupationLabelEn,worker.occupationLabelEs,worker.occupationCode,c.unknown)} · {years(worker.experienceMonths,c.unknown)} {worker.experienceMonths===null?"":c.years}</span></div><div><span>{worker.skills.map(q=>label(locale,q.labelEn,q.labelEs,q.code,c.unknown)).join(", ")||c.unknown}</span><strong>{humanize(worker.availabilityState??"UNKNOWN")}</strong></div></article>}
