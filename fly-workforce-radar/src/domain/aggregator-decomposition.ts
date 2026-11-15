export const DECOMPOSITION_STATUSES = ["DECOMPOSED", "DECOMPOSITION_NOT_AVAILABLE"] as const;
export type DecompositionStatus = (typeof DECOMPOSITION_STATUSES)[number];
export type PostingRelationship = "DIRECT_HIRE_POSTING" | "STAFFING_AGENCY_POSTING" | "POSSIBLE_EXTERNAL_MANPOWER_DEMAND" | "UNKNOWN";

export interface StoredPostingEvidence {
  readonly evidenceId: string | null;
  readonly sourceId: string;
  readonly capturedAt: string;
  readonly sourceUrl: string;
  readonly metadata: unknown;
  readonly provenance: "RAW_EVIDENCE" | "PERSISTED_PROVIDER_METADATA";
}

export interface AggregateParent {
  readonly observationId: string;
  readonly candidateId: string;
  readonly observationIdentity: string;
  readonly normalizedUrl: string;
  readonly sourceId: string;
  readonly aggregateCount: number;
  readonly recipeId: string | null;
  readonly runId: string;
  readonly queryExecutionId: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export interface DecomposedPosting {
  readonly identity: string;
  readonly normalizedUrl: string;
  readonly originalUrl: string;
  readonly externalPostingId: string | null;
  readonly employerName: string | null;
  readonly profession: string | null;
  readonly title: string | null;
  readonly location: string | null;
  readonly pay: string | null;
  readonly perDiem: string | null;
  readonly experience: string | null;
  readonly credentials: readonly string[];
  readonly postingDate: string | null;
  readonly explicitHeadcount: number | null;
  readonly relationship: PostingRelationship;
  readonly vendorAcceptance: "UNKNOWN";
  readonly evidenceIds: readonly string[];
  readonly provenance: readonly string[];
  readonly evidenceGaps: readonly string[];
  readonly reviewHref: string;
}

export interface AggregateDecomposition {
  readonly status: DecompositionStatus;
  readonly parent: AggregateParent;
  readonly children: readonly DecomposedPosting[];
  readonly postingCount: number;
  readonly uniqueEmployerCount: number;
  readonly duplicateCount: number;
  readonly employerHeadcount: null;
  readonly reason: string;
  readonly evidenceGaps: readonly string[];
}

type PostingCandidate = {
  sourceId: string;
  url: string; externalPostingId: string | null; employerName: string | null; profession: string | null;
  title: string | null; location: string | null; pay: string | null; perDiem: string | null;
  experience: string | null; credentials: string[]; postingDate: string | null; explicitHeadcount: number | null;
  relationship: PostingRelationship; evidenceId: string | null; provenance: string;
};

const TRACKING_PARAMETERS = /^(?:utm_.+|fbclid|gclid|msclkid|ref|source)$/i;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const positiveInteger = (value: unknown) => Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
const strings = (value: unknown) => Array.isArray(value) ? value.map(text).filter((item): item is string => item !== null) : [];

export function normalizePostingUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.protocol = "https:"; url.hostname = url.hostname.toLowerCase(); url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETERS.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch { return null; }
}

const relationship = (item: Record<string, unknown>): PostingRelationship => {
  if (item.explicitExternalManpowerDemand === true && text(item.externalManpowerEvidence)) return "POSSIBLE_EXTERNAL_MANPOWER_DEMAND";
  const stated = text(item.sourceRelationship)?.toUpperCase();
  if (stated === "STAFFING_AGENCY_SOURCE" || item.staffingAgencyPosting === true) return "STAFFING_AGENCY_POSTING";
  if (text(item.hiringOrganization) || item.directHirePosting === true) return "DIRECT_HIRE_POSTING";
  return "UNKNOWN";
};

const containers = (metadata: unknown): unknown[] => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const record = metadata as Record<string, unknown>;
  return [record.postingUrls, record.jobPostings, record.results, record.links].flatMap((value) => Array.isArray(value) ? value : []);
};

