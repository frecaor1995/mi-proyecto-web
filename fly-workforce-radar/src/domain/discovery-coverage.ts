import type { DiscoveryQueryKind } from "./company-discovery";

/**
 * Multi-trade discovery configuration. The discovery engine reads these catalogs; adding a trade,
 * occupation, geography or watched company is a data change here, never an engine change.
 *
 * `workforceTradeCode` links a discovery occupation to the shared workforce taxonomy when that trade
 * exists there. `null` means the workforce database has no matching trade yet: the signal is kept and
 * the gap is reported instead of being forced into another trade.
 */
export interface DiscoveryOccupation {
  readonly id: string;
  readonly label: string;
  readonly labelEs: string;
  readonly searchTerm: string;
  readonly detect: RegExp;
  readonly workforceTradeCode: string | null;
}

export interface DiscoveryTradeCategory {
  readonly id: string;
  readonly label: string;
  readonly labelEs: string;
  /** Name in the shared icon set (components/ui/icon). */
  readonly icon: string;
  /** Trade wording used in project, subcontractor and bid queries. */
  readonly commercialTerm: string;
  /** Trade-scope wording ("electrical services") that assigns a qualified B2B request to this family when it names no occupation. */
  readonly scopeDetect: RegExp;
  readonly occupations: readonly DiscoveryOccupation[];
}

