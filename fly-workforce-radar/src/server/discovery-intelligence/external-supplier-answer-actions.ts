"use server";

import { revalidatePath } from "next/cache";
import { authorizeOperator } from "../auth/authorization";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import { SupplierAnswerValidationError, recordSupplierAnswer } from "./external-supplier-answers";

export interface SupplierAnswerState {
  readonly status: "IDLE" | "SAVED" | "INVALID" | "RESTRICTED" | "UNAVAILABLE" | "FAILED";
  readonly errors: Readonly<Record<string, string>>;
  readonly answer: string | null;
}

const text = (data: FormData, name: string) => { const value = String(data.get(name) ?? "").trim(); return value || null; };

/** Records one human answer about external suppliers (Phase 3A commercial flow). Never creates a client or opportunity. */
export async function recordSupplierAnswerAction(_previous: SupplierAnswerState, data: FormData): Promise<SupplierAnswerState> {
  const auth = await authorizeOperator("company_discovery.run");
  if (auth.state !== "AUTHORIZED") return { status: "RESTRICTED", errors: {}, answer: null };
  const runner = getProductionTransactionRunner();
  if (!runner) return { status: "UNAVAILABLE", errors: {}, answer: null };
  const input = {
    answer: text(data, "answer") ?? "", catalogKey: text(data, "catalogKey"), companyId: text(data, "companyId"), companyName: text(data, "companyName") ?? "",
    conversationDate: text(data, "conversationDate"), responderName: text(data, "responderName"), responderRole: text(data, "responderRole"), channel: text(data, "channel"),
    summary: text(data, "summary"), evidenceReference: text(data, "evidenceReference"), nextAction: text(data, "nextAction"),
  };
  try {
    const saved = await runner((client) => recordSupplierAnswer(client, input, auth.operator.operatorId));
    revalidatePath("/radar/intelligence");
    if (saved.companyId) revalidatePath(`/companies/${saved.companyId}`);
    return { status: "SAVED", errors: {}, answer: saved.answer };
  } catch (error) {
    if (error instanceof SupplierAnswerValidationError) return { status: "INVALID", errors: error.errors as Record<string, string>, answer: null };
    return { status: "FAILED", errors: { form: error instanceof Error ? error.message.slice(0, 200) : "failed" }, answer: null };
  }
}
