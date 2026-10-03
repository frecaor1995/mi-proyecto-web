import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import type { SignalDetail } from "../opportunity-discovery/signals";
import {
  BUYER_FUNCTIONS, actionableRoute, buyerPath, normalizePerson, classifyOrganization, functionsFor, groupPeople, isPlausibleName, personKey,
  type ActionableRoute, type BuyerFunction, type BuyerPath, type CorporateChannel, type EvidenceCurrency, type HumanInteraction, type OrganizationType, type PersonEvidence, type PersonGroup, type SourceType,
} from "../../domain/buyer-intelligence";
import { extractContacts, phoneKindFromQuote, type ContactProviderId, type ExtractedContact, type PhoneKind } from "../../domain/contact-investigation";
import type { ContactFunction } from "../../domain/contact";
import { ContactService } from "../services/contact/contact-service";
import { PostgresContactRepository } from "../repositories/contact/postgres-contact-repository";
import { normalizeCompanyName } from "../services/company/company-name-normalization";
import { safeFetchSource } from "../source-enrichment/safe-fetch";
import { hunterDomainSearch, retrieveOfficialPages } from "./providers";
import { hunterCandidates, insertExtracted, organizationIdentityFor, runContactInvestigation } from "./investigation";
import { PAGE_PARSER_REVISION, PEOPLE_SEARCH_CACHE_DAYS, type PeopleSearchOutcome } from "./people-search";
import { runResearch, type ResearchMetrics } from "./research-engine";
import { corroboratePerson, procurementStatus, rankPeopleForResearch, researchCategory, phoneDigits, type PersonCorroboration, type PhoneAssociation, type PivotKind, type ProcurementStatus } from "../../domain/research-pivots";
import type { BraveSearchProvider } from "../company-discovery/brave-search-provider";

/**
 * Contact Intelligence 2.0 — one buyer investigation per subject. Entry A: a qualified Radar signal (its
 * organization). Entry B: a strategic company with no opportunity at all. Both share the same evidence tables.
 */
export type BuyerSubject =
  | { readonly kind: "SIGNAL"; readonly signal: SignalDetail; readonly normalizedUrl: string }
  | { readonly kind: "COMPANY"; readonly companyId: string };

export interface BuyerOrganization {
  readonly name: string;
  readonly officialDomain: string | null;
  readonly domainBasis: string | null;
  readonly type: OrganizationType;
  readonly typeSource: "OPERATOR" | "INFERRED";
  readonly location: string | null;
  readonly project: string | null;
  readonly companyId: string | null;
}

export interface CanonicalContact { readonly id: string; readonly name: string; readonly title: string | null; readonly contactFunction: string; readonly verificationState: string; readonly fromInvestigation: boolean; readonly firstSeenAt: string }

export interface ResearchPivotView { readonly id: string; readonly kind: PivotKind; readonly value: string; readonly parentId: string | null; readonly depth: number; readonly sourceUrl: string | null; readonly discoveredAt: string }
export interface ReferenceContact { readonly key: string; readonly name: string; readonly title: string | null; readonly phone: string | null; readonly association: PhoneAssociation; readonly via: readonly string[]; readonly sourceDomains: readonly string[] }
export interface ResearchView {
  readonly pivots: readonly ResearchPivotView[];
  /** Per person (PersonGroup.key): field corroboration and the discovery chain that led to the person. */
  readonly insights: Readonly<Record<string, { readonly corroboration: PersonCorroboration; readonly via: readonly string[] }>>;
  readonly procurement: ProcurementStatus;
  /** Named, sourced people Fly can mention or ask for when calling — never buyer status. */
  readonly referenceContacts: readonly ReferenceContact[];
  readonly channelEvidence: readonly { readonly phone: string; readonly note: string; readonly url: string }[];
  readonly usage: { readonly queries: number; readonly pages: number; readonly pivots: number };
}

const EMPTY_RESEARCH: ResearchView = { pivots: [], insights: {}, procurement: procurementStatus([]), referenceContacts: [], channelEvidence: [], usage: { queries: 0, pages: 0, pivots: 0 } };

