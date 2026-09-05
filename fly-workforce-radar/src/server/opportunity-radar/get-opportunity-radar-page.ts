import type { OpportunityRadarItem } from "../read-models/opportunity-radar";
import type { ReadModelCapabilityState, ReadModelCurrentness, ReadModelTrustState } from "../read-models/shared";
import { assembleOpportunityRadarItem } from "../read-models/opportunity-radar";
import { getProductionSqlClient } from "../database/production-sql-client";
import { PostgresOpportunityRepository } from "../repositories/opportunity/postgres-opportunity-repository";

export const OPPORTUNITY_RADAR_PAGE_SIZE = 25;
export const RADAR_SORTS = ["company", "project"] as const;
export const RADAR_STATES = ["all", "hot", "near-ready", "other"] as const;
export const RADAR_ACCEPTANCE = ["all", "accepted", "not-accepted", "unknown", "unavailable"] as const;
export type RadarSort = (typeof RADAR_SORTS)[number];
export type RadarStateFilter = (typeof RADAR_STATES)[number];
export type RadarAcceptanceFilter = (typeof RADAR_ACCEPTANCE)[number];
export interface OpportunityRadarQuery { readonly search: string; readonly state: RadarStateFilter; readonly verification: ReadModelTrustState | "all"; readonly acceptance: RadarAcceptanceFilter; readonly currentness: ReadModelCurrentness | "all"; readonly sort: RadarSort; readonly page: number; }
export interface OpportunityRadarSourceResult { readonly capability: ReadModelCapabilityState; readonly items: readonly OpportunityRadarItem[]; readonly reason: string | null; }
export interface OpportunityRadarPageResult extends OpportunityRadarSourceResult { readonly pageItems: readonly OpportunityRadarItem[]; readonly filteredCount: number | null; readonly pageCount: number | null; }
function one(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

export function parseOpportunityRadarQuery(params: Record<string, string | string[] | undefined>): OpportunityRadarQuery {
  const sort = one(params.sort), page = Number.parseInt(one(params.page), 10);
  return { search: one(params.q).trim().slice(0, 120), state: "all", verification: "all", acceptance: "all", currentness: "all", sort: RADAR_SORTS.includes(sort as RadarSort) ? sort as RadarSort : "company", page: Number.isFinite(page) && page > 0 ? page : 1 };
}
export function radarCommercialState(item: OpportunityRadarItem): RadarStateFilter { const type = item.readiness?.eligibilityType.toUpperCase() ?? ""; return type.includes("HOT") ? "hot" : type.includes("NEAR_READY") ? "near-ready" : "other"; }
export function radarAcceptanceState(item: OpportunityRadarItem): Exclude<RadarAcceptanceFilter, "all"> { return !item.externalManpowerAcceptance ? "unavailable" : item.externalManpowerAcceptance.accepted === true ? "accepted" : item.externalManpowerAcceptance.accepted === false ? "not-accepted" : "unknown"; }
export function applyOpportunityRadarQuery(items: readonly OpportunityRadarItem[], query: OpportunityRadarQuery): OpportunityRadarPageResult {
  const needle = query.search.toLocaleLowerCase("en-US");
  const filtered = items.filter(item => { const searchable = [item.companyName, item.title, item.projectRef, item.location, item.tradeId, item.occupationId].filter(Boolean).join(" ").toLocaleLowerCase("en-US"); return (!needle || searchable.includes(needle)) && (query.state === "all" || radarCommercialState(item) === query.state) && (query.verification === "all" || item.verificationState === query.verification) && (query.acceptance === "all" || radarAcceptanceState(item) === query.acceptance) && (query.currentness === "all" || item.currentness === query.currentness); });
  const sorted = [...filtered].sort((a, b) => { const av = query.sort === "project" ? a.title ?? a.projectRef ?? "" : a.companyName ?? ""; const bv = query.sort === "project" ? b.title ?? b.projectRef ?? "" : b.companyName ?? ""; return av.localeCompare(bv) || a.identityKey.localeCompare(b.identityKey); });
  const pageCount = Math.max(1, Math.ceil(sorted.length / OPPORTUNITY_RADAR_PAGE_SIZE)), page = Math.min(query.page, pageCount), start = (page - 1) * OPPORTUNITY_RADAR_PAGE_SIZE;
  return { capability: "OPERATIONAL", items, reason: null, pageItems: sorted.slice(start, start + OPPORTUNITY_RADAR_PAGE_SIZE), filteredCount: sorted.length, pageCount };
}
/** Canonical repositories load an opportunity by id but cannot enumerate opportunities. */
export async function loadOpportunityRadarSource(query: OpportunityRadarQuery): Promise<OpportunityRadarPageResult> { const client = getProductionSqlClient(); if (!client) return { capability: "UNAVAILABLE", items: [], reason: "DATABASE_CONNECTION_UNAVAILABLE", pageItems: [], filteredCount: null, pageCount: null }; const repository = new PostgresOpportunityRepository(client), asOf = new Date(), offset = (query.page - 1) * OPPORTUNITY_RADAR_PAGE_SIZE; const result = await repository.enumerate({ search: query.search, sort: query.sort, currentness: "all", asOf, limit: OPPORTUNITY_RADAR_PAGE_SIZE, offset }); const items = result.items.map(entry => assembleOpportunityRadarItem({ opportunity: entry.opportunity, company: entry.company, location: entry.location, asOf })); return { capability: "OPERATIONAL", items, reason: null, pageItems: items, filteredCount: result.total, pageCount: Math.max(1, Math.ceil(result.total / OPPORTUNITY_RADAR_PAGE_SIZE)) }; }
export async function getOpportunityRadarPage(query: OpportunityRadarQuery, load: (query: OpportunityRadarQuery) => Promise<OpportunityRadarPageResult> = loadOpportunityRadarSource): Promise<OpportunityRadarPageResult> { try { return await load(query); } catch { return { capability: "UNKNOWN", items: [], reason: "OPPORTUNITY_QUERY_FAILED", pageItems: [], filteredCount: null, pageCount: null }; } }
export function opportunityRadarHref(query: OpportunityRadarQuery, changes: Partial<OpportunityRadarQuery>): string { const next = { ...query, ...changes }, params = new URLSearchParams(); if (next.search) params.set("q", next.search); if (next.state !== "all") params.set("status", next.state); if (next.verification !== "all") params.set("verification", next.verification); if (next.acceptance !== "all") params.set("acceptance", next.acceptance); if (next.currentness !== "all") params.set("currentness", next.currentness); if (next.sort !== "company") params.set("sort", next.sort); if (next.page > 1) params.set("page", String(next.page)); const value = params.toString(); return value ? `/opportunities?${value}` : "/opportunities"; }
