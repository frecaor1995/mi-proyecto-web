import { createHash } from "node:crypto";
import type { ContactFunction } from "./contact";
import type { SignalCategory } from "./discovery-coverage";

/**
 * Contact intelligence for one qualified signal. Everything here is derived from source text the Radar holds
 * (search snippet, retrieved original page, retrieved official pages). Nothing is invented: a contact exists only
 * if a source contains it, and each state (discovered / attributed / technically validated / human confirmed)
 * is tracked separately. A job title is never treated as proof of contracting authority.
 */
export type OrganizationRole = "OWNER" | "GENERAL_CONTRACTOR" | "SUBCONTRACTOR" | "STAFFING_PROVIDER" | "PROCUREMENT_AUTHORITY" | "UNKNOWN";
export type ContactProviderId = "SIGNAL_SOURCE" | "OFFICIAL_WEBSITE" | "PUBLIC_PROCUREMENT_DOCUMENT" | "HUNTER_DOMAIN_SEARCH" | "WEB_SEARCH_RESULT";
export type PhoneKind = "MAIN" | "DEPARTMENT" | "DIRECT" | "UNKNOWN";

export interface OrganizationIdentity {
  readonly name: string | null;
  readonly officialDomain: string | null;
  /** How the official domain was established (quoted evidence), or null. */
  readonly domainBasis: string | null;
  readonly role: OrganizationRole;
  readonly roleBasis: string;
  readonly project: string | null;
}

export interface TargetFunction {
  readonly contactFunction: ContactFunction;
  readonly label: string;
  /** Official-site paths worth checking for this function (bounded list). */
  readonly paths: readonly string[];
}

export interface ExtractedContact {
  readonly identityKey: string;
  readonly kind: "PERSON" | "MAILBOX" | "PHONE_ROUTE";
  readonly personName: string | null;
  readonly title: string | null;
  readonly contactFunction: ContactFunction;
  readonly email: string | null;
  readonly phone: string | null;
  readonly phoneKind: PhoneKind | null;
  readonly quote: string;
  readonly attributed: boolean;
  readonly attributionBasis: string | null;
}

export interface SourceDocument {
  readonly url: string;
  readonly provider: ContactProviderId;
  readonly text: string;
  /** Source is published by the organization itself (its own domain, or the public body's own site). */
  readonly official: boolean;
}

// ---------------------------------------------------------------------------------------------------------

const ENTITY_SUFFIX = /\b(inc|llc|l\.l\.c|corp|corporation|co|company|ltd|lp|group|constructors|construction|contractors|contracting|services|industries|electric|electrical|engineering)\.?$/i;
const STOP = new Set(["the", "of", "and", "county", "city", "port", "inc", "llc", "group", "company"]);

/** Distinctive tokens of an organization name ("MMR Constructors, Inc" -> ["mmr"]). */
export function nameTokens(name: string): readonly string[] {
  let base = name.toLowerCase().replace(/[.,]/g, " ").trim();
  for (let index = 0; index < 3; index += 1) base = base.replace(ENTITY_SUFFIX, "").trim();
  return base.split(/\s+/).filter((token) => token.length >= 3 && !STOP.has(token));
}

export const registrableDomain = (host: string) => {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const tail = parts.slice(-3).join(".");
  return /\.(tx|la|al|ok|nm)\.us$|\.(co|com|org|gov)\.[a-z]{2}$/.test(tail) ? tail : parts.slice(-2).join(".");
};

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };

/**
 * Official domain, only with evidence: the source is the organization's own site (its name token is in the
 * domain), a public body's .gov site, or a stored search result whose title names the organization on a
 * domain carrying its name token (e.g. "MMR Group | Home" on mmrgrp.com).
 */
