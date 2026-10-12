import { createHash } from "node:crypto";

/**
 * Staffing commercial intelligence — `fly.project-signal` v1.
 *
 * A versioned, validated JSON contract for project information produced elsewhere (e.g. by Fly Bid Radar) and
 * imported by an operator. Fly Workforce Radar never discovers tenders: it only reads what the file states.
 * Every optional fact carries its origin (OFFICIAL / ESTIMATED / UNKNOWN); a missing fact stays UNKNOWN and is never
 * filled in. Imported data is read-only: a change from the source arrives as a new version, never as an edit.
 */
export const PROJECT_SIGNAL_CONTRACT = "fly.project-signal" as const;
export const PROJECT_SIGNAL_MAJOR = 1;
export const PROJECT_SIGNAL_LIMITS = { records: 200, text: 300, url: 2000, trades: 20, quote: 300 } as const;

export const FACT_KINDS = ["OFFICIAL", "ESTIMATED", "UNKNOWN"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const SIGNAL_COMPANY_ROLES = ["OWNER", "GC", "ELECTRICAL_CONTRACTOR", "SUBCONTRACTOR", "OTHER"] as const;
export type SignalCompanyRole = (typeof SIGNAL_COMPANY_ROLES)[number];
export const SIGNAL_COMPANY_STAGES = ["PARTICIPANT", "AWARDEE", "UNKNOWN"] as const;
export type SignalCompanyStage = (typeof SIGNAL_COMPANY_STAGES)[number];

export interface Fact<T> { readonly value: T | null; readonly kind: FactKind; readonly evidenceRef: string | null }

export interface ProjectSignalRecord {
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly observedAt: string;
  readonly officialSourceUrl: string | null;
  readonly dataClass: "REAL" | "DEMO";
  readonly company: { readonly name: string; readonly role: SignalCompanyRole | null; readonly stage: SignalCompanyStage };
  readonly project: { readonly name: Fact<string>; readonly city: Fact<string>; readonly county: Fact<string>; readonly state: Fact<string>; readonly workType: Fact<string>; readonly trades: Fact<readonly string[]> };
  readonly contractStatus: Fact<string>;
  readonly startDate: Fact<string>;
  readonly endDate: Fact<string>;
  readonly duration: Fact<string>;
}

export type ValidationState = "VALID" | "VALID_WITH_WARNINGS" | "REJECTED";
export interface RecordValidation {
  readonly index: number;
  readonly state: ValidationState;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly record: ProjectSignalRecord | null;
  readonly contentHash: string | null;
}
export interface PayloadValidation {
  readonly state: ValidationState;
  readonly contractVersion: string | null;
  readonly producer: { readonly system: string; readonly exportedAt: string | null } | null;
  readonly errors: readonly string[];
  readonly records: readonly RecordValidation[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number = PROJECT_SIGNAL_LIMITS.text) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: string) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const httpsUrl = (value: string) => { try { return new URL(value).protocol === "https:"; } catch { return false; } };

/** A fact may be given as a bare value (treated as OFFICIAL only if the record has an official source) or as {value, kind, evidenceRef}. */
function fact<T>(raw: unknown, path: string, read: (v: unknown) => T | null, hasOfficialSource: boolean, errors: string[], warnings: string[], check?: (v: T) => string | null): Fact<T> {
  if (raw === undefined || raw === null) return { value: null, kind: "UNKNOWN", evidenceRef: null };
  const wrapped = isObject(raw) && ("value" in raw || "kind" in raw);
  const value = read(wrapped ? (raw as Record<string, unknown>).value : raw);
  let kind: FactKind = wrapped ? ((FACT_KINDS as readonly string[]).includes(String((raw as Record<string, unknown>).kind)) ? (raw as Record<string, unknown>).kind as FactKind : "UNKNOWN") : hasOfficialSource ? "OFFICIAL" : "ESTIMATED";
  if (wrapped && !(FACT_KINDS as readonly string[]).includes(String((raw as Record<string, unknown>).kind))) errors.push(`${path}.kind must be OFFICIAL, ESTIMATED or UNKNOWN`);
  const evidenceRef = wrapped ? text((raw as Record<string, unknown>).evidenceRef, PROJECT_SIGNAL_LIMITS.url) : null;
  if (value === null) {
    if (kind !== "UNKNOWN") warnings.push(`${path}: no value, recorded as UNKNOWN`);
    return { value: null, kind: "UNKNOWN", evidenceRef };
  }
  if (kind === "UNKNOWN") { errors.push(`${path}: a value cannot be UNKNOWN`); kind = "ESTIMATED"; }
  if (kind === "OFFICIAL" && !evidenceRef && !hasOfficialSource) errors.push(`${path}: OFFICIAL needs an evidenceRef or the record's officialSourceUrl`);
  if (kind === "ESTIMATED" && !evidenceRef) warnings.push(`${path}: estimate without stated basis (evidenceRef)`);
  const problem = check?.(value);
  if (problem) errors.push(`${path}: ${problem}`);
  if (!wrapped && !hasOfficialSource) warnings.push(`${path}: bare value without official source, recorded as ESTIMATED`);
  return { value, kind, evidenceRef };
}

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value;
export const projectSignalContentHash = (record: ProjectSignalRecord) =>
  createHash("sha256").update(JSON.stringify(canonical({ ...record, observedAt: record.observedAt }))).digest("hex");

function validateRecord(raw: unknown, index: number): RecordValidation {
  const errors: string[] = [], warnings: string[] = [];
  if (!isObject(raw)) return { index, state: "REJECTED", errors: ["record must be an object"], warnings, record: null, contentHash: null };
  const sourceSystem = text(raw.sourceSystem, 80), sourceRecordId = text(raw.sourceRecordId, 200), observedAt = text(raw.observedAt, 40);
  if (!sourceSystem) errors.push("sourceSystem is required");
  if (!sourceRecordId) errors.push("sourceRecordId is required");
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) errors.push("observedAt must be an ISO date");
  const officialSourceUrl = text(raw.officialSourceUrl, PROJECT_SIGNAL_LIMITS.url);
  if (officialSourceUrl && !httpsUrl(officialSourceUrl)) errors.push("officialSourceUrl must be https");
  if (!officialSourceUrl) warnings.push("no officialSourceUrl: facts without their own evidenceRef are ESTIMATED");
  const dataClass = raw.dataClass === "DEMO" ? "DEMO" : raw.dataClass === "REAL" ? "REAL" : null;
  if (!dataClass) errors.push("dataClass must be REAL or DEMO");
  const companyRaw = isObject(raw.company) ? raw.company : {};
  const companyName = text(companyRaw.name, 200);
  if (!companyName) errors.push("company.name is required");
  // REAL/DEMO separation follows the local convention: synthetic records say "DEMO LOCAL"; real ones never do.
  const demoNamed = Boolean(companyName && /\bDEMO LOCAL\b/i.test(companyName));
  if (dataClass === "DEMO" && !demoNamed) errors.push("DEMO records must name the company 'DEMO LOCAL …'");
  if (dataClass === "REAL" && demoNamed) errors.push("REAL records cannot use a 'DEMO LOCAL' company");
  const role = companyRaw.role == null ? null : (SIGNAL_COMPANY_ROLES as readonly string[]).includes(String(companyRaw.role)) ? companyRaw.role as SignalCompanyRole : (errors.push("company.role is not a contract value"), null);
  const stage = companyRaw.stage == null ? "UNKNOWN" : (SIGNAL_COMPANY_STAGES as readonly string[]).includes(String(companyRaw.stage)) ? companyRaw.stage as SignalCompanyStage : (errors.push("company.stage is not a contract value"), "UNKNOWN" as const);
  const official = Boolean(officialSourceUrl);
  const projectRaw = isObject(raw.project) ? raw.project : {};
  const dateCheck = (v: string) => (isDate(v) ? null : "must be YYYY-MM-DD");
  const record: ProjectSignalRecord = {
    sourceSystem: sourceSystem ?? "", sourceRecordId: sourceRecordId ?? "", observedAt: observedAt ?? "", officialSourceUrl, dataClass: dataClass ?? "REAL",
    company: { name: companyName ?? "", role, stage },
    project: {
      name: fact(projectRaw.name, "project.name", (v) => text(v), official, errors, warnings),
      city: fact(projectRaw.city, "project.city", (v) => text(v, 120), official, errors, warnings),
      county: fact(projectRaw.county, "project.county", (v) => text(v, 120), official, errors, warnings),
      state: fact(projectRaw.state, "project.state", (v) => text(v, 2)?.toUpperCase() ?? null, official, errors, warnings, (v) => (/^[A-Z]{2}$/.test(v) ? null : "must be a two-letter state")),
      workType: fact(projectRaw.workType, "project.workType", (v) => text(v), official, errors, warnings),
      trades: fact(projectRaw.trades, "project.trades", (v) => (Array.isArray(v) ? v.map((t) => text(t, 80)).filter((t): t is string => Boolean(t)).slice(0, PROJECT_SIGNAL_LIMITS.trades) : null), official, errors, warnings),
    },
    contractStatus: fact(raw.contractStatus, "contractStatus", (v) => text(v, 80), official, errors, warnings),
    startDate: fact(raw.startDate, "startDate", (v) => text(v, 10), official, errors, warnings, dateCheck),
    endDate: fact(raw.endDate, "endDate", (v) => text(v, 10), official, errors, warnings, dateCheck),
    duration: fact(raw.duration, "duration", (v) => text(v, 120), official, errors, warnings),
  };
  if (record.startDate.value && record.endDate.value && record.endDate.value < record.startDate.value) errors.push("endDate is before startDate");
  const state: ValidationState = errors.length ? "REJECTED" : warnings.length ? "VALID_WITH_WARNINGS" : "VALID";
  return { index, state, errors, warnings, record: errors.length ? null : record, contentHash: errors.length ? null : projectSignalContentHash(record) };
}

