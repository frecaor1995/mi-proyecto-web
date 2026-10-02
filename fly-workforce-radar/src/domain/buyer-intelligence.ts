import { createHash } from "node:crypto";
import type { ContactFunction } from "./contact";

/**
 * Contact Intelligence 2.0 — buyer identification. Identifies the people who buy, coordinate or authorize
 * external labor, from legitimate sources only. Five facts are kept apart and never inferred from each other:
 * a person is IDENTIFIED (named in a source), CURRENTLY ASSOCIATED (a current source ties them to the company),
 * RELEVANT (their documented title matches a target buyer function), CONTACTABLE (a channel attributed to them),
 * and RESPONSIBILITY CONFIRMED (specific evidence or a human interaction says they handle the relationship).
 * A title alone never confirms authority; no score is computed anywhere.
 */
export type OrganizationType = "ELECTRICAL_CONSTRUCTION" | "STAFFING_AGENCY" | "INDUSTRIAL_CONTRACTOR" | "PUBLIC_PROCUREMENT" | "GENERAL";

export interface BuyerFunction {
  readonly id: string;
  readonly label: string;
  readonly title: RegExp;
  readonly contactFunction: ContactFunction;
}

const F = (id: string, label: string, title: RegExp, contactFunction: ContactFunction): BuyerFunction => ({ id, label, title, contactFunction });

export const BUYER_FUNCTIONS: Readonly<Record<OrganizationType, readonly BuyerFunction[]>> = {
  ELECTRICAL_CONSTRUCTION: [
    F("OPERATIONS_MANAGER", "Operations Manager", /\b(?:field )?operations (?:manager|director)|\b(?:vp|vice president)(?:,| of)? operations\b|\bdirector of operations\b/i, "OPERATIONS"),
    F("WORKFORCE_MANAGER", "Workforce / Manpower", /\b(?:workforce|manpower|labor|craft) (?:manager|coordinator|director|planner)|\bmanpower\b|\bcraft recruit/i, "WORKFORCE"),
    F("PROJECT_EXECUTIVE", "Project Executive / Project Manager", /\bproject (?:executive|manager|director)\b/i, "PROJECT_MANAGEMENT"),
    F("SUPERINTENDENT", "Superintendent", /\b(?:general |field |electrical )?superintendent\b/i, "CONSTRUCTION_MANAGEMENT"),
    F("PROCUREMENT", "Procurement Manager", /\b(?:procurement|purchasing|supply chain|sourcing) (?:manager|director|lead|specialist)|\bbuyer\b/i, "PROCUREMENT"),
    F("SUBCONTRACTS", "Subcontractor / Vendor Manager", /\b(?:subcontract(?:s|or)?|vendor|supplier) (?:manager|administrator|director|coordinator)|\bsubcontracts\b/i, "SUBCONTRACTS"),
  ],
  STAFFING_AGENCY: [
    F("BRANCH_MANAGER", "Branch Manager", /\bbranch manager\b/i, "OPERATIONS"),
    F("REGIONAL_MANAGER", "Regional Manager", /\b(?:regional|area|district) (?:manager|director|vice president|vp)\b/i, "OPERATIONS"),
    F("STAFFING_MANAGER", "Staffing Manager", /\bstaffing (?:manager|director|specialist|coordinator)\b/i, "WORKFORCE"),
    F("RECRUITING_MANAGER", "Recruiting Manager", /\b(?:recruiting|recruitment|talent acquisition) (?:manager|director|lead)|\b(?:senior |technical |industrial )?recruiter\b/i, "RECRUITER"),
    F("BUSINESS_DEVELOPMENT", "Business Development Manager", /\bbusiness development\b|\baccount (?:manager|executive)\b|\bsales (?:manager|director)\b/i, "OTHER"),
    F("OPERATIONS_MANAGER", "Operations Manager", /\boperations (?:manager|director)\b|\bdirector of operations\b/i, "OPERATIONS"),
  ],
  INDUSTRIAL_CONTRACTOR: [
    F("INDUSTRIAL_OPERATIONS", "Industrial Operations Manager", /\b(?:industrial |field )?operations (?:manager|director)|\bdirector of operations\b|\b(?:vp|vice president)(?:,| of)? operations\b/i, "OPERATIONS"),
    F("TURNAROUND_MANAGER", "Turnaround Manager", /\b(?:turnaround|shutdown|outage) (?:manager|director|coordinator|planner)\b/i, "PROJECT_MANAGEMENT"),
    F("PROJECT_MANAGER", "Project Manager", /\bproject (?:manager|executive|director)\b/i, "PROJECT_MANAGEMENT"),
    F("WORKFORCE_MOBILIZATION", "Workforce / Mobilization Manager", /\b(?:workforce|mobilization|manpower|craft labor) (?:manager|coordinator|director)\b/i, "WORKFORCE"),
    F("PROCUREMENT", "Procurement Manager", /\b(?:procurement|purchasing|supply chain) (?:manager|director|lead)|\bbuyer\b/i, "PROCUREMENT"),
    F("SUBCONTRACTS", "Subcontractor Manager", /\b(?:subcontract(?:s|or)?|vendor) (?:manager|administrator|director)\b/i, "SUBCONTRACTS"),
  ],
  PUBLIC_PROCUREMENT: [
    F("PURCHASING_AGENT", "Named Purchasing Agent", /\b(?:assistant )?purchasing (?:agent|manager|director)\b/i, "PROCUREMENT"),
    F("PROCUREMENT_OFFICER", "Procurement Officer", /\bprocurement (?:officer|manager|specialist|director)|\bbuyer\b|\bcontract (?:specialist|administrator)\b/i, "PROCUREMENT"),
  ],
  GENERAL: [
    F("OPERATIONS_MANAGER", "Operations Manager", /\boperations (?:manager|director)\b/i, "OPERATIONS"),
    F("PROCUREMENT", "Procurement", /\b(?:procurement|purchasing) (?:manager|director|agent)\b/i, "PROCUREMENT"),
    F("PROJECT_MANAGER", "Project Manager", /\bproject (?:manager|executive)\b/i, "PROJECT_MANAGEMENT"),
  ],
};