function candidate(value: unknown, evidence: StoredPostingEvidence): PostingCandidate | null {
  const item: Record<string, unknown> = typeof value === "string" ? { url: value } : value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const originalUrl = text(item.url) ?? text(item.href); if (!originalUrl || !normalizePostingUrl(originalUrl)) return null;
  const explicitHeadcount = item.headcountBasis === "EXPLICIT_EMPLOYER_STATEMENT" ? positiveInteger(item.explicitHeadcount) : null;
  return { sourceId: evidence.sourceId, url: originalUrl, externalPostingId: text(item.externalPostingId), employerName: text(item.employerName) ?? text(item.hiringOrganization), profession: text(item.profession),
    title: text(item.title), location: text(item.location), pay: text(item.pay), perDiem: text(item.perDiem), experience: text(item.experience), credentials: strings(item.credentials),
    postingDate: text(item.postingDate), explicitHeadcount, relationship: relationship(item), evidenceId: evidence.evidenceId,
    provenance: `${evidence.provenance}:${evidence.sourceId}:${evidence.capturedAt}` };
}

const identityFor = (item: PostingCandidate, normalizedUrl: string, sourceId: string) => item.externalPostingId ? `${sourceId}:external:${item.externalPostingId}` : `${sourceId}:url:${normalizedUrl}`;
const distinct = <T,>(values: readonly T[]) => [...new Set(values)];

export function decomposeAggregateObservation(parent: AggregateParent, evidence: readonly StoredPostingEvidence[]): AggregateDecomposition {
  const raw = evidence.flatMap((record) => containers(record.metadata).map((value) => candidate(value, record)).filter((item): item is PostingCandidate => item !== null));
  const grouped = new Map<string, { sourceId: string; normalizedUrl: string; items: PostingCandidate[] }>();
  for (const item of raw) {
    const normalizedUrl = normalizePostingUrl(item.url)!;
    const sourceId = item.sourceId;
    const identity = identityFor(item, normalizedUrl, sourceId);
    const current = grouped.get(identity) ?? { sourceId, normalizedUrl, items: [] }; current.items.push(item); grouped.set(identity, current);
  }
  const children = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([identity, group]): DecomposedPosting => {
    const employers = distinct(group.items.map((item) => item.employerName).filter((item): item is string => item !== null));
    const first = group.items[0]; const pick = (key: keyof PostingCandidate) => (group.items.map((item) => item[key]).find((value) => value !== null) ?? null) as string | number | null;
    const evidenceGaps = [employers.length === 0 ? "EMPLOYER_UNKNOWN" : null, employers.length > 1 ? "EMPLOYER_AMBIGUOUS" : null,
      group.items.every((item) => !item.title) ? "TITLE_UNKNOWN" : null, group.items.every((item) => !item.location) ? "LOCATION_UNKNOWN" : null,
      group.items.every((item) => !item.postingDate) ? "POSTING_DATE_UNKNOWN" : null].filter((item): item is string => item !== null);
    return { identity, normalizedUrl: group.normalizedUrl, originalUrl: first.url, externalPostingId: first.externalPostingId,
      employerName: employers.length === 1 ? employers[0] : null, profession: pick("profession") as string | null, title: pick("title") as string | null,
      location: pick("location") as string | null, pay: pick("pay") as string | null, perDiem: pick("perDiem") as string | null,
      experience: pick("experience") as string | null, credentials: distinct(group.items.flatMap((item) => item.credentials)), postingDate: pick("postingDate") as string | null,
      explicitHeadcount: pick("explicitHeadcount") as number | null, relationship: group.items.map((item) => item.relationship).find((value) => value !== "UNKNOWN") ?? "UNKNOWN",
      vendorAcceptance: "UNKNOWN", evidenceIds: distinct(group.items.map((item) => item.evidenceId).filter((item): item is string => item !== null)),
      provenance: distinct(group.items.map((item) => item.provenance)), evidenceGaps, reviewHref: `/radar/${parent.candidateId}` };
  });
  if (!children.length) return { status: "DECOMPOSITION_NOT_AVAILABLE", parent, children: [], postingCount: 0, uniqueEmployerCount: 0, duplicateCount: raw.length,
    employerHeadcount: null, reason: "Stored evidence contains no individually supported posting URLs. The aggregate parent is retained for manual evidence review.", evidenceGaps: ["INDIVIDUAL_POSTING_URLS_NOT_STORED"] };
  return { status: "DECOMPOSED", parent, children, postingCount: children.length, uniqueEmployerCount: new Set(children.map((item) => item.employerName).filter(Boolean)).size,
    duplicateCount: raw.length - children.length, employerHeadcount: null, reason: "Individual postings were decomposed only from URLs present in stored evidence.", evidenceGaps: [] };
}
