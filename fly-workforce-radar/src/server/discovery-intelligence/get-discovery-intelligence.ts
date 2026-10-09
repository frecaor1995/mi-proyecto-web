import { DISCOVERY_ACCEPTANCE_RECIPES, type DiscoveryStrategy, type EvidenceLevel } from "../../domain/discovery-intelligence";
import { buildCompanyDemandIntelligence, type CanonicalCompanyReference, type CompanyDemandGroup, type CompanyResolutionState, type DiscoveryIntelligenceObservation, type SourceRelationship, type StoredDiscoveryObservation } from "../../domain/discovery-company-intelligence";
import { classifyDiscoveryQuantity, marketPressureLabel, type QuantityClassification } from "../../domain/discovery-quantity";
import { decomposeAggregateObservation, type AggregateDecomposition } from "../../domain/aggregator-decomposition";
import { getProductionSqlClient } from "../database/production-sql-client";
import { COMPANY_ATS_CATALOG, classifyCommercialSignals } from "../../domain/company-ats-catalog";
import { loadSourcePolicies } from "./ats-readiness";

export interface DiscoveryIntelligenceSnapshot {
  readonly state: "READY" | "UNAVAILABLE" | "ERROR";
  readonly recipes: readonly { key: string; name: string; strategy: DiscoveryStrategy; enabled: boolean; executions: number; observations: number; useful: number; rejected: number }[];
  readonly watches: readonly { id: string; company: string | null; resolutionState: CompanyResolutionState; resolutionReason: string; sourceType: string; platform: string | null; tier: string; health: string; lastSuccessfulAt: string | null; nextEligibleAt: string }[];
  readonly recentExecutions: readonly { id: string; recipe: string; strategy: string; query: string; status: string; results: number; executedAt: string; skipReason: string | null }[];
  readonly observations: readonly DiscoveryIntelligenceObservation[];
  readonly companyDemand: readonly CompanyDemandGroup[];
  readonly aggregateMarketSignals: readonly { observationId: string; candidateId: string; title: string; url: string; domain: string; profession: string | null; level: string; location: string | null; count: number; firstSeenAt: string; lastSeenAt: string; sourceRelationship: SourceRelationship; employerHeadcount: null; decomposition: AggregateDecomposition; warning: string }[];
  readonly individualPostings: readonly { identity:string;evidenceId:string;sourceUrl:string;employerName:string|null;title:string|null;profession:string|null;location:string|null;capturedAt:string;relationship:string;vendorAcceptance:"UNKNOWN";parentAggregateObservationId:string|null;evidenceCompleteness:string;reviewHref:string|null;
    provenance:"AUTOMATED_HTTP"|"ASSISTED_MANUAL"|"EMAIL_ALERT";dataClass:"REAL"|"DEMO";reviewDecision:string|null;experience:string|null;licenses:readonly string[];compensation:string|null;emailAlert:{sender:string;receivedOn:string;alertReference:string}|null }[];
  /** Recipe 2.0 channels, verification, restrictions and commercial progress (REAL records only; targets are goals, not results). */
  readonly recipe20: Recipe20Snapshot | null;
  readonly reviewQueue: readonly { observationId: string; candidateId: string; title: string; company: string; resolutionState: CompanyResolutionState; reviewState: string; profession: string | null; level: string; location: string | null; source: string; sourceRelationship: SourceRelationship; corroboration: string; quantity: QuantityClassification; priority: "HIGH REVIEW VALUE" | "MEDIUM REVIEW VALUE" | "NORMAL REVIEW"; reasons: readonly string[]; nextAction: string }[];
  readonly marketPressure: { sourceSignalCount: number; summedMarketCount: null; label: string };
  readonly metrics: { uniqueObservations: number | null; resolvedCanonical: number | null; identifiedReview: number | null; unresolved: number | null; corroborated: number | null; healthyWatchSources: number | null; manualMisses: number | null; duplicates: number | null };
  readonly sourceRelationships: Readonly<Record<SourceRelationship, number>>;
}

