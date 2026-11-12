import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import type { SignalDetail } from "../opportunity-discovery/signals";
import {
  extractContacts, nameTokens, phoneKindFromQuote, type PhoneKind, organizationRole, priorityReason, registrableDomain, resolveOfficialDomain, targetFunctions,
  type ContactProviderId, type ExtractedContact, type OrganizationIdentity, type TargetFunction, type ValidationResult,
} from "../../domain/contact-investigation";
import type { ContactFunction } from "../../domain/contact";
import { hunterDomainSearch, retrieveOfficialPages, type RetrievedPage } from "./providers";
import { safeFetchSource } from "../source-enrichment/safe-fetch";
import { jobPostingOrganization } from "../../domain/commercial-qualification";
import type { SignalCategory } from "../../domain/discovery-coverage";
import { ContactService } from "../services/contact/contact-service";
import { PostgresContactRepository } from "../repositories/contact/postgres-contact-repository";

export interface ContactCandidateView {
  readonly id: string;
  readonly kind: "PERSON" | "MAILBOX" | "PHONE_ROUTE";
  readonly personName: string | null;
  readonly title: string | null;
  readonly contactFunction: ContactFunction;
  readonly organization: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly phoneKind: string | null;
  readonly sourceUrl: string;
  readonly provider: ContactProviderId;
  readonly quote: string | null;
  readonly attributed: boolean;
  readonly attributionBasis: string | null;
  readonly historical: boolean;
  readonly discoveredAt: string;
  readonly emailValidation: { readonly result: ValidationResult; readonly provider: string; readonly checkedAt: string } | null;
  readonly phoneValidation: { readonly result: ValidationResult; readonly provider: string; readonly checkedAt: string } | null;
  readonly decision: { readonly decision: "SELECTED_FOR_FOLLOW_UP" | "CONFIRMED" | "REJECTED"; readonly note: string | null; readonly decidedAt: string; readonly canonical: boolean } | null;
  readonly priority: { readonly rank: number; readonly reason: string };
}

export interface ContactInvestigationView {
  readonly organization: OrganizationIdentity;
  readonly targets: readonly TargetFunction[];
  readonly investigation: { readonly id: string; readonly startedAt: string } | null;
  readonly retrievals: readonly { readonly url: string; readonly provider: string; readonly status: string; readonly httpStatus: number | null; readonly retrievedAt: string }[];
  readonly candidates: readonly ContactCandidateView[];
  /** Target functions with no attributed contact yet — each is a concrete research task. */
  readonly missingFunctions: readonly TargetFunction[];
  readonly historicalSource: boolean;
}

/** Category for contact targeting: the qualified one, else what the source states, else a named job posting. */
export const investigationCategory = (signal: SignalDetail): SignalCategory | null =>
  signal.qualification.category ?? signal.signalCategory ?? (signal.jobBoard && jobPostingOrganization(signal.title) ? "DIRECT_HIRING" : null);

const PUBLIC_BODY = /\b(county|city of|port of|isd|independent school district|authority|university|college|state of|department of|district)\b/i;
const iso = (value: string | Date) => new Date(value).toISOString();

export async function organizationIdentityFor(client: SqlClient, signal: SignalDetail): Promise<OrganizationIdentity> {
  const name = signal.qualification.organization ?? signal.company;
  const publicBody = Boolean(name && PUBLIC_BODY.test(name));
  const tokens = name ? nameTokens(name) : [];
  const known = tokens.length ? (await client.query<{ title: string; candidate_url: string }>(
    `select distinct on (normalized_candidate_url) title, candidate_url from company_discovery_candidates
      where title ilike $1 order by normalized_candidate_url, created_at desc limit 40`, [`%${tokens[0]}%`])).rows : [];
  const official = resolveOfficialDomain({ organization: name, sourceUrl: signal.url, publicBody, knownPages: known.map((row) => ({ url: row.candidate_url, title: row.title })) });
  const text = `${signal.title} ${signal.description ?? ""} ${signal.page?.text?.slice(0, 6000) ?? ""}`;
  const role = organizationRole({ category: investigationCategory(signal), publicBody, organization: name, text });
  return { name, officialDomain: official.domain, domainBasis: official.basis, role: role.role, roleBasis: role.basis, project: signal.qualification.project };
}

