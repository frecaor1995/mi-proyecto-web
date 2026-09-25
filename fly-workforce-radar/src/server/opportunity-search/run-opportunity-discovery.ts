import { randomUUID } from "node:crypto";
import type { AuthorizationResult } from "../auth/authorization";
import type { CompanyDiscoveryResult } from "../../domain/company-discovery";
import { nextScheduledRun, scheduledWindow, summarizeOpportunitySearch, type OpportunitySearchRequest } from "../../domain/opportunity-search";
import { BraveSearchProvider, type ProviderSearchResult } from "../company-discovery/brave-search-provider";
import { NO_AUTOMATIC_PROMOTION, NO_UNGOVERNED_EVALUATION, processDiscoveryCandidates, type GovernedCaptureGateway } from "../company-discovery/candidate-processing";
import { PostgresCompanyDiscoveryRepository } from "../company-discovery/discovery-repository";

export type OpportunitySearchAuthority =
  | { readonly kind: "HUMAN"; readonly authorization: AuthorizationResult }
  | { readonly kind: "SCHEDULER" };

export interface OpportunitySearchExecution {
  readonly state: "EXECUTED" | "UNAUTHORIZED" | "OVERLAP_SUPPRESSED";
  readonly result: CompanyDiscoveryResult | null;
}

async function searchWithBoundedRetry(
  provider: Pick<BraveSearchProvider, "search">,
  request: OpportunitySearchRequest,
  attempts: number,
): Promise<ProviderSearchResult> {
  let result = await provider.search(request);
  for (let attempt = 1; result.state === "FAILED" && attempt < attempts; attempt += 1) result = await provider.search(request);
  return result;
}

export async function runOpportunityDiscovery(input: {
  readonly request: OpportunitySearchRequest;
  readonly authority: OpportunitySearchAuthority;
  readonly repository: PostgresCompanyDiscoveryRepository;
  readonly capture: GovernedCaptureGateway;
  readonly provider?: Pick<BraveSearchProvider, "search">;
  readonly requestKey?: string;
  readonly profileId?: string;
  readonly scheduleWindow?: Date;
  readonly now?: () => Date;
}): Promise<OpportunitySearchExecution> {
  const operatorId = input.authority.kind === "HUMAN" && input.authority.authorization.state === "AUTHORIZED"
    ? input.authority.authorization.operator.operatorId : null;
  if (input.authority.kind === "HUMAN" && !operatorId) return { state: "UNAUTHORIZED", result: null };
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const trigger = input.authority.kind === "HUMAN" ? "MANUAL" : "SCHEDULED";
  const target = summarizeOpportunitySearch(input.request);
  const runId = await input.repository.acquireOpportunityRun({
    operatorId, requestKey: input.requestKey ?? randomUUID(), trigger, request: input.request, target,
    profileId: input.profileId, scheduleWindow: input.scheduleWindow, startedAt,
  });
  if (!runId) return { state: "OVERLAP_SUPPRESSED", result: null };
  const provider = input.provider ?? new BraveSearchProvider();
  const providerResult = await searchWithBoundedRetry(provider, input.request, trigger === "SCHEDULED" ? 3 : 1);
  const metadata = { provider: "BRAVE_WEB_SEARCH", queryCount: providerResult.queries.length,
    queryKinds: providerResult.queries.map((query) => query.kind), canonicalEvidence: false };
  if (providerResult.state === "NOT_CONFIGURED") {
    return { state: "EXECUTED", result: await input.repository.fail(runId, "NOT_CONFIGURED", "External discovery provider is not configured", now(), metadata) };
  }
  if (providerResult.state === "FAILED") {
    return { state: "EXECUTED", result: await input.repository.fail(runId, providerResult.failure.classification, providerResult.failure.message, now(), metadata) };
  }
  try {
    const processed = await processDiscoveryCandidates(input.request.company ?? target, providerResult.candidates, input.capture, NO_AUTOMATIC_PROMOTION, NO_UNGOVERNED_EVALUATION, runId);
    return { state: "EXECUTED", result: await input.repository.complete(runId, processed.candidates, providerResult.duplicatesSuppressed, metadata, now(), processed) };
  } catch {
    return { state: "EXECUTED", result: await input.repository.fail(runId, "DISCOVERY_PROCESSING_FAILED", "Governed discovery processing failed", now(), metadata) };
  }
}

export async function executeDueOpportunitySearches(input: {
  readonly repository: PostgresCompanyDiscoveryRepository;
  readonly capture: GovernedCaptureGateway;
  readonly provider?: Pick<BraveSearchProvider, "search">;
  readonly now?: Date;
}): Promise<{ readonly due: number; readonly executed: number; readonly overlapsSuppressed: number }> {
  const now = input.now ?? new Date();
  const profiles = await input.repository.dueProfiles(now);
  let executed = 0;
  let overlapsSuppressed = 0;
  for (const profile of profiles) {
    const window = scheduledWindow(now, profile.cadenceHours);
    const execution = await runOpportunityDiscovery({ request: profile.request, authority: { kind: "SCHEDULER" }, repository: input.repository,
      capture: input.capture, provider: input.provider, profileId: profile.id, scheduleWindow: window, now: () => now });
    if (execution.state === "OVERLAP_SUPPRESSED") overlapsSuppressed += 1;
    else executed += 1;
    await input.repository.advanceProfile(profile.id, nextScheduledRun(window, profile.cadenceHours));
  }
  return { due: profiles.length, executed, overlapsSuppressed };
}
