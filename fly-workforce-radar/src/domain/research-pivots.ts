import { normalizePerson, type EvidenceCurrency, type HumanInteraction, type PersonGroup } from "./buyer-intelligence";
import { registrableDomain } from "./contact-investigation";

/**
 * Contact Intelligence 2.1A — iterative research graph (pure domain logic; no I/O).
 *
 * A pivot is a discovery that can generate further research: an organization relation, a location, a street
 * address, an institution listing, a person, a channel or a department. Depth counts RESEARCH HOPS: a pivot extracted
 * from the same page as its parent keeps the parent's depth; a pivot found through a new query generated from a pivot
 * is one hop deeper. No query is ever generated from a pivot at MAX_PIVOT_DEPTH.
 *
 * Nothing here is specific to any company, person, address or institution.
 */
export type PivotKind = "COMPANY" | "ORG_ALIAS" | "ORG_DIVISION" | "ORG_SUBSIDIARY" | "ORG_OPERATING_BRAND" | "ORG_JOINT_VENTURE"
  | "LOCATION" | "ADDRESS" | "INSTITUTION" | "PERSON" | "CHANNEL" | "DEPARTMENT";
export const ORG_RELATION_KINDS: readonly PivotKind[] = ["ORG_ALIAS", "ORG_DIVISION", "ORG_SUBSIDIARY", "ORG_OPERATING_BRAND", "ORG_JOINT_VENTURE"];

export const MAX_RESEARCH_QUERIES = 24;
export const MAX_RESEARCH_PAGES = 20;
export const MAX_PIVOT_DEPTH = 3;
/** A stage stops after this many consecutive queries that produced no useful new pivot or evidence. */
export const NOVELTY_STOP = 2;
export const DEFAULT_DAILY_QUERY_CAP = 60;
export const STAGE_QUERY_CAPS = { relations: 1, ecosystem: 4, address: 3, person: 6, channel: 3, procurement: 1 } as const;
export const MAX_PERSON_PIVOTS = 4;

/** The daily cap is configurable (CONTACT_RESEARCH_DAILY_QUERY_CAP); the default stays at 60. */
export function dailyQueryCap(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.CONTACT_RESEARCH_DAILY_QUERY_CAP);
  return Number.isInteger(raw) && raw > 0 && raw <= 1000 ? raw : DEFAULT_DAILY_QUERY_CAP;
}

// ---------------------------------------------------------------------------------------------------------
// Normalization / deduplication

const STREET_SUFFIX: Record<string, string> = {
  road: "rd", rd: "rd", street: "st", st: "st", avenue: "ave", ave: "ave", boulevard: "blvd", blvd: "blvd", drive: "dr", dr: "dr", lane: "ln", ln: "ln",
  parkway: "pkwy", pkwy: "pkwy", highway: "hwy", hwy: "hwy", freeway: "fwy", fwy: "fwy", way: "way", court: "ct", ct: "ct", place: "pl", pl: "pl",
  circle: "cir", cir: "cir", trail: "trl", trl: "trl", loop: "loop", expressway: "expy", expy: "expy", pike: "pike", plaza: "plz", plz: "plz",
  route: "rte", rte: "rte",
};
const DIRECTION: Record<string, string> = { north: "n", south: "s", east: "e", west: "w", n: "n", s: "s", e: "e", w: "w" };

export function normalizeStreet(street: string): string {
  return street.toLowerCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean)
    .map((word) => STREET_SUFFIX[word] ?? DIRECTION[word] ?? word).join(" ").trim();
}
export const phoneDigits = (phone: string) => { const digits = phone.replace(/\D/g, ""); return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits; };
export const formatPhone = (digits: string) => (digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits);
const normalizeOrg = (name: string) => name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(inc|llc|l l c|corp|corporation|co|company|ltd|lp|llp|the)\b/g, " ").replace(/\s+/g, " ").trim();

export function pivotKey(kind: PivotKind, value: string): string {
  switch (kind) {
    case "ADDRESS": return value.toLowerCase().replace(/\s+/g, " ").trim();
    case "CHANNEL": return phoneDigits(value);
    case "PERSON": return normalizePerson(value);
    case "LOCATION": return value.toLowerCase().replace(/[^a-z, ]/g, "").replace(/\s+/g, " ").trim();
    case "INSTITUTION": { try { const url = new URL(value); return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase(); } catch { return value.toLowerCase(); } }
    case "DEPARTMENT": return value.toLowerCase().replace(/\s+/g, " ").trim();
    default: return normalizeOrg(value) || value.toLowerCase();
  }
}

// ---------------------------------------------------------------------------------------------------------
// Addresses (street-level) and locations