/** Run a bounded contact investigation: signal source, its original document, official site pages, Hunter (if configured). */
export async function runContactInvestigation(client: SqlClient, signal: SignalDetail, normalizedUrl: string, operatorId: string | null, options: {
  readonly fetcher?: typeof safeFetchSource; readonly spacingMs?: number; readonly hunter?: typeof hunterDomainSearch;
} = {}): Promise<{ readonly investigationId: string; readonly found: number }> {
  const inserted = await client.query<{ id: string }>(
    "insert into contact_investigations(normalized_candidate_url, started_by_operator_id) values($1,$2) on conflict (normalized_candidate_url) do nothing returning id",
    [normalizedUrl, operatorId]);
  const investigationId = inserted.rows[0]?.id ?? (await client.query<{ id: string }>("select id from contact_investigations where normalized_candidate_url=$1", [normalizedUrl])).rows[0].id;
  const organization = await organizationIdentityFor(client, signal);
  const targets = targetFunctions(investigationCategory(signal));
  const historical = Boolean(signal.qualification.expiry || signal.qualification.noise === "EXPIRED" || signal.freshness === "STALE");
  const sourceOfficial = Boolean(organization.officialDomain && registrableDomain(new URL(signal.url).hostname) === organization.officialDomain);
  const documents: { url: string; provider: ContactProviderId; text: string; official: boolean }[] = [
    { url: signal.url, provider: "SIGNAL_SOURCE", text: `${signal.title}. ${signal.description ?? ""}`, official: sourceOfficial },
  ];
  if (signal.page?.status === "FETCHED" && signal.page.text) {
    const procurementDocument = organization.role === "PROCUREMENT_AUTHORITY";
    documents.push({ url: signal.url, provider: procurementDocument ? "PUBLIC_PROCUREMENT_DOCUMENT" : "SIGNAL_SOURCE", text: signal.page.text, official: sourceOfficial });
  }
  let pages: readonly RetrievedPage[] = [];
  if (organization.officialDomain) {
    pages = await retrieveOfficialPages(organization.officialDomain, targets.flatMap((target) => target.paths), { fetcher: options.fetcher, spacingMs: options.spacingMs });
    for (const page of pages) {
      await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status,http_status) values($1,$2,'OFFICIAL_WEBSITE',$3,$4)", [investigationId, page.url, page.status, page.httpStatus]);
      if (page.text) documents.push({ url: page.url, provider: "OFFICIAL_WEBSITE", text: page.text, official: true });
    }
  }
  const extracted: { contact: ExtractedContact; url: string; provider: ContactProviderId }[] = [];
  for (const document of documents) for (const contact of extractContacts(document, organization)) extracted.push({ contact, url: document.url, provider: document.provider });

  if (organization.officialDomain) extracted.push(...await hunterCandidates(client, investigationId, organization.officialDomain, options.hunter));
  const found = await insertExtracted(client, investigationId, organization.name, extracted, historical);
  return { investigationId, found };
}

