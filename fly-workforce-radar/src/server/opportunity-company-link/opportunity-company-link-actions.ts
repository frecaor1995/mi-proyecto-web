"use server";

import { revalidatePath } from "next/cache";
import { authorizeOperator } from "../auth/authorization";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import { linkOpportunityToCompany, OpportunityCompanyLinkError } from "./opportunity-company-link";

export interface LinkState { readonly status: "IDLE" | "SAVED" | "INVALID" | "RESTRICTED" | "UNAVAILABLE" | "FAILED"; readonly errors: Readonly<Record<string, string>> }

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

/** Human-confirmed opportunity → company link. The technical error stays in the server log; the form shows a plain message. */
export async function linkOpportunityToCompanyAction(_p: LinkState, data: FormData): Promise<LinkState> {
  const auth = await authorizeOperator("company_discovery.run");
  if (auth.state !== "AUTHORIZED") return { status: "RESTRICTED", errors: {} };
  const runner = getProductionTransactionRunner();
  if (!runner) return { status: "UNAVAILABLE", errors: {} };
  const companyId = text(data, "companyId"), opportunityId = text(data, "opportunityId");
  try {
    await runner((client) => linkOpportunityToCompany(client, {
      opportunityId, companyId, reason: text(data, "reason"), evidenceNote: text(data, "evidenceNote") || null,
      humanConfirmed: data.get("humanConfirmed") === "on", aggregatorAcknowledged: data.get("aggregatorAcknowledged") === "on",
    }, auth.operator.operatorId));
  } catch (error) {
    if (error instanceof OpportunityCompanyLinkError) return { status: "INVALID", errors: error.errors };
    console.error("opportunity-company link failed", error);
    return { status: "FAILED", errors: {} };
  }
  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/companies");
  return { status: "SAVED", errors: {} };
}