export interface ExtractedAddress { readonly number: string; readonly street: string; readonly city: string; readonly state: string; readonly zip: string; readonly raw: string; readonly key: string; readonly location: string }

const STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const SUFFIXES = "Road|Rd|Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Parkway|Pkwy|Highway|Hwy|Freeway|Fwy|Way|Court|Ct|Place|Pl|Circle|Cir|Trail|Trl|Loop|Expressway|Expy|Pike|Plaza|Plz";
const DIRECTIONS = "N|S|E|W|NE|NW|SE|SW|North|South|East|West";
/** Numbered roads keep their route number ("Hwy 30 W", "FM 1960 Rd", "US-59", "I-10", "State Highway 6", "County Road 48"). */
const NUMBERED_ROAD = String.raw`(?:State\s+Highway|State\s+Route|County\s+Road|Farm\s+to\s+Market\s+Road|Highway|Hwy|Route|Rte|FM|SH|SR|CR|US|I)\.?[\s-]*\d{1,4}[A-Z]?\b(?:\s+(?:${SUFFIXES})\b\.?)?`;
const STREET_RE = new RegExp(String.raw`\b(\d{1,6})\s+((?:(?:${DIRECTIONS})\.?\s+)?(?:[A-Z0-9][A-Za-z0-9'-]*\.?\s+){0,4}?(?:${NUMBERED_ROAD}|(?:${SUFFIXES})\b\.?)(?:\s+(?:${DIRECTIONS})\b\.?)?)`, "g");
/** Streets printed without a suffix ("1107 Broadway"): accepted only when "City, ST ZIP" follows immediately. */
const NO_SUFFIX_RE = new RegExp(String.raw`\b(\d{1,6})\s+((?:(?:${DIRECTIONS})\.?\s+)?[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?)(?=\s*,)`, "g");
const NOT_A_STREET = /\b(Suite|Ste|Box|Bldg|Building|Unit|Floor|Fl|Phone|Fax|Tel|Employees|Years|Locations|Offices|Members|Projects|Miles|Acres|Hours)\b/i;
const YEAR_CONTEXT = /\b(since|in|founded|established|est|year|from|by|until|through)\.?\s*$|©\s*$/i;
const CITY_STATE_ZIP_RE = new RegExp(String.raw`^[\s,.#A-Za-z0-9-]{0,60}?(?:^|[\s,])([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}),?\s+(${STATES}|Texas|Louisiana)\.?,?\s+(\d{5})(?:-\d{4})?\b`);
const STRICT_CITY_STATE_ZIP_RE = new RegExp(String.raw`^\s*,\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}),?\s+(${STATES}|Texas|Louisiana)\.?,?\s+(\d{5})(?:-\d{4})?\b`);
const STATE_NAME: Record<string, string> = { texas: "TX", louisiana: "LA" };