/** Hunter domain search (only when configured): provider-reported addresses, attributed only on the official domain. */
export async function hunterCandidates(client: SqlClient, investigationId: string, officialDomain: string, hunterSearch: typeof hunterDomainSearch = hunterDomainSearch) {
  const extracted: { contact: ExtractedContact; url: string; provider: ContactProviderId }[] = [];
  const hunter = await hunterSearch(officialDomain);
  if (hunter.state !== "NOT_CONFIGURED") {
    await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status) values($1,$2,'HUNTER_DOMAIN_SEARCH',$3)",
      [investigationId, `hunter:domain-search:${officialDomain}`, hunter.state === "OK" ? "OK" : hunter.reason]);
  }
  if (hunter.state === "OK") {
    for (const item of hunter.value) {
      const name = [item.firstName, item.lastName].filter(Boolean).join(" ") || null;
      const domainMatches = registrableDomain(item.email.split("@")[1] ?? "") === officialDomain;
      extracted.push({ url: item.sourceUrl ?? `https://hunter.io/domain-search/${officialDomain}`, provider: "HUNTER_DOMAIN_SEARCH", contact: {
        identityKey: "", kind: name ? "PERSON" : "MAILBOX", personName: name, title: item.position, contactFunction: "OTHER", email: item.email, phone: null, phoneKind: null,
        quote: `Provider result: ${item.email}${item.position ? ` — ${item.position}` : ""}${item.sourceUrl ? ` (source ${item.sourceUrl})` : ""}`,
        attributed: domainMatches, attributionBasis: domainMatches ? `Email on the official domain ${officialDomain} (provider-reported).` : null,
      } });
    }
  }
  return extracted;
}

/** Persist extracted contacts (idempotent per investigation and identity). */
export async function insertExtracted(client: SqlClient, investigationId: string, organizationName: string | null,
  extracted: readonly { contact: ExtractedContact; url: string; provider: ContactProviderId }[], historical: boolean): Promise<number> {
  let found = 0;
  const { createHash } = await import("node:crypto");
  for (const { contact, url, provider } of extracted) {
    const identityKey = contact.identityKey || createHash("sha256").update([contact.personName, contact.email, contact.phone].map((part) => (part ?? "").toLowerCase()).join("|")).digest("hex");
    const result = await client.query<{ id: string }>(
      `insert into contact_candidates(investigation_id,identity_key,kind,person_name,title,contact_function,organization,email,phone,phone_kind,source_url,provider,
         evidence_quote,attributed,attribution_basis,historical)
       values($1,$2,$3,$4,$5,$6::contact_function,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (investigation_id, identity_key) do nothing returning id`,
      [investigationId, identityKey, contact.kind, contact.personName, contact.title, contact.contactFunction, organizationName, contact.email, contact.phone, contact.phoneKind,
        url, provider, contact.quote.slice(0, 600), contact.attributed, contact.attributionBasis, historical && provider !== "OFFICIAL_WEBSITE"]);
    found += result.rows.length;
  }
  return found;
}

/**
 * Read-time duplicate prevention across sources: a mailbox whose address belongs to a named person is shown once
 * (on the person), and a person's number that the organization also prints as its own line is a department line,
 * not a personal direct number.
 */
export function mergeDuplicateRoutes<T extends Pick<ContactCandidateView, "kind" | "email" | "phone" | "phoneKind" | "decision">>(candidates: readonly T[]): readonly T[] {
  const personEmails = new Set(candidates.filter((item) => item.kind === "PERSON" && item.email).map((item) => item.email!.toLowerCase()));
  const routePhones = new Set(candidates.filter((item) => item.kind === "PHONE_ROUTE" && item.phone).map((item) => item.phone!));
  const personPhones = new Set(candidates.filter((item) => item.kind === "PERSON" && item.phone).map((item) => item.phone!));
  return candidates
    .filter((item) => item.decision || !(item.kind === "MAILBOX" && item.email && personEmails.has(item.email.toLowerCase())))
    .filter((item) => item.decision || !(item.kind === "PHONE_ROUTE" && item.phone && personPhones.has(item.phone)))
    .map((item) => (item.kind === "PERSON" && item.phone && routePhones.has(item.phone) ? { ...item, phoneKind: "DEPARTMENT" } : item));
}