/** Validates a whole payload. Never throws; contract-level problems reject everything, record problems reject that record. */
export function validateProjectSignalPayload(payload: unknown): PayloadValidation {
  if (!isObject(payload)) return { state: "REJECTED", contractVersion: null, producer: null, errors: ["payload must be a JSON object"], records: [] };
  const errors: string[] = [];
  if (payload.contract !== PROJECT_SIGNAL_CONTRACT) errors.push(`contract must be "${PROJECT_SIGNAL_CONTRACT}"`);
  const version = text(payload.contractVersion, 20);
  const major = version && /^\d+\.\d+\.\d+$/.test(version) ? Number(version.split(".")[0]) : null;
  if (major === null) errors.push("contractVersion must be semantic (e.g. 1.0.0)");
  else if (major !== PROJECT_SIGNAL_MAJOR) errors.push(`contractVersion ${version} is not supported (major ${PROJECT_SIGNAL_MAJOR} only)`);
  const producerRaw = isObject(payload.producer) ? payload.producer : null;
  const producer = producerRaw && text(producerRaw.system, 80) ? { system: text(producerRaw.system, 80)!, exportedAt: text(producerRaw.exportedAt, 40) } : null;
  if (!producer) errors.push("producer.system is required");
  if (!Array.isArray(payload.records) || !payload.records.length) errors.push("records must be a non-empty array");
  else if (payload.records.length > PROJECT_SIGNAL_LIMITS.records) errors.push(`at most ${PROJECT_SIGNAL_LIMITS.records} records per import`);
  if (errors.length) return { state: "REJECTED", contractVersion: version, producer, errors, records: [] };
  const records = (payload.records as unknown[]).map(validateRecord);
  const keys = records.filter((r) => r.record).map((r) => `${r.record!.sourceSystem}::${r.record!.sourceRecordId}`);
  const repeated = keys.filter((k, i) => keys.indexOf(k) !== i);
  const finalRecords = records.map((r) => r.record && repeated.includes(`${r.record.sourceSystem}::${r.record.sourceRecordId}`)
    ? { ...r, state: "REJECTED" as const, errors: [...r.errors, "the same sourceSystem + sourceRecordId appears more than once in this file"], record: null, contentHash: null } : r);
  const state: ValidationState = finalRecords.every((r) => r.state === "REJECTED") ? "REJECTED" : finalRecords.some((r) => r.state !== "VALID") ? "VALID_WITH_WARNINGS" : "VALID";
  return { state, contractVersion: version, producer, errors: [], records: finalRecords };
}
