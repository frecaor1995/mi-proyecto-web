import { DISCOVERY_ACCEPTANCE_RECIPES, type DiscoveryStrategy, type EvidenceLevel } from "../../domain/discovery-intelligence";
import { buildCompanyDemandIntelligence, type CanonicalCompanyReference, type CompanyDemandGroup, type CompanyResolutionState, type DiscoveryIntelligenceObservation, type SourceRelationship, type StoredDiscoveryObservation } from "../../domain/discovery-company-intelligence";
import { getProductionSqlClient } from "../database/production-sql-client";

export interface DiscoveryIntelligenceSnapshot {
  readonly state: "READY" | "UNAVAILABLE" | "ERROR";
  readonly recipes: readonly { key: string; name: string; strategy: DiscoveryStrategy; enabled: boolean; executions: number; observations: number; useful: number; rejected: number }[];
  readonly watches: readonly { id: string; company: string | null; resolutionState: CompanyResolutionState; resolutionReason: string; sourceType: string; platform: string | null; tier: string; health: string; lastSuccessfulAt: string | null; nextEligibleAt: string }[];
  readonly recentExecutions: readonly { id: string; recipe: string; strategy: string; query: string; status: string; results: number; executedAt: string; skipReason: string | null }[];
  readonly observations: readonly DiscoveryIntelligenceObservation[];
  readonly companyDemand: readonly CompanyDemandGroup[];
  readonly metrics: { uniqueObservations: number | null; resolvedCanonical: number | null; identifiedReview: number | null; unresolved: number | null; corroborated: number | null; healthyWatchSources: number | null; manualMisses: number | null; duplicates: number | null };
  readonly sourceRelationships: Readonly<Record<SourceRelationship, number>>;
}

const sourceCounts = () => ({ DIRECT_EMPLOYER_SOURCE: 0, STAFFING_AGENCY_SOURCE: 0, AGGREGATOR_SOURCE: 0, ATS_SOURCE: 0, UNKNOWN_SOURCE_RELATIONSHIP: 0 });
const emptyMetrics = { uniqueObservations: null, resolvedCanonical: null, identifiedReview: null, unresolved: null, corroborated: null, healthyWatchSources: null, manualMisses: null, duplicates: null };
const fallback = (state: "UNAVAILABLE" | "ERROR"): DiscoveryIntelligenceSnapshot => ({ state, recipes: DISCOVERY_ACCEPTANCE_RECIPES.map((recipe) => ({ ...recipe, enabled: true, executions: 0, observations: 0, useful: 0, rejected: 0 })), watches: [], recentExecutions: [], observations: [], companyDemand: [], metrics: emptyMetrics, sourceRelationships: sourceCounts() });
const iso = (value: unknown) => new Date(String(value)).toISOString();
const nullable = (value: unknown) => value == null ? null : String(value);

