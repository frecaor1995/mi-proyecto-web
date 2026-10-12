import { createHash } from "node:crypto";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import {
  ORG_RELATION_KINDS, MAX_PERSON_PIVOTS, MAX_PIVOT_DEPTH, MAX_RESEARCH_PAGES, MAX_RESEARCH_QUERIES, STAGE_QUERY_CAPS, StageNovelty,
  affiliationConflict, canFetch, canQuery, dailyQueryCap, departmentEvidenceKey, extractAddresses, extractOrgRelations, institutionTie, looksLikeInstitution,
  parseInstitutionListing, phoneDigits, pivotKey, queries, rankPeopleForResearch, type ExtractedAddress, type PivotKind, type ResearchBudget,
} from "../../domain/research-pivots";
import {
  departmentEvidence, evidenceCurrency, isPlausibleName, matchBuyerFunction, pageDate, parsePeopleFromPage, parsePeopleFromSearchResult, personKey,
  type BuyerFunction,
} from "../../domain/buyer-intelligence";
import { nameTokens, registrableDomain } from "../../domain/contact-investigation";
import { BraveSearchProvider } from "../company-discovery/brave-search-provider";
import { safeFetchSource } from "../source-enrichment/safe-fetch";
import { extractSource } from "../source-enrichment/source-text";
import { contentHash, discoverPeople, PAGE_PARSER_REVISION, PEOPLE_SEARCH_CACHE_DAYS, type PeopleSearchOrganization, type PeopleSearchOutcome } from "./people-search";

/**
 * Contact Intelligence 2.1A — synchronous iterative research engine.
 *
 * Stage 1 is the accepted 2.0 person/channel search (unchanged behaviour), attached to the root COMPANY pivot.
 * Later stages read what was found and turn each discovery into the next research pivot:
 *   footprint (official pages) → organization relations / locations / addresses / departments
 *   → relation follow-up (related organization's own pages) → local ecosystem (institution member listings)
 *   → address pivots → person pivots (role-aware, prioritized) → channel pivots → procurement route.
 * Every query/page is a retrieval tied to the pivot that generated it; every pivot records its parent, source and
 * research depth. Shared budget per run: 24 queries, 20 pages, depth 3; daily cap configurable (default 60).
 * No company-, person-, address- or institution-specific rule exists here.
 */
type WebSearch = Pick<BraveSearchProvider, "searchWeb" | "configured">;
type SearchResult = Awaited<ReturnType<BraveSearchProvider["searchWeb"]>>[number];
type StageName = "footprint" | "relations" | "ecosystem" | "address" | "person" | "channel" | "procurement";
type StopReason = "DONE" | "NOVELTY" | "STAGE_CAP" | "QUERY_BUDGET" | "PAGE_BUDGET" | "DEPTH" | "DAILY_LIMIT" | "NOT_CONFIGURED" | "RATE_LIMITED" | "NOTHING_TO_DO";

export interface ResearchMetrics {
  readonly queries: number; readonly pages: number; readonly queryCacheHits: number; readonly pageCacheHits: number;
  readonly pivotsCreated: number; readonly duplicatePivotsPrevented: number; readonly sameNameOtherOrganizationIgnored: number;
  readonly runtimeMs: number; readonly stages: Readonly<Record<StageName, { queries: number; pages: number; novel: number; stoppedBy: StopReason }>>;
  readonly dailyLimitHit: boolean; readonly rateLimited: boolean;
}
export interface ResearchOutcome { readonly stage1: PeopleSearchOutcome; readonly metrics: ResearchMetrics }

interface Pivot { readonly id: string; readonly kind: PivotKind; readonly value: string; readonly key: string; readonly depth: number }
interface PageText { readonly url: string; readonly retrievalId: string; readonly text: string; readonly title: string | null }

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
const domainOf = (url: string) => registrableDomain(hostOf(url));