export function classifyOrganization(name: string, context = ""): OrganizationType {
  const text = `${name} ${context}`;
  if (/\b(county|city of|port of|isd|independent school district|authority|state of|university|college)\b/i.test(name)) return "PUBLIC_PROCUREMENT";
  if (/\b(staffing|manpower|personnel|workforce solutions|labor (?:services|solutions)|employment services|recruiting)\b/i.test(name)) return "STAFFING_AGENCY";
  if (/\b(industrial|turnaround|plant services|maintenance|refinery|petrochemical|mechanical contractors?)\b/i.test(name) || /\b(turnarounds?|refiner(?:y|ies)|petrochemical|industrial maintenance)\b/i.test(context)) return "INDUSTRIAL_CONTRACTOR";
  if (/\b(electric(?:al)?|construction|constructors|contractors?|builders)\b/i.test(text)) return "ELECTRICAL_CONSTRUCTION";
  return "GENERAL";
}

export const functionsFor = (type: OrganizationType, selected?: readonly string[] | null) =>
  selected?.length ? BUYER_FUNCTIONS[type].filter((item) => selected.includes(item.id)) : BUYER_FUNCTIONS[type];

const LEADERSHIP = /\b(president|ceo|chief executive|coo|cfo|owner|founder|chairman|general counsel|chief [a-z]+ officer)\b/i;

/** Which target buyer function a documented title matches (or why it does not). */
export function matchBuyerFunction(title: string | null, type: OrganizationType): { readonly fn: BuyerFunction | null; readonly leadership: boolean } {
  if (!title) return { fn: null, leadership: false };
  const fn = BUYER_FUNCTIONS[type].find((item) => item.title.test(title)) ?? null;
  return { fn, leadership: !fn && LEADERSHIP.test(title) };
}

// ---------------------------------------------------------------------------------------------------------
// Person parsing (no person is ever created from a role that "probably exists")

const NOT_A_NAME = /\b(inc|llc|corp|company|group|services|construction|constructors|contractors|electric|industries|staffing|careers?|jobs?|about|contact|team|leadership|our|the|news|projects?|home|linkedin|manager|director|president|officer|superintendent|coordinator|executive|engineer|vice|operations|procurement|purchasing|department|county|texas|houston|louisiana|safety|quality|apply|login|search|privacy|policy|terms|menu|subcontractor|vendor|supplier|workforce|send|us|your|you|we|call|click|view|read|learn|more|join|meet|get|find|request|schedule|explore|visit|submit|resume|welcome|why|how|what|who|where|when|today|now|free)\b/i;

export function isPlausibleName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, " ");
  const words = name.split(" ");
  if (words.length < 2 || words.length > 4 || name.length > 40) return false;
  if (NOT_A_NAME.test(name)) return false;
  return words.every((word) => /^(?:[A-Z][a-z'’-]+|[A-Z]\.|[A-Z][a-z]+-[A-Z][a-z]+|Mc[A-Z][a-z]+|O'[A-Z][a-z]+|(?:Jr|Sr|II|III)\.?)$/.test(word));
}

export const normalizePerson = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
/** Two people with the same name are only grouped when they are at the same organization. */
export const personKey = (name: string, organization: string) => createHash("sha256").update(`${normalizePerson(name)}|${organization.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`).digest("hex");

export type SourceType = "OFFICIAL_SITE" | "PROCUREMENT_DOCUMENT" | "PRESS_RELEASE" | "NEWS_ARTICLE" | "PROFESSIONAL_PROFILE_LISTING" | "DIRECTORY_LISTING" | "PROVIDER" | "SIGNAL_DOCUMENT";
export type EvidenceCurrency = "CURRENT" | "HISTORICAL" | "UNDATED";

export interface ParsedPerson {
  readonly name: string;
  readonly title: string | null;
  readonly sourceType: SourceType;
  readonly profileUrl: string | null;
  readonly quote: string;
  readonly location: string | null;
}

const PROFILE_DOMAINS = /(^|\.)linkedin\.com$/i;
const DIRECTORY_DOMAINS = /(^|\.)(zoominfo|rocketreach|signalhire|apollo|contactout|theorg|crunchbase|leadiq|lusha|datanyze|bloomberg)\.(com|io|co)$/i;
const ROLE_WORD = /\b(business development|estimating|manager|director|superintendent|coordinator|executive|officer|president|vice president|vp|supervisor|estimator|recruiter|planner|lead|agent|buyer|specialist|administrator|owner|founder|principal|partner|engineer)\b/i;

export function sourceTypeOf(url: string, officialDomain: string | null): SourceType {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { host = ""; }
  if (officialDomain && (host === officialDomain || host.endsWith(`.${officialDomain}`))) return /news|press|media|blog/i.test(url) ? "PRESS_RELEASE" : "OFFICIAL_SITE";
  if (PROFILE_DOMAINS.test(host)) return "PROFESSIONAL_PROFILE_LISTING";
  if (DIRECTORY_DOMAINS.test(host)) return "DIRECTORY_LISTING";
  return "NEWS_ARTICLE";
}

const tokensIn = (text: string, tokens: readonly string[]) => tokens.length > 0 && tokens.every((token) => text.toLowerCase().includes(token));

/**
 * People named in one search result, tied to the organization in the same title/sentence. Profile listings
 * ("Jane Doe - Operations Manager - MMR Group | LinkedIn") are public listings: identity + title only, undated.
 */
