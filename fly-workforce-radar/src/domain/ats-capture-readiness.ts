import type { AccessReview, AtsPlatform, CompanyAtsTarget } from "./company-ats-catalog";

/**
 * Recipe 1.1 v2 — Stage 3: ATS integration PREPARATION (no connectors, no requests).
 * For each catalog target: which extraction method fits the existing provider-neutral capture engine, whether that
 * method is implemented, and whether a persisted ALLOW decision exists. Browser automation and POST-driven ATS
 * (Workday, UKG, Oracle, ApplicantPro, ADP, JavaScript boards) are out of scope in this phase.
 */
export type CaptureCapability = "READY" | "NEEDS_VERIFICATION" | "BLOCKED";

export interface ExtractionMethod {
  readonly method: string;
  /** Existing component that the method plugs into (or would plug into). */
  readonly engineComponent: string;
  readonly implemented: boolean;
  readonly requiresBrowserOrPost: boolean;
}

export const ATS_EXTRACTION_METHODS: Readonly<Record<AtsPlatform, ExtractionMethod>> = {
  GREENHOUSE: { method: "Public job board pages / documented board API (no catalog target evidenced yet)", engineComponent: "IndividualPostingCaptureCoordinator (JSON-LD path if present; no mapper)", implemented: false, requiresBrowserOrPost: false },
  LEVER: { method: "Public postings pages / documented postings API (no catalog target evidenced yet)", engineComponent: "IndividualPostingCaptureCoordinator (JSON-LD path if present; no mapper)", implemented: false, requiresBrowserOrPost: false },
  SMARTRECRUITERS: { method: "Public postings pages / documented posting API (no catalog target evidenced yet)", engineComponent: "IndividualPostingCaptureCoordinator (JSON-LD path if present; no mapper)", implemented: false, requiresBrowserOrPost: false },
  JAZZHR: { method: "HTTP_FETCH of public detail pages {board}.applytojob.com/apply/{postingId}/…; board listing via the Phase 2R-B listing adapter",
    engineComponent: "IndividualPostingCaptureCoordinator + parseStrikeJazzHrPosting (board → employer mapping evidenced for 'strike' only); StrikeListingDiscoveryAdapter", implemented: true, requiresBrowserOrPost: false },
  WORKABLE: { method: "PUBLIC_API: owner-verified widget JSON at apply.workable.com/api/v1/widget/accounts/{slug}, then individual job URLs",
    engineComponent: "IndividualPostingCaptureCoordinator (needs a Workable JSON mapper built from a real sample response)", implemented: false, requiresBrowserOrPost: false },
  ICIMS: { method: "HTTP_FETCH of public iCIMS search/detail HTML (owner: keyword/location filters did not work by fetch)",
    engineComponent: "IndividualPostingCaptureCoordinator (needs an iCIMS detail mapper built from a real sample; JSON-LD path reused if present)", implemented: false, requiresBrowserOrPost: false },
  ICIMS_JIBE: { method: "PUBLIC_API: owner-observed /api/jobs JSON (filters ignored, truncated responses)",
    engineComponent: "IndividualPostingCaptureCoordinator (needs a Jibe JSON mapper built from a real sample)", implemented: false, requiresBrowserOrPost: false },
  TALEO_BUSINESS_EDITION: { method: "HTTP_FETCH of Taleo BE searchResults / requisition HTML",
    engineComponent: "IndividualPostingCaptureCoordinator (needs a Taleo BE requisition mapper built from a real sample)", implemented: false, requiresBrowserOrPost: false },
  CUSTOM_STATIC_JOB_BOARD: { method: "HTTP_FETCH of the site's own job pages; schema.org JobPosting JSON-LD when the page provides it",
    engineComponent: "IndividualPostingCaptureCoordinator + parseJobPosting (JSON-LD only; site-specific markup not mapped)", implemented: false, requiresBrowserOrPost: false },
  WORKDAY: { method: "Workday CXS requires POST/JavaScript", engineComponent: "none in this phase", implemented: false, requiresBrowserOrPost: true },
  UKG_PRO: { method: "UKG/UltiPro job board requires JavaScript/POST", engineComponent: "none in this phase", implemented: false, requiresBrowserOrPost: true },
  APPLICANTPRO: { method: "ApplicantPro listing renders navigation only by fetch (Phase 2J)", engineComponent: "none in this phase", implemented: false, requiresBrowserOrPost: true },
  ORACLE_RECRUITING_CLOUD: { method: "Oracle Candidate Experience requires JavaScript/REST", engineComponent: "none in this phase", implemented: false, requiresBrowserOrPost: true },
  ORACLE_TALEO: { method: "Oracle Taleo enterprise requires JavaScript", engineComponent: "none in this phase", implemented: false, requiresBrowserOrPost: true },
  ADP_WORKFORCE_NOW: { method: "Session-style ADP widget", engineComponent: "none in this phase", implemented: false, requiresBrowserOrPost: true },
  CUSTOM_JAVASCRIPT: { method: "JavaScript-rendered board", engineComponent: "none in this phase", implemented: false, requiresBrowserOrPost: true },
  TEMPWORKS: { method: "TempWorks job board (owner: robots.txt requires manual review)", engineComponent: "manual review only", implemented: false, requiresBrowserOrPost: false },
  FORM_ONLY: { method: "General application form; no published postings", engineComponent: "none", implemented: false, requiresBrowserOrPost: false },
  UNKNOWN: { method: "ATS not identified", engineComponent: "none", implemented: false, requiresBrowserOrPost: false },
};

