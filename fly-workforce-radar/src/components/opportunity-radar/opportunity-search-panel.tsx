"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { CompanyDiscoveryResult } from "../../domain/company-discovery";
import type { Locale } from "../../i18n/locale";
import type { OpportunitySearchStatus } from "../../server/opportunity-search/get-opportunity-search-status";
import { searchOpportunitiesNow } from "../../server/opportunity-search/actions";

const copy = {
  "en-US": { eyebrow: "Opportunity discovery", title: "Search the market", description: "Search Now starts a governed external discovery run. Refresh only reloads current Radar data.",
    company: "Company", keyword: "Opportunity / project / keyword", trade: "Trade / profession", location: "Location", search: "Search Now", searching: "Searching…", refresh: "Refresh",
    automatic: "Automatic Search", on: "ON", off: "OFF", frequency: "Frequency", every: "Every {hours} hours", last: "Last Search", success: "Last Successful Search", next: "Next Search",
    status: "Status", results: "Candidates", failure: "Failure", none: "No search run yet", discovered: "Discovered candidates", caution: "Discovered does not mean verified or canonical.",
    provider: "Provider", discoveredAt: "Discovered", seen: "Seen in an earlier run", evidence: "Evidence", captured: "Captured", pending: "Validation pending", intent: "Enter at least one search field.", unavailable: "Search storage is unavailable until its migration is applied." },
  "es-US": { eyebrow: "Descubrimiento de oportunidades", title: "Buscar en el mercado", description: "Buscar ahora inicia un descubrimiento externo gobernado. Actualizar solo recarga los datos actuales del Radar.",
    company: "Empresa", keyword: "Oportunidad / proyecto / palabra clave", trade: "Oficio / profesión", location: "Ubicación", search: "Buscar ahora", searching: "Buscando…", refresh: "Actualizar",
    automatic: "Búsqueda automática", on: "ACTIVA", off: "INACTIVA", frequency: "Frecuencia", every: "Cada {hours} horas", last: "Última búsqueda", success: "Última búsqueda exitosa", next: "Próxima búsqueda",
    status: "Estado", results: "Candidatos", failure: "Falla", none: "Aún no hay búsquedas", discovered: "Candidatos descubiertos", caution: "Descubierto no significa verificado ni canónico.",
    provider: "Proveedor", discoveredAt: "Descubierto", seen: "Visto en una búsqueda anterior", evidence: "Evidencia", captured: "Capturada", pending: "Validación pendiente", intent: "Ingrese al menos un campo de búsqueda.", unavailable: "El almacenamiento de búsqueda no está disponible hasta aplicar su migración." },
} as const;

export function OpportunitySearchPanel({ locale, authorized, status }: { readonly locale: Locale; readonly authorized: boolean; readonly status: OpportunitySearchStatus }) {
  const c = copy[locale];
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CompanyDiscoveryResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const runs = status.runs;
  const latest = runs[0];
  const lastSuccess = runs.find((run) => run.status === "COMPLETED");
  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    if (!["company", "keyword", "tradeProfession", "location"].some((name) => String(data.get(name) ?? "").trim())) { setMessage(c.intent); return; }
    setMessage(null);
    startTransition(async () => {
      const outcome = await searchOpportunitiesNow(data);
      setResult(outcome.result);
      if (outcome.state === "UNAUTHORIZED") setMessage("Authorization required");
      else if (outcome.failureCode) setMessage(outcome.failureCode.replaceAll("_", " "));
    });
  }
  return <section className="radar-state-panel opportunity-search-panel" aria-labelledby="opportunity-search-title">
    <p className="overline">{c.eyebrow}</p><h2 id="opportunity-search-title">{c.title}</h2><p>{c.description}</p>
    <form className="radar-filters" onSubmit={(event) => { event.preventDefault(); submit(event.currentTarget); }}>
      <label><span>{c.company}</span><input name="company" disabled={!authorized || pending} /></label>
      <label><span>{c.keyword}</span><input name="keyword" disabled={!authorized || pending} /></label>
      <label><span>{c.trade}</span><input name="tradeProfession" disabled={!authorized || pending} /></label>
      <label><span>{c.location}</span><input name="location" placeholder="Houston, TX" disabled={!authorized || pending} /></label>
      <div className="radar-filter-actions"><button type="submit" disabled={!authorized || pending}>{pending ? c.searching : c.search}</button><Link href="/opportunities">{c.refresh}</Link></div>
    </form>
    {message ? <p role="alert">{message}</p> : null}
    {!status.available ? <p className="radar-boundary-note">{c.unavailable}</p> : null}
    <div className="radar-result-bar">
      <span>{c.automatic}: {status.automaticEnabled ? c.on : c.off}</span><span>{c.frequency}: {c.every.replace("{hours}", String(status.cadenceHours))}</span>
      <span>{c.last}: {format(latest?.startedAt ?? null, locale)}</span><span>{c.success}: {format(lastSuccess?.completedAt ?? null, locale)}</span>
      <span>{c.next}: {format(status.nextRunAt, locale)}</span><span>{c.status}: {latest?.status ?? c.none}</span>
      <span>{c.results}: {latest?.findingsCount ?? 0}</span>{latest?.failureCode ? <span>{c.failure}: {latest.failureCode.replaceAll("_", " ")}</span> : null}
    </div>
    <CandidateList locale={locale} result={result ?? (latest ? { candidates: latest.candidates } : null)} />
  </section>;
}

function CandidateList({ locale, result }: { readonly locale: Locale; readonly result: Pick<CompanyDiscoveryResult, "candidates"> | null }) {
  const c = copy[locale]; if (!result?.candidates.length) return null;
  return <div className="page-stack"><h3>{c.discovered}</h3><p>{c.caution}</p>{result.candidates.map((candidate) => <article className="radar-state-panel" key={`${candidate.normalizedUrl}:${candidate.id ?? "new"}`}>
    <p className="overline">{c.provider}: Brave Web Search</p><h4>{candidate.title}</h4>{candidate.providerDescription ? <p>{candidate.providerDescription}</p> : null}
    <p>{c.discoveredAt}: {format(candidate.discoveredAt ?? null, locale)} · {c.evidence}: {candidate.evidenceCaptured ? c.captured : c.pending}</p>
    {candidate.previouslySeen ? <p>{c.seen}</p> : null}<p><strong>{c.caution}</strong></p>
  </article>)}</div>;
}

function format(value: string | null, locale: Locale) { return value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
