import { getProductionSqlClient } from "../database/production-sql-client";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { qualifyWithSource, type PageEvidence, type SourceQualification } from "../../domain/commercial-qualification";
import { DISCOVERY_TRADE_CATEGORIES, classifySignalEvidence, detectLocation, detectTrade, detectTradeScope, detectTrades, type GeographyTier, type ProfessionEvidence, type SignalCategory } from "../../domain/discovery-coverage";

/** Freshness is separate from review status: it describes when the Radar saw the source, never whether it is verified. */
export type SignalFreshness = "NEW" | "REDISCOVERED" | "HISTORICAL" | "STALE";
/** A provider page date older than this, or no sighting for this long, marks the signal STALE (possibly expired). */
export const STALE_AFTER_DAYS = 60;

export interface SignalSearchContext {
  readonly query: string | null;
  readonly tradeCategory: string | null;
  readonly occupation: string | null;
  readonly geographyId: string | null;
  readonly geographyTier: GeographyTier | null;
  readonly signalCategory: SignalCategory | null;
  readonly company: string | null;
}

export interface SignalFilters {
  readonly trade?: string | null;
  readonly occupation?: string | null;
  readonly tier?: GeographyTier | null;
  readonly category?: SignalCategory | null;
  readonly freshness?: SignalFreshness | null;
  /** Commercial view: qualified signals plus anything a person has already reviewed (never rejected ones unless asked). */
  readonly qualifiedOnly?: boolean;
  /** Internal: the operator explicitly asked for a review status, so human decisions are shown as requested. */
  readonly statusRequested?: boolean;
}

export const SIGNAL_FRESHNESS: readonly SignalFreshness[] = ["NEW", "REDISCOVERED", "HISTORICAL", "STALE"];
export const isSignalFreshness = (value: unknown): value is SignalFreshness => typeof value === "string" && (SIGNAL_FRESHNESS as readonly string[]).includes(value);

export interface ProfessionSummary {
  readonly tradeCategoryId: string;
  /** Unique signals whose listing explicitly names this profession. */
  readonly discovered: number;
  /** Raw findings that passed the commercial qualification gate (not rejected by a person). */
  readonly qualified: number;
  readonly notReviewed: number;
  readonly verified: number;
  readonly lastSuccessfulSearchAt: string | null;
}

export type ProfessionOverview =
  | { readonly state: "READY"; readonly professions: readonly ProfessionSummary[]; readonly totalUnique: number; readonly unclassified: number; readonly multiProfession: number; readonly qualifiedTotal: number; readonly verifiedTotal: number }
  | { readonly state: "UNAVAILABLE" };

/**
 * OPPORTUNITY-FIRST. Discovered signals are public web results captured by the existing Opportunity
 * Radar discovery runs (company_discovery_candidates). One signal = one normalized source URL (later
 * runs can rediscover it); the newest candidate row represents it. A signal's status comes only from
 * human review decisions (discovery_signal_reviews) -- discovery alone never verifies anything.
 */
export const SIGNAL_STATUSES = ["NEW", "NEEDS_REVIEW", "VERIFIED", "REJECTED", "PROMOTED"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];
export type ReviewDecision = "NEEDS_REVIEW" | "VERIFIED" | "REJECTED";