const BLOCKING_OWNER_METHODS = new Set(["BROWSER", "BROWSER_OR_POST", "MANUAL_ROBOTS", "BLOCKED_403", "NO_POSTINGS"]);

export interface ReadinessRow {
  readonly key: string; readonly name: string; readonly wave: number; readonly pilot: boolean; readonly ats: AtsPlatform; readonly atsIdentifier: string | null;
  readonly identifierBasis: CompanyAtsTarget["identifierBasis"]; readonly url: string | null; readonly host: string | null; readonly catalogStatus: CompanyAtsTarget["status"];
  readonly access: "PERSISTED_ALLOW" | "NO_PERSISTED_ALLOW" | "BLOCKED_BY_OWNER_EVIDENCE"; readonly method: string; readonly capability: CaptureCapability; readonly missing: readonly string[];
}

const hostOf = (url: string | null) => { if (!url) return null; try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };

/** Pure: readiness of one target given the set of hosts that currently have a persisted, current HTTP_FETCH ALLOW. */
export function captureReadiness(target: CompanyAtsTarget, persistedAllowHosts: ReadonlySet<string>): ReadinessRow {
  const method = ATS_EXTRACTION_METHODS[target.ats];
  const host = hostOf(target.jobsUrl);
  const base = { key: target.key, name: target.name, wave: target.wave, pilot: target.pilot, ats: target.ats, atsIdentifier: target.atsIdentifier, identifierBasis: target.identifierBasis,
    url: target.jobsUrl, host, catalogStatus: target.status, method: method.method };
  const blockedReasons = [
    ...(target.accessDecision?.decision === "BLOCKED_TERMS" ? [`owner decision BLOCKED_TERMS (${target.accessDecision.decidedAt}): published terms forbid automated retrieval`] : []),
    ...(target.accessDecision?.decision === "BLOCKED_PENDING_PERMISSION" ? [`owner decision BLOCKED_PENDING_PERMISSION (${target.accessDecision.decidedAt}): written permission required before automated capture`] : []),
    ...(target.status === "BLOCKED" ? [`owner status BLOCKED (${target.ownerCaptureMethod})`] : []),
    ...(target.status === "NO_FEED" ? ["no published postings (NO_FEED)"] : []),
    ...(method.requiresBrowserOrPost ? ["platform requires browser/POST — not automated in this phase"] : []),
    ...(BLOCKING_OWNER_METHODS.has(target.ownerCaptureMethod) && !method.requiresBrowserOrPost && target.status !== "BLOCKED" && target.status !== "NO_FEED"
      ? [`owner capture method ${target.ownerCaptureMethod}`] : []),
  ];
  if (blockedReasons.length) return { ...base, access: "BLOCKED_BY_OWNER_EVIDENCE", capability: "BLOCKED", missing: blockedReasons };
  const allowed = host !== null && persistedAllowHosts.has(host);
  const missing = [
    ...(target.identifierBasis === "INFERRED" ? ["identifier/URL is inferred — verify on the source"] : []),
    ...(target.status !== "VERIFIED" ? [`catalog status ${target.status} — verify endpoint`] : []),
    ...(!allowed ? [`persisted current HTTP_FETCH ALLOW for ${host ?? "the source host"}`] : []),
    ...(!method.implemented ? ["extraction mapper built from a real, authorized sample (fixture)"] : []),
  ];
  return { ...base, access: allowed ? "PERSISTED_ALLOW" : "NO_PERSISTED_ALLOW", capability: missing.length ? "NEEDS_VERIFICATION" : "READY", missing };
}

