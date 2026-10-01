import type { CompanyDiscoveryResult, DiscoveryCandidate } from "../../domain/company-discovery";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import type { OpportunitySearchProfile, OpportunitySearchRequest, OpportunitySearchTrigger } from "../../domain/opportunity-search";
import type { PlannedDiscoveryQuery } from "../../domain/discovery-coverage";

export interface QueryExecutionRecord {
  readonly query: PlannedDiscoveryQuery;
  readonly state: "COMPLETED" | "FAILED" | "SKIPPED";
  readonly resultCount: number;
  readonly newCount: number;
  readonly failure: string | null;
}

export interface CycleQueryLogEntry {
  readonly runId: string;
  readonly position: number;
  readonly query: string;
  readonly tradeCategory: string | null;
  readonly occupation: string | null;
  readonly geographyId: string;
  readonly geographyTier: string;
  readonly signalCategory: string;
  readonly company: string | null;
  readonly status: "COMPLETED" | "FAILED" | "SKIPPED";
  readonly resultCount: number;
  readonly newCount: number;
  readonly failure: string | null;
  readonly executedAt: string;
}

export interface CycleRunSummary {
  readonly id: string;
  readonly trigger: OpportunitySearchTrigger;
  readonly status: CompanyDiscoveryResult["status"];
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly findingsCount: number;
  readonly failureCode: string | null;
}

export interface CoverageCell {
  readonly tradeCategory: string;
  readonly signalCategory: string;
  readonly lastSearchedAt: string | null;
  readonly searches: number;
  readonly failures: number;
}

export interface MultiTradeProfile {
  readonly id: string;
  readonly enabled: boolean;
  readonly cadenceHours: number;
  readonly queriesPerCycle: number | null;
  readonly nextRunAt: string;
}

export const BRAVE_DISCOVERY_SOURCE_ID = "30000000-0000-4000-8000-000000000002";

type RunRow = {
  id: string;
  target_text: string;
  target_resolution_state: CompanyDiscoveryResult["targetResolutionState"];
  status: "SEARCHING" | "COMPLETED" | "PARTIAL" | "FAILED";
  started_at: string | Date;
  completed_at: string | Date | null;
  findings_count: string | number;
  evidence_count: string | number;
  duplicates_suppressed_count: string | number;
  opportunities_created_count: string | number;
  opportunities_updated_count: string | number;
  sanitized_failure: { classification?: string } | null;
};

type CandidateRow = {
  id: string;
  query_kind: DiscoveryCandidate["queryKind"];
  title: string;
  candidate_url: string;
  normalized_candidate_url: string;
  source_domain: string;
  provider_description: string | null;
  relevance_reason: string;
  provider_rank: number;
  canonical_evidence_id: string | null;
  duplicate_of_candidate_id: string | null;
  correlated_company_id: string | null;
  correlated_project_id: string | null;
  correlated_opportunity_id: string | null;
  human_review_required: boolean;
  destination_policy_decision: "ALLOWED" | "DENIED" | "REVIEW_REQUIRED";
  processing_reason: string;
  destination_capture_failed: boolean;
  previously_seen: boolean;
  created_at: string | Date;
};

export interface OpportunitySearchRunSummary {
  readonly id: string;
  readonly trigger: OpportunitySearchTrigger;
  readonly request: OpportunitySearchRequest;
  readonly status: CompanyDiscoveryResult["status"];
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly findingsCount: number;
  readonly failureCode: string | null;
  readonly candidates: readonly DiscoveryCandidate[];
}

const asIso = (value: string | Date | null) => value === null ? null : new Date(value).toISOString();

export class PostgresCompanyDiscoveryRepository {
  constructor(private readonly db: SqlClient) {}

  async findByRequest(operatorId: string, requestKey: string): Promise<CompanyDiscoveryResult | null> {
    const result = await this.db.query<RunRow>(
      "select * from company_discovery_runs where requested_by_operator_id=$1 and request_key=$2",
      [operatorId, requestKey],
    );
    return result.rows[0] ? this.hydrate(result.rows[0]) : null;
  }

