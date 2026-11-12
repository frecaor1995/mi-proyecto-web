import { createHash } from "node:crypto";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { safeFetchSource, type SafeFetchResult } from "./safe-fetch";
import { extractSource, type ExtractedSource } from "./source-text";

export type EnrichmentTrigger = "MANUAL" | "CYCLE" | "AUDIT";
export type EnrichmentStatus = "FETCHED" | "NO_TEXT" | Exclude<SafeFetchResult, { ok: true }>["failure"];

export interface EnrichmentRecord {
  readonly status: EnrichmentStatus;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  readonly title: string | null;
  readonly text: string | null;
  readonly structured: ExtractedSource["structured"] | Record<string, never>;
  readonly fetchedAt: string;
}

/** Below this, a "retrieved" document did not yield readable text (e.g. scanned or font-encoded PDFs). */
const MIN_TEXT_CHARS = 80;

/** Enough real words: font-encoded PDFs decode to symbol soup that must not be read as source text. */
export function isReadableText(text: string): boolean {
  if (text.length < MIN_TEXT_CHARS) return false;
  const sample = text.slice(0, 4000);
  const letters = (sample.match(/[A-Za-z\s]/g) ?? []).length / sample.length;
  const words = (sample.match(/\b[A-Za-z]{3,}\b/g) ?? []).length;
  return letters > 0.7 && words >= 15;
}

export async function enrichSource(client: SqlClient, input: {
  readonly normalizedUrl: string; readonly url: string; readonly trigger: EnrichmentTrigger; readonly operatorId?: string | null;
  readonly fetcher?: (url: string) => Promise<SafeFetchResult>;
}): Promise<EnrichmentRecord> {
  const fetched = await (input.fetcher ?? ((url: string) => safeFetchSource(url)))(input.url);
  let record: Omit<EnrichmentRecord, "fetchedAt">;
  let hash: string | null = null;
  let bytes: number | null = null;
  if (!fetched.ok) {
    record = { status: fetched.failure, finalUrl: fetched.finalUrl, httpStatus: fetched.status, contentType: fetched.contentType, title: null, text: null, structured: {} };
  } else {
    const extracted = extractSource(fetched.body, fetched.contentType);
    hash = createHash("sha256").update(fetched.body).digest("hex");
    bytes = fetched.body.byteLength;
    const readable = isReadableText(extracted.text) || Boolean(extracted.structured.jobPosting);
    record = { status: readable ? "FETCHED" : "NO_TEXT", finalUrl: fetched.finalUrl, httpStatus: fetched.status, contentType: fetched.contentType,
      title: extracted.title, text: readable ? extracted.text : null, structured: extracted.structured };
  }
  const inserted = await client.query<{ fetched_at: string | Date }>(
    `insert into discovery_source_enrichments(normalized_candidate_url,requested_url,final_url,status,http_status,content_type,page_title,extracted_text,
       structured,content_sha256,bytes,trigger,requested_by_operator_id)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13) returning fetched_at`,
    [input.normalizedUrl, input.url, record.finalUrl, record.status, record.httpStatus, record.contentType, record.title?.slice(0, 500) ?? null, record.text,
      JSON.stringify(record.structured), hash, bytes, input.trigger, input.operatorId ?? null],
  );
  return { ...record, fetchedAt: new Date(inserted.rows[0].fetched_at).toISOString() };
}

/** Bounded batch: at most `limit` pages, at most `perDomain` per host, spaced to be polite. */
export async function enrichBatch(client: SqlClient, targets: readonly { readonly normalizedUrl: string; readonly url: string }[], options: {
  readonly trigger: EnrichmentTrigger; readonly limit?: number; readonly perDomain?: number; readonly spacingMs?: number;
  readonly fetcher?: (url: string) => Promise<SafeFetchResult>;
}): Promise<readonly (EnrichmentRecord & { readonly normalizedUrl: string })[]> {
  const limit = Math.min(options.limit ?? 10, 50);
  const perDomain = options.perDomain ?? 3;
  const spacing = options.spacingMs ?? 1_000;
  const byDomain = new Map<string, number>();
  const results: (EnrichmentRecord & { readonly normalizedUrl: string })[] = [];
  for (const target of targets) {
    if (results.length >= limit) break;
    let host = "";
    try { host = new URL(target.url).hostname; } catch { host = ""; }
    if ((byDomain.get(host) ?? 0) >= perDomain) continue;
    byDomain.set(host, (byDomain.get(host) ?? 0) + 1);
    if (results.length && spacing > 0) await new Promise((resolve) => setTimeout(resolve, spacing));
    results.push({ ...(await enrichSource(client, { ...target, trigger: options.trigger, fetcher: options.fetcher })), normalizedUrl: target.normalizedUrl });
  }
  return results;
}

/**
 * After a discovery cycle: retrieve the original page for at most `limit` promising new findings of the latest
 * run (not generic noise, not already retrieved). Bounded like every enrichment; never a crawl.
 */
export async function enrichPromisingFromLatestRun(client: SqlClient, limit = 5): Promise<number> {
  const { listSignals } = await import("../opportunity-discovery/signals");
  const latest = await listSignals(client, "NEW", 200, "LATEST");
  if (latest.state !== "READY") return 0;
  const targets = latest.signals
    .filter((signal) => !signal.page && (signal.qualification.qualified || signal.qualification.noise === null || signal.qualification.noise === "NO_SOURCE_CONTEXT"))
    .slice(0, limit);
  if (!targets.length) return 0;
  const urls = await client.query<{ id: string; normalized_candidate_url: string }>(
    "select id, normalized_candidate_url from company_discovery_candidates where id = any($1::uuid[])", [targets.map((signal) => signal.candidateId)]);
  const normalized = new Map(urls.rows.map((row) => [row.id, row.normalized_candidate_url]));
  const done = await enrichBatch(client, targets.flatMap((signal) => normalized.get(signal.candidateId) ? [{ normalizedUrl: normalized.get(signal.candidateId)!, url: signal.url }] : []),
    { trigger: "CYCLE", limit, perDomain: 2 });
  return done.length;
}
