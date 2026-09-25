import { isIP } from "node:net";
import type { DiscoveryCandidate, DiscoveryQueryKind } from "../../domain/company-discovery";
import type { OpportunitySearchRequest } from "../../domain/opportunity-search";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_QUERIES = 7;
const MAX_RESULTS_PER_QUERY = 5;
const MAX_CANDIDATES = 20;
const MAX_RESPONSE_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;

export interface DiscoveryQuery {
  readonly kind: DiscoveryQueryKind;
  readonly query: string;
  readonly reason: string;
}

export type ProviderSearchResult =
  | { readonly state: "NOT_CONFIGURED"; readonly queries: readonly DiscoveryQuery[] }
  | { readonly state: "FAILED"; readonly queries: readonly DiscoveryQuery[]; readonly failure: { readonly classification: string; readonly message: string } }
  | { readonly state: "COMPLETED"; readonly queries: readonly DiscoveryQuery[]; readonly candidates: readonly DiscoveryCandidate[]; readonly duplicatesSuppressed: number };

interface BraveResponse {
  readonly web?: {
    readonly results?: readonly {
      readonly title?: unknown;
      readonly url?: unknown;
      readonly description?: unknown;
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

function safeText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

export class BraveSearchProvider {
  constructor(
    private readonly apiKey: string | undefined = process.env.BRAVE_SEARCH_API_KEY,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async search(target: string | OpportunitySearchRequest): Promise<ProviderSearchResult> {
    const queries = typeof target === "string" ? buildCompanyDiscoveryQueries(target) : buildOpportunityDiscoveryQueries(target);
    if (!this.apiKey?.trim()) return { state: "NOT_CONFIGURED", queries };
    const candidates: DiscoveryCandidate[] = [];
    const seen = new Set<string>();
    let duplicatesSuppressed = 0;
    try {
      for (const query of queries) {
        const endpoint = new URL(BRAVE_ENDPOINT);
        endpoint.searchParams.set("q", query.query);
        endpoint.searchParams.set("country", "US");
        endpoint.searchParams.set("search_lang", "en");
        endpoint.searchParams.set("safesearch", "strict");
        endpoint.searchParams.set("count", String(MAX_RESULTS_PER_QUERY));
        const response = await this.transport(endpoint, {
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": this.apiKey,
            "Api-Version": "2023-01-01",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
        const length = Number(response.headers.get("content-length") ?? "0");
        if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
        if (length > MAX_RESPONSE_BYTES) throw new Error("Provider response exceeded size limit");
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Provider response exceeded size limit");
        const payload = JSON.parse(body) as BraveResponse;
        for (const [index, item] of (payload.web?.results ?? []).slice(0, MAX_RESULTS_PER_QUERY).entries()) {
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