export function readinessMatrix(targets: readonly CompanyAtsTarget[], persistedAllowHosts: ReadonlySet<string>): readonly ReadinessRow[] {
  return [...targets].sort((a, b) => a.wave - b.wave || Number(b.pilot) - Number(a.pilot) || a.ownerRank - b.ownerRank).map((t) => captureReadiness(t, persistedAllowHosts));
}

// ---------------------------------------------------------------------------------------------------------
// Recipe 2.0 — platform access matrix, effective per-source policy, URL identity and review timebox.

export type PreferredRoute = "AUTOMATIC" | "SPECIAL" | "ASSISTED";
export type PlatformAuthorization = "CONFIRMED" | "REVIEW_PENDING" | "RESTRICTED";
export interface PlatformAccess { readonly platform: AtsPlatform; readonly label: string; readonly preferredRoute: PreferredRoute; readonly authorization: PlatformAuthorization; readonly basis: string }

/**
 * Platform BASELINE only. A platform never grants ALLOW: every capture still needs the source's own owner decision and a
 * persisted, current HTTP_FETCH ALLOW for its host. No platform is CONFIRMED without platform-wide written permission.
 * AUTOMATIC = public server-rendered pages or documented public endpoints fit the existing engine; SPECIAL = needs a
 * browser/POST/session (not automated); ASSISTED = an operator records the posting without the system visiting the URL.
 */
export const PLATFORM_ACCESS: readonly PlatformAccess[] = [
  { platform: "GREENHOUSE", label: "Greenhouse", preferredRoute: "AUTOMATIC", authorization: "REVIEW_PENDING", basis: "Public boards; employer terms decide per source." },
  { platform: "LEVER", label: "Lever", preferredRoute: "AUTOMATIC", authorization: "REVIEW_PENDING", basis: "Public postings; employer terms decide per source." },
  { platform: "WORKABLE", label: "Workable", preferredRoute: "AUTOMATIC", authorization: "REVIEW_PENDING", basis: "Documented public accounts endpoint; commercial use not confirmed (Enterprise ficha 2026-10-08)." },
  { platform: "SMARTRECRUITERS", label: "SmartRecruiters", preferredRoute: "AUTOMATIC", authorization: "REVIEW_PENDING", basis: "Public postings; employer terms decide per source." },
  { platform: "JAZZHR", label: "JazzHR", preferredRoute: "AUTOMATIC", authorization: "REVIEW_PENDING", basis: "The Strike host ALLOW does not extend to other JazzHR boards." },
  { platform: "ICIMS", label: "iCIMS", preferredRoute: "AUTOMATIC", authorization: "REVIEW_PENDING", basis: "Employer terms vary; FSG requires written permission (2026-10-09)." },
  { platform: "ICIMS_JIBE", label: "iCIMS (Jibe)", preferredRoute: "ASSISTED", authorization: "REVIEW_PENDING", basis: "Employer terms vary; endpoint behaviour partial (IES)." },
  { platform: "TALEO_BUSINESS_EDITION", label: "Taleo Business Edition", preferredRoute: "AUTOMATIC", authorization: "REVIEW_PENDING", basis: "Terms not reviewed; JS-vs-HTML evidence conflicts (Walker)." },
  { platform: "ORACLE_TALEO", label: "Oracle Taleo", preferredRoute: "SPECIAL", authorization: "RESTRICTED", basis: "JavaScript-rendered enterprise portal." },
  { platform: "WORKDAY", label: "Workday", preferredRoute: "SPECIAL", authorization: "RESTRICTED", basis: "CXS requires POST/JavaScript." },
  { platform: "UKG_PRO", label: "UKG / UltiPro", preferredRoute: "SPECIAL", authorization: "RESTRICTED", basis: "Job board requires JavaScript/POST." },
  { platform: "ORACLE_RECRUITING_CLOUD", label: "Oracle Recruiting Cloud", preferredRoute: "SPECIAL", authorization: "RESTRICTED", basis: "Candidate Experience requires JavaScript/REST." },
  { platform: "APPLICANTPRO", label: "ApplicantPro", preferredRoute: "SPECIAL", authorization: "RESTRICTED", basis: "Listing renders navigation only by fetch (Phase 2J)." },
  { platform: "ADP_WORKFORCE_NOW", label: "ADP Workforce Now", preferredRoute: "SPECIAL", authorization: "RESTRICTED", basis: "Session-style widget." },
  { platform: "CUSTOM_JAVASCRIPT", label: "Custom JavaScript board", preferredRoute: "ASSISTED", authorization: "RESTRICTED", basis: "JavaScript-rendered." },
  { platform: "TEMPWORKS", label: "TempWorks", preferredRoute: "ASSISTED", authorization: "RESTRICTED", basis: "robots.txt requires manual review (FLS)." },
  { platform: "CUSTOM_STATIC_JOB_BOARD", label: "Own static job board", preferredRoute: "ASSISTED", authorization: "REVIEW_PENDING", basis: "Terms decide per site (Trillium terms forbid automation)." },
  { platform: "FORM_ONLY", label: "Application form only", preferredRoute: "ASSISTED", authorization: "RESTRICTED", basis: "No published postings." },
  { platform: "UNKNOWN", label: "Unknown", preferredRoute: "ASSISTED", authorization: "REVIEW_PENDING", basis: "ATS not identified." },
];