export async function loadContactInvestigation(client: SqlClient, signal: SignalDetail, normalizedUrl: string): Promise<ContactInvestigationView> {
  const organization = await organizationIdentityFor(client, signal);
  const targets = targetFunctions(investigationCategory(signal));
  const historicalSource = Boolean(signal.qualification.expiry || signal.qualification.noise === "EXPIRED" || signal.freshness === "STALE");
  const investigation = (await client.query<{ id: string; started_at: string | Date }>("select id, started_at from contact_investigations where normalized_candidate_url=$1", [normalizedUrl])).rows[0];
  if (!investigation) return { organization, targets, investigation: null, retrievals: [], candidates: [], missingFunctions: targets, historicalSource };
  const [rows, validations, decisions, retrievals] = await Promise.all([
    client.query<Record<string, unknown>>("select * from contact_candidates where investigation_id=$1 order by discovered_at, id", [investigation.id]),
    client.query<{ candidate_id: string; channel: string; provider: string; result: ValidationResult; checked_at: string | Date }>(
      `select distinct on (v.candidate_id, v.channel) v.candidate_id, v.channel, v.provider, v.result, v.checked_at from contact_validations v
        join contact_candidates c on c.id = v.candidate_id where c.investigation_id=$1 order by v.candidate_id, v.channel, v.checked_at desc, v.id`, [investigation.id]),
    client.query<{ candidate_id: string; decision: "SELECTED_FOR_FOLLOW_UP" | "CONFIRMED" | "REJECTED"; note: string | null; decided_at: string | Date; canonical_contact_person_id: string | null }>(
      `select distinct on (d.candidate_id) d.candidate_id, d.decision, d.note, d.decided_at, d.canonical_contact_person_id from contact_decisions d
        join contact_candidates c on c.id = d.candidate_id where c.investigation_id=$1 order by d.candidate_id, d.decided_at desc, d.id`, [investigation.id]),
    client.query<{ url: string; provider: string; status: string; http_status: number | null; retrieved_at: string | Date }>(
      "select url, provider, status, http_status, retrieved_at from contact_source_retrievals where investigation_id=$1 order by retrieved_at desc, id limit 20", [investigation.id]),
  ]);
  const validationOf = (id: string, channel: string) => { const row = validations.rows.find((item) => item.candidate_id === id && item.channel === channel); return row ? { result: row.result, provider: row.provider, checkedAt: iso(row.checked_at) } : null; };
  const candidates: ContactCandidateView[] = mergeDuplicateRoutes(rows.rows.map((row) => {
    const decision = decisions.rows.find((item) => item.candidate_id === row.id);
    const view = {
      id: String(row.id), kind: row.kind as ContactCandidateView["kind"], personName: (row.person_name as string | null) ?? null, title: (row.title as string | null) ?? null,
      contactFunction: row.contact_function as ContactFunction, organization: (row.organization as string | null) ?? null, email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null, phoneKind: phoneKindFromQuote((row.evidence_quote as string | null) ?? null, (row.phone as string | null) ?? null, (row.phone_kind as PhoneKind | null) ?? null), sourceUrl: String(row.source_url), provider: row.provider as ContactProviderId,
      quote: (row.evidence_quote as string | null) ?? null, attributed: Boolean(row.attributed), attributionBasis: (row.attribution_basis as string | null) ?? null,
      historical: Boolean(row.historical) && row.provider !== "OFFICIAL_WEBSITE", discoveredAt: iso(row.discovered_at as string), emailValidation: validationOf(String(row.id), "EMAIL"), phoneValidation: validationOf(String(row.id), "PHONE"),
      decision: decision ? { decision: decision.decision, note: decision.note, decidedAt: iso(decision.decided_at), canonical: Boolean(decision.canonical_contact_person_id) } : null,
    };
    return { ...view, priority: view.phoneKind === "NON_COMMERCIAL" ? { rank: 9, reason: "SMS/help-desk line on the official site — not a commercial route." } : priorityReason(view, targets) };
  })).slice().sort((a, b) => Number(a.historical) - Number(b.historical) || a.priority.rank - b.priority.rank || Number(b.attributed) - Number(a.attributed));
  const covered = new Set(candidates.filter((candidate) => candidate.attributed && candidate.decision?.decision !== "REJECTED").map((candidate) => candidate.contactFunction));
  return {
    organization, targets, investigation: { id: investigation.id, startedAt: iso(investigation.started_at) },
    retrievals: retrievals.rows.map((row) => ({ url: row.url, provider: row.provider, status: row.status, httpStatus: row.http_status, retrievedAt: iso(row.retrieved_at) })),
    candidates, missingFunctions: targets.filter((target) => !covered.has(target.contactFunction)), historicalSource,
  };
}

