// Test-only helpers: deterministic provider and fetcher built from captured public fixtures (no live web).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { safeFetchSource } from "../../server/source-enrichment/safe-fetch";

export interface PageFixture { readonly kind: "page"; readonly url: string; readonly finalUrl: string; readonly capturedAt: string; readonly domain: string; readonly title: string | null; readonly publishedDate: string | null; readonly text: string }
export interface SearchFixture { readonly kind: "search"; readonly query: string; readonly capturedAt: string; readonly results: readonly { readonly title: string; readonly url: string; readonly description: string | null; readonly pageAge: string | null }[] }

export function loadFixtures(name: string) {
  const dir = resolve(process.cwd(), "src/test/fixtures/contact-research", name);
  const pages: PageFixture[] = []; const searches: SearchFixture[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
    if (data.kind === "page") pages.push(data); else if (data.kind === "search") searches.push(data);
  }
  return { pages, searches };
}

/** Exact-query fake provider: a query that was not captured returns no results (deterministic). */
export function fixtureSearch(searches: readonly SearchFixture[], log: string[] = []) {
  return {
    configured: true,
    async searchWeb(query: string) { log.push(query); return searches.find((s) => s.query === query)?.results ?? []; },
  };
}

/** Fake fetcher: captured pages are served as text (their extracted text); everything else is a 404. */
export function fixtureFetcher(pages: readonly PageFixture[], log: string[] = []): typeof safeFetchSource {
  const normalize = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
  return (async (url: string) => {
    log.push(url);
    const page = pages.find((p) => normalize(p.url) === normalize(url) || normalize(p.finalUrl) === normalize(url));
    if (!page) return { ok: false as const, failure: "HTTP_ERROR" as const, finalUrl: url, status: 404, contentType: "text/html" };
    return { ok: true as const, finalUrl: page.finalUrl, status: 200, contentType: "text/plain", body: Buffer.from(page.text) };
  }) as unknown as typeof safeFetchSource;
}