export function resolveOfficialDomain(input: {
  readonly organization: string | null;
  readonly sourceUrl: string;
  readonly publicBody: boolean;
  readonly knownPages: readonly { readonly url: string; readonly title: string }[];
}): { readonly domain: string | null; readonly basis: string | null } {
  if (!input.organization) return { domain: null, basis: null };
  const tokens = nameTokens(input.organization);
  const host = hostOf(input.sourceUrl);
  const label = registrableDomain(host).split(".")[0];
  if (input.publicBody && /\.gov$|\.us$/.test(host)) return { domain: registrableDomain(host), basis: `The notice is published on the public body's own site (${host}).` };
  if (tokens.some((token) => label.includes(token))) return { domain: registrableDomain(host), basis: `The source is published on ${host}, which carries the organization's name.` };
  for (const page of input.knownPages) {
    const pageHost = hostOf(page.url);
    const pageLabel = registrableDomain(pageHost).split(".")[0];
    const titleNames = tokens.length > 0 && tokens.every((token) => page.title.toLowerCase().includes(token));
    if (titleNames && tokens.some((token) => pageLabel.includes(token)) && !/(linkedin|facebook|zoominfo|leadiq|highwire|bloomberg|glassdoor|indeed|roaddogjobs|energyjobshop|tealhq|zabalist|constructconnect)/.test(pageHost)) {
      return { domain: registrableDomain(pageHost), basis: `A discovered result titled "${page.title.slice(0, 80)}" is published on ${pageHost}.` };
    }
  }
  return { domain: null, basis: null };
}

export function organizationRole(input: { readonly category: SignalCategory | null; readonly publicBody: boolean; readonly organization: string | null; readonly text: string }): { readonly role: OrganizationRole; readonly basis: string } {
  if (!input.organization) return { role: "UNKNOWN", basis: "No organization is identified by the source." };
  const name = input.organization.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const near = (pattern: string) => new RegExp(`${name}[^.]{0,60}\\b(?:${pattern})\\b|\\b(?:${pattern})\\b[^.]{0,20}${name}`, "i").test(input.text);
  if (input.category === "PROCUREMENT_BID" && input.publicBody) return { role: "PROCUREMENT_AUTHORITY", basis: "The organization issues the solicitation." };
  if (/\b(staffing|manpower|labor services|workforce solutions)\b/i.test(input.organization)) return { role: "STAFFING_PROVIDER", basis: "The organization name identifies a staffing/labor provider." };
  if (near("general contractor|GC|prime contractor")) return { role: "GENERAL_CONTRACTOR", basis: "The source names it as the general contractor." };
  if (near("owner|developer|owned by")) return { role: "OWNER", basis: "The source names it as the owner/developer." };
  if (near("subcontractor|electrical contractor|mechanical contractor|specialty contractor")) return { role: "SUBCONTRACTOR", basis: "The source names it as a trade/specialty contractor." };
  if (input.category === "DIRECT_HIRING") return { role: "UNKNOWN", basis: "Named as the employer in a job posting — that does not establish its role on any project." };
  return { role: "UNKNOWN", basis: "The source names the organization but not its role on the project." };
}

const FUNCTIONS: Record<string, readonly TargetFunction[]> = {
  MANPOWER_REQUEST: [
    { contactFunction: "PROCUREMENT", label: "Procurement", paths: ["/procurement", "/suppliers"] },
    { contactFunction: "SUPPLIER_MANAGEMENT", label: "Vendor management", paths: ["/vendors", "/suppliers"] },
    { contactFunction: "SUBCONTRACTS", label: "Subcontractor management", paths: ["/subcontractors", "/trade-partners"] },
    { contactFunction: "OPERATIONS", label: "Operations", paths: ["/contact", "/contact-us"] },
    { contactFunction: "PROJECT_MANAGEMENT", label: "Project management", paths: ["/projects"] },
  ],
  SUBCONTRACTOR_VENDOR: [
    { contactFunction: "SUBCONTRACTS", label: "Subcontractor management / trade partners", paths: ["/trade-partners", "/subcontractors"] },
    { contactFunction: "PROCUREMENT", label: "Procurement", paths: ["/procurement", "/suppliers"] },
    { contactFunction: "SUPPLIER_MANAGEMENT", label: "Vendor management", paths: ["/vendors"] },
    { contactFunction: "PROJECT_MANAGEMENT", label: "Project management", paths: ["/projects"] },
  ],
  PROCUREMENT_BID: [
    { contactFunction: "PROCUREMENT", label: "Purchasing agent / procurement office / solicitation contact", paths: ["/purchasing", "/procurement", "/bids"] },
  ],
  PROJECT_DEMAND: [
    { contactFunction: "PROJECT_MANAGEMENT", label: "Project executive / project manager", paths: ["/projects"] },
    { contactFunction: "CONSTRUCTION_MANAGEMENT", label: "General contractor / construction management", paths: ["/contact", "/contact-us"] },
    { contactFunction: "SUBCONTRACTS", label: "Procurement / trade partners", paths: ["/trade-partners", "/subcontractors", "/suppliers"] },
  ],
  DIRECT_HIRING: [
    { contactFunction: "TALENT_ACQUISITION", label: "Talent acquisition", paths: ["/careers"] },
    { contactFunction: "RECRUITER", label: "Recruiting", paths: ["/careers", "/jobs"] },
    { contactFunction: "WORKFORCE", label: "Workforce management", paths: ["/careers"] },
  ],
};
const GENERAL: readonly TargetFunction[] = [{ contactFunction: "GENERAL_OFFICE", label: "General office", paths: ["/contact", "/contact-us"] }];

