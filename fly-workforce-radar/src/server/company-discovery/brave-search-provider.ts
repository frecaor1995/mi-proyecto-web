import { isIP } from "node:net";
import type { DiscoveryCandidate, DiscoveryQueryKind } from "../../domain/company-discovery";
import type { OpportunitySearchRequest } from "../../domain/opportunity-search";
import type { PlannedDiscoveryQuery } from "../../domain/discovery-coverage";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_QUERIES = 7;
const MAX_RESULTS_PER_QUERY = 5;
const MAX_CANDIDATES = 20;
const MAX_RESPONSE_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;
const CYCLE_RESULTS_PER_QUERY = 8;
/** Brave's base plan allows one request per second; cycle queries are spaced to stay under it. */
const CYCLE_QUERY_SPACING_MS = 1_100;

export interface DiscoveryQuery {
  readonly kind: DiscoveryQueryKind;
  readonly query: string;
  readonly reason: string;
}

export type ProviderSearchResult =
  | { readonly state: "NOT_CONFIGURED"; readonly queries: readonly DiscoveryQuery[] }
  | { readonly state: "FAILED"; readonly queries: readonly DiscoveryQuery[]; readonly failure: { readonly classification: string; readonly message: string } }
  | { readonly state: "COMPLETED"; readonly queries: readonly DiscoveryQuery[]; readonly candidates: readonly DiscoveryCandidate[]; readonly duplicatesSuppressed: number };

export interface PlannedQueryOutcome {
  readonly query: PlannedDiscoveryQuery;
  readonly state: "COMPLETED" | "FAILED" | "SKIPPED";
  readonly candidates: readonly DiscoveryCandidate[];
  readonly resultCount: number;
  readonly failure: string | null;
}

/** Quota as reported by the provider's own X-RateLimit-* headers (per-second window, then the monthly window). */
export interface ProviderQuota {
  readonly perSecondLimit: number | null;
  readonly monthlyLimit: number | null;
  readonly monthlyRemaining: number | null;
  readonly monthlyResetSeconds: number | null;
  readonly observedAt: string;
}

export function providerQuotaFrom(headers: Pick<Headers, "get">, now = new Date()): ProviderQuota | null {
  const list = (name: string) => (headers.get(name) ?? "").split(",").map((part) => part.trim()).filter(Boolean).map(Number);
  const limit = list("x-ratelimit-limit");
  const remaining = list("x-ratelimit-remaining");
  const reset = list("x-ratelimit-reset");
  if (!limit.length && !remaining.length) return null;
  const at = (values: number[], index: number) => (Number.isFinite(values[index]) ? values[index] : null);
  return { perSecondLimit: at(limit, 0), monthlyLimit: at(limit, 1), monthlyRemaining: at(remaining, 1), monthlyResetSeconds: at(reset, 1), observedAt: now.toISOString() };
}

export type PlannedSearchResult =
  | { readonly state: "NOT_CONFIGURED"; readonly outcomes: readonly PlannedQueryOutcome[] }
  | { readonly state: "COMPLETED"; readonly outcomes: readonly PlannedQueryOutcome[]; readonly duplicatesSuppressed: number; readonly quota?: ProviderQuota | null };

interface BraveResponse {
  readonly web?: {
    readonly results?: readonly {
      readonly title?: unknown;
      readonly url?: unknown;
      readonly description?: unknown;
      readonly page_age?: unknown;
    }[];
  };
}

export function buildCompanyDiscoveryQueries(target: string): readonly DiscoveryQuery[] {
  const quoted = `"${target.replaceAll('"', "")}"`;
  const queries: readonly DiscoveryQuery[] = [
    { kind: "EXACT_COMPANY", query: quoted, reason: "Exact company identity or official-domain candidate" },
    { kind: "PROJECTS", query: `${quoted} active projects project locations`, reason: "Active project or location intelligence" },
    { kind: "ELECTRICAL_HIRING", query: `${quoted} electrician electrical hiring jobs`, reason: "Electrical workforce demand" },
    { kind: "WORKFORCE", query: `${quoted} workforce manpower recruiting`, reason: "Workforce or manpower demand" },
    { kind: "CONSTRUCTION", query: `${quoted} construction project`, reason: "Construction activity" },
    { kind: "PROCUREMENT", query: `${quoted} procurement subcontractor vendor bid`, reason: "Procurement or vendor opportunity" },
    { kind: "TEXAS", query: `${quoted} Texas project hiring procurement`, reason: "Texas commercial activity" },
  ];
  return queries.slice(0, MAX_QUERIES);
}

