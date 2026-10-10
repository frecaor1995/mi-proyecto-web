import { createHash } from "node:crypto";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresSourceRepository } from "../repositories/source/postgres-source-repository";
import { validateProjectSignalPayload, type PayloadValidation, type ProjectSignalRecord } from "../../domain/project-signal-contract";

/**
 * Staffing commercial intelligence — import of `fly.project-signal` v1 records (read-only evidence).
 *
 * - Each valid record is stored once in raw_evidence (kind PROJECT_SIGNAL) with its source identifiers.
 * - Same sourceSystem + sourceRecordId + content → DUPLICATE (nothing written).
 * - Same identifiers with different content → NEW_VERSION, linked to the previous one in evidence_supersessions.
 * - Nothing is fetched, no company is created, and no project or company role exists until a person confirms a link.
 */
export const PROJECT_SIGNAL_KIND = "PROJECT_SIGNAL";
export const PROJECT_SIGNAL_LINK_KIND = "PROJECT_SIGNAL_LINK";
const SOURCE_NAME = "Fly Workforce Radar project-signal import";
export const LINKABLE_ROLES = ["OWNER", "EPC", "GC", "ELECTRICAL_CONTRACTOR", "EMPLOYER"] as const;
export type LinkableRole = (typeof LINKABLE_ROLES)[number];

export type ImportOutcome = "CREATED" | "NEW_VERSION" | "DUPLICATE" | "REJECTED";
export interface ImportResult {
  readonly validation: PayloadValidation;
  readonly results: readonly { readonly index: number; readonly sourceRecordId: string | null; readonly outcome: ImportOutcome; readonly evidenceId: string | null; readonly version: number | null; readonly errors: readonly string[]; readonly warnings: readonly string[] }[];
}

export class ProjectSignalLinkError extends Error {
  constructor(readonly code: "notFound" | "superseded" | "companyNotFound" | "demoRealMismatch" | "noteRequired" | "invalidRole" | "projectNameRequired" | "officialSourceRequired") { super(code); }
}

const normalize = (value: string) => value.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|co|corp|group|ltd|lp)\b/g, " ").replace(/\s+/g, " ").trim();
const isDemoName = (value: string) => /\bDEMO LOCAL\b/i.test(value);

async function importSourceId(db: SqlClient, at: Date) {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [SOURCE_NAME]);
  const sources = new PostgresSourceRepository(db);
  const source = await sources.findByName(SOURCE_NAME) ?? await sources.create({
    name: SOURCE_NAME, sourceType: "OTHER", accessClassification: "RESTRICTED", enabled: true, requiresAuth: true, paywalled: false,
    sourceMetadata: { purpose: "operator-imported fly.project-signal records (no network access)" }, firstSeenAt: at, lastSeenAt: at,
  });
  return source.id;
}

