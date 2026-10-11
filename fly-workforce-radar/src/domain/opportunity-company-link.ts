/**
 * Human link between an existing opportunity and a canonical company (opportunity_companies). Pure rules only.
 * A link says "a person reviewed the evidence and decided this opportunity concerns this company". It never moves
 * the published pay to the company (an aggregator's range is the aggregator's), never creates an opportunity and is
 * never inferred automatically: a name match is only a suggestion.
 */

/** Job boards and aggregators: their listings repeat or summarize third-party postings; the employer is not confirmed by them. */
export const AGGREGATOR_HOSTS = [
  "ziprecruiter.com", "indeed.com", "glassdoor.com", "simplyhired.com", "talent.com", "careerbuilder.com", "linkedin.com", "monster.com",
  "jooble.org", "adzuna.com", "snagajob.com", "jobrapido.com", "neuvoo.com", "lensa.com", "jobtoday.com", "salary.com",
] as const;

export function sourceHost(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

export function isAggregatorUrl(url: string): boolean {
  const host = sourceHost(url);
  return host != null && AGGREGATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const normalize = (value: string) => value.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ")
  .replace(/\b(inc|llc|lp|co|corp|corporation|company|group|ltd)\b/g, " ").replace(/\s+/g, " ").trim();

/** True when the unresolved company text recorded for the opportunity names this company (a suggestion, never a link). */
export function contextNamesCompany(context: string | null | undefined, companyName: string): boolean {
  const a = normalize(context ?? ""), b = normalize(companyName);
  return a.length > 0 && b.length > 0 && (a === b || ` ${a} `.includes(` ${b} `));
}

export interface OpportunityCompanyLinkInput {
  readonly opportunityId: string;
  readonly companyId: string;
  readonly reason: string;
  readonly evidenceNote: string | null;
  readonly humanConfirmed: boolean;
  readonly aggregatorAcknowledged: boolean;
}

export interface OpportunityCompanyLinkContext {
  readonly opportunityIsDemo: boolean;
  readonly companyIsDemo: boolean;
  readonly aggregatorSource: boolean;
  readonly existingLink: "NONE" | "SAME_COMPANY" | "OTHER_COMPANY";
}

export const MIN_LINK_REASON = 20;

export function validateOpportunityCompanyLink(input: OpportunityCompanyLinkInput, ctx: OpportunityCompanyLinkContext): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.opportunityId) errors.opportunityId = "required";
  if (!input.companyId) errors.companyId = "required";
  if (input.reason.trim().length < MIN_LINK_REASON) errors.reason = "tooShort";
  if (!input.humanConfirmed) errors.humanConfirmed = "required";
  if (ctx.aggregatorSource && !input.aggregatorAcknowledged) errors.aggregatorAcknowledged = "required";
  if (ctx.opportunityIsDemo !== ctx.companyIsDemo) errors.opportunityId = "demoMismatch";
  if (ctx.existingLink === "SAME_COMPANY") errors.opportunityId = "alreadyLinked";
  if (ctx.existingLink === "OTHER_COMPANY") errors.opportunityId = "linkedToOtherCompany";
  return errors;
}
