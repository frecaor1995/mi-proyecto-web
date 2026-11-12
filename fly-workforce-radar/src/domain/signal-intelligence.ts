import { responseDeadlineFrom, type PageEvidence, type SourceQualification } from "./commercial-qualification";
import { DISCOVERY_TRADE_CATEGORIES, type ProfessionEvidence } from "./discovery-coverage";

/**
 * Commercial intelligence record for one signal. Every field is extracted only from what the source states
 * (search snippet, retrieved original page, or the page's structured data), with its origin and the quoted
 * text. Nothing is inferred from the search query, and absent values stay UNKNOWN.
 */
export type FieldStatus = "SUPPORTED" | "REQUIRES_CONFIRMATION" | "UNKNOWN";
export type FieldOrigin = "SNIPPET" | "ORIGINAL_PAGE" | "STRUCTURED_DATA" | "SEARCH_PROVIDER";

export const INTELLIGENCE_FIELDS = [
  "company", "project", "profession", "specialty", "location", "headcount", "experience", "licenses", "certifications", "schedule",
  "startDate", "duration", "hourlyRate", "perDiem", "travel", "supplierEligibility", "responseDeadline",
  "contactName", "contactRole", "contactEmail", "contactPhone", "sourceUrl", "publicationDate",
] as const;
export type IntelligenceFieldKey = (typeof INTELLIGENCE_FIELDS)[number];

export interface IntelligenceField {
  readonly status: FieldStatus;
  readonly value: string | null;
  readonly origin: FieldOrigin | null;
  /** The source text the value was read from (null when the value is not a quotation). */
  readonly quote: string | null;
  readonly note?: string;
}

export type SupplierEligibility = "EXPLICIT" | "UNCONFIRMED" | "EXCLUDED";
export type NextActionKind = "MANPOWER" | "VENDOR" | "PROCUREMENT" | "PROJECT" | "DIRECT_HIRING" | "INSUFFICIENT" | "EXPIRED" | "NOISE" | "VERIFIED" | "REJECTED";

export interface CommercialIntelligence {
  readonly fields: Readonly<Record<IntelligenceFieldKey, IntelligenceField>>;
  readonly supplierEligibility: SupplierEligibility;
  readonly missing: readonly IntelligenceFieldKey[];
  readonly nextAction: NextActionKind;
}

export interface IntelligenceInput {
  readonly url: string;
  readonly snippet: string;
  readonly page: PageEvidence | null;
  readonly qualification: SourceQualification;
  readonly professions: readonly ProfessionEvidence[];
  readonly location: string | null;
  readonly providerPublicationDate: string | null;
  readonly status: "NEW" | "NEEDS_REVIEW" | "VERIFIED" | "REJECTED" | "PROMOTED";
}

const UNKNOWN: IntelligenceField = { status: "UNKNOWN", value: null, origin: null, quote: null };
const quoteAround = (text: string, index: number, length: number) => text.slice(Math.max(0, index - 60), Math.min(text.length, index + length + 60)).replace(/\s+/g, " ").trim();

/** Find a pattern in the snippet first, then in the original page; returns value, origin and quote. */
function find(sources: readonly { readonly origin: FieldOrigin; readonly text: string }[], pattern: RegExp, pick: (match: RegExpMatchArray) => string | null = (match) => match[0]): IntelligenceField {
  for (const source of sources) {
    const match = source.text.match(pattern);
    if (match && match.index !== undefined) {
      const value = pick(match)?.replace(/\s+/g, " ").trim();
      if (value) return { status: "SUPPORTED", value, origin: source.origin, quote: quoteAround(source.text, match.index, match[0].length) };
    }
  }
  return UNKNOWN;
}

function findAll(sources: readonly { readonly origin: FieldOrigin; readonly text: string }[], pattern: RegExp): IntelligenceField {
  for (const source of sources) {
    const values = [...new Set([...source.text.matchAll(pattern)].map((match) => match[0].replace(/\s+/g, " ").trim()))];
    if (values.length) {
      const first = source.text.search(pattern);
      return { status: "SUPPORTED", value: values.slice(0, 6).join(" · "), origin: source.origin, quote: quoteAround(source.text, first, values[0].length) };
    }
  }
  return UNKNOWN;
}