export function buildOpportunityDiscoveryQueries(request: OpportunitySearchRequest): readonly DiscoveryQuery[] {
  const company = request.company ? `"${request.company.replaceAll('"', "")}"` : null;
  const parts = [company, request.keyword, request.tradeProfession, request.location].filter(Boolean) as string[];
  if (parts.length === 0) return [];
  const queries: DiscoveryQuery[] = [
    { kind: "COMBINED", query: parts.join(" "), reason: "Combined operator search intent" },
  ];
  if (company) queries.push({ kind: "EXACT_COMPANY", query: company, reason: "Exact company identity or official-domain candidate" });
  if (request.keyword) queries.push({ kind: "KEYWORD", query: [company, request.keyword, request.location].filter(Boolean).join(" "), reason: "Opportunity, project, or keyword intent" });
  if (request.tradeProfession) queries.push({ kind: "TRADE_PROFESSION", query: [company, request.tradeProfession, "jobs hiring project", request.location].filter(Boolean).join(" "), reason: "Trade or profession workforce demand" });
  if (request.location) queries.push({ kind: "LOCATION", query: [company, request.keyword ?? request.tradeProfession ?? "construction opportunities", request.location].filter(Boolean).join(" "), reason: "Location-scoped opportunity discovery" });
  return queries.slice(0, MAX_QUERIES);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

export function normalizePublicCandidateUrl(value: string): { normalizedUrl: string; domain: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return null;
    if (hostname.startsWith("[") || hostname.includes(":")) return null;
    const ipVersion = isIP(hostname);
    if ((ipVersion === 4 && isPrivateIpv4(hostname)) || ipVersion === 6) return null;
    url.hostname = hostname;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return { normalizedUrl: url.toString(), domain: hostname };
  } catch {
    return null;
  }
}

/** Brave reports page_age as an offset-less UTC timestamp; never let the server time zone shift it. */
function pageAgeIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value.trim()) || !value.includes("T") ? value.trim() : `${value.trim()}Z`;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function safeText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

