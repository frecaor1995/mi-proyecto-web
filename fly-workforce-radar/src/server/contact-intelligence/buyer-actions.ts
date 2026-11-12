"use server";

import { revalidatePath } from "next/cache";
import { authorizeOperator } from "../auth/authorization";
import { getProductionSqlClient } from "../database/production-sql-client";
import { getSignal } from "../opportunity-discovery/signals";
import { registrableDomain } from "../../domain/contact-investigation";
import { BUYER_FUNCTIONS, type OrganizationType } from "../../domain/buyer-intelligence";
import { CompanyResolutionService } from "../services/company/company-resolution-service";
import { normalizeCompanyName } from "../services/company/company-name-normalization";
import { PostgresCompanyRepository } from "../repositories/company/postgres-company-repository";
import { companyForSignal, ensureInvestigation, recordInteraction, runBuyerInvestigation, updateInvestigationSettings, type BuyerSubject } from "./buyer-investigation";

export interface BuyerActionState {
  readonly state: "IDLE" | "DONE" | "RESTRICTED" | "UNAVAILABLE" | "INVALID" | "COOLDOWN" | "EXISTS" | "FAILED";
  readonly detail: string | null;
  readonly href?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: readonly OrganizationType[] = ["ELECTRICAL_CONSTRUCTION", "STAFFING_AGENCY", "INDUSTRIAL_CONTRACTOR", "PUBLIC_PROCUREMENT", "GENERAL"];
const text = (formData: FormData, name: string, max: number) => String(formData.get(name) ?? "").trim().slice(0, max) || null;

async function context() {
  const authorization = await authorizeOperator("company_discovery.run");
  if (authorization.state !== "AUTHORIZED") return { error: "RESTRICTED" as const };
  const client = getProductionSqlClient();
  if (!client) return { error: "UNAVAILABLE" as const };
  return { client, operatorId: authorization.operator.operatorId };
}

/** An operator-entered website becomes the official domain only as a registrable host (no paths, no IPs). */
function websiteDomain(value: string | null): string | null {
  if (!value) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
    const domain = registrableDomain(host);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) ? domain : null;
  } catch { return null; }
}

