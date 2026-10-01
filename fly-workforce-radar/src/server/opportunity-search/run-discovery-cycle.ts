import { randomUUID } from "node:crypto";
import type { CompanyDiscoveryResult, DiscoveryCandidate } from "../../domain/company-discovery";
import { DEFAULT_QUERIES_PER_CYCLE, classifySignalEvidence, planDiscoveryCycle, type PlannedDiscoveryQuery } from "../../domain/discovery-coverage";
import { genericNoiseReason } from "../../domain/commercial-qualification";
import type { OpportunitySearchRequest } from "../../domain/opportunity-search";
import type { BraveSearchProvider } from "../company-discovery/brave-search-provider";
import { BraveSearchProvider as DefaultProvider } from "../company-discovery/brave-search-provider";
import { NO_AUTOMATIC_PROMOTION, NO_UNGOVERNED_EVALUATION, processDiscoveryCandidates, type GovernedCaptureGateway } from "../company-discovery/candidate-processing";
import type { PostgresCompanyDiscoveryRepository, QueryExecutionRecord } from "../company-discovery/discovery-repository";
import type { OpportunitySearchAuthority } from "./run-opportunity-discovery";

/** Manual cycles cannot be re-launched back to back; the provider budget is shared with the daily schedule. */
export const MANUAL_CYCLE_COOLDOWN_MINUTES = 10;
/** A cycle still SEARCHING after this long is treated as crashed and no longer blocks new cycles. */
export const STALE_CYCLE_MINUTES = 30;

export const CYCLE_SEARCH_REQUEST_KEYWORD = "Multi-trade discovery cycle";

export type CycleRepository = Pick<PostgresCompanyDiscoveryRepository,
  "abandonStaleCycles" | "cycleRotationState" | "acquireOpportunityRun" | "knownCandidateUrls" | "recordQueryExecutions" | "complete" | "fail">;

export interface DiscoveryCycleExecution {
  readonly state: "EXECUTED" | "UNAUTHORIZED" | "OVERLAP_SUPPRESSED" | "COOLDOWN";
  readonly result: CompanyDiscoveryResult | null;
  readonly plan: readonly PlannedDiscoveryQuery[];
  readonly queries: readonly QueryExecutionRecord[];
}