export const DISCOVERY_TRADE_CATEGORIES: readonly DiscoveryTradeCategory[] = [
  { id: "ELECTRICAL", label: "Electrical", labelEs: "Eléctrico", icon: "bolt", commercialTerm: "electrical", scopeDetect: /\belectrical\b/i, occupations: [
    { id: "ELECTRICIAN", label: "Electricians", labelEs: "Electricistas", searchTerm: "electrician", detect: /\b(?:industrial |commercial |licensed )?electricians?\b/i, workforceTradeCode: "ELECTRICAL" },
    { id: "APPRENTICE_ELECTRICIAN", label: "Apprentice electricians", labelEs: "Aprendices de electricista", searchTerm: "apprentice electrician", detect: /\b(?:electrical|electrician) apprentices?\b|\bapprentice electricians?\b|\belectrical helpers?\b/i, workforceTradeCode: "ELECTRICAL" },
    { id: "JOURNEYMAN_ELECTRICIAN", label: "Journeymen", labelEs: "Electricistas oficiales (journeyman)", searchTerm: "journeyman electrician", detect: /\bjourneyman electricians?\b|\bjourneymen\b/i, workforceTradeCode: "ELECTRICAL" },
    { id: "ELECTRICAL_SUPERVISOR", label: "Electrical supervisors", labelEs: "Supervisores eléctricos", searchTerm: "electrical foreman superintendent", detect: /\belectrical (?:foreman|foremen|supervisors?|superintendents?)\b/i, workforceTradeCode: "ELECTRICAL" },
  ] },
  { id: "MECHANICAL_HVAC", label: "Mechanical / HVAC", labelEs: "Mecánico / HVAC", icon: "hvac", commercialTerm: "mechanical HVAC", scopeDetect: /\b(mechanical|hvac)\b/i, occupations: [
    { id: "HVAC_TECHNICIAN", label: "HVAC technicians", labelEs: "Técnicos HVAC", searchTerm: "HVAC technician", detect: /\bhvac(?:\/r)? (?:technicians?|techs?|installers?|mechanics?)\b/i, workforceTradeCode: "HVAC" },
    { id: "PIPEFITTER", label: "Pipefitters", labelEs: "Tuberos (pipefitters)", searchTerm: "pipefitter", detect: /\bpipe ?fitters?\b/i, workforceTradeCode: "PIPEFITTING" },
    { id: "MECHANICAL_TECHNICIAN", label: "Mechanical technicians", labelEs: "Técnicos mecánicos", searchTerm: "mechanical technician", detect: /\bmechanical (?:technicians?|techs?)\b/i, workforceTradeCode: "HVAC" },
    { id: "MILLWRIGHT", label: "Millwrights", labelEs: "Mecánicos montadores (millwrights)", searchTerm: "millwright", detect: /\bmillwrights?\b/i, workforceTradeCode: null },
  ] },
  { id: "PLUMBING_PIPING", label: "Plumbing / Piping", labelEs: "Plomería / Tubería", icon: "pipe", commercialTerm: "plumbing piping", scopeDetect: /\b(plumbing|piping|pipefitting)\b/i, occupations: [
    { id: "PLUMBER", label: "Plumbers", labelEs: "Plomeros", searchTerm: "plumber", detect: /\bplumbers?\b/i, workforceTradeCode: "PLUMBING" },
    { id: "PIPE_WELDER", label: "Pipe welders", labelEs: "Soldadores de tubería", searchTerm: "pipe welder", detect: /\bpipe welders?\b/i, workforceTradeCode: "WELDING" },
    { id: "INDUSTRIAL_PIPING", label: "Industrial piping workers", labelEs: "Trabajadores de tubería industrial", searchTerm: "industrial piping", detect: /\b(?:industrial )?piping (?:workers?|crafts?(?:men)?|helpers?)\b/i, workforceTradeCode: "PIPEFITTING" },
  ] },
  { id: "INDUSTRIAL", label: "Industrial", labelEs: "Industrial", icon: "gear", commercialTerm: "industrial maintenance", scopeDetect: /\b(welding|instrumentation|industrial maintenance|millwright(ing)?)\b/i, occupations: [
    { id: "WELDER", label: "Welders", labelEs: "Soldadores", searchTerm: "welder", detect: /\b(?:structural |combo |tig |mig )?welders?\b/i, workforceTradeCode: "WELDING" },
    { id: "INSTRUMENTATION_TECHNICIAN", label: "Instrumentation technicians", labelEs: "Técnicos de instrumentación", searchTerm: "instrumentation technician", detect: /\b(?:i&e|instrument(?:ation)?) (?:technicians?|techs?|fitters?)\b/i, workforceTradeCode: "INSTRUMENTATION_CONTROLS" },
    { id: "INDUSTRIAL_MAINTENANCE", label: "Industrial maintenance technicians", labelEs: "Técnicos de mantenimiento industrial", searchTerm: "industrial maintenance technician", detect: /\b(?:industrial )?maintenance (?:technicians?|techs?|mechanics?)\b/i, workforceTradeCode: null },
  ] },
  { id: "CONSTRUCTION", label: "Construction", labelEs: "Construcción", icon: "hardhat", commercialTerm: "construction", scopeDetect: /\b(general construction|new construction|construction project|concrete|structural steel|carpentry|framing|civil construction)\b/i, occupations: [
    { id: "CARPENTER", label: "Carpenters", labelEs: "Carpinteros", searchTerm: "carpenter", detect: /\bcarpenters?\b/i, workforceTradeCode: null },
    { id: "CONCRETE_WORKER", label: "Concrete workers", labelEs: "Trabajadores de concreto", searchTerm: "concrete finisher", detect: /\bconcrete (?:workers?|finishers?|laborers?|forms?(?: setters?)?)\b/i, workforceTradeCode: null },
    { id: "IRONWORKER", label: "Ironworkers", labelEs: "Herreros de estructura (ironworkers)", searchTerm: "ironworker", detect: /\biron ?workers?\b/i, workforceTradeCode: null },
    { id: "CONSTRUCTION_LABOR", label: "Construction labor", labelEs: "Obreros de construcción", searchTerm: "construction laborer", detect: /\b(?:construction|general) (?:laborers?|labor|helpers?)\b/i, workforceTradeCode: "GENERAL_CRAFT" },
    { id: "CONSTRUCTION_SUPERVISOR", label: "Construction supervisors", labelEs: "Supervisores de construcción", searchTerm: "construction superintendent", detect: /\b(?:construction|site|field) (?:superintendents?|supervisors?|foreman|foremen)\b/i, workforceTradeCode: "FIELD_MANAGEMENT" },
  ] },
  { id: "EQUIPMENT_LOGISTICS", label: "Equipment / Logistics", labelEs: "Equipos / Logística", icon: "truck", commercialTerm: "heavy equipment logistics", scopeDetect: /\b(heavy equipment|crane services?|rigging|heavy haul(ing)?|logistics services|warehousing)\b/i, occupations: [
    { id: "HEAVY_EQUIPMENT_OPERATOR", label: "Heavy equipment operators", labelEs: "Operadores de equipo pesado", searchTerm: "heavy equipment operator", detect: /\b(?:heavy )?equipment operators?\b|\bcrane operators?\b/i, workforceTradeCode: null },
    { id: "RIGGER", label: "Riggers", labelEs: "Aparejadores (riggers)", searchTerm: "rigger", detect: /\briggers?\b/i, workforceTradeCode: null },
    { id: "FORKLIFT_OPERATOR", label: "Forklift operators", labelEs: "Operadores de montacargas", searchTerm: "forklift operator", detect: /\bforklift (?:operators?|drivers?)\b/i, workforceTradeCode: null },
    { id: "WAREHOUSE_LOGISTICS", label: "Warehouse and logistics personnel", labelEs: "Personal de almacén y logística", searchTerm: "warehouse associate", detect: /\bwarehouse (?:associates?|workers?|personnel|staff)\b|\blogistics (?:associates?|coordinators?|personnel)\b/i, workforceTradeCode: null },
  ] },
];

