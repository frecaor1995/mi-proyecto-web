import { safeFetchSource } from "../source-enrichment/safe-fetch";
import { extractSource } from "../source-enrichment/source-text";
import type { ValidationResult } from "../../domain/contact-investigation";

/**
 * Contact provider adapters. Official sources are always available (bounded, robots-respecting retrieval through
 * the same SSRF-safe fetcher as source enrichment). Commercial providers are adapters that stay NOT_CONFIGURED
 * until their credential exists; they never fabricate results and never run without a key.
 */
export type ProviderState = "AVAILABLE" | "NOT_CONFIGURED";

export interface ProviderStatus {
  readonly id: "OFFICIAL_SOURCES" | "PEOPLE_WEB_SEARCH" | "HUNTER_DOMAIN_SEARCH" | "HUNTER_EMAIL_VERIFIER" | "PHONE_LOOKUP";
  readonly state: ProviderState;
  /** Environment variable names the adapter needs (names only). */
  readonly requires: readonly string[];
}

export function providerStatuses(env: Record<string, string | undefined> = process.env): readonly ProviderStatus[] {
  const has = (...names: string[]) => names.every((name) => Boolean(env[name]?.trim()));
  return [
    { id: "OFFICIAL_SOURCES", state: "AVAILABLE", requires: [] },
    { id: "HUNTER_DOMAIN_SEARCH", state: has("HUNTER_API_KEY") ? "AVAILABLE" : "NOT_CONFIGURED", requires: ["HUNTER_API_KEY"] },
    { id: "HUNTER_EMAIL_VERIFIER", state: has("HUNTER_API_KEY") ? "AVAILABLE" : "NOT_CONFIGURED", requires: ["HUNTER_API_KEY"] },
    { id: "PHONE_LOOKUP", state: has("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN") ? "AVAILABLE" : "NOT_CONFIGURED", requires: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] },
    { id: "PEOPLE_WEB_SEARCH", state: has("BRAVE_SEARCH_API_KEY") ? "AVAILABLE" : "NOT_CONFIGURED", requires: ["BRAVE_SEARCH_API_KEY"] },
  ];
}

export interface RetrievedPage { readonly url: string; readonly status: string; readonly httpStatus: number | null; readonly text: string | null; readonly title?: string | null }

/** Official website pages for the target functions: at most `limit` pages on the official domain only. */
export async function retrieveOfficialPages(domain: string, paths: readonly string[], options: { readonly limit?: number; readonly fetcher?: typeof safeFetchSource; readonly spacingMs?: number; readonly includeContactPages?: boolean } = {}): Promise<readonly RetrievedPage[]> {
  const fetcher = options.fetcher ?? safeFetchSource;
  const unique = [...new Set([...(options.includeContactPages === false ? [] : ["/contact", "/contact-us"]), ...paths])].slice(0, options.limit ?? 5);
  const pages: RetrievedPage[] = [];
  for (const [index, path] of unique.entries()) {
    if (index && (options.spacingMs ?? 1000) > 0) await new Promise((resolve) => setTimeout(resolve, options.spacingMs ?? 1000));
    const url = `https://${domain}${path}`;
    const result = await fetcher(url);
    if (!result.ok) { pages.push({ url, status: result.failure, httpStatus: result.status, text: null }); continue; }
    // Redirects off the official domain are not official-site evidence.
    const finalHost = new URL(result.finalUrl).hostname.replace(/^www\./, "");
    if (!finalHost.endsWith(domain)) { pages.push({ url, status: "OFF_DOMAIN_REDIRECT", httpStatus: result.status, text: null }); continue; }
    const extracted = extractSource(result.body, result.contentType);
    pages.push({ url: result.finalUrl, status: "FETCHED", httpStatus: result.status, text: extracted.text, title: extracted.title });
  }
  return pages;
}

// --- Hunter (https://hunter.io/api-documentation/v2): domain search + email verifier -------------------------