/** Recipe 2.0 review clock: ATS identification target 10 minutes; at most 60 minutes of operational review per source. */
export const ATS_IDENTIFICATION_TARGET_MINUTES = 10;
export const REVIEW_TIMEBOX_MINUTES = 60;
export function reviewTimeboxState(review: AccessReview | null, now: Date) {
  if (!review) return { state: "NOT_STARTED" as const, minutesElapsed: 0, atsIdentificationOnTarget: null };
  const elapsed = Math.floor((now.getTime() - Date.parse(review.startedAt)) / 60_000);
  const identifiedIn = review.atsIdentifiedAt ? Math.floor((Date.parse(review.atsIdentifiedAt) - Date.parse(review.startedAt)) / 60_000) : null;
  const atsIdentificationOnTarget = identifiedIn === null ? (elapsed <= ATS_IDENTIFICATION_TARGET_MINUTES ? null : false) : identifiedIn <= ATS_IDENTIFICATION_TARGET_MINUTES;
  // Expiry only stops the review: it is neither a legal prohibition nor an ALLOW.
  const state = review.decidedAt ? "DECIDED" as const : elapsed > REVIEW_TIMEBOX_MINUTES ? "REVIEW_TIMEBOX_EXPIRED" as const : "IN_REVIEW" as const;
  return { state, minutesElapsed: elapsed, atsIdentificationOnTarget };
}

export type EffectivePolicy = "AUTOMATED_CAPTURE_ALLOWED" | "ASSISTED_ONLY" | "BLOCKED_TERMS" | "BLOCKED_PENDING_PERMISSION" | "REVIEW_REQUIRED" | "REVIEW_TIMEBOX_EXPIRED" | "RESTRICTED_PLATFORM";
/**
 * Effective policy per source: owner decision first, then the persisted host ALLOW, then platform baseline and review
 * clock. Assisted capture stays available for any public posting an operator can see: it never visits the URL and never
 * copies the full description, so it is not a way around a source's restrictions on automated collection.
 */
/**
 * The way work continues today. A platform preference never grants access: without a current persisted ALLOW the
 * active route is assisted capture, so a block or a pending review changes the route instead of stopping the Radar.
 */
export type ActiveRoute = "AUTOMATED_CAPTURE" | "ASSISTED_CAPTURE";
export function activeRouteFor(policy: EffectivePolicy): ActiveRoute { return policy === "AUTOMATED_CAPTURE_ALLOWED" ? "AUTOMATED_CAPTURE" : "ASSISTED_CAPTURE"; }