export type GeographyTier = "HOUSTON_METRO" | "TEXAS" | "US_MOBILIZATION";

export interface DiscoveryGeography {
  readonly id: string;
  readonly label: string;
  readonly tier: GeographyTier;
  readonly query: string;
}

export const DISCOVERY_GEOGRAPHIES: readonly DiscoveryGeography[] = [
  { id: "HOUSTON", label: "Houston", tier: "HOUSTON_METRO", query: "Houston TX" },
  { id: "KATY", label: "Katy", tier: "HOUSTON_METRO", query: "Katy TX" },
  { id: "PASADENA", label: "Pasadena", tier: "HOUSTON_METRO", query: "Pasadena TX" },
  { id: "BAYTOWN", label: "Baytown", tier: "HOUSTON_METRO", query: "Baytown TX" },
  { id: "FREEPORT", label: "Freeport", tier: "HOUSTON_METRO", query: "Freeport TX" },
  { id: "BEAUMONT", label: "Beaumont", tier: "TEXAS", query: "Beaumont TX" },
  { id: "PORT_ARTHUR", label: "Port Arthur", tier: "TEXAS", query: "Port Arthur TX" },
  { id: "CORPUS_CHRISTI", label: "Corpus Christi", tier: "TEXAS", query: "Corpus Christi TX" },
  { id: "MIDLAND", label: "Midland", tier: "TEXAS", query: "Midland TX" },
  { id: "ODESSA", label: "Odessa", tier: "TEXAS", query: "Odessa TX" },
  { id: "DFW", label: "Dallas / Fort Worth", tier: "TEXAS", query: "Dallas Fort Worth TX" },
  { id: "AUSTIN", label: "Austin", tier: "TEXAS", query: "Austin TX" },
  { id: "SAN_ANTONIO", label: "San Antonio", tier: "TEXAS", query: "San Antonio TX" },
  { id: "TEXAS_STATEWIDE", label: "Texas statewide", tier: "TEXAS", query: "Texas" },
  { id: "LOUISIANA", label: "Louisiana (Gulf Coast)", tier: "US_MOBILIZATION", query: "Louisiana per diem" },
  { id: "US_TRAVEL", label: "US travel / per diem", tier: "US_MOBILIZATION", query: "travel per diem" },
];

export const GEOGRAPHY_TIERS: readonly GeographyTier[] = ["HOUSTON_METRO", "TEXAS", "US_MOBILIZATION"];

