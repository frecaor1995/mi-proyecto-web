"use client";

import { useState, useTransition } from "react";
import { DISCOVERY_STRATEGIES, type DiscoveryStrategy } from "../../domain/discovery-intelligence";
import { recordManualMiss } from "../../server/discovery-intelligence/actions";
import type { Locale } from "../../i18n/locale";

const ES: Record<string, string> = {"What Radar missed *": "¿Qué no vio Radar? *", "Company": "Empresa", "Source *": "Fuente *", "Public HTTPS URL": "URL pública HTTPS", "Profession": "Profesión", "Level — only if evidenced": "Nivel — solo si hay evidencia", "Location": "Ubicación", "Project — only if evidenced": "Proyecto — solo si hay evidencia", "How it was found *": "Cómo se encontró *", "Search/query used": "Búsqueda/consulta usada", "Discovery strategy *": "Estrategia de descubrimiento *", "Notes": "Notas", "Recording…": "Registrando…", "Record manual miss": "Registrar omisión manual"};

export function ManualMissForm({ locale = "en-US" }: { readonly locale?: Locale } = {}) {
  const t = (text: string) => (locale === "es-US" ? ES[text] ?? text : text);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return <form onSubmit={(event) => {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    startTransition(async () => {
      const result = await recordManualMiss({ summary: String(form.get("summary") ?? ""), company: String(form.get("company") ?? ""),
        source: String(form.get("source") ?? ""), sourceUrl: String(form.get("sourceUrl") ?? ""), profession: String(form.get("profession") ?? ""),
        level: String(form.get("level") ?? ""), location: String(form.get("location") ?? ""), project: String(form.get("project") ?? ""),
        discoveryMethod: String(form.get("method") ?? ""), query: String(form.get("query") ?? ""), strategy: String(form.get("strategy")) as DiscoveryStrategy,
        notes: String(form.get("notes") ?? "") });
      setMessage(result.message); if (result.ok) formElement.reset();
    });
  }}>
    <div className="sig-form-grid">
      <label><span>{t("What Radar missed *")}</span><input name="summary" maxLength={1000} required /></label>
      <label><span>{t("Company")}</span><input name="company" maxLength={300} /></label>
      <label><span>{t("Source *")}</span><input name="source" maxLength={300} required /></label>
      <label><span>{t("Public HTTPS URL")}</span><input name="sourceUrl" type="url" pattern="https://.*" maxLength={2000} /></label>
      <label><span>{t("Profession")}</span><input name="profession" maxLength={200} /></label>
      <label><span>{t("Level — only if evidenced")}</span><input name="level" maxLength={120} /></label>
      <label><span>{t("Location")}</span><input name="location" maxLength={300} /></label>
      <label><span>{t("Project — only if evidenced")}</span><input name="project" maxLength={300} /></label>
      <label><span>{t("How it was found *")}</span><input name="method" maxLength={300} required /></label>
      <label><span>{t("Search/query used")}</span><input name="query" maxLength={500} /></label>
      <label><span>{t("Discovery strategy *")}</span><select name="strategy" defaultValue="AGGREGATOR_SEARCH">{DISCOVERY_STRATEGIES.map((strategy) => <option key={strategy}>{strategy}</option>)}</select></label>
      <label><span>{t("Notes")}</span><input name="notes" maxLength={4000} /></label>
    </div>
    <div className="radar-filter-actions"><button type="submit" disabled={pending}>{pending ? t("Recording…") : t("Record manual miss")}</button></div>
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
  </form>;
}
