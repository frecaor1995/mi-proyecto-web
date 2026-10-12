import { DISCOVERY_TRADE_CATEGORIES, type ProfessionEvidence } from "../../domain/discovery-coverage";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { DEMO_WORD_PATTERN, isDemoWorkerSql } from "../../domain/demo-records";

/**
 * Workforce readiness for a signal, read-only. Matching itself stays in the existing engine: this only reports
 * whether matching has run for a promoted opportunity, what it found, and what supply exists for the trade.
 * Local demo workers (the shared DEMO criterion in domain/demo-records) are never presented as real available personnel.
 */
export type ReadinessState = "MATCHING_COMPLETED" | "NO_MATCHING_WORKERS" | "MATCHING_NOT_RUN" | "MATCHING_BLOCKED" | "TRADE_NOT_IN_WORKFORCE" | "PROFESSION_UNKNOWN";

export interface WorkforceReadiness {
  readonly state: ReadinessState;
  readonly tradeCodes: readonly string[];
  readonly supply: { readonly real: number; readonly demo: number };
  readonly outcomes: Readonly<Record<string, number>>;
  /** True when every matched worker is a DEMO record. */
  readonly demoOnlyMatches: boolean;
  readonly opportunityId: string | null;
}

export const DEMO_WORKER_PATTERN = DEMO_WORD_PATTERN;

export function workforceTradeCodes(professions: readonly ProfessionEvidence[]): readonly string[] {
  const codes = new Set<string>();
  for (const profession of professions) {
    const trade = DISCOVERY_TRADE_CATEGORIES.find((item) => item.id === profession.tradeCategoryId);
    if (!trade) continue;
    // A named specialty maps to its own workforce trade; a family-level (scope-only) signal maps to the family's trades.
    const occupations = profession.occupationIds.length ? trade.occupations.filter((occupation) => profession.occupationIds.includes(occupation.id)) : trade.occupations;
    for (const occupation of occupations) if (occupation.workforceTradeCode) codes.add(occupation.workforceTradeCode);
  }
  return [...codes];
}

export async function getWorkforceReadiness(client: SqlClient, input: { readonly professions: readonly ProfessionEvidence[]; readonly promotedOpportunityId: string | null }): Promise<WorkforceReadiness> {
  const tradeCodes = workforceTradeCodes(input.professions);
  const supplyRows = tradeCodes.length ? (await client.query<{ demo: boolean; n: string | number }>(
    `select ${isDemoWorkerSql("w.display_name")} as demo, count(distinct w.id) as n
       from worker_trade_occupations t join workforce_workers w on w.id = t.worker_id
      where t.trade_code = any($1::text[]) and w.lifecycle_status = 'ACTIVE' group by 1`, [tradeCodes])).rows : [];
  const supply = { real: Number(supplyRows.find((row) => !row.demo)?.n ?? 0), demo: Number(supplyRows.find((row) => row.demo)?.n ?? 0) };
  const base = { tradeCodes, supply, outcomes: {}, demoOnlyMatches: false, opportunityId: input.promotedOpportunityId };
  if (!input.promotedOpportunityId) return { ...base, state: !input.professions.length ? "PROFESSION_UNKNOWN" : tradeCodes.length ? "MATCHING_BLOCKED" : "TRADE_NOT_IN_WORKFORCE" };

  const results = await client.query<{ outcome: string; demo: boolean; n: string | number }>(
    `select r.outcome::text as outcome, ${isDemoWorkerSql("w.display_name")} as demo, count(*) as n
       from opportunity_demand_signals o
       join worker_demand_match_results r on r.demand_signal_id = o.demand_signal_id and r.superseded_at is null
       join workforce_workers w on w.id = r.worker_id
      where o.opportunity_id = $1 group by 1, 2`, [input.promotedOpportunityId]);
  const outcomes: Record<string, number> = {};
  for (const row of results.rows) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + Number(row.n);
  const matched = results.rows.filter((row) => row.outcome === "STRONG_MATCH" || row.outcome === "POSSIBLE_MATCH");
  const demoOnlyMatches = matched.length > 0 && matched.every((row) => row.demo);
  if (!results.rows.length) return { ...base, outcomes, state: "MATCHING_NOT_RUN" };
  return { ...base, outcomes, demoOnlyMatches, state: matched.length ? "MATCHING_COMPLETED" : "NO_MATCHING_WORKERS" };
}