export const SIGNAL_CATEGORIES = ["DIRECT_HIRING", "PROJECT_DEMAND", "MANPOWER_REQUEST", "SUBCONTRACTOR_VENDOR", "PROCUREMENT_BID"] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

/** Existing persisted query kinds are reused; the signal category is stored alongside the query. */
const CATEGORY_QUERY_KIND: Record<SignalCategory, DiscoveryQueryKind> = {
  DIRECT_HIRING: "TRADE_PROFESSION", PROJECT_DEMAND: "PROJECTS", MANPOWER_REQUEST: "WORKFORCE",
  SUBCONTRACTOR_VENDOR: "PROCUREMENT", PROCUREMENT_BID: "PROCUREMENT",
};

/** Known contractors are watched in a bounded share of each cycle; unknown companies come from the open queries. */
export const WATCHED_COMPANIES: readonly string[] = ["MMR Group", "Walker Engineering", "Rosendin", "Zachry", "Kiewit", "Bechtel"];

export const DEFAULT_QUERIES_PER_CYCLE = 10;
export const MAX_QUERIES_PER_CYCLE = 20;

export interface PlannedDiscoveryQuery {
  readonly position: number;
  readonly kind: DiscoveryQueryKind;
  readonly query: string;
  readonly reason: string;
  readonly tradeCategoryId: string | null;
  readonly occupationId: string | null;
  readonly geographyId: string;
  readonly geographyTier: GeographyTier;
  readonly signalCategory: SignalCategory;
  readonly company: string | null;
}

export const coverageCellKey = (tradeCategoryId: string, signalCategory: SignalCategory) => `${tradeCategoryId}:${signalCategory}`;

/**
 * Job-board search pages and business directories never qualify commercially, so queries exclude the largest
 * ones up front instead of spending budget on them (the qualification gate still screens everything returned).
 */
export const QUERY_EXCLUDED_SITES: readonly string[] = ["indeed.com", "glassdoor.com", "ziprecruiter.com", "simplyhired.com", "zippia.com", "yelp.com", "bbb.org"];
const EXCLUDE = QUERY_EXCLUDED_SITES.map((site) => `-site:${site}`).join(" ");

// Templates target language that states commercial demand in the source itself; the search terms are still
// never evidence (qualification reads only the returned page).
function queryText(category: SignalCategory, trade: DiscoveryTradeCategory, occupation: DiscoveryOccupation, geography: DiscoveryGeography): string {
  switch (category) {
    case "DIRECT_HIRING": return `"${occupation.searchTerm}" "now hiring" ${geography.query} ${EXCLUDE}`;
    case "PROJECT_DEMAND": return `${trade.commercialTerm} ("expansion project" OR groundbreaking OR "construction begins") ${geography.query} ${EXCLUDE}`;
    case "MANPOWER_REQUEST": return `"${occupation.searchTerm}" ("contract labor" OR "manpower services" OR "labor supply" OR "staffing partner") ${geography.query} ${EXCLUDE}`;
    case "SUBCONTRACTOR_VENDOR": return `"${trade.commercialTerm}" subcontractors ("seeking" OR "prequalification" OR "invitation") ${geography.query} ${EXCLUDE}`;
    case "PROCUREMENT_BID": return `"${trade.commercialTerm}" ("invitation to bid" OR "request for proposals" OR RFQ) ${geography.query} ${EXCLUDE}`;
  }
}

const TIER_PATTERN: readonly GeographyTier[] = ["HOUSTON_METRO", "TEXAS", "HOUSTON_METRO", "TEXAS", "US_MOBILIZATION"];

/**
 * Deterministic, bounded rotation. Every (trade category × signal category) cell is a coverage unit; the
 * least recently searched cells go first, at most two per trade category per cycle. Geography follows the
 * Houston → Texas → US priority pattern, and occupations and cities rotate by cycle number. One slot per
 * cycle watches a known company; everything else is open discovery that can surface unknown companies.
 */
