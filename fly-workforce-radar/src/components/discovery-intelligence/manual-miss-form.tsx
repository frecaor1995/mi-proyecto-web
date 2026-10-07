"use client";

import { useState, useTransition } from "react";
import { DISCOVERY_STRATEGIES, type DiscoveryStrategy } from "../../domain/discovery-intelligence";
import { recordManualMiss } from "../../server/discovery-intelligence/actions";

export function ManualMissForm() {
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
      <label><span>What Radar missed *</span><input name="summary" maxLength={1000} required /></label>
      <label><span>Company</span><input name="company" maxLength={300} /></label>
      <label><span>Source *</span><input name="source" maxLength={300} required /></label>
      <label><span>Public HTTPS URL</span><input name="sourceUrl" type="url" pattern="https://.*" maxLength={2000} /></label>
      <label><span>Profession</span><input name="profession" maxLength={200} /></label>
      <label><span>Level — only if evidenced</span><input name="level" maxLength={120} /></label>
      <label><span>Location</span><input name="location" maxLength={300} /></label>
      <label><span>Project — only if evidenced</span><input name="project" maxLength={300} /></label>
      <label><span>How it was found *</span><input name="method" maxLength={300} required /></label>
      <label><span>Search/query used</span><input name="query" maxLength={500} /></label>
      <label><span>Discovery strategy *</span><select name="strategy" defaultValue="AGGREGATOR_SEARCH">{DISCOVERY_STRATEGIES.map((strategy) => <option key={strategy}>{strategy}</option>)}</select></label>
      <label><span>Notes</span><input name="notes" maxLength={4000} /></label>
    </div>
    <div className="radar-filter-actions"><button type="submit" disabled={pending}>{pending ? "Recording…" : "Record manual miss"}</button></div>
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
  </form>;
}