const MONTHS = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?\\s+\\d{1,2},?\\s+\\d{4}";
const HEADCOUNT = /\b(\d{1,4})\s+(?:[a-z]+\s)?(?:workers?|electricians?|apprentices?|helpers?|foremen|welders?|pipefitters?|plumbers?|millwrights?|carpenters?|ironworkers?|riggers?|operators?|technicians?|laborers?|craftsmen|craft workers?)\b(?!\s+(?:jobs?|openings?|positions?|listings?|vacanc(?:y|ies)|employment|careers?)\b)|\b(?:headcount|crew size)\s*(?:of|:)?\s*(\d{1,4})\b/i;
const LICENSES = /\b(?:journeyman|master|apprentice|residential wireman|electrical contractor)\s+(?:electrician(?:'s)?\s+)?licen[sc]e\b|\bTDLR(?:\s+licen[sc]e)?\b|\b(?:plumbing|HVAC|ACR|electrical)\s+licen[sc]e\b|\bCDL(?:\s+Class\s+[AB])?\b/gi;
const CERTIFICATIONS = /\bOSHA[ -]?(?:10|30)\b|\bNCCER\b|\bAWS\s*D1\.\d\b|\b6G\b|\bTWIC\b|\bEPA\s*608\b|\bNFPA\s*70E\b|\bNCCCO\b|\bAPI\s*(?:510|570|653|1104)\b|\bforklift certifi\w+\b/gi;
const SCHEDULE = /\b\d{1,2}\s*[x×]\s*\d{1,2}s?\b|\b[5-7]\s*[-x]\s*(?:10|12)s\b|\b\d{2}\s*(?:hrs?|hours)\s*(?:\/|per)\s*(?:week|wk)\b|\b(?:day|night)\s+shift\b|\bmonday\s*(?:-|–|through|to)\s*(?:friday|saturday)\b/i;
const START = new RegExp(`\\b(?:start(?:s|ing)?(?:\\s+date)?|mobiliz\\w+)\\s*:?\\s*(?:on\\s+|in\\s+)?(immediately|asap|${MONTHS})`, "i");
const DURATION = /\b(\d{1,2}(?:\s*(?:-|to)\s*\d{1,2})?\s*(?:weeks?|months?))\s+(?:project|job|assignment|duration|turnaround|shutdown|outage)\b|\b(?:duration|length|assignment)\s*:?\s*(\d{1,2}(?:\s*(?:-|to)\s*\d{1,2})?\s*(?:weeks?|months?))/i;
const PAY = /\$\d+(?:\.\d{1,2})?(?:\s*(?:-|–|to)\s*\$?\d+(?:\.\d{1,2})?)?\s*(?:\/\s*|per\s+)(?:hr|hour)\b/i;
const PER_DIEM = /\$\d+(?:\.\d{1,2})?\s*(?:\/\s*day\s*)?(?:in\s+)?per\s*diem|per\s*diem\s*(?:of|:|is|at)?\s*\$\d+(?:\.\d{1,2})?(?:\s*\/\s*day)?|\bper\s*diem\s+(?:provided|available|paid|included|offered)\b/i;
const TRAVEL = /\b(?:travel required|willing to travel|must (?:be willing to )?travel|out[- ]of[- ]town work|travel(?:ing)? (?:work|jobs?|position|crews?))\b/i;
const SUPPLIER_EXCLUDED = /\b(?:no (?:staffing )?agencies|no recruiters|principals only|no third[- ]part(?:y|ies)|direct (?:applicants|hires?) only|agencies need not apply)\b/i;
const SUPPLIER_EXPLICIT = /\b(?:contract labor|manpower (?:services|suppliers?|providers?)|labor (?:supply|suppliers?|providers?)|staffing (?:partners?|agenc(?:y|ies)|suppliers?|vendors?)|sub-?contractors?|trade partners?|vendor registration|prequalification|invitation to bid|request for (?:proposals?|qualifications|quotes?)|statement of qualifications|sealed bids?)\b/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?<!fax[:\s]{0,3})(?<!\d)\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/i;
const CONTACT_ROLES = "Purchasing Agent|Purchasing Manager|Buyer|Procurement (?:Officer|Manager|Specialist)|Contracts? (?:Specialist|Administrator|Manager)|Project Manager|Recruiter|Talent Acquisition(?: \\w+)?|HR Manager|Superintendent|Estimator|Procurement Director";
const CONTACT = new RegExp(`\\b([A-Z][a-z]+(?:\\s+[A-Z]\\.)?\\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?),?\\s+(${CONTACT_ROLES})\\b`);
const CONTACT_LABEL = /\bContact(?:\s+Person)?\s*:\s*([A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+)/;

export function buildCommercialIntelligence(input: IntelligenceInput): CommercialIntelligence {
  const sources: { readonly origin: FieldOrigin; readonly text: string }[] = [{ origin: "SNIPPET", text: input.snippet }];
  if (input.page?.status === "FETCHED" && input.page.text) sources.push({ origin: "ORIGINAL_PAGE", text: input.page.text });
  const allText = sources.map((source) => source.text).join("\n");
  const posting = input.page?.status === "FETCHED" ? input.page.jobPosting : undefined;
  const q = input.qualification;
  const located = (value: string | null) => (value ? sources.find((source) => source.text.toLowerCase().includes(value.toLowerCase().slice(0, 40))) : undefined);
  const withSource = (value: string | null, fallbackStatus: FieldStatus = "REQUIRES_CONFIRMATION", note?: string): IntelligenceField => {
    if (!value) return UNKNOWN;
    const source = located(value);
    return source ? { status: "SUPPORTED", value, origin: source.origin, quote: quoteAround(source.text, source.text.toLowerCase().indexOf(value.toLowerCase().slice(0, 40)), value.length) }
      : { status: fallbackStatus, value, origin: null, quote: null, note };
  };

  const families = input.professions.map((profession) => DISCOVERY_TRADE_CATEGORIES.find((trade) => trade.id === profession.tradeCategoryId)).filter(Boolean);
  const occupationLabels = input.professions.flatMap((profession) => profession.occupationIds.map((id) => DISCOVERY_TRADE_CATEGORIES.flatMap((trade) => trade.occupations).find((occupation) => occupation.id === id)?.label ?? id));
  const explicitOccupation = input.professions.some((profession) => profession.occupationIds.length > 0);

  const company: IntelligenceField = posting?.hiringOrganization
    ? { status: "SUPPORTED", value: posting.hiringOrganization, origin: "STRUCTURED_DATA", quote: `hiringOrganization: ${posting.hiringOrganization}` }
    : withSource(q.organization, "REQUIRES_CONFIRMATION", "Identified from the site, not stated in the text");
  const location: IntelligenceField = posting?.locality
    ? { status: "SUPPORTED", value: [posting.locality, posting.region].filter(Boolean).join(", "), origin: "STRUCTURED_DATA", quote: `jobLocation: ${posting.locality}${posting.region ? `, ${posting.region}` : ""}` }
    : input.location ? withSource(input.location.split(",")[0]) .status === "SUPPORTED" ? { ...withSource(input.location.split(",")[0]), value: input.location } : { status: "SUPPORTED", value: input.location, origin: "SNIPPET", quote: null } : UNKNOWN;

  const deadline = responseDeadlineFrom(allText);
  const deadlineField: IntelligenceField = deadline
    ? { status: "SUPPORTED", value: deadline.date, origin: sources.find((source) => source.text.includes(deadline.text.slice(0, 30)))?.origin ?? "ORIGINAL_PAGE", quote: deadline.text,
      note: q.expiry?.basis === "RESPONSE_DEADLINE" ? "Deadline has passed" : undefined }
    : UNKNOWN;

  const eligibility: SupplierEligibility = SUPPLIER_EXCLUDED.test(allText) ? "EXCLUDED"
    : q.qualified && (q.category === "MANPOWER_REQUEST" || q.category === "SUBCONTRACTOR_VENDOR" || q.category === "PROCUREMENT_BID") && SUPPLIER_EXPLICIT.test(allText) ? "EXPLICIT" : "UNCONFIRMED";
  const eligibilityField: IntelligenceField = eligibility === "EXCLUDED" ? { ...find(sources, SUPPLIER_EXCLUDED), value: "Excluded by the source" }
    : eligibility === "EXPLICIT" ? { ...find(sources, SUPPLIER_EXPLICIT), value: "External submissions explicitly invited" }
    : { status: "REQUIRES_CONFIRMATION", value: "Not stated — confirm whether outside suppliers are accepted", origin: null, quote: null };

  const contactNamed = find(sources, CONTACT, (match) => match[1]);
  const contactLabel = contactNamed.status === "UNKNOWN" ? find(sources, CONTACT_LABEL, (match) => match[1]) : contactNamed;
  const role = contactNamed.status === "SUPPORTED" ? find(sources, CONTACT, (match) => match[2]) : UNKNOWN;
  const perDiem = find(sources, PER_DIEM);

  const publication: IntelligenceField = posting?.datePosted
    ? { status: "SUPPORTED", value: posting.datePosted.slice(0, 10), origin: "STRUCTURED_DATA", quote: `datePosted: ${posting.datePosted}` }
    : input.page?.documentDate ? { status: "REQUIRES_CONFIRMATION", value: input.page.documentDate, origin: "ORIGINAL_PAGE", quote: null, note: "Document creation date in the file metadata" }
    : input.providerPublicationDate ? { status: "REQUIRES_CONFIRMATION", value: input.providerPublicationDate.slice(0, 10), origin: "SEARCH_PROVIDER", quote: null, note: "Page date reported by the search provider" }
    : UNKNOWN;

  const fields: Record<IntelligenceFieldKey, IntelligenceField> = {
    company,
    project: withSource(q.project),
    profession: families.length ? { status: explicitOccupation ? "SUPPORTED" : "REQUIRES_CONFIRMATION", value: families.map((trade) => trade!.label).join(" · "), origin: null, quote: null,
      note: explicitOccupation ? undefined : "Trade scope stated; no specific occupation named" } : UNKNOWN,
    specialty: occupationLabels.length ? { status: "SUPPORTED", value: [...new Set(occupationLabels)].join(" · "), origin: null, quote: null } : UNKNOWN,
    location,
    headcount: find(sources, HEADCOUNT, (match) => match[1] ?? match[2] ?? null),
    experience: posting?.experience ? { status: "SUPPORTED", value: posting.experience, origin: "STRUCTURED_DATA", quote: null }
      : find(sources, /\b(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:[a-z]+\s){0,3}experience\b/i),
    licenses: findAll(sources, LICENSES),
    certifications: findAll(sources, CERTIFICATIONS),
    schedule: find(sources, SCHEDULE),
    startDate: find(sources, START, (match) => match[1]),
    duration: find(sources, DURATION, (match) => match[1] ?? match[2] ?? null),
    hourlyRate: find(sources, PAY).status === "SUPPORTED" ? find(sources, PAY)
      : posting?.salary ? { status: "SUPPORTED", value: posting.salary, origin: "STRUCTURED_DATA", quote: `baseSalary: ${posting.salary}` } : UNKNOWN,
    perDiem: perDiem.status === "SUPPORTED" && !/\$/.test(perDiem.value ?? "") ? { ...perDiem, status: "REQUIRES_CONFIRMATION", note: "Per diem mentioned; amount not stated" } : perDiem,
    travel: find(sources, TRAVEL),
    supplierEligibility: eligibilityField,
    responseDeadline: deadlineField,
    contactName: contactLabel,
    contactRole: role,
    contactEmail: find(sources, EMAIL),
    contactPhone: find(sources, PHONE),
    sourceUrl: { status: "SUPPORTED", value: input.url, origin: null, quote: null },
    publicationDate: publication,
  };
  const important: readonly IntelligenceFieldKey[] = ["company", "location", "profession", "headcount", "startDate", "duration", "hourlyRate", "supplierEligibility", "contactName", "contactEmail", "contactPhone", "publicationDate"];
  const missing = important.filter((key) => fields[key].status !== "SUPPORTED");

  const nextAction: NextActionKind = input.status === "REJECTED" ? "REJECTED"
    : input.status === "VERIFIED" || input.status === "PROMOTED" ? "VERIFIED"
    : q.noise === "EXPIRED" || q.expiry ? "EXPIRED"
    : q.noise ? "NOISE"
    : !q.qualified ? "INSUFFICIENT"
    : q.category === "MANPOWER_REQUEST" ? "MANPOWER" : q.category === "SUBCONTRACTOR_VENDOR" ? "VENDOR" : q.category === "PROCUREMENT_BID" ? "PROCUREMENT"
    : q.category === "PROJECT_DEMAND" ? "PROJECT" : "DIRECT_HIRING";
  return { fields, supplierEligibility: eligibility, missing, nextAction };
}
