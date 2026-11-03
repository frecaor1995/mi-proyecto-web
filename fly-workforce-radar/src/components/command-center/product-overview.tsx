import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import type { WorkforceOverviewOpportunity, WorkforceOverviewResult } from "../../server/command-center/get-workforce-overview";
import type { SignalListResult } from "../../server/opportunity-discovery/signals";
import styles from "./product-overview.module.css";

const COPY = {
  "en-US": {
    eyebrow: "Fly Workforce Radar",
    title: "Find real workforce opportunities — then staff them",
    lede: "The Radar discovers public signals of workforce demand. A person verifies each one, extracts the need, and matches it against your workforce database.",
    openRadar: "Open Opportunity Radar", reviewSignals: "Review new signals", viewOpportunities: "View opportunities", createManual: "Create opportunity manually",
    flowTitle: "Workflow", flow: ["Discover", "Verify", "Extract need", "Match workforce", "Contact company", "Present workforce", "Follow up", "Result"],
    newSignals: "Latest real signals", newSignalsDetail: "Latest Brave run, not reviewed yet",
    needsReview: "Needs review", needsReviewDetail: "Flagged for more checking",
    verified: "Verified signals", verifiedDetail: "Human-verified, ready to promote",
    realOpps: "Real opportunities", realOppsDetail: (withDemand: number, demo: number) => `${withDemand} with workforce requirements${demo ? ` · ${demo} demo records excluded` : ""}`,
    gap: "Workforce gap", gapDetail: (needed: number, covered: number, demands: number) => `${needed} needed · ${covered} matching workers · ${demands} measured requirement${demands === 1 ? "" : "s"}`,
    gapUnmeasured: "Run matching on a real opportunity with a stated headcount to measure the gap.",
    workers: "Workforce database", workersDetail: (active: number, available: number) => `${active} active · ${available} available now`,
    candidates: "Candidates", candidatesDetail: (shortlisted: number, selected: number) => `${selected} selected · ${shortlisted} shortlisted`,
    candidatesDemo: (total: number, shortlisted: number, selected: number) => `${total} DEMO candidate${total === 1 ? "" : "s"} excluded (${selected} selected · ${shortlisted} shortlisted)`,
    companyActions: "Company next actions", companyActionsDetail: (demo: number) => `Real, due today or overdue${demo ? ` · ${demo} DEMO apart` : ""}`,
    realRecent: "Real opportunities", realEmpty: "No real opportunities yet. Review and verify a Radar signal, then promote it — or create one manually.",
    demoRecent: "Demo / test records", demoBadge: "DEMO",
    matched: (n: number) => `${n} matching worker${n === 1 ? "" : "s"}`, candidatesLabel: (n: number) => `${n} candidate${n === 1 ? "" : "s"}`,
    workers_: (n: number | null) => (n == null ? "Headcount not set" : `${n} worker${n === 1 ? "" : "s"} needed`),
    noRequirement: "Requirements not captured", unavailable: "Live figures are unavailable right now.",
    attentionEyebrow: "Today", attentionTitle: "What needs attention?", attentionLede: "Start with the strongest current market signal. One review moves the workflow forward.",
    latestFinding: (n: number) => `${n} newly discovered signal${n === 1 ? "" : "s"} in the latest run`, reviewTop: "Review the top signal", reviewCta: "Review signal",
  },
  "es-US": {
    eyebrow: "Fly Workforce Radar",
    title: "Encuentre oportunidades reales de personal — y cúbralas",
    lede: "El Radar descubre señales públicas de demanda de personal. Una persona verifica cada una, extrae la necesidad y la compara con su base de trabajadores.",
    openRadar: "Abrir Radar de oportunidades", reviewSignals: "Revisar señales nuevas", viewOpportunities: "Ver oportunidades", createManual: "Crear oportunidad manualmente",
    flowTitle: "Flujo", flow: ["Descubrir", "Verificar", "Extraer necesidad", "Buscar personal", "Contactar empresa", "Presentar personal", "Dar seguimiento", "Resultado"],
    newSignals: "Últimas señales reales", newSignalsDetail: "Última ejecución de Brave, sin revisar",
    needsReview: "Requieren revisión", needsReviewDetail: "Marcadas para más revisión",
    verified: "Señales verificadas", verifiedDetail: "Verificadas por una persona, listas para promover",
    realOpps: "Oportunidades reales", realOppsDetail: (withDemand: number, demo: number) => `${withDemand} con requisitos de personal${demo ? ` · ${demo} registros demo excluidos` : ""}`,
    gap: "Brecha de personal", gapDetail: (needed: number, covered: number, demands: number) => `${needed} requeridos · ${covered} compatibles · ${demands} requisito${demands === 1 ? "" : "s"} medido${demands === 1 ? "" : "s"}`,
    gapUnmeasured: "Ejecute la coincidencia en una oportunidad real con cantidad definida para medir la brecha.",
    workers: "Base de trabajadores", workersDetail: (active: number, available: number) => `${active} activos · ${available} disponibles ahora`,
    candidates: "Candidatos", candidatesDetail: (shortlisted: number, selected: number) => `${selected} seleccionados · ${shortlisted} preseleccionados`,
    candidatesDemo: (total: number, shortlisted: number, selected: number) => `${total} candidato${total === 1 ? "" : "s"} DEMO excluido${total === 1 ? "" : "s"} (${selected} seleccionados · ${shortlisted} preseleccionados)`,
    companyActions: "Próximas acciones de empresas", companyActionsDetail: (demo: number) => `Reales, para hoy o vencidas${demo ? ` · ${demo} DEMO aparte` : ""}`,
    realRecent: "Oportunidades reales", realEmpty: "Aún no hay oportunidades reales. Revise y verifique una señal del Radar y promuévala — o cree una manualmente.",
    demoRecent: "Registros demo / de prueba", demoBadge: "DEMO",
    matched: (n: number) => `${n} trabajador${n === 1 ? "" : "es"} compatible${n === 1 ? "" : "s"}`, candidatesLabel: (n: number) => `${n} candidato${n === 1 ? "" : "s"}`,
    workers_: (n: number | null) => (n == null ? "Cantidad no definida" : `${n} trabajador${n === 1 ? "" : "es"} requerido${n === 1 ? "" : "s"}`),
    noRequirement: "Requisitos no capturados", unavailable: "Las cifras no están disponibles en este momento.",
    attentionEyebrow: "Hoy", attentionTitle: "¿Qué requiere atención?", attentionLede: "Comience con la señal de mercado más completa. Una revisión hace avanzar el flujo.",
    latestFinding: (n: number) => `${n} señal${n === 1 ? "" : "es"} nueva${n === 1 ? "" : "s"} en la última búsqueda`, reviewTop: "Revise la señal principal", reviewCta: "Revisar señal",
  },
} as const;