  async start(operatorId: string, requestKey: string, target: string, normalizedTarget: string, startedAt: Date): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into company_discovery_runs(
        requested_by_operator_id,request_key,trigger_kind,target_text,normalized_target_text,started_at,
        correlation_metadata
      ) values($1,$2,'MANUAL',$3,$4,$5,$6::jsonb)
      on conflict(requested_by_operator_id,request_key) do update
        set target_text=company_discovery_runs.target_text
      returning id`,
      [operatorId, requestKey, target, normalizedTarget, startedAt.toISOString(), JSON.stringify({ provider: "BRAVE_WEB_SEARCH", canonicalEvidence: false })],
    );
    await this.db.query(
      `insert into company_discovery_run_sources(run_id,source_id,status)
       values($1,$2,'SEARCHING') on conflict(run_id,source_id) do nothing`,
      [result.rows[0].id, BRAVE_DISCOVERY_SOURCE_ID],
    );
    return result.rows[0].id;
  }

  async acquireOpportunityRun(input: {
    operatorId: string | null; requestKey: string; trigger: OpportunitySearchTrigger;
    request: OpportunitySearchRequest; target: string; profileId?: string; scheduleWindow?: Date; startedAt: Date;
  }): Promise<string | null> {
    const result = await this.db.query<{ id: string }>(
      `insert into company_discovery_runs(
        requested_by_operator_id,request_key,trigger_kind,target_text,normalized_target_text,started_at,
        search_profile_id,search_request,schedule_window,correlation_metadata
      ) values($1,$2::uuid,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)
      on conflict do nothing returning id`,
      [input.operatorId, input.requestKey, input.trigger, input.target, input.target.toLocaleLowerCase("en-US"), input.startedAt.toISOString(),
        input.profileId ?? null, JSON.stringify(input.request), input.scheduleWindow?.toISOString() ?? null,
        JSON.stringify({ provider: "BRAVE_WEB_SEARCH", canonicalEvidence: false })],
    );
    const runId = result.rows[0]?.id;
    if (!runId) return null;
    await this.db.query(
      `insert into company_discovery_run_sources(run_id,source_id,status)
       values($1,$2,'SEARCHING') on conflict(run_id,source_id) do nothing`,
      [runId, BRAVE_DISCOVERY_SOURCE_ID],
    );
    return runId;
  }

  async dueProfiles(now: Date): Promise<readonly OpportunitySearchProfile[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `select id,enabled,company,keyword,trade_profession,location,cadence_hours,next_run_at,profile_kind,queries_per_cycle
       from opportunity_search_profiles where enabled=true and next_run_at <= $1 order by next_run_at,id`,
      [now.toISOString()],
    );
    return result.rows.map((row) => ({
      id: String(row.id), enabled: Boolean(row.enabled), cadenceHours: Number(row.cadence_hours), nextRunAt: new Date(String(row.next_run_at)).toISOString(),
      kind: row.profile_kind === "MULTI_TRADE_CYCLE" ? "MULTI_TRADE_CYCLE" as const : "SINGLE_QUERY" as const,
      queriesPerCycle: row.queries_per_cycle == null ? null : Number(row.queries_per_cycle),
      request: { company: row.company ? String(row.company) : null, keyword: row.keyword ? String(row.keyword) : null,
        tradeProfession: row.trade_profession ? String(row.trade_profession) : null, location: row.location ? String(row.location) : null },
    }));
  }

  async advanceProfile(profileId: string, nextRunAt: Date): Promise<void> {
    await this.db.query("update opportunity_search_profiles set next_run_at=$2,updated_at=now() where id=$1", [profileId, nextRunAt.toISOString()]);
  }

  async complete(
    runId: string,
    candidates: readonly DiscoveryCandidate[],
    duplicates: number,
    queryMetadata: unknown,
    completedAt: Date,
    processing: { readonly evidenceCount?: number; readonly opportunitiesCreatedCount?: number; readonly opportunitiesUpdatedCount?: number; readonly captureFailures?: number; readonly queryFailures?: number; readonly skipRepeated?: (candidate: DiscoveryCandidate) => boolean } = {},
  ): Promise<CompanyDiscoveryResult> {
    let repeatedNoiseSkipped = 0;
    for (const candidate of candidates) {
      const fingerprint = await this.db.query<{ seen_count: string | number }>(
        `insert into company_discovery_candidate_fingerprints(provider,normalized_candidate_url,first_seen_at,last_seen_at)
         values('BRAVE_WEB_SEARCH',$1,$2,$2)
         on conflict(provider,normalized_candidate_url) do update set
           last_seen_at=excluded.last_seen_at,seen_count=company_discovery_candidate_fingerprints.seen_count+1
         returning seen_count`,
        [candidate.normalizedUrl, completedAt.toISOString()],
      );
      const previouslySeen = Number(fingerprint.rows[0]?.seen_count ?? 1) > 1;
      // An identical generic page seen before (job-board search page, directory…) is not stored again: the
      // fingerprint above still records the sighting, and its earlier rows keep the history.
      if (previouslySeen && processing.skipRepeated?.(candidate)) { repeatedNoiseSkipped += 1; continue; }
      await this.db.query(
        `insert into company_discovery_candidates(
          run_id,discovery_source_id,query_kind,title,candidate_url,normalized_candidate_url,
          source_domain,provider_description,relevance_reason,provider_rank,provider_metadata,
          canonical_evidence_id,correlated_company_id,correlated_project_id,correlated_opportunity_id,human_review_required,
          destination_policy_decision,processing_reason,destination_capture_failed,previously_seen,query_execution_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        on conflict(run_id,normalized_candidate_url) do nothing`,
        [runId, BRAVE_DISCOVERY_SOURCE_ID, candidate.queryKind, candidate.title, candidate.url,
          candidate.normalizedUrl, candidate.domain, candidate.providerDescription,
          candidate.relevanceReason, candidate.providerRank,
          JSON.stringify(candidate.providerPageAge ? { canonicalEvidence: false, pageAge: candidate.providerPageAge } : { canonicalEvidence: false }),
          candidate.canonicalEvidenceId ?? null, candidate.correlatedCompanyId, candidate.correlatedProjectId,
          candidate.correlatedOpportunityId, candidate.humanReviewRequired,
          candidate.destinationPolicyDecision ?? "REVIEW_REQUIRED", candidate.processingReason ?? "Destination policy review is required",
          candidate.destinationCaptureFailed ?? false, previouslySeen, candidate.queryExecutionId ?? null],
      );
    }
    const queryFailures = processing.queryFailures ?? 0;
    const partial = (processing.captureFailures ?? 0) > 0 || queryFailures > 0;
    const failure = queryFailures > 0
      ? { classification: "QUERY_FAILURES", message: `${queryFailures} planned discovery ${queryFailures === 1 ? "query" : "queries"} failed or were skipped` }
      : partial ? { classification: "DESTINATION_CAPTURE_FAILURE", message: "One or more governed destination captures failed" } : null;
    await this.db.query(
      `update company_discovery_run_sources set status=$2,findings_count=$3,evidence_count=$4,
       duplicates_suppressed_count=$5,sanitized_failure=$6::jsonb where run_id=$1 and source_id=$7`,
      [runId, partial ? "FAILED" : "COMPLETED", candidates.length, processing.evidenceCount ?? 0,
        duplicates, failure ? JSON.stringify(failure) : null, BRAVE_DISCOVERY_SOURCE_ID],
    );
    await this.db.query(
      `update company_discovery_runs set status=$2,completed_at=$3,findings_count=$4,evidence_count=$5,
       duplicates_suppressed_count=$6,opportunities_created_count=$7,opportunities_updated_count=$8,
       sanitized_failure=$9::jsonb,correlation_metadata=$10::jsonb where id=$1`,
      [runId, partial ? "PARTIAL" : "COMPLETED", completedAt.toISOString(), candidates.length,
        processing.evidenceCount ?? 0, duplicates, processing.opportunitiesCreatedCount ?? 0,
        processing.opportunitiesUpdatedCount ?? 0, failure ? JSON.stringify(failure) : null,
        JSON.stringify(queryMetadata && typeof queryMetadata === "object" ? { ...queryMetadata, repeatedNoiseSkipped } : queryMetadata)],
    );
    return (await this.get(runId))!;
  }

  async fail(runId: string, classification: string, message: string, completedAt: Date, queryMetadata: unknown): Promise<CompanyDiscoveryResult> {
    const failure = { classification, message };
    await this.db.query(
      "update company_discovery_run_sources set status='FAILED',sanitized_failure=$3::jsonb where run_id=$1 and source_id=$2",
      [runId, BRAVE_DISCOVERY_SOURCE_ID, JSON.stringify(failure)],
    );
    await this.db.query(
      `update company_discovery_runs set status='FAILED',completed_at=$2,sanitized_failure=$3::jsonb,
       correlation_metadata=$4::jsonb where id=$1`,
      [runId, completedAt.toISOString(), JSON.stringify(failure), JSON.stringify(queryMetadata)],
    );
    return (await this.get(runId))!;
  }

  async get(runId: string): Promise<CompanyDiscoveryResult | null> {
    const result = await this.db.query<RunRow>("select * from company_discovery_runs where id=$1", [runId]);
    return result.rows[0] ? this.hydrate(result.rows[0]) : null;
  }

  private async hydrate(run: RunRow): Promise<CompanyDiscoveryResult> {
    const sources = await this.db.query<{ count: string | number }>(
      "select count(*) count from company_discovery_run_sources where run_id=$1",
      [run.id],
    );
    const candidates = await this.db.query<CandidateRow>(
      "select * from company_discovery_candidates where run_id=$1 order by provider_rank,created_at,id",
      [run.id],
    );
    return {
      state: run.status === "FAILED" && run.sanitized_failure?.classification === "NOT_CONFIGURED"
        ? "NOT_CONFIGURED"
        : run.status,
      runId: run.id,
      target: run.target_text,
      status: run.status,
      sourceCount: Number(sources.rows[0]?.count ?? 0),
      findingsCount: Number(run.findings_count),
      evidenceCount: Number(run.evidence_count),
      duplicatesSuppressedCount: Number(run.duplicates_suppressed_count),
      opportunitiesCreatedCount: Number(run.opportunities_created_count),
      opportunitiesUpdatedCount: Number(run.opportunities_updated_count),
      startedAt: asIso(run.started_at),
      completedAt: asIso(run.completed_at),
      targetResolutionState: run.target_resolution_state,
      candidates: candidates.rows.map((candidate) => ({
        id: candidate.id,
        queryKind: candidate.query_kind,
        title: candidate.title,
        url: candidate.candidate_url,
        normalizedUrl: candidate.normalized_candidate_url,
        domain: candidate.source_domain,
        providerDescription: candidate.provider_description,
        relevanceReason: candidate.relevance_reason,
        providerRank: candidate.provider_rank,
        evidenceCaptured: candidate.canonical_evidence_id !== null,
        canonicalEvidenceId: candidate.canonical_evidence_id,
        duplicate: candidate.duplicate_of_candidate_id !== null,
        correlatedCompanyId: candidate.correlated_company_id,
        correlatedProjectId: candidate.correlated_project_id,
        correlatedOpportunityId: candidate.correlated_opportunity_id,
        humanReviewRequired: candidate.human_review_required,
        destinationPolicyDecision: candidate.destination_policy_decision,
        processingReason: candidate.processing_reason,
        destinationCaptureFailed: candidate.destination_capture_failed,
        previouslySeen: candidate.previously_seen,
        discoveredAt: asIso(candidate.created_at) ?? undefined,
      })),
      failureCode: run.sanitized_failure?.classification ?? null,
    };
  }

  /** Marks multi-trade cycles stuck in SEARCHING (crashed process) as failed so they cannot block new cycles. */
  async abandonStaleCycles(olderThan: Date): Promise<number> {
    const result = await this.db.query<{ id: string }>(
      `update company_discovery_runs set status='FAILED',completed_at=now(),sanitized_failure=$2::jsonb
       where status='SEARCHING' and search_request ? 'cycle' and started_at < $1 returning id`,
      [olderThan.toISOString(), JSON.stringify({ classification: "STALE_CYCLE_ABANDONED", message: "Discovery cycle did not finish" })],
    );
    return result.rows.length;
  }

  async cycleRotationState(): Promise<{ readonly cycleNumber: number; readonly lastSearched: ReadonlyMap<string, string>; readonly lastCycleStartedAt: string | null }> {
    const [cells, cycles] = await Promise.all([
      this.db.query<{ trade_category: string; signal_category: string; last: string | Date }>(
        `select trade_category,signal_category,max(executed_at) last from discovery_query_executions
         where status='COMPLETED' and trade_category is not null group by 1,2`),
      this.db.query<{ n: string | number; last: string | Date | null }>(
        "select count(*) n,max(started_at) last from company_discovery_runs where search_request ? 'cycle'"),
    ]);
    return {
      cycleNumber: Number(cycles.rows[0]?.n ?? 0),
      lastCycleStartedAt: asIso(cycles.rows[0]?.last ?? null),
      lastSearched: new Map(cells.rows.map((row) => [`${row.trade_category}:${row.signal_category}`, asIso(row.last)!])),
    };
  }

  /** Normalized URLs already fingerprinted before this cycle, used to count genuinely new findings per query. */
  async knownCandidateUrls(urls: readonly string[]): Promise<ReadonlySet<string>> {
    if (!urls.length) return new Set();
    const result = await this.db.query<{ normalized_candidate_url: string }>(
      "select normalized_candidate_url from company_discovery_candidate_fingerprints where provider='BRAVE_WEB_SEARCH' and normalized_candidate_url = any($1::text[])",
      [urls],
    );
    return new Set(result.rows.map((row) => row.normalized_candidate_url));
  }

  async recordQueryExecutions(runId: string, records: readonly QueryExecutionRecord[], executedAt: Date): Promise<ReadonlyMap<number, string>> {
    const ids = new Map<number, string>();
    for (const record of records) {
      const result = await this.db.query<{ id: string }>(
        `insert into discovery_query_executions(run_id,position,query_text,query_kind,trade_category,occupation,geography_id,geography_tier,
           signal_category,company_text,status,result_count,new_count,failure_classification,executed_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
        [runId, record.query.position, record.query.query.slice(0, 300), record.query.kind, record.query.tradeCategoryId, record.query.occupationId,
          record.query.geographyId, record.query.geographyTier, record.query.signalCategory, record.query.company, record.state,
          record.resultCount, record.newCount, record.state === "COMPLETED" ? null : (record.failure ?? "FAILED"), executedAt.toISOString()],
      );
      ids.set(record.query.position, result.rows[0].id);
    }
    return ids;
  }

  async recentCycles(limit = 10): Promise<readonly CycleRunSummary[]> {
    const runs = await this.db.query<RunRow & { trigger_kind: OpportunitySearchTrigger }>(
      "select * from company_discovery_runs where search_request ? 'cycle' order by started_at desc limit $1", [limit],
    );
    return runs.rows.map((run) => ({ id: run.id, trigger: run.trigger_kind, status: run.status, startedAt: asIso(run.started_at)!,
      completedAt: asIso(run.completed_at), findingsCount: Number(run.findings_count), failureCode: run.sanitized_failure?.classification ?? null }));
  }

  async cycleQueryLog(runId: string): Promise<readonly CycleQueryLogEntry[]> {
    const rows = await this.db.query<Record<string, unknown>>("select * from discovery_query_executions where run_id=$1 order by position", [runId]);
    return rows.rows.map((row) => ({
      runId: String(row.run_id), position: Number(row.position), query: String(row.query_text),
      tradeCategory: row.trade_category ? String(row.trade_category) : null, occupation: row.occupation ? String(row.occupation) : null,
      geographyId: String(row.geography_id), geographyTier: String(row.geography_tier), signalCategory: String(row.signal_category),
      company: row.company_text ? String(row.company_text) : null, status: row.status as CycleQueryLogEntry["status"],
      resultCount: Number(row.result_count), newCount: Number(row.new_count),
      failure: row.failure_classification ? String(row.failure_classification) : null, executedAt: asIso(row.executed_at as string | Date)!,
    }));
  }

  /** Completed searches per (trade category × signal category) cell; cells never searched are coverage gaps. */
  async coverageCells(): Promise<readonly CoverageCell[]> {
    const rows = await this.db.query<{ trade_category: string; signal_category: string; last: string | Date | null; searches: string | number; failures: string | number }>(
      `select trade_category,signal_category,max(executed_at) filter (where status='COMPLETED') last,
         count(*) filter (where status='COMPLETED') searches,count(*) filter (where status<>'COMPLETED') failures
       from discovery_query_executions where trade_category is not null group by 1,2`);
    return rows.rows.map((row) => ({ tradeCategory: row.trade_category, signalCategory: row.signal_category, lastSearchedAt: asIso(row.last ?? null),
      searches: Number(row.searches), failures: Number(row.failures) }));
  }

  async geographyCoverage(): Promise<ReadonlyMap<string, string | null>> {
    const rows = await this.db.query<{ geography_id: string; last: string | Date | null }>(
      "select geography_id,max(executed_at) filter (where status='COMPLETED') last from discovery_query_executions group by 1");
    return new Map(rows.rows.map((row) => [row.geography_id, asIso(row.last ?? null)]));
  }

  async multiTradeProfile(): Promise<MultiTradeProfile | null> {
    const rows = await this.db.query<{ id: string; enabled: boolean; cadence_hours: number; queries_per_cycle: number | null; next_run_at: string | Date }>(
      "select id,enabled,cadence_hours,queries_per_cycle,next_run_at from opportunity_search_profiles where profile_kind='MULTI_TRADE_CYCLE' order by enabled desc,created_at limit 1");
    const row = rows.rows[0];
    return row ? { id: row.id, enabled: row.enabled, cadenceHours: Number(row.cadence_hours),
      queriesPerCycle: row.queries_per_cycle == null ? null : Number(row.queries_per_cycle), nextRunAt: asIso(row.next_run_at)! } : null;
  }

  async lastScheduledCycle(): Promise<CycleRunSummary | null> {
    const runs = await this.db.query<RunRow & { trigger_kind: OpportunitySearchTrigger }>(
      "select * from company_discovery_runs where search_request ? 'cycle' and trigger_kind='SCHEDULED' order by started_at desc limit 1");
    const run = runs.rows[0];
    return run ? { id: run.id, trigger: run.trigger_kind, status: run.status, startedAt: asIso(run.started_at)!, completedAt: asIso(run.completed_at),
      findingsCount: Number(run.findings_count), failureCode: run.sanitized_failure?.classification ?? null } : null;
  }

  async recentOpportunityRuns(limit = 5): Promise<readonly OpportunitySearchRunSummary[]> {
    const runs = await this.db.query<RunRow & { trigger_kind: OpportunitySearchTrigger; search_request: OpportunitySearchRequest }>(
      `select * from company_discovery_runs where search_request is not null order by started_at desc limit $1`, [limit],
    );
    return Promise.all(runs.rows.map(async (run) => {
      const hydrated = await this.hydrate(run);
      return { id: run.id, trigger: run.trigger_kind, request: run.search_request, status: run.status,
        startedAt: asIso(run.started_at)!, completedAt: asIso(run.completed_at), findingsCount: Number(run.findings_count),
        failureCode: run.sanitized_failure?.classification ?? null, candidates: hydrated.candidates };
    }));
  }
}