export interface HunterContact { readonly email: string; readonly firstName: string | null; readonly lastName: string | null; readonly position: string | null; readonly department: string | null; readonly phone: string | null; readonly sourceUrl: string | null }
export type ProviderOutcome<T> = { readonly state: "NOT_CONFIGURED" } | { readonly state: "FAILED"; readonly reason: string } | { readonly state: "OK"; readonly value: T };

const TIMEOUT_MS = 10_000;

export async function hunterDomainSearch(domain: string, options: { readonly apiKey?: string; readonly transport?: typeof fetch } = {}): Promise<ProviderOutcome<readonly HunterContact[]>> {
  const apiKey = options.apiKey ?? process.env.HUNTER_API_KEY;
  if (!apiKey?.trim()) return { state: "NOT_CONFIGURED" };
  try {
    const url = new URL("https://api.hunter.io/v2/domain-search");
    url.searchParams.set("domain", domain);
    url.searchParams.set("limit", "10");
    const response = await (options.transport ?? fetch)(url, { headers: { "X-API-KEY": apiKey }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) return { state: "FAILED", reason: `HTTP_${response.status}` };
    const body = await response.json() as { data?: { emails?: { value?: string; first_name?: string | null; last_name?: string | null; position?: string | null; department?: string | null; phone_number?: string | null; sources?: { uri?: string }[] }[] } };
    return { state: "OK", value: (body.data?.emails ?? []).filter((item) => typeof item.value === "string").map((item) => ({
      email: item.value!.toLowerCase(), firstName: item.first_name ?? null, lastName: item.last_name ?? null, position: item.position ?? null,
      department: item.department ?? null, phone: item.phone_number ?? null, sourceUrl: item.sources?.find((source) => source.uri)?.uri ?? null,
    })) };
  } catch {
    return { state: "FAILED", reason: "PROVIDER_ERROR" };
  }
}

export async function hunterVerifyEmail(email: string, options: { readonly apiKey?: string; readonly transport?: typeof fetch } = {}): Promise<ProviderOutcome<{ readonly result: ValidationResult; readonly status: string }>> {
  const apiKey = options.apiKey ?? process.env.HUNTER_API_KEY;
  if (!apiKey?.trim()) return { state: "NOT_CONFIGURED" };
  try {
    const url = new URL("https://api.hunter.io/v2/email-verifier");
    url.searchParams.set("email", email);
    const response = await (options.transport ?? fetch)(url, { headers: { "X-API-KEY": apiKey }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) return { state: "FAILED", reason: `HTTP_${response.status}` };
    const status = String(((await response.json()) as { data?: { status?: string } }).data?.status ?? "unknown");
    const result: ValidationResult = status === "valid" ? "VALID" : status === "invalid" ? "INVALID" : ["accept_all", "webmail", "disposable"].includes(status) ? "RISKY" : "UNKNOWN";
    return { state: "OK", value: { result, status } };
  } catch {
    return { state: "FAILED", reason: "PROVIDER_ERROR" };
  }
}

// --- Phone lookup (Twilio Lookup v2 compatible) --------------------------------------------------------------

export async function lookupPhone(phone: string, options: { readonly accountSid?: string; readonly authToken?: string; readonly transport?: typeof fetch } = {}): Promise<ProviderOutcome<{ readonly result: ValidationResult; readonly lineType: string | null }>> {
  const sid = options.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
  const token = options.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  if (!sid?.trim() || !token?.trim()) return { state: "NOT_CONFIGURED" };
  const digits = phone.replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
  if (!e164) return { state: "OK", value: { result: "INVALID", lineType: null } };
  try {
    const response = await (options.transport ?? fetch)(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
    });
    if (!response.ok) return { state: "FAILED", reason: `HTTP_${response.status}` };
    const body = await response.json() as { valid?: boolean; line_type_intelligence?: { type?: string | null } | null };
    return { state: "OK", value: { result: body.valid ? "VALID" : "INVALID", lineType: body.line_type_intelligence?.type ?? null } };
  } catch {
    return { state: "FAILED", reason: "PROVIDER_ERROR" };
  }
}
