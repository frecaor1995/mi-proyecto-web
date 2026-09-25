"use server";

import { revalidatePath } from "next/cache";
import { parseOpportunitySearchRequest } from "../../domain/opportunity-search";
import { authorizeOperator } from "../auth/authorization";
import { PostgresGovernedDestinationCapture } from "../company-discovery/governed-destination-capture";
import { PostgresCompanyDiscoveryRepository } from "../company-discovery/discovery-repository";
import { getProductionSqlClient } from "../database/production-sql-client";
import { runOpportunityDiscovery } from "./run-opportunity-discovery";

export async function searchOpportunitiesNow(formData: FormData) {
  let request;
  try {
    request = parseOpportunitySearchRequest({ company: formData.get("company"), keyword: formData.get("keyword"),
      tradeProfession: formData.get("tradeProfession"), location: formData.get("location") });
  } catch {
    return { state: "FAILED" as const, failureCode: "INVALID_SEARCH_INTENT", result: null };
  }
  const authorization = await authorizeOperator("company_discovery.run");
  const client = getProductionSqlClient();
  if (!client) return { state: "FAILED" as const, failureCode: "DATABASE_UNAVAILABLE", result: null };
  const execution = await runOpportunityDiscovery({ request, authority: { kind: "HUMAN", authorization },
    repository: new PostgresCompanyDiscoveryRepository(client), capture: new PostgresGovernedDestinationCapture(client) });
  revalidatePath("/opportunities");
  return { state: execution.state, failureCode: execution.result?.failureCode ?? null, result: execution.result };
}