export interface SignalSummary {
  readonly candidateId: string;
  readonly title: string;
  readonly url: string;
  readonly domain: string;
  readonly description: string | null;
  readonly queryKind: string;
  readonly relevanceReason: string | null;
  readonly searchKeyword: string | null;
  readonly searchLocation: string | null;
  readonly searchTrade: string | null;
  readonly firstDiscoveredAt: string;
  readonly lastDiscoveredAt: string;
  readonly timesSeen: number;
  readonly status: SignalStatus;
  readonly promotedOpportunityId: string | null;
  readonly company: string | null;
  readonly provider: string;
  readonly location: string | null;
  readonly trade: string | null;
  readonly workforceNeed: string | null;
  readonly pay: string | null;
  readonly headcount: number | null;
  readonly perDiem: string | null;
  readonly publicationDate: string | null;
  readonly qualityGroup: "READY_FOR_REVIEW" | "NEEDS_MORE_EVIDENCE" | "LOW_INFORMATION";
  readonly isLatestRun: boolean;
  readonly previouslySeen: boolean;
  /** Evidence found in the listing itself (null = not stated in the source text). */
  readonly tradeCategoryId: string | null;
  /** Every profession family (and specialty) the listing explicitly names; empty = profession unknown. */
  readonly professions: readonly ProfessionEvidence[];
  readonly workforceTradeCode: string | null;
  readonly locationTier: GeographyTier | null;
  readonly signalCategory: SignalCategory | null;
  readonly signalCategories: readonly SignalCategory[];
  readonly jobBoard: boolean;
  /** What the Radar searched for when it found this source. Search intent, never a finding. */
  readonly searchedAs: SignalSearchContext | null;
  readonly freshness: SignalFreshness;
  /** Commercial qualification from source evidence. Not verification: review status is unaffected. */
  readonly qualification: SourceQualification;
  /** Latest bounded retrieval of the original page (null = never retrieved). Kept separate from the snippet. */
  readonly page: PageEvidence | null;
}

export interface LatestDiscoveryRun {
  readonly id: string;
  readonly provider: string;
  readonly target: string;
  readonly completedAt: string;
  readonly findingsCount: number;
  readonly newlySeenCount: number;
  readonly rediscoveredCount: number;
  readonly historicalUniqueCount: number;
}

export interface SignalReview {
  readonly decision: ReviewDecision | "PROMOTED";
  readonly note: string | null;
  readonly decidedAt: string;
  readonly decidedBy: string | null;
  readonly promotedOpportunityId: string | null;
}

export interface SignalDetail extends SignalSummary {
  readonly normalizedUrl: string;
  readonly providerRank: number | null;
  readonly capturePolicy: string | null;
  readonly reviews: readonly SignalReview[];
}

export type SignalCounts = Readonly<Record<SignalStatus, number>> & { readonly total: number };

export type SignalListResult =
  | { readonly state: "READY"; readonly signals: readonly SignalSummary[]; readonly counts: SignalCounts; readonly latestRun: LatestDiscoveryRun | null; readonly filteredCount?: number }
  | { readonly state: "UNAVAILABLE" };