export interface BuyerInvestigationView {
  readonly organization: BuyerOrganization;
  readonly functions: readonly { readonly id: string; readonly label: string; readonly selected: boolean }[];
  readonly investigation: { readonly id: string; readonly startedAt: string; readonly lastRunAt: string | null; readonly stale: boolean } | null;
  readonly people: readonly PersonGroup[];
  readonly otherPeople: readonly PersonGroup[];
  readonly channels: readonly CorporateChannel[];
  readonly path: BuyerPath;
  readonly sources: readonly { readonly url: string; readonly provider: string; readonly status: string; readonly query: string | null; readonly retrievedAt: string }[];
  readonly canonical: readonly CanonicalContact[];
  readonly route: ActionableRoute;
  readonly departmentEvidence: readonly { readonly quote: string; readonly url: string }[];
  /** 2.1A research graph, provenance and field-level corroboration (read time; nothing here changes person states). */
  readonly research: ResearchView;
}

const iso = (value: string | Date) => new Date(value).toISOString();
const PROVIDER_SOURCE: Record<string, SourceType> = { SIGNAL_SOURCE: "SIGNAL_DOCUMENT", OFFICIAL_WEBSITE: "OFFICIAL_SITE", PUBLIC_PROCUREMENT_DOCUMENT: "PROCUREMENT_DOCUMENT", HUNTER_DOMAIN_SEARCH: "PROVIDER", WEB_SEARCH_RESULT: "NEWS_ARTICLE", HUMAN_INTERACTION: "HUMAN_REFERRAL" };

interface InvestigationRow { id: string; started_at: string | Date; official_domain: string | null; domain_basis: string | null; target_functions: string[] | null; organization_type: OrganizationType | null; company_id: string | null }

async function investigationFor(client: SqlClient, subject: BuyerSubject): Promise<InvestigationRow | null> {
  const columns = "id, started_at, official_domain, domain_basis, target_functions, organization_type, company_id";
  return subject.kind === "SIGNAL"
    ? (await client.query<InvestigationRow>(`select ${columns} from contact_investigations where normalized_candidate_url=$1`, [subject.normalizedUrl])).rows[0] ?? null
    : (await client.query<InvestigationRow>(`select ${columns} from contact_investigations where company_id=$1 and normalized_candidate_url is null`, [subject.companyId])).rows[0] ?? null;
}

async function ensureInvestigation(client: SqlClient, subject: BuyerSubject, operatorId: string | null): Promise<InvestigationRow> {
  const existing = await investigationFor(client, subject);
  if (existing) return existing;
  if (subject.kind === "SIGNAL") {
    await client.query("insert into contact_investigations(normalized_candidate_url, started_by_operator_id) values($1,$2) on conflict (normalized_candidate_url) do nothing", [subject.normalizedUrl, operatorId]);
  } else {
    await client.query("insert into contact_investigations(company_id, started_by_operator_id) values($1,$2) on conflict do nothing", [subject.companyId, operatorId]);
  }
  return (await investigationFor(client, subject))!;
}

/** The canonical company a signal's organization maps to: the promoted opportunity's company, else one exact name match. */
export async function companyForSignal(client: SqlClient, signal: SignalDetail, organizationName: string | null): Promise<string | null> {
  if (signal.promotedOpportunityId) {
    const role = (await client.query<{ company_id: string }>("select company_id from company_roles where opportunity_id=$1 order by created_at limit 1", [signal.promotedOpportunityId])).rows[0];
    if (role) return role.company_id;
  }
  const normalized = organizationName ? normalizeCompanyName(organizationName) : "";
  if (!normalized) return null;
  const rows = (await client.query<{ id: string }>(
    "select id from companies where merged_into_company_id is null and (normalized_common_name=$1 or normalized_legal_name=$1) limit 2", [normalized])).rows;
  return rows.length === 1 ? rows[0].id : null;
}

