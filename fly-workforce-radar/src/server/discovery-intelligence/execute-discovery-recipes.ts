import { randomUUID } from "node:crypto";
import type { DiscoveryCandidate } from "../../domain/company-discovery";
import type { PlannedDiscoveryQuery } from "../../domain/discovery-coverage";
import {
  classifyElectricalLevel, identifyAtsPlatform, nextWatchAt, observationIdentity, shouldReuseQuery,
  type DiscoveryStrategy,
} from "../../domain/discovery-intelligence";
import type { BraveSearchProvider, PlannedQueryOutcome } from "../company-discovery/brave-search-provider";
import { BraveSearchProvider as DefaultProvider } from "../company-discovery/brave-search-provider";
import { BRAVE_DISCOVERY_SOURCE_ID, PostgresCompanyDiscoveryRepository } from "../company-discovery/discovery-repository";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";

type ExecutableStrategy = Extract<DiscoveryStrategy, "STAFFING_AGENCY_WATCH" | "ATS_CAREER_DISCOVERY">;

interface RecipeRow {
  id: string; recipe_key: string; strategy_kind: ExecutableStrategy; name: string; query_templates: unknown;
  execution_budget: number; reuse_window_hours: number; cadence_hours: number | null;
}

export interface RecipeExecutionSummary {
  readonly runId: string | null;
  readonly state: "COMPLETED" | "PARTIAL" | "NOT_CONFIGURED" | "NO_DUE_QUERIES" | "OVERLAP_SUPPRESSED";
  readonly queriesPlanned: number;
  readonly queriesExecuted: number;
  readonly queriesReused: number;
  readonly candidatesStored: number;
  readonly watchesRegistered: number;
  readonly observationsStored: number;
  readonly duplicatesSuppressed: number;
}

interface PlannedRecipeQuery {
  readonly recipe: RecipeRow;
  readonly plan: PlannedDiscoveryQuery;
  readonly previousExecutionId: string | null;
  readonly reuse: boolean;
}

const templates = (value: unknown): readonly string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  : [];

/** Recipe configuration becomes the bounded provider plan; query vocabulary is never classified as evidence. */
export function planRecipeQueries(recipes: readonly RecipeRow[], previous: ReadonlyMap<string, { id: string; completedAt: string }>, now: string, explicitRefresh = false): readonly PlannedRecipeQuery[] {
  let position = 0;
  return recipes.flatMap((recipe) => templates(recipe.query_templates).slice(0, recipe.execution_budget).map((query) => {
    position += 1;
    const prior = previous.get(`${recipe.id}\u0000${query}`) ?? null;
    const decision = shouldReuseQuery({ previousCompletedAt: prior?.completedAt ?? null, now, reuseWindowHours: recipe.reuse_window_hours, explicitRefresh });
    return {
      recipe, previousExecutionId: prior?.id ?? null, reuse: decision.reuse,
      plan: {
        position, kind: "TRADE_PROFESSION", query: query.slice(0, 300),
        reason: `${recipe.name} · configured public-search recipe`, tradeCategoryId: "ELECTRICAL",
        occupationId: "APPRENTICE_ELECTRICIAN", geographyId: "HOUSTON", geographyTier: "TEXAS",
        signalCategory: "DIRECT_HIRING", company: null,
      },
    };
  }));
}

function watchClassification(candidate: DiscoveryCandidate, strategy: ExecutableStrategy) {
  const platform = identifyAtsPlatform(candidate.normalizedUrl);
  const text = `${candidate.title} ${candidate.providerDescription ?? ""} ${candidate.domain}`;
  const staffing = /\b(staff(?:ing)?|personnel|recruit(?:ing|er)?|workforce|labor solutions?)\b/i.test(text);
  const careers = /\b(careers?|jobs?|positions?|openings?)\b/i.test(`${candidate.title} ${candidate.normalizedUrl}`);
  if (platform) return { sourceType: "ATS_PUBLIC_BOARD", platform, policy: "PARTIALLY_AUTOMATABLE", reason: "Known public ATS URL; automated checks remain provider-index observations and require human review." } as const;
  if (strategy === "STAFFING_AGENCY_WATCH" && staffing) return { sourceType: "STAFFING_JOB_BOARD", platform: null, policy: "MANUAL_FIRST", reason: "Public staffing result with explicit staffing vocabulary; validate ownership and page semantics before deeper automation." } as const;
  if (careers) return { sourceType: "COMPANY_CAREERS", platform: null, policy: "MANUAL_FIRST", reason: "Public careers or job URL without a recognized ATS contract; keep checks manual-first." } as const;
  return null;
}

async function latestExecutions(db: SqlClient, recipes: readonly RecipeRow[]) {
  if (!recipes.length) return new Map<string, { id: string; completedAt: string }>();
  const result = await db.query<{ id: string; recipe_id: string; query_text: string; executed_at: string | Date }>(
    `select distinct on (recipe_id,query_text) id,recipe_id,query_text,executed_at
       from discovery_query_executions
      where recipe_id = any($1::uuid[]) and status='COMPLETED'
      order by recipe_id,query_text,executed_at desc`, [recipes.map((recipe) => recipe.id)],
  );
  return new Map(result.rows.map((row) => [`${row.recipe_id}\u0000${row.query_text}`, { id: row.id, completedAt: new Date(row.executed_at).toISOString() }]));
}