export const targetFunctions = (category: SignalCategory | null): readonly TargetFunction[] => (category ? FUNCTIONS[category] ?? GENERAL : GENERAL);

// ---------------------------------------------------------------------------------------------------------
// Extraction from source text

const TITLES = "(?:Assistant\\s+)?(?:Purchasing (?:Agent|Manager|Director|Coordinator)|Buyer|Procurement (?:Officer|Manager|Specialist|Director|Coordinator)|Contracts? (?:Specialist|Administrator|Manager)|Subcontracts? (?:Manager|Administrator)|Vendor (?:Manager|Relations)|Project (?:Executive|Manager|Director)|Recruiter|Talent Acquisition(?: (?:Manager|Specialist|Partner))?|HR (?:Manager|Director|Generalist)|Human Resources (?:Manager|Director)|Superintendent|Estimator|Business Development (?:Manager|Director)|Operations Manager)";
const PERSON_TITLE = new RegExp(String.raw`\b([A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?)\s*,\s*(` + TITLES + String.raw`)\b`, "g");
const TITLE_PERSON = new RegExp(String.raw`\b(` + TITLES + String.raw`)\s*[:\-–]\s*([A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+)\b`, "g");
const LABELLED = /\bContact(?:\s+Person)?\s*:\s*([A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+)/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?1[-.\s]?)?\(?\b(\d{3})\)?[-.\s]?(\d{3})[-.\s](\d{4})\b/g;
const NOT_EMAIL = /\.(png|jpe?g|gif|svg|webp)$|example\.(com|org)$|sentry|wixpress|noreply|no-reply/i;

export function titleFunction(title: string | null): ContactFunction {
  if (!title) return "OTHER";
  if (/purchasing|buyer|procurement|solicitation/i.test(title)) return "PROCUREMENT";
  if (/subcontract/i.test(title)) return "SUBCONTRACTS";
  if (/vendor|supplier/i.test(title)) return "SUPPLIER_MANAGEMENT";
  if (/recruit/i.test(title)) return "RECRUITER";
  if (/talent/i.test(title)) return "TALENT_ACQUISITION";
  if (/\bhr\b|human resources/i.test(title)) return "HR";
  if (/project/i.test(title)) return "PROJECT_MANAGEMENT";
  if (/superintendent/i.test(title)) return "CONSTRUCTION_MANAGEMENT";
  if (/operations/i.test(title)) return "OPERATIONS";
  return "OTHER";
}

export function mailboxFunction(email: string): ContactFunction {
  const local = email.split("@")[0].toLowerCase();
  if (/purchas|procure|bids?$|rfp|solicit/.test(local)) return "PROCUREMENT";
  if (/subcontract|tradepartner|trade\.partner/.test(local)) return "SUBCONTRACTS";
  if (/vendor|supplier/.test(local)) return "SUPPLIER_MANAGEMENT";
  if (/career|jobs?$|recruit|talent/.test(local)) return "TALENT_ACQUISITION";
  if (/^hr$|humanresources/.test(local)) return "HR";
  if (/^(info|contact|office|hello|admin|reception)$/.test(local)) return "GENERAL_OFFICE";
  return "OTHER";
}

const clip = (text: string, index: number, length: number) => text.slice(Math.max(0, index - 90), Math.min(text.length, index + length + 90)).replace(/\s+/g, " ").trim();
const keyOf = (...parts: (string | null)[]) => createHash("sha256").update(parts.map((part) => (part ?? "").toLowerCase().replace(/\s+/g, " ").trim()).join("|")).digest("hex");
const normalizePhone = (match: RegExpMatchArray) => `(${match[1]}) ${match[2]}-${match[3]}`;

/** Tidy PDF/HTML text: "409 - 835 - 8593" -> "409-835-8593", "West , Assistant" -> "West, Assistant". */
export const tidySourceText = (text: string) => text.replace(/\s+/g, " ").replace(/(\d) - (\d)/g, "$1-$2").replace(/ ,/g, ",");