async function subjectFrom(client: NonNullable<ReturnType<typeof getProductionSqlClient>>, formData: FormData): Promise<{ subject: BuyerSubject; path: string; opportunityId: string | null; companyId: string | null } | null> {
  const signalId = String(formData.get("signalId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (UUID.test(signalId)) {
    const signal = await getSignal(client, signalId);
    if (signal.state !== "READY") return null;
    return { subject: { kind: "SIGNAL", signal: signal.signal, normalizedUrl: signal.signal.normalizedUrl }, path: `/radar/${signalId}`, opportunityId: signal.signal.promotedOpportunityId, companyId: null };
  }
  if (UUID.test(companyId)) {
    const exists = (await client.query<{ id: string }>("select id from companies where id=$1", [companyId])).rows[0];
    return exists ? { subject: { kind: "COMPANY", companyId }, path: `/companies/${companyId}`, opportunityId: null, companyId } : null;
  }
  return null;
}

/** Start or refresh the buyer investigation (bounded; 10-minute cooldown per subject). */
export async function startBuyerInvestigationAction(previous: BuyerActionState, formData: FormData): Promise<BuyerActionState> {
  void previous;
  const ctx = await context();
  if ("error" in ctx) return { state: ctx.error!, detail: null };
  const target = await subjectFrom(ctx.client, formData);
  if (!target) return { state: "INVALID", detail: null };
  const row = await ensureInvestigation(ctx.client, target.subject, ctx.operatorId);
  const domain = websiteDomain(text(formData, "website", 200));
  if (domain) await updateInvestigationSettings(ctx.client, row.id, { officialDomain: { domain, basis: `Website entered by the operator (${new Date().toISOString().slice(0, 10)}).` } });
  const recent = await ctx.client.query<{ n: string | number }>("select count(*) as n from contact_source_retrievals where investigation_id=$1 and retrieved_at > now() - interval '10 minutes'", [row.id]);
  if (Number(recent.rows[0]?.n ?? 0) > 0) return { state: "COOLDOWN", detail: null };
  try {
    const result = await runBuyerInvestigation(ctx.client, target.subject, ctx.operatorId);
    revalidatePath(target.path);
    revalidatePath("/contacts");
    return { state: "DONE", detail: `${result.people.found}/${result.channels}` };
  } catch (error) {
    return { state: "FAILED", detail: error instanceof Error ? error.message.slice(0, 160) : null };
  }
}

/** Operator-selected organization type, target buyer functions and official website. */
export async function updateBuyerSettingsAction(previous: BuyerActionState, formData: FormData): Promise<BuyerActionState> {
  void previous;
  const ctx = await context();
  if ("error" in ctx) return { state: ctx.error!, detail: null };
  const target = await subjectFrom(ctx.client, formData);
  if (!target) return { state: "INVALID", detail: null };
  const typeValue = String(formData.get("organizationType") ?? "");
  const organizationType = TYPES.includes(typeValue as OrganizationType) ? typeValue as OrganizationType : null;
  const allowed = new Set(Object.values(BUYER_FUNCTIONS).flat().map((fn) => fn.id));
  const functions = formData.getAll("functions").map(String).filter((id) => allowed.has(id));
  const website = text(formData, "website", 200);
  const domain = websiteDomain(website);
  if (website && !domain) return { state: "INVALID", detail: "website" };
  const row = await ensureInvestigation(ctx.client, target.subject, ctx.operatorId);
  const typeChanged = (row.organization_type ?? null) !== organizationType;
  await updateInvestigationSettings(ctx.client, row.id, {
    organizationType, functions: typeChanged ? null : functions,
    officialDomain: domain ? { domain, basis: `Website entered by the operator (${new Date().toISOString().slice(0, 10)}).` } : null,
  });
  revalidatePath(target.path);
  return { state: "DONE", detail: null };
}

/** Record what happened when a human reached out. Nothing is sent from the system. */
export async function recordInteractionAction(previous: BuyerActionState, formData: FormData): Promise<BuyerActionState> {
  void previous;
  const candidateId = String(formData.get("contactId") ?? "");
  const contactDate = String(formData.get("contactDate") ?? "");
  const channel = String(formData.get("channel") ?? "");
  const handles = String(formData.get("handles") ?? "UNKNOWN");
  const reached = formData.get("reached") === "YES";
  if (!UUID.test(candidateId) || !/^\d{4}-\d{2}-\d{2}$/.test(contactDate) || Date.parse(contactDate) > Date.now() + 86_400_000
    || !["PHONE", "EMAIL", "IN_PERSON", "VIDEO", "OTHER"].includes(channel) || !["YES", "NO", "UNKNOWN"].includes(handles)) return { state: "INVALID", detail: null };
  const ctx = await context();
  if ("error" in ctx) return { state: ctx.error!, detail: null };
  const target = await subjectFrom(ctx.client, formData);
  if (!target) return { state: "INVALID", detail: null };
  const companyId = target.companyId ?? (target.subject.kind === "SIGNAL"
    ? await companyForSignal(ctx.client, target.subject.signal, (await ctx.client.query<{ organization: string | null }>("select organization from contact_candidates where id=$1", [candidateId])).rows[0]?.organization ?? null)
    : null);
  const result = await recordInteraction(ctx.client, {
    candidateId, personReached: reached, contactDate, channel: channel as "PHONE", handlesExternalWorkforce: handles as "YES",
    referredTo: text(formData, "referredTo", 300), responsibleDepartment: text(formData, "department", 300), notes: text(formData, "notes", 4000), nextAction: text(formData, "nextAction", 1000),
    operatorId: ctx.operatorId, companyId, opportunityId: target.opportunityId,
  });
  revalidatePath(target.path);
  revalidatePath("/contacts");
  return { state: "DONE", detail: result.canonical };
}

/** Company-first entry: add a strategic company (no opportunity needed), reusing an existing record when the name resolves. */
export async function addStrategicCompanyAction(previous: BuyerActionState, formData: FormData): Promise<BuyerActionState> {
  void previous;
  const name = text(formData, "name", 160);
  const website = text(formData, "website", 200);
  const location = text(formData, "location", 120);
  const typeValue = String(formData.get("organizationType") ?? "");
  const domain = websiteDomain(website);
  if (!name || normalizeCompanyName(name) === "" || (website && !domain)) return { state: "INVALID", detail: website && !domain ? "website" : "name" };
  const ctx = await context();
  if ("error" in ctx) return { state: ctx.error!, detail: null };
  const repository = new PostgresCompanyRepository(ctx.client);
  const resolution = await new CompanyResolutionService(repository).resolve({ observedText: name, actor: `operator:${ctx.operatorId}` });
  if (resolution.result === "AMBIGUOUS") return { state: "INVALID", detail: "ambiguous" };
  let companyId = resolution.companyId;
  const existed = Boolean(companyId);
  if (!companyId) {
    const created = await repository.createCompany({ commonName: name, normalized: normalizeCompanyName(name), observedAt: new Date() });
    companyId = created.id;
    await ctx.client.query("update companies set industry_metadata = industry_metadata || $2::jsonb where id=$1",
      [companyId, JSON.stringify({ addedAs: "STRATEGIC_COMPANY", ...(location ? { location } : {}), ...(domain ? { website: domain } : {}) })]);
  }
  const row = await ensureInvestigation(ctx.client, { kind: "COMPANY", companyId }, ctx.operatorId);
  await updateInvestigationSettings(ctx.client, row.id, {
    organizationType: TYPES.includes(typeValue as OrganizationType) ? typeValue as OrganizationType : undefined,
    officialDomain: domain && !row.official_domain ? { domain, basis: `Website entered by the operator (${new Date().toISOString().slice(0, 10)}).` } : null,
  });
  revalidatePath("/companies");
  revalidatePath("/contacts");
  return { state: existed ? "EXISTS" : "DONE", detail: name, href: `/companies/${companyId}#contacts` };
}
