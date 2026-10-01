import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizePublicCandidateUrl } from "../company-discovery/brave-search-provider";

/**
 * Bounded, SSRF-safe retrieval of one public source page for signal enrichment. Only public HTTPS hosts whose
 * every resolved address is public; redirects are followed manually (max 3) and re-validated; robots.txt is
 * respected; responses are capped by time and size; content is only read as text (never executed).
 */
export const ENRICHMENT_USER_AGENT = "FlyWorkforceRadarBot/1.0 (+source verification for human review)";
export const MAX_SOURCE_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const ROBOTS_TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 3;
const ALLOWED_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain|application\/pdf)\b/i;

export type FetchFailure = "UNSAFE_URL" | "PRIVATE_ADDRESS" | "BLOCKED_BY_ROBOTS" | "HTTP_ERROR" | "TIMEOUT" | "TOO_LARGE" | "UNSUPPORTED_CONTENT" | "FAILED";

export type SafeFetchResult =
  | { readonly ok: true; readonly finalUrl: string; readonly status: number; readonly contentType: string; readonly body: Buffer }
  | { readonly ok: false; readonly failure: FetchFailure; readonly finalUrl: string | null; readonly status: number | null; readonly contentType: string | null };

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
    return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9")
      || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("ff") || value.startsWith("2001:db8");
  }
  return true;
}

export type Resolver = (hostname: string) => Promise<readonly string[]>;
const defaultResolver: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

async function hostIsPublic(url: URL, resolve: Resolver): Promise<boolean> {
  try {
    const addresses = await resolve(url.hostname);
    return addresses.length > 0 && addresses.every((address) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

async function readCapped(response: Response, cap: number): Promise<Buffer | "TOO_LARGE"> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > cap) return "TOO_LARGE";
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { await reader.cancel(); return "TOO_LARGE"; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Minimal robots.txt check for our agent or "*": longest matching Allow/Disallow rule wins. */
export function robotsAllows(robots: string, path: string, agent = "flyworkforceradarbot"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: { agents: string[]; rules: { allow: boolean; path: string }[] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current && value) {
      current.rules.push({ allow: key === "allow", path: value });
    }
  }
  const group = groups.find((item) => item.agents.some((name) => name !== "*" && agent.includes(name))) ?? groups.find((item) => item.agents.includes("*"));
  if (!group) return true;
  const toRegex = (pattern: string) => new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  const matches = group.rules.filter((rule) => toRegex(rule.path).test(path)).sort((a, b) => b.path.length - a.path.length);
  return matches.length ? matches[0].allow : true;
}

export async function safeFetchSource(rawUrl: string, options: { readonly resolve?: Resolver; readonly transport?: typeof fetch; readonly checkRobots?: boolean } = {}): Promise<SafeFetchResult> {
  const resolve = options.resolve ?? defaultResolver;
  const transport = options.transport ?? fetch;
  const fail = (failure: FetchFailure, finalUrl: string | null = null, status: number | null = null, contentType: string | null = null): SafeFetchResult =>
    ({ ok: false, failure, finalUrl, status, contentType });
  const initial = asFetchableUrl(rawUrl);
  if (!initial) return fail("UNSAFE_URL");
  let current: string = initial;

  if (options.checkRobots !== false) {
    const url = new URL(current);
    if (!(await hostIsPublic(url, resolve))) return fail("PRIVATE_ADDRESS", current);
    try {
      const robots = await transport(`${url.origin}/robots.txt`, { headers: { "User-Agent": ENRICHMENT_USER_AGENT }, redirect: "manual", signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS), cache: "no-store" });
      if (robots.ok) {
        const body = await readCapped(robots, 200_000);
        if (body !== "TOO_LARGE" && !robotsAllows(body.toString("utf8"), url.pathname + url.search)) return fail("BLOCKED_BY_ROBOTS", current);
      }
    } catch {
      // No robots.txt reachable: proceed under the normal limits.
    }
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = new URL(current);
    if (!(await hostIsPublic(url, resolve))) return fail("PRIVATE_ADDRESS", current);
    let response: Response;
    try {
      response = await transport(current, {
        headers: { "User-Agent": ENRICHMENT_USER_AGENT, Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8" },
        redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
      });
    } catch (error) {
      return fail(error instanceof Error && /timeout|abort/i.test(`${error.name} ${error.message}`) ? "TIMEOUT" : "FAILED", current);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = location ? asFetchableUrl(new URL(location, current).toString()) : null;
      if (!next) return fail("UNSAFE_URL", current, response.status);
      current = next;
      continue;
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!response.ok) return fail("HTTP_ERROR", current, response.status, contentType || null);
    if (!ALLOWED_TYPES.test(contentType)) return fail("UNSUPPORTED_CONTENT", current, response.status, contentType || null);
    const body = await readCapped(response, MAX_SOURCE_BYTES).catch(() => null);
    if (body === null) return fail("FAILED", current, response.status, contentType);
    if (body === "TOO_LARGE") return fail("TOO_LARGE", current, response.status, contentType);
    return { ok: true, finalUrl: current, status: response.status, contentType, body };
  }
  return fail("FAILED", current);
}

/** Safety-validated URL, fetched exactly as published (hash removed). */
function asFetchableUrl(value: string): string | null {
  if (!normalizePublicCandidateUrl(value)) return null;
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}
