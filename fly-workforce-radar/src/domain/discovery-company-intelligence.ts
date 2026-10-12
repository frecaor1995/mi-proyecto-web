import { classifyElectricalLevel, type EvidenceLevel } from "./discovery-intelligence";

export const COMPANY_RESOLUTION_STATES = ["RESOLVED_CANONICAL", "IDENTIFIED_NOT_CANONICAL", "POSSIBLE_MATCH", "AMBIGUOUS", "UNRESOLVED"] as const;
export type CompanyResolutionState = (typeof COMPANY_RESOLUTION_STATES)[number];
export type ResolutionConfidence = "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN";
export type ResolutionReason = "EXPLICIT_COMPANY_ID" | "EXACT_CANONICAL_DOMAIN" | "EXACT_ALIAS" | "ATS_TENANT" |
  "COMPANY_OWNED_CAREER_DOMAIN" | "EXPLICIT_PROVIDER_COMPANY" | "EXPLICIT_TITLE_COMPANY" | "NORMALIZED_NAME_MATCH" |
  "MULTIPLE_CONFLICTING_HINTS" | "NO_SUPPORTING_IDENTITY";
export type SourceRelationship = "DIRECT_EMPLOYER_SOURCE" | "STAFFING_AGENCY_SOURCE" | "AGGREGATOR_SOURCE" | "ATS_SOURCE" | "UNKNOWN_SOURCE_RELATIONSHIP";

export interface CanonicalCompanyReference {
  readonly id: string; readonly name: string; readonly normalizedNames: readonly string[]; readonly domains: readonly string[];
  readonly verifiedAliases: readonly string[]; readonly hasContactIntelligence: boolean;
}

export interface StoredDiscoveryObservation {
  readonly id: string; readonly identity: string; readonly title: string; readonly description: string | null;
  readonly normalizedUrl: string; readonly domain: string; readonly sourceType: string; readonly platform: string | null;
  readonly explicitCompanyId: string | null; readonly level: EvidenceLevel; readonly watchState: string; readonly watchHealth: string;
  readonly firstSeenAt: string; readonly lastSeenAt: string; readonly publishedAt: string | null; readonly canonicalEvidence: boolean;
}

export interface CompanyResolutionView {
  readonly state: CompanyResolutionState; readonly confidence: ResolutionConfidence; readonly reasons: readonly ResolutionReason[];
  readonly observedCompany: string | null; readonly canonicalCompanyId: string | null; readonly canonicalCompanyName: string | null;
  readonly possibleCanonicalCompanyIds: readonly string[];
}

export interface DemandInterpretation {
  readonly profession: string | null; readonly occupation: string | null; readonly level: EvidenceLevel;
  readonly location: string | null; readonly pay: string | null; readonly perDiem: string | null; readonly headcount: string | null;
  readonly experience: string | null; readonly credentials: readonly string[]; readonly project: string | null;
  readonly publishedAt: string | null; readonly sourceRelationship: SourceRelationship;
  readonly status: "OBSERVED" | "NEEDS_REVIEW" | "CORROBORATED" | "VERIFIED";
  readonly externalManpowerAcceptance: "UNKNOWN"; readonly buyerAuthority: "UNKNOWN";
}

export interface DiscoveryIntelligenceObservation extends StoredDiscoveryObservation {
  readonly resolution: CompanyResolutionView; readonly demand: DemandInterpretation;
}

export interface CompanyDemandGroup {
  readonly key: string; readonly displayName: string; readonly resolutionState: CompanyResolutionState;
  readonly confidence: ResolutionConfidence; readonly reasons: readonly ResolutionReason[]; readonly canonicalCompanyId: string | null;
  readonly hasContactIntelligence: boolean; readonly observationCount: number; readonly sourceCount: number;
  readonly professions: readonly string[]; readonly levels: readonly string[]; readonly locations: readonly string[];
  readonly sourceRelationships: readonly SourceRelationship[]; readonly firstSeenAt: string; readonly lastSeenAt: string;
  readonly health: string; readonly corroboration: "0" | "1" | "2+"; readonly observations: readonly DiscoveryIntelligenceObservation[];
}

