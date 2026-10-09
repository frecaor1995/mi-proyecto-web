"use server";

import { revalidatePath } from "next/cache";
import type { AssistedPostingInput } from "../../domain/assisted-posting-capture";
import { authorizeOperator } from "../auth/authorization";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import { AssistedCaptureValidationError, recordAssistedPosting, type AssistedOutcome } from "./assisted-posting-capture";

export interface AssistedCaptureState {
  readonly state: "IDLE" | "DONE" | "INVALID" | "RESTRICTED" | "UNAVAILABLE" | "FAILED";
  readonly outcome: AssistedOutcome | null;
  readonly reviewHref: string | null;
  readonly errors: Readonly<Record<string, string>>;
}

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const optional = (data: FormData, name: string) => text(data, name) || null;

/** Records an operator-observed posting. Nothing is fetched: the URL is stored as a reference only. */
export async function recordAssistedPostingAction(_previous: AssistedCaptureState, data: FormData): Promise<AssistedCaptureState> {
  const authorization = await authorizeOperator("company_discovery.run");
  if (authorization.state !== "AUTHORIZED") return { state: "RESTRICTED", outcome: null, reviewHref: null, errors: {} };
  const runner = getProductionTransactionRunner();
  if (!runner) return { state: "UNAVAILABLE", outcome: null, reviewHref: null, errors: {} };
  const provenance = text(data, "provenance") === "EMAIL_ALERT" ? "EMAIL_ALERT" : "ASSISTED_MANUAL";
  const input: AssistedPostingInput = {
    url: text(data, "url"), company: text(data, "company"), title: text(data, "title"), city: text(data, "city"), state: text(data, "state"),
    salary: optional(data, "salary"), experience: optional(data, "experience"), licenses: optional(data, "licenses"), observedOn: text(data, "observedOn"),
    summary: text(data, "summary"), provenance, dataClass: text(data, "dataClass") === "DEMO" ? "DEMO" : "REAL",
    emailAlert: provenance === "EMAIL_ALERT" ? { sender: text(data, "emailSender"), receivedOn: text(data, "emailReceivedOn"), alertReference: text(data, "emailAlertReference") } : null,
  };
  try {
    const result = await runner((client) => recordAssistedPosting(client, input, authorization.operator.operatorId));
    revalidatePath("/radar/intelligence");
    revalidatePath("/radar");
    return { state: "DONE", outcome: result.outcome, reviewHref: result.reviewHref, errors: {} };
  } catch (error) {
    if (error instanceof AssistedCaptureValidationError) return { state: "INVALID", outcome: null, reviewHref: null, errors: error.errors };
    return { state: "FAILED", outcome: null, reviewHref: null, errors: { form: error instanceof Error ? error.message.slice(0, 200) : "failed" } };
  }
}