export function parsePeopleFromSearchResult(result: { readonly title: string; readonly url: string; readonly description: string | null }, orgTokens: readonly string[], officialDomain: string | null): readonly ParsedPerson[] {
  const sourceType = sourceTypeOf(result.url, officialDomain);
  const people: ParsedPerson[] = [];
  const title = result.title.replace(/\s*[|·]\s*(LinkedIn|ZoomInfo|RocketReach|Crunchbase|The Org|SignalHire|Apollo|ContactOut).*$/i, "").trim();
  // "Name - Title - Company", "Name – Title at Company", "Name - Company"
  const parts = title.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && isPlausibleName(parts[0])) {
    const rest = parts.slice(1).join(" - ");
    const at = rest.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
    const role = at ? at[1] : parts.length >= 3 ? parts[1] : ROLE_WORD.test(rest) && !tokensIn(rest, orgTokens) ? rest : null;
    const company = at ? at[2] : parts.length >= 3 ? parts.slice(2).join(" ") : rest;
    if (tokensIn(`${company} ${role ?? ""}`, orgTokens) && (!role || role.length <= 90)) {
      people.push({ name: parts[0].trim(), title: role?.trim() || null, sourceType, profileUrl: sourceType === "PROFESSIONAL_PROFILE_LISTING" ? result.url : null, quote: result.title.slice(0, 300),
        location: (result.description ?? "").match(/\bLocation:\s*([A-Z][A-Za-z .]+,\s*[A-Z][A-Za-z]+)/)?.[1] ?? null });
    }
  }
  // Snippet sentences: "Name, Title at Company" / "Name, Company's Title" / "Name is the Title of Company"
  for (const sentence of (result.description ?? "").split(/(?<=[.!?])\s+/)) {
    if (!tokensIn(sentence, orgTokens)) continue;
    for (const match of sentence.matchAll(/\b([A-Z][a-z'’-]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z'’-]+(?:-[A-Z][a-z]+)?)\s*,\s*([^,.;]{3,80}?\b(?:manager|director|superintendent|coordinator|executive|officer|president|vp|supervisor|recruiter|planner|agent|buyer|specialist|administrator))\b/gi)) {
      if (isPlausibleName(match[1]) && !people.some((person) => normalizePerson(person.name) === normalizePerson(match[1]))) {
        people.push({ name: match[1], title: match[2].trim(), sourceType, profileUrl: null, quote: sentence.slice(0, 300), location: null });
      }
    }
  }
  return people;
}

export interface PagePerson { readonly name: string; readonly title: string; readonly quote: string; readonly email: string | null; readonly phone: string | null; readonly bio: string }

const PAGE_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}\b/i;
const PAGE_PHONE = /(?:\+?1[-.\s]?)?\(?\b(\d{3})\)?[-.\s]?(\d{3})[-.\s](\d{4})\b/;

/**
 * People on an official page: "Name, Title" or a name line followed by a title line (leadership/team pages).
 * An email/phone is attached only when it is printed inside that person's own entry (the next lines, before the
 * next person) — never from a pattern.
 */
export function parsePeopleFromPage(text: string): readonly PagePerson[] {
  const people = new Map<string, PagePerson>();
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const startsEntry = (line: string) => isPlausibleName(line) || /^([A-Z][a-z'’-]+\s+[A-Z][a-z'’-]+)\s*[,|–—-]/.test(line) && ROLE_WORD.test(line);
  const entryRoutes = (from: number) => {
    let email: string | null = null; let phone: string | null = null;
    for (const line of lines.slice(from, from + 3)) {
      if (startsEntry(line)) break;
      email ??= line.match(PAGE_EMAIL)?.[0]?.toLowerCase() ?? null;
      const number = line.match(PAGE_PHONE);
      if (!phone && number && !/\bfax\b/i.test(line)) {
        const extension = line.slice((number.index ?? 0) + number[0].length).match(/^\s*(?:,\s*)?(?:ext\.?|x|extension)\s*(\d{2,6})\b/i)?.[1];
        phone = `(${number[1]}) ${number[2]}-${number[3]}${extension ? ` ext. ${extension}` : ""}`;
      }
    }
    // The person's own bio paragraph (until the next person): the only text responsibility may be read from.
    const bio: string[] = [];
    for (const line of lines.slice(from, from + 6)) { if (startsEntry(line)) break; bio.push(line); }
    return { email, phone, bio: bio.join(" ").slice(0, 1200) };
  };
  for (const [index, line] of lines.entries()) {
    const next = lines[index + 1];
    if (next && isPlausibleName(line) && ROLE_WORD.test(next) && next.length <= 90 && !isPlausibleName(next)) {
      people.set(normalizePerson(line), { name: line, title: next, quote: `${line} — ${next}`, ...entryRoutes(index + 2) });
      continue;
    }
    const inline = line.match(/^([A-Z][a-z'’-]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z'’-]+(?:-[A-Z][a-z]+)?)\s*[,|–—-]\s*(.{3,80})$/);
    if (inline && isPlausibleName(inline[1]) && ROLE_WORD.test(inline[2]) && !people.has(normalizePerson(inline[1]))) {
      people.set(normalizePerson(inline[1]), { name: inline[1], title: inline[2].trim(), quote: line.slice(0, 300), ...entryRoutes(index + 1) });
      continue;
    }
    // Press-release lists inside a paragraph: "…; Riley Fixturo, Operations Manager, Corpus Christi (27 years); and …".
    if (line.length > 120 && line.includes(";")) {
      for (const segment of line.split(/;\s*(?:and\s+)?/)) {
        const item = segment.trim().replace(/[.,]$/, "").match(/^(?:and\s+)?([A-Z][a-z'’-]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z'’-]+(?:-[A-Z][a-z]+)?),\s*([^;]{3,90}?)(?:\s+for\b.*)?$/);
        if (item && isPlausibleName(item[1]) && ROLE_WORD.test(item[2]) && !people.has(normalizePerson(item[1]))) {
          people.set(normalizePerson(item[1]), { name: item[1], title: item[2].trim(), quote: segment.trim().slice(0, 300), email: null, phone: null, bio: "" });
        }
      }
    }
  }
  return [...people.values()];
}

/** Evidence currency: an official page read now is current; a dated source over a year old is historical. */
export function evidenceCurrency(sourceType: SourceType, sourceDate: string | null, retrievedNow: boolean, now = Date.now()): EvidenceCurrency {
  if (sourceDate) return now - Date.parse(sourceDate) > 365 * 86_400_000 ? "HISTORICAL" : "CURRENT";
  if (retrievedNow && sourceType === "OFFICIAL_SITE") return "CURRENT";
  return "UNDATED";
}