const AGGREGATORS = new Set(["indeed.com", "ziprecruiter.com", "glassdoor.com", "linkedin.com", "zippia.com", "jobtoday.com"]);
const ATS_DOMAINS = /(^|\.)(lever\.co|workable\.com|icims\.com|myworkdayjobs\.com|workdayjobs\.com|greenhouse\.io|paylocity\.com|taleo\.net)$/i;
const STAFFING_WORDS = /\b(staffing|personnel|recruit(?:ing|ers?)?|workforce|talent solutions?|temporary labor)\b/i;
const GENERIC_COMPANY_WORDS = /^(jobs?|careers?|hiring|apply|electricians?|apprentice|helper|texas|houston|company|unknown|myworkdayjobs(?:\.com)?|indeed|glassdoor|ziprecruiter|linkedin|zippia|job today)$/i;

export function normalizeObservedCompany(value: string): string {
  const tokens = value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/&(?:amp;)?/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const suffixes = new Set(["llc", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited"]);
  while (tokens.length > 1 && suffixes.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

const rootDomain = (domain: string) => domain.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");
const titleCase = (value: string) => value.split(/[\s-]+/).filter(Boolean).map((word) => word.length <= 3 && word === word.toUpperCase() ? word : word[0]?.toUpperCase() + word.slice(1)).join(" ");
const cleanText = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const acceptableName = (value: string | null): value is string => Boolean(value && value.length >= 3 && value.length <= 80 && !GENERIC_COMPANY_WORDS.test(value.trim()));

export function atsTenantIdentity(urlValue: string, domain: string): string | null {
  try {
    const url = new URL(urlValue); const host = domain.toLowerCase(); const parts = url.pathname.split("/").filter(Boolean);
    let tenant: string | null = null;
    if (host === "jobs.lever.co") tenant = parts[0] ?? null;
    else if (host.endsWith("workable.com")) tenant = parts[0] ?? null;
    else if (host.endsWith("icims.com")) tenant = host.split(".")[0].replace(/^(careers(?:-spanish)?|jobs)-/, "");
    else if (host.includes("workdayjobs.com")) tenant = parts.find((part) => /careers?$/i.test(part))?.replace(/careers?$/i, "") ?? host.split(".")[0].replace(/\.wd\d+$/, "");
    else if (host.endsWith("greenhouse.io")) tenant = parts[0] ?? null;
    if (!tenant || GENERIC_COMPANY_WORDS.test(tenant)) return null;
    return titleCase(tenant.replace(/-(?:ga|tx|usa)$/i, ""));
  } catch { return null; }
}

function explicitTitleCompany(title: string): string | null {
  const cleaned = cleanText(title);
  const pipe = cleaned.split("|").map((part) => part.trim()).filter(Boolean);
  if (pipe.length > 1 && acceptableName(pipe.at(-1)!)) return pipe.at(-1)!;
  const dash = cleaned.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const candidates = [dash.at(-1), dash[0]].filter((item): item is string => Boolean(item));
  return candidates.find((item) => acceptableName(item) && !/\b(electrician|apprentice|helper|project|houston|texas|fort worth|dallas|corpus christi|years? exp|data center)\b/i.test(item)) ?? null;
}

function explicitProviderCompany(description: string): string | null {
  const text = cleanText(description);
  const patterns = [
    /\bCompany:\s*([A-Z][A-Za-z0-9&' .-]{2,70}?)(?=\s+Location:|\s+Employment Type:|$)/,
    /\b([A-Z][A-Za-z0-9&' .-]{2,70}?)\s+(?:is|are)\s+(?:currently\s+)?(?:hiring|seeking|looking for)\b/,
    /\bAt\s+([A-Z][A-Za-z0-9&' .-]{2,60}?),\s+(?:we|our)\b/,
    /\banswers about\s+([A-Z][A-Za-z0-9&' .-]{2,60}?)(?=\s*[.·]|$)/,
  ];
  for (const pattern of patterns) { const match = text.match(pattern)?.[1]?.trim(); if (acceptableName(match ?? null)) return match!; }
  return null;
}

function domainIdentity(domain: string): string | null {
  const root = rootDomain(domain); if (AGGREGATORS.has(root) || ATS_DOMAINS.test(domain)) return null;
  const label = root.split(".")[0]; return acceptableName(label) ? titleCase(label) : null;
}

function canonicalMatches(identity: string, companies: readonly CanonicalCompanyReference[]) {
  const normalized = normalizeObservedCompany(identity);
  return companies.filter((company) => company.normalizedNames.includes(normalized) || company.verifiedAliases.includes(normalized));
}

export function resolveObservationCompany(observation: StoredDiscoveryObservation, companies: readonly CanonicalCompanyReference[]): CompanyResolutionView {
  if (observation.explicitCompanyId) {
    const company = companies.find((item) => item.id === observation.explicitCompanyId);
    return { state: "RESOLVED_CANONICAL", confidence: "STRONG", reasons: ["EXPLICIT_COMPANY_ID"], observedCompany: company?.name ?? null,
      canonicalCompanyId: observation.explicitCompanyId, canonicalCompanyName: company?.name ?? null, possibleCanonicalCompanyIds: [] };
  }
  const root = rootDomain(observation.domain);
  if (!AGGREGATORS.has(root) && !ATS_DOMAINS.test(observation.domain)) {
    const domainMatches = companies.filter((company) => company.domains.some((domain) => rootDomain(domain) === root));
    if (domainMatches.length === 1) return { state: "RESOLVED_CANONICAL", confidence: "STRONG", reasons: ["EXACT_CANONICAL_DOMAIN"],
      observedCompany: domainMatches[0].name, canonicalCompanyId: domainMatches[0].id, canonicalCompanyName: domainMatches[0].name, possibleCanonicalCompanyIds: [] };
    if (domainMatches.length > 1) return { state: "AMBIGUOUS", confidence: "UNKNOWN", reasons: ["MULTIPLE_CONFLICTING_HINTS"], observedCompany: null,
      canonicalCompanyId: null, canonicalCompanyName: null, possibleCanonicalCompanyIds: domainMatches.map((item) => item.id) };
  }

  const titleIdentity = explicitTitleCompany(observation.title);
  const providerIdentity = explicitProviderCompany(observation.description ?? "");
  const tenantIdentity = atsTenantIdentity(observation.normalizedUrl, observation.domain);
  const ownedIdentity = domainIdentity(observation.domain);
  const aggregator = AGGREGATORS.has(root);
  const ats = Boolean(observation.platform) || ATS_DOMAINS.test(observation.domain);
  const identity = ats ? tenantIdentity ?? titleIdentity ?? providerIdentity : titleIdentity ?? (!aggregator ? providerIdentity : null) ?? ownedIdentity ?? providerIdentity;
  if (!identity) return { state: "UNRESOLVED", confidence: "UNKNOWN", reasons: ["NO_SUPPORTING_IDENTITY"], observedCompany: null,
    canonicalCompanyId: null, canonicalCompanyName: null, possibleCanonicalCompanyIds: [] };
  const matches = canonicalMatches(identity, companies);
  if (aggregator && matches.length > 0) return { state: matches.length > 1 ? "AMBIGUOUS" : "POSSIBLE_MATCH", confidence: "WEAK",
    reasons: matches.length > 1 ? ["MULTIPLE_CONFLICTING_HINTS"] : ["EXPLICIT_PROVIDER_COMPANY", "NORMALIZED_NAME_MATCH"], observedCompany: identity,
    canonicalCompanyId: null, canonicalCompanyName: null, possibleCanonicalCompanyIds: matches.map((item) => item.id) };
  if (matches.length > 1) return { state: "AMBIGUOUS", confidence: "UNKNOWN", reasons: ["MULTIPLE_CONFLICTING_HINTS"], observedCompany: identity,
    canonicalCompanyId: null, canonicalCompanyName: null, possibleCanonicalCompanyIds: matches.map((item) => item.id) };
  if (matches.length === 1) {
    const alias = matches[0].verifiedAliases.includes(normalizeObservedCompany(identity));
    return { state: "RESOLVED_CANONICAL", confidence: "STRONG", reasons: [alias ? "EXACT_ALIAS" : "NORMALIZED_NAME_MATCH"], observedCompany: identity,
      canonicalCompanyId: matches[0].id, canonicalCompanyName: matches[0].name, possibleCanonicalCompanyIds: [] };
  }
  const reason: ResolutionReason = titleIdentity ? "EXPLICIT_TITLE_COMPANY" : providerIdentity && providerIdentity === identity ? "EXPLICIT_PROVIDER_COMPANY"
    : tenantIdentity ? "ATS_TENANT" : "COMPANY_OWNED_CAREER_DOMAIN";
  const weak = aggregator || (reason === "EXPLICIT_PROVIDER_COMPANY" && observation.sourceType !== "STAFFING_JOB_BOARD");
  return { state: weak ? "POSSIBLE_MATCH" : "IDENTIFIED_NOT_CANONICAL", confidence: weak ? "WEAK" : reason === "ATS_TENANT" ? "MODERATE" : "STRONG",
    reasons: [reason], observedCompany: identity, canonicalCompanyId: null, canonicalCompanyName: null, possibleCanonicalCompanyIds: [] };
}

export function classifySourceRelationship(observation: Pick<StoredDiscoveryObservation, "domain" | "platform" | "sourceType">): SourceRelationship {
  const root = rootDomain(observation.domain);
  if (AGGREGATORS.has(root)) return "AGGREGATOR_SOURCE";
  if (observation.platform || ATS_DOMAINS.test(observation.domain)) return "ATS_SOURCE";
  if (observation.sourceType === "STAFFING_JOB_BOARD" || STAFFING_WORDS.test(observation.domain)) return "STAFFING_AGENCY_SOURCE";
  if (observation.sourceType === "COMPANY_CAREERS") return "DIRECT_EMPLOYER_SOURCE";
  return "UNKNOWN_SOURCE_RELATIONSHIP";
}

const firstMatch = (text: string, pattern: RegExp) => cleanText(text).match(pattern)?.[0] ?? null;
export function interpretStoredDemand(observation: StoredDiscoveryObservation): DemandInterpretation {
  const text = cleanText(`${observation.title} ${observation.description ?? ""}`);
  const electrical = /\b(electric(?:al|ian|ians)|wireman|journeyman)\b/i.test(text);
  const profession = electrical ? "ELECTRICAL" : /\bweld/i.test(text) ? "WELDING" : /\bhvac|heating|air conditioning/i.test(text) ? "HVAC" : /\bplumb/i.test(text) ? "PLUMBING" : null;
  const level = electrical ? classifyElectricalLevel(text) : observation.level;
  const occupation = electrical ? (level === "HELPER" ? "ELECTRICAL_HELPER" : level === "JOURNEYMAN" ? "JOURNEYMAN_ELECTRICIAN" : level === "APPRENTICE_OR_JOURNEYMAN" ? "APPRENTICE_OR_JOURNEYMAN_ELECTRICIAN" : /\bapprentice\b/i.test(text) ? "APPRENTICE_ELECTRICIAN" : "ELECTRICIAN") : null;
  const location = firstMatch(text, /\b(?:Houston|Dallas(?:--|[- /])?Fort Worth|Fort Worth|El Paso|San Antonio|Corpus Christi|Spring|Parker County)(?:,?\s+(?:TX|Texas))?\b/i)
    ?? firstMatch(text, /\bTexas\b/i);
  const pay = firstMatch(text, /\$\d{1,3}(?:\.\d{2})?\s*(?:-|–|to)\s*\$?\d{1,3}(?:\.\d{2})?\s*(?:per hour|\/hr|hourly)?/i);
  const experience = firstMatch(text, /\b\d+(?:\s*[-–]\s*\d+)?\+?\s+years?(?:\s+of)?\s+experience\b/i);
  const credentials = [(/\bTDLR\b/i.test(text) ? "TDLR" : null), (/\bOSHA(?:\s*[- ]?\d+)?\b/i.test(text) ? firstMatch(text, /\bOSHA(?:\s*[- ]?\d+)?\b/i) : null),
    (/\b(?:journeyman|apprentice) (?:electrician )?license\b/i.test(text) ? firstMatch(text, /\b(?:journeyman|apprentice) (?:electrician )?license\b/i) : null)].filter((item): item is string => Boolean(item));
  const project = firstMatch(text, /\b(?:mission critical )?data center project\b/i) ?? firstMatch(text, /\b(?:commercial|industrial) project\b/i);
  return { profession, occupation, level, location, pay, perDiem: /\bper diem\b/i.test(text) ? "MENTIONED" : null,
    headcount: null, experience, credentials: [...new Set(credentials)], project, publishedAt: observation.publishedAt,
    sourceRelationship: classifySourceRelationship(observation), status: "NEEDS_REVIEW", externalManpowerAcceptance: "UNKNOWN", buyerAuthority: "UNKNOWN" };
}

export function buildCompanyDemandIntelligence(observations: readonly StoredDiscoveryObservation[], companies: readonly CanonicalCompanyReference[]) {
  const unique = [...new Map(observations.map((observation) => [observation.identity, observation])).values()];
  const interpreted: DiscoveryIntelligenceObservation[] = unique.map((observation) => ({ ...observation,
    resolution: resolveObservationCompany(observation, companies), demand: interpretStoredDemand(observation) }));
  const buckets = new Map<string, DiscoveryIntelligenceObservation[]>();
  for (const observation of interpreted) {
    const key = observation.resolution.canonicalCompanyId ? `canonical:${observation.resolution.canonicalCompanyId}`
      : observation.resolution.observedCompany ? `observed:${normalizeObservedCompany(observation.resolution.observedCompany)}` : `unresolved:${rootDomain(observation.domain)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), observation]);
  }
  const groups: CompanyDemandGroup[] = [...buckets.entries()].map(([key, items]) => {
    const first = items[0]; const sources = new Set(items.map((item) => rootDomain(item.domain)));
    const canonical = companies.find((company) => company.id === first.resolution.canonicalCompanyId);
    const set = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))];
    const corroboration: CompanyDemandGroup["corroboration"] = items.length >= 2 && sources.size >= 2 ? "2+" : items.length >= 2 ? "1" : "0";
    return { key, displayName: first.resolution.canonicalCompanyName ?? first.resolution.observedCompany ?? "Identity evidence insufficient",
      resolutionState: first.resolution.state, confidence: first.resolution.confidence, reasons: [...new Set(items.flatMap((item) => item.resolution.reasons))],
      canonicalCompanyId: first.resolution.canonicalCompanyId, hasContactIntelligence: canonical?.hasContactIntelligence ?? false,
      observationCount: items.length, sourceCount: sources.size, professions: set(items.map((item) => item.demand.profession)),
      levels: set(items.map((item) => item.demand.level)), locations: set(items.map((item) => item.demand.location)),
      sourceRelationships: set(items.map((item) => item.demand.sourceRelationship)) as SourceRelationship[],
      firstSeenAt: items.map((item) => item.firstSeenAt).sort()[0], lastSeenAt: items.map((item) => item.lastSeenAt).sort().at(-1)!,
      health: items.every((item) => item.watchHealth === "HEALTHY") ? "HEALTHY" : "NEEDS_REVIEW",
      corroboration, observations: items };
  }).sort((a, b) => (a.resolutionState === "UNRESOLVED" ? 1 : 0) - (b.resolutionState === "UNRESOLVED" ? 1 : 0) || b.observationCount - a.observationCount || a.displayName.localeCompare(b.displayName));
  return { observations: interpreted, groups };
}
