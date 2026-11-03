import type { WorkerOperationResult } from "../services/worker/worker-service";

/**
 * Pure helpers shared by worker-actions.ts, kept in a plain (non-"use
 * server") module so they stay unit-testable directly -- a "use server"
 * file may only export async functions, so none of this could live there.
 */

export interface WorkerActionState {
  readonly successKey: string | null;
  readonly errorKey: string | null;
}

export function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
export function optionalField(formData: FormData, name: string): string | null {
  const value = field(formData, name);
  return value || null;
}
export function optionalDate(formData: FormData, name: string): Date | null {
  const value = optionalField(formData, name);
  return value ? new Date(value) : null;
}
export function optionalInt(formData: FormData, name: string): number | null {
  const value = optionalField(formData, name);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
export function optionalNumber(formData: FormData, name: string): number | null {
  const value = optionalField(formData, name);
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Never leaks the underlying VALIDATION_ERROR detail (which is already
 * PII-free, per worker-service.ts's mapDatabaseError/invalid()), and never
 * distinguishes UNAUTHENTICATED from UNAUTHORIZED to the client beyond the
 * two dictionary keys the rest of the app already uses for this. */
export function resultToState<T>(result: WorkerOperationResult<T>, successKey: string, genericErrorKey: string): WorkerActionState {
  if (result.kind === "OK") return { successKey, errorKey: null };
  if (result.kind === "UNAUTHENTICATED") return { successKey: null, errorKey: "workforce.requiresSignIn" };
  if (result.kind === "UNAUTHORIZED") return { successKey: null, errorKey: "workforce.requiresOperator" };
  return { successKey: null, errorKey: genericErrorKey };
}