/** US street addresses printed on a page ("3741 Main Rd., Suite 2, Springfield, TX 77000"), across line breaks. */
export function extractAddresses(text: string): readonly ExtractedAddress[] {
  const flat = text.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join(", ");
  const out = new Map<string, ExtractedAddress>();
  const add = (number: string, rawStreet: string, csz: RegExpMatchArray) => {
    const city = csz[1].replace(/\s+/g, " ").trim();
    if (/^(Suite|Ste|Bldg|Building|Unit|Floor|Phone|Fax|Tel)$/i.test(city)) return;
    const state = STATE_NAME[csz[2].toLowerCase()] ?? csz[2].toUpperCase();
    const street = rawStreet.replace(/\s+/g, " ").replace(/[.,]$/, "").trim();
    const key = `${number} ${normalizeStreet(street)} ${csz[3]}`;
    if (!out.has(key)) out.set(key, { number, street, city, state, zip: csz[3], raw: `${number} ${street}, ${city}, ${state} ${csz[3]}`, key, location: `${city}, ${state}` });
  };
  const tailAfter = (match: RegExpMatchArray) => flat.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 140)
    .replace(/^\s*,?\s*((?:#|Suite|Ste\.?|Bldg\.?|Building|Unit|Floor|Fl\.?)\s*[\w-]+[\s,]*)*/i, (unit) => (unit.trim() ? ", " : unit));
  for (const match of flat.matchAll(STREET_RE)) {
    const csz = tailAfter(match).match(CITY_STATE_ZIP_RE);
    if (csz) add(match[1], match[2], csz);
  }
  // Suffix-less streets: stricter — street words then directly "City, ST ZIP"; never units, counts or years in prose.
  for (const match of flat.matchAll(NO_SUFFIX_RE)) {
    if (NOT_A_STREET.test(match[2]) || new RegExp(String.raw`\b(${SUFFIXES})$`, "i").test(match[2])) continue;
    if (YEAR_CONTEXT.test(flat.slice(Math.max(0, (match.index ?? 0) - 16), match.index))) continue;
    const csz = tailAfter(match).match(STRICT_CITY_STATE_ZIP_RE);
    if (csz) add(match[1], match[2], csz);
  }
  return [...out.values()];
}

/** Two addresses are the same place when number, street core and ZIP agree (suites ignored). */
export const sameAddress = (a: Pick<ExtractedAddress, "key">, b: Pick<ExtractedAddress, "key">) => a.key === b.key;

// ---------------------------------------------------------------------------------------------------------
// Organization relations (alias, division, subsidiary, operating brand, joint venture)

export interface OrgRelation { readonly kind: PivotKind; readonly name: string; readonly quote: string; readonly since: string | null }

const ORG_NAME = String.raw`([A-Z][A-Za-z0-9&.'-]*(?:\s+(?:[A-Z][A-Za-z0-9&.'-]*|&|of|and)){0,6})`;

/**
 * Relations stated in a sentence that also names the organization. The related name must look like an
 * organization name and differ from the organization itself. Nothing is inferred from co-occurrence alone.
 */
export function extractOrgRelations(text: string, organization: string, aliases: readonly string[] = []): readonly OrgRelation[] {
  // The organization's distinctive first word (e.g. "Acme" for "Acme Group") is accepted only inside the explicit
  // relation phrases below ("X, a <Acme> company"), never as a bare mention.
  const distinctive = normalizeOrg(organization).split(" ").find((word) => word.length >= 4 && !/^(group|holdings|industries|services|international)$/.test(word));
  const names = [...new Set([organization, ...aliases, ...(distinctive ? [distinctive] : [])].map(normalizeOrg).filter(Boolean))];
  const mentions = (sentence: string) => { const n = normalizeOrg(sentence); return names.some((name) => n.includes(name)); };
  const orgPattern = (name: string) => name.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(String.raw`[\s,.-]+`);
  const out = new Map<string, OrgRelation>();
  // Patterns are case-insensitive for their keywords, so the captured name is trimmed to its trailing run of
  // proper-name words in the ORIGINAL casing ("Driving directions to ACME" -> "ACME").
  const properTail = (raw: string) => {
    const words = raw.trim().split(/\s+/); const kept: string[] = [];
    // a case-insensitive capture may swallow a trailing verb ("X is"): drop trailing lowercase words first
    while (words.length && !/^[A-Z0-9]/.test(words[words.length - 1])) words.pop();
    for (let i = words.length - 1; i >= 0; i -= 1) {
      const w = words[i];
      if (/^[A-Z0-9][A-Za-z0-9&.'-]*$/.test(w) || (kept.length && /^(of|and|&)$/.test(w))) kept.unshift(w); else break;
    }
    while (kept.length && /^(of|and|&)$/.test(kept[0])) kept.shift();
    return kept.join(" ");
  };
  const properHead = (raw: string) => {
    const words = raw.trim().split(/\s+/); const kept: string[] = [];
    for (const w of words) {
      if (/^[A-Z0-9][A-Za-z0-9&.'-]*$/.test(w) || (kept.length && /^(of|and|&)$/.test(w))) kept.push(w.replace(/[,.]$/, "")); else break;
      if (/[,.]$/.test(w)) break;
    }
    while (kept.length && /^(of|and|&)$/.test(kept[kept.length - 1])) kept.pop();
    return kept.join(" ");
  };
  const add = (kind: PivotKind, raw: string, quote: string, nameAfterKeyword = false) => {
    const name = nameAfterKeyword ? properHead(raw) : properTail(raw.replace(/\s+(?:and|of|&)$/i, "").replace(/[,.]$/, ""));
    const key = normalizeOrg(name);
    if (!key || key.length < 2 || names.includes(key) || names.some((n) => n.includes(key) && key.length < 3)) return;
    if (/^(the|this|our|we|it|its|a|an|company|group|inc)$/i.test(name)) return;
    const since = quote.match(/\bsince\s+((?:19|20)\d{2})\b/i)?.[1] ?? quote.match(/\bin\s+((?:19|20)\d{2})\b/)?.[1] ?? null;
    if (!out.has(`${kind}|${key}`)) out.set(`${kind}|${key}`, { kind, name, quote: quote.slice(0, 300), since });
  };
  for (const sentence of text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
    if (sentence.length > 500 || !mentions(sentence)) continue;
    for (const name of names) {
      const org = orgPattern(name);
      const patterns: [PivotKind, RegExp][] = [
        ["ORG_SUBSIDIARY", new RegExp(`${ORG_NAME},?\\s+(?:has been|is|became|was)\\s+(?:a|an)\\s+(?:wholly[- ]owned\\s+)?(?:subsidiary\\s+of\\s+)?(?:the\\s+)?${org}(?:\\s+[A-Za-z]+)?\\s+(?:company|subsidiary|business)`, "i")],
        ["ORG_SUBSIDIARY", new RegExp(`${ORG_NAME},?\\s+(?:(?:is|was|became|has been)\\s+)?(?:a|an)\\s+(?:wholly[- ]owned\\s+)?subsidiary\\s+of\\s+(?:the\\s+)?${org}`, "i")],
        // Appositive brand line: "X, a <Org> company" / "X. A <Org> Group Company."
        ["ORG_SUBSIDIARY", new RegExp(`${ORG_NAME}[,.]?\\s+(?:a|an)\\s+${org}(?:\\s+group)?\\s+company\\b`, "i")],
        ["ORG_DIVISION", new RegExp(`${ORG_NAME},?\\s+(?:is\\s+)?(?:a|the)\\s+[A-Za-z ]{0,30}?division\\s+of\\s+(?:the\\s+)?${org}`, "i")],
        ["ORG_ALIAS", new RegExp(`${org}[^.]{0,40}?\\b(?:formerly(?:\\s+known\\s+as)?|also\\s+known\\s+as|now\\s+known\\s+as|a\\.?k\\.?a\\.?)\\s+${ORG_NAME}`, "i")],
        ["ORG_OPERATING_BRAND", new RegExp(`${org}[^.]{0,40}?\\b(?:doing\\s+business\\s+as|d\\/b\\/a|dba|operating\\s+as|under\\s+the\\s+brand)\\s+${ORG_NAME}`, "i")],
        ["ORG_JOINT_VENTURE", new RegExp(`(?:joint\\s+venture|JV)\\s+(?:partners?\\s+)?(?:between|with|of|including)\\s+${org}\\s+(?:and|&)\\s+${ORG_NAME}`, "i")],
        ["ORG_JOINT_VENTURE", new RegExp(`${ORG_NAME}\\s+(?:and|&)\\s+${org}[^.]{0,30}?\\bjoint\\s+venture`, "i")],
      ];
      // ALIAS, OPERATING_BRAND and the first JOINT_VENTURE pattern (indexes 4–6) capture the name AFTER the keyword.
      for (const [index, [kind, re]] of patterns.entries()) { const m = sentence.match(re); if (m) add(kind, m[1], sentence, index >= 4 && index <= 6); }
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------------------
// Institutions (chambers, economic development organizations, associations, member directories)

const INSTITUTION_WORDS = /chamber of commerce|\bchamber\b|economic development|\bEDC\b|\bEDA\b|development (?:alliance|council|corporation|partnership|foundation)|business (?:council|alliance|league|association|directory)|industr(?:y|ial) (?:association|alliance|council)|contractors? association|member(?:ship)? directory|members? list|\/list\/member\/|\/directory\/|\bpartnership\b/i;
export const INSTITUTION_NO_FETCH = /(^|\.)(linkedin|zoominfo|rocketreach|signalhire|apollo|contactout|leadiq|lusha|seamless|datanyze|theorg|crunchbase|facebook|instagram|twitter|x|tiktok|youtube|indeed|glassdoor|ziprecruiter|yelp|bbb|truthfinder|spokeo|whitepages|wikipedia|dnb|globaldata|bloomberg|clearlyrated|mapquest|manta|bizapedia|opencorporates)\.(com|org|io|ai|co|net)$/i;

export const looksLikeInstitution = (result: { readonly title: string; readonly url: string; readonly description?: string | null }) => {
  let host = ""; try { host = new URL(result.url).hostname.toLowerCase(); } catch { return false; }
  if (INSTITUTION_NO_FETCH.test(host)) return false;
  return INSTITUTION_WORDS.test(`${result.title} ${result.url} ${host} ${result.description ?? ""}`);
};

export interface InstitutionTie { readonly tied: boolean; readonly basis: readonly string[] }

/**
 * An institutional page is accepted for an organization only when it names the organization (or a known alias)
 * AND independently matches one of its known places: an official street address, or a known city/state.
 */
export function institutionTie(text: string, input: { readonly names: readonly string[]; readonly addresses: readonly ExtractedAddress[]; readonly locations: readonly string[]; readonly officialDomain: string | null }): InstitutionTie {
  const flat = text.replace(/\s+/g, " ");
  const n = normalizeOrg(flat);
  const named = input.names.map(normalizeOrg).filter(Boolean).find((name) => n.includes(name));
  if (!named) return { tied: false, basis: [] };
  const basis = [`names "${named}"`];
  const pageAddresses = extractAddresses(text);
  const address = pageAddresses.find((a) => input.addresses.some((b) => sameAddress(a, b)));
  if (address) basis.push(`same street address as an official location (${address.raw})`);
  const location = input.locations.find((loc) => { const [city, state] = loc.split(",").map((part) => part.trim()); return city && new RegExp(String.raw`\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b,?\s+(?:${state}\b)`, "i").test(flat); });
  if (location) basis.push(`located in ${location}`);
  if (input.officialDomain && flat.toLowerCase().includes(input.officialDomain)) basis.push(`links the official website ${input.officialDomain}`);
  return { tied: basis.length >= 2 && Boolean(address || location), basis };
}

// ---------------------------------------------------------------------------------------------------------
// Person research priority (research order only — never buyer status)

export type ResearchCategory = "PROCUREMENT" | "OPERATIONS" | "WORKFORCE" | "PROJECT_REGIONAL" | "BUSINESS_DEVELOPMENT" | "LEADERSHIP" | "OTHER";
const CATEGORY_ORDER: readonly ResearchCategory[] = ["PROCUREMENT", "OPERATIONS", "WORKFORCE", "PROJECT_REGIONAL", "BUSINESS_DEVELOPMENT", "LEADERSHIP", "OTHER"];
const CATEGORY_RE: readonly [ResearchCategory, RegExp][] = [
  ["PROCUREMENT", /\b(procurement|purchasing|supply chain|subcontract\w*|vendor|supplier|sourcing|buyer)\b/i],
  ["OPERATIONS", /\b(operations?|services group|plant|site manager|turnaround|maintenance|field services)\b/i],
  ["WORKFORCE", /\b(workforce|staffing|craft|recruit\w*|manpower|labor|talent|branch manager)\b/i],
  ["PROJECT_REGIONAL", /\b(project|regional|district|area|general manager)\b/i],
  ["BUSINESS_DEVELOPMENT", /\b(business development|sales|account|growth|customer development)\b/i],
  ["LEADERSHIP", /\b(president|ceo|chief|owner|founder|vice president|vp|director|chairman|partner)\b/i],
];
export const researchCategory = (title: string | null): ResearchCategory => (title ? CATEGORY_RE.find(([, re]) => re.test(title))?.[0] ?? "OTHER" : "OTHER");

const CURRENCY_RANK: Record<EvidenceCurrency, number> = { CURRENT: 0, UNDATED: 1, HISTORICAL: 2 };
/** Research order: function category first, then current evidence, then breadth of independent sources. */
export function rankPeopleForResearch<T extends { readonly name: string; readonly title: string | null; readonly currency: EvidenceCurrency; readonly domains: number }>(people: readonly T[]): readonly T[] {
  return people.slice().sort((a, b) => CATEGORY_ORDER.indexOf(researchCategory(a.title)) - CATEGORY_ORDER.indexOf(researchCategory(b.title))
    || CURRENCY_RANK[a.currency] - CURRENCY_RANK[b.currency] || b.domains - a.domains || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------------------
// Query generation (bounded, role-aware; no template fan-out)

const quote = (s: string) => `"${s.replace(/"/g, "").trim()}"`;
const CATEGORY_KEYWORD: Record<ResearchCategory, string> = {
  PROCUREMENT: "procurement", OPERATIONS: "operations", WORKFORCE: "staffing", PROJECT_REGIONAL: "project", BUSINESS_DEVELOPMENT: "\"business development\"", LEADERSHIP: "", OTHER: "",
};
export const queries = {
  relations: (org: string) => `${quote(org)} ("a division of" OR subsidiary OR "operating as" OR "joint venture" OR "formerly known as")`,
  /** State level first (institutional member listings are found by organization + state); city level only on novelty. */
  ecosystemState: (org: string, state: string) => `${quote(org)} (chamber OR "economic development" OR alliance) member ${state}`,
  ecosystemCity: (org: string, location: string) => { const [city, state] = location.split(",").map((p) => p.trim()); return `${quote(org)} ${quote(city)}${state ? ` ${state}` : ""} (chamber OR "economic development" OR association OR "member directory")`; },
  /** An organization relation is followed once to reach the related organization's own pages. */
  relationFollowUp: (relatedName: string, org: string) => `${quote(relatedName)} ${quote(org)}`,
  address: (address: Pick<ExtractedAddress, "number" | "street" | "city">) => `${quote(`${address.number} ${address.street.replace(/\.$/, "")}`)} ${quote(address.city)}`,
  /** First person query uses the person's own function; a second one is only issued if the first produced novelty. */
  person: (name: string, org: string, title: string | null, attempt: 0 | 1, alias: string | null) =>
    attempt === 0 ? `${quote(name)} ${quote(org)} ${CATEGORY_KEYWORD[researchCategory(title)]}`.trim() : `${quote(name)} ${quote(alias ?? org)}`,
  channel: (phone: string, org: string) => { const d = phoneDigits(phone); return `"${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}" ${quote(org)}`; },
  procurement: (domain: string) => `site:${domain} (supplier OR vendor OR subcontractor) (registration OR prequalification OR ISNetworld OR Avetta OR procurement)`,
};

// ---------------------------------------------------------------------------------------------------------
// Budgets and novelty

export interface ResearchBudget { queriesUsed: number; pagesUsed: number; readonly maxQueries: number; readonly maxPages: number }
export const canQuery = (budget: ResearchBudget) => budget.queriesUsed < budget.maxQueries;
export const canFetch = (budget: ResearchBudget) => budget.pagesUsed < budget.maxPages;

/** Per-stage novelty tracker: a stage stops after NOVELTY_STOP consecutive unproductive queries or at its cap. */
export class StageNovelty {
  private streak = 0; private used = 0;
  constructor(private readonly cap: number) {}
  get open() { return this.streak < NOVELTY_STOP && this.used < this.cap; }
  record(newItems: number) { this.used += 1; this.streak = newItems > 0 ? 0 : this.streak + 1; }
}

// ---------------------------------------------------------------------------------------------------------
// Phone association (how a number relates to a person) and its A–E mapping

export type PhoneAssociation = "DIRECT_VERIFIED" | "PUBLISHED_IN_PERSON_ENTRY" | "PUBLISHED_WITH_CONTACT_BY_INSTITUTION" | "DEPARTMENT_BRANCH" | "CORPORATE_SWITCHBOARD" | "TYPE_UNKNOWN" | "NOT_FOUND";

/**
 * Classification order is deliberate: an official reading of the number (main line / office line) always wins over
 * how it was printed near a person; a number printed near a name is never upgraded to a direct line.
 */
export function classifyPhoneAssociation(input: {
  readonly phone: string | null; readonly phoneKind: string | null; readonly officialLines: ReadonlyMap<string, string>;
  readonly institutionListing: boolean; readonly inPersonEntry: boolean;
}): PhoneAssociation {
  if (!input.phone) return "NOT_FOUND";
  const official = input.officialLines.get(phoneDigits(input.phone));
  if (official === "MAIN") return "CORPORATE_SWITCHBOARD";
  if (official === "OFFICE" || official === "DEPARTMENT") return "DEPARTMENT_BRANCH";
  if (input.phoneKind === "DIRECT") return "DIRECT_VERIFIED";
  if (input.phoneKind === "MAIN") return "CORPORATE_SWITCHBOARD";
  if (input.phoneKind === "DEPARTMENT" || input.phoneKind === "OFFICE") return "DEPARTMENT_BRANCH";
  if (input.institutionListing) return "PUBLISHED_WITH_CONTACT_BY_INSTITUTION";
  if (input.inPersonEntry || input.phoneKind === "EXTENSION") return "PUBLISHED_IN_PERSON_ENTRY";
  return "TYPE_UNKNOWN";
}
/** Mapping onto the 2.0 A–E route classes. Associations without a verified line type map to no class (never A). */
export const ASSOCIATION_CLASS: Record<PhoneAssociation, "A_DIRECT" | "C_DEPARTMENT" | "D_MAIN" | "E_NOT_FOUND" | null> = {
  DIRECT_VERIFIED: "A_DIRECT", DEPARTMENT_BRANCH: "C_DEPARTMENT", CORPORATE_SWITCHBOARD: "D_MAIN", NOT_FOUND: "E_NOT_FOUND",
  PUBLISHED_IN_PERSON_ENTRY: null, PUBLISHED_WITH_CONTACT_BY_INSTITUTION: null, TYPE_UNKNOWN: null,
};

// ---------------------------------------------------------------------------------------------------------
// Field-by-field corroboration (read time; independent registrable domains, never URLs)

export type FieldStatus = "CORROBORATED" | "SINGLE_SOURCE" | "CONFLICTING" | "UNKNOWN";
export interface FieldEvidence { readonly status: FieldStatus; readonly domains: readonly string[]; readonly note: string | null }
export type CorroborationField = "identity" | "affiliation" | "currentRole" | "location" | "phone" | "phoneAssociation" | "department" | "commercialResponsibility" | "externalWorkforceResponsibility";
export interface PersonCorroboration {
  readonly fields: Record<CorroborationField, FieldEvidence>;
  readonly phoneAssociation: PhoneAssociation;
  readonly stale: "CURRENT" | "STALE_RISK" | "POSSIBLY_MOVED" | "UNDATED_ONLY";
}

const domainOf = (url: string) => { try { return registrableDomain(new URL(url).hostname); } catch { return url; } };
const status = (domains: readonly string[]): FieldStatus => (domains.length >= 2 ? "CORROBORATED" : domains.length === 1 ? "SINGLE_SOURCE" : "UNKNOWN");
const unique = (values: readonly string[]) => [...new Set(values)];
/** Labor-specific wording: procurement or purchasing alone never establishes external-workforce responsibility. */
export const EXTERNAL_WORKFORCE = /\b(manpower|craft labor|contract labor|temporary labor|skilled labor|labor (?:suppliers?|providers?|services|procurement)|staffing (?:suppliers?|agencies|firms|partners)|external workforce|workforce (?:procurement|suppliers?))\b/i;

export function corroboratePerson(person: PersonGroup, context: {
  readonly officialLines: ReadonlyMap<string, string>;
  readonly institutionUrls: ReadonlySet<string>;
  readonly affiliationConflicts: readonly { readonly url: string; readonly note: string; readonly currency: EvidenceCurrency }[];
  readonly interactions: readonly HumanInteraction[];
}): PersonCorroboration {
  const sources = person.sources;
  const all = unique(sources.map((s) => domainOf(s.sourceUrl)));
  const current = sources.filter((s) => s.currency === "CURRENT");
  const role = person.fn ? sources.filter((s) => s.title && person.titles.includes(s.title)) : [];
  const withLocation = sources.filter((s) => s.location || context.institutionUrls.has(s.sourceUrl));
  const withPhone = sources.filter((s) => s.phone);
  const phoneSource = withPhone[0] ?? null;
  const association = classifyPhoneAssociation({
    phone: person.phone?.number ?? null, phoneKind: phoneSource?.phoneKind ?? null, officialLines: context.officialLines,
    institutionListing: Boolean(phoneSource && context.institutionUrls.has(phoneSource.sourceUrl)), inPersonEntry: Boolean(phoneSource),
  });
  const reached = person.interactions.filter((i) => i.personReached);
  const evidenceResponsibility = sources.filter((s) => s.responsibilityEvidence);
  const workforceEvidence = sources.filter((s) => s.responsibilityEvidence && EXTERNAL_WORKFORCE.test(s.responsibilityEvidence));
  const conflicts = context.affiliationConflicts.filter((c) => c.currency !== "HISTORICAL");
  const affiliation: FieldEvidence = conflicts.length
    ? { status: "CONFLICTING", domains: all, note: conflicts.map((c) => c.note).join(" · ").slice(0, 300) }
    : { status: status(all), domains: all, note: null };
  const currentRoleDomains = unique(role.filter((s) => s.currency === "CURRENT").map((s) => domainOf(s.sourceUrl)));
  const fields: Record<CorroborationField, FieldEvidence> = {
    identity: { status: status(all), domains: all, note: null },
    affiliation,
    currentRole: { status: status(currentRoleDomains), domains: currentRoleDomains, note: currentRoleDomains.length ? null : role.length ? "role only in historical or undated sources" : null },
    location: { status: status(unique(withLocation.map((s) => domainOf(s.sourceUrl)))), domains: unique(withLocation.map((s) => domainOf(s.sourceUrl))), note: person.location },
    phone: { status: status(unique(withPhone.map((s) => domainOf(s.sourceUrl)))), domains: unique(withPhone.map((s) => domainOf(s.sourceUrl))), note: person.phone?.number ?? null },
    phoneAssociation: { status: association === "NOT_FOUND" ? "UNKNOWN" : association === "DIRECT_VERIFIED" ? "CORROBORATED" : "SINGLE_SOURCE", domains: phoneSource ? [domainOf(phoneSource.sourceUrl)] : [], note: association },
    department: { status: person.fn ? status(unique(role.map((s) => domainOf(s.sourceUrl)))) : "UNKNOWN", domains: unique(role.map((s) => domainOf(s.sourceUrl))), note: person.fn?.label ?? null },
    commercialResponsibility: reached.some((i) => i.handlesExternalWorkforce === "YES") || evidenceResponsibility.length
      ? { status: "CORROBORATED", domains: unique(evidenceResponsibility.map((s) => domainOf(s.sourceUrl))), note: evidenceResponsibility[0]?.responsibilityEvidence ?? "recorded human interaction" }
      : { status: "UNKNOWN", domains: [], note: null },
    externalWorkforceResponsibility: reached.some((i) => i.handlesExternalWorkforce === "YES") || workforceEvidence.length
      ? { status: "CORROBORATED", domains: unique(workforceEvidence.map((s) => domainOf(s.sourceUrl))), note: workforceEvidence[0]?.responsibilityEvidence ?? "recorded human interaction" }
      : { status: "UNKNOWN", domains: [], note: null },
  };
  const stale = conflicts.length ? "POSSIBLY_MOVED" as const : current.length ? "CURRENT" as const
    : sources.some((s) => s.currency === "HISTORICAL") ? "STALE_RISK" as const : "UNDATED_ONLY" as const;
  return { fields, phoneAssociation: association, stale };
}

// ---------------------------------------------------------------------------------------------------------
// Procurement / supplier route (a supplier route is never proof of external-manpower purchasing)

export interface ProcurementStatus {
  readonly supplierRoute: boolean;
  readonly subcontractRoute: boolean;
  readonly externalWorkforcePurchasing: "CONFIRMED" | "UNKNOWN";
  readonly evidence: readonly { readonly quote: string; readonly url: string }[];
}
export function procurementStatus(evidence: readonly { readonly quote: string; readonly url: string }[]): ProcurementStatus {
  const text = evidence.map((e) => e.quote).join(" ");
  return {
    supplierRoute: /\b(registration|register your company|prequalif\w*|isnetworld|avetta|veriforce|browz|vendor onboarding|supplier portal|supplier qualification|qualify suppliers)\b/i.test(text),
    subcontractRoute: /\bsubcontract\w*\b/i.test(text),
    externalWorkforcePurchasing: EXTERNAL_WORKFORCE.test(text) ? "CONFIRMED" : "UNKNOWN",
    evidence,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Person-pivot result reading: same-name evidence under another organization = possible stale contact

/**
 * Possible stale contact: a result that names the person TOGETHER WITH this organization in an explicit departure
 * phrase ("former ... at <org>", "previously with <org>", "retired from <org>", "left <org>"). A namesake at another
 * organization is NOT evidence of anything (same-name protection): it returns null.
 */
export function affiliationConflict(result: { readonly title: string; readonly description: string | null }, personName: string, names: readonly string[]): string | null {
  const text = `${result.title}. ${result.description ?? ""}`;
  if (!normalizePerson(text).includes(normalizePerson(personName))) return null;
  const n = normalizeOrg(text);
  const named = names.map(normalizeOrg).find((name) => name && n.includes(name));
  if (!named) return null;
  const departure = /\b(former(?:ly)?|previously|ex-|retired from|left|until (?:19|20)\d{2})\b[^.]{0,80}/i.exec(text);
  return departure && normalizeOrg(departure[0]).includes(named) ? `${personName}: "${departure[0].trim().slice(0, 120)}"` : null;
}

// ---------------------------------------------------------------------------------------------------------
// Institutional listings (member pages, rosters)

export interface ListingPerson { readonly name: string; readonly title: string | null; readonly phone: string | null; readonly quote: string }

/**
 * People an institution lists for the organization. On a page focused on the organization (its member page) every
 * listed representative counts; on a multi-member page (roster, directory) only a name immediately followed by a line
 * that starts with the organization's name ("Org , Title") counts. Phones are kept only when printed in the entry.
 */
export function parseInstitutionListing(text: string, names: readonly string[], focused: boolean, parsePage: (text: string) => readonly { name: string; title: string; phone: string | null; quote: string }[], plausible: (name: string) => boolean): readonly ListingPerson[] {
  if (focused) return parsePage(text).map((p) => ({ name: p.name, title: p.title, phone: p.phone, quote: p.quote }));
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const keys = names.map(normalizeOrg).filter(Boolean);
  const out = new Map<string, ListingPerson>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const org = keys.find((key) => normalizeOrg(line.split(",")[0]).startsWith(key));
    if (!org || !plausible(lines[i - 1])) continue;
    const title = line.split(",").slice(1).join(",").trim() || null;
    out.set(normalizePerson(lines[i - 1]), { name: lines[i - 1], title, phone: null, quote: `${lines[i - 1]} — ${line}`.slice(0, 300) });
  }
  return [...out.values()];
}

/** Department pivots are keyed by the page that documents how the organization buys (one per page). */
export const departmentEvidenceKey = (url: string) => { try { const u = new URL(url); return `procurement:${u.hostname.replace(/^www\./, "")}${u.pathname}`.toLowerCase(); } catch { return `procurement:${url}`.toLowerCase(); } };
