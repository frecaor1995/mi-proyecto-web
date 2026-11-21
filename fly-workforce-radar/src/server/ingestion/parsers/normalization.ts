import type { NormalizedRoleType } from "../../../domain/ingestion";

export function normalizeRole(title: string): NormalizedRoleType {
  const value = title.trim().toLowerCase();
  if (/\bgeneral\s+foreman\b/.test(value)) return "GENERAL_FOREMAN";
  if (/\bapprentice\b/.test(value) && /\belectric/.test(value)) return "APPRENTICE_ELECTRICIAN";
  if (/\bjourney(?:man|person)?\b/.test(value) && /\belectric/.test(value)) {
    return "JOURNEYMAN_ELECTRICIAN";
  }
  if (/\bindustrial\b/.test(value) && /\belectric/.test(value)) return "INDUSTRIAL_ELECTRICIAN";
  if (/\b(e\s*&\s*i|electrical\s+and\s+instrumentation)\b/.test(value)) return "E_AND_I";
  if (/\binstrumentation\b/.test(value)) return "INSTRUMENTATION";
  if (/\belectrical\s+technician\b/.test(value)) return "ELECTRICAL_TECHNICIAN";
  if (/\bforeman\b/.test(value)) return "FOREMAN";
  if (/\bsuperintendent\b/.test(value)) return "SUPERINTENDENT";
  if (/\belectrician\b/.test(value)) return "ELECTRICIAN";
  return "OTHER";
}

export function validDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
