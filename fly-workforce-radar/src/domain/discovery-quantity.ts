export const DISCOVERY_QUANTITY_TYPES = ["AGGREGATE_MARKET_COUNT", "POSTING_COUNT", "EXPLICIT_EMPLOYER_HEADCOUNT", "AMBIGUOUS_QUANTITY", "NOT_A_WORKFORCE_QUANTITY"] as const;
export type DiscoveryQuantityType = (typeof DISCOVERY_QUANTITY_TYPES)[number];
export type DiscoveryQuantityScope = "MARKET_SEARCH_RESULTS" | "DISTINCT_POSTINGS" | "EMPLOYER_WORKERS" | "UNKNOWN";

export interface QuantityClassification {
  readonly type: DiscoveryQuantityType;
  readonly value: number | null;
  readonly scope: DiscoveryQuantityScope;
  readonly excerpt: string;
  readonly reason: string;
  readonly employerHeadcount: null;
}

const clean = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&(?:amp;)?/gi, " and ").replace(/\s+/g, " ").trim();
const value = (raw: string) => Number(raw.replace(/[,+]/g, ""));
const excerpt = (text: string, index: number) => clean(text.slice(Math.max(0, index - 80), index + 180)).slice(0, 300);
const aggregateDomains = /(^|\.)(indeed|linkedin|glassdoor|ziprecruiter|zippia|jobtoday)\.com$/i;
const excludedContext = /(?:\$\s*\d|\d\s*(?:%|years?\b|months?\b|hours?\b|hrs?\b|am\b|pm\b)|(?:19|20)\d{2}\b|\bzip\s*code\b|\bphone\b|\bbonus\b|\bsalary\b|\bpay\b)/i;

export function classifyDiscoveryQuantity(input: { readonly title: string; readonly description?: string | null; readonly domain: string; readonly url?: string }): QuantityClassification {
  const title = clean(input.title); const description = clean(input.description ?? ""); const combined = `${title}. ${description}`;
  const aggregate = title.match(/(?:^|\bnow hiring:\s*)([1-9]\d{0,6})\+?\s+(?:best\s+)?[^.]{0,100}\bjobs?\b/i)
    ?? description.match(/\b([1-9]\d{0,6})\+?\s+[^.]{0,90}\bjobs?\s+(?:available|open|hiring now)\b/i);
  if (aggregate && aggregateDomains.test(input.domain)) return { type: "AGGREGATE_MARKET_COUNT", value: value(aggregate[1]), scope: "MARKET_SEARCH_RESULTS", excerpt: excerpt(combined, aggregate.index ?? 0), reason: "Aggregator/search-results language reports a market result count, not one employer's workforce need.", employerHeadcount: null };

  const posting = combined.match(/\b([1-9]\d{0,4})\s+(?:distinct\s+)?(?:openings?|postings?|positions?)\b/i);
  if (posting && !excludedContext.test(excerpt(combined, posting.index ?? 0))) return { type: "POSTING_COUNT", value: value(posting[1]), scope: "DISTINCT_POSTINGS", excerpt: excerpt(combined, posting.index ?? 0), reason: "The stored text counts openings/postings, not workers.", employerHeadcount: null };

  const explicit = combined.match(/\b(?:hiring|hire|need|needs|needed|seeking|requires?)\s+(?:approximately\s+|about\s+)?([1-9]\d{0,4})\+?\s+(?:qualified\s+|additional\s+)?(?:electricians?|apprentices?|helpers?|workers?|technicians?|journeymen)\b/i);
  if (explicit && !aggregateDomains.test(input.domain) && !excludedContext.test(excerpt(combined, explicit.index ?? 0))) return { type: "EXPLICIT_EMPLOYER_HEADCOUNT", value: value(explicit[1]), scope: "EMPLOYER_WORKERS", excerpt: excerpt(combined, explicit.index ?? 0), reason: "Employer-context language explicitly counts workers; human verification is still required.", employerHeadcount: null };

  const ambiguous = combined.match(/\b(?:multiple|several|many|a crew of|a team of)\s+(?:openings?|positions?|workers?|electricians?|apprentices?)\b/i);
  if (ambiguous) return { type: "AMBIGUOUS_QUANTITY", value: null, scope: "UNKNOWN", excerpt: excerpt(combined, ambiguous.index ?? 0), reason: "Quantity language exists but does not support a normalized number or scope.", employerHeadcount: null };

  return { type: "NOT_A_WORKFORCE_QUANTITY", value: null, scope: "UNKNOWN", excerpt: clean(combined).slice(0, 300), reason: "Numbers are absent or refer to compensation, dates, experience, schedules, duration, identifiers, contact details or other non-headcount facts.", employerHeadcount: null };
}

export function canonicalHeadcount(input: QuantityClassification, humanVerified: boolean): number | null {
  return input.type === "EXPLICIT_EMPLOYER_HEADCOUNT" && input.scope === "EMPLOYER_WORKERS" && humanVerified ? input.value : null;
}

export function marketPressureLabel(signals: readonly QuantityClassification[]) {
  const sources = signals.filter((item) => item.type === "AGGREGATE_MARKET_COUNT" && item.value !== null).length;
  return { sourceSignalCount: sources, summedMarketCount: null, label: sources > 1 ? "MULTIPLE SOURCES SHOW HIGH DEMAND" : sources === 1 ? "MARKET DEMAND SIGNAL OBSERVED" : "NO AGGREGATE MARKET COUNT" } as const;
}

export function talentGap(headcount: number | null, viable: number) {
  return headcount === null ? { needed: null, viable, gap: null, coverageRatio: null } : { needed: headcount, viable, gap: Math.max(0, headcount - viable), coverageRatio: headcount === 0 ? null : Math.min(1, viable / headcount) };
}