export async function runResearch(client: SqlClient, input: {
  readonly investigationId: string; readonly organization: PeopleSearchOrganization; readonly functions: readonly BuyerFunction[];
  readonly search?: WebSearch; readonly fetcher?: typeof safeFetchSource; readonly spacingMs?: number; readonly now?: Date;
  readonly env?: Record<string, string | undefined>;
  readonly budget?: { readonly maxQueries?: number; readonly maxPages?: number };
}): Promise<ResearchOutcome> {
  const started = Date.now();
  const org = input.organization;
  const now = input.now ?? new Date();
  const search = input.search ?? new BraveSearchProvider();
  const fetcher = input.fetcher ?? safeFetchSource;
  const spacing = input.spacingMs ?? 1100;
  const cap = dailyQueryCap(input.env);
  const budget: ResearchBudget = { queriesUsed: 0, pagesUsed: 0, maxQueries: input.budget?.maxQueries ?? MAX_RESEARCH_QUERIES, maxPages: input.budget?.maxPages ?? MAX_RESEARCH_PAGES };
  const stages = Object.fromEntries((["footprint", "relations", "ecosystem", "address", "person", "channel", "procurement"] as StageName[])
    .map((name) => [name, { queries: 0, pages: 0, novel: 0, stoppedBy: "NOTHING_TO_DO" as StopReason }])) as Record<StageName, { queries: number; pages: number; novel: number; stoppedBy: StopReason }>;
  let queryCacheHits = 0; let pageCacheHits = 0; let pivotsCreated = 0; let duplicatePivotsPrevented = 0; let sameNameIgnored = 0;
  let rateLimited = false; let dailyLimitHit = false;

  // ---- pivots -------------------------------------------------------------------------------------------
  const pivots = new Map<string, Pivot>();
  for (const row of (await client.query<{ id: string; kind: PivotKind; value: string; normalized_key: string; depth: number }>(
    "select id, kind, value, normalized_key, depth from contact_research_pivots where investigation_id=$1", [input.investigationId])).rows) {
    pivots.set(`${row.kind}|${row.normalized_key}`, { id: row.id, kind: row.kind, value: row.value, key: row.normalized_key, depth: Number(row.depth) });
  }
  /** Inserts a pivot once per (kind, key). Returns [pivot, created]. Depth never exceeds MAX_PIVOT_DEPTH. */
  const pivot = async (kind: PivotKind, value: string, parent: Pivot | null, retrievalId: string | null, depth: number): Promise<[Pivot, boolean]> => {
    const key = pivotKey(kind, value).slice(0, 300);
    const existing = pivots.get(`${kind}|${key}`);
    if (existing) { duplicatePivotsPrevented += 1; return [existing, false]; }
    const boundedDepth = Math.min(depth, MAX_PIVOT_DEPTH);
    const rows = (await client.query<{ id: string }>(
      `insert into contact_research_pivots(investigation_id,kind,value,normalized_key,parent_pivot_id,source_retrieval_id,depth)
       values($1,$2,$3,$4,$5,$6,$7) on conflict (investigation_id, kind, normalized_key) do nothing returning id`,
      [input.investigationId, kind, value.slice(0, 300), key, parent?.id ?? null, retrievalId, boundedDepth])).rows;
    if (!rows[0]) { duplicatePivotsPrevented += 1; const id = (await client.query<{ id: string; depth: number }>("select id, depth from contact_research_pivots where investigation_id=$1 and kind=$2 and normalized_key=$3", [input.investigationId, kind, key])).rows[0]; const p = { id: id.id, kind, value, key, depth: Number(id.depth) }; pivots.set(`${kind}|${key}`, p); return [p, false]; }
    const created = { id: rows[0].id, kind, value, key, depth: boundedDepth };
    pivots.set(`${kind}|${key}`, created); pivotsCreated += 1;
    return [created, true];
  };
  const [root] = await pivot("COMPANY", org.name, null, null, 0);

  // ---- retrievals: queries and pages (budgeted, cached, provenance-tagged) -------------------------------
  const dailyUsedAtStart = Number((await client.query<{ n: string | number }>(
    "select count(*) as n from contact_source_retrievals where provider='WEB_SEARCH_RESULT' and query_text is not null and status <> 'CACHED' and retrieved_at > $1::timestamptz - interval '1 day'", [now.toISOString()])).rows[0]?.n ?? 0);
  let dailyUsed = dailyUsedAtStart;
  const runQuery = async (stage: StageName, query: string, from: Pivot): Promise<{ results: readonly SearchResult[]; retrievalId: string | null; stop: StopReason | null }> => {
    if (from.depth >= MAX_PIVOT_DEPTH) return { results: [], retrievalId: null, stop: "DEPTH" };
    const cached = await client.query<{ n: string | number }>(
      `select count(*) as n from contact_source_retrievals where investigation_id=$1 and provider='WEB_SEARCH_RESULT' and query_text=$2 and status='OK'
         and retrieved_at > $3::timestamptz - make_interval(days => $4)`, [input.investigationId, query, now.toISOString(), PEOPLE_SEARCH_CACHE_DAYS]);
    if (Number(cached.rows[0]?.n ?? 0) > 0) { queryCacheHits += 1; return { results: [], retrievalId: null, stop: null }; }
    if (!search.configured) return { results: [], retrievalId: null, stop: "NOT_CONFIGURED" };
    if (rateLimited) return { results: [], retrievalId: null, stop: "RATE_LIMITED" };
    if (!canQuery(budget)) return { results: [], retrievalId: null, stop: "QUERY_BUDGET" };
    if (dailyUsed >= cap) { dailyLimitHit = true; return { results: [], retrievalId: null, stop: "DAILY_LIMIT" }; }
    if (spacing > 0) await new Promise((resolve) => setTimeout(resolve, spacing));
    budget.queriesUsed += 1; dailyUsed += 1; stages[stage].queries += 1;
    try {
      const results = await search.searchWeb(query, 10);
      const id = (await client.query<{ id: string }>(
        "insert into contact_source_retrievals(investigation_id,url,provider,status,query_text,pivot_id) values($1,'brave:web-search','WEB_SEARCH_RESULT','OK',$2,$3) returning id",
        [input.investigationId, query, from.id])).rows[0].id;
      return { results, retrievalId: id, stop: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 120) : "FAILED";
      await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status,query_text,pivot_id) values($1,'brave:web-search','WEB_SEARCH_RESULT',$2,$3,$4)",
        [input.investigationId, `FAILED ${reason}`.slice(0, 200), query, from.id]);
      if (/HTTP 429/.test(reason)) { rateLimited = true; return { results: [], retrievalId: null, stop: "RATE_LIMITED" }; }
      return { results: [], retrievalId: null, stop: null };
    }
  };
  /** Fetch one page through the safe fetcher, or reuse a cached reading (same URL, current parser revision, 7 days). */
  const fetchPage = async (stage: StageName, url: string, from: Pivot, official: boolean, note?: (text: string) => string | null): Promise<PageText | null> => {
    const cached = (await client.query<{ id: string; excerpt: string }>(
      `select id, excerpt from contact_source_retrievals where investigation_id=$1 and url=$2 and status='FETCHED' and excerpt is not null
         and retrieved_at > greatest($3::timestamptz - make_interval(days => $4), $5::timestamptz) order by retrieved_at desc limit 1`,
      [input.investigationId, url, now.toISOString(), PEOPLE_SEARCH_CACHE_DAYS, PAGE_PARSER_REVISION])).rows[0];
    if (cached) { pageCacheHits += 1; return { url, retrievalId: cached.id, text: cached.excerpt, title: null }; }
    if (!canFetch(budget)) return null;
    budget.pagesUsed += 1; stages[stage].pages += 1;
    const result = await fetcher(url);
    const page = result.ok ? extractSource(result.body, result.contentType) : null;
    const id = (await client.query<{ id: string }>(
      `insert into contact_source_retrievals(investigation_id,url,provider,status,http_status,pivot_id,content_hash,excerpt,evidence_note)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [input.investigationId, result.ok ? result.finalUrl : url, official ? "OFFICIAL_WEBSITE" : "WEB_SEARCH_RESULT", result.ok ? "FETCHED" : result.failure, result.status,
        from.id, page ? contentHash(page.text) : null, page ? page.text.slice(0, 20000) : null, page && note ? note(page.text) : null])).rows[0].id;
    return page ? { url: result.ok ? result.finalUrl : url, retrievalId: id, text: page.text, title: page.title } : null;
  };

  // ---- evidence rows (persons) --------------------------------------------------------------------------
  const insertPerson = async (row: { name: string; title: string | null; sourceUrl: string; sourceType: "DIRECTORY_LISTING" | "PROFESSIONAL_PROFILE_LISTING" | "NEWS_ARTICLE" | "OFFICIAL_SITE" | "PRESS_RELEASE";
    sourceDate: string | null; quote: string; phone: string | null; location: string | null; profileUrl: string | null; basis: string }) => {
    const key = personKey(row.name, org.name);
    const fn = matchBuyerFunction(row.title, org.type).fn;
    const currency = evidenceCurrency(row.sourceType, row.sourceDate, row.sourceType === "OFFICIAL_SITE", now.getTime());
    const identity = createHash("sha256").update(`${key}|${row.sourceUrl}`).digest("hex");
    const rows = (await client.query<{ id: string }>(
      `insert into contact_candidates(investigation_id,identity_key,kind,person_name,title,contact_function,organization,phone,phone_kind,source_url,provider,evidence_quote,
         attributed,attribution_basis,historical,person_key,source_type,source_date,evidence_currency,department,location,profile_url)
       values($1,$2,'PERSON',$3,$4,$5::contact_function,$6,$7,$8,$9,'WEB_SEARCH_RESULT',$10,true,$11,$12,$13,$14,$15::date,$16,$17,$18,$19)
       on conflict (investigation_id, identity_key) do nothing returning id`,
      [input.investigationId, identity, row.name, row.title, fn?.contactFunction ?? "OTHER", org.name, row.phone, row.phone ? "UNKNOWN" : null, row.sourceUrl, row.quote.slice(0, 600),
        row.basis.slice(0, 600), currency === "HISTORICAL", key, row.sourceType, row.sourceDate, currency, fn?.label ?? null, row.location, row.profileUrl])).rows;
    return rows.length;
  };

  // ======================= STAGE 1: accepted 2.0 search (root pivot) ======================================
  const stage1 = await discoverPeople(client, {
    investigationId: input.investigationId, organization: org, functions: input.functions, search, fetcher: input.fetcher, spacingMs: input.spacingMs, now,
    pivotId: root.id, dailyCap: cap, maxQueries: budget.maxQueries, maxPages: budget.maxPages,
  });
  const stage1Queries = stage1.queries.filter((q) => q.state === "OK" || q.state === "FAILED").length;
  budget.queriesUsed += stage1Queries; dailyUsed += stage1Queries; budget.pagesUsed += stage1.pages;
  queryCacheHits += stage1.queries.filter((q) => q.state === "CACHED").length;
  if (stage1.queries.some((q) => q.state === "DAILY_LIMIT")) dailyLimitHit = true;

  // ======================= FOOTPRINT: official pages → relations, locations, addresses, departments ========
  const names = [org.name];
  const addresses: (ExtractedAddress & { pivot: Pivot })[] = [];
  const locations = new Map<string, Pivot>();
  const relations: Pivot[] = [...pivots.values()].filter((p) => ORG_RELATION_KINDS.includes(p.kind));
  for (const p of relations) if (!names.includes(p.value)) names.push(p.value);
  const addLocationAndAddress = async (address: ExtractedAddress, parent: Pivot, retrievalId: string, depth: number) => {
    const [location, newLocation] = await pivot("LOCATION", address.location, parent, retrievalId, depth);
    locations.set(address.location, location);
    const [addressPivot, newAddress] = await pivot("ADDRESS", address.key, location, retrievalId, depth);
    if (!addresses.some((a) => a.key === address.key)) addresses.push({ ...address, pivot: addressPivot });
    return Number(newLocation) + Number(newAddress);
  };
  const addRelations = async (text: string, parent: Pivot, retrievalId: string, depth: number) => {
    let novel = 0;
    for (const relation of extractOrgRelations(text, org.name, names.slice(1))) {
      const [p, created] = await pivot(relation.kind, relation.name, parent, retrievalId, depth);
      if (created) { novel += 1; relations.push(p); if (!names.includes(relation.name)) names.push(relation.name); }
    }
    return novel;
  };
  const officialPages = (await client.query<{ id: string; url: string; excerpt: string; evidence_note: string | null }>(
    `select distinct on (url) id, url, excerpt, evidence_note from contact_source_retrievals
      where investigation_id=$1 and provider='OFFICIAL_WEBSITE' and status='FETCHED' and excerpt is not null order by url, retrieved_at desc`, [input.investigationId])).rows;
  for (const page of officialPages) {
    let novel = 0;
    for (const address of extractAddresses(page.excerpt)) novel += await addLocationAndAddress(address, root, page.id, 1);
    novel += await addRelations(page.excerpt, root, page.id, 1);
    if (page.evidence_note) { const [, created] = await pivot("DEPARTMENT", departmentEvidenceKey(page.url), root, page.id, 1); novel += Number(created); }
    stages.footprint.novel += novel;
  }
  stages.footprint.stoppedBy = officialPages.length ? "DONE" : "NOTHING_TO_DO";
  // Rank addresses: those whose location has the most official addresses first (operational concentration).
  const locationWeight = (location: string) => addresses.filter((a) => a.location === location).length;

  // Institutions found anywhere are processed the same way (ecosystem, address and relation stages).
  const institutionsSeen = new Set<string>();
  const processInstitutionResults = async (stage: StageName, results: readonly SearchResult[], from: Pivot, queryRetrievalId: string | null) => {
    let novel = 0;
    // The organization's own site is never a third-party institution (it is read as official footprint instead).
    const ownDomain = org.officialDomain ? registrableDomain(org.officialDomain.toLowerCase()) : null;
    const candidates = results.filter((r) => looksLikeInstitution(r) && domainOf(r.url) !== ownDomain && names.some((name) => `${r.title} ${r.description ?? ""}`.toLowerCase().includes(name.toLowerCase().split(" ")[0])))
      .sort((a, b) => Number(/\/(list\/member|member|directory|details)\b/i.test(b.url)) - Number(/\/(list\/member|member|directory|details)\b/i.test(a.url)));
    for (const result of candidates) {
      const key = pivotKey("INSTITUTION", result.url);
      if (institutionsSeen.has(key)) continue;
      institutionsSeen.add(key);
      const page = await fetchPage(stage, result.url, from, false);
      if (!page) { if (!canFetch(budget)) break; continue; }
      const tie = institutionTie(page.text, { names, addresses, locations: [...locations.keys()], officialDomain: org.officialDomain });
      if (!tie.tied) continue;
      // Provenance: the institution hangs off the known place that ties it to the organization (same street address,
      // else same location), not off whichever pivot happened to issue the query. Depth still counts the query hop.
      const pageAddresses = extractAddresses(page.text);
      const tiedAddress = addresses.find((a) => pageAddresses.some((b) => b.key === a.key));
      const tiedLocation = [...locations.entries()].find(([loc]) => tie.basis.includes(`located in ${loc}`))?.[1];
      const parent = tiedAddress?.pivot ?? tiedLocation ?? from;
      const [institution, created] = await pivot("INSTITUTION", result.url, parent, page.retrievalId ?? queryRetrievalId, from.depth + 1);
      novel += Number(created);
      const focused = names.some((name) => `${result.title} ${page.title ?? ""}`.toLowerCase().includes(name.toLowerCase()));
      const published = pageDate(page.text);
      for (const address of extractAddresses(page.text)) novel += await addLocationAndAddress(address, institution, page.retrievalId, institution.depth);
      for (const person of parseInstitutionListing(page.text, names, focused, parsePeopleFromPage, isPlausibleName)) {
        const [personPivot, newPerson] = await pivot("PERSON", person.name, institution, page.retrievalId, institution.depth);
        novel += Number(newPerson);
        novel += await insertPerson({
          name: person.name, title: person.title, sourceUrl: page.url, sourceType: "DIRECTORY_LISTING", sourceDate: published, quote: person.quote, phone: person.phone,
          location: tie.basis.find((b) => b.startsWith("located in"))?.slice("located in ".length) ?? null, profileUrl: null,
          basis: `Listed by ${hostOf(page.url)} as a contact for ${org.name} (${tie.basis.join("; ")}).`,
        });
        if (person.phone) { const [, newChannel] = await pivot("CHANNEL", person.phone, personPivot, page.retrievalId, institution.depth); novel += Number(newChannel); }
      }
    }
    return novel;
  };

  // ======================= RELATIONS: dedicated query + follow-up of each relation =========================
  {
    const novelty = new StageNovelty(STAGE_QUERY_CAPS.relations + 2);
    if (!relations.length) {
      const { results, retrievalId, stop } = await runQuery("relations", queries.relations(org.name), root);
      if (stop) stages.relations.stoppedBy = stop;
      let novel = 0;
      for (const r of results) if (retrievalId) novel += await addRelations(`${r.title}. ${r.description ?? ""}`, root, retrievalId, root.depth + 1);
      novelty.record(novel); stages.relations.novel += novel;
    }
    // follow each relation once to the related organization's own pages
    for (const relation of relations.slice(0, 2)) {
      if (!novelty.open) { stages.relations.stoppedBy = "NOVELTY"; break; }
      const { results, stop } = await runQuery("relations", queries.relationFollowUp(relation.value, org.name), relation);
      if (stop) { stages.relations.stoppedBy = stop; if (stop !== "DEPTH") break; continue; }
      const own = results.filter((r) => !looksLikeInstitution(r) && hostOf(r.url) && !/(linkedin|zoominfo|rocketreach|signalhire|facebook|wikipedia|indeed|glassdoor)\./i.test(hostOf(r.url))
        && r.title.toLowerCase().includes(relation.value.toLowerCase()) && (!org.officialDomain || domainOf(r.url) !== org.officialDomain))
        .sort((a, b) => Number(/about/i.test(b.url)) - Number(/about/i.test(a.url)));
      let novel = 0;
      const target = own[0];
      if (target) {
        const page = await fetchPage("relations", target.url, relation, false);
        if (page) {
          novel += await addRelations(page.text, relation, page.retrievalId, relation.depth + 1);
          for (const address of extractAddresses(page.text)) novel += await addLocationAndAddress(address, relation, page.retrievalId, relation.depth + 1);
        }
      }
      novelty.record(novel); stages.relations.novel += novel;
    }
    if (stages.relations.stoppedBy === "NOTHING_TO_DO" && stages.relations.queries) stages.relations.stoppedBy = "DONE";
  }

  // ======================= ECOSYSTEM: state level first, then city level on novelty ========================
  {
    const novelty = new StageNovelty(STAGE_QUERY_CAPS.ecosystem);
    const states = [...new Set([...locations.keys()].map((l) => l.split(",")[1]?.trim()).filter(Boolean))]
      .sort((a, b) => [...locations.keys()].filter((l) => l.endsWith(b)).length - [...locations.keys()].filter((l) => l.endsWith(a)).length);
    const plan: { query: string; from: Pivot }[] = [];
    for (const state of states.slice(0, 2)) { const from = [...locations.entries()].find(([l]) => l.endsWith(state))?.[1]; if (from) plan.push({ query: queries.ecosystemState(org.name, state), from }); }
    for (const [location, from] of [...locations.entries()].sort((a, b) => locationWeight(b[0]) - locationWeight(a[0])).slice(0, 2)) plan.push({ query: queries.ecosystemCity(org.name, location), from });
    for (const step of plan) {
      if (!novelty.open) { stages.ecosystem.stoppedBy = "NOVELTY"; break; }
      const { results, retrievalId, stop } = await runQuery("ecosystem", step.query, step.from);
      if (stop) { stages.ecosystem.stoppedBy = stop; if (stop === "DEPTH") continue; break; }
      const novel = await processInstitutionResults("ecosystem", results, step.from, retrievalId);
      novelty.record(novel); stages.ecosystem.novel += novel;
    }
    if (stages.ecosystem.stoppedBy === "NOTHING_TO_DO" && stages.ecosystem.queries) stages.ecosystem.stoppedBy = plan.length ? "DONE" : "NOTHING_TO_DO";
  }

  // ======================= ADDRESS PIVOTS: exact address + city ===========================================
  {
    const novelty = new StageNovelty(STAGE_QUERY_CAPS.address);
    // addresses confirmed by more than one source (official + institution/related) first, then by location weight
    const confirmed = (a: ExtractedAddress) => (addresses.filter((b) => b.key === a.key).length > 1 ? 1 : 0);
    const ranked = addresses.slice().sort((a, b) => confirmed(b) - confirmed(a) || locationWeight(b.location) - locationWeight(a.location));
    for (const address of ranked) {
      if (!novelty.open) { stages.address.stoppedBy = "NOVELTY"; break; }
      const { results, retrievalId, stop } = await runQuery("address", queries.address(address), address.pivot);
      if (stop) { stages.address.stoppedBy = stop; if (stop === "DEPTH") continue; break; }
      let novel = 0;
      // an address result counts only when it repeats the address AND names the organization (other tenants are ignored)
      const relevant = results.filter((r) => `${r.title} ${r.description ?? ""}`.toLowerCase().includes(address.number) && names.some((n) => `${r.title} ${r.description ?? ""}`.toLowerCase().includes(n.toLowerCase().split(" ")[0])));
      for (const r of relevant) if (retrievalId) novel += await addRelations(`${r.title}. ${r.description ?? ""}`, address.pivot, retrievalId, address.pivot.depth + 1);
      novel += await processInstitutionResults("address", relevant, address.pivot, retrievalId);
      novelty.record(novel); stages.address.novel += novel;
    }
    if (stages.address.stoppedBy === "NOTHING_TO_DO" && stages.address.queries) stages.address.stoppedBy = "DONE";
  }
  // relations discovered by address pivots are followed once (same rule as above, bounded by depth)
  for (const relation of relations.filter((r) => r.depth >= 2).slice(0, 1)) {
    const { results, stop } = await runQuery("relations", queries.relationFollowUp(relation.value, org.name), relation);
    if (stop) continue;
    const target = results.filter((r) => r.title.toLowerCase().includes(relation.value.toLowerCase()) && !looksLikeInstitution(r) && (!org.officialDomain || domainOf(r.url) !== org.officialDomain)
      && !/(linkedin|zoominfo|rocketreach|signalhire|facebook|wikipedia|indeed|glassdoor)\./i.test(hostOf(r.url))).sort((a, b) => Number(/about/i.test(b.url)) - Number(/about/i.test(a.url)))[0];
    if (!target) continue;
    const page = await fetchPage("relations", target.url, relation, false);
    if (!page) continue;
    let novel = await addRelations(page.text, relation, page.retrievalId, Math.min(relation.depth + 1, MAX_PIVOT_DEPTH));
    for (const address of extractAddresses(page.text)) novel += await addLocationAndAddress(address, relation, page.retrievalId, Math.min(relation.depth + 1, MAX_PIVOT_DEPTH));
    stages.relations.novel += novel;
    if (stages.relations.stoppedBy === "NOTHING_TO_DO") stages.relations.stoppedBy = "DONE";
  }

  // ======================= PERSON PIVOTS: prioritized by function, role-aware queries =====================
  {
    const novelty = new StageNovelty(STAGE_QUERY_CAPS.person);
    const people = (await client.query<{ person_name: string; title: string | null; evidence_currency: "CURRENT" | "HISTORICAL" | "UNDATED" | null; source_url: string }>(
      "select person_name, title, evidence_currency, source_url from contact_candidates where investigation_id=$1 and kind='PERSON' and person_name is not null", [input.investigationId])).rows;
    const grouped = new Map<string, { name: string; title: string | null; currency: "CURRENT" | "HISTORICAL" | "UNDATED"; domains: Set<string> }>();
    for (const row of people) {
      if (!isPlausibleName(row.person_name)) continue;
      const k = personKey(row.person_name, org.name);
      const g = grouped.get(k) ?? { name: row.person_name, title: row.title, currency: "UNDATED" as const, domains: new Set<string>() };
      g.domains.add(domainOf(row.source_url));
      const c = row.evidence_currency ?? "UNDATED";
      if (c === "CURRENT" || (c === "UNDATED" && g.currency === "HISTORICAL")) g.currency = c;
      if (!g.title && row.title) g.title = row.title;
      grouped.set(k, g);
    }
    const ranked = rankPeopleForResearch([...grouped.values()].map((g) => ({ ...g, domains: g.domains.size }))).slice(0, MAX_PERSON_PIVOTS);
    const alias = relations.find((r) => r.kind !== "ORG_JOINT_VENTURE")?.value ?? null;
    for (const person of ranked) {
      if (!novelty.open) { stages.person.stoppedBy = "NOVELTY"; break; }
      const [personPivot] = await pivot("PERSON", person.name, root, null, 1);
      for (const attempt of [0, 1] as const) {
        if (attempt === 1 && !alias) break;
        const { results, retrievalId, stop } = await runQuery("person", queries.person(person.name, org.name, person.title, attempt, alias), personPivot);
        if (stop) { stages.person.stoppedBy = stop; break; }
        let novel = 0;
        for (const result of results) {
          if (!retrievalId) break;
          const conflict = affiliationConflict(result, person.name, names);
          if (conflict) {
            await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status,pivot_id,evidence_note) values($1,$2,'WEB_SEARCH_RESULT','EVIDENCE',$3,$4)",
              [input.investigationId, result.url, personPivot.id, `AFFILIATION_CONFLICT: ${conflict}`.slice(0, 600)]);
            novel += 1; continue;
          }
          const tokens = nameTokens(org.name).slice(0, 2);
          const parsed = parsePeopleFromSearchResult(result, tokens, org.officialDomain).filter((p) => personKey(p.name, org.name) === personKey(person.name, org.name));
          if (!parsed.length && `${result.title} ${result.description ?? ""}`.toLowerCase().includes(person.name.toLowerCase())) { sameNameIgnored += 1; continue; }
          for (const p of parsed) {
            novel += await insertPerson({
              name: p.name, title: p.title, sourceUrl: result.url, sourceType: p.sourceType === "OFFICIAL_SITE" ? "OFFICIAL_SITE" : p.sourceType === "PROFESSIONAL_PROFILE_LISTING" ? "PROFESSIONAL_PROFILE_LISTING" : p.sourceType === "DIRECTORY_LISTING" ? "DIRECTORY_LISTING" : "NEWS_ARTICLE",
              sourceDate: result.pageAge ? result.pageAge.slice(0, 10) : null, quote: p.quote, phone: null, location: p.location, profileUrl: p.profileUrl,
              basis: `Person pivot: ${p.sourceType === "PROFESSIONAL_PROFILE_LISTING" || p.sourceType === "DIRECTORY_LISTING" ? "public listing (search-result text only)" : "search result"} naming this person with ${org.name}.`,
            });
          }
        }
        novelty.record(novel); stages.person.novel += novel;
        if (!novel) break;
      }
    }
    if (stages.person.stoppedBy === "NOTHING_TO_DO" && stages.person.queries) stages.person.stoppedBy = "DONE";
  }

  // ======================= CHANNEL PIVOTS: numbers whose line type is unknown ==============================
  {
    const novelty = new StageNovelty(STAGE_QUERY_CAPS.channel);
    const official = new Set((await client.query<{ phone: string }>(
      "select phone from contact_candidates where investigation_id=$1 and kind='PHONE_ROUTE' and phone is not null", [input.investigationId])).rows.map((r) => phoneDigits(r.phone)));
    const unknown = [...pivots.values()].filter((p) => p.kind === "CHANNEL" && !official.has(p.key) && p.depth < MAX_PIVOT_DEPTH);
    for (const channel of unknown) {
      if (!novelty.open) { stages.channel.stoppedBy = "NOVELTY"; break; }
      const { results, stop } = await runQuery("channel", queries.channel(channel.value, org.name), channel);
      if (stop) { stages.channel.stoppedBy = stop; break; }
      let novel = 0;
      for (const r of results.filter((x) => phoneDigits(`${x.title} ${x.description ?? ""}`.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}/g)?.join(" ") ?? "").includes(channel.key))) {
        await client.query("insert into contact_source_retrievals(investigation_id,url,provider,status,pivot_id,evidence_note) values($1,$2,'WEB_SEARCH_RESULT','EVIDENCE',$3,$4)",
          [input.investigationId, r.url, channel.id, `CHANNEL_SEEN: ${channel.value} published on ${domainOf(r.url)} — ${r.title}`.slice(0, 600)]);
        novel += 1;
      }
      novelty.record(novel); stages.channel.novel += novel;
    }
    if (stages.channel.stoppedBy === "NOTHING_TO_DO" && stages.channel.queries) stages.channel.stoppedBy = "DONE";
  }

  // ======================= PROCUREMENT / SUPPLIER ROUTE ===================================================
  if (org.officialDomain && ![...pivots.values()].some((p) => p.kind === "DEPARTMENT")) {
    const { results, stop } = await runQuery("procurement", queries.procurement(org.officialDomain), root);
    stages.procurement.stoppedBy = stop ?? "DONE";
    const target = results.find((r) => domainOf(r.url) === org.officialDomain && /procure|supplier|vendor|subcontract|purchas/i.test(`${r.url} ${r.title}`) && !/\.pdf$/i.test(r.url));
    if (target) {
      const page = await fetchPage("procurement", target.url, root, true, departmentEvidence);
      const note = page ? departmentEvidence(page.text) : null;
      if (page && note) { const [, created] = await pivot("DEPARTMENT", departmentEvidenceKey(page.url), root, page.retrievalId, 1); stages.procurement.novel += Number(created); }
      stages.procurement.stoppedBy = "DONE";
    }
  }

  return {
    stage1,
    metrics: {
      queries: budget.queriesUsed, pages: budget.pagesUsed, queryCacheHits, pageCacheHits, pivotsCreated, duplicatePivotsPrevented, sameNameOtherOrganizationIgnored: sameNameIgnored,
      runtimeMs: Date.now() - started, stages, dailyLimitHit, rateLimited,
    },
  };
}