export function planDiscoveryCycle(input: {
  readonly budget: number;
  readonly cycleNumber: number;
  readonly lastSearched: ReadonlyMap<string, string>;
  readonly trades?: readonly DiscoveryTradeCategory[];
  readonly geographies?: readonly DiscoveryGeography[];
  readonly companies?: readonly string[];
}): readonly PlannedDiscoveryQuery[] {
  const trades = input.trades ?? DISCOVERY_TRADE_CATEGORIES;
  const geographies = input.geographies ?? DISCOVERY_GEOGRAPHIES;
  const companies = input.companies ?? WATCHED_COMPANIES;
  const budget = Math.max(1, Math.min(MAX_QUERIES_PER_CYCLE, Math.floor(input.budget)));
  const cycle = Math.max(0, Math.floor(input.cycleNumber));
  const openSlots = companies.length > 0 && budget >= 4 ? budget - 1 : budget;

  const cells = trades.flatMap((trade, tradeIndex) => SIGNAL_CATEGORIES.map((category, categoryIndex) => ({
    trade, category, order: categoryIndex * trades.length + tradeIndex, last: input.lastSearched.get(coverageCellKey(trade.id, category)) ?? "",
  })));
  cells.sort((a, b) => a.last.localeCompare(b.last) || a.order - b.order);
  const perTradeLimit = Math.max(2, Math.ceil(openSlots / Math.max(1, trades.length)));
  const picked: typeof cells = [];
  const perTrade = new Map<string, number>();
  for (const cell of cells) {
    if (picked.length >= openSlots) break;
    if ((perTrade.get(cell.trade.id) ?? 0) >= perTradeLimit) continue;
    picked.push(cell);
    perTrade.set(cell.trade.id, (perTrade.get(cell.trade.id) ?? 0) + 1);
  }

  const byTier = (tier: GeographyTier) => geographies.filter((geo) => geo.tier === tier);
  const planned: PlannedDiscoveryQuery[] = picked.map((cell, index) => {
    const tier = TIER_PATTERN[(cycle + index) % TIER_PATTERN.length];
    const pool = byTier(tier).length ? byTier(tier) : geographies;
    const geography = pool[(cycle + Math.floor(index / TIER_PATTERN.length) + index) % pool.length];
    const occupation = cell.trade.occupations[(cycle + index) % cell.trade.occupations.length];
    return {
      position: index + 1, kind: CATEGORY_QUERY_KIND[cell.category], query: queryText(cell.category, cell.trade, occupation, geography),
      reason: `${cell.trade.label} · ${cell.category.replaceAll("_", " ").toLowerCase()} · ${geography.label}`,
      tradeCategoryId: cell.trade.id, occupationId: occupation.id, geographyId: geography.id, geographyTier: geography.tier,
      signalCategory: cell.category, company: null,
    };
  });
  if (openSlots < budget) {
    const company = companies[cycle % companies.length];
    const geography = byTier("TEXAS").find((geo) => geo.id === "TEXAS_STATEWIDE") ?? geographies[0];
    planned.push({
      position: planned.length + 1, kind: "EXACT_COMPANY", query: `"${company.replaceAll('"', "")}" (subcontractors OR "trade partners" OR "vendor registration" OR "contract labor") ${geography.query} ${EXCLUDE}`,
      reason: `Watched company · ${company}`, tradeCategoryId: null, occupationId: null, geographyId: geography.id, geographyTier: geography.tier,
      signalCategory: "SUBCONTRACTOR_VENDOR", company,
    });
  }
  return planned;
}

// ---------------------------------------------------------------------------------------------------------
// Evidence-based classification. Every value comes from the listing's own title/excerpt; search intent is
// never presented as a finding.