export async function runDiscoveryCycle(input: {
  readonly authority: OpportunitySearchAuthority;
  readonly repository: CycleRepository;
  readonly capture: GovernedCaptureGateway;
  readonly provider?: Pick<BraveSearchProvider, "searchPlanned">;
  readonly budget?: number | null;
  readonly profileId?: string;
  readonly scheduleWindow?: Date;
  readonly spacingMs?: number;
  readonly now?: () => Date;
}): Promise<DiscoveryCycleExecution> {
  const operatorId = input.authority.kind === "HUMAN" && input.authority.authorization.state === "AUTHORIZED"
    ? input.authority.authorization.operator.operatorId : null;
  if (input.authority.kind === "HUMAN" && !operatorId) return { state: "UNAUTHORIZED", result: null, plan: [], queries: [] };
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  await input.repository.abandonStaleCycles(new Date(startedAt.getTime() - STALE_CYCLE_MINUTES * 60_000));
  const rotation = await input.repository.cycleRotationState();
  if (input.authority.kind === "HUMAN" && rotation.lastCycleStartedAt
    && startedAt.getTime() - Date.parse(rotation.lastCycleStartedAt) < MANUAL_CYCLE_COOLDOWN_MINUTES * 60_000) {
    return { state: "COOLDOWN", result: null, plan: [], queries: [] };
  }

  const plan = planDiscoveryCycle({ budget: input.budget ?? DEFAULT_QUERIES_PER_CYCLE, cycleNumber: rotation.cycleNumber, lastSearched: rotation.lastSearched });
  const trigger = input.authority.kind === "HUMAN" ? "MANUAL" : "SCHEDULED";
  const request: OpportunitySearchRequest & { readonly cycle: unknown } = {
    company: null, keyword: CYCLE_SEARCH_REQUEST_KEYWORD, tradeProfession: null, location: null,
    cycle: { cycleNumber: rotation.cycleNumber + 1, budget: plan.length, queries: plan.map(({ position, query, tradeCategoryId, geographyId, signalCategory, company }) => ({ position, query, tradeCategoryId, geographyId, signalCategory, company })) },
  };
  const runId = await input.repository.acquireOpportunityRun({
    operatorId, requestKey: randomUUID(), trigger, request, target: `${CYCLE_SEARCH_REQUEST_KEYWORD} · ${plan.length} queries`,
    profileId: input.profileId, scheduleWindow: input.scheduleWindow, startedAt,
  });
  if (!runId) return { state: "OVERLAP_SUPPRESSED", result: null, plan, queries: [] };

  const metadata = { provider: "BRAVE_WEB_SEARCH", queryCount: plan.length, queryKinds: plan.map((query) => query.kind), canonicalEvidence: false, cycle: true };
  try {
    const provider = input.provider ?? new DefaultProvider();
    const searched = await provider.searchPlanned(plan, input.spacingMs === undefined ? {} : { spacingMs: input.spacingMs });
    const found = searched.outcomes.flatMap((outcome) => outcome.candidates);
    const known = await input.repository.knownCandidateUrls(found.map((candidate) => candidate.normalizedUrl));
    const queries: QueryExecutionRecord[] = searched.outcomes.map((outcome) => ({
      query: outcome.query, state: outcome.state, resultCount: outcome.resultCount, failure: outcome.failure,
      newCount: outcome.candidates.filter((candidate) => !known.has(candidate.normalizedUrl)).length,
    }));
    const executionIds = await input.repository.recordQueryExecutions(runId, queries, now());
    if (searched.state === "NOT_CONFIGURED") {
      return { state: "EXECUTED", result: await input.repository.fail(runId, "NOT_CONFIGURED", "External discovery provider is not configured", now(), metadata), plan, queries };
    }
    const failures = queries.filter((query) => query.state !== "COMPLETED").length;
    if (failures === queries.length) {
      const reason = queries[0]?.failure ?? "PROVIDER_FAILURE";
      return { state: "EXECUTED", result: await input.repository.fail(runId, reason, "Every planned discovery query failed", now(), { ...metadata, providerQuota: searched.quota ?? null }), plan, queries };
    }
    const linked: DiscoveryCandidate[] = found.map((candidate) => ({ ...candidate, queryExecutionId: executionIds.get(candidate.queryPosition ?? -1) ?? null }));
    const processed = await processDiscoveryCandidates(CYCLE_SEARCH_REQUEST_KEYWORD, linked, input.capture, NO_AUTOMATIC_PROMOTION, NO_UNGOVERNED_EVALUATION, runId);
    const result = await input.repository.complete(runId, processed.candidates, searched.duplicatesSuppressed, { ...metadata, providerQuota: searched.quota ?? null }, now(), { ...processed, queryFailures: failures, skipRepeated: isRepeatableNoise });
    return { state: "EXECUTED", result, plan, queries };
  } catch {
    return { state: "EXECUTED", result: await input.repository.fail(runId, "DISCOVERY_PROCESSING_FAILED", "Governed discovery processing failed", now(), metadata), plan, queries: [] };
  }
}

/** Generic pages (job-board search pages, directories, homepages…) that need not be stored again when rediscovered. */
export function isRepeatableNoise(candidate: Pick<DiscoveryCandidate, "title" | "providerDescription" | "url" | "domain">): boolean {
  const text = `${candidate.title} ${candidate.providerDescription ?? ""}`;
  return genericNoiseReason({ title: candidate.title, description: candidate.providerDescription, url: candidate.url, domain: candidate.domain,
    categories: classifySignalEvidence(text, candidate.domain).categories }) !== null;
}
