import { getProductionSqlClient } from "../database/production-sql-client";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresOpportunityRepository } from "../repositories/opportunity/postgres-opportunity-repository";
import { evaluateOpportunityOperationalResult, type OperationalResult } from "./get-opportunity-operational-result";

/**
 * Cross-opportunity operational radar: evaluates every opportunity (bounded,
 * see ENUMERATION_CAP) through the exact same read-only, non-persisting
 * evaluator get-opportunity-operational-result.ts uses for a single
 * opportunity -- no second classification engine, no ad hoc SQL
 * reimplementation of eligibility/HOT rules. This is what /hot, /near-ready
 * and Command Center's HOT/Near Ready counts all read from, so all three
 * surfaces can never disagree with each other or with Opportunity Detail.
 *
 * `coverageComplete` is false when the real opportunity population exceeds
 * ENUMERATION_CAP -- callers (Command Center especially) must treat an
 * incomplete-coverage result as UNKNOWN, never as a truthful total count.
 */
const ENUMERATION_PAGE_SIZE = 100;
const ENUMERATION_CAP = 500;

export interface OperationalRadarSummary {
  readonly asOf: string;
  readonly items: readonly OperationalResult[];
  readonly evaluatedCount: number;
  readonly totalOpportunities: number;
  readonly coverageComplete: boolean;
  readonly failedCount: number;
}

export type OperationalRadarOutcome =
  | { readonly state: "READY"; readonly summary: OperationalRadarSummary }
  | { readonly state: "UNAVAILABLE" | "ERROR"; readonly summary: null; readonly reason: string };

async function enumerateAllOpportunityIds(repo: PostgresOpportunityRepository, asOf: Date): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = [];
  let total = 0;
  let offset = 0;
  for (;;) {
    const page = await repo.enumerate({ search: "", sort: "company", currentness: "all", asOf, limit: ENUMERATION_PAGE_SIZE, offset });
    total = page.total;
    ids.push(...page.items.map((entry) => entry.opportunity.id));
    offset += page.items.length;
    if (page.items.length < ENUMERATION_PAGE_SIZE) break;
    if (ids.length >= ENUMERATION_CAP) break;
  }
  return { ids, total };
}

export async function evaluateOperationalRadar(asOf: Date, client: SqlClient): Promise<OperationalRadarSummary> {
  const repo = new PostgresOpportunityRepository(client);
  const { ids, total } = await enumerateAllOpportunityIds(repo, asOf);
  const items: OperationalResult[] = [];
  let failedCount = 0;
  for (const id of ids) {
    try {
      items.push(await evaluateOpportunityOperationalResult(id, asOf, client));
    } catch {
      failedCount++;
    }
  }
  return {
    asOf: asOf.toISOString(),
    items,
    evaluatedCount: items.length,
    totalOpportunities: total,
    coverageComplete: ids.length >= total,
    failedCount,
  };
}

export async function loadOperationalRadar(asOf: Date = new Date()): Promise<OperationalRadarOutcome> {
  const client = getProductionSqlClient();
  if (!client) return { state: "UNAVAILABLE", summary: null, reason: "DATABASE_CONNECTION_UNAVAILABLE" };
  try {
    return { state: "READY", summary: await evaluateOperationalRadar(asOf, client) };
  } catch {
    return { state: "ERROR", summary: null, reason: "OPERATIONAL_RADAR_QUERY_FAILED" };
  }
}
