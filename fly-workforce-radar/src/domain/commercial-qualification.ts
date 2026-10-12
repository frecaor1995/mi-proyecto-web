import { isJobBoardDomain, type LocationEvidence, type ProfessionEvidence, type SignalCategory } from "./discovery-coverage";

/**
 * Commercial qualification gate: RAW SEARCH RESULT → EVIDENCE ASSESSMENT → COMMERCIAL QUALIFICATION → HUMAN REVIEW.
 *
 * Every decision uses only what the returned source states (title, excerpt, URL, domain). The search query is
 * never evidence, current workforce supply is never a criterion (demand first, supply at matching time), and
 * qualification is not verification: it never changes a signal's human review status.
 *
 * Categories reuse the existing signal categories:
 *   A MANPOWER_REQUEST (explicit external workforce demand) · B SUBCONTRACTOR_VENDOR · C PROCUREMENT_BID
 *   D PROJECT_DEMAND (project named, supplier acceptance not established) · E DIRECT_HIRING · F not qualified.
 */
export type CommercialTier = "PRIMARY" | "SECONDARY" | "EXCLUDED";

export type NoiseReason = "JOB_BOARD_AGGREGATION" | "DIRECTORY" | "HOMEPAGE" | "CAREER_INFORMATION" | "FORUM_OR_REFERENCE" | "NO_SOURCE_CONTEXT" | "STALE" | "EXPIRED" | "INFORMATIONAL_CONTENT" | "LISTING_PAGE";
export type MissingEvidence = "ORGANIZATION" | "REQUIREMENT" | "PROFESSION" | "GEOGRAPHY";

export interface CommercialQualification {
  readonly qualified: boolean;
  readonly tier: CommercialTier;
  /** Qualified category (A–E); null when not qualified (F). */
  readonly category: SignalCategory | null;
  readonly organization: string | null;
  readonly project: string | null;
  readonly noise: NoiseReason | null;
  readonly missing: readonly MissingEvidence[];
}

export interface QualificationInput {
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
  readonly domain: string;
  readonly professions: readonly ProfessionEvidence[];
  /** Professions named in the title itself (the title states what the page is about). */
  readonly titleNamesProfession: boolean;
  readonly location: LocationEvidence | null;
  readonly categories: readonly SignalCategory[];
  readonly stale: boolean;
  /** Text used for generic-noise decisions; defaults to the snippet. Page text never decides generic noise. */
  readonly noiseText?: string;
}