export async function buyerOrganization(client: SqlClient, subject: BuyerSubject, row: InvestigationRow | null): Promise<BuyerOrganization> {
  if (subject.kind === "SIGNAL") {
    const identity = await organizationIdentityFor(client, subject.signal);
    const name = identity.name ?? subject.signal.company ?? "Unknown organization";
    const text = `${subject.signal.title} ${subject.signal.description ?? ""}`;
    const inferred: OrganizationType = identity.role === "PROCUREMENT_AUTHORITY" ? "PUBLIC_PROCUREMENT" : identity.role === "STAFFING_PROVIDER" ? "STAFFING_AGENCY" : classifyOrganization(name, text);
    return {
      name, officialDomain: row?.official_domain ?? identity.officialDomain, domainBasis: row?.official_domain ? row.domain_basis : identity.domainBasis,
      type: row?.organization_type ?? inferred, typeSource: row?.organization_type ? "OPERATOR" : "INFERRED",
      location: subject.signal.location, project: identity.project, companyId: await companyForSignal(client, subject.signal, identity.name),
    };
  }
  const company = (await client.query<{ legal_name: string | null; common_name: string | null; industry_metadata: Record<string, unknown> | null }>(
    "select legal_name, common_name, industry_metadata from companies where id=$1", [subject.companyId])).rows[0];
  const name = company?.common_name ?? company?.legal_name ?? "Unknown company";
  const metadata = company?.industry_metadata ?? {};
  const location = typeof metadata.location === "string" ? metadata.location : null;
  return {
    name, officialDomain: row?.official_domain ?? null, domainBasis: row?.domain_basis ?? null,
    type: row?.organization_type ?? classifyOrganization(name, typeof metadata.description === "string" ? metadata.description : ""),
    typeSource: row?.organization_type ? "OPERATOR" : "INFERRED", location, project: null, companyId: subject.companyId,
  };
}

/** Bounded run: official sources (+ Hunter only if configured), then person-first discovery. */
export async function runBuyerInvestigation(client: SqlClient, subject: BuyerSubject, operatorId: string | null, options: {
  readonly search?: Pick<BraveSearchProvider, "searchWeb" | "configured">; readonly fetcher?: typeof safeFetchSource; readonly hunter?: typeof hunterDomainSearch; readonly spacingMs?: number; readonly now?: Date;
  readonly env?: Record<string, string | undefined>;
} = {}): Promise<{ readonly investigationId: string; readonly channels: number; readonly people: PeopleSearchOutcome; readonly research: ResearchMetrics }> {
  let channels = 0;
  if (subject.kind === "SIGNAL") {
    channels = (await runContactInvestigation(client, subject.signal, subject.normalizedUrl, operatorId, { fetcher: options.fetcher, spacingMs: options.spacingMs, hunter: options.hunter })).found;
  }
  const row = await ensureInvestigation(client, subject, operatorId);
  const organization = await buyerOrganization(client, subject, row);
  if (subject.kind === "COMPANY" && organization.officialDomain) {
    const identity = { name: organization.name, officialDomain: organization.officialDomain, domainBasis: organization.domainBasis,
      role: organization.type === "STAFFING_AGENCY" ? "STAFFING_PROVIDER" as const : "UNKNOWN" as const, roleBasis: "", project: null };
    const pages = await retrieveOfficialPages(organization.officialDomain, [], { limit: 2, fetcher: options.fetcher, spacingMs: options.spacingMs });
    const extracted: { contact: ExtractedContact; url: string; provider: ContactProviderId }[] = [];
    for (const page of pages) {
      await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status,http_status) values($1,$2,'OFFICIAL_WEBSITE',$3,$4)", [row.id, page.url, page.status, page.httpStatus]);
      if (page.text) for (const contact of extractContacts({ url: page.url, provider: "OFFICIAL_WEBSITE", text: page.text, official: true }, identity)) extracted.push({ contact, url: page.url, provider: "OFFICIAL_WEBSITE" });
    }
    extracted.push(...await hunterCandidates(client, row.id, organization.officialDomain, options.hunter));
    channels = await insertExtracted(client, row.id, organization.name, extracted, false);
  }
  // 2.1A: the accepted 2.0 person search runs as stage 1 of the iterative research engine (shared budget).
  const research = await runResearch(client, {
    investigationId: row.id, organization, functions: functionsFor(organization.type, row.target_functions),
    search: options.search, fetcher: options.fetcher, spacingMs: options.spacingMs, now: options.now, env: options.env,
  });
  return { investigationId: row.id, channels, people: research.stage1, research: research.metrics };
}