type Copy = (typeof COPY)[keyof typeof COPY];

function OpportunityRow({ c, item }: { readonly c: Copy; readonly item: WorkforceOverviewOpportunity }) {
  return (
    <li className={item.isDemo ? "is-demo" : undefined}>
      <Link href={`/opportunities/${item.id}`}>
        <strong>{item.isDemo ? <em className="demo-badge">{c.demoBadge}</em> : null}{item.title}</strong>
        <span>{item.trade ? [item.occupation ?? item.trade, c.workers_(item.headcount), item.location].filter(Boolean).join(" · ") : c.noRequirement}</span>
      </Link>
      <div className="po-recent-stats"><em>{c.matched(item.matchedWorkers)}</em><em>{c.candidatesLabel(item.candidates)}</em></div>
    </li>
  );
}

export function ProductOverview({ locale, result, signals }: { readonly locale: Locale; readonly result: WorkforceOverviewResult; readonly signals?: SignalListResult }) {
  const c = COPY[locale];
  const o = result.state === "READY" ? result.overview : null;
  const counts = signals?.state === "READY" ? signals.counts : null;
  const real = o?.recent.filter((item) => !item.isDemo) ?? [];
  const demo = o?.recent.filter((item) => item.isDemo) ?? [];
  const topSignal = signals?.state === "READY" ? signals.signals[0] : null;
  const latestRun = signals?.state === "READY" ? signals.latestRun : null;
  return (
    <section className="product-overview" aria-labelledby="product-overview-title">
      <div className="po-hero">
        <div>
          <p className="po-eyebrow">{c.eyebrow}</p>
          <h1 id="product-overview-title">{c.title}</h1>
          <p className="po-lede">{c.lede}</p>
        </div>
        <div className="po-actions">
          <Link className="button button-primary" href="/radar">{c.openRadar}</Link>
          <Link className="button button-secondary" href="/radar?status=NEW">{c.reviewSignals}</Link>
          <Link className="button button-secondary" href="/opportunities">{c.viewOpportunities}</Link>
          <Link className="button button-ghost" href="/opportunities/new">{c.createManual}</Link>
        </div>
      </div>

      <ol className="po-flow" aria-label={c.flowTitle}>
        {c.flow.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}
      </ol>

      {topSignal && latestRun ? <section className="po-attention" aria-labelledby="po-attention-title">
        <div><p className="po-eyebrow">{c.attentionEyebrow}</p><h2 id="po-attention-title">{c.attentionTitle}</h2><p>{c.attentionLede}</p></div>
        <article><span>{c.latestFinding(latestRun.newlySeenCount)}</span><strong>{c.reviewTop}</strong><p>{topSignal.title}</p><small>{[topSignal.company, topSignal.location, topSignal.trade].filter(Boolean).join(" · ")}</small></article>
        <Link className="button button-primary" href={`/radar/${topSignal.candidateId}`}>{c.reviewCta}</Link>
      </section> : null}

      {o ? (
        <>
          <div className="po-metrics po-metrics-5">
            <Link className="po-metric po-metric-signal" href="/radar?status=NEW"><small>{c.newSignals}</small><strong>{counts ? counts.NEW : "—"}</strong><span>{c.newSignalsDetail}</span></Link>
            <Link className="po-metric" href="/radar?status=NEEDS_REVIEW"><small>{c.needsReview}</small><strong>{counts ? counts.NEEDS_REVIEW : "—"}</strong><span>{c.needsReviewDetail}</span></Link>
            <Link className="po-metric" href="/radar?status=VERIFIED"><small>{c.verified}</small><strong>{counts ? counts.VERIFIED : "—"}</strong><span>{c.verifiedDetail}</span></Link>
            <Link className="po-metric" href="/opportunities"><small>{c.realOpps}</small><strong>{o.opportunities.real}</strong><span>{c.realOppsDetail(o.opportunities.realWithDemand, o.opportunities.demo)}</span></Link>
            <div className="po-metric po-metric-gap"><small>{c.gap}</small><strong>{o.gap.demandsMeasured ? o.gap.gap : "—"}</strong><span>{o.gap.demandsMeasured ? c.gapDetail(o.gap.needed, o.gap.covered, o.gap.demandsMeasured) : c.gapUnmeasured}</span></div>
          </div>
          <div className={`po-metrics po-metrics-2 ${styles.metrics3}`}>
            <Link className="po-metric po-metric-compact" href="/workforce"><small>{c.workers}</small><strong>{o.workers.total}</strong><span>{c.workersDetail(o.workers.active, o.workers.available)}</span></Link>
            <div className="po-metric po-metric-compact"><small>{c.candidates}</small><strong>{o.candidates.selected + o.candidates.shortlisted}</strong><span>{c.candidatesDetail(o.candidates.shortlisted, o.candidates.selected)}
              {o.candidates.demo.selected + o.candidates.demo.shortlisted ? <em className={styles.demoLine}><b className="demo-badge">{c.demoBadge}</b> {c.candidatesDemo(o.candidates.demo.selected + o.candidates.demo.shortlisted, o.candidates.demo.shortlisted, o.candidates.demo.selected)}</em> : null}</span></div>
            <Link className="po-metric po-metric-compact" href="/opportunities/pursuits#company-actions"><small>{c.companyActions}</small><strong>{o.companyActions.realDue}</strong><span>{c.companyActionsDetail(o.companyActions.demoDue)}</span></Link>
          </div>
          <div className="po-recent">
            <h2>{c.realRecent}</h2>
            {real.length ? <ul>{real.map((item) => <OpportunityRow key={item.id} c={c} item={item} />)}</ul> : <p className="po-empty">{c.realEmpty}</p>}
          </div>
          {demo.length ? (
            <details className="po-recent po-demo">
              <summary>{c.demoRecent} ({o.opportunities.demo})</summary>
              <ul>{demo.map((item) => <OpportunityRow key={item.id} c={c} item={item} />)}</ul>
            </details>
          ) : null}
        </>
      ) : <p className="po-empty">{c.unavailable}</p>}
    </section>
  );
}
