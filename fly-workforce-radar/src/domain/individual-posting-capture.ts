import { createHash } from "node:crypto";
import type { PostingRelationship } from "./aggregator-decomposition";

export const RECIPE_1_1_LIMITS = { externalRequests: 10, postings: 20, additionalCostUsd: 0 } as const;
export interface CaptureLimits { externalRequests: number; postings: number; additionalCostUsd: number; }
export type SourceAccessDecision = "ALLOWED" | "NOT_ALLOWED" | "UNCONFIRMED";

export interface PostingCaptureRequest {
  profession: string; geography: string; query: string; source: string; maximumResults: number;
  maximumExternalRequests: number; costCeilingUsd: number; maximumRuntimeMs: number; captureMethod: "PUBLIC_HTTP" | "PUBLIC_API";
  recipeIdentity: string; parentAggregateObservationId: string | null; runId: string; queryId: string | null; operatorAuthorization: string;
}

export interface CapturedPosting {
  sourceUrl: string; normalizedUrl: string; externalPostingId: string | null; employerName: string | null; title: string | null;
  profession: string | null; professionalLevel: string | null; location: string | null; compensation: string | null; perDiem: string | null;
  experience: string | null; licenses: readonly string[]; certifications: readonly string[]; postingDate: string | null;
  explicitEmployerHeadcount: number | null; applicationUrl: string | null; relationship: PostingRelationship; vendorAcceptance: "UNKNOWN";
  capturedAt: string; evidenceExcerpt: string; evidenceCompleteness: "COMPLETE" | "PARTIAL"; parentAggregateObservationId: string | null;
}

export class CaptureBudget {
  private requests = 0; private postings = 0; private cost = 0;
  constructor(readonly limits: CaptureLimits = RECIPE_1_1_LIMITS) {}
  reserveRequest(knownCostUsd: number | null) {
    if (knownCostUsd === null) throw new Error("UNKNOWN_PROVIDER_PRICE");
    if (knownCostUsd < 0 || this.cost + knownCostUsd > this.limits.additionalCostUsd) throw new Error("COST_CEILING_EXCEEDED");
    if (this.requests >= this.limits.externalRequests) throw new Error("REQUEST_LIMIT_EXCEEDED");
    this.requests += 1; this.cost += knownCostUsd;
  }
  acceptPosting() { if (this.postings >= this.limits.postings) throw new Error("POSTING_LIMIT_EXCEEDED"); this.postings += 1; }
  snapshot() { return { requestsUsed: this.requests, postingsCaptured: this.postings, additionalCostUsd: this.cost }; }
}

const tracking = /^(?:utm_.+|fbclid|gclid|msclkid|ref|source)$/i;
export function canonicalPostingUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return null;
    url.hostname = host; url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (tracking.test(key)) url.searchParams.delete(key);
    url.searchParams.sort(); if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch { return null; }
}

export const postingIdentity = (source: string, externalId: string | null, normalizedUrl: string) =>
  createHash("sha256").update(`${source}\0${externalId ? `id:${externalId}` : `url:${normalizedUrl}`}`).digest("hex");

export function requireCaptureAuthorization(request: PostingCaptureRequest, access: SourceAccessDecision) {
  if (access !== "ALLOWED") throw new Error(access === "NOT_ALLOWED" ? "SOURCE_NOT_ALLOWED" : "SOURCE_ACCESS_UNCONFIRMED");
  if (!request.operatorAuthorization.trim()) throw new Error("OPERATOR_AUTHORIZATION_REQUIRED");
  if (request.maximumExternalRequests > RECIPE_1_1_LIMITS.externalRequests || request.maximumResults > RECIPE_1_1_LIMITS.postings || request.costCeilingUsd !== 0) throw new Error("CAPTURE_SCOPE_EXCEEDED");
  if (!/houston/i.test(request.geography) || !/(electrician|electrical apprentice)/i.test(request.profession)) throw new Error("CAPTURE_SCOPE_EXCEEDED");
}

export function deduplicatePostings(postings: readonly CapturedPosting[], source: string) {
  const seen = new Set<string>(); let duplicates = 0;
  const unique = postings.filter((posting) => { const key = postingIdentity(source, posting.externalPostingId, posting.normalizedUrl); if (seen.has(key)) { duplicates += 1; return false; } seen.add(key); return true; });
  return { unique, duplicates };
}