export async function loadBuyerInvestigation(client: SqlClient, subject: BuyerSubject, now = new Date()): Promise<BuyerInvestigationView> {
  const row = await investigationFor(client, subject);
  const organization = await buyerOrganization(client, subject, row);
  const selected = functionsFor(organization.type, row?.target_functions);
  const functions = BUYER_FUNCTIONS[organization.type].map((fn) => ({ id: fn.id, label: fn.label, selected: selected.some((item) => item.id === fn.id) }));
  const canonical = organization.companyId ? (await client.query<{ id: string; name: string; title: string | null; contact_function: string; verification_state: string; contact_metadata: Record<string, unknown>; first_seen_at: string | Date | null; created_at: string | Date }>(
    "select id, name, title, contact_function::text as contact_function, verification_state::text as verification_state, contact_metadata, first_seen_at, created_at from contact_people where company_id=$1 order by created_at, id",
    [organization.companyId])).rows.map((item) => ({ id: item.id, name: item.name, title: item.title, contactFunction: item.contact_function, verificationState: item.verification_state,
    fromInvestigation: String(item.contact_metadata?.source ?? "").startsWith("contact-"), firstSeenAt: iso(item.first_seen_at ?? item.created_at) })) : [];
  if (!row) {
    return { organization, functions, investigation: null, people: [], otherPeople: [], channels: [], sources: [], canonical, departmentEvidence: [], research: EMPTY_RESEARCH,
      route: actionableRoute({ organization: organization.name, type: organization.type, people: [], channels: [], departmentEvidence: [] }),
      path: buyerPath({ organization: organization.name, people: [], channels: [], functions: selected, sourcesChecked: 0 }) };
  }
  const [rows, validations, decisions, interactions, retrievals] = await Promise.all([
    client.query<Record<string, unknown>>("select * from contact_candidates where investigation_id=$1 order by discovered_at, id", [row.id]),
    client.query<{ candidate_id: string; channel: string; result: string }>(
      `select distinct on (v.candidate_id, v.channel) v.candidate_id, v.channel, v.result from contact_validations v join contact_candidates c on c.id = v.candidate_id
        where c.investigation_id=$1 order by v.candidate_id, v.channel, v.checked_at desc, v.id`, [row.id]),
    client.query<{ candidate_id: string; decision: string }>(
      `select distinct on (d.candidate_id) d.candidate_id, d.decision from contact_decisions d join contact_candidates c on c.id = d.candidate_id
        where c.investigation_id=$1 order by d.candidate_id, d.decided_at desc, d.id`, [row.id]),
    client.query<Record<string, unknown>>(
      `select i.* from contact_interactions i join contact_candidates c on c.id = i.candidate_id where c.investigation_id=$1 order by i.recorded_at desc, i.id`, [row.id]),
    client.query<{ url: string; provider: string; status: string; query_text: string | null; retrieved_at: string | Date; evidence_note: string | null }>(
      "select url, provider, status, query_text, retrieved_at, evidence_note from contact_source_retrievals where investigation_id=$1 order by retrieved_at desc, id limit 300", [row.id]),
  ]);
  const rejected = new Set(decisions.rows.filter((item) => item.decision === "REJECTED").map((item) => item.candidate_id));
  const valid = (id: string, channel: string) => validations.rows.some((item) => item.candidate_id === id && item.channel === channel && item.result === "VALID");
  const live = rows.rows.filter((item) => !rejected.has(String(item.id)));
  const routePhones = new Set(live.filter((item) => item.kind === "PHONE_ROUTE" && item.phone).map((item) => String(item.phone)));
  // Names are re-checked at read time, so a row stored by an older parser can never surface as a person.
  const records: PersonEvidence[] = live.filter((item) => item.kind === "PERSON" && item.person_name && isPlausibleName(String(item.person_name))).map((item) => {
    const provider = String(item.provider);
    const currency = (item.evidence_currency as EvidenceCurrency | null) ?? (item.historical ? "HISTORICAL" : provider === "OFFICIAL_WEBSITE" ? "CURRENT" : "UNDATED");
    const phone = (item.phone as string | null) ?? null;
    const kind = phoneKindFromQuote((item.evidence_quote as string | null) ?? null, phone, (item.phone_kind as PhoneKind | null) ?? null);
    return {
      candidateId: String(item.id), name: String(item.person_name), title: (item.title as string | null) ?? null,
      personKey: (item.person_key as string | null) ?? personKey(String(item.person_name), organization.name), location: (item.location as string | null) ?? null,
      sourceUrl: String(item.source_url), sourceType: (item.source_type as SourceType | null) ?? PROVIDER_SOURCE[provider] ?? "NEWS_ARTICLE",
      sourceDate: item.source_date ? iso(item.source_date as string).slice(0, 10) : null, currency, quote: (item.evidence_quote as string | null) ?? null,
      email: (item.email as string | null) ?? null, emailAttributed: Boolean(item.email), emailVerified: valid(String(item.id), "EMAIL"),
      phone, phoneKind: phone && routePhones.has(phone) ? "DEPARTMENT" : kind, phoneValidated: valid(String(item.id), "PHONE"),
      profileUrl: (item.profile_url as string | null) ?? null, responsibilityEvidence: (item.responsibility_evidence as string | null) ?? null,
    };
  });
  const humanInteractions: HumanInteraction[] = interactions.rows.map((item) => ({
    candidateId: String(item.candidate_id), personReached: Boolean(item.person_reached), contactDate: iso(item.contact_date as string).slice(0, 10),
    channel: item.channel as HumanInteraction["channel"], handlesExternalWorkforce: item.handles_external_workforce as HumanInteraction["handlesExternalWorkforce"],
    referredTo: (item.referred_to as string | null) ?? null, responsibleDepartment: (item.responsible_department as string | null) ?? null,
    notes: (item.notes as string | null) ?? null, nextAction: (item.next_action as string | null) ?? null, recordedAt: iso(item.recorded_at as string),
  }));
  const grouped = groupPeople(records, humanInteractions, organization.type, selected);
  const personEmails = new Set(records.map((item) => item.email?.toLowerCase()).filter(Boolean));
  const personPhones = new Set(records.map((item) => item.phone).filter(Boolean));
  // A page re-read with the current parser revision supersedes that page's lines from older revisions (rows stay for audit).
  const revision = Date.parse(PAGE_PARSER_REVISION);
  const lastRead = new Map((await client.query<{ url: string; at: string | Date }>(
    "select url, max(retrieved_at) as at from contact_source_retrievals where investigation_id=$1 and provider='OFFICIAL_WEBSITE' and status='FETCHED' group by url", [row.id])).rows
    .map((item) => [item.url, Date.parse(iso(item.at))] as const));
  const currentReading = (item: Record<string, unknown>) => {
    if (!item.source_type || item.kind !== "PHONE_ROUTE") return true;
    const reread = (lastRead.get(String(item.source_url)) ?? 0) >= revision;
    return !reread || Date.parse(iso(item.discovered_at as string)) >= revision;
  };
  const allChannels: CorporateChannel[] = live.filter((item) => item.kind !== "PERSON").filter(currentReading)
    .filter((item) => !(item.email && personEmails.has(String(item.email).toLowerCase())) && !(item.kind === "PHONE_ROUTE" && item.phone && personPhones.has(String(item.phone))))
    .map((item) => ({
      candidateId: String(item.id), kind: item.kind as CorporateChannel["kind"], value: String(item.email ?? item.phone),
      label: (item.title as string | null) ?? (["OTHER", "GENERAL_OFFICE"].includes(String(item.contact_function)) ? null : String(item.contact_function)),
      // Lines read by the office/department extractor keep their stored kind; older rows are re-read from the quote.
      phoneKind: item.kind !== "PHONE_ROUTE" ? null : item.source_type && item.phone_kind !== "UNKNOWN" ? String(item.phone_kind)
        : phoneKindFromQuote((item.evidence_quote as string | null) ?? null, (item.phone as string | null) ?? null, (item.phone_kind as PhoneKind | null) ?? null),
      sourceUrl: String(item.source_url),
    }));
  // One row per number: a line marked SMS/help-desk anywhere stays non-commercial; otherwise the most specific reading wins.
  const SPECIFICITY: Record<string, number> = { NON_COMMERCIAL: 0, EXTENSION: 1, DEPARTMENT: 2, OFFICE: 3, MAIN: 4, DIRECT: 5, UNKNOWN: 6 };
  const channels = [...allChannels.reduce((byValue, channel) => {
    const current = byValue.get(channel.value);
    const rank = (item: CorporateChannel) => (SPECIFICITY[item.phoneKind ?? "UNKNOWN"] ?? 6) * 2 + (item.label ? 0 : 1);
    if (!current || rank(channel) < rank(current)) byValue.set(channel.value, channel);
    return byValue;
  }, new Map<string, CorporateChannel>()).values()];
  // Only the latest reading of each page counts (an older parser's note is superseded once the page is re-read).
  const departmentEvidence = retrievals.rows.filter((item) => item.provider === "OFFICIAL_WEBSITE" && item.status === "FETCHED")
    .filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index)
    .filter((item) => item.evidence_note).map((item) => ({ quote: item.evidence_note!, url: item.url }));
  const lastRun = retrievals.rows[0]?.retrieved_at ? iso(retrievals.rows[0].retrieved_at) : null;
  const research = await loadResearchView(client, row.id, grouped, channels, departmentEvidence, live);
  return {
    research,
    organization, functions,
    investigation: { id: row.id, startedAt: iso(row.started_at), lastRunAt: lastRun, stale: !lastRun || now.getTime() - Date.parse(lastRun) > PEOPLE_SEARCH_CACHE_DAYS * 86_400_000 },
    people: grouped.filter((item) => item.facts.relevant), otherPeople: grouped.filter((item) => !item.facts.relevant), channels,
    path: buyerPath({ organization: organization.name, people: grouped, channels, functions: selected, sourcesChecked: retrievals.rows.length }),
    route: actionableRoute({ organization: organization.name, type: organization.type, people: grouped, channels, departmentEvidence }), departmentEvidence,
    sources: retrievals.rows.map((item) => ({ url: item.url, provider: item.provider, status: item.status, query: item.query_text, retrievedAt: iso(item.retrieved_at) })),
    canonical,
  };
}

