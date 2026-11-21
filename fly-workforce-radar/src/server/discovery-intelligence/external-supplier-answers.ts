import { createHash } from "node:crypto";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { COMPANY_ATS_CATALOG } from "../../domain/company-ats-catalog";
import { latestSupplierAnswer, validateSupplierAnswer, type RecordedSupplierAnswer, type SupplierAnswer, type SupplierAnswerErrors, type SupplierAnswerInput } from "../../domain/external-supplier-answer";
import { manualSourceId } from "./assisted-posting-capture";

/**
 * Recipe 2.2 — "Does the company use external suppliers or agencies to hire electrical staff?"
 * Each answer is operator-recorded, append-only evidence (raw_evidence, MANUAL capture through the same manual
 * commercial-intake source Phase 3A uses). The latest answer per company is the current one; earlier ones stay as
 * history. Nothing here creates a company, a contact, an opportunity, a client or a staff request.
 */
export const SUPPLIER_ANSWER_KIND = "EXTERNAL_SUPPLIER_ANSWER";

export class SupplierAnswerValidationError extends Error {
  constructor(readonly errors: SupplierAnswerErrors) { super(`Invalid supplier answer: ${Object.keys(errors).join(", ")}`); }
}

const clean = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);
const normalize = (value: string) => value.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|co|corp|group)\b/g, " ").replace(/\s+/g, " ").trim();

/** Catalog key for a company name (exact normalized name match only; no fuzzy matching). */
export const catalogKeyForName = (name: string) => COMPANY_ATS_CATALOG.find((t) => normalize(t.name) === normalize(name))?.key ?? null;

export async function recordSupplierAnswer(db: SqlClient, input: SupplierAnswerInput, operatorId: string, now = new Date()) {
  const errors = validateSupplierAnswer(input, now);
  if (input.catalogKey && !COMPANY_ATS_CATALOG.some((t) => t.key === input.catalogKey)) errors.subject = "unknownCatalogKey";
  if (input.companyId) {
    const company = await db.query<{ id: string }>("select id from companies where id=$1 and merged_into_company_id is null", [input.companyId]);
    if (!company.rows[0]) errors.subject = "unknownCompany";
  }
  if (Object.keys(errors).length) throw new SupplierAnswerValidationError(errors);
  const fields = {
    answer: input.answer as SupplierAnswer, catalogKey: clean(input.catalogKey), companyId: clean(input.companyId), companyName: input.companyName.trim(),
    conversationDate: clean(input.conversationDate), responderName: clean(input.responderName), responderRole: clean(input.responderRole), channel: clean(input.channel),
    summary: clean(input.summary), evidenceReference: clean(input.evidenceReference), nextAction: clean(input.nextAction),
  };
  const metadata = { kind: SUPPLIER_ANSWER_KIND, operatorRecorded: true, recordedByOperatorId: operatorId, recordedAt: now.toISOString(), ...fields };
  const payload = JSON.stringify(metadata);
  const subject = fields.catalogKey ?? fields.companyId!;
  const reference = /^https:\/\//i.test(fields.evidenceReference ?? "") ? fields.evidenceReference! : `urn:fly-workforce-radar:external-supplier-answer:${subject}:${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
  const row = (await db.query<{ id: string }>(
    `insert into raw_evidence(source_id,source_url,captured_at,capture_method,content_hash,extractor_version,metadata,content_type,payload_size_bytes)
     values($1,$2,$3,'MANUAL',$4,'supplier-answer@1',$5::jsonb,'application/json',$6) returning id`,
    [await manualSourceId(db, now), reference.slice(0, 2000), now.toISOString(), createHash("sha256").update(payload).digest("hex"), payload, Buffer.byteLength(payload)])).rows[0];
  return { evidenceId: row.id, ...fields };
}

/** Every recorded answer (newest first), optionally for one company (catalog key, canonical id or exact name). */
export async function loadSupplierAnswers(db: SqlClient, subject?: { readonly catalogKey?: string | null; readonly companyId?: string | null; readonly companyName?: string | null }): Promise<readonly RecordedSupplierAnswer[]> {
  const rows = (await db.query<{ id: string; metadata: Record<string, unknown>; display: string | null }>(
    `select e.id,e.metadata,coalesce(o.display_name,o.email) display from raw_evidence e
       left join workforce_operators o on o.id::text=e.metadata->>'recordedByOperatorId'
      where e.metadata->>'kind'=$1 order by e.metadata->>'recordedAt' desc,e.id desc limit 500`, [SUPPLIER_ANSWER_KIND])).rows;
  const answers = rows.map((r): RecordedSupplierAnswer => {
    const m = r.metadata;
    const s = (key: string) => (m[key] == null ? null : String(m[key]));
    return { evidenceId: r.id, answer: m.answer as SupplierAnswer, catalogKey: s("catalogKey"), companyId: s("companyId"), companyName: String(m.companyName ?? ""), conversationDate: s("conversationDate"),
      responderName: s("responderName"), responderRole: s("responderRole"), channel: s("channel"), summary: s("summary"), evidenceReference: s("evidenceReference"), nextAction: s("nextAction"),
      recordedByOperatorId: String(m.recordedByOperatorId ?? ""), recordedBy: r.display, recordedAt: String(m.recordedAt ?? "") };
  });
  if (!subject) return answers;
  const key = subject.catalogKey ?? (subject.companyName ? catalogKeyForName(subject.companyName) : null);
  return answers.filter((a) => (key && a.catalogKey === key) || (subject.companyId && a.companyId === subject.companyId) || (subject.companyName && normalize(a.companyName) === normalize(subject.companyName)));
}

/** Current (latest) answer per company key. */
export function currentAnswersByKey(answers: readonly RecordedSupplierAnswer[]): ReadonlyMap<string, RecordedSupplierAnswer> {
  const groups = new Map<string, RecordedSupplierAnswer[]>();
  for (const a of answers) { const key = a.catalogKey ?? a.companyId ?? normalize(a.companyName); groups.set(key, [...(groups.get(key) ?? []), a]); }
  return new Map([...groups].map(([key, list]) => [key, latestSupplierAnswer(list)!]));
}