const DIRECTORY_DOMAINS = /(^|\.)(yelp|bbb|mapquest|yellowpages|manta|buildzoom|angi|angieslist|homeadvisor|houzz|thumbtack|chamberofcommerce|dnb|zoominfo|bizapedia|opencorporates|buzzfile|thomasnet|cylex|expertise|porch|clutch|bark|procore|levelset|superpages|nextdoor|leadiq|highwire|rocketreach|crunchbase|signalhire|apollo|owler|datanyze|craft|comparably|zoominfo|lusha|bizjournals-directory)\.[a-z.]+$/i;
const REFERENCE_DOMAINS = /(^|\.)(reddit|quora|wikipedia|bls|careerexplorer|onetonline|mynextmove|youtube|facebook|tiktok|instagram|pinterest)\.[a-z.]+$|(^|\.)tdlr\.texas\.gov$/i;
const DIRECTORY_TITLE = /\b(top \d+|best \d*\s*[a-z ]*(contractors|companies|firms)|near me|directory|list of|find (a|an|the)?\s*[a-z ]*(contractor|company)|(contractors|companies|firms|builders)\s+(in|of|near|around)\s+[A-Z]|general contractors\b.*\|)/i;
const CAREER_INFO = /\b(how to (become|get)|salary|salaries|pay scale|career (guide|path|advice)|what (does|is) an? |job description|training (program|course)|apprenticeship program|licen[sc](?:e|ing) requirements|license application|exam prep|requirements to become|apply for a (new )?[a-z ]*license)\b/i;
// Job-board pages that list many jobs (search results / counts), as opposed to one employer's posting.
const AGGREGATION_TITLE = /^\s*[$\d]|\b\d[\d,]*\+?\s+[a-z /-]*jobs?\b|\bjobs?,?\s+(employment|in|near|available)\b|\bjobs?\s*\(now hiring\)|\bjob search\b|encuentra nuevas ofertas|\bjobs\s*[|–-]\s*(indeed|glassdoor|ziprecruiter|simplyhired|monster|linkedin|joblist|talent)/i;
const SPECIFIC_POSTING_URL = /\/viewjob\b|[?&]jk=|\/job-listing\/|\/jobs\/view\/|\/c\/[^/]+\/job\/|\/jobs\/\d{5,}(\/|$)|[?&](jobid|job_id|gh_jid)=/i;
/** One employer's posting on a job board: "<occupation> at <Organization>" / "<occupation> @ <Organization>". */
const POSTING_TITLE = /^\s*([^|@]{3,90}?)\s+(?:at|@)\s+([A-Z][A-Za-z0-9&.,'’ -]{1,70}?)(?:\s*[-–|(]|$)/;

export function jobPostingOrganization(title: string): string | null {
  const match = title.match(POSTING_TITLE);
  if (!match || /\bjobs\b/i.test(match[1])) return null;
  const name = match[2].replace(/[\s,.-]+$/, "").trim();
  return name.length >= 2 ? name : null;
}
const PROFESSIONAL_SERVICES = /\b(?:professional (?:engineering|architectural|design|consulting|surveying) services|architect(?:ural)?\s*\/\s*engineer(?:ing)?|A\/E services|engineering design services)\b/i;
const CRAFT_SCOPE = /\b(?:(?:electrical|mechanical|plumbing|hvac|welding|instrumentation) services|installation|construction services|maintenance services|labor|craft|electricians?|technicians?|welders?|pipefitters?|plumbers?)\b/i;
const TRADE_SCOPE = /\b(electrical|mechanical|hvac|plumbing|piping|pipefitting|welding|construction|industrial|maintenance|instrumentation|millwright|structural steel|concrete|rigging|scaffolding|insulation|craft labor|skilled trades?)\b/i;

/** A page listing many jobs from a job board (search results, counts), not a specific employer's posting. */
export function isJobBoardAggregation(input: Pick<QualificationInput, "title" | "url" | "domain">): boolean {
  if (!isJobBoardDomain(input.domain) || jobPostingOrganization(input.title)) return false;
  // A count/search-style title is aggregation whatever the URL looks like ("143 pipe fitter Jobs in Houston").
  if (AGGREGATION_TITLE.test(input.title)) return true;
  let path = "";
  try { path = new URL(input.url).pathname; } catch { path = ""; }
  return !SPECIFIC_POSTING_URL.test(input.url) && /\/(jobs?|q-|l-|search|browse)(\/|-|$|\?)|-jobs(-|\/|$)|jobs-in/i.test(path);
}

const isHomepage = (url: string) => { try { const parsed = new URL(url); return (parsed.pathname === "/" || parsed.pathname === "") && !parsed.search; } catch { return false; } };

/** Generic pages that should never enter commercial review on their own (also used to avoid re-storing them). */
const INFORMATIONAL_TITLE = /\b(?:process for|process explained|guide(?: to)?|how to|tips|keys to|what is|explained|best practices|checklist|laws? in|faq)\b/i;
const LISTING_TITLE = /\b(?:bid opportunities|current bids|open solicitations|bid board|bids? (?:list|calendar)|procurement opportunities)\b/i;

export function genericNoiseReason(input: Pick<QualificationInput, "title" | "description" | "url" | "domain" | "categories" | "noiseText">): NoiseReason | null {
  const text = input.noiseText ?? `${input.title} ${input.description ?? ""}`;
  if (REFERENCE_DOMAINS.test(input.domain)) return "FORUM_OR_REFERENCE";
  if (DIRECTORY_DOMAINS.test(input.domain) || DIRECTORY_TITLE.test(input.title)) return "DIRECTORY";
  // A board listing many solicitations is a lead to the specific notices, not one opportunity.
  if (LISTING_TITLE.test(input.title)) return "LISTING_PAGE";
  if (isJobBoardAggregation(input)) return "JOB_BOARD_AGGREGATION";
  if (CAREER_INFO.test(input.title) || (CAREER_INFO.test(text) && !input.categories.some((category) => category !== "DIRECT_HIRING"))) return "CAREER_INFORMATION";
  // Explanatory articles about prequalification, contract labor law, etc. state no demand of their own.
  if (INFORMATIONAL_TITLE.test(input.title)) return "INFORMATIONAL_CONTENT";
  if (isHomepage(input.url) && !input.categories.some((category) => category !== "DIRECT_HIRING")) return "HOMEPAGE";
  return null;
}

const NAME = "[A-Z][A-Za-z0-9&.'’-]*(?:\\s+(?:[A-Z][A-Za-z0-9&.'’-]*|of|and|&)){0,4}";
const ORG_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b(${NAME})\\s+(?:is|are)\\s+(?:currently\\s+|now\\s+|actively\\s+)?(?:hiring|seeking|looking for|accepting|soliciting|inviting|requesting|recruiting)\\b`),
  /\bCompany:\s*([A-Z][^•·|\n]{1,60}?)(?=\s+(?:Location|Job|Type|Salary|Pay)\b|\s*[•·|]|$)/,
  new RegExp(`\\b(${NAME}\\s+(?:Inc|LLC|L\\.L\\.C|Corp|Corporation|Ltd|LP|Group|Constructors|Construction|Contractors|Contracting|Industries|Electric|INC|CORP|LLC|GROUP|CONSTRUCTORS|CONTRACTORS))\\b\\.?`),
  // Public bodies that issue solicitations: "Harris County", "City of Beaumont", "Port of Houston", "Galena Park ISD".
  /(?<!\b(?:in|In|IN|of|Of|near|Near)\s)\b((?:City|CITY|Port|PORT|County|COUNTY) (?:of|OF) [A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?|[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\s+(?:County|COUNTY|ISD|Independent School District|Authority|AUTHORITY|Navigation District|Water District|University|College))\b/,
];
const NEW_CONSTRUCTION_AT = /\bnew construction project at ([0-9][0-9A-Za-z .'-]{4,60}?)(?:,|\s+in\b)/i;
const PROJECT_PATTERN = new RegExp(`\\b(${NAME}\\s+(?:Project|Plant|Facility|Expansion|Terminal|Refinery|LNG|Data Center|Hospital|Campus|Complex|Turnaround))\\b`);
const GENERIC_NAME = /^(the|a|an|our|this|we|you|new|now|job|jobs|hiring|search|apply|find|top|best|local|commercial|industrial|general|licensed|search welder|salary search)\b/i;

const titleCase = (value: string) => value.split(/(\s+)/).map((word) => {
  if (/^\s+$/.test(word)) return word;
  if (/^(OF|AND)$/.test(word)) return word.toLowerCase();
  if (/^(INC|CO|CORP|LTD)\.?$/.test(word)) return word[0] + word.slice(1).toLowerCase();
  if (/^[A-Z]{2,3}$/.test(word)) return word; // acronyms: MMR, ISD, LLC
  return word[0] + word.slice(1).toLowerCase();
}).join("");
const clean = (value: string) => { const name = value.replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim(); return name === name.toUpperCase() && /[A-Z]{3}/.test(name) ? titleCase(name) : name; };

/** Title and each sentence are matched separately so a name never straddles "…Freeport, TX" + "Zachry Group". */
const segmentsOf = (text: string) => text.split(/(?<=[.!?])\s+|\s+[|–—]\s+|\s+-\s+|\n+/).map((segment) => segment.trim()).filter(Boolean);

export function organizationFrom(text: string, domain: string, title: string): string | null {
  const segments = [title, ...segmentsOf(text.startsWith(title) ? text.slice(title.length) : text)];
  for (const pattern of ORG_PATTERNS) {
    for (const segment of segments) {
      const match = segment.match(pattern)?.[1];
      if (match && !GENERIC_NAME.test(match) && match.length <= 80) return clean(match);
    }
  }
  // The organization's own site: the domain label appears in the page title (e.g. "Zachry | Careers" on zachry.com).
  if (!isJobBoardDomain(domain) && !DIRECTORY_DOMAINS.test(domain) && !REFERENCE_DOMAINS.test(domain)) {
    const label = domain.replace(/^www\./, "").split(".")[0];
    const titleMatch = label.length >= 4 ? title.match(new RegExp(`\\b(${label}[A-Za-z]*(?:\\s+[A-Z][A-Za-z]*){0,3})`, "i"))?.[1] : null;
    if (titleMatch) return clean(titleMatch);
  }
  return null;
}

export function projectFrom(text: string): string | null {
  const site = text.match(NEW_CONSTRUCTION_AT)?.[1];
  if (site) return `New construction at ${clean(site.replace(/\b([A-Z])([A-Z]+)\b/g, (_, first: string, rest: string) => first + rest.toLowerCase()))}`;
  for (const segment of segmentsOf(text)) {
    const match = segment.match(PROJECT_PATTERN)?.[1];
    if (match && !GENERIC_NAME.test(match)) return clean(match);
  }
  return null;
}

const PRIMARY: readonly SignalCategory[] = ["MANPOWER_REQUEST", "SUBCONTRACTOR_VENDOR", "PROCUREMENT_BID"];

export function qualifyCommercialSignal(input: QualificationInput): CommercialQualification {
  const text = `${input.title} ${input.description ?? ""}`;
  const posting = isJobBoardDomain(input.domain) ? jobPostingOrganization(input.title) : null;
  const organization = posting ?? organizationFrom(text, input.domain, input.title);
  const project = projectFrom(text);
  const excluded = (noise: NoiseReason | null, missing: readonly MissingEvidence[] = []): CommercialQualification =>
    ({ qualified: false, tier: "EXCLUDED", category: null, organization, project, noise, missing });

  const noise = !input.description?.trim() ? "NO_SOURCE_CONTEXT" : input.stale ? "STALE" : genericNoiseReason(input);
  if (noise) return excluded(noise);

  // A named employer's posting on a job board is itself direct-hiring evidence (hiring only — never B2B demand).
  const categories: readonly SignalCategory[] = posting && input.titleNamesProfession && !input.categories.includes("DIRECT_HIRING") ? [...input.categories, "DIRECT_HIRING"] : input.categories;
  const category = (["MANPOWER_REQUEST", "SUBCONTRACTOR_VENDOR", "PROCUREMENT_BID", "PROJECT_DEMAND", "DIRECT_HIRING"] as const).find((candidate) => categories.includes(candidate)) ?? null;
  const missing: MissingEvidence[] = [];
  if (!category) missing.push("REQUIREMENT");
  // A project needs a named project; everything else needs an identifiable organization (or named project).
  if (category === "PROJECT_DEMAND" ? !project : !(organization || project)) missing.push("ORGANIZATION");
  // Hiring needs an occupation the title is about (not an incidental excerpt mention); B2B requests need trade scope.
  const professionOk = category === "DIRECT_HIRING" || category === "MANPOWER_REQUEST"
    ? input.professions.length > 0 && (input.titleNamesProfession || category === "MANPOWER_REQUEST")
    : (input.professions.length > 0 || TRADE_SCOPE.test(text)) && !(PROFESSIONAL_SERVICES.test(text) && !CRAFT_SCOPE.test(text.replace(PROFESSIONAL_SERVICES, "")));
  if (!professionOk) missing.push("PROFESSION");
  if (!input.location && !/\b(Texas|TX)\b/.test(text)) missing.push("GEOGRAPHY");
  if (missing.length || !category) return excluded(null, missing);
  return { qualified: true, tier: PRIMARY.includes(category) ? "PRIMARY" : "SECONDARY", category, organization, project, noise: null, missing: [] };
}

// ---------------------------------------------------------------------------------------------------------
// Original-page evidence (bounded source enrichment). The snippet decides generic noise (URL/title/domain);
// the retrieved page can only add evidence the page itself states, and can mark a notice expired.

export type EvidenceOrigin = "SNIPPET" | "ORIGINAL_PAGE";

export interface PageEvidence {
  readonly status: string;
  readonly text: string | null;
  readonly title: string | null;
  readonly jobPosting?: { readonly title?: string; readonly datePosted?: string; readonly validThrough?: string; readonly hiringOrganization?: string; readonly locality?: string; readonly region?: string; readonly salary?: string; readonly experience?: string; readonly employmentType?: string };
  readonly documentDate?: string;
  readonly fetchedAt: string;
}

export interface SourceQualification extends CommercialQualification {
  /** Which evidence supported the verdict; null when not qualified. */
  readonly evidenceOrigin: EvidenceOrigin | null;
  /** Retrieval state of the original page (null = never retrieved). */
  readonly enrichment: string | null;
  readonly expiry: { readonly date: string; readonly basis: "VALID_THROUGH" | "RESPONSE_DEADLINE" | "SOURCE_STATES_CLOSED" | "DOCUMENT_DATE" | "POSTING_AGE" } | null;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const DATE = String.raw`((?:${MONTHS})\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}/\d{1,2}/\d{4})`;
const DEADLINE = new RegExp(String.raw`\b(?:due|deadline|closing(?: date)?|closes|will be (?:received|accepted) (?:until|no later than|by)|received (?:until|no later than|by)|submi(?:t|tted|ssions?)[^.]{0,20}?(?:by|no later than|before))\b[^.]{0,60}?` + DATE, "i");

const parseDate = (value: string): string | null => {
  const time = Date.parse(value.replace(/\.(?=\s)/, "").replace(/Sept\b/, "Sep"));
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
};

/** A response deadline the source itself states ("Bids will be received until October 30, 2026"). */
export function responseDeadlineFrom(text: string): { readonly date: string; readonly text: string } | null {
  const match = text.match(DEADLINE);
  const date = match ? parseDate(match[1]) : null;
  return match && date ? { date, text: match[0].slice(0, 160) } : null;
}

export function qualifyWithSource(snippet: QualificationInput, page: PageEvidence | null, derive: {
  readonly professions: (text: string, title: string) => readonly ProfessionEvidence[];
  readonly titleNamesProfession: (title: string) => boolean;
  readonly location: (text: string) => LocationEvidence | null;
  readonly categories: (text: string, domain: string) => readonly SignalCategory[];
}, now = Date.now()): SourceQualification {
  const fromSnippet = qualifyCommercialSignal(snippet);
  const enrichment = page?.status ?? null;
  const usable = page && page.status === "FETCHED" && (page.text || page.jobPosting);
  // Generic noise is decided by what the result is (URL, title, domain); page text cannot rescue it.
  if (fromSnippet.qualified || !usable || (fromSnippet.noise && fromSnippet.noise !== "NO_SOURCE_CONTEXT")) {
    const expiry = usable ? expiryFrom(page, now) : null;
    if (fromSnippet.qualified && expiry) return { ...fromSnippet, qualified: false, tier: "EXCLUDED", category: null, noise: "EXPIRED", evidenceOrigin: null, enrichment, expiry };
    return { ...fromSnippet, evidenceOrigin: fromSnippet.qualified ? "SNIPPET" : null, enrichment, expiry: null };
  }
  const posting = page.jobPosting;
  const pageText = [posting?.title, posting?.hiringOrganization ? `Company: ${posting.hiringOrganization}` : null,
    posting?.locality && posting.region ? `${posting.locality}, ${posting.region}` : null, (page.text ?? "").slice(0, 6000)].filter(Boolean).join("\n");
  const combined = `${snippet.description ?? ""}\n${pageText}`;
  const title = snippet.title;
  const fromPage = qualifyCommercialSignal({
    ...snippet, description: combined.trim() || null, noiseText: `${snippet.title} ${snippet.description ?? ""}`,
    professions: derive.professions(`${title}\n${combined}`, posting?.title ?? title),
    titleNamesProfession: snippet.titleNamesProfession || derive.titleNamesProfession(posting?.title ?? page.title ?? ""),
    location: snippet.location ?? derive.location(combined), categories: derive.categories(`${title}\n${combined}`, snippet.domain),
  });
  const expiry = expiryFrom(page, now);
  if (fromPage.qualified && expiry) return { ...fromPage, qualified: false, tier: "EXCLUDED", category: null, noise: "EXPIRED", evidenceOrigin: null, enrichment, expiry };
  return { ...fromPage, organization: fromPage.organization ?? posting?.hiringOrganization ?? null, evidenceOrigin: fromPage.qualified ? "ORIGINAL_PAGE" : null, enrichment, expiry };
}

const CLOSED = /\b(?:job (?:is )?(?:no longer available|not available|has been filled|has expired|is closed)|(?:position|posting|job|opportunity) (?:has been |is )?(?:filled|closed|expired|no longer (?:available|accepting))|filled this job already|no longer accepting applications|this (?:job|position) is closed)\b/i;

function expiryFrom(page: PageEvidence, now: number): SourceQualification["expiry"] {
  const validThrough = page.jobPosting?.validThrough ? parseDate(page.jobPosting.validThrough) ?? page.jobPosting.validThrough.slice(0, 10) : null;
  if (validThrough && Date.parse(validThrough) < now) return { date: validThrough, basis: "VALID_THROUGH" };
  // A posting dated months ago with no stated expiry is not evidence of a currently open position.
  const posted = page.jobPosting?.datePosted ? Date.parse(page.jobPosting.datePosted) : Number.NaN;
  if (!validThrough && !Number.isNaN(posted) && now - posted > 120 * 86_400_000) return { date: new Date(posted).toISOString().slice(0, 10), basis: "POSTING_AGE" };
  if (page.text && CLOSED.test(page.text)) return { date: page.fetchedAt.slice(0, 10), basis: "SOURCE_STATES_CLOSED" };
  const deadline = page.text ? responseDeadlineFrom(page.text) : null;
  // A document whose own date is over a year old, with no response date still open, is not current demand.
  if (page.documentDate && now - Date.parse(page.documentDate) > 365 * 86_400_000 && !(deadline && Date.parse(deadline.date) >= now)) return { date: page.documentDate, basis: "DOCUMENT_DATE" };
  if (deadline && Date.parse(deadline.date) + 86_400_000 < now) return { date: deadline.date, basis: "RESPONSE_DEADLINE" };
  return null;
}