export interface Recipe20Snapshot {
  readonly channels: Readonly<Record<"AUTOMATED_HTTP" | "ASSISTED_MANUAL" | "EMAIL_ALERT", number>>;
  readonly realPostings: number;
  readonly demoPostings: number;
  readonly verifiedPostings: number;
  readonly duplicatesPrevented: number;
  readonly reObservations: number;
  readonly restrictedSources: number;
  readonly commercialSignals: number;
  readonly possibleClients: readonly { readonly employer: string; readonly signals: readonly string[] }[];
  readonly conversations: number;
  readonly results: number;
  readonly targets: { readonly realPostings: 40; readonly possibleClients: 8 };
  readonly sources: Awaited<ReturnType<typeof loadSourcePolicies>>;
}

const sourceCounts = () => ({ DIRECT_EMPLOYER_SOURCE: 0, STAFFING_AGENCY_SOURCE: 0, AGGREGATOR_SOURCE: 0, ATS_SOURCE: 0, UNKNOWN_SOURCE_RELATIONSHIP: 0 });
const emptyMetrics = { uniqueObservations: null, resolvedCanonical: null, identifiedReview: null, unresolved: null, corroborated: null, healthyWatchSources: null, manualMisses: null, duplicates: null };
const fallback = (state: "UNAVAILABLE" | "ERROR"): DiscoveryIntelligenceSnapshot => ({ state, recipes: DISCOVERY_ACCEPTANCE_RECIPES.map((recipe) => ({ ...recipe, enabled: true, executions: 0, observations: 0, useful: 0, rejected: 0 })), watches: [], recentExecutions: [], observations: [], companyDemand: [], aggregateMarketSignals: [], individualPostings:[], recipe20: null, reviewQueue: [], marketPressure: { sourceSignalCount: 0, summedMarketCount: null, label: "NO AGGREGATE MARKET COUNT" }, metrics: emptyMetrics, sourceRelationships: sourceCounts() });
const iso = (value: unknown) => new Date(String(value)).toISOString();
const nullable = (value: unknown) => value == null ? null : String(value);