export type SignalDetailResult =
  | { readonly state: "READY"; readonly signal: SignalDetail }
  | { readonly state: "NOT_FOUND" | "UNAVAILABLE" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One row per normalized URL: newest candidate, occurrence stats, latest human decision, promotion.
const SIGNALS_CTE = `
with latest_run as (
  select id from company_discovery_runs where status in ('COMPLETED','PARTIAL') order by completed_at desc, id limit 1
), ranked as (
  select c.*, r.search_request, r.target_text, r.correlation_metadata,
    q.query_text as searched_query, q.trade_category as searched_trade_category, q.occupation as searched_occupation,
    q.geography_id as searched_geography_id, q.geography_tier as searched_geography_tier, q.signal_category as searched_signal_category,
    q.company_text as searched_company,
    (c.run_id = (select id from latest_run)) as is_latest_run,
    row_number() over (partition by c.normalized_candidate_url order by c.created_at desc, c.id) as rn,
    count(*) over (partition by c.normalized_candidate_url) as times_seen,
    min(c.created_at) over (partition by c.normalized_candidate_url) as first_seen,
    max(c.created_at) over (partition by c.normalized_candidate_url) as last_seen
  from company_discovery_candidates c join company_discovery_runs r on r.id = c.run_id
  left join discovery_query_executions q on q.id = c.query_execution_id
  where c.duplicate_of_candidate_id is null
), latest_review as (
  select distinct on (normalized_candidate_url) normalized_candidate_url, decision
  from discovery_signal_reviews where decision <> 'PROMOTED'
  order by normalized_candidate_url, decided_at desc, id
), promotion as (
  select normalized_candidate_url, promoted_opportunity_id from discovery_signal_reviews where decision = 'PROMOTED'
), signals as (
  select k.*, p.promoted_opportunity_id, en.*,
    case when p.promoted_opportunity_id is not null then 'PROMOTED' else coalesce(l.decision, 'NEW') end as status
  from ranked k
  left join latest_review l on l.normalized_candidate_url = k.normalized_candidate_url
  left join promotion p on p.normalized_candidate_url = k.normalized_candidate_url
  left join lateral (
    select e.status as enrichment_status, e.page_title as enrichment_title, e.extracted_text as enrichment_text,
      e.structured as enrichment_structured, e.fetched_at as enrichment_fetched_at
    from discovery_source_enrichments e where e.normalized_candidate_url = k.normalized_candidate_url
    order by e.fetched_at desc, e.id limit 1
  ) en on true
  where k.rn = 1
)`;

const SIGNAL_COLUMNS = `id, title, candidate_url, source_domain, provider_description, query_kind, relevance_reason,
  search_request->>'keyword' as search_keyword, search_request->>'location' as search_location,
  search_request->>'tradeProfession' as search_trade, target_text, correlation_metadata->>'provider' as provider,
  first_seen, last_seen, times_seen, status, promoted_opportunity_id, is_latest_run, previously_seen,
  provider_metadata->>'pageAge' as page_age, searched_query, searched_trade_category, searched_occupation, searched_geography_id,
  searched_geography_tier, searched_signal_category, searched_company, enrichment_status, enrichment_title, enrichment_text,
  enrichment_structured, enrichment_fetched_at`;

type SignalRow = {
  id: string; title: string; candidate_url: string; source_domain: string; provider_description: string | null; query_kind: string;
  relevance_reason: string | null; search_keyword: string | null; search_location: string | null; search_trade: string | null;
  first_seen: string | Date; last_seen: string | Date; times_seen: string | number; status: SignalStatus; promoted_opportunity_id: string | null;
  target_text: string; provider: string | null; is_latest_run: boolean; previously_seen: boolean;
  page_age?: string | null; searched_query?: string | null; searched_trade_category?: string | null; searched_occupation?: string | null;
  searched_geography_id?: string | null; searched_geography_tier?: GeographyTier | null; searched_signal_category?: SignalCategory | null;
  searched_company?: string | null;
  enrichment_status?: string | null; enrichment_title?: string | null; enrichment_text?: string | null;
  enrichment_structured?: { jobPosting?: PageEvidence["jobPosting"]; documentDate?: string } | null; enrichment_fetched_at?: string | Date | null;
};

const pageOf = (row: SignalRow): PageEvidence | null => (row.enrichment_status ? {
  status: row.enrichment_status, text: row.enrichment_text ?? null, title: row.enrichment_title ?? null,
  jobPosting: row.enrichment_structured?.jobPosting, documentDate: row.enrichment_structured?.documentDate,
  fetchedAt: iso(row.enrichment_fetched_at ?? new Date()),
} : null);
const DERIVE = {
  professions: (text: string, title: string) => { const fromTitle = detectTrades(title); return fromTitle.length ? fromTitle : detectTrades(text); },
  titleNamesProfession: (title: string) => detectTrades(title).length > 0,
  location: (text: string) => detectLocation(text),
  categories: (text: string, domain: string) => classifySignalEvidence(text, domain).categories,
};

const iso = (value: string | Date) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": "\"", "&#x27;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&hellip;": "…", "&nbsp;": " " };
const textOf = (row: SignalRow) => `${row.title} ${row.provider_description ?? ""}`.replace(/<[^>]+>/g, " ").replace(/&(?:amp|quot|#x27|#39|lt|gt|hellip|nbsp);/g, (entity) => ENTITIES[entity]);
// Evidence-only extraction: values come from the listing's own title/excerpt. The search inputs (area,
// trade, company target) are search context, never facts about the source, so they are not used here.
const companyFrom = (row: SignalRow) => {
  const text = textOf(row).toLowerCase();
  return [row.searched_company, row.target_text].map((name) => name?.trim()).find((name) => name && text.includes(name.toLowerCase())) ?? null;
};
const locationFrom = (row: SignalRow) => detectLocation(textOf(row));
// The title states what the listing is about; the excerpt often mentions other trades in passing ("start as a
// plumber, a welder…"). When the title names an occupation it decides; the excerpt is used only when it names none.
const titleOf = (row: SignalRow) => textOf({ ...row, provider_description: null });
const tradeFrom = (row: SignalRow) => detectTrade(titleOf(row)) ?? detectTrade(textOf(row));
const professionsFrom = (row: SignalRow) => { const fromTitle = detectTrades(titleOf(row)); return fromTitle.length ? fromTitle : detectTrades(textOf(row)); };
const payFrom = (row: SignalRow) => textOf(row).match(/\$\d+(?:\.\d{1,2})?(?:\s*-\s*\$\d+(?:\.\d{1,2})?)?\s*\/\s*(?:hr|hour)/i)?.[0] ?? null;
const perDiemFrom = (row: SignalRow) => textOf(row).match(/\$\d+(?:\.\d{1,2})?\s*(?:\/\s*day\s*)?per\s*diem|per\s*diem[^.]{0,20}?\$\d+(?:\.\d{1,2})?(?:\s*\/\s*day)?/i)?.[0] ?? null;
// "35 welder jobs" / "117 instrumentation technician openings" count job-board listings, not workers needed.
const headcountFrom = (row: SignalRow) => {
  const value = textOf(row).match(/\b(\d{1,4})\s+(?:[a-z]+\s)?(?:workers?|electricians?|apprentices?|helpers?|foremen|welders?|pipefitters?|plumbers?|millwrights?|carpenters?|ironworkers?|riggers?|operators?|technicians?|laborers?|craftsmen|craft workers?)\b(?!\s+(?:jobs?|openings?|positions?|listings?|vacanc(?:y|ies)|employment|careers?)\b)/i)?.[1];
  return value ? Number(value) : null;
};
const COMMERCIAL_CATEGORIES: readonly SignalCategory[] = ["MANPOWER_REQUEST", "SUBCONTRACTOR_VENDOR", "PROCUREMENT_BID"];
const LEGACY_DEMAND_KINDS = ["ELECTRICAL_HIRING", "WORKFORCE", "TRADE_PROFESSION"];
/**
 * Deterministic, evidence-only grouping (no scores shown): an explicit B2B request (manpower, subcontractor,
 * bid) or a demand listing that states trade + location is ready for review.
 */
const qualityFrom = (row: SignalRow): SignalSummary["qualityGroup"] => {
  const evidence = classifySignalEvidence(textOf(row), row.source_domain);
  const demand = evidence.primary !== null || LEGACY_DEMAND_KINDS.includes(row.query_kind);
  const trade = tradeFrom(row);
  const location = locationFrom(row);
  if (evidence.categories.some((category) => COMMERCIAL_CATEGORIES.includes(category)) && (trade || location)) return "READY_FOR_REVIEW";
  if (demand && trade && location && row.provider_description) return "READY_FOR_REVIEW";
  if (demand || trade || location) return "NEEDS_MORE_EVIDENCE";
  return "LOW_INFORMATION";
};
const DAY_MS = 86_400_000;
const freshnessFrom = (row: SignalRow, now = Date.now()): SignalFreshness => {
  const published = row.page_age ? Date.parse(row.page_age) : Number.NaN;
  if (!Number.isNaN(published) && now - published > STALE_AFTER_DAYS * DAY_MS) return "STALE";
  if (now - new Date(row.last_seen).getTime() > STALE_AFTER_DAYS * DAY_MS) return "STALE";
  if (!row.is_latest_run) return "HISTORICAL";
  return row.previously_seen ? "REDISCOVERED" : "NEW";
};

// Internal ordering only (never displayed): documented indicators, commercial requests and Texas relevance first.
const evidenceScore = (signal: SignalSummary) => Number(Boolean(signal.company)) + Number(Boolean(signal.location)) * 2 + Number(Boolean(signal.trade)) * 2
  + Number(Boolean(signal.workforceNeed)) * 2 + Number(signal.headcount !== null) + Number(Boolean(signal.pay)) + Number(Boolean(signal.perDiem))
  + Number(signal.signalCategories.some((category) => COMMERCIAL_CATEGORIES.includes(category))) * 3
  + Number(signal.locationTier === "HOUSTON_METRO") * 2 + Number(signal.locationTier === "TEXAS")
  + Number(signal.freshness === "NEW") - Number(signal.freshness === "STALE") * 2;

function toSummary(row: SignalRow): SignalSummary {
  const evidence = classifySignalEvidence(textOf(row), row.source_domain);
  const trade = tradeFrom(row);
  const location = locationFrom(row);
  const demand = evidence.primary !== null || LEGACY_DEMAND_KINDS.includes(row.query_kind);
  const professions = professionsFrom(row);
  const freshness = freshnessFrom(row);
  const page = pageOf(row);
  const qualification = qualifyWithSource({
    title: titleOf(row), description: row.provider_description ? textOf(row).slice(titleOf(row).length).trim() || null : null, url: row.candidate_url, domain: row.source_domain,
    professions, titleNamesProfession: detectTrades(titleOf(row)).length > 0, location, categories: evidence.categories, stale: freshness === "STALE",
  }, page, DERIVE);
  // A qualified B2B request (manpower, subcontractor, bid, project) often states trade scope, not an occupation:
  // assign the family from that stated scope so it is reachable by profession (no specialty is implied).
  const b2b = qualification.qualified && qualification.category !== "DIRECT_HIRING";
  const pageScopeText = qualification.evidenceOrigin === "ORIGINAL_PAGE" && page?.text ? `${textOf(row)}\n${page.text.slice(0, 6000)}` : textOf(row);
  const pageProfessions = !professions.length && qualification.evidenceOrigin === "ORIGINAL_PAGE" ? DERIVE.professions(pageScopeText, page?.jobPosting?.title ?? titleOf(row)) : professions;
  const listedProfessions = pageProfessions.length || !b2b ? pageProfessions : detectTradeScope(pageScopeText);
  return {
    candidateId: row.id, title: row.title, url: row.candidate_url, domain: row.source_domain, description: row.provider_description ? textOf(row).slice(row.title.length).trim() : null,
    queryKind: row.query_kind, relevanceReason: row.relevance_reason, searchKeyword: row.search_keyword, searchLocation: row.search_location,
    searchTrade: row.search_trade, firstDiscoveredAt: iso(row.first_seen), lastDiscoveredAt: iso(row.last_seen), timesSeen: Number(row.times_seen),
    status: row.status, promotedOpportunityId: row.promoted_opportunity_id,
    company: companyFrom(row) ?? qualification.organization, provider: row.provider ?? "BRAVE_WEB_SEARCH", location: location?.label ?? null, trade: trade?.text ?? null,
    workforceNeed: demand ? trade?.text ?? null : null, pay: payFrom(row), headcount: headcountFrom(row), perDiem: perDiemFrom(row),
    publicationDate: row.page_age && !Number.isNaN(Date.parse(row.page_age)) ? iso(row.page_age) : null,
    qualityGroup: qualityFrom(row), isLatestRun: row.is_latest_run, previouslySeen: row.previously_seen,
    tradeCategoryId: trade?.tradeCategoryId ?? null, professions: listedProfessions, workforceTradeCode: trade?.workforceTradeCode ?? null, locationTier: location?.tier ?? null,
    signalCategory: evidence.primary, signalCategories: evidence.categories, jobBoard: evidence.jobBoard, freshness, qualification, page,
    searchedAs: row.searched_query ? { query: row.searched_query, tradeCategory: row.searched_trade_category ?? null, occupation: row.searched_occupation ?? null,
      geographyId: row.searched_geography_id ?? null, geographyTier: row.searched_geography_tier ?? null, signalCategory: row.searched_signal_category ?? null,
      company: row.searched_company ?? null } : null,
  };
}

export function isSignalStatus(value: unknown): value is SignalStatus {
  return typeof value === "string" && (SIGNAL_STATUSES as readonly string[]).includes(value);
}

// Every filter is evidence-only: a value the listing does not state never makes it match. Search terms are
// shown as context ("Searched as") but a job ad found by a "manpower" or "construction" search stays what it says.
const matchesFilters = (signal: SignalSummary, filters: SignalFilters) =>
  (!filters.trade || signal.professions.some((profession) => profession.tradeCategoryId === filters.trade))
  && (!filters.occupation || signal.professions.some((profession) => profession.occupationIds.includes(filters.occupation!)))
  && (!filters.tier || signal.locationTier === filters.tier)
  && (!filters.category || signal.signalCategories.includes(filters.category))
  && (!filters.freshness || signal.freshness === filters.freshness)
  && (!filters.qualifiedOnly || (signal.status === "NEW" ? signal.qualification.qualified : signal.status !== "REJECTED" || filters.statusRequested === true));

export async function listSignals(client: SqlClient | null, status: SignalStatus | null, limit = 100, scope: "LATEST" | "HISTORICAL" | "ALL" = "LATEST", filters: SignalFilters = {}): Promise<SignalListResult> {
  if (!client) return { state: "UNAVAILABLE" };
  try {
    const filtered = Boolean(filters.trade || filters.occupation || filters.tier || filters.category || filters.freshness || filters.qualifiedOnly);
    const scopeSql = scope === "LATEST" ? "is_latest_run" : scope === "HISTORICAL" ? "not is_latest_run" : "true";
    const [rows, counts, run] = await Promise.all([
      client.query<SignalRow>(`${SIGNALS_CTE} select ${SIGNAL_COLUMNS} from signals where ${scopeSql} and ($1::text is null or status = $1)
        order by last_seen desc, id limit $2`, [status, filtered ? 2000 : limit]),
      client.query<{ status: SignalStatus; n: string | number }>(`${SIGNALS_CTE} select status, count(*) as n from signals where ${scopeSql} group by status`),
      client.query<{ id: string; provider: string | null; target_text: string; completed_at: string | Date; findings_count: string | number; new_count: string | number; historical_count: string | number }>(`
        with latest as (select * from company_discovery_runs where status in ('COMPLETED','PARTIAL') order by completed_at desc,id limit 1)
        select l.id,l.correlation_metadata->>'provider' provider,l.target_text,l.completed_at,l.findings_count,
          count(c.id) filter (where not c.previously_seen) new_count,
          (select count(distinct h.normalized_candidate_url) from company_discovery_candidates h
            where h.run_id <> l.id and not exists (
              select 1 from company_discovery_candidates current where current.run_id=l.id and current.normalized_candidate_url=h.normalized_candidate_url
            )) historical_count
        from latest l left join company_discovery_candidates c on c.run_id=l.id
        group by l.id,l.correlation_metadata,l.target_text,l.completed_at,l.findings_count`, []),
    ]);
    const byStatus = Object.fromEntries(SIGNAL_STATUSES.map((s) => [s, 0])) as Record<SignalStatus, number>;
    for (const row of counts.rows) byStatus[row.status] = Number(row.n);
    const latest = run.rows[0];
    const findings = latest ? Number(latest.findings_count) : 0;
    const newlySeen = latest ? Number(latest.new_count) : 0;
    const qualityOrder = { READY_FOR_REVIEW: 0, NEEDS_MORE_EVIDENCE: 1, LOW_INFORMATION: 2 } as const;
    const mapped = rows.rows.map(toSummary);
    const visible = filtered ? mapped.filter((signal) => matchesFilters(signal, filters)) : mapped;
    return { state: "READY", filteredCount: visible.length, signals: visible.slice(0, limit).sort((a, b) => qualityOrder[a.qualityGroup] - qualityOrder[b.qualityGroup] || evidenceScore(b) - evidenceScore(a) || a.title.localeCompare(b.title)), counts: { ...byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0) },
      latestRun: latest ? { id: latest.id, provider: latest.provider ?? "BRAVE_WEB_SEARCH", target: latest.target_text, completedAt: iso(latest.completed_at), findingsCount: findings, newlySeenCount: newlySeen, rediscoveredCount: findings - newlySeen, historicalUniqueCount: Number(latest.historical_count) } : null };
  } catch {
    return { state: "UNAVAILABLE" };
  }
}

export async function getSignal(client: SqlClient | null, candidateId: string): Promise<SignalDetailResult> {
  if (!UUID.test(candidateId)) return { state: "NOT_FOUND" };
  if (!client) return { state: "UNAVAILABLE" };
  try {
    const url = await client.query<{ normalized_candidate_url: string }>("select normalized_candidate_url from company_discovery_candidates where id = $1", [candidateId]);
    const normalizedUrl = url.rows[0]?.normalized_candidate_url;
    if (!normalizedUrl) return { state: "NOT_FOUND" };
    const [signal, extra, reviews] = await Promise.all([
      client.query<SignalRow>(`${SIGNALS_CTE} select ${SIGNAL_COLUMNS} from signals where normalized_candidate_url = $1`, [normalizedUrl]),
      client.query<{ provider_rank: number | null; destination_policy_decision: string | null }>("select provider_rank, destination_policy_decision::text from company_discovery_candidates where id = $1", [candidateId]),
      client.query<{ decision: SignalReview["decision"]; note: string | null; decided_at: string | Date; display: string | null; promoted_opportunity_id: string | null }>(
        `select r.decision, r.note, r.decided_at, coalesce(o.display_name, o.email) as display, r.promoted_opportunity_id
           from discovery_signal_reviews r left join workforce_operators o on o.id = r.decided_by_operator_id
          where r.normalized_candidate_url = $1 order by r.decided_at desc, r.id`, [normalizedUrl]),
    ]);
    const row = signal.rows[0];
    if (!row) return { state: "NOT_FOUND" };
    return {
      state: "READY",
      signal: {
        ...toSummary(row),
        // Keep the candidate the operator opened (the summary is the newest row for this URL).
        candidateId,
        normalizedUrl,
        providerRank: extra.rows[0]?.provider_rank ?? null,
        capturePolicy: extra.rows[0]?.destination_policy_decision ?? null,
        reviews: reviews.rows.map((r) => ({ decision: r.decision, note: r.note, decidedAt: iso(r.decided_at), decidedBy: r.display, promotedOpportunityId: r.promoted_opportunity_id })),
      },
    };
  } catch {
    return { state: "UNAVAILABLE" };
  }
}

export const loadSignals = (status: SignalStatus | null, scope: "LATEST" | "HISTORICAL" | "ALL" = "LATEST", filters: SignalFilters = {}) => listSignals(getProductionSqlClient(), status, 100, scope, filters);
/** Latest-run counts plus the ranked first-review queue for Command Center. */
export const loadSignalCounts = () => listSignals(getProductionSqlClient(), null, 100, "LATEST");
export const loadSignal = (candidateId: string) => getSignal(getProductionSqlClient(), candidateId);

/**
 * Per-profession counts over unique signals (one per normalized source URL). A signal naming two
 * professions counts once in each family but only once in totalUnique, so totals are never inflated.
 */
export async function getProfessionOverview(client: SqlClient | null): Promise<ProfessionOverview> {
  if (!client) return { state: "UNAVAILABLE" };
  try {
    const [rows, searches] = await Promise.all([
      client.query<SignalRow>(`${SIGNALS_CTE} select ${SIGNAL_COLUMNS} from signals order by last_seen desc, id`),
      client.query<{ trade_category: string; last: string | Date | null }>(
        "select trade_category, max(executed_at) as last from discovery_query_executions where status = 'COMPLETED' and trade_category is not null group by 1"),
    ]);
    const signals = rows.rows.map(toSummary);
    const lastSearch = new Map(searches.rows.map((row) => [row.trade_category, row.last ? iso(row.last) : null]));
    const professions = DISCOVERY_TRADE_CATEGORIES.map((trade) => {
      const inFamily = signals.filter((signal) => signal.professions.some((profession) => profession.tradeCategoryId === trade.id));
      return {
        tradeCategoryId: trade.id, discovered: inFamily.length,
        qualified: inFamily.filter((signal) => signal.qualification.qualified && signal.status !== "REJECTED").length, notReviewed: inFamily.filter((signal) => signal.status === "NEW").length,
        verified: inFamily.filter((signal) => signal.status === "VERIFIED" || signal.status === "PROMOTED").length, lastSuccessfulSearchAt: lastSearch.get(trade.id) ?? null,
      };
    });
    return { state: "READY", professions, totalUnique: signals.length, unclassified: signals.filter((signal) => signal.professions.length === 0).length,
      multiProfession: signals.filter((signal) => signal.professions.length > 1).length,
      qualifiedTotal: signals.filter((signal) => signal.qualification.qualified && signal.status !== "REJECTED").length,
      verifiedTotal: signals.filter((signal) => signal.status === "VERIFIED" || signal.status === "PROMOTED").length };
  } catch {
    return { state: "UNAVAILABLE" };
  }
}
export const loadProfessionOverview = () => getProfessionOverview(getProductionSqlClient());
