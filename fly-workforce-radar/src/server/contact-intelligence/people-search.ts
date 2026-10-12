import { createHash } from "node:crypto";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import {
  RESPONSIBILITY, buildPeopleQueries, departmentEvidence, evidenceCurrency, extractOfficeChannels, isPlausibleName, matchBuyerFunction, pageDate,
  parsePeopleFromPage, parsePeopleFromSearchResult, personKey, sourceTypeOf,
  type BuyerFunction, type EvidenceCurrency, type OrganizationType, type SourceType,
} from "../../domain/buyer-intelligence";
import { nameTokens, registrableDomain } from "../../domain/contact-investigation";
import { BraveSearchProvider } from "../company-discovery/brave-search-provider";
import { safeFetchSource } from "../source-enrichment/safe-fetch";
import { extractSource } from "../source-enrichment/source-text";
import { dailyQueryCap } from "../../domain/research-pivots";
import { retrieveOfficialPages } from "./providers";

/**
 * Person-first discovery for one organization, from legitimate public sources only:
 *  1. bounded web queries — company + buyer role, + staffing/manpower, + subcontractor/vendor/business development,
 *     + project or location, one query to find the organization's own leadership pages and one to find its
 *     contact / location / procurement pages;
 *  2. up to two confirmation queries on the official site for people already named elsewhere (current evidence);
 *  3. the official pages found (leadership, offices, procurement, press), read for people, office and department
 *     lines, extensions, publication dates and department-level procurement evidence;
 *  4. at most two public association/directory pages that name the organization (never profiles or data brokers).
 * Profiles are never opened, robots.txt is respected, nothing behind a login/paywall/CAPTCHA is read, and a person
 * is recorded only when a source names them together with the organization.
 */
export const PEOPLE_SEARCH_CACHE_DAYS = 7;
/** Hard ceilings per organization per run, and per provider per day across all investigations. */
export const MAX_DISCOVERY_QUERIES = 7;
export const MAX_CONFIRMATION_QUERIES = 2;
export const MAX_OFFICIAL_PEOPLE_PAGES = 8;
export const MAX_DIRECTORY_PAGES = 2;
/** Default daily cap (configurable through CONTACT_RESEARCH_DAILY_QUERY_CAP; see dailyQueryCap). */
export const MAX_DAILY_WEB_QUERIES = 60;
export const contentHash = (text: string) => createHash("sha256").update(text).digest("hex");
/** Pages read before the current parser revision are re-read once (the cache never hides an improved reading). */
export const PAGE_PARSER_REVISION = "2026-10-01T22:40:00Z";
const LEADERSHIP_PATHS = ["/about-us", "/about", "/leadership", "/our-team", "/team", "/about-us/leadership", "/company/leadership", "/our-people"];
const CHANNEL_PAGE = /contact|connect|location|office|branch|procure|supplier|vendor|subcontract|purchas/i;
const PEOPLE_PAGE = /leader|team|people|about|management|staff|news|press|honor|employee/i;
/** Hosts whose pages are never fetched: profiles, data brokers, social networks, job boards, review sites. */
const NO_FETCH_HOSTS = /(^|\.)(linkedin|zoominfo|rocketreach|signalhire|apollo|contactout|leadiq|lusha|seamless|datanyze|theorg|crunchbase|facebook|instagram|twitter|x|tiktok|youtube|indeed|glassdoor|ziprecruiter|yelp|bbb|truthfinder|spokeo|whitepages|wikipedia|dnb|globaldata|bloomberg)\.(com|org|io|ai|co|net)$/i;
const DIRECTORY_PAGE = /member|directory|sponsor|roster|exhibitor|vendor list|supplier list|contacts/i;

export interface PeopleSearchOrganization {
  readonly name: string;
  readonly officialDomain: string | null;
  readonly type: OrganizationType;
  readonly location: string | null;
  readonly project: string | null;
}

export type QueryState = "OK" | "CACHED" | "FAILED" | "NOT_CONFIGURED" | "DAILY_LIMIT";
export interface PeopleSearchOutcome {
  readonly found: number;
  readonly channels: number;
  readonly queries: readonly { readonly query: string; readonly state: QueryState; readonly results: number }[];
  readonly pages: number;
}