export class BraveSearchProvider {
  constructor(
    private readonly apiKey: string | undefined = process.env.BRAVE_SEARCH_API_KEY,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private lastQuota: ProviderQuota | null = null;

  private async fetchResults(query: string, count: number): Promise<NonNullable<NonNullable<BraveResponse["web"]>["results"]>> {
    const endpoint = new URL(BRAVE_ENDPOINT);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("country", "US");
    endpoint.searchParams.set("search_lang", "en");
    endpoint.searchParams.set("safesearch", "strict");
    endpoint.searchParams.set("count", String(count));
    const response = await this.transport(endpoint, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey ?? "",
        "Api-Version": "2023-01-01",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    this.lastQuota = providerQuotaFrom(response.headers) ?? this.lastQuota;
    const length = Number(response.headers.get("content-length") ?? "0");
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    if (length > MAX_RESPONSE_BYTES) throw new Error("Provider response exceeded size limit");
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Provider response exceeded size limit");
    return ((JSON.parse(body) as BraveResponse).web?.results ?? []).slice(0, count);
  }

  /**
   * Multi-trade cycle execution. Each planned query is isolated: one failure is recorded for that query and
   * the cycle continues. A rate-limit response (HTTP 429) stops the cycle and marks the remaining queries
   * SKIPPED instead of retrying, so a cycle can never exceed its query budget or hammer the provider.
   */
  async searchPlanned(queries: readonly PlannedDiscoveryQuery[], options: { readonly spacingMs?: number } = {}): Promise<PlannedSearchResult> {
    if (!this.apiKey?.trim()) {
      return { state: "NOT_CONFIGURED", outcomes: queries.map((query) => ({ query, state: "SKIPPED", candidates: [], resultCount: 0, failure: "NOT_CONFIGURED" })) };
    }
    const spacing = options.spacingMs ?? CYCLE_QUERY_SPACING_MS;
    const seen = new Set<string>();
    const outcomes: PlannedQueryOutcome[] = [];
    let duplicatesSuppressed = 0;
    let rateLimited = false;
    for (const [index, query] of queries.entries()) {
      if (rateLimited) { outcomes.push({ query, state: "SKIPPED", candidates: [], resultCount: 0, failure: "RATE_LIMITED" }); continue; }
      if (index > 0 && spacing > 0) await new Promise((resolve) => setTimeout(resolve, spacing));
      try {
        const results = await this.fetchResults(query.query, CYCLE_RESULTS_PER_QUERY);
        const candidates: DiscoveryCandidate[] = [];
        for (const [rank, item] of results.entries()) {
          if (typeof item.url !== "string") continue;
          const normalized = normalizePublicCandidateUrl(item.url);
          if (!normalized) continue;
          if (seen.has(normalized.normalizedUrl)) { duplicatesSuppressed += 1; continue; }
          seen.add(normalized.normalizedUrl);
          candidates.push({
            queryKind: query.kind, title: safeText(item.title, normalized.domain, 300), url: item.url, normalizedUrl: normalized.normalizedUrl,
            domain: normalized.domain, providerDescription: typeof item.description === "string" ? item.description.trim().slice(0, 500) : null,
            relevanceReason: query.reason, providerRank: rank + 1, evidenceCaptured: false, duplicate: false,
            correlatedCompanyId: null, correlatedProjectId: null, correlatedOpportunityId: null, humanReviewRequired: true,
            providerPageAge: pageAgeIso(item.page_age),
            queryPosition: query.position,
          });
        }
        outcomes.push({ query, state: "COMPLETED", candidates, resultCount: results.length, failure: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const failure = /HTTP 429/.test(message) ? "RATE_LIMITED" : /HTTP \d{3}/.test(message) ? message.replace("Provider ", "PROVIDER_").replace(" ", "_")
          : /size limit/i.test(message) ? "RESPONSE_TOO_LARGE" : /timeout|abort/i.test(message) ? "TIMEOUT" : "PROVIDER_FAILURE";
        rateLimited = failure === "RATE_LIMITED";
        outcomes.push({ query, state: "FAILED", candidates: [], resultCount: 0, failure });
      }
    }
    return { state: "COMPLETED", outcomes, duplicatesSuppressed, quota: this.lastQuota };
  }

  async search(target: string | OpportunitySearchRequest): Promise<ProviderSearchResult> {
    const queries = typeof target === "string" ? buildCompanyDiscoveryQueries(target) : buildOpportunityDiscoveryQueries(target);
    if (!this.apiKey?.trim()) return { state: "NOT_CONFIGURED", queries };
    const candidates: DiscoveryCandidate[] = [];
    const seen = new Set<string>();
    let duplicatesSuppressed = 0;
    try {
      for (const query of queries) {
        const results = await this.fetchResults(query.query, MAX_RESULTS_PER_QUERY);
        for (const [index, item] of results.entries()) {
          if (typeof item.url !== "string") continue;
          const normalized = normalizePublicCandidateUrl(item.url);
          if (!normalized) continue;
          if (seen.has(normalized.normalizedUrl)) {
            duplicatesSuppressed += 1;
            continue;
          }
          seen.add(normalized.normalizedUrl);
          candidates.push({
            queryKind: query.kind,
            title: safeText(item.title, normalized.domain, 300),
            url: item.url,
            normalizedUrl: normalized.normalizedUrl,
            domain: normalized.domain,
            providerDescription: typeof item.description === "string" ? item.description.trim().slice(0, 500) : null,
            relevanceReason: query.reason,
            providerRank: index + 1,
            evidenceCaptured: false,
            duplicate: false,
            correlatedCompanyId: null,
            correlatedProjectId: null,
            correlatedOpportunityId: null,
            humanReviewRequired: true,
          });
          if (candidates.length >= MAX_CANDIDATES) break;
        }
        if (candidates.length >= MAX_CANDIDATES) break;
      }
      return { state: "COMPLETED", queries, candidates, duplicatesSuppressed };
    } catch (error) {
      const message = error instanceof Error && /size limit|timeout|HTTP \d{3}/i.test(error.message)
        ? error.message
        : "External discovery provider failed";
      return { state: "FAILED", queries, failure: { classification: "PROVIDER_FAILURE", message } };
    }
  }
}
