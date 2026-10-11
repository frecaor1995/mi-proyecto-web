import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const EXPECTED_HEAD = "dd91abc53056a79c8ffc7ef1d4e0f0d8a484a5d1";
const EXPECTED_BRANCH = "feat/fly-workforce-radar";
const EXPECTED_SOURCE_COUNT = 31;
const LOCAL_DB = { host: "127.0.0.1", port: 55422, database: "postgres", user: "postgres", password: "postgres" } as const;
const REQUIRED_HEADERS = ["WORKER ID", "FULL NAME", "TRADE", "LEVEL", "YEARS EXPERIENCE", "AVAILABILITY", "TDLR TYPE", "TDLR NUMBER", "TDLR EXPIRATION", "TDLR VERIFICATION", "OSHA", "WORK AUTH DOCUMENT STATUS", "CONSENT TO PRESENT", "EXPERIENCE SUMMARY", "IMPORT STATUS", "IMPORT NOTES"] as const;

type RawRow = { rowNumber: number; values: Record<string, string> };
type WorkbookPayload = {
  workbookPath: string;
  workbookTimestamp: string;
  sheets: string[];
  sourceRows: RawRow[];
  additionalDocuments: { rowNumber: number; workerId: string; documentType: string; expirationDate: string; verified: string }[];
  auxiliaryCounts: { entryWorkers: number; projectHistory: number; documents: number; documentAudit: number };
};

export type NormalizedWorker = {
  sourceRow: number;
  sourceWorkerId: string;
  displayName: string;
  tradeCode: "ELECTRICAL";
  occupationCode: "ELECTRICIAN";
  levelCode: "APPRENTICE" | "JOURNEYMAN" | "MASTER";
  experienceMonths: number;
  availability: "AVAILABLE";
  tdlrType: "APPRENTICE" | "JOURNEYMAN" | "MASTER" | null;
  credentialDesignation: "APPRENTICE_ELECTRICIAN" | "JOURNEYMAN_ELECTRICIAN" | "MASTER_ELECTRICIAN" | null;
  tdlrNumber: string;
  tdlrExpiration: string | null;
  tdlrVerification: "UNKNOWN";
  osha: "OSHA_10" | "OSHA_30" | null;
  workAuthorizationStatus: "UNKNOWN";
  candidatePresentationConsent: "UNKNOWN";
};

function normalizeKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function deterministicUuid(scope: string, key: string): string {
  const hex = createHash("sha256").update(`fly-workforce-radar:${scope}:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function excelDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const serial = Number(text);
  if (!Number.isFinite(serial)) throw new Error("INVALID_DATE");
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
}

function assertNoForbiddenData(row: RawRow): void {
  const safeFields = Object.entries(row.values).filter(([header]) => header !== "TDLR NUMBER");
  const forbidden = /\b(?:SSN|SOCIAL SECURITY|A[- ]?NUMBER|USCIS|EAD|GREEN CARD|PASSPORT|DRIVER.?LICENSE)\b|\b\d{3}-\d{2}-\d{4}\b/i;
  if (safeFields.some(([, value]) => forbidden.test(value))) throw new Error(`FORBIDDEN_DATA_ROW_${row.rowNumber}`);
}

export function normalizeRows(rows: RawRow[]): NormalizedWorker[] {
  if (rows.length !== EXPECTED_SOURCE_COUNT) throw new Error(`SOURCE_COUNT_${rows.length}`);
  const workers = rows.map((row): NormalizedWorker => {
    assertNoForbiddenData(row);
    for (const header of REQUIRED_HEADERS) if (!(header in row.values)) throw new Error(`MISSING_HEADER_${header}`);
    const id = row.values["WORKER ID"].trim();
    const name = row.values["FULL NAME"].trim();
    const level = row.values.LEVEL.trim().toUpperCase();
    const years = Number(row.values["YEARS EXPERIENCE"]);
    const oshaRaw = row.values.OSHA.trim().toUpperCase();
    if (!id || !name) throw new Error(`MISSING_IDENTITY_ROW_${row.rowNumber}`);
    if (row.values.TRADE.trim().toUpperCase() !== "ELECTRICAL") throw new Error(`UNSUPPORTED_TRADE_ROW_${row.rowNumber}`);
    if (!["APPRENTICE", "JOURNEYMAN", "MASTER"].includes(level)) throw new Error(`UNSUPPORTED_LEVEL_ROW_${row.rowNumber}`);
    if (!Number.isFinite(years) || years < 0 || !Number.isInteger(years)) throw new Error(`INVALID_EXPERIENCE_ROW_${row.rowNumber}`);
    if (row.values.AVAILABILITY.trim().toUpperCase() !== "AVAILABLE_NOW") throw new Error(`UNSUPPORTED_AVAILABILITY_ROW_${row.rowNumber}`);
    const tdlrType = row.values["TDLR TYPE"].trim().toUpperCase();
    if (tdlrType && !["APPRENTICE", "JOURNEYMAN", "MASTER"].includes(tdlrType)) throw new Error(`UNSUPPORTED_TDLR_TYPE_ROW_${row.rowNumber}`);
    if (!row.values["TDLR NUMBER"].trim()) throw new Error(`MISSING_TDLR_ROW_${row.rowNumber}`);
    if (row.values["TDLR VERIFICATION"].trim().toUpperCase() !== "UNKNOWN") throw new Error(`TDLR_VERIFICATION_CONFLICT_ROW_${row.rowNumber}`);
    if (oshaRaw && oshaRaw !== "OSHA_10" && oshaRaw !== "OSHA_30") throw new Error(`UNSUPPORTED_OSHA_ROW_${row.rowNumber}`);
    if (row.values["WORK AUTH DOCUMENT STATUS"].trim().toUpperCase() !== "UNKNOWN") throw new Error(`WORK_AUTH_CONFLICT_ROW_${row.rowNumber}`);
    if (row.values["CONSENT TO PRESENT"].trim().toUpperCase() !== "UNKNOWN") throw new Error(`CONSENT_CONFLICT_ROW_${row.rowNumber}`);
    return {
      sourceRow: row.rowNumber, sourceWorkerId: id, displayName: name, tradeCode: "ELECTRICAL", occupationCode: "ELECTRICIAN",
      levelCode: level as NormalizedWorker["levelCode"], experienceMonths: years * 12, availability: "AVAILABLE", tdlrType: tdlrType ? tdlrType as NormalizedWorker["tdlrType"] : null,
      credentialDesignation: tdlrType ? `${tdlrType}_ELECTRICIAN` as NormalizedWorker["credentialDesignation"] : null,
      tdlrNumber: row.values["TDLR NUMBER"].trim(), tdlrExpiration: excelDate(row.values["TDLR EXPIRATION"]),
      tdlrVerification: "UNKNOWN", osha: oshaRaw ? oshaRaw as "OSHA_10" | "OSHA_30" : null, workAuthorizationStatus: "UNKNOWN", candidatePresentationConsent: "UNKNOWN",
    };
  });
  const ids = new Set(workers.map((worker) => normalizeKey(worker.sourceWorkerId)));
  const names = new Set(workers.map((worker) => normalizeKey(worker.displayName)));
  if (ids.size !== EXPECTED_SOURCE_COUNT) throw new Error("DUPLICATE_SOURCE_WORKER_ID");
  if (names.size !== EXPECTED_SOURCE_COUNT) throw new Error("DUPLICATE_SOURCE_NAME");
  return workers;
}

function readWorkbook(workbookPath: string): WorkbookPayload {
  const script = resolve(fileURLToPath(new URL("./read-workbook.ps1", import.meta.url)));
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-WorkbookPath", resolve(workbookPath)], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("WORKBOOK_READ_FAILED");
  try { return JSON.parse(result.stdout.trim()) as WorkbookPayload; } catch { throw new Error("WORKBOOK_PARSE_FAILED"); }
}

function gitValue(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error("GIT_GUARD_FAILED");
  return result.stdout.trim();
}

async function dryRun(client: Client, workers: NormalizedWorker[], payload: WorkbookPayload) {
  const expectedIds = workers.map((worker) => deterministicUuid("worker", normalizeKey(worker.sourceWorkerId)));
  const existing = await client.query<{ id: string; display_name: string; source_of_record: string }>("select id,display_name,source_of_record from workforce_workers order by id");
  const byId = new Map(existing.rows.map((row) => [row.id, row]));
  const byName = new Map(existing.rows.map((row) => [normalizeKey(row.display_name), row]));
  const conflicts = workers.filter((worker, index) => {
    const idMatch = byId.get(expectedIds[index]);
    const nameMatch = byName.get(normalizeKey(worker.displayName));
    return (idMatch && normalizeKey(idMatch.display_name) !== normalizeKey(worker.displayName)) || (nameMatch && nameMatch.id !== expectedIds[index]);
  });
  const demoCount = existing.rows.filter((row) => /\bdemo\b/i.test(row.display_name)).length;
  const alreadyImported = expectedIds.filter((id) => byId.has(id)).length;
  const extraDocuments = payload.additionalDocuments.filter((document) => ["FORKLIFT OPERATOR", "HEAVY EARTH MOVING EQUIPMENT OPERATOR"].includes(document.documentType));
  const sourceIds = new Set(workers.map((worker) => normalizeKey(worker.sourceWorkerId)));
  if (extraDocuments.some((document) => !sourceIds.has(normalizeKey(document.workerId)))) throw new Error("ADDITIONAL_DOCUMENT_IDENTITY_CONFLICT");
  if (conflicts.length) throw new Error(`CANONICAL_IDENTITY_CONFLICTS_${conflicts.length}`);
  return {
    sourceWorkers: workers.length,
    uniqueWorkerIds: new Set(workers.map((worker) => normalizeKey(worker.sourceWorkerId))).size,
    uniqueNames: new Set(workers.map((worker) => normalizeKey(worker.displayName))).size,
    existingCanonicalMatches: alreadyImported,
    newCanonicalWorkers: workers.length - alreadyImported,
    canonicalConflicts: conflicts.length,
    demoWorkersPreserved: demoCount,
    apprentice: workers.filter((worker) => worker.levelCode === "APPRENTICE").length,
    journeyman: workers.filter((worker) => worker.levelCode === "JOURNEYMAN").length,
    electricalLicenses: workers.length,
    osha10: workers.filter((worker) => worker.osha === "OSHA_10").length,
    osha30: workers.filter((worker) => worker.osha === "OSHA_30").length,
    oshaUnknown: workers.filter((worker) => worker.osha === null).length,
    tdlrVerified: 0,
    unknownConsent: workers.length,
    unknownWorkAuthorization: workers.length,
    excludedSensitiveIdentifiers: true,
    additionalUnverifiedDocuments: extraDocuments.length,
    sheets: payload.sheets,
    auxiliaryCounts: payload.auxiliaryCounts,
  };
}

async function applyImport(client: Client, workers: NormalizedWorker[], payload: WorkbookPayload): Promise<void> {
  await client.query("begin isolation level serializable");
  try {
    await client.query("select pg_advisory_xact_lock($1)", [310031]);
    const effectiveAt = payload.workbookTimestamp;
    for (const worker of workers) {
      const key = normalizeKey(worker.sourceWorkerId);
      const workerId = deterministicUuid("worker", key);
      await client.query("insert into workforce_workers(id,display_name,lifecycle_status,profile_verification_state,source_of_record,first_seen_at,last_seen_at) values($1,$2,'ACTIVE','UNVERIFIED','IMPORTED',$3,$3) on conflict(id) do update set display_name=excluded.display_name,lifecycle_status='ACTIVE',profile_verification_state='UNVERIFIED',verified_at=null,source_of_record='IMPORTED',last_seen_at=excluded.last_seen_at,updated_at=now()", [workerId, worker.displayName, effectiveAt]);
      await client.query("insert into worker_trade_occupations(worker_id,trade_code,occupation_code,role_designation,experience_months,verification_state) values($1,'ELECTRICAL','ELECTRICIAN','PRIMARY',$2,'UNVERIFIED') on conflict(worker_id,occupation_code,trade_code) do update set role_designation='PRIMARY',experience_months=excluded.experience_months,verification_state='UNVERIFIED',source_evidence_id=null", [workerId, worker.experienceMonths]);
      await client.query("insert into worker_level_assignments(id,worker_id,trade_code,occupation_code,level_code,verification_state,source,effective_at) values($1,$2,'ELECTRICAL','ELECTRICIAN',$3,'UNVERIFIED','OPERATOR_ENTERED',$4) on conflict(id) do update set level_code=excluded.level_code,verification_state='UNVERIFIED',source='OPERATOR_ENTERED',effective_at=excluded.effective_at", [deterministicUuid("level", key), workerId, worker.levelCode, effectiveAt]);
      await client.query("insert into worker_credentials(id,worker_id,credential_code,verification_state,verified_at,expires_at,issuing_authority,credential_designation,professional_license_number,jurisdiction,lifecycle_status,raw_identifier) values($1,$2,'ELECTRICAL_LICENSE','UNVERIFIED',null,$3,'Texas Department of Licensing and Regulation',$4,$5,'TX','CURRENT',$5) on conflict(id) do update set verification_state='UNVERIFIED',verified_at=null,expires_at=excluded.expires_at,issuing_authority=excluded.issuing_authority,credential_designation=excluded.credential_designation,professional_license_number=excluded.professional_license_number,jurisdiction='TX',lifecycle_status='CURRENT',raw_identifier=excluded.raw_identifier,source_evidence_id=null", [deterministicUuid("credential-tdlr", key), workerId, worker.tdlrExpiration, worker.credentialDesignation, worker.tdlrNumber]);
      if (worker.osha) await client.query("insert into worker_credentials(id,worker_id,credential_code,verification_state,verified_at,issuing_authority,jurisdiction,lifecycle_status,raw_identifier) values($1,$2,$3,'UNVERIFIED',null,'Occupational Safety and Health Administration','US','CURRENT',null) on conflict(id) do update set credential_code=excluded.credential_code,verification_state='UNVERIFIED',verified_at=null,issuing_authority=excluded.issuing_authority,jurisdiction='US',lifecycle_status='CURRENT',raw_identifier=null,source_evidence_id=null", [deterministicUuid(`credential-${worker.osha.toLowerCase()}`, key), workerId, worker.osha]);
      await client.query("insert into worker_availability(id,worker_id,status,source,effective_at,verification_state) values($1,$2,'AVAILABLE','OPERATOR_ENTERED',$3,'UNVERIFIED') on conflict(id) do update set status='AVAILABLE',source='OPERATOR_ENTERED',effective_at=excluded.effective_at,verification_state='UNVERIFIED'", [deterministicUuid("availability", key), workerId, effectiveAt]);
      for (const purpose of ["DATA_USE", "CANDIDATE_PRESENTATION"] as const) await client.query("insert into worker_consents(id,worker_id,purpose,state,captured_at,source,recorded_by_operator_id,effective_at) values($1,$2,$3,'UNKNOWN',null,null,null,$4) on conflict(id) do update set state='UNKNOWN',captured_at=null,source=null,recorded_by_operator_id=null,effective_at=excluded.effective_at", [deterministicUuid(`consent-${purpose.toLowerCase()}`, key), workerId, purpose, effectiveAt]);
      await client.query("insert into worker_document_readiness(id,worker_id,document_type,readiness_state,verification_state,effective_at) values($1,$2,'WORK_AUTHORIZATION','UNKNOWN','UNVERIFIED',$3) on conflict(id) do update set readiness_state='UNKNOWN',verification_state='UNVERIFIED',expires_at=null,source_evidence_id=null,effective_at=excluded.effective_at", [deterministicUuid("document-work-authorization", key), workerId, effectiveAt]);
    }
    for (const document of payload.additionalDocuments) {
      const key = normalizeKey(document.workerId);
      const workerId = deterministicUuid("worker", key);
      const documentType = document.documentType.replaceAll(" ", "_");
      await client.query("insert into worker_document_readiness(id,worker_id,document_type,readiness_state,expires_at,verification_state,effective_at) values($1,$2,$3,'REQUIRES_VERIFICATION',$4,'UNVERIFIED',$5) on conflict(id) do update set readiness_state='REQUIRES_VERIFICATION',expires_at=excluded.expires_at,verification_state='UNVERIFIED',source_evidence_id=null,effective_at=excluded.effective_at", [deterministicUuid(`document-${documentType.toLowerCase()}`, key), workerId, documentType, excelDate(document.expirationDate), effectiveAt]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workbookIndex = args.indexOf("--workbook");
  const workbookPath = workbookIndex >= 0 ? args[workbookIndex + 1] : "";
  const apply = args.includes("--apply");
  if (!workbookPath) throw new Error("WORKBOOK_REQUIRED");
  if (gitValue(["rev-parse", "HEAD"]) !== EXPECTED_HEAD || gitValue(["branch", "--show-current"]) !== EXPECTED_BRANCH) throw new Error("GIT_IDENTITY_MISMATCH");
  const payload = readWorkbook(workbookPath);
  const workers = normalizeRows(payload.sourceRows);
  const client = new Client(LOCAL_DB);
  await client.connect();
  try {
    const preview = await dryRun(client, workers, payload);
    console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", workbook: resolve(workbookPath), preview }, null, 2));
    if (apply) {
      await applyImport(client, workers, payload);
      console.log(JSON.stringify({ applied: workers.length, remoteActions: 0 }));
    }
  } finally { await client.end(); }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message.replace(/[^A-Z0-9_]/gi, "_").slice(0, 120) : "UNKNOWN_FAILURE";
  console.error(`WORKFORCE_IMPORT_FAILED:${code}`);
  process.exitCode = 1;
});