type WebSearch = Pick<BraveSearchProvider, "searchWeb" | "configured">;
type SearchResult = Awaited<ReturnType<BraveSearchProvider["searchWeb"]>>[number];

interface PersonRow {
  readonly name: string;
  readonly title: string | null;
  readonly sourceUrl: string;
  readonly provider: "OFFICIAL_WEBSITE" | "WEB_SEARCH_RESULT";
  readonly sourceType: SourceType;
  readonly sourceDate: string | null;
  readonly currency: EvidenceCurrency;
  readonly quote: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly location: string | null;
  readonly profileUrl: string | null;
  readonly basis: string;
  readonly responsibility: string | null;
}

const day = (value: string | null) => (value ? value.slice(0, 10) : null);
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };

export async function discoverPeople(client: SqlClient, input: {
  readonly investigationId: string; readonly organization: PeopleSearchOrganization; readonly functions: readonly BuyerFunction[];
  readonly search?: WebSearch; readonly fetcher?: typeof safeFetchSource; readonly spacingMs?: number; readonly now?: Date;
  /** 2.1A: the research pivot that generated this stage (root COMPANY pivot) and the configurable daily cap. */
  readonly pivotId?: string | null; readonly dailyCap?: number;
  /** 2.1A: share of the per-investigation research budget this stage may spend (omitted = the 2.0 limits). */
  readonly maxQueries?: number; readonly maxPages?: number;
}): Promise<PeopleSearchOutcome> {
  const org = input.organization;
  const now = input.now ?? new Date();
  const tokens = nameTokens(org.name).slice(0, 2);
  const rows: PersonRow[] = [];
  const queries: { query: string; state: QueryState; results: number }[] = [];
  const spacing = input.spacingMs ?? 1100;
  const search = input.search ?? new BraveSearchProvider();
  const officialPages = new Map<string, "PEOPLE" | "CHANNEL">();
  const directoryPages = new Set<string>();

  const dailyUsed = Number((await client.query<{ n: string | number }>(
    "select count(*) as n from contact_source_retrievals where provider='WEB_SEARCH_RESULT' and status in ('OK','FAILED') and retrieved_at > $1::timestamptz - interval '1 day'", [now.toISOString()])).rows[0]?.n ?? 0);
  let used = dailyUsed;
  let stopped = false;

  /** One bounded, cached web query; results are handed to `onResults`. */
  const runQuery = async (query: string, onResults: (results: readonly SearchResult[]) => void) => {
    const cached = await client.query<{ n: string | number }>(
      `select count(*) as n from contact_source_retrievals where investigation_id=$1 and provider='WEB_SEARCH_RESULT' and query_text=$2 and status='OK'
         and retrieved_at > $3::timestamptz - make_interval(days => $4)`, [input.investigationId, query, now.toISOString(), PEOPLE_SEARCH_CACHE_DAYS]);
    if (Number(cached.rows[0]?.n ?? 0) > 0) { queries.push({ query, state: "CACHED", results: 0 }); return; }
    if (!search.configured) { queries.push({ query, state: "NOT_CONFIGURED", results: 0 }); return; }
    if (stopped) return;
    if (used - dailyUsed >= (input.maxQueries ?? Infinity)) return;
    if (used >= (input.dailyCap ?? dailyQueryCap())) { queries.push({ query, state: "DAILY_LIMIT", results: 0 }); return; }
    if (used > dailyUsed && spacing > 0) await new Promise((resolve) => setTimeout(resolve, spacing));
    used += 1;
    try {
      const results = await search.searchWeb(query, 10);
      queries.push({ query, state: "OK", results: results.length });
      await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status,query_text,pivot_id) values($1,'brave:web-search','WEB_SEARCH_RESULT','OK',$2,$3)", [input.investigationId, query, input.pivotId ?? null]);
      onResults(results);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 120) : "FAILED";
      queries.push({ query, state: "FAILED", results: 0 });
      await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status,query_text,pivot_id) values($1,'brave:web-search','WEB_SEARCH_RESULT',$2,$3,$4)", [input.investigationId, `FAILED ${reason}`.slice(0, 200), query, input.pivotId ?? null]);
      if (/HTTP 429/.test(reason)) stopped = true;
    }
  };

  const collect = (results: readonly SearchResult[]) => {
    for (const result of results) {
      const host = hostOf(result.url);
      const official = Boolean(org.officialDomain && registrableDomain(host) === org.officialDomain);
      if (official) {
        const path = (() => { try { return new URL(result.url).pathname; } catch { return ""; } })();
        if (CHANNEL_PAGE.test(path)) officialPages.set(result.url, "CHANNEL");
        else if (PEOPLE_PAGE.test(path) && !officialPages.has(result.url)) officialPages.set(result.url, "PEOPLE");
      } else if (!NO_FETCH_HOSTS.test(host) && DIRECTORY_PAGE.test(`${result.title} ${result.url}`) && tokens.every((token) => result.title.toLowerCase().includes(token))) {
        directoryPages.add(result.url);
      }
      for (const person of parsePeopleFromSearchResult(result, tokens, org.officialDomain)) {
        const snippet = `${result.title}. ${result.description ?? ""}`;
        rows.push({
          name: person.name, title: person.title, sourceUrl: result.url, provider: "WEB_SEARCH_RESULT", sourceType: person.sourceType, sourceDate: day(result.pageAge),
          currency: evidenceCurrency(person.sourceType, day(result.pageAge), false, now.getTime()), quote: person.quote, email: null, phone: null, location: person.location,
          profileUrl: person.profileUrl, responsibility: RESPONSIBILITY.exec(snippet)?.[0] ?? null,
          basis: person.sourceType === "PROFESSIONAL_PROFILE_LISTING"
            ? `Public profile listing names this person with ${org.name} (listing title only; profile not opened).`
            : `Named together with ${org.name} in the same search result.`,
        });
      }
    }
  };

  // 1. Discovery queries.
  const discovery = [
    ...(org.officialDomain ? [
      `site:${org.officialDomain} (leadership OR team OR "our people" OR management OR staff)`,
      `site:${org.officialDomain} (contact OR locations OR office OR procurement OR suppliers OR subcontractors)`,
    ] : []),
    ...buildPeopleQueries({ organization: org.name, functions: input.functions, location: org.location, project: org.project, type: org.type }),
  ].slice(0, MAX_DISCOVERY_QUERIES);
  for (const query of discovery) await runQuery(query, collect);

  // 2. Confirmation on the official site for people named only in listings/snippets (this run or earlier runs).
  if (org.officialDomain) {
    const earlier = (await client.query<{ person_name: string; title: string | null }>(
      `select person_name, title from contact_candidates where investigation_id=$1 and kind='PERSON' and provider='WEB_SEARCH_RESULT' and person_name is not null
        order by discovered_at, id limit 40`, [input.investigationId])).rows.map((row) => ({ name: row.person_name, title: row.title }));
    const officialNames = new Set(rows.filter((row) => row.provider === "OFFICIAL_WEBSITE" || row.sourceType === "OFFICIAL_SITE").map((row) => row.name.toLowerCase()));
    const toConfirm = [...rows.map((row) => ({ name: row.name, title: row.title })), ...earlier]
      .filter((item) => matchBuyerFunction(item.title, org.type).fn && input.functions.some((fn) => fn.id === matchBuyerFunction(item.title, org.type).fn!.id))
      .filter((item, index, all) => isPlausibleName(item.name) && !officialNames.has(item.name.toLowerCase()) && all.findIndex((other) => other.name === item.name) === index)
      .slice(0, MAX_CONFIRMATION_QUERIES);
    for (const item of toConfirm) await runQuery(`site:${org.officialDomain} "${item.name}"`, collect);
  }

  // 3. Official pages: found pages first (channel pages, then people pages), then standard leadership paths.
  let pages = 0;
  let channels = 0;
  const notes: { url: string; note: string }[] = [];
  if (org.officialDomain) {
    const pathOf = (url: string) => { try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; } catch { return null; } };
    // Pages found by earlier (now cached) queries are remembered from this investigation's own retrieval log.
    const known = (await client.query<{ url: string }>(
      "select distinct url from contact_source_retrievals where investigation_id=$1 and provider='OFFICIAL_WEBSITE' and status='FETCHED'", [input.investigationId])).rows;
    // Pages that already yielded phone lines are channel pages first, whatever their path (e.g. an /about page).
    const yielded = (await client.query<{ source_url: string }>(
      "select distinct source_url from contact_candidates where investigation_id=$1 and kind='PHONE_ROUTE' and source_type is not null", [input.investigationId])).rows.map((item) => item.source_url);
    for (const url of yielded) officialPages.set(url, "CHANNEL");
    for (const { url } of known) {
      const path = pathOf(url) ?? "";
      if (CHANNEL_PAGE.test(path) && !officialPages.has(url)) officialPages.set(url, "CHANNEL");
      else if (PEOPLE_PAGE.test(path) && !officialPages.has(url)) officialPages.set(url, "PEOPLE");
    }
    const entries = [...officialPages.entries()];
    const yieldedPaths = yielded.map((url) => pathOf(url)).filter((path): path is string => Boolean(path));
    const channelPaths = [...new Set([...yieldedPaths, "/contact", ...entries.filter(([, kind]) => kind === "CHANNEL").map(([url]) => pathOf(url)).filter((path): path is string => Boolean(path))])].slice(0, 4);
    const peoplePaths = [...new Set([...entries.filter(([, kind]) => kind === "PEOPLE").map(([url]) => pathOf(url)).filter((path): path is string => Boolean(path)), ...LEADERSHIP_PATHS])];
    const already = await client.query<{ url: string }>(
      "select url from contact_source_retrievals where investigation_id=$1 and provider='OFFICIAL_WEBSITE' and status='FETCHED' and retrieved_at > greatest($2::timestamptz - make_interval(days => $3), $4::timestamptz)",
      [input.investigationId, now.toISOString(), PEOPLE_SEARCH_CACHE_DAYS, PAGE_PARSER_REVISION]);
    // Channel pages are always re-read (office lines change); people pages follow the cache window.
    const fresh = [...channelPaths, ...peoplePaths.filter((path) => !already.rows.some((row) => row.url.replace(/\/$/, "").endsWith(path.replace(/\/$/, ""))))].slice(0, Math.min(MAX_OFFICIAL_PEOPLE_PAGES, input.maxPages ?? Infinity));
    const retrieved = await retrieveOfficialPages(org.officialDomain, fresh, { includeContactPages: false, limit: Math.min(MAX_OFFICIAL_PEOPLE_PAGES, input.maxPages ?? Infinity), fetcher: input.fetcher, spacingMs: input.spacingMs });
    for (const page of retrieved) {
      pages += 1;
      const note = page.text ? departmentEvidence(page.text) : null;
      if (note) notes.push({ url: page.url, note });
      await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status,http_status,evidence_note,pivot_id,content_hash,excerpt) values($1,$2,'OFFICIAL_WEBSITE',$3,$4,$5,$6,$7,$8)",
        [input.investigationId, page.url, page.status, page.httpStatus, note, input.pivotId ?? null, page.text ? contentHash(page.text) : null, page.text ? page.text.slice(0, 20000) : null]);
      if (!page.text) continue;
      const sourceType = sourceTypeOf(page.url, org.officialDomain);
      const published = pageDate(page.text);
      for (const person of parsePeopleFromPage(page.text)) {
        const emailDomain = person.email ? registrableDomain(person.email.split("@")[1] ?? "") : null;
        rows.push({
          name: person.name, title: person.title, sourceUrl: page.url, provider: "OFFICIAL_WEBSITE", sourceType, sourceDate: published,
          currency: evidenceCurrency(sourceType, published, true, now.getTime()), quote: person.quote, location: null, profileUrl: null,
          // An address on another domain is printed in the entry but is not the organization's channel.
          email: person.email && emailDomain === org.officialDomain ? person.email : null, phone: person.phone,
          responsibility: RESPONSIBILITY.exec(`${person.title}. ${person.bio}`)?.[0] ?? null,
          basis: `Listed with this title on the organization's own website (${page.url}).`,
        });
      }
      for (const line of extractOfficeChannels(page.text, page.url, page.title ?? null)) {
        const identity = createHash("sha256").update(`channel|${PAGE_PARSER_REVISION}|${line.phone}|${line.label ?? ""}`).digest("hex");
        const inserted = await client.query<{ id: string }>(
          `insert into contact_candidates(investigation_id,identity_key,kind,title,contact_function,organization,phone,phone_kind,source_url,provider,evidence_quote,attributed,attribution_basis,historical,source_type,evidence_currency,department)
           values($1,$2,'PHONE_ROUTE',$3,$4::contact_function,$5,$6,$7,$8,'OFFICIAL_WEBSITE',$9,true,$10,false,'OFFICIAL_SITE','CURRENT',$11) on conflict (investigation_id, identity_key) do nothing returning id`,
          [input.investigationId, identity, line.label, /procure|purchas|subcontract|supplier|vendor/i.test(line.label ?? "") ? "PROCUREMENT" : "GENERAL_OFFICE", org.name, line.phone,
            line.kind === "UNKNOWN" ? "UNKNOWN" : line.kind, page.url, line.quote, `Published on the organization's own website (${page.url}).`, line.label]);
        channels += inserted.rows.length;
      }
    }
  }

  // 4. Public association/directory pages naming the organization (bounded; robots respected; no brokers).
  const fetcher = input.fetcher ?? safeFetchSource;
  let directoryFetches = 0;
  for (const url of [...directoryPages].slice(0, Math.max(0, Math.min(MAX_DIRECTORY_PAGES, (input.maxPages ?? Infinity) - pages)))) {
    const result = await fetcher(url);
    directoryFetches += 1;
    const page = result.ok ? extractSource(result.body, result.contentType) : null;
    await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status,http_status,pivot_id,content_hash,excerpt) values($1,$2,'WEB_SEARCH_RESULT',$3,$4,$5,$6,$7)",
      [input.investigationId, url, result.ok ? "FETCHED" : result.failure, result.status, input.pivotId ?? null, page ? contentHash(page.text) : null, page ? page.text.slice(0, 20000) : null]);
    if (!result.ok || !page) continue;
    if (!tokens.every((token) => `${page.title ?? ""} ${page.text.slice(0, 3000)}`.toLowerCase().includes(token))) continue;
    for (const person of parsePeopleFromPage(page.text)) {
      rows.push({
        name: person.name, title: person.title, sourceUrl: url, provider: "WEB_SEARCH_RESULT", sourceType: "DIRECTORY_LISTING", sourceDate: null, currency: "UNDATED",
        quote: person.quote, email: null, phone: null, location: null, profileUrl: null, responsibility: null,
        basis: `Listed under ${org.name} in a public directory page (${hostOf(url)}); not the organization's own site.`,
      });
    }
  }

  // 5. Persist each (person, source) as an evidence row. Grouping by person happens at read time.
  let inserted = 0;
  for (const row of rows) {
    const key = personKey(row.name, org.name);
    const fn = matchBuyerFunction(row.title, org.type).fn;
    const project = org.project && row.quote.toLowerCase().includes(org.project.toLowerCase().slice(0, 30)) ? org.project : null;
    const identity = createHash("sha256").update(`${key}|${row.sourceUrl}`).digest("hex");
    const result = await client.query<{ id: string }>(
      `insert into contact_candidates(investigation_id,identity_key,kind,person_name,title,contact_function,organization,email,phone,phone_kind,source_url,provider,evidence_quote,
         attributed,attribution_basis,historical,person_key,source_type,source_date,evidence_currency,department,location,project_relationship,profile_url,responsibility_evidence)
       values($1,$2,'PERSON',$3,$4,$5::contact_function,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,$16,$17::date,$18,$19,$20,$21,$22,$23)
       on conflict (investigation_id, identity_key) do nothing returning id`,
      [input.investigationId, identity, row.name, row.title, fn?.contactFunction ?? "OTHER", org.name, row.email, row.phone, row.phone ? (/ext\./.test(row.phone) ? "EXTENSION" : "UNKNOWN") : null, row.sourceUrl, row.provider,
        row.quote.slice(0, 600), row.basis, row.currency === "HISTORICAL", key, row.sourceType, row.sourceDate, row.currency, fn?.label ?? null, row.location, project, row.profileUrl, row.responsibility]);
    inserted += result.rows.length;
  }
  return { found: inserted, channels, queries, pages: pages + directoryFetches };
}
