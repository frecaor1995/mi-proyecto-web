"use server";

import { revalidatePath } from "next/cache";
import { authorizeOperator } from "../auth/authorization";
import { getProductionSqlClient } from "../database/production-sql-client";
import { getSignal } from "../opportunity-discovery/signals";
import { recordDecision, recordValidation, runContactInvestigation } from "./investigation";
import { hunterVerifyEmail, lookupPhone } from "./providers";

export interface ContactActionState {
  readonly state: "IDLE" | "DONE" | "RESTRICTED" | "UNAVAILABLE" | "INVALID" | "NOT_CONFIGURED" | "FAILED" | "COOLDOWN";
  readonly detail: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function context() {
  const authorization = await authorizeOperator("company_discovery.run");
  if (authorization.state !== "AUTHORIZED") return { error: "RESTRICTED" as const };
  const client = getProductionSqlClient();
  if (!client) return { error: "UNAVAILABLE" as const };
  return { client, operatorId: authorization.operator.operatorId };
}

/** Start or refresh the contact investigation for a signal (bounded official-source retrieval). */
export async function startContactInvestigationAction(previous: ContactActionState, formData: FormData): Promise<ContactActionState> {
  void previous;
  const signalId = String(formData.get("signalId") ?? "");
  if (!UUID.test(signalId)) return { state: "INVALID", detail: null };
  const ctx = await context();
  if ("error" in ctx) return { state: ctx.error!, detail: null };
  const signal = await getSignal(ctx.client, signalId);
  if (signal.state !== "READY") return { state: "INVALID", detail: null };
  const normalized = (await ctx.client.query<{ normalized_candidate_url: string }>("select normalized_candidate_url from company_discovery_candidates where id=$1", [signalId])).rows[0]?.normalized_candidate_url;
  if (!normalized) return { state: "INVALID", detail: null };
  const recent = await ctx.client.query<{ n: string | number }>(
    `select count(*) as n from contact_source_retrievals r join contact_investigations i on i.id = r.investigation_id
      where i.normalized_candidate_url=$1 and r.retrieved_at > now() - interval '10 minutes'`, [normalized]);
  if (Number(recent.rows[0]?.n ?? 0) > 0) return { state: "COOLDOWN", detail: null };
  const result = await runContactInvestigation(ctx.client, signal.signal, normalized, ctx.operatorId);
  revalidatePath(`/radar/${signalId}`);
  revalidatePath("/contacts");
  return { state: "DONE", detail: String(result.found) };
}

/** Technical validation through a configured provider. Never run without a credential; never implies ownership. */
export async function validateContactAction(previous: ContactActionState, formData: FormData): Promise<ContactActionState> {
  void previous;
  const candidateId = String(formData.get("contactId") ?? "");
  const channel = formData.get("channel") === "PHONE" ? "PHONE" : "EMAIL";
  const signalId = String(formData.get("signalId") ?? "");
  if (!UUID.test(candidateId)) return { state: "INVALID", detail: null };
  const ctx = await context();
  if ("error" in ctx) return { state: ctx.error!, detail: null };
  const row = (await ctx.client.query<{ email: string | null; phone: string | null }>("select email, phone from contact_candidates where id=$1", [candidateId])).rows[0];
  const target = channel === "EMAIL" ? row?.email : row?.phone;
  if (!target) return { state: "INVALID", detail: null };
  if (channel === "EMAIL") {
    const outcome = await hunterVerifyEmail(target);
    if (outcome.state === "NOT_CONFIGURED") return { state: "NOT_CONFIGURED", detail: "HUNTER_API_KEY" };
    await recordValidation(ctx.client, { candidateId, channel, provider: "HUNTER_EMAIL_VERIFIER", result: outcome.state === "OK" ? outcome.value.result : "FAILED",
      details: outcome.state === "OK" ? { status: outcome.value.status } : { reason: outcome.reason } });
  } else {
    const outcome = await lookupPhone(target);
    if (outcome.state === "NOT_CONFIGURED") return { state: "NOT_CONFIGURED", detail: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN" };
    await recordValidation(ctx.client, { candidateId, channel, provider: "PHONE_LOOKUP", result: outcome.state === "OK" ? outcome.value.result : "FAILED",
      details: outcome.state === "OK" ? { lineType: outcome.value.lineType } : { reason: outcome.reason } });
  }
  if (UUID.test(signalId)) revalidatePath(`/radar/${signalId}`);
  const companyId = String(formData.get("companyId") ?? "");
  if (UUID.test(companyId)) revalidatePath(`/companies/${companyId}`);
  return { state: "DONE", detail: null };
}

/** Human decision on a contact: select for follow-up, confirm, or reject. Nothing is sent to anyone. */
export async function decideContactAction(previous: ContactActionState, formData: FormData): Promise<ContactActionState> {
  void previous;
  const candidateId = String(formData.get("contactId") ?? "");
  const signalId = String(formData.get("signalId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000) || null;
  const companyId = String(formData.get("companyId") ?? "");
  // Company-first investigations (no signal) can reject a misidentified person; confirmation goes through interactions.
  if (!UUID.test(signalId) && UUID.test(companyId) && decision === "REJECTED" && UUID.test(candidateId)) {
    const ctx = await context();
    if ("error" in ctx) return { state: ctx.error!, detail: null };
    await recordDecision(ctx.client, { candidateId, decision: "REJECTED", note, operatorId: ctx.operatorId, promotedOpportunityId: null });
    revalidatePath(`/companies/${companyId}`);
    revalidatePath("/contacts");
    return { state: "DONE", detail: null };
  }
  if (!UUID.test(candidateId) || !UUID.test(signalId) || !["SELECTED_FOR_FOLLOW_UP", "CONFIRMED", "REJECTED"].includes(decision)) return { state: "INVALID", detail: null };
  if (decision === "CONFIRMED" && !note) return { state: "INVALID", detail: "note" };
  const ctx = await context();
  if ("error" in ctx) return { state: ctx.error!, detail: null };
  const signal = await getSignal(ctx.client, signalId);
  const result = await recordDecision(ctx.client, { candidateId, decision: decision as "SELECTED_FOR_FOLLOW_UP" | "CONFIRMED" | "REJECTED", note, operatorId: ctx.operatorId,
    promotedOpportunityId: signal.state === "READY" ? signal.signal.promotedOpportunityId : null });
  revalidatePath(`/radar/${signalId}`);
  revalidatePath("/contacts");
  return { state: "DONE", detail: result.canonical };
}