/** Sentences that explicitly state responsibility for labor/vendor relationships (not just a title). */
export const RESPONSIBILITY = /\b(?:responsible for|oversees|manages|handles|leads)\b[^.]{0,80}\b(?:manpower|staffing|craft labor|contract labor|labor (?:procurement|suppliers?)|subcontract(?:s|ors)?|vendor (?:relations|management)|workforce (?:planning|procurement)|procurement|purchasing)\b/i;

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
/** Publication date printed near the top of a page (press releases, news): "January 4, 2024". */
export function pageDate(text: string): string | null {
  const match = text.slice(0, 2000).match(new RegExp(String.raw`\b(${MONTHS})\s+(\d{1,2}),\s+(20\d{2})\b`));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), MONTHS.split("|").indexOf(match[1]), Number(match[2])));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Department-level procurement evidence on an official page (which department buys subcontracted services, and
 * how suppliers are qualified). It names a department, never a person, and never confirms anyone's authority.
 */
export function departmentEvidence(text: string): string | null {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  // Only statements about how the organization buys: a purchasing group handling subcontracts, a supplier
  // registration process, or a supplier-qualification portal. Quotes (market commentary) never count.
  const PATTERNS = [
    /\b(procurement|purchasing)\s+(group|department|team|organization)\b[^.]{0,220}\b(subcontract\w*|sourcing|buying)\b/i,
    /\b(procurement|purchasing)\b[^.]{0,40}\bresponsibilities include\b[^.]{0,160}\bsubcontracts?\b/i,
    /\b(register your company|registration form|vendor registration|supplier registration|subcontractor registration|prequalification)\b/i,
    /\b(isnetworld|avetta|veriforce|browz)\b[^.]{0,120}\b(qualif\w*|suppliers?|subcontractors?)\b|\b(qualif\w*)\b[^.]{0,120}\b(isnetworld|avetta|veriforce|browz)\b/i,
  ];
  const found = sentences.filter((sentence) => sentence.length <= 400 && !/[“”"]|\b(says|said)\b/i.test(sentence) && PATTERNS.some((pattern) => pattern.test(sentence)));
  return found.length ? found.slice(0, 3).join(" ").slice(0, 600) : null;
}

/** A phone line on an official page, with the office/department it is printed under. */
export type ChannelKind = "EXTENSION" | "DEPARTMENT" | "OFFICE" | "MAIN" | "UNKNOWN";
export interface PageChannel { readonly phone: string; readonly kind: ChannelKind; readonly label: string | null; readonly quote: string }

const DEPARTMENT_WORD = /\b(procurement|purchasing|supply chain|subcontracts?|vendor|supplier|human resources|hr|accounting|accounts payable|estimating|business development|sales|operations|safety|recruiting|dispatch)\b/i;
const OFFICE_WORD = /\b(office|branch|location|district|division|plant|yard|shop|facility|staffing office)\b/i;
const MAIN_WORD = /\b(toll[- ]?free|headquarters|home office|corporate office|corporate|main|hq|switchboard)\b/i;
const HEADING_SKIP = /^(phone|tel|telephone|fax|address|hours|mon|tue|wed|thu|fri|sat|sun|email|e-mail|directions|get directions|map|suite|p\.?o\.? box)\b/i;
/** Address lines are never the name of an office: country lines and postal-code lines. */
const COUNTRY_LINE = /^(united states( of america)?|usa|u\.s\.a\.|canada|mexico)\b/i;
const POSTAL_LINE = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b\d{5}(-\d{4})?\b/;
const ADDRESS_LINE = { test: (line: string) => COUNTRY_LINE.test(line) || POSTAL_LINE.test(line) };

/**
 * Phone lines from an official contact/location/procurement page. Fax numbers are skipped; "ext." numbers are
 * corporate extensions (never a direct line); a number keeps the heading it is printed under (office, branch or
 * department). Nothing is assigned to a person here.
 */
export function extractOfficeChannels(text: string, pageUrl: string, pageTitle: string | null = null): readonly PageChannel[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const locationPage = /\/(locations?|offices?|branch(es)?|contact|connect)\b/i.test(pageUrl);
  const out = new Map<string, PageChannel>();
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/(?:\+?1[-.\s]?)?\(?\b(\d{3})\)?[-.\s]?(\d{3})[-.\s](\d{4})\b/g)) {
      const before = line.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
      if (/\bfax\b|\bf:\s*$/i.test(before) || (/^\s*fax\b/i.test(line) && !/phone|tel/i.test(line))) continue;
      const after = line.slice((match.index ?? 0) + match[0].length);
      const extension = after.match(/^\s*(?:,\s*)?(?:ext\.?|x|extension)\s*(\d{2,6})\b/i)?.[1] ?? null;
      const heading = lines.slice(Math.max(0, index - 5), index).reverse()
        .find((candidate) => !/\d{3}/.test(candidate) && candidate.length >= 3 && candidate.length <= 70 && !HEADING_SKIP.test(candidate) && !ADDRESS_LINE.test(candidate)) ?? null;
      const label = (heading ?? pageTitle)?.replace(/\s+/g, " ").slice(0, 120) ?? null;
      const context = `${before} ${label ?? ""}`;
      const kind: ChannelKind = extension ? "EXTENSION"
        : MAIN_WORD.test(before) || (label && MAIN_WORD.test(label)) ? "MAIN"
        : label && DEPARTMENT_WORD.test(label) ? "DEPARTMENT"
        : (label && OFFICE_WORD.test(context)) || locationPage ? "OFFICE" : "UNKNOWN";
      const phone = `(${match[1]}) ${match[2]}-${match[3]}${extension ? ` ext. ${extension}` : ""}`;
      if (!out.has(phone)) out.set(phone, { phone, kind, label, quote: [heading, line].filter(Boolean).join(" — ").slice(0, 300) });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------------------
// Bounded people-search plan

export const MAX_PEOPLE_QUERIES = 6;

export function buildPeopleQueries(input: { readonly organization: string; readonly functions: readonly BuyerFunction[]; readonly location?: string | null; readonly project?: string | null; readonly type: OrganizationType }): readonly string[] {
  const org = `"${input.organization.replace(/"/g, "").replace(/,?\s+(inc|llc|l\.l\.c|corp|co)\.?$/i, "")}"`;
  const queries: string[] = [];
  for (const fn of input.functions.slice(0, 3)) queries.push(`${org} "${fn.label.split(" / ")[0]}"`);
  if (input.type === "STAFFING_AGENCY") queries.push(`${org} branch manager ${input.location ?? "Texas"}`);
  else queries.push(`${org} (manpower OR staffing OR "craft labor") manager`);
  queries.push(`${org} (subcontractor OR vendor OR supplier OR "business development") contact`);
  if (input.project) queries.push(`${org} "${input.project.slice(0, 60)}" project manager`);
  else if (input.location) queries.push(`${org} ${input.location} manager`);
  return [...new Set(queries)].slice(0, MAX_PEOPLE_QUERIES);
}

// ---------------------------------------------------------------------------------------------------------
// Contact states and buyer path

export type ContactState = "CORPORATE_CHANNEL_ONLY" | "PROFESSIONAL_IDENTIFIED" | "PROFESSIONAL_CONTACTABLE" | "COMMERCIAL_RESPONSIBILITY_CONFIRMED";

export interface PersonFacts {
  readonly identified: boolean;
  readonly currentlyAssociated: boolean;
  readonly relevant: boolean;
  readonly contactable: boolean;
  readonly responsibilityConfirmed: boolean;
}

export function contactStateOf(facts: PersonFacts): ContactState {
  if (facts.responsibilityConfirmed) return "COMMERCIAL_RESPONSIBILITY_CONFIRMED";
  if (facts.contactable && facts.relevant) return "PROFESSIONAL_CONTACTABLE";
  if (facts.identified && facts.relevant) return "PROFESSIONAL_IDENTIFIED";
  return "CORPORATE_CHANNEL_ONLY";
}

export type BuyerNextAction = "CONFIRM_CURRENT_ROLE" | "CONFIRM_RESPONSIBILITY" | "REACH_PERSON" | "FIND_CHANNEL" | "IDENTIFY_PERSON" | "ADVANCE_RELATIONSHIP";

export function buyerNextAction(state: ContactState, hasCorporateFallback: boolean): BuyerNextAction {
  if (state === "COMMERCIAL_RESPONSIBILITY_CONFIRMED") return "ADVANCE_RELATIONSHIP";
  if (state === "PROFESSIONAL_CONTACTABLE") return "CONFIRM_RESPONSIBILITY";
  if (state === "PROFESSIONAL_IDENTIFIED") return hasCorporateFallback ? "REACH_PERSON" : "FIND_CHANNEL";
  return "IDENTIFY_PERSON";
}

// ---------------------------------------------------------------------------------------------------------
// Person records → grouped people (never merged on name alone across organizations or conflicting locations)

export type EmailStatus = "FOUND" | "ATTRIBUTED_TO_PERSON" | "TECHNICALLY_VERIFIED" | "HUMAN_CONFIRMED";
export type PhoneStatus = "UNCLASSIFIED" | "CORPORATE_MAIN" | "CORPORATE_EXTENSION" | "DEPARTMENT" | "DIRECT_PROFESSIONAL" | "TECHNICALLY_VALIDATED" | "OWNERSHIP_HUMAN_CONFIRMED";

export interface PersonEvidence {
  readonly candidateId: string;
  readonly name: string;
  readonly title: string | null;
  readonly personKey: string;
  readonly location: string | null;
  readonly sourceUrl: string;
  readonly sourceType: SourceType;
  readonly sourceDate: string | null;
  readonly currency: EvidenceCurrency;
  readonly quote: string | null;
  readonly email: string | null;
  readonly emailAttributed: boolean;
  readonly emailVerified: boolean;
  readonly phone: string | null;
  readonly phoneKind: string | null;
  readonly phoneValidated: boolean;
  readonly profileUrl: string | null;
  readonly responsibilityEvidence: string | null;
}

export interface HumanInteraction {
  readonly candidateId: string;
  readonly personReached: boolean;
  readonly contactDate: string;
  readonly channel: "PHONE" | "EMAIL" | "IN_PERSON" | "VIDEO" | "OTHER";
  readonly handlesExternalWorkforce: "YES" | "NO" | "UNKNOWN";
  readonly referredTo: string | null;
  readonly responsibleDepartment: string | null;
  readonly notes: string | null;
  readonly nextAction: string | null;
  readonly recordedAt: string;
}

export interface PersonGroup {
  readonly key: string;
  readonly name: string;
  readonly title: string | null;
  readonly titles: readonly string[];
  readonly fn: BuyerFunction | null;
  readonly leadership: boolean;
  readonly location: string | null;
  readonly primaryCandidateId: string;
  readonly candidateIds: readonly string[];
  readonly sources: readonly PersonEvidence[];
  readonly lastEvidenceDate: string | null;
  readonly currency: EvidenceCurrency;
  readonly email: { readonly address: string; readonly status: EmailStatus } | null;
  readonly phone: { readonly number: string; readonly status: PhoneStatus; readonly base: PhoneStatus } | null;
  readonly interactions: readonly HumanInteraction[];
  readonly facts: PersonFacts;
  readonly state: ContactState;
  readonly nextAction: BuyerNextAction;
}

const CURRENCY_ORDER: Record<EvidenceCurrency, number> = { CURRENT: 0, UNDATED: 1, HISTORICAL: 2 };
const STATE_ORDER: Record<ContactState, number> = { CORPORATE_CHANNEL_ONLY: 0, PROFESSIONAL_IDENTIFIED: 1, PROFESSIONAL_CONTACTABLE: 2, COMMERCIAL_RESPONSIBILITY_CONFIRMED: 3 };

export function groupPeople(records: readonly PersonEvidence[], interactions: readonly HumanInteraction[], type: OrganizationType, functions: readonly BuyerFunction[]): readonly PersonGroup[] {
  const groups: PersonEvidence[][] = [];
  for (const record of records) {
    // Same person key = same name at the same organization. Records with different explicit locations are kept
    // apart: a shared name is not evidence of a shared identity.
    const group = groups.find((items) => items[0].personKey === record.personKey
      && items.every((item) => !item.location || !record.location || item.location.toLowerCase() === record.location.toLowerCase()));
    if (group) group.push(record); else groups.push([record]);
  }
  return groups.map((items) => {
    const sorted = items.slice().sort((a, b) => CURRENCY_ORDER[a.currency] - CURRENCY_ORDER[b.currency] || (b.sourceDate ?? "").localeCompare(a.sourceDate ?? ""));
    const titles = [...new Set(sorted.map((item) => item.title).filter((title): title is string => Boolean(title)))];
    const title = titles[0] ?? null;
    const matched = titles.map((value) => matchBuyerFunction(value, type)).find((item) => item.fn) ?? matchBuyerFunction(title, type);
    const fn = matched.fn && functions.some((item) => item.id === matched.fn!.id) ? matched.fn : null;
    const ids = sorted.map((item) => item.candidateId);
    const own = interactions.filter((item) => ids.includes(item.candidateId)).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const reached = own.filter((item) => item.personReached);
    const emailRecord = sorted.find((item) => item.email && item.emailAttributed) ?? sorted.find((item) => item.email);
    const emailConfirmed = Boolean(emailRecord && reached.some((item) => item.channel === "EMAIL"));
    const emailStatus: EmailStatus = emailConfirmed ? "HUMAN_CONFIRMED" : emailRecord?.emailVerified ? "TECHNICALLY_VERIFIED" : emailRecord?.emailAttributed ? "ATTRIBUTED_TO_PERSON" : "FOUND";
    const email = emailRecord?.email ? { address: emailRecord.email, status: emailStatus } : null;
    const phoneRecord = sorted.find((item) => item.phone && item.phoneKind === "DIRECT") ?? sorted.find((item) => item.phone && item.phoneKind === "EXTENSION") ?? sorted.find((item) => item.phone && item.phoneKind === "DEPARTMENT") ?? sorted.find((item) => item.phone);
    const phoneConfirmed = Boolean(phoneRecord && reached.some((item) => item.channel === "PHONE"));
    // A switchboard stays a switchboard: validation or a call never relabels a main line as a direct number.
    const baseKind: PhoneStatus = phoneRecord?.phoneKind === "DIRECT" ? "DIRECT_PROFESSIONAL" : phoneRecord?.phoneKind === "EXTENSION" ? "CORPORATE_EXTENSION" : phoneRecord?.phoneKind === "DEPARTMENT" ? "DEPARTMENT" : phoneRecord?.phoneKind === "MAIN" ? "CORPORATE_MAIN" : "UNCLASSIFIED";
    const phoneStatus: PhoneStatus = baseKind === "CORPORATE_MAIN" || baseKind === "UNCLASSIFIED" ? baseKind : phoneConfirmed ? "OWNERSHIP_HUMAN_CONFIRMED" : phoneRecord?.phoneValidated ? "TECHNICALLY_VALIDATED" : baseKind;
    const phone = phoneRecord?.phone ? { number: phoneRecord.phone, status: phoneStatus, base: baseKind } : null;
    const currency = sorted[0].currency;
    const responsibilityConfirmed = reached.some((item) => item.handlesExternalWorkforce === "YES") || sorted.some((item) => Boolean(item.responsibilityEvidence));
    const facts: PersonFacts = {
      identified: true,
      currentlyAssociated: currency === "CURRENT" || reached.length > 0,
      relevant: Boolean(fn) || responsibilityConfirmed,
      contactable: Boolean((email && email.status !== "FOUND") || (phone && phone.status !== "CORPORATE_MAIN" && phone.status !== "UNCLASSIFIED")),
      responsibilityConfirmed,
    };
    const state = contactStateOf(facts);
    return {
      key: `${items[0].personKey}:${items[0].candidateId}`, name: sorted[0].name, title, titles, fn, leadership: matched.leadership,
      location: sorted.find((item) => item.location)?.location ?? null, primaryCandidateId: sorted[0].candidateId, candidateIds: ids, sources: sorted,
      lastEvidenceDate: sorted.map((item) => item.sourceDate).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
      currency, email, phone, interactions: own, facts, state,
      nextAction: !facts.currentlyAssociated && state !== "COMMERCIAL_RESPONSIBILITY_CONFIRMED" ? "CONFIRM_CURRENT_ROLE" as const : buyerNextAction(state, true),
    };
  }).sort((a, b) => STATE_ORDER[b.state] - STATE_ORDER[a.state] || Number(b.facts.relevant) - Number(a.facts.relevant)
    || CURRENCY_ORDER[a.currency] - CURRENCY_ORDER[b.currency] || a.name.localeCompare(b.name));
}

export interface CorporateChannel {
  readonly candidateId: string;
  readonly kind: "MAILBOX" | "PHONE_ROUTE";
  readonly value: string;
  readonly label: string | null;
  readonly phoneKind: string | null;
  readonly sourceUrl: string;
}

export type BuyerPath =
  | {
    readonly state: "INDIVIDUAL";
    readonly organization: string;
    readonly targetFunction: string;
    readonly person: PersonGroup;
    readonly professionalChannel: string | null;
    readonly alternativeChannel: CorporateChannel | null;
    readonly authority: "CONFIRMED_BY_HUMAN" | "CONFIRMED_BY_EVIDENCE" | "NOT_CONFIRMED";
    readonly missing: readonly string[];
    readonly nextAction: BuyerNextAction;
  }
  | {
    readonly state: "NO_INDIVIDUAL_BUYER_IDENTIFIED";
    readonly organization: string;
    readonly sourcesChecked: number;
    readonly functions: readonly string[];
    readonly missing: readonly string[];
    readonly fallback: CorporateChannel | null;
    readonly nextAction: BuyerNextAction;
  };

/** Mailboxes that never reach a buyer of external labor (benefits, help desk, careers, privacy…). */
export const NON_COMMERCIAL_MAILBOX = /^(health|insurance|healthinsurance|benefits|helpdesk|help|support|it|careers?|jobs|hr|payroll|privacy|webmaster|noreply|no-reply|marketing|media|press|accounting|ap|invoices?|billing)[@._-]|^[^@]*(insurance|benefit|helpdesk|careers|payroll|privacy)[^@]*@/i;
const fallbackRank = (channel: CorporateChannel) => (channel.phoneKind === "DEPARTMENT" ? 0 : channel.kind === "MAILBOX" && channel.label ? 1 : channel.phoneKind === "MAIN" ? 2 : channel.kind === "MAILBOX" ? 3 : 4);

export function buyerPath(input: { readonly organization: string; readonly people: readonly PersonGroup[]; readonly channels: readonly CorporateChannel[]; readonly functions: readonly BuyerFunction[]; readonly sourcesChecked: number }): BuyerPath {
  const fallback = input.channels.filter((channel) => channel.phoneKind !== "NON_COMMERCIAL" && channel.phoneKind !== "FAX" && !(channel.kind === "MAILBOX" && NON_COMMERCIAL_MAILBOX.test(channel.value))).slice().sort((a, b) => fallbackRank(a) - fallbackRank(b))[0] ?? null;
  const person = input.people.find((item) => item.facts.relevant);
  if (!person) {
    return {
      state: "NO_INDIVIDUAL_BUYER_IDENTIFIED", organization: input.organization, sourcesChecked: input.sourcesChecked, functions: input.functions.map((item) => item.label),
      missing: ["NAMED_PERSON", "PROFESSIONAL_CHANNEL", "COMMERCIAL_RESPONSIBILITY"], fallback, nextAction: "IDENTIFY_PERSON",
    };
  }
  const human = person.interactions.some((item) => item.personReached && item.handlesExternalWorkforce === "YES");
  const missing = [
    ...(person.facts.currentlyAssociated ? [] : ["CURRENT_ASSOCIATION"]),
    ...(person.email && person.email.status !== "FOUND" ? [] : ["PROFESSIONAL_EMAIL"]),
    ...(person.phone && person.phone.status !== "CORPORATE_MAIN" && person.phone.status !== "UNCLASSIFIED" ? [] : ["DIRECT_OR_DEPARTMENT_PHONE"]),
    ...(person.facts.responsibilityConfirmed ? [] : ["COMMERCIAL_RESPONSIBILITY"]),
  ];
  return {
    state: "INDIVIDUAL", organization: input.organization, targetFunction: person.fn?.label ?? person.title ?? "—", person,
    professionalChannel: person.email && person.email.status !== "FOUND" ? person.email.address : person.phone && person.phone.status !== "CORPORATE_MAIN" && person.phone.status !== "UNCLASSIFIED" ? person.phone.number : null,
    alternativeChannel: fallback, authority: human ? "CONFIRMED_BY_HUMAN" : person.facts.responsibilityConfirmed ? "CONFIRMED_BY_EVIDENCE" : "NOT_CONFIRMED",
    missing, nextAction: person.nextAction,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Actionable commercial route: who to ask for, on which line, which department, which question.

/** A. person's direct line · B. corporate extension · C. department/office line · D. company main line · E. none found. */
export type PhoneClass = "A_DIRECT" | "B_EXTENSION" | "C_DEPARTMENT" | "D_MAIN" | "E_NOT_FOUND";
export type RouteInstruction = "CALL_PERSON" | "CALL_OFFICE_ASK_PERSON" | "CALL_DEPARTMENT_ASK_PERSON" | "ASK_CENTRAL_FOR_PERSON" | "ASK_CENTRAL_FOR_FUNCTION" | "USE_SUPPLIER_PROCESS" | "FIND_CHANNEL";

export interface ActionableRoute {
  readonly person: PersonGroup | null;
  readonly responsibility: { readonly kind: "HUMAN" | "EVIDENCE"; readonly text: string; readonly sourceUrl: string | null } | null;
  readonly phone: { readonly number: string; readonly label: string | null; readonly sourceUrl: string | null; readonly matchedOffice: boolean } | null;
  readonly phoneClass: PhoneClass;
  readonly alternative: CorporateChannel | null;
  readonly department: string;
  readonly departmentEvidence: { readonly quote: string; readonly url: string } | null;
  readonly instruction: RouteInstruction;
  readonly verified: readonly string[];
  readonly pending: readonly string[];
}

const DEFAULT_DEPARTMENT: Record<OrganizationType, string> = {
  ELECTRICAL_CONSTRUCTION: "FIELD_OPERATIONS_MANPOWER", STAFFING_AGENCY: "BRANCH_OFFICE", INDUSTRIAL_CONTRACTOR: "PROCUREMENT_SUBCONTRACTS", PUBLIC_PROCUREMENT: "PURCHASING", GENERAL: "PROCUREMENT",
};
const GENERIC_LABEL = new Set(["staffing", "agency", "office", "offices", "branch", "location", "locations", "inc", "llc", "constructors", "construction", "group", "the", "of", "and", "phone", "texas", "tx", "la", "louisiana", "temp", "temporary", "services", "company", "corporate", "contact", "us"]);

/** An office/branch line is tied to a person only when every distinctive word of the office name appears in that person's own evidence. */
export function officeForPerson(person: PersonGroup, channels: readonly CorporateChannel[], organization: string): CorporateChannel | null {
  const orgWords = new Set(normalizePerson(organization).split(" "));
  const evidence = normalizePerson([person.location, ...person.titles, ...person.sources.map((source) => source.quote ?? "")].filter(Boolean).join(" "));
  const words = new Set(evidence.split(" "));
  return channels.find((channel) => {
    if (channel.kind !== "PHONE_ROUTE" || !channel.label || !["OFFICE", "DEPARTMENT"].includes(channel.phoneKind ?? "")) return false;
    const distinctive = normalizePerson(channel.label).split(" ").filter((word) => word.length >= 4 && !GENERIC_LABEL.has(word) && !orgWords.has(word));
    return distinctive.length > 0 && distinctive.every((word) => words.has(word));
  }) ?? null;
}

export function actionableRoute(input: {
  readonly organization: string; readonly type: OrganizationType; readonly people: readonly PersonGroup[]; readonly channels: readonly CorporateChannel[];
  readonly departmentEvidence: readonly { readonly quote: string; readonly url: string }[];
}): ActionableRoute {
  // When the organization's own site names the buying department, a person from another function (e.g. a Project
  // Manager when Procurement handles subcontracts) is not presented as the target: the route is departmental.
  const BUYING_FUNCTIONS: readonly ContactFunction[] = ["PROCUREMENT", "SUBCONTRACTS", "SUPPLIER_MANAGEMENT"];
  const candidate = input.people.find((item) => item.facts.relevant) ?? null;
  const person = candidate && input.departmentEvidence.length && candidate.state !== "COMMERCIAL_RESPONSIBILITY_CONFIRMED"
    && !BUYING_FUNCTIONS.includes(candidate.fn?.contactFunction ?? "OTHER") ? null : candidate;
  const usable = input.channels.filter((channel) => channel.kind === "PHONE_ROUTE" && channel.phoneKind !== "NON_COMMERCIAL" && channel.phoneKind !== "FAX");
  const human = person?.interactions.find((item) => item.personReached && item.handlesExternalWorkforce === "YES") ?? null;
  const documented = person?.sources.find((source) => source.responsibilityEvidence) ?? null;
  const responsibility = human ? { kind: "HUMAN" as const, text: human.notes ?? human.responsibleDepartment ?? "", sourceUrl: null }
    : documented ? { kind: "EVIDENCE" as const, text: documented.responsibilityEvidence!, sourceUrl: documented.sourceUrl } : null;

  let phone: ActionableRoute["phone"] = null;
  let phoneClass: PhoneClass = "E_NOT_FOUND";
  const own = person?.phone;
  const office = person ? officeForPerson(person, usable, input.organization) : null;
  const department = usable.find((channel) => channel.phoneKind === "DEPARTMENT") ?? null;
  const main = usable.find((channel) => channel.phoneKind === "MAIN") ?? null;
  const otherOffice = usable.find((channel) => channel.phoneKind === "OFFICE") ?? usable.find((channel) => channel.phoneKind === "UNKNOWN") ?? null;
  if (own && own.base === "DIRECT_PROFESSIONAL") { phone = { number: own.number, label: null, sourceUrl: null, matchedOffice: false }; phoneClass = "A_DIRECT"; }
  else if (own && own.base === "CORPORATE_EXTENSION") { phone = { number: own.number, label: null, sourceUrl: null, matchedOffice: false }; phoneClass = "B_EXTENSION"; }
  else if (own && own.base === "DEPARTMENT") { phone = { number: own.number, label: null, sourceUrl: null, matchedOffice: false }; phoneClass = "C_DEPARTMENT"; }
  else if (office) { phone = { number: office.value, label: office.label, sourceUrl: office.sourceUrl, matchedOffice: true }; phoneClass = "C_DEPARTMENT"; }
  else if (department) { phone = { number: department.value, label: department.label, sourceUrl: department.sourceUrl, matchedOffice: false }; phoneClass = "C_DEPARTMENT"; }
  else if (main ?? otherOffice) { const line = (main ?? otherOffice)!; phone = { number: line.value, label: line.label, sourceUrl: line.sourceUrl, matchedOffice: false }; phoneClass = main ? "D_MAIN" : "C_DEPARTMENT"; }

  const alternative = buyerPath({ organization: input.organization, people: [], channels: input.channels.filter((channel) => channel.value !== phone?.number), functions: [], sourcesChecked: 0 });
  const evidence = input.departmentEvidence[0] ?? null;
  // Department evidence always describes how the organization buys (registration, qualification or the group that buys).
  const portal = Boolean(evidence);
  const instruction: RouteInstruction = phoneClass === "A_DIRECT" || phoneClass === "B_EXTENSION" ? "CALL_PERSON"
    : phoneClass === "C_DEPARTMENT" && phone?.matchedOffice ? "CALL_OFFICE_ASK_PERSON"
    : phoneClass === "C_DEPARTMENT" ? (person ? "CALL_DEPARTMENT_ASK_PERSON" : "ASK_CENTRAL_FOR_FUNCTION")
    : phoneClass === "D_MAIN" ? (person ? "ASK_CENTRAL_FOR_PERSON" : "ASK_CENTRAL_FOR_FUNCTION")
    : portal ? "USE_SUPPLIER_PROCESS" : "FIND_CHANNEL";
  const verified = [
    ...(person ? ["PERSON_NAMED"] : []),
    ...(person?.currency === "CURRENT" ? ["CURRENT_SOURCE"] : []),
    ...(person?.fn ? ["TITLE_IN_TARGET_FUNCTION"] : []),
    ...(phoneClass === "A_DIRECT" || phoneClass === "B_EXTENSION" || (phoneClass === "C_DEPARTMENT" && own) ? ["PERSON_PHONE_PUBLISHED"] : []),
    ...(phone?.matchedOffice ? ["OFFICE_LINE_PUBLISHED"] : []),
    ...(phoneClass === "D_MAIN" || (phoneClass === "C_DEPARTMENT" && !own && !phone?.matchedOffice) ? ["CORPORATE_LINE_PUBLISHED"] : []),
    ...(person?.email && person.email.status !== "FOUND" ? ["PERSON_EMAIL_PUBLISHED"] : []),
    ...(evidence ? ["DEPARTMENT_EVIDENCE"] : []),
    ...(responsibility ? [responsibility.kind === "HUMAN" ? "RESPONSIBILITY_HUMAN" : "RESPONSIBILITY_EVIDENCE"] : []),
  ];
  const pending = [
    ...(!person ? ["NAMED_PERSON"] : person.currency !== "CURRENT" && !person.interactions.some((item) => item.personReached) ? ["CURRENT_ROLE"] : []),
    ...(!responsibility ? ["RESPONSIBILITY"] : []),
    ...(phoneClass !== "A_DIRECT" ? ["DIRECT_LINE"] : []),
    ...(!person?.email || person.email.status === "FOUND" ? ["PROFESSIONAL_EMAIL"] : []),
  ];
  return {
    person, responsibility, phone, phoneClass, alternative: alternative.state === "NO_INDIVIDUAL_BUYER_IDENTIFIED" ? alternative.fallback : null,
    department: evidence && input.type !== "STAFFING_AGENCY" && input.type !== "PUBLIC_PROCUREMENT" ? "PROCUREMENT_SUBCONTRACTS" : DEFAULT_DEPARTMENT[input.type],
    departmentEvidence: evidence, instruction, verified, pending,
  };
}
