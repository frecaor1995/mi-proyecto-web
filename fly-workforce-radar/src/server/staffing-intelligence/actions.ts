"use server";

import { revalidatePath } from "next/cache";
import { authorizeOperator } from "../auth/authorization";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import { ProjectSignalLinkError, confirmProjectSignalLink, importProjectSignals, type ImportResult } from "./project-signals";

export interface ProjectImportState {
  readonly status: "IDLE" | "DONE" | "INVALID_JSON" | "RESTRICTED" | "UNAVAILABLE" | "FAILED";
  readonly result: ImportResult | null;
  readonly error: string | null;
}
export interface ProjectLinkState {
  readonly status: "IDLE" | "LINKED" | "ALREADY_LINKED" | "REJECTED";
  readonly error: string | null;
}

const MAX_JSON = 500_000;

/** Imports a pasted or uploaded fly.project-signal v1 file. Nothing is fetched; nothing beyond evidence is created. */
export async function importProjectSignalsAction(_previous: ProjectImportState, data: FormData): Promise<ProjectImportState> {
  const auth = await authorizeOperator("company_discovery.run");
  if (auth.state !== "AUTHORIZED") return { status: "RESTRICTED", result: null, error: null };
  const runner = getProductionTransactionRunner();
  if (!runner) return { status: "UNAVAILABLE", result: null, error: null };
  const file = data.get("file");
  const raw = file instanceof File && file.size ? await file.text() : String(data.get("json") ?? "");
  if (!raw.trim() || raw.length > MAX_JSON) return { status: "INVALID_JSON", result: null, error: raw.trim() ? "tooLarge" : "empty" };
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return { status: "INVALID_JSON", result: null, error: "notJson" }; }
  try {
    const result = await runner((client) => importProjectSignals(client, payload, auth.operator.operatorId));
    revalidatePath("/radar/intelligence");
    return { status: "DONE", result, error: null };
  } catch (error) {
    return { status: "FAILED", result: null, error: error instanceof Error ? error.message.slice(0, 200) : "failed" };
  }
}

/** Explicit human confirmation of an imported record's company (and, if chosen, its project and company role). */
export async function confirmProjectSignalLinkAction(_previous: ProjectLinkState, data: FormData): Promise<ProjectLinkState> {
  const auth = await authorizeOperator("company_discovery.run");
  if (auth.state !== "AUTHORIZED") return { status: "REJECTED", error: "restricted" };
  const runner = getProductionTransactionRunner();
  if (!runner) return { status: "REJECTED", error: "unavailable" };
  const text = (name: string) => String(data.get(name) ?? "").trim();
  if (data.get("confirm") !== "on") return { status: "REJECTED", error: "confirmRequired" };
  try {
    const result = await runner((client) => confirmProjectSignalLink(client, { evidenceId: text("evidenceId"), companyId: text("companyId"), role: text("role"),
      createProjectAndRole: data.get("createProjectAndRole") === "on", note: text("note"), operatorId: auth.operator.operatorId, now: new Date() }));
    revalidatePath("/radar/intelligence");
    revalidatePath(`/companies/${text("companyId")}`);
    return { status: result.outcome, error: null };
  } catch (error) {
    return { status: "REJECTED", error: error instanceof ProjectSignalLinkError ? error.code : "failed" };
  }
}
