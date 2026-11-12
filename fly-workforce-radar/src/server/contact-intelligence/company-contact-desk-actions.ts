"use server";

import { revalidatePath } from "next/cache";
import { authorizeOperator } from "../auth/authorization";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import { ContactDeskError, createCompanyNextAction, recordCompanyCall, recordCorporateChannel, resolveCompanyNextAction } from "./company-contact-desk";

export interface DeskState { readonly status: "IDLE" | "SAVED" | "DUPLICATE" | "INVALID" | "RESTRICTED" | "UNAVAILABLE" | "FAILED"; readonly errors: Readonly<Record<string, string>> }

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const optional = (data: FormData, name: string) => text(data, name) || null;

async function run<T>(companyId: string, work: (client: Parameters<Parameters<NonNullable<ReturnType<typeof getProductionTransactionRunner>>>[0]>[0], operatorId: string) => Promise<T>): Promise<DeskState & { result?: T }> {
  const auth = await authorizeOperator("company_discovery.run");
  if (auth.state !== "AUTHORIZED") return { status: "RESTRICTED", errors: {} };
  const runner = getProductionTransactionRunner();
  if (!runner) return { status: "UNAVAILABLE", errors: {} };
  try {
    const result = await runner((client) => work(client, auth.operator.operatorId));
    revalidatePath(`/companies/${companyId}`);
    revalidatePath("/opportunities/pursuits");
    revalidatePath("/radar/intelligence");
    return { status: "SAVED", errors: {}, result };
  } catch (error) {
    if (error instanceof ContactDeskError) return { status: "INVALID", errors: error.errors };
    console.error("contact desk write failed", error); // technical detail stays in the server log, never in the form
    return { status: "FAILED", errors: {} };
  }
}

/** A published corporate channel (no person). */
export async function recordCorporateChannelAction(_p: DeskState, data: FormData): Promise<DeskState> {
  const companyId = text(data, "companyId");
  const state = await run(companyId, (client, op) => recordCorporateChannel(client, { companyId, routeType: text(data, "routeType"), value: text(data, "value"), sourceUrl: text(data, "sourceUrl"),
    observedOn: text(data, "observedOn"), locationLabel: optional(data, "locationLabel"), sourceNote: optional(data, "sourceNote") }, op));
  return state.result && (state.result as { outcome: string }).outcome === "DUPLICATE" ? { status: "DUPLICATE", errors: {} } : { status: state.status, errors: state.errors };
}

/** A company-level call (optionally DEMO), with outcome, counterpart and the external-supplier answer. */
export async function recordCompanyCallAction(_p: DeskState, data: FormData): Promise<DeskState> {
  const companyId = text(data, "companyId");
  const isDemo = data.get("isDemo") === "on";
  const state = await run(companyId, async (client, op) => {
    const call = await recordCompanyCall(client, { companyId, contactRouteId: optional(data, "contactRouteId"), contactDate: text(data, "contactDate"), callOutcome: text(data, "callOutcome"),
      supplierAnswer: text(data, "supplierAnswer"), counterpartName: optional(data, "counterpartName"), counterpartRole: optional(data, "counterpartRole"), notes: optional(data, "notes"), isDemo }, op);
    // optional next action recorded together with the call (same DEMO marker)
    if (text(data, "nextAction")) await createCompanyNextAction(client, { companyId, action: text(data, "nextAction"), dueDate: text(data, "nextActionDue"), ownerOperatorId: text(data, "nextActionOwner"), isDemo, sourceInteractionId: call.interactionId }, op);
    return call;
  });
  return { status: state.status, errors: state.errors };
}

export async function createCompanyNextActionAction(_p: DeskState, data: FormData): Promise<DeskState> {
  const companyId = text(data, "companyId");
  const state = await run(companyId, (client, op) => createCompanyNextAction(client, { companyId, action: text(data, "action"), dueDate: text(data, "dueDate"), ownerOperatorId: text(data, "ownerOperatorId"), isDemo: data.get("isDemo") === "on" }, op));
  return { status: state.status, errors: state.errors };
}

export async function resolveCompanyNextActionAction(_p: DeskState, data: FormData): Promise<DeskState> {
  const companyId = text(data, "companyId");
  const status = text(data, "status") === "CANCELLED" ? "CANCELLED" : "DONE";
  const state = await run(companyId, (client, op) => resolveCompanyNextAction(client, { actionId: text(data, "actionId"), status, note: optional(data, "note") }, op));
  return { status: state.status, errors: state.errors };
}