export async function importProjectSignals(db: SqlClient, payload: unknown, operatorId: string, now = new Date()): Promise<ImportResult> {
  const validation = validateProjectSignalPayload(payload);
  const results: ImportResult["results"][number][] = [];
  if (validation.state === "REJECTED" && !validation.records.length) return { validation, results };
  const sourceId = await importSourceId(db, now);
  for (const r of validation.records) {
    if (!r.record || !r.contentHash) { results.push({ index: r.index, sourceRecordId: null, outcome: "REJECTED", evidenceId: null, version: null, errors: r.errors, warnings: r.warnings }); continue; }
    const rec = r.record;
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`project-signal:${rec.sourceSystem}:${rec.sourceRecordId}`]);
    const previous = (await db.query<{ id: string; hash: string; version: string }>(
      `select id,metadata->>'contentHash' hash,metadata->>'version' version from raw_evidence
        where metadata->>'kind'=$1 and metadata->>'sourceSystem'=$2 and metadata->>'sourceRecordId'=$3
        order by (metadata->>'version')::int desc limit 1`, [PROJECT_SIGNAL_KIND, rec.sourceSystem, rec.sourceRecordId])).rows[0];
    if (previous && previous.hash === r.contentHash) {
      results.push({ index: r.index, sourceRecordId: rec.sourceRecordId, outcome: "DUPLICATE", evidenceId: previous.id, version: Number(previous.version), errors: [], warnings: r.warnings });
      continue;
    }
    const version = previous ? Number(previous.version) + 1 : 1;
    const metadata = {
      kind: PROJECT_SIGNAL_KIND, contract: "fly.project-signal", contractVersion: validation.contractVersion, producer: validation.producer,
      sourceSystem: rec.sourceSystem, sourceRecordId: rec.sourceRecordId, contentHash: r.contentHash, version, supersedesEvidenceId: previous?.id ?? null,
      dataClass: rec.dataClass, validationState: r.state, warnings: r.warnings, record: rec, importedByOperatorId: operatorId, importedAt: now.toISOString(), networkAccess: false,
    };
    const payloadText = JSON.stringify(metadata);
    const evidence = (await db.query<{ id: string }>(
      `insert into raw_evidence(source_id,source_url,captured_at,capture_method,content_hash,extractor_version,metadata,content_type,payload_size_bytes)
       values($1,$2,$3,'MANUAL',$4,'project-signal@1',$5::jsonb,'application/json',$6) returning id`,
      [sourceId, (rec.officialSourceUrl ?? `urn:fly-workforce-radar:project-signal:${rec.sourceSystem}:${rec.sourceRecordId}`).slice(0, 2000), new Date(rec.observedAt).toISOString(),
        createHash("sha256").update(payloadText).digest("hex"), payloadText, Buffer.byteLength(payloadText)])).rows[0];
    if (previous) await db.query("insert into evidence_supersessions(superseded_evidence_id,superseding_evidence_id,reason) values($1,$2,$3)",
      [previous.id, evidence.id, `fly.project-signal new version ${version} of ${rec.sourceSystem}:${rec.sourceRecordId}`]);
    results.push({ index: r.index, sourceRecordId: rec.sourceRecordId, outcome: previous ? "NEW_VERSION" : "CREATED", evidenceId: evidence.id, version, errors: [], warnings: r.warnings });
  }
  return { validation, results };
}

export interface ProjectSignalView {
  readonly evidenceId: string;
  readonly version: number;
  readonly versions: number;
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly contractVersion: string | null;
  readonly record: ProjectSignalRecord;
  readonly dataClass: "REAL" | "DEMO";
  readonly validationState: string;
  readonly warnings: readonly string[];
  readonly importedAt: string;
  readonly importedBy: string | null;
  /** Human link decision for THIS version (null = pending). */
  readonly link: { readonly companyId: string; readonly companyName: string | null; readonly role: string; readonly projectId: string | null; readonly companyRoleId: string | null; readonly note: string; readonly decidedAt: string; readonly decidedBy: string | null } | null;
  /** Link of an earlier version, shown as history (never applied to a new version automatically). */
  readonly previousLink: { readonly version: number; readonly companyName: string | null } | null;
  /** Exact normalized-name match among canonical companies (a suggestion only). */
  readonly suggestedCompany: { readonly id: string; readonly name: string } | null;
}