export async function updateInvestigationSettings(client: SqlClient, investigationId: string, input: { readonly functions?: readonly string[] | null; readonly organizationType?: OrganizationType | null; readonly officialDomain?: { readonly domain: string; readonly basis: string } | null }) {
  if (input.functions !== undefined) await client.query("update contact_investigations set target_functions=$2 where id=$1", [investigationId, input.functions?.length ? input.functions : null]);
  if (input.organizationType !== undefined) await client.query("update contact_investigations set organization_type=$2 where id=$1", [investigationId, input.organizationType]);
  if (input.officialDomain) await client.query("update contact_investigations set official_domain=$2, domain_basis=$3 where id=$1", [investigationId, input.officialDomain.domain, input.officialDomain.basis]);
}

export { ensureInvestigation };

export type InteractionCanonical = "WRITTEN" | "REUSED" | "NOT_REACHED" | "NO_COMPANY" | "NOT_A_PERSON";

/**
 * Human interaction record (append-only). Nothing is sent: the operator records what happened. A reached person
 * becomes (or reuses) a canonical contact on the company — with no opportunity required — and is linked to the
 * opportunity when the signal was promoted. Responsibility comes only from what the operator records.
 */
export async function recordInteraction(client: SqlClient, input: {
  readonly candidateId: string; readonly personReached: boolean; readonly contactDate: string; readonly channel: HumanInteraction["channel"];
  readonly handlesExternalWorkforce: HumanInteraction["handlesExternalWorkforce"]; readonly referredTo: string | null; readonly responsibleDepartment: string | null;
  readonly notes: string | null; readonly nextAction: string | null; readonly operatorId: string | null; readonly companyId: string | null; readonly opportunityId: string | null;
  readonly contactService?: Pick<ContactService, "createPerson">; readonly now?: Date;
}): Promise<{ readonly canonical: InteractionCanonical }> {
  const candidate = (await client.query<{ kind: string; person_name: string | null; title: string | null; contact_function: ContactFunction; source_url: string; person_key: string | null; organization: string | null; department: string | null; profile_url: string | null }>(
    "select kind, person_name, title, contact_function::text as contact_function, source_url, person_key, organization, department, profile_url from contact_candidates where id=$1", [input.candidateId])).rows[0];
  if (!candidate) throw new Error("Contact candidate not found");
  let canonicalId: string | null = null;
  let canonical: InteractionCanonical = "NOT_REACHED";
  if (candidate.kind !== "PERSON" || !candidate.person_name) canonical = "NOT_A_PERSON";
  else if (input.personReached && !input.companyId) canonical = "NO_COMPANY";
  else if (input.personReached && input.companyId) {
    const key = candidate.person_key ?? personKey(candidate.person_name, candidate.organization ?? "");
    const existing = (await client.query<{ id: string }>("select id from contact_people where company_id=$1 and contact_metadata->>'personKey'=$2 order by created_at limit 1", [input.companyId, key])).rows[0];
    if (existing) { canonicalId = existing.id; canonical = "REUSED"; }
    else {
      const service = input.contactService ?? new ContactService(new PostgresContactRepository(client));
      const person = await service.createPerson({
        companyId: input.companyId, fullName: candidate.person_name, title: candidate.title, department: input.responsibleDepartment ?? candidate.department,
        contactFunction: candidate.contact_function, professionalProfileUrl: candidate.profile_url, observedAt: input.now ?? new Date(), verificationState: "UNVERIFIED",
        metadata: { source: "contact-intelligence-2", personKey: key, contactCandidateId: input.candidateId, sourceUrl: candidate.source_url, humanReached: true, handlesExternalWorkforce: input.handlesExternalWorkforce },
      });
      canonicalId = person.id;
      canonical = "WRITTEN";
    }
    if (input.opportunityId) await client.query("insert into opportunity_contact_people(opportunity_id, contact_person_id) values($1,$2) on conflict do nothing", [input.opportunityId, canonicalId]);
  }
  await client.query(
    `insert into contact_interactions(candidate_id,person_reached,contact_date,channel,handles_external_workforce,referred_to,responsible_department,notes,next_action,recorded_by_operator_id,canonical_contact_person_id)
     values($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [input.candidateId, input.personReached, input.contactDate, input.channel, input.handlesExternalWorkforce, input.referredTo, input.responsibleDepartment, input.notes, input.nextAction, input.operatorId, canonicalId]);
  return { canonical };
}

export type { BuyerFunction };

/** 2.1A read model: research graph, provenance chains and field-level corroboration. Read-only. */
async function loadResearchView(client: SqlClient, investigationId: string, grouped: readonly PersonGroup[], channels: readonly CorporateChannel[],
  departmentEvidence: readonly { readonly quote: string; readonly url: string }[], candidates: readonly Record<string, unknown>[]): Promise<ResearchView> {
  const [pivotRows, retrievalRows] = await Promise.all([
    client.query<{ id: string; kind: PivotKind; value: string; normalized_key: string; parent_pivot_id: string | null; depth: number; discovered_at: string | Date; source_url: string | null }>(
      `select p.id, p.kind, p.value, p.normalized_key, p.parent_pivot_id, p.depth, p.discovered_at, r.url as source_url
         from contact_research_pivots p left join contact_source_retrievals r on r.id = p.source_retrieval_id where p.investigation_id=$1 order by p.depth, p.discovered_at, p.id`, [investigationId]),
    client.query<{ url: string; status: string; query_text: string | null; pivot_id: string | null; evidence_note: string | null }>(
      "select url, status, query_text, pivot_id, evidence_note from contact_source_retrievals where investigation_id=$1", [investigationId]),
  ]);
  const pivots: ResearchPivotView[] = pivotRows.rows.map((p) => ({ id: p.id, kind: p.kind, value: p.value, parentId: p.parent_pivot_id, depth: Number(p.depth), sourceUrl: p.source_url, discoveredAt: iso(p.discovered_at) }));
  const byId = new Map(pivots.map((p) => [p.id, p]));
  const chain = (id: string | undefined): readonly string[] => {
    const out: string[] = []; let current = id ? byId.get(id) : undefined; let guard = 0;
    while (current && guard < 10) { out.unshift(`${current.kind}:${current.value}`); current = current.parentId ? byId.get(current.parentId) : undefined; guard += 1; }
    return out;
  };
  const personPivot = new Map(pivotRows.rows.filter((p) => p.kind === "PERSON").map((p) => [p.normalized_key, p.id]));
  const officialLines = new Map<string, string>();
  for (const c of channels) if (c.kind === "PHONE_ROUTE" && c.phoneKind && ["MAIN", "OFFICE", "DEPARTMENT"].includes(c.phoneKind)) officialLines.set(phoneDigits(c.value), c.phoneKind);
  const institutionUrls = new Set(candidates.filter((c) => String(c.attribution_basis ?? "").startsWith("Listed by ")).map((c) => String(c.source_url)));
  const conflictsByPivot = new Map<string, { url: string; note: string; currency: "UNDATED" }[]>();
  for (const r of retrievalRows.rows) if (r.pivot_id && r.evidence_note?.startsWith("AFFILIATION_CONFLICT")) {
    conflictsByPivot.set(r.pivot_id, [...(conflictsByPivot.get(r.pivot_id) ?? []), { url: r.url, note: r.evidence_note.replace(/^AFFILIATION_CONFLICT:\s*/, ""), currency: "UNDATED" }]);
  }
  const insights: Record<string, { corroboration: PersonCorroboration; via: readonly string[] }> = {};
  for (const person of grouped) {
    const pid = personPivot.get(normalizePerson(person.name));
    insights[person.key] = {
      corroboration: corroboratePerson(person, { officialLines, institutionUrls, affiliationConflicts: pid ? conflictsByPivot.get(pid) ?? [] : [], interactions: person.interactions }),
      via: pid ? chain(pid) : [],
    };
  }
  const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
  const referenceContacts = rankPeopleForResearch(grouped
    // Only people relevant to a target function or in a research role category (procurement → BD): a corroborated board
    // director or executive chairman is not someone to ask for on a staffing call.
    .filter((p) => (p.facts.relevant || !["LEADERSHIP", "OTHER"].includes(researchCategory(p.title))) && (p.sources.some((s) => institutionUrls.has(s.sourceUrl)) || insights[p.key].corroboration.fields.identity.status === "CORROBORATED"))
    .map((p) => ({ ...p, domains: insights[p.key].corroboration.fields.identity.domains.length })))
    .slice(0, 3)
    .map((p) => ({ key: p.key, name: p.name, title: p.title, phone: p.phone?.number ?? null, association: insights[p.key].corroboration.phoneAssociation, via: insights[p.key].via,
      sourceDomains: [...new Set(p.sources.map((s) => domainOf(s.sourceUrl)))] }));
  const channelEvidence = retrievalRows.rows.filter((r) => r.evidence_note?.startsWith("CHANNEL_SEEN")).map((r) => ({
    phone: byId.get(r.pivot_id ?? "")?.value ?? "", note: r.evidence_note!.replace(/^CHANNEL_SEEN:\s*/, ""), url: r.url }));
  return {
    pivots, insights, procurement: procurementStatus(departmentEvidence), referenceContacts, channelEvidence,
    usage: { queries: retrievalRows.rows.filter((r) => r.query_text && r.status !== "CACHED").length, pages: retrievalRows.rows.filter((r) => r.status === "FETCHED" || /^(HTTP_|TIMEOUT|BLOCKED|FAILED|UNSAFE|PRIVATE|TOO_LARGE|UNSUPPORTED|OFF_DOMAIN)/.test(r.status)).length, pivots: pivots.length },
  };
}