export async function recordValidation(client: SqlClient, input: { readonly candidateId: string; readonly channel: "EMAIL" | "PHONE"; readonly provider: string; readonly result: ValidationResult; readonly details?: Record<string, unknown> }) {
  await client.query("insert into contact_validations(candidate_id,channel,provider,result,details) values($1,$2,$3,$4,$5::jsonb)",
    [input.candidateId, input.channel, input.provider, input.result, JSON.stringify(input.details ?? {})]);
}

/**
 * Human decision. CONFIRMED is the only state that can reach the canonical contact register, and only when the
 * signal was promoted to an opportunity that has a company on record; otherwise the decision is kept here.
 */
export async function recordDecision(client: SqlClient, input: {
  readonly candidateId: string; readonly decision: "SELECTED_FOR_FOLLOW_UP" | "CONFIRMED" | "REJECTED"; readonly note: string | null; readonly operatorId: string | null;
  readonly promotedOpportunityId: string | null; readonly contactService?: Pick<ContactService, "createPerson">; readonly now?: Date;
}): Promise<{ readonly canonical: "WRITTEN" | "NOT_APPLICABLE" | "NO_OPPORTUNITY" | "NO_COMPANY" }> {
  let canonicalId: string | null = null;
  let canonical: "WRITTEN" | "NOT_APPLICABLE" | "NO_OPPORTUNITY" | "NO_COMPANY" = "NOT_APPLICABLE";
  if (input.decision === "CONFIRMED") {
    const candidate = (await client.query<{ kind: string; person_name: string | null; title: string | null; contact_function: ContactFunction; source_url: string }>(
      "select kind, person_name, title, contact_function::text as contact_function, source_url from contact_candidates where id=$1", [input.candidateId])).rows[0];
    if (candidate?.kind === "PERSON" && candidate.person_name) {
      if (!input.promotedOpportunityId) canonical = "NO_OPPORTUNITY";
      else {
        const company = (await client.query<{ company_id: string }>("select company_id from company_roles where opportunity_id=$1 order by created_at limit 1", [input.promotedOpportunityId])).rows[0];
        if (!company) canonical = "NO_COMPANY";
        else {
          const service = input.contactService ?? new ContactService(new PostgresContactRepository(client));
          const person = await service.createPerson({ companyId: company.company_id, fullName: candidate.person_name, title: candidate.title, contactFunction: candidate.contact_function,
            observedAt: input.now ?? new Date(), verificationState: "UNVERIFIED", metadata: { source: "contact-investigation", contactCandidateId: input.candidateId, sourceUrl: candidate.source_url, humanConfirmed: true } });
          await client.query("insert into opportunity_contact_people(opportunity_id, contact_person_id) values($1,$2) on conflict do nothing", [input.promotedOpportunityId, person.id]);
          canonicalId = person.id;
          canonical = "WRITTEN";
        }
      }
    }
  }
  await client.query("insert into contact_decisions(candidate_id,decision,note,decided_by_operator_id,canonical_contact_person_id) values($1,$2,$3,$4,$5)",
    [input.candidateId, input.decision, input.note, input.operatorId, canonicalId]);
  return { canonical };
}
