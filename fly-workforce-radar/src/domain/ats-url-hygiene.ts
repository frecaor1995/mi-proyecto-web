/**
 * Recipe 2.2 — official-link hygiene. Pure functions only: nothing here fetches, redirects or visits a URL.
 *
 * A broken link is not evidence that a posting is gone. Link problems are kept in four separate categories, and only
 * an explicit statement on the official page that the posting is no longer available (POSTING_WITHDRAWN) can close it.
 */

export const LINK_ISSUE_CATEGORIES = ["OBSOLETE_URL", "POSTING_WITHDRAWN", "ACCESS_ERROR", "UNKNOWN"] as const;
export type LinkIssueCategory = (typeof LINK_ISSUE_CATEGORIES)[number];

/** Categories that can justify closing a posting as not confirmed (REJECTED). A 404 or an old URL format cannot. */
export const CLOSING_LINK_CATEGORIES: readonly LinkIssueCategory[] = ["POSTING_WITHDRAWN"];

export type ObsoleteUrlRule = "TALEO_BE_REQUISITION_JSP";

export interface ObsoleteUrlFinding {
  readonly rule: ObsoleteUrlRule;
  readonly platform: "TALEO_BUSINESS_EDITION";
  readonly originalUrl: string;
  /** Suggested replacement for the operator to check by hand; never applied or visited automatically. */
  readonly proposedUrl: string;
}

interface UrlRule {
  readonly rule: ObsoleteUrlRule;
  readonly platform: ObsoleteUrlFinding["platform"];
  readonly matches: (url: URL) => boolean;
  readonly propose: (url: URL) => string | null;
}

/**
 * Known obsolete ATS URL formats (extensible: add one entry per verified platform change).
 * Taleo Business Edition: `/ats/careers/v2/requisition.jsp?org=…&cws=…&rid=…` became `/ats/careers/v2/viewRequisition`
 * with the same org, cws and rid (owner-verified on Walker Engineering rid 441, 2026-10-09).
 */
const RULES: readonly UrlRule[] = [{
  rule: "TALEO_BE_REQUISITION_JSP",
  platform: "TALEO_BUSINESS_EDITION",
  matches: (url) => /(^|\.)tbe\.taleo\.net$/i.test(url.hostname) && /\/ats\/careers\/v2\/requisition\.jsp$/i.test(url.pathname),
  propose: (url) => {
    const org = url.searchParams.get("org"), cws = url.searchParams.get("cws"), rid = url.searchParams.get("rid");
    if (!org || !cws || !rid) return null;
    const next = new URL(url.toString());
    next.pathname = url.pathname.replace(/requisition\.jsp$/i, "viewRequisition");
    next.search = new URLSearchParams({ org, cws, rid }).toString();
    next.hash = "";
    return next.toString();
  },
}];

export function detectObsoleteAtsUrl(raw: string): ObsoleteUrlFinding | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:") return null;
  for (const rule of RULES) {
    if (!rule.matches(url)) continue;
    const proposedUrl = rule.propose(url);
    if (proposedUrl && proposedUrl !== raw) return { rule: rule.rule, platform: rule.platform, originalUrl: raw, proposedUrl };
  }
  return null;
}

/** The owner's recorded explanation for the Walker 441 correction, reused as the default reason for this rule. */
export const OBSOLETE_URL_EXPLANATION: Record<ObsoleteUrlRule, string> = {
  TALEO_BE_REQUISITION_JSP: "404 causado por formato de URL obsoleto en el catálogo (requisition.jsp → viewRequisition); no se demostró que la vacante estuviera vencida",
};

/**
 * Posting decisions are stored append-only in discovery_signal_reviews, which has no category column: the link
 * category travels as a leading tag in the note ("[link:OBSOLETE_URL] …") so no schema change is needed.
 */
const TAG = /^\[link:([A-Z_]+)\]\s*/;
export function encodeLinkNote(category: LinkIssueCategory | null, note: string | null): string | null {
  const text = note?.trim() ?? "";
  if (!category) return text || null;
  return `[link:${category}]${text ? ` ${text}` : ""}`;
}
export function decodeLinkNote(note: string | null): { readonly category: LinkIssueCategory | null; readonly note: string | null } {
  if (!note) return { category: null, note: null };
  const match = note.match(TAG);
  const category = match ? LINK_ISSUE_CATEGORIES.find((c) => c === match[1]) ?? null : null;
  const rest = (category ? note.replace(TAG, "") : note).trim();
  return { category, note: rest || null };
}
