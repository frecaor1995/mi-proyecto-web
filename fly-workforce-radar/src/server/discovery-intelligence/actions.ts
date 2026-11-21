"use server";

import { revalidatePath } from "next/cache";
import { DISCOVERY_STRATEGIES, type DiscoveryStrategy } from "../../domain/discovery-intelligence";
import { authorizeOperator } from "../auth/authorization";
import { getProductionSqlClient } from "../database/production-sql-client";
import { executeDiscoveryRecipes, type RecipeExecutionSummary } from "./execute-discovery-recipes";

export interface RecipeActionState { readonly ok: boolean; readonly message: string; readonly summary: RecipeExecutionSummary | null }

export async function runDiscoveryRecipesAction(_previous: RecipeActionState, formData: FormData): Promise<RecipeActionState> {
  const authorization = await authorizeOperator("company_discovery.run");
  if (authorization.state !== "AUTHORIZED") return { ok: false, message: "Discovery authorization required.", summary: null };
  const db = getProductionSqlClient();
  if (!db) return { ok: false, message: "Local database is unavailable.", summary: null };
  try {
    const summary = await executeDiscoveryRecipes({ db, operatorId: authorization.operator.operatorId, explicitRefresh: formData.get("mode") === "refresh" });
    revalidatePath("/radar/intelligence");
    revalidatePath("/radar");
    return { ok: summary.state === "COMPLETED" || summary.state === "PARTIAL", message: `${summary.state}: ${summary.queriesExecuted} executed, ${summary.queriesReused} reused, ${summary.observationsStored} observations.`, summary };
  } catch {
    return { ok: false, message: "Recipe execution failed safely. No error details or credentials were exposed.", summary: null };
  }
}

export interface ManualMissInput {
  readonly summary: string; readonly company: string; readonly source: string; readonly sourceUrl: string;
  readonly profession: string; readonly level: string; readonly location: string; readonly project: string;
  readonly discoveryMethod: string; readonly query: string; readonly strategy: DiscoveryStrategy; readonly notes: string;
}

const clean = (value: string, max: number) => value.trim().replace(/\s+/g, " ").slice(0, max);
export async function recordManualMiss(input: ManualMissInput): Promise<{ ok: boolean; message: string }> {
  const authorization = await authorizeOperator("company_discovery.run");
  if (authorization.state !== "AUTHORIZED") return { ok: false, message: "Discovery authorization required." };
  const db = getProductionSqlClient();
  if (!db) return { ok: false, message: "Local database is unavailable." };
  const summary = clean(input.summary, 1000), source = clean(input.source, 300), method = clean(input.discoveryMethod, 300);
  if (!summary || !source || !method || !DISCOVERY_STRATEGIES.includes(input.strategy)) return { ok: false, message: "Summary, source, method and strategy are required." };
  const sourceUrl = input.sourceUrl.trim();
  if (sourceUrl && (!sourceUrl.startsWith("https://") || sourceUrl.length > 2000)) return { ok: false, message: "Source URL must be a public HTTPS URL." };
  await db.query(
    `insert into discovery_manual_misses(found_at,recorded_by_operator_id,strategy_kind,summary,company_text,source_text,source_url,
      profession_text,level_text,location_text,project_text,discovery_method,query_text,notes)
     values(now(),$1,$2,$3,nullif($4,''),$5,nullif($6,''),nullif($7,''),nullif($8,''),nullif($9,''),nullif($10,''),$11,nullif($12,''),nullif($13,''))`,
    [authorization.operator.operatorId, input.strategy, summary, clean(input.company, 300), source, sourceUrl, clean(input.profession, 200),
      clean(input.level, 120), clean(input.location, 300), clean(input.project, 300), method, clean(input.query, 500), clean(input.notes, 4000)],
  );
  return { ok: true, message: "Manual miss recorded as product feedback. It is not canonical demand." };
}
