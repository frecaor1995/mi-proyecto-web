import { defaultWorkerService } from "./default-worker-service";
import type { WorkerLifecycleStatus, WorkerRecord, WorkerTradeOccupationRecord } from "../../domain/worker";
import type { ReadModelCapabilityState } from "../read-models/shared";

export const WORKFORCE_LIST_PAGE_SIZE = 20;

export interface WorkforceListQuery {
  readonly lifecycleStatus: WorkerLifecycleStatus | null;
  readonly tradeCode: string | null;
  readonly occupationCode: string | null;
  readonly page: number;
}

export interface WorkforceListItem {
  readonly worker: WorkerRecord;
  readonly primaryTradeOccupation: WorkerTradeOccupationRecord | null;
  readonly tradeOccupationCount: number;
  readonly availabilityStatus: string | null; // null = UNKNOWN (no record), never coerced to "UNAVAILABLE"
  readonly locationSummary: string | null; // null = UNKNOWN (no record)
  readonly missingTrade: boolean;
  readonly missingAvailability: boolean;
}

export interface WorkforceListResult {
  readonly capability: ReadModelCapabilityState;
  readonly items: readonly WorkforceListItem[];
  readonly authorized: boolean;
  readonly reason: string | null;
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function parseWorkforceListQuery(params: Record<string, string | string[] | undefined>): WorkforceListQuery {
  const lifecycle = one(params.lifecycle).trim().toUpperCase();
  const page = Number.parseInt(one(params.page), 10);
  return {
    lifecycleStatus: lifecycle === "ACTIVE" || lifecycle === "INACTIVE" || lifecycle === "ARCHIVED" ? lifecycle : null,
    tradeCode: one(params.trade).trim() || null,
    occupationCode: one(params.occupation).trim() || null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function workforceListHref(query: WorkforceListQuery, changes: Partial<WorkforceListQuery>): string {
  const next = { ...query, ...changes };
  const params = new URLSearchParams();
  if (next.lifecycleStatus) params.set("lifecycle", next.lifecycleStatus);
  if (next.tradeCode) params.set("trade", next.tradeCode);
  if (next.occupationCode) params.set("occupation", next.occupationCode);
  if (next.page > 1) params.set("page", String(next.page));
  const value = params.toString();
  return value ? `/workforce?${value}` : "/workforce";
}

/**
 * Every field here comes from a WorkerService call, never a raw query.
 * Bounded to WORKFORCE_LIST_PAGE_SIZE workers per page, so the additional
 * per-row calls (trade/occupation, availability, location) stay small --
 * this is a back-office management list, not a high-traffic surface.
 */
export async function getWorkforceListPage(query: WorkforceListQuery): Promise<WorkforceListResult> {
  const service = defaultWorkerService();
  if (!service) return { capability: "UNAVAILABLE", items: [], authorized: false, reason: "DATABASE_CONNECTION_UNAVAILABLE" };

  const offset = (query.page - 1) * WORKFORCE_LIST_PAGE_SIZE;
  const searchResult = await service.searchWorkers({
    lifecycleStatus: query.lifecycleStatus ?? undefined,
    tradeCode: query.tradeCode ?? undefined,
    occupationCode: query.occupationCode ?? undefined,
    limit: WORKFORCE_LIST_PAGE_SIZE,
    offset,
  });
  if (searchResult.kind === "UNAUTHENTICATED" || searchResult.kind === "UNAUTHORIZED") {
    return { capability: "UNAVAILABLE", items: [], authorized: false, reason: searchResult.kind };
  }
  if (searchResult.kind === "VALIDATION_ERROR") {
    return { capability: "UNKNOWN", items: [], authorized: true, reason: "WORKFORCE_QUERY_FAILED" };
  }

  try {
    const items = await Promise.all(searchResult.value.map(async (worker): Promise<WorkforceListItem> => {
      const [tradeOccupationsResult, availabilityResult, locationResult] = await Promise.all([
        service.listTradeOccupations(worker.id),
        service.getCurrentAvailability(worker.id),
        service.getCurrentLocation(worker.id),
      ]);
      const tradeOccupations = tradeOccupationsResult.kind === "OK" ? tradeOccupationsResult.value : [];
      const primaryTradeOccupation = tradeOccupations.find((t) => t.roleDesignation === "PRIMARY") ?? tradeOccupations[0] ?? null;
      const availability = availabilityResult.kind === "OK" ? availabilityResult.value : { state: "UNKNOWN" as const };
      const location = locationResult.kind === "OK" ? locationResult.value : { state: "UNKNOWN" as const };
      return {
        worker,
        primaryTradeOccupation,
        tradeOccupationCount: tradeOccupations.length,
        availabilityStatus: availability.state === "KNOWN" ? availability.value.status : null,
        locationSummary: location.state === "KNOWN" ? [location.value.city, location.value.region].filter(Boolean).join(", ") || null : null,
        missingTrade: tradeOccupations.length === 0,
        missingAvailability: availability.state === "UNKNOWN",
      };
    }));
    return { capability: "OPERATIONAL", items, authorized: true, reason: null };
  } catch {
    return { capability: "UNKNOWN", items: [], authorized: true, reason: "WORKFORCE_QUERY_FAILED" };
  }
}
