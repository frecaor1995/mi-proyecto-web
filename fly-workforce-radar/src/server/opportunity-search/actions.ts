"use server";

import { revalidatePath } from "next/cache";
import { parseOpportunitySearchRequest } from "../../domain/opportunity-search";
import { authorizeOperator } from "../auth/authorization";
import { PostgresGovernedDestinationCapture } from "../company-discovery/governed-destination-capture";
import { PostgresCompanyDiscoveryRepository } from "../company-discovery/discovery-repository";
import { getProductionSqlClient } from "../database/production-sql-client";
import { runOpportunityDiscovery } from "./run-opportunity-discovery";
import { runDiscoveryCycle } from "./run-discovery-cycle";
import { enrichPromisingFromLatestRun } from "../source-enrichment/enrich-source";

export interface DiscoveryCycleActionState {
  readonly state: "IDLE" | "COMPLETED" | "PARTIAL" | "FAILED" | "COOLDOWN" | "OVERLAP" | "UNAUTHORIZED" | "UNAVAILABLE";
  readonly findings: number;
  readonly queries: number;
  readonly failedQueries: number;
  readonly failureCode: string | null;
}

/** Manual refresh: runs one bounded multi-trade cycle (same planner and budget as the daily schedule). */
export async function runDiscoveryCycleNow(previous: DiscoveryCycleActionState): Promise<DiscoveryCycleActionState> {
  void previous;
  const authorization = await authorizeOperator("company_discovery.run");
  const client = getProductionSqlClient();
  const empty = { findings: 0, queries: 0, failedQueries: 0, failureCode: null };
  if (!client) return { state: "UNAVAILABLE", ...empty };
  const repository = new PostgresCompanyDiscoveryRepository(client);
  const profile = await repository.multiTradeProfile().catch(() => null);
  const execution = await runDiscoveryCycle({ authority: { kind: "HUMAN", authorization }, repository,
    capture: new PostgresGovernedDestinationCapture(client), budget: profile?.queriesPerCycle });
  revalidatePath("/radar");
  revalidatePath("/command-center");
  if (execution.state === "UNAUTHORIZED") return { state: "UNAUTHORIZED", ...empty };
  if (execution.state === "COOLDOWN") return { state: "COOLDOWN", ...empty };
  if (execution.state === "OVERLAP_SUPPRESSED") return { state: "OVERLAP", ...empty };
  const result = execution.result;
  const state = result?.status === "COMPLETED" ? "COMPLETED" : result?.status === "PARTIAL" ? "PARTIAL" : "FAILED";
  if (state !== "FAILED") await enrichPromisingFromLatestRun(client, 5).catch(() => 0);
  return { state, findings: result?.findingsCount ?? 0, queries: execution.queries.length,
    failedQueries: execution.queries.filter((query) => query.state !== "COMPLETED").length, failureCode: result?.failureCode ?? null };
}

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
  revalidatePath("/radar");
  revalidatePath("/command-center");
  return { state: execution.state, failureCode: execution.result?.failureCode ?? null, result: execution.result };
}