/** Latest version of every imported record, with its link decision and a company suggestion. */
export async function loadProjectSignals(db: SqlClient): Promise<readonly ProjectSignalView[]> {
  const rows = (await db.query<{ id: string; metadata: Record<string, unknown>; versions: string; importer: string | null; rn: string }>(
    `select e.id,e.metadata,count(*) over (partition by e.metadata->>'sourceSystem',e.metadata->>'sourceRecordId') versions,
       coalesce(o.display_name,o.email) importer,
       row_number() over (partition by e.metadata->>'sourceSystem',e.metadata->>'sourceRecordId' order by (e.metadata->>'version')::int desc) rn
       from raw_evidence e left join workforce_operators o on o.id::text=e.metadata->>'importedByOperatorId'
      where e.metadata->>'kind'=$1`, [PROJECT_SIGNAL_KIND])).rows;
  const links = (await db.query<{ id: string; metadata: Record<string, unknown>; company_name: string | null; decider: string | null }>(
    `select e.id,e.metadata,coalesce(c.common_name,c.legal_name) company_name,coalesce(o.display_name,o.email) decider from raw_evidence e
       left join companies c on c.id::text=e.metadata->>'companyId' left join workforce_operators o on o.id::text=e.metadata->>'decidedByOperatorId'
      where e.metadata->>'kind'=$1 order by e.metadata->>'decidedAt' desc`, [PROJECT_SIGNAL_LINK_KIND])).rows;
  const companies = (await db.query<{ id: string; name: string }>("select id,coalesce(common_name,legal_name) name from companies where merged_into_company_id is null")).rows;
  const all = rows.map((r) => ({ ...r, version: Number(r.metadata.version) }));
  return all.filter((r) => Number(r.rn) === 1).map((r) => {
    const m = r.metadata;
    const record = m.record as ProjectSignalRecord;
    const link = links.find((l) => l.metadata.signalEvidenceId === r.id);
    const earlier = all.filter((x) => x.metadata.sourceSystem === m.sourceSystem && x.metadata.sourceRecordId === m.sourceRecordId && x.version < r.version)
      .map((x) => ({ version: x.version, l: links.find((l) => l.metadata.signalEvidenceId === x.id) })).filter((x) => x.l).sort((a, b) => b.version - a.version)[0];
    const match = companies.find((c) => normalize(c.name) === normalize(record.company.name));
    return {
      evidenceId: r.id, version: r.version, versions: Number(r.versions), sourceSystem: String(m.sourceSystem), sourceRecordId: String(m.sourceRecordId), contractVersion: m.contractVersion == null ? null : String(m.contractVersion),
      record, dataClass: (m.dataClass === "DEMO" ? "DEMO" : "REAL") as "REAL" | "DEMO", validationState: String(m.validationState ?? ""), warnings: Array.isArray(m.warnings) ? m.warnings.map(String) : [],
      importedAt: String(m.importedAt ?? ""), importedBy: r.importer,
      link: link ? { companyId: String(link.metadata.companyId), companyName: link.company_name, role: String(link.metadata.role), projectId: link.metadata.projectId == null ? null : String(link.metadata.projectId),
        companyRoleId: link.metadata.companyRoleId == null ? null : String(link.metadata.companyRoleId), note: String(link.metadata.note ?? ""), decidedAt: String(link.metadata.decidedAt ?? ""), decidedBy: link.decider } : null,
      previousLink: earlier ? { version: earlier.version, companyName: earlier.l!.company_name } : null,
      suggestedCompany: match ?? null,
    };
  }).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

/**
 * Explicit human confirmation that an imported record refers to an existing company. Only then — and only when the record
 * has an official source and a project name — are a project (reused when the same name/state exists) and a company role
 * created. Companies are never created here. DEMO records link only to DEMO LOCAL companies and REAL records never do.
 */
export async function confirmProjectSignalLink(db: SqlClient, input: { readonly evidenceId: string; readonly companyId: string; readonly role: string; readonly createProjectAndRole: boolean; readonly note: string; readonly operatorId: string; readonly now: Date }) {
  const note = input.note.trim();
  if (!note) throw new ProjectSignalLinkError("noteRequired");
  const role = LINKABLE_ROLES.find((r) => r === input.role);
  if (!role) throw new ProjectSignalLinkError("invalidRole");
  const signal = (await db.query<{ id: string; metadata: Record<string, unknown> }>("select id,metadata from raw_evidence where id=$1 and metadata->>'kind'=$2", [input.evidenceId, PROJECT_SIGNAL_KIND])).rows[0];
  if (!signal) throw new ProjectSignalLinkError("notFound");
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`project-signal-link:${signal.id}`]);
  const newer = await db.query<{ id: string }>(`select id from raw_evidence where metadata->>'kind'=$1 and metadata->>'sourceSystem'=$2 and metadata->>'sourceRecordId'=$3 and (metadata->>'version')::int>$4 limit 1`,
    [PROJECT_SIGNAL_KIND, signal.metadata.sourceSystem, signal.metadata.sourceRecordId, Number(signal.metadata.version)]);
  if (newer.rows[0]) throw new ProjectSignalLinkError("superseded");
  const company = (await db.query<{ id: string; name: string }>("select id,coalesce(common_name,legal_name) name from companies where id=$1 and merged_into_company_id is null", [input.companyId])).rows[0];
  if (!company) throw new ProjectSignalLinkError("companyNotFound");
  const record = signal.metadata.record as ProjectSignalRecord;
  if ((record.dataClass === "DEMO") !== isDemoName(company.name)) throw new ProjectSignalLinkError("demoRealMismatch");
  const existing = (await db.query<{ id: string; metadata: Record<string, unknown> }>(
    "select id,metadata from raw_evidence where metadata->>'kind'=$1 and metadata->>'signalEvidenceId'=$2 and metadata->>'companyId'=$3 limit 1",
    [PROJECT_SIGNAL_LINK_KIND, signal.id, company.id])).rows[0];
  if (existing) return { outcome: "ALREADY_LINKED" as const, linkEvidenceId: existing.id, projectId: (existing.metadata.projectId as string | null) ?? null, companyRoleId: (existing.metadata.companyRoleId as string | null) ?? null };

  let projectId: string | null = null, companyRoleId: string | null = null;
  if (input.createProjectAndRole) {
    const projectName = record.project.name.value;
    if (!projectName) throw new ProjectSignalLinkError("projectNameRequired");
    if (!record.officialSourceUrl) throw new ProjectSignalLinkError("officialSourceRequired");
    const at = new Date(record.observedAt).toISOString();
    const location = [record.project.city.value, record.project.county.value, record.project.state.value].filter(Boolean).join(", ") || null;
    projectId = (await db.query<{ id: string }>(
      `select id from projects where lower(name)=lower($1) and coalesce(state,'')=coalesce($2,'') and coalesce(lower(city),'')=coalesce(lower($3),'') order by created_at limit 1`,
      [projectName, record.project.state.value, record.project.city.value])).rows[0]?.id
      ?? (await db.query<{ id: string }>("insert into projects(name,location_text,city,county,state,first_seen_at,last_seen_at) values($1,$2,$3,$4,$5,$6,$6) returning id",
        [projectName, location, record.project.city.value, record.project.county.value, record.project.state.value, at])).rows[0].id;
    // FACT only when the record itself states the role; a human-chosen role without it stays an INFERENCE
    const assertion = record.company.role ? "FACT" : "INFERENCE";
    await db.query(
      `insert into company_roles(company_id,role,project_id,raw_evidence_id,assertion_kind,verification_state,asserted_by,role_basis,role_metadata,first_seen_at,last_seen_at)
       values($1,$2::company_role_kind,$3,$4,$5::assertion_kind,'VERIFIED',$6,'PROJECT_SIGNAL_HUMAN_LINK',$7::jsonb,$8,$8) on conflict do nothing`,
      [company.id, role, projectId, signal.id, assertion, `operator:${input.operatorId}`,
        JSON.stringify({ projectSignalEvidenceId: signal.id, sourceSystem: signal.metadata.sourceSystem, sourceRecordId: signal.metadata.sourceRecordId, stage: record.company.stage, contractVersion: signal.metadata.contractVersion }), at]);
    companyRoleId = (await db.query<{ id: string }>("select id from company_roles where company_id=$1 and role=$2::company_role_kind and project_id=$3 and assertion_kind=$4::assertion_kind",
      [company.id, role, projectId, assertion])).rows[0]?.id ?? null;
  }
  const metadata = { kind: PROJECT_SIGNAL_LINK_KIND, signalEvidenceId: signal.id, sourceSystem: signal.metadata.sourceSystem, sourceRecordId: signal.metadata.sourceRecordId, version: signal.metadata.version,
    companyId: company.id, role, projectId, companyRoleId, note, decidedByOperatorId: input.operatorId, decidedAt: input.now.toISOString(), dataClass: record.dataClass };
  const payloadText = JSON.stringify(metadata);
  const link = (await db.query<{ id: string }>(
    `insert into raw_evidence(source_id,source_url,captured_at,capture_method,content_hash,extractor_version,metadata,content_type,payload_size_bytes)
     values($1,$2,$3,'HUMAN_INTERACTION',$4,'project-signal-link@1',$5::jsonb,'application/json',$6) returning id`,
    [await importSourceId(db, input.now), `urn:fly-workforce-radar:project-signal-link:${signal.id}:${company.id}`, input.now.toISOString(), createHash("sha256").update(payloadText).digest("hex"), payloadText, Buffer.byteLength(payloadText)])).rows[0];
  return { outcome: "LINKED" as const, linkEvidenceId: link.id, projectId, companyRoleId };
}