export async function getDiscoveryIntelligence(): Promise<DiscoveryIntelligenceSnapshot> {
  const client = getProductionSqlClient();
  if (!client) return fallback("UNAVAILABLE");
  try {
    const [recipes, watches, operational, executions, observationRows, companyRows] = await Promise.all([
      client.query<Record<string, unknown>>(`select r.recipe_key,r.name,r.strategy_kind,r.enabled,count(distinct q.id)::int executions,count(distinct c.id)::int observations,
        count(distinct c.id) filter(where rv.decision in ('VERIFIED','PROMOTED'))::int useful,count(distinct c.id) filter(where rv.decision='REJECTED')::int rejected
        from discovery_recipes r left join discovery_query_executions q on q.recipe_id=r.id left join company_discovery_candidates c on c.recipe_id=r.id
        left join discovery_signal_reviews rv on rv.candidate_id=c.id group by r.id order by r.strategy_kind,r.name`),
      client.query<Record<string, unknown>>(`select w.id,w.company_id,w.source_type,w.platform,w.watch_tier,w.health_status,w.last_successful_at,w.next_eligible_at from discovery_watch_sources w order by w.watch_tier,w.next_eligible_at,w.id`),
      client.query<Record<string, unknown>>(`select coalesce((select sum(duplicates_suppressed_count)::int from company_discovery_runs),0) duplicates,(select count(*)::int from discovery_manual_misses) manual_misses`),
      client.query<Record<string, unknown>>(`select q.id,r.name recipe,q.strategy_kind,q.query_text,q.status,q.result_count,q.executed_at,q.skip_reason from discovery_query_executions q join discovery_recipes r on r.id=q.recipe_id order by q.executed_at desc,q.position limit 20`),
      client.query<Record<string, unknown>>(`with latest as (select distinct on(o.observation_identity) o.id,o.observation_identity,o.normalized_url,o.state,o.first_seen_at,o.last_seen_at,o.published_at,o.evidence_id,o.metadata,
        w.id watch_source_id,w.company_id,w.source_type,w.platform,w.health_status,c.title,c.source_domain,c.provider_description,c.correlated_company_id
        from discovery_watch_observations o join discovery_watch_sources w on w.id=o.watch_source_id left join company_discovery_candidates c on c.id=o.candidate_id
        order by o.observation_identity,o.captured_at desc) select * from latest order by last_seen_at desc,id`),
      client.query<Record<string, unknown>>(`select c.id,c.legal_name,c.common_name,c.normalized_legal_name,c.normalized_common_name,c.industry_metadata,
        coalesce(array_agg(a.normalized_alias) filter(where a.verification_state='VERIFIED' and a.superseded_by_alias_id is null),'{}') verified_aliases,
        (exists(select 1 from contact_routes cr where cr.company_id=c.id) or exists(select 1 from contact_investigations ci where ci.company_id=c.id)) has_contacts
        from companies c left join company_aliases a on a.company_id=c.id where c.merged_into_company_id is null group by c.id order by c.id`),
    ]);
    const companies: CanonicalCompanyReference[] = companyRows.rows.map((row) => { const metadata = (row.industry_metadata && typeof row.industry_metadata === "object" ? row.industry_metadata : {}) as Record<string, unknown>; return {
      id: String(row.id), name: String(row.common_name ?? row.legal_name), normalizedNames: [row.normalized_common_name, row.normalized_legal_name].filter((item): item is string => typeof item === "string"),
      domains: typeof metadata.website === "string" ? [metadata.website] : [], verifiedAliases: Array.isArray(row.verified_aliases) ? row.verified_aliases.map(String) : [], hasContactIntelligence: Boolean(row.has_contacts),
    }; });
    const stored: StoredDiscoveryObservation[] = observationRows.rows.map((row) => ({ id: String(row.id), identity: String(row.observation_identity), title: String(row.title ?? "Unresolved public result"),
      description: nullable(row.provider_description), normalizedUrl: String(row.normalized_url), domain: String(row.source_domain ?? new URL(String(row.normalized_url)).hostname), sourceType: String(row.source_type),
      platform: nullable(row.platform), explicitCompanyId: nullable(row.company_id ?? row.correlated_company_id), level: String((row.metadata as Record<string, unknown> | null)?.electricalLevel ?? "UNKNOWN") as EvidenceLevel,
      watchState: String(row.state), watchHealth: String(row.health_status), firstSeenAt: iso(row.first_seen_at), lastSeenAt: iso(row.last_seen_at), publishedAt: row.published_at ? iso(row.published_at) : null, canonicalEvidence: row.evidence_id != null }));
    const intelligence = buildCompanyDemandIntelligence(stored, companies);
    const resolutionByIdentity = new Map(intelligence.observations.map((item) => [item.identity, item.resolution]));
    const byWatch = new Map(observationRows.rows.map((row) => [String(row.watch_source_id), resolutionByIdentity.get(String(row.observation_identity))]));
    const relationships = sourceCounts(); for (const observation of intelligence.observations) relationships[observation.demand.sourceRelationship] += 1;
    const resolutionCount = (state: CompanyResolutionState) => intelligence.observations.filter((item) => item.resolution.state === state).length;
    const op = operational.rows[0] ?? {};
    return { state: "READY",
      recipes: recipes.rows.map((row) => ({ key: String(row.recipe_key), name: String(row.name), strategy: row.strategy_kind as DiscoveryStrategy, enabled: Boolean(row.enabled), executions: Number(row.executions), observations: Number(row.observations), useful: Number(row.useful), rejected: Number(row.rejected) })),
      watches: watches.rows.map((row) => { const resolution = byWatch.get(String(row.id)); return { id: String(row.id), company: resolution?.canonicalCompanyName ?? resolution?.observedCompany ?? null, resolutionState: resolution?.state ?? "UNRESOLVED",
        resolutionReason: resolution?.reasons.join(" · ") ?? "NO_SUPPORTING_IDENTITY", sourceType: String(row.source_type), platform: nullable(row.platform), tier: String(row.watch_tier), health: String(row.health_status),
        lastSuccessfulAt: row.last_successful_at ? iso(row.last_successful_at) : null, nextEligibleAt: iso(row.next_eligible_at) }; }),
      recentExecutions: executions.rows.map((row) => ({ id: String(row.id), recipe: String(row.recipe), strategy: String(row.strategy_kind), query: String(row.query_text), status: String(row.status), results: Number(row.result_count), executedAt: iso(row.executed_at), skipReason: nullable(row.skip_reason) })),
      observations: intelligence.observations, companyDemand: intelligence.groups, sourceRelationships: relationships,
      metrics: { uniqueObservations: intelligence.observations.length, resolvedCanonical: resolutionCount("RESOLVED_CANONICAL"), identifiedReview: resolutionCount("IDENTIFIED_NOT_CANONICAL") + resolutionCount("POSSIBLE_MATCH") + resolutionCount("AMBIGUOUS"),
        unresolved: resolutionCount("UNRESOLVED"), corroborated: intelligence.groups.filter((group) => group.corroboration !== "0").length, healthyWatchSources: watches.rows.filter((row) => row.health_status === "HEALTHY").length,
        manualMisses: Number(op.manual_misses), duplicates: Number(op.duplicates) } };
  } catch { return fallback("ERROR"); }
}