const JOB_BOARD_DOMAINS = /(^|\.)(indeed|ziprecruiter|glassdoor|zippia|jobtoday|ihire[a-z]*|roaddogjobs|skilledtrades|tealhq|terra|jobget|dice|careerjet|jora|whatjobs|recruit|jobzmall|simplyhired|monster|careerbuilder|snagajob|talent|jooble|salary|builtin|energyjobshop|rigzone|linkedin|lensa|jobrapido|adzuna|getwork|joblist|learn4good|tradesmanjobs|bebee)\.[a-z.]+$/i;
export const isJobBoardDomain = (domain: string) => JOB_BOARD_DOMAINS.test(domain) || /(^|\.)jobs?\./i.test(domain) || /(^|\.)careers?\./i.test(domain);

const CATEGORY_EVIDENCE: readonly [SignalCategory, RegExp][] = [
  ["PROCUREMENT_BID", /\b(?:invitation (?:to|for) bids?|request for (?:proposals?|quotes?|qualifications)|rfp|rfq|rfi|bid (?:opportunit(?:y|ies)|solicitation|documents?|due)|solicitation|sealed bids?|procurement notice)\b/i],
  ["SUBCONTRACTOR_VENDOR", /\b(?:seeking|soliciting|requesting|looking for|invites?|inviting) (?:qualified )?(?:[a-z]+ ){0,2}(?:sub-?contractors?|trade partners?|vendors?|suppliers?)\b|\bsub-?contractor (?:outreach|opportunit(?:y|ies)|prequalification|registration)\b|\bvendor (?:registration|prequalification)\b|\btrade partner (?:registration|prequalification)\b/i],
  ["MANPOWER_REQUEST", /\b(?:seeking|needs?|requesting|looking for) (?:[a-z]+ ){0,2}(?:manpower|contract labor|labor suppliers?|staffing (?:partners?|agenc(?:y|ies)|suppliers?|vendors?))\b|\b(?:manpower|labor) (?:request|supply (?:request|needed))\b|\btemporary (?:craft )?(?:labor|workforce) (?:needed|request)\b/i],
  ["PROJECT_DEMAND", /\bnew construction project\b|\b(?:estimated\s+)?(?:opening|completion|construction start)\s*~?\s*(?:[A-Z][a-z]+\s+)?\d{4}\b|\b(?:project|plant|facility|expansion|terminal|refinery|data center|construction)\b.{0,60}\b(?:announced?|awarded|breaks? ground|groundbreaking|under construction|to begin|begins?|approved|investment|\$\d+(?:\.\d+)? ?(?:million|billion|[mb]\b))/i],
  ["DIRECT_HIRING", /\b(?:hiring|now hiring|seeking|needed|wanted|job openings?|jobs? (?:in|near|available)|apply (?:now|today)|we are hiring|is hiring|careers?|full[- ]time|per hour|\/hr)\b/i],
];

export interface SignalCategoryEvidence {
  readonly primary: SignalCategory | null;
  readonly categories: readonly SignalCategory[];
  readonly jobBoard: boolean;
}

/**
 * A job-board listing proves (at most) direct hiring activity; it can never be read as a B2B manpower,
 * subcontractor or procurement request, so job-board text is capped at DIRECT_HIRING.
 */
export function classifySignalEvidence(text: string, domain: string): SignalCategoryEvidence {
  const jobBoard = isJobBoardDomain(domain);
  const found = CATEGORY_EVIDENCE.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
  const categories = jobBoard ? found.filter((category) => category === "DIRECT_HIRING") : found;
  return { primary: categories[0] ?? null, categories, jobBoard };
}

export interface TradeEvidence {
  readonly text: string;
  readonly tradeCategoryId: string;
  readonly occupationId: string;
  readonly workforceTradeCode: string | null;
}

export interface ProfessionEvidence {
  readonly tradeCategoryId: string;
  /** Every configured specialty of this family explicitly named in the listing. */
  readonly occupationIds: readonly string[];
}

/**
 * All profession families explicitly named in the listing text (a project listing may name several).
 * Only occupation wording counts: company names and search terms never assign a profession, and a
 * listing that names no configured occupation has no profession (it stays unclassified).
 */