export function effectivePolicy(target: CompanyAtsTarget, persistedAllowHosts: ReadonlySet<string>, now: Date): { readonly policy: EffectivePolicy; readonly assistedCaptureAvailable: boolean; readonly reason: string } {
  const host = (() => { try { return target.jobsUrl ? new URL(target.jobsUrl).hostname.toLowerCase() : null; } catch { return null; } })();
  const platform = PLATFORM_ACCESS.find((p) => p.platform === target.ats)!;
  if (target.accessDecision) return { policy: target.accessDecision.decision, assistedCaptureAvailable: true, reason: target.accessDecision.basis };
  if (host && persistedAllowHosts.has(host)) return { policy: "AUTOMATED_CAPTURE_ALLOWED", assistedCaptureAvailable: true, reason: `Persisted, current HTTP_FETCH ALLOW for ${host}.` };
  if (platform.authorization === "RESTRICTED") return { policy: "RESTRICTED_PLATFORM", assistedCaptureAvailable: true, reason: platform.basis };
  if (reviewTimeboxState(target.accessReview ?? null, now).state === "REVIEW_TIMEBOX_EXPIRED") {
    return { policy: "REVIEW_TIMEBOX_EXPIRED", assistedCaptureAvailable: true, reason: `Review exceeded ${REVIEW_TIMEBOX_MINUTES} minutes without a decision; evidence kept, continue with another source.` };
  }
  return { policy: platform.preferredRoute === "AUTOMATIC" ? "REVIEW_REQUIRED" : "ASSISTED_ONLY", assistedCaptureAvailable: true, reason: platform.basis };
}

const PLATFORM_HOSTS: readonly [RegExp, AtsPlatform][] = [
  [/(^|\.)greenhouse\.io$/, "GREENHOUSE"], [/(^|\.)lever\.co$/, "LEVER"], [/(^|\.)workable\.com$/, "WORKABLE"], [/(^|\.)smartrecruiters\.com$/, "SMARTRECRUITERS"],
  [/(^|\.)applytojob\.com$/, "JAZZHR"], [/(^|\.)icims\.com$/, "ICIMS"], [/(^|\.)tbe\.taleo\.net$/, "TALEO_BUSINESS_EDITION"], [/(^|\.)taleo\.net$/, "ORACLE_TALEO"],
  [/(^|\.)myworkdayjobs\.com$/, "WORKDAY"], [/(^|\.)ultipro\.com$/, "UKG_PRO"], [/(^|\.)oraclecloud\.com$/, "ORACLE_RECRUITING_CLOUD"], [/(^|\.)applicantpro\.com$/, "APPLICANTPRO"],
  [/(^|\.)ontempworks\.com$/, "TEMPWORKS"],
];
/** Platform recognized from the URL host only (UNKNOWN otherwise). */
export function platformFromUrl(url: string): AtsPlatform {
  try { const host = new URL(url).hostname.toLowerCase(); return PLATFORM_HOSTS.find(([re]) => re.test(host))?.[1] ?? "UNKNOWN"; } catch { return "UNKNOWN"; }
}
/** External posting ID read from the URL itself, for platforms whose URL states one; null otherwise (never invented). */
export function externalIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url); const path = u.pathname;
    switch (platformFromUrl(url)) {
      case "TALEO_BUSINESS_EDITION": return u.searchParams.get("rid");
      case "JAZZHR": return path.match(/^\/apply\/([A-Za-z0-9]{6,})(?:\/|$)/)?.[1] ?? null;
      case "ICIMS": return path.match(/^\/jobs\/(\d+)(?:\/|$)/)?.[1] ?? null;
      case "WORKABLE": return path.match(/\/j\/([A-Za-z0-9]+)/)?.[1] ?? path.match(/\/jobs\/view\/([A-Za-z0-9]+)/)?.[1] ?? null;
      case "LEVER": return path.match(/^\/[^/]+\/([0-9a-f-]{36})/i)?.[1] ?? null;
      case "GREENHOUSE": return path.match(/\/jobs\/(\d+)/)?.[1] ?? null;
      case "SMARTRECRUITERS": return path.match(/^\/[^/]+\/(\d{6,})/)?.[1] ?? null;
      default: return null;
    }
  } catch { return null; }
}