export async function getDiscoveryIntelligence(): Promise<DiscoveryIntelligenceSnapshot> {
  const client = getProductionSqlClient();
  if (!client) return fallback("UNAVAILABLE");
  try {
    const [recipes, watches, operational, executions, observationRows, companyRows,postingRows] = await Promise.all([
      client.query<Record<string, unknown>>(`select r.recipe_key,r.name,r.strategy_kind,r.enabled,count(distinct q.id)::int executions,count(distinct c.id)::int observations,
        count(distinct c.id) filter(where rv.decision in ('VERIFIED','PROMOTED'))::int useful,count(distinct c.id) filter(where rv.decision='REJECTED')::int rejected
        from discovery_recipes r left join discovery_query_executions q on q.recipe_id=r.id left join company_discovery_candidates c on c.recipe_id=r.id
        left join discovery_signal_reviews rv on rv.candidate_id=c.id group by r.id order by r.strategy_kind,r.name`),
      client.query<Record<string, unknown>>(`select w.id,w.company_id,w.source_type,w.platform,w.watch_tier,w.health_status,w.last_successful_at,w.next_eligible_at from discovery_watch_sources w order by w.watch_tier,w.next_eligible_at,w.id`),
      client.query<Record<string, unknown>>(`select coalesce((select sum(duplicates_suppressed_count)::int from company_discovery_runs),0) duplicates,(select count(*)::int from discovery_manual_misses) manual_misses`),
      client.query<Record<string, unknown>>(`select q.id,r.name recipe,q.strategy_kind,q.query_text,q.status,q.result_count,q.executed_at,q.skip_reason from discovery_query_executions q join discovery_recipes r on r.id=q.recipe_id order by q.executed_at desc,q.position limit 20`),
      client.query<Record<string, unknown>>(`with latest as (select distinct on(o.observation_identity) o.id,o.candidate_id,o.observation_identity,o.normalized_url,o.state,o.first_seen_at,o.last_seen_at,o.published_at,o.evidence_id,o.metadata,
        w.id watch_source_id,w.source_id,w.company_id,w.source_type,w.platform,w.health_status,c.title,c.source_domain,c.provider_description,c.provider_metadata,c.correlated_company_id,c.recipe_id,c.run_id,r.correlation_metadata,
        e.source_url evidence_source_url,e.captured_at evidence_captured_at,e.metadata evidence_metadata,
        a.candidate_company_id reviewed_company_id,a.confidence_metadata->>'operatorOutcome' company_review_outcome,hd.decision demand_review_decision
        from discovery_watch_observations o join discovery_watch_sources w on w.id=o.watch_source_id left join company_discovery_candidates c on c.id=o.candidate_id
        left join company_discovery_runs r on r.id=c.run_id left join raw_evidence e on e.id=o.evidence_id
        left join lateral(select candidate_company_id,confidence_metadata from company_resolution_audits where discovery_watch_observation_id=o.id order by resolved_at desc,created_at desc,id desc limit 1)a on true
        left join lateral(select h.decision from discovery_observation_demand_signals x join human_verification_decisions h on h.target_type='DEMAND_SIGNAL' and h.target_id=x.demand_signal_id where x.discovery_watch_observation_id=o.id order by h.decided_at desc,h.created_at desc limit 1)hd on true
        order by o.observation_identity,o.captured_at desc) select * from latest order by last_seen_at desc,id`),
      client.query<Record<string, unknown>>(`select c.id,c.legal_name,c.common_name,c.normalized_legal_name,c.normalized_common_name,c.industry_metadata,
        coalesce(array_agg(a.normalized_alias) filter(where a.verification_state='VERIFIED' and a.superseded_by_alias_id is null),'{}') verified_aliases,
        (exists(select 1 from contact_routes cr where cr.company_id=c.id) or exists(select 1 from contact_investigations ci where ci.company_id=c.id)) has_contacts
        from companies c left join company_aliases a on a.company_id=c.id where c.merged_into_company_id is null group by c.id order by c.id`),
      client.query<Record<string,unknown>>(`select e.id,e.source_url,e.captured_at,e.metadata,
        (select c.id from company_discovery_candidates c where c.canonical_evidence_id=e.id order by c.created_at desc,c.id limit 1) candidate_id,
        (select r.decision from discovery_signal_reviews r where r.normalized_candidate_url=e.metadata->'posting'->>'normalizedUrl' order by r.decided_at desc,r.id desc limit 1) review_decision
        from raw_evidence e where e.metadata->>'recipe11'='true' order by e.captured_at desc,e.id limit 50`),
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
    const rowByIdentity = new Map(observationRows.rows.map((row) => [String(row.observation_identity), row]));
    const quantities = new Map(intelligence.observations.map((item) => [item.identity, classifyDiscoveryQuantity({ title: item.title, description: stored.find((source) => source.identity === item.identity)?.description, domain: item.domain, url: item.normalizedUrl })]));
    const aggregateMarketSignals = intelligence.observations.flatMap((item) => { const quantity = quantities.get(item.identity)!; const row = rowByIdentity.get(item.identity)!; if(quantity.type !== "AGGREGATE_MARKET_COUNT" || quantity.value === null)return [];
      const sourceId=String(row.source_id);const providerMetadata=row.provider_metadata&&typeof row.provider_metadata==="object"?row.provider_metadata:{};const evidenceMetadata=row.evidence_metadata&&typeof row.evidence_metadata==="object"?row.evidence_metadata:null;
      const correlation=row.correlation_metadata&&typeof row.correlation_metadata==="object"?row.correlation_metadata as Record<string,unknown>:{};
      const decomposition=decomposeAggregateObservation({observationId:item.id,candidateId:String(row.candidate_id),observationIdentity:item.identity,normalizedUrl:item.normalizedUrl,sourceId,aggregateCount:quantity.value,
        recipeId:nullable(row.recipe_id),runId:String(row.run_id),queryExecutionId:nullable(correlation.queryExecutionId),firstSeenAt:item.firstSeenAt,lastSeenAt:item.lastSeenAt},[
        ...(evidenceMetadata?[{evidenceId:nullable(row.evidence_id),sourceId,capturedAt:iso(row.evidence_captured_at??row.last_seen_at),sourceUrl:String(row.evidence_source_url??item.normalizedUrl),metadata:evidenceMetadata,provenance:"RAW_EVIDENCE" as const}]:[]),
        {evidenceId:null,sourceId,capturedAt:item.lastSeenAt,sourceUrl:item.normalizedUrl,metadata:providerMetadata,provenance:"PERSISTED_PROVIDER_METADATA" as const},
      ]);
      return [{ observationId: item.id, candidateId: String(row.candidate_id), title: item.title, url: item.normalizedUrl, domain: item.domain, profession: item.demand.profession, level: item.demand.level, location: item.demand.location, count: quantity.value, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt, sourceRelationship: item.demand.sourceRelationship, employerHeadcount: null, decomposition, warning: "Aggregate source count — not confirmed employer headcount." }]; });
    const groupByObservation = new Map(intelligence.groups.flatMap((group) => group.observations.map((observation) => [observation.id, group] as const)));
    const reviewQueue = intelligence.observations.map((item) => { const row = rowByIdentity.get(item.identity)!; const group = groupByObservation.get(item.id); const quantity = quantities.get(item.identity)!; const high = quantity.type === "AGGREGATE_MARKET_COUNT" || group?.corroboration === "2+"; const medium = item.resolution.state !== "UNRESOLVED" || group?.corroboration === "1"; const companyOutcome=nullable(row.company_review_outcome);const demandDecision=nullable(row.demand_review_decision);const reviewState=demandDecision==="VERIFY"?"DEMAND VERIFIED":demandDecision==="REJECT"?"DEMAND REJECTED":demandDecision==="DEFER"?"DEMAND DEFERRED":row.reviewed_company_id?"DEMAND REVIEW REQUIRED":companyOutcome==="DEFER"?"DEFERRED":companyOutcome==="REJECT_MATCH"?"MATCH REJECTED":companyOutcome==="UNSUPPORTED"?"IDENTITY UNSUPPORTED":companyOutcome==="NOT_ACTIONABLE"?"NOT ACTIONABLE":"UNREVIEWED"; return { observationId: item.id, candidateId: String(row.candidate_id), title: item.title, company: item.resolution.observedCompany ?? "Identity unresolved", resolutionState: item.resolution.state, reviewState, profession: item.demand.profession, level: item.demand.level, location: item.demand.location, source: item.domain, sourceRelationship: item.demand.sourceRelationship, corroboration: group?.corroboration ?? "0", quantity, priority: high ? "HIGH REVIEW VALUE" as const : medium ? "MEDIUM REVIEW VALUE" as const : "NORMAL REVIEW" as const, reasons: [...item.resolution.reasons, quantity.reason], nextAction: demandDecision==="VERIFY"?"Review verified demand or promote separately":row.reviewed_company_id?"Review demand evidence":companyOutcome==="DEFER"?"Resume when stronger evidence is available":item.resolution.state === "POSSIBLE_MATCH" ? "Confirm or reject possible company match" : item.resolution.state === "IDENTIFIED_NOT_CANONICAL" ? "Link an existing company or create through Companies" : "Keep unresolved, defer, or mark not actionable" }; });
    const resolutionByIdentity = new Map(intelligence.observations.map((item) => [item.identity, item.resolution]));
    const byWatch = new Map(observationRows.rows.map((row) => [String(row.watch_source_id), resolutionByIdentity.get(String(row.observation_identity))]));
    const relationships = sourceCounts(); for (const observation of intelligence.observations) relationships[observation.demand.sourceRelationship] += 1;
    const resolutionCount = (state: CompanyResolutionState) => intelligence.observations.filter((item) => item.resolution.state === state).length;
    const op = operational.rows[0] ?? {};
    const individualPostings = postingRows.rows.map((row) => { const metadata = row.metadata as Record<string, unknown>; const posting = (metadata.posting ?? {}) as Record<string, unknown>;
      const provenance = (metadata.provenance === "ASSISTED_MANUAL" || metadata.provenance === "EMAIL_ALERT" ? metadata.provenance : "AUTOMATED_HTTP") as "AUTOMATED_HTTP" | "ASSISTED_MANUAL" | "EMAIL_ALERT";
      const alert = metadata.emailAlert && typeof metadata.emailAlert === "object" ? metadata.emailAlert as Record<string, unknown> : null;
      return { identity: String(metadata.postingIdentity), evidenceId: String(row.id), sourceUrl: String(row.source_url), employerName: nullable(posting.employerName), title: nullable(posting.title), profession: nullable(posting.profession),
        location: nullable(posting.location), capturedAt: iso(row.captured_at), relationship: String(posting.relationship ?? "UNKNOWN"), vendorAcceptance: "UNKNOWN" as const, parentAggregateObservationId: nullable(posting.parentAggregateObservationId),
        evidenceCompleteness: String(posting.evidenceCompleteness ?? "PARTIAL"), reviewHref: row.candidate_id ? `/radar/${String(row.candidate_id)}` : null, provenance,
        dataClass: (metadata.dataClass === "DEMO" ? "DEMO" : "REAL") as "REAL" | "DEMO", reviewDecision: nullable(row.review_decision), experience: nullable(posting.experience),
        licenses: Array.isArray(posting.licenses) ? posting.licenses.map(String) : [], compensation: nullable(posting.compensation),
        emailAlert: alert ? { sender: String(alert.sender ?? ""), receivedOn: String(alert.receivedOn ?? ""), alertReference: String(alert.alertReference ?? "") } : null };
    });
    let recipe20: Recipe20Snapshot | null = null;
    try {
      const [obsRows, runRows, activityRows, sources] = await Promise.all([
        client.query<Record<string, unknown>>(`select o.observation_identity, o.captured_at, o.evidence_id, e.metadata->'posting'->>'employerName' employer, e.metadata->'posting'->>'title' title,
          e.metadata->'posting'->>'relationship' relationship, coalesce(e.metadata->>'dataClass','REAL') data_class, coalesce(e.metadata->>'provenance','AUTOMATED_HTTP') provenance, e.metadata->'posting'->>'normalizedUrl' url
          from discovery_watch_observations o join raw_evidence e on e.id=o.evidence_id where o.metadata->>'recipe11'='true'`),
        client.query<Record<string, unknown>>(`select count(*) filter (where correlation_metadata->>'assistedOutcome'='DUPLICATE')::int duplicates, count(*) filter (where correlation_metadata->>'assistedOutcome'='RE_OBSERVED')::int reobserved from company_discovery_runs where correlation_metadata->>'step'='ASSISTED_CAPTURE'`),
        client.query<Record<string, unknown>>(`select count(*) filter (where outcome in ('CONVERSATION','ACCEPTS_EXTERNAL_LABOR','DOES_NOT_ACCEPT_EXTERNAL_LABOR','NO_CURRENT_NEED','VENDOR_REGISTRATION_REQUIRED','STAFF_REQUEST','NOT_INTERESTED'))::int conversations,
          count(*) filter (where activity_type='RESULT')::int results from commercial_activities`),
        loadSourcePolicies(client),
      ]);
      const real = obsRows.rows.filter((r) => r.data_class !== "DEMO");
      const identities = (rows: typeof real) => new Set(rows.map((r) => String(r.observation_identity)));
      const realIds = identities(real);
      const verifiedUrls = new Set(individualPostings.filter((p) => p.dataClass === "REAL" && (p.reviewDecision === "VERIFIED" || p.reviewDecision === "PROMOTED")).map((p) => p.identity));
      const byEmployer = new Map<string, typeof real>();
      for (const r of real) { const employer = String(r.employer ?? "").trim(); if (employer) byEmployer.set(employer, [...(byEmployer.get(employer) ?? []), r]); }
      const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const classified = [...byEmployer.entries()].map(([employer, rows]) => { const target = COMPANY_ATS_CATALOG.find((t) => normalize(t.name).includes(normalize(employer)) || normalize(employer).includes(normalize(t.name).split(" ")[0]));
        return { employer, result: classifyCommercialSignals({ companyType: target?.companyType ?? "ELECTRICAL_CONTRACTOR", companyTypeEvidence: target ? `catalog:${target.key}` : null, explicitExternalNeed: null,
          observations: rows.map((r) => ({ postingIdentity: String(r.observation_identity), title: nullable(r.title), observedAt: iso(r.captured_at), evidenceId: String(r.evidence_id),
            relationship: (r.relationship === "DIRECT_HIRE_POSTING" || r.relationship === "STAFFING_POSTING" ? r.relationship : "UNKNOWN") as "DIRECT_HIRE_POSTING" | "STAFFING_POSTING" | "UNKNOWN" })) }) }; });
      const channel = (name: string) => identities(real.filter((r) => r.provenance === name)).size;
      const activities = activityRows.rows[0] ?? {};
      recipe20 = { channels: { AUTOMATED_HTTP: channel("AUTOMATED_HTTP"), ASSISTED_MANUAL: channel("ASSISTED_MANUAL"), EMAIL_ALERT: channel("EMAIL_ALERT") }, realPostings: realIds.size,
        demoPostings: identities(obsRows.rows.filter((r) => r.data_class === "DEMO")).size, verifiedPostings: verifiedUrls.size,
        duplicatesPrevented: Number(runRows.rows[0]?.duplicates ?? 0), reObservations: Number(runRows.rows[0]?.reobserved ?? 0),
        restrictedSources: sources.filter((s) => ["BLOCKED_TERMS", "BLOCKED_PENDING_PERMISSION", "RESTRICTED_PLATFORM"].includes(s.effective.policy)).length,
        commercialSignals: classified.reduce((n, c) => n + c.result.reasons.length, 0),
        possibleClients: classified.filter((c) => c.result.classification === "POSIBLE_CLIENTE").map((c) => ({ employer: c.employer, signals: c.result.reasons.map((r) => r.signal) })),
        conversations: Number(activities.conversations ?? 0), results: Number(activities.results ?? 0), targets: { realPostings: 40, possibleClients: 8 }, sources };
    } catch { recipe20 = null; }
    return { state: "READY",
      recipes: recipes.rows.map((row) => ({ key: String(row.recipe_key), name: String(row.name), strategy: row.strategy_kind as DiscoveryStrategy, enabled: Boolean(row.enabled), executions: Number(row.executions), observations: Number(row.observations), useful: Number(row.useful), rejected: Number(row.rejected) })),
      watches: watches.rows.map((row) => { const resolution = byWatch.get(String(row.id)); return { id: String(row.id), company: resolution?.canonicalCompanyName ?? resolution?.observedCompany ?? null, resolutionState: resolution?.state ?? "UNRESOLVED",
        resolutionReason: resolution?.reasons.join(" · ") ?? "NO_SUPPORTING_IDENTITY", sourceType: String(row.source_type), platform: nullable(row.platform), tier: String(row.watch_tier), health: String(row.health_status),
        lastSuccessfulAt: row.last_successful_at ? iso(row.last_successful_at) : null, nextEligibleAt: iso(row.next_eligible_at) }; }),
      recentExecutions: executions.rows.map((row) => ({ id: String(row.id), recipe: String(row.recipe), strategy: String(row.strategy_kind), query: String(row.query_text), status: String(row.status), results: Number(row.result_count), executedAt: iso(row.executed_at), skipReason: nullable(row.skip_reason) })),
      observations: intelligence.observations, companyDemand: intelligence.groups, aggregateMarketSignals,
      individualPostings, recipe20,
      reviewQueue, marketPressure: marketPressureLabel([...quantities.values()]), sourceRelationships: relationships,
      metrics: { uniqueObservations: intelligence.observations.length, resolvedCanonical: resolutionCount("RESOLVED_CANONICAL"), identifiedReview: resolutionCount("IDENTIFIED_NOT_CANONICAL") + resolutionCount("POSSIBLE_MATCH") + resolutionCount("AMBIGUOUS"),
        unresolved: resolutionCount("UNRESOLVED"), corroborated: intelligence.groups.filter((group) => group.corroboration !== "0").length, healthyWatchSources: watches.rows.filter((row) => row.health_status === "HEALTHY").length,
        manualMisses: Number(op.manual_misses), duplicates: Number(op.duplicates) } };
  } catch { return fallback("ERROR"); }
}