export function detectTrades(text: string, trades: readonly DiscoveryTradeCategory[] = DISCOVERY_TRADE_CATEGORIES): readonly ProfessionEvidence[] {
  return trades.map((trade) => ({ tradeCategoryId: trade.id, occupationIds: trade.occupations.filter((occupation) => occupation.detect.test(text)).map((occupation) => occupation.id) }))
    .filter((profession) => profession.occupationIds.length > 0);
}

export function detectTrade(text: string, trades: readonly DiscoveryTradeCategory[] = DISCOVERY_TRADE_CATEGORIES): TradeEvidence | null {
  // More specific occupations first (e.g. "journeyman electrician" before "electrician", "pipe welder" before "welder").
  const occupations = trades.flatMap((trade) => trade.occupations.map((occupation) => ({ trade, occupation })));
  let best: { index: number; length: number; value: TradeEvidence } | null = null;
  for (const { trade, occupation } of occupations) {
    const match = text.match(occupation.detect);
    if (!match || match.index === undefined) continue;
    const value = { text: match[0], tradeCategoryId: trade.id, occupationId: occupation.id, workforceTradeCode: occupation.workforceTradeCode };
    if (!best || match[0].length > best.length || (match[0].length === best.length && match.index < best.index)) best = { index: match.index, length: match[0].length, value };
  }
  return best?.value ?? null;
}

const STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL",
  Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME",
  Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(STATES));
const STATE_PATTERN = new RegExp(`\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?),\\s*(${[...Object.keys(STATES).sort((a, b) => b.length - a.length), ...STATE_CODES].join("|")})\\b`);
const LISTING_WORDS = /^(jobs?|hiring|now|electricians?|careers?|work|in|near|openings?|positions?|technicians?|welders?|plumbers?)$/i;
const HOUSTON_METRO = new Set(["Houston", "Katy", "Pasadena", "Baytown", "Freeport", "Sugar Land", "Pearland", "League City", "Deer Park", "La Porte", "Channelview", "Conroe", "The Woodlands", "Cypress", "Humble", "Texas City", "Galveston", "Spring", "Tomball", "Missouri City", "Rosenberg", "Clute", "Lake Jackson", "Angleton", "Mont Belvieu"]);

export interface LocationEvidence { readonly label: string; readonly city: string; readonly state: string; readonly tier: GeographyTier }

export function detectLocation(text: string): LocationEvidence | null {
  const match = text.match(STATE_PATTERN);
  if (!match) return null;
  const city = match[1].split(/\s+/).filter((word, index, words) => index === words.length - 1 || !LISTING_WORDS.test(word)).join(" ");
  const state = STATES[match[2]] ?? match[2];
  const tier: GeographyTier = state === "TX" ? (HOUSTON_METRO.has(city) ? "HOUSTON_METRO" : "TEXAS") : "US_MOBILIZATION";
  return { label: `${city}, ${state}`, city, state, tier };
}

export const findTradeCategory = (id: string | null) => DISCOVERY_TRADE_CATEGORIES.find((trade) => trade.id === id) ?? null;
export const findOccupation = (id: string | null) => DISCOVERY_TRADE_CATEGORIES.flatMap((trade) => trade.occupations).find((occupation) => occupation.id === id) ?? null;
export const findGeography = (id: string | null) => DISCOVERY_GEOGRAPHIES.find((geo) => geo.id === id) ?? null;
export const isSignalCategory = (value: unknown): value is SignalCategory => typeof value === "string" && (SIGNAL_CATEGORIES as readonly string[]).includes(value);
export const isGeographyTier = (value: unknown): value is GeographyTier => typeof value === "string" && (GEOGRAPHY_TIERS as readonly string[]).includes(value);

/** Families whose trade scope the text states (no specialty implied). Used only for qualified B2B requests. */
export function detectTradeScope(text: string, trades: readonly DiscoveryTradeCategory[] = DISCOVERY_TRADE_CATEGORIES): readonly ProfessionEvidence[] {
  return trades.filter((trade) => trade.scopeDetect.test(text)).map((trade) => ({ tradeCategoryId: trade.id, occupationIds: [] }));
}
