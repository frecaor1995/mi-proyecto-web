export const RADAR_CADENCE_OPTIONS_HOURS = [6, 12, 24] as const;
export const DEFAULT_RADAR_CADENCE_HOURS = 6;
export type OpportunitySearchTrigger = "MANUAL" | "SCHEDULED";

export interface OpportunitySearchRequest {
  readonly company: string | null;
  readonly keyword: string | null;
  readonly tradeProfession: string | null;
  readonly location: string | null;
}

export interface OpportunitySearchProfile {
  readonly id: string;
  readonly enabled: boolean;
  readonly request: OpportunitySearchRequest;
  readonly cadenceHours: number;
  readonly nextRunAt: string;
}

function field(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 160);
  return normalized || null;
}

export function parseOpportunitySearchRequest(input: Record<string, unknown>): OpportunitySearchRequest {
  const request = {
    company: field(input.company),
    keyword: field(input.keyword),
    tradeProfession: field(input.tradeProfession),
    location: field(input.location),
  };
  if (!Object.values(request).some(Boolean)) throw new Error("At least one search field is required");
  return request;
}

export function summarizeOpportunitySearch(request: OpportunitySearchRequest): string {
  return [request.company, request.keyword, request.tradeProfession, request.location].filter(Boolean).join(" · ");
}

export function scheduledWindow(at: Date, cadenceHours: number): Date {
  const duration = cadenceHours * 60 * 60 * 1000;
  return new Date(Math.floor(at.getTime() / duration) * duration);
}

export function nextScheduledRun(window: Date, cadenceHours: number): Date {
  return new Date(window.getTime() + cadenceHours * 60 * 60 * 1000);
}