export async function executeDiscoveryRecipes(input: {
  readonly db: SqlClient;
  readonly operatorId: string;
  readonly provider?: Pick<BraveSearchProvider, "searchPlanned">;
  readonly explicitRefresh?: boolean;
  readonly spacingMs?: number;
  readonly now?: () => Date;
}): Promise<RecipeExecutionSummary> {
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const recipesResult = await input.db.query<RecipeRow>(
    `select id,recipe_key,strategy_kind,name,query_templates,execution_budget,reuse_window_hours,cadence_hours
       from discovery_recipes where enabled=true and strategy_kind in ('STAFFING_AGENCY_WATCH','ATS_CAREER_DISCOVERY')
      order by recipe_key,version desc`,
  );
  const recipes = recipesResult.rows;
  const planned = planRecipeQueries(recipes, await latestExecutions(input.db, recipes), startedAt.toISOString(), input.explicitRefresh);
  if (!planned.length) return { runId: null, state: "NO_DUE_QUERIES", queriesPlanned: 0, queriesExecuted: 0, queriesReused: 0, candidatesStored: 0, watchesRegistered: 0, observationsStored: 0, duplicatesSuppressed: 0 };

  const repository = new PostgresCompanyDiscoveryRepository(input.db);
  const request = { company: null, keyword: "Discovery Intelligence recipe execution", tradeProfession: "Electrical apprentice/helper", location: "Houston, Texas" };
  const runId = await repository.acquireOpportunityRun({ operatorId: input.operatorId, requestKey: randomUUID(), trigger: "MANUAL", request,
    target: `Discovery Intelligence · ${planned.length} bounded recipe queries`, startedAt });
  if (!runId) return { runId: null, state: "OVERLAP_SUPPRESSED", queriesPlanned: planned.length, queriesExecuted: 0, queriesReused: 0, candidatesStored: 0, watchesRegistered: 0, observationsStored: 0, duplicatesSuppressed: 0 };

  const due = planned.filter((item) => !item.reuse);
  const searched = await (input.provider ?? new DefaultProvider()).searchPlanned(due.map((item) => item.plan), input.spacingMs === undefined ? {} : { spacingMs: input.spacingMs });
  const byPosition = new Map(searched.outcomes.map((outcome) => [outcome.query.position, outcome]));
  const executionIds = new Map<number, string>();
  const allOutcomes: PlannedQueryOutcome[] = [];
  for (const item of planned) {
    const outcome: PlannedQueryOutcome = item.reuse
      ? { query: item.plan, state: "SKIPPED", candidates: [], resultCount: 0, failure: "RECENT_IDENTICAL_RECIPE_QUERY" }
      : byPosition.get(item.plan.position) ?? { query: item.plan, state: "FAILED", candidates: [], resultCount: 0, failure: "MISSING_PROVIDER_OUTCOME" };
    allOutcomes.push(outcome);
    const inserted = await input.db.query<{ id: string }>(
      `insert into discovery_query_executions(run_id,position,query_text,query_kind,trade_category,occupation,geography_id,geography_tier,
         signal_category,company_text,status,result_count,new_count,failure_classification,executed_at,recipe_id,strategy_kind,reused_execution_id,skip_reason)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,$14,$15,$16,$17,$18) returning id`,
      [runId, item.plan.position, item.plan.query, item.plan.kind, item.plan.tradeCategoryId, item.plan.occupationId, item.plan.geographyId,
        item.plan.geographyTier, item.plan.signalCategory, item.plan.company, outcome.state, outcome.resultCount,
        outcome.state === "COMPLETED" ? null : outcome.failure, now().toISOString(), item.recipe.id, item.recipe.strategy_kind,
        item.reuse ? item.previousExecutionId : null, item.reuse ? "RECENT_IDENTICAL_RECIPE_QUERY" : null],
    );
    executionIds.set(item.plan.position, inserted.rows[0].id);
  }

  if (searched.state === "NOT_CONFIGURED") {
    await repository.fail(runId, "NOT_CONFIGURED", "External discovery provider is not configured", now(), { recipeExecution: true, canonicalEvidence: false });
    return { runId, state: "NOT_CONFIGURED", queriesPlanned: planned.length, queriesExecuted: due.length, queriesReused: planned.length - due.length, candidatesStored: 0, watchesRegistered: 0, observationsStored: 0, duplicatesSuppressed: 0 };
  }

  const foundUrls = allOutcomes.flatMap((outcome) => outcome.candidates.map((candidate) => candidate.normalizedUrl));
  const existingWatches = foundUrls.length ? await input.db.query<{ normalized_source_url: string }>(
    "select normalized_source_url from discovery_watch_sources where normalized_source_url = any($1::text[])", [foundUrls],
  ) : { rows: [] };
  const watchedBefore = new Set(existingWatches.rows.map((row) => row.normalized_source_url));
  const observedAt = now().toISOString();
  const candidates = allOutcomes.flatMap((outcome) => {
    const item = planned.find((entry) => entry.plan.position === outcome.query.position)!;
    return outcome.candidates.map((candidate) => ({ ...candidate, queryExecutionId: executionIds.get(outcome.query.position) ?? null,
      recipeId: item.recipe.id, strategyKind: item.recipe.strategy_kind,
      observationState: (watchedBefore.has(candidate.normalizedUrl) ? "STILL_OBSERVED" : "BASELINE") as "BASELINE" | "STILL_OBSERVED",
      observationFirstSeenAt: observedAt, observationLastSeenAt: observedAt }));
  }) as DiscoveryCandidate[];
  const failed = allOutcomes.filter((outcome) => outcome.state === "FAILED").length;
  await repository.complete(runId, candidates, searched.duplicatesSuppressed, {
    provider: "BRAVE_WEB_SEARCH", recipeExecution: true, canonicalEvidence: false, queryWordsAreNotEvidence: true,
    providerQuota: searched.quota ?? null,
  }, now(), { queryFailures: failed });

  let watchesRegistered = 0, observationsStored = 0;
  for (const outcome of allOutcomes) {
    const item = planned.find((entry) => entry.plan.position === outcome.query.position)!;
    for (const candidate of outcome.candidates) {
      const candidateRow = await input.db.query<{ id: string }>(
        "select id from company_discovery_candidates where run_id=$1 and normalized_candidate_url=$2", [runId, candidate.normalizedUrl],
      );
      const classification = watchClassification(candidate, item.recipe.strategy_kind);
      if (!classification || !candidateRow.rows[0]) continue;
      const capturedAt = now();
      const cadence = item.recipe.cadence_hours ?? 168;
      const watch = await input.db.query<{ id: string; created: boolean; baseline_established_at: string | Date | null }>(
        `insert into discovery_watch_sources(source_id,recipe_id,strategy_kind,source_url,normalized_source_url,source_type,platform,
           automation_policy,allowed_method,policy_reason,policy_reviewed_at,watch_tier,cadence_hours,priority_reason,
           baseline_established_at,last_attempted_at,last_successful_at,next_eligible_at,health_status)
         values($1,$2,$3,$4,$5,$6,$7,$8,'BRAVE_WEB_SEARCH_INDEX',$9,$10,'B',$11,'Acceptance recipe match; unresolved company remains human-reviewed.',$10,$10,$10,$12,'HEALTHY')
         on conflict(normalized_source_url) do update set last_attempted_at=excluded.last_attempted_at,last_successful_at=excluded.last_successful_at,
           next_eligible_at=excluded.next_eligible_at,health_status='HEALTHY',consecutive_failures=0,updated_at=excluded.last_successful_at
         returning id,(xmax=0) created,baseline_established_at`,
        [BRAVE_DISCOVERY_SOURCE_ID, item.recipe.id, item.recipe.strategy_kind, candidate.url, candidate.normalizedUrl,
          classification.sourceType, classification.platform, classification.policy, classification.reason, capturedAt.toISOString(), cadence,
          nextWatchAt(capturedAt, "B", cadence).toISOString()],
      );
      if (watch.rows[0].created) watchesRegistered += 1;
      const identity = observationIdentity({ sourceId: BRAVE_DISCOVERY_SOURCE_ID, normalizedUrl: candidate.normalizedUrl });
      const prior = await input.db.query<{ first_seen_at: string | Date }>(
        `select first_seen_at from discovery_watch_observations where watch_source_id=$1 and observation_identity=$2 order by captured_at desc limit 1`,
        [watch.rows[0].id, identity],
      );
      const state = watch.rows[0].created || prior.rows.length === 0 ? "BASELINE" : "STILL_OBSERVED";
      await input.db.query(
        `insert into discovery_watch_observations(watch_source_id,observation_identity,normalized_url,state,first_seen_at,last_seen_at,published_at,captured_at,candidate_id,metadata)
         values($1,$2,$3,$4,$5,$6,$7,$6,$8,$9::jsonb)`,
        [watch.rows[0].id, identity, candidate.normalizedUrl, state, prior.rows[0]?.first_seen_at ?? capturedAt.toISOString(), capturedAt.toISOString(),
          candidate.providerPageAge ?? null, candidateRow.rows[0].id, JSON.stringify({ canonicalEvidence: false, humanReviewRequired: true,
            electricalLevel: classifyElectricalLevel(`${candidate.title} ${candidate.providerDescription ?? ""}`), queryWordsAreNotEvidence: true })],
      );
      observationsStored += 1;
    }
  }
  return { runId, state: failed ? "PARTIAL" : "COMPLETED", queriesPlanned: planned.length, queriesExecuted: due.length,
    queriesReused: planned.length - due.length, candidatesStored: candidates.length, watchesRegistered, observationsStored,
    duplicatesSuppressed: searched.duplicatesSuppressed };
}