/** Context preceding a phone number: what kind of line the source says it is. */
export function phoneKind(before: string, nearPerson: boolean): PhoneKind | "FAX" | "NON_COMMERCIAL" {
  if (/fax\s*[:#]?\s*$/i.test(before.slice(-12))) return "FAX";
  if (/\b(sms|text (?:help|stop)|text message|helpdesk|help desk|technical support|it support|mobile subscriptions?)\b/i.test(before)) return "NON_COMMERCIAL";
  if (/\b(headquarters|toll[- ]free|corporate office|main office)\b/i.test(before)) return "MAIN";
  if (nearPerson) return "DIRECT";
  if (/(purchasing|procurement|human resources|\bhr\b|careers|recruiting|accounts payable|vendor)[^.]{0,30}$/i.test(before)) return "DEPARTMENT";
  if (/(main|office|tel(?:ephone)?|phone|call(?: us)?)\s*[:#]?\s*$/i.test(before.slice(-25))) return "MAIN";
  return "UNKNOWN";
}

/**
 * Contacts a source actually contains. Emails/phones are attached to a person only when they appear in the same
 * sentence as that person; otherwise they are mailboxes / phone routes of the organization.
 */
export function extractContacts(document: SourceDocument, organization: OrganizationIdentity): readonly ExtractedContact[] {
  const text = tidySourceText(document.text);
  const officialDomains = new Set([organization.officialDomain, document.official ? registrableDomain(hostOf(document.url)) : null].filter(Boolean) as string[]);
  const attributionFor = (email: string | null, personNamed: boolean): { attributed: boolean; basis: string | null } => {
    const domain = email ? registrableDomain(email.split("@")[1] ?? "") : null;
    if (domain && officialDomains.has(domain)) return { attributed: true, basis: `The email domain ${domain} is the organization's official domain.` };
    if (document.official) return { attributed: true, basis: personNamed ? "Named in the organization's own published document." : "Published on the organization's own site/document." };
    return { attributed: false, basis: null };
  };
  const people: { name: string; title: string | null; index: number; length: number }[] = [];
  for (const match of text.matchAll(PERSON_TITLE)) people.push({ name: match[1], title: match[2], index: match.index ?? 0, length: match[0].length });
  for (const match of text.matchAll(TITLE_PERSON)) people.push({ name: match[2], title: match[1], index: match.index ?? 0, length: match[0].length });
  for (const match of text.matchAll(LABELLED)) people.push({ name: match[1], title: null, index: match.index ?? 0, length: match[0].length });

  const sentenceOf = (index: number) => {
    const start = Math.max(text.lastIndexOf(". ", index) + 1, index - 220);
    const endDot = text.indexOf(". ", index);
    return { start, end: endDot < 0 ? Math.min(text.length, index + 220) : Math.min(endDot, index + 220) };
  };
  const used = new Set<number>();
  const results = new Map<string, ExtractedContact>();
  const add = (contact: Omit<ExtractedContact, "identityKey">) => {
    const identityKey = keyOf(contact.personName, contact.email, contact.phone, contact.personName || contact.email || contact.phone ? null : contact.quote);
    if (!results.has(identityKey)) results.set(identityKey, { ...contact, identityKey });
  };

  const emails = [...text.matchAll(EMAIL)].filter((match) => !NOT_EMAIL.test(match[0]));
  const phones = [...text.matchAll(PHONE)];
  for (const person of people) {
    const sentence = sentenceOf(person.index);
    const email = emails.find((match) => (match.index ?? 0) >= sentence.start && (match.index ?? 0) <= sentence.end);
    const phone = phones.find((match) => (match.index ?? 0) >= sentence.start && (match.index ?? 0) <= sentence.end && !["FAX", "NON_COMMERCIAL"].includes(phoneKind(text.slice(Math.max(0, (match.index ?? 0) - 60), match.index), true)));
    if (email) used.add(email.index ?? -1);
    if (phone) used.add(phone.index ?? -1);
    const attribution = attributionFor(email?.[0].toLowerCase() ?? null, true);
    add({ kind: "PERSON", personName: person.name, title: person.title, contactFunction: titleFunction(person.title), email: email?.[0].toLowerCase() ?? null,
      phone: phone ? normalizePhone(phone) : null, phoneKind: phone ? "DIRECT" : null, quote: clip(text, person.index, person.length), attributed: attribution.attributed, attributionBasis: attribution.basis });
  }
  for (const match of emails) {
    if (used.has(match.index ?? -1)) continue;
    const email = match[0].toLowerCase();
    const attribution = attributionFor(email, false);
    add({ kind: "MAILBOX", personName: null, title: null, contactFunction: mailboxFunction(email), email, phone: null, phoneKind: null,
      quote: clip(text, match.index ?? 0, match[0].length), attributed: attribution.attributed, attributionBasis: attribution.basis });
  }
  for (const match of phones) {
    if (used.has(match.index ?? -1)) continue;
    const kind = phoneKind(text.slice(Math.max(0, (match.index ?? 0) - 60), match.index), false);
    if (kind === "FAX" || kind === "NON_COMMERCIAL") continue;
    const attribution = attributionFor(null, false);
    const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index);
    add({ kind: "PHONE_ROUTE", personName: null, title: null, contactFunction: kind === "DEPARTMENT" ? (/purchas|procure/i.test(before) ? "PROCUREMENT" : /career|recruit|human|hr/i.test(before) ? "HR" : "OTHER") : "GENERAL_OFFICE",
      email: null, phone: normalizePhone(match), phoneKind: kind, quote: clip(text, match.index ?? 0, match[0].length), attributed: attribution.attributed, attributionBasis: attribution.basis });
  }
  return [...results.values()];
}

// ---------------------------------------------------------------------------------------------------------
// States and prioritization

export type ValidationResult = "VALID" | "INVALID" | "RISKY" | "UNKNOWN" | "FAILED";
export interface CandidateStates {
  readonly discovered: true;
  readonly attributed: boolean;
  readonly emailValidation: ValidationResult | null;
  readonly phoneValidation: ValidationResult | null;
  readonly humanDecision: "SELECTED_FOR_FOLLOW_UP" | "CONFIRMED" | "REJECTED" | null;
}

/** Transparent ordering reason (no scores). Lower rank = review first. */
export function priorityReason(candidate: { readonly kind: string; readonly contactFunction: ContactFunction; readonly provider: ContactProviderId; readonly personName: string | null; readonly historical: boolean }, targets: readonly TargetFunction[]): { readonly rank: number; readonly reason: string } {
  const wanted = targets.some((target) => target.contactFunction === candidate.contactFunction);
  if (candidate.provider === "PUBLIC_PROCUREMENT_DOCUMENT" && candidate.personName && candidate.contactFunction === "PROCUREMENT") return { rank: 1, reason: "Named procurement contact in an official solicitation document." };
  if (candidate.kind === "MAILBOX" && wanted) return { rank: 2, reason: "Department mailbox for a target function, published by the organization." };
  if (candidate.personName && wanted) return { rank: 3, reason: "Named person whose documented title matches a target function." };
  if (candidate.kind === "PHONE_ROUTE" && candidate.contactFunction !== "GENERAL_OFFICE") return { rank: 4, reason: "Department phone line published by the organization." };
  if (candidate.personName) return { rank: 5, reason: "Named person; title does not match a target function." };
  if (candidate.contactFunction === "GENERAL_OFFICE") return { rank: 6, reason: "General office route — use to reach the target department." };
  return { rank: 7, reason: "Contact route with no documented function." };
}

/** NANP structure check only. It never establishes that a number is active or who it belongs to. */
/**
 * Read-time label for a stored phone route, recomputed from its stored source quote with the current rules
 * (stored candidates are append-only; this keeps the display correct without rewriting history).
 */
export function phoneKindFromQuote(quote: string | null, phone: string | null, stored: PhoneKind | null): PhoneKind | "NON_COMMERCIAL" | null {
  if (!quote || !phone) return stored;
  const text = tidySourceText(quote);
  const digits = phone.replace(/\D/g, "");
  const match = [...text.matchAll(PHONE)].find((item) => `${item[1]}${item[2]}${item[3]}` === digits.slice(-10));
  if (!match) return stored;
  const kind = phoneKind(text.slice(Math.max(0, (match.index ?? 0) - 60), match.index), stored === "DIRECT");
  return kind === "FAX" ? stored : kind;
}

export const phoneFormatValid = (phone: string) => /^\(?[2-9]\d{2}\)?[-.\s]?[2-9]\d{2}[-.\s]?\d{4}$/.test(phone.replace(/^\+?1\s*/, "").trim());
