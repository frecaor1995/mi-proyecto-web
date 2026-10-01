import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isPrivateAddress, robotsAllows, safeFetchSource } from "../../server/source-enrichment/safe-fetch";
import { extractHtml, extractPdf } from "../../server/source-enrichment/source-text";
import { enrichBatch, enrichSource, isReadableText } from "../../server/source-enrichment/enrich-source";
import { qualifyWithSource, type PageEvidence, type QualificationInput } from "../../domain/commercial-qualification";
import { classifySignalEvidence, detectLocation, detectTrades } from "../../domain/discovery-coverage";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

const publicResolver = async () => ["93.184.216.34"];
const html = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

describe("bounded, SSRF-safe source retrieval", () => {
  it("rejects private, loopback, link-local and reserved addresses", () => {
    for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.3.4", "192.168.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(address)).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("refuses non-https URLs and hosts that resolve to private addresses", async () => {
    const transport = (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch;
    expect((await safeFetchSource("http://example.com/x", { transport, resolve: publicResolver })).ok).toBe(false);
    const privateHost = await safeFetchSource("https://internal.example.com/x", { transport, resolve: async () => ["10.1.2.3"] });
    expect(privateHost).toMatchObject({ ok: false, failure: "PRIVATE_ADDRESS" });
  });

  it("re-validates every redirect and keeps the published URL (no normalisation redirect loop)", async () => {
    const seen: string[] = [];
    const transport = (async (url: string | URL) => {
      const value = String(url);
      seen.push(value);
      if (value.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (value === "https://example.com/careers") return new Response(null, { status: 301, headers: { location: "/careers/" } });
      if (value === "https://example.com/careers/") return html("<title>Careers</title><main>ok</main>");
      return new Response(null, { status: 302, headers: { location: "https://internal.local/x" } });
    }) as unknown as typeof fetch;
    const ok = await safeFetchSource("https://example.com/careers", { transport, resolve: publicResolver });
    expect(ok).toMatchObject({ ok: true, finalUrl: "https://example.com/careers/" });
    const unsafe = await safeFetchSource("https://example.com/redirect", { transport, resolve: publicResolver });
    expect(unsafe).toMatchObject({ ok: false, failure: "UNSAFE_URL" });
  });

  it("respects robots.txt, response-size and content-type limits", async () => {
    expect(robotsAllows("User-agent: *\nDisallow: /jobs/", "/jobs/123")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /jobs/\nAllow: /jobs/public", "/jobs/public/1")).toBe(true);
    const blocked = await safeFetchSource("https://example.com/jobs/1", { resolve: publicResolver,
      transport: (async (url: string | URL) => String(url).endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /jobs/") : html("x")) as unknown as typeof fetch });
    expect(blocked).toMatchObject({ ok: false, failure: "BLOCKED_BY_ROBOTS" });
    const big = await safeFetchSource("https://example.com/big", { resolve: publicResolver, checkRobots: false,
      transport: (async () => html("x", 200, { "content-length": "9000000" })) as unknown as typeof fetch });
    expect(big).toMatchObject({ ok: false, failure: "TOO_LARGE" });
    const image = await safeFetchSource("https://example.com/a.png", { resolve: publicResolver, checkRobots: false,
      transport: (async () => new Response("x", { headers: { "content-type": "image/png" } })) as unknown as typeof fetch });
    expect(image).toMatchObject({ ok: false, failure: "UNSUPPORTED_CONTENT" });
  });
});

describe("source text extraction (nothing executed)", () => {
  it("reads visible text and schema.org JobPosting data, ignoring scripts", () => {
    const page = extractHtml(`<html><head><title>Pipefitter - Acme</title><script>alert(1)</script>
      <script type="application/ld+json">{"@type":"JobPosting","title":"Pipefitter","datePosted":"2026-09-20","validThrough":"2026-10-20","hiringOrganization":{"name":"Acme Industrial"},
      "jobLocation":{"address":{"addressLocality":"Baytown","addressRegion":"TX"}},"baseSalary":{"currency":"USD","value":{"minValue":30,"maxValue":38,"unitText":"HOUR"}}}</script></head>
      <body><nav>menu careers</nav><main><h1>Pipefitter</h1><p>Must have 3 years of experience and OSHA 10.</p></main></body></html>`);
    expect(page.title).toBe("Pipefitter - Acme");
    expect(page.text).toContain("OSHA 10");
    expect(page.text).not.toContain("alert(1)");
    expect(page.text).not.toContain("menu careers");
    expect(page.structured.jobPosting).toMatchObject({ hiringOrganization: "Acme Industrial", locality: "Baytown", region: "TX", salary: "USD 30–38 per hour", validThrough: "2026-10-20" });
  });

  it("extracts text and the document date from a simple PDF, and flags unreadable output", () => {
    const content = deflateSync(Buffer.from("BT /F1 12 Tf 72 700 Td (Request for Statements of Qualification RFQ 21-045) Tj T* (Bids will be received until July 20, 2021 at 2:00 PM) Tj ET"));
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj << /Length " + content.length + " /Filter /FlateDecode >>\nstream\n", "latin1"), content,
      Buffer.from("\nendstream\nendobj\n<< /CreationDate (D:20210630120000) >>\n%%EOF", "latin1")]);
    const extracted = extractPdf(pdf);
    expect(extracted.text).toContain("Request for Statements of Qualification RFQ 21-045");
    expect(extracted.structured.documentDate).toBe("2021-06-30");
    expect(isReadableText(extracted.text + " Bids for electrical work are requested from qualified contractors in Beaumont Texas this year")).toBe(true);
    expect(isReadableText("!\"#$%&'()*+,(&-)*..)/&-0+).&%$$&1&203)+4/&5.6(3&787%8 & '(9.& ! & :;& \" # :<&\"!%=#7$=>?!$&1&;<&\"!%=#7$=>?!% & @:*A<& B-5 C $$! C %$! >$\"%!")).toBe(false);
  });
});

const recording = () => {
  const inserts: unknown[][] = [];
  const client = { query: async (_sql: string, params: unknown[]) => { inserts.push(params); return { rows: [{ fetched_at: "2026-09-30T00:00:00Z" }] }; } } as unknown as SqlClient;
  return { client, inserts };
};

describe("enrichment persistence and failure handling", () => {
  it("records a failed retrieval as a limitation, with no source text invented", async () => {
    const { client, inserts } = recording();
    const record = await enrichSource(client, { normalizedUrl: "https://x.test/a", url: "https://x.test/a", trigger: "AUDIT",
      fetcher: async () => ({ ok: false, failure: "HTTP_ERROR", finalUrl: "https://x.test/a", status: 403, contentType: "text/html" }) });
    expect(record).toMatchObject({ status: "HTTP_ERROR", text: null, httpStatus: 403 });
    expect(inserts[0][3]).toBe("HTTP_ERROR");
    expect(inserts[0][7]).toBeNull();
  });

  it("is bounded per batch and per domain", async () => {
    const { client } = recording();
    let calls = 0;
    const targets = Array.from({ length: 12 }, (_, index) => ({ normalizedUrl: `https://${index % 2 ? "a" : "b"}.test/${index}`, url: `https://${index % 2 ? "a" : "b"}.test/${index}` }));
    const done = await enrichBatch(client, targets, { trigger: "AUDIT", limit: 10, perDomain: 3, spacingMs: 0, fetcher: async () => { calls += 1; return { ok: false, failure: "TIMEOUT", finalUrl: null, status: null, contentType: null }; } });
    expect(done).toHaveLength(6);
    expect(calls).toBe(6);
  });
});

const derive = {
  professions: (text: string, title: string) => { const fromTitle = detectTrades(title); return fromTitle.length ? fromTitle : detectTrades(text); },
  titleNamesProfession: (title: string) => detectTrades(title).length > 0,
  location: (text: string) => detectLocation(text),
  categories: (text: string, domain: string) => classifySignalEvidence(text, domain).categories,
};
const snippet = (title: string, description: string, url: string): QualificationInput => {
  const domain = new URL(url).hostname;
  const text = `${title} ${description}`;
  return { title, description, url, domain, professions: detectTrades(title).length ? detectTrades(title) : detectTrades(text), titleNamesProfession: detectTrades(title).length > 0,
    location: detectLocation(text), categories: classifySignalEvidence(text, domain).categories, stale: false };
};
const page = (text: string, extra: Partial<PageEvidence> = {}): PageEvidence => ({ status: "FETCHED", text, title: null, fetchedAt: "2026-09-30T00:00:00.000Z", ...extra });
const NOW = Date.parse("2026-09-30T00:00:00Z");

describe("qualification with original-page evidence", () => {
  it("recovers a false negative only from what the original page states", () => {
    const s = snippet("Trade Partner Opportunities | Acme Builders", "Learn more about working with us.", "https://acmebuilders.com/trade-partners");
    const result = qualifyWithSource(s, page("Acme Builders is seeking qualified electrical subcontractors for the Katy ISD High School project in Katy, TX. Prequalification closes November 15, 2026."), derive, NOW);
    expect(result).toMatchObject({ qualified: true, category: "SUBCONTRACTOR_VENDOR", evidenceOrigin: "ORIGINAL_PAGE", enrichment: "FETCHED" });
  });

  it("never qualifies because retrieval failed, and keeps the limitation visible", () => {
    const s = snippet("Trade Partner Opportunities | Acme Builders", "Learn more about working with us.", "https://acmebuilders.com/trade-partners");
    const result = qualifyWithSource(s, { status: "HTTP_ERROR", text: null, title: null, fetchedAt: "2026-09-30T00:00:00.000Z" }, derive, NOW);
    expect(result).toMatchObject({ qualified: false, enrichment: "HTTP_ERROR", evidenceOrigin: null });
  });

  it("marks a snippet-qualified posting expired when the page says it is filled (real RoadDog wording)", () => {
    const s = snippet("Journeyman Electricians at MMR Constructors, Inc. - Abilene, TX", "Matching employers with per diem construction workers", "https://www.roaddogjobs.com/job/3pyluc/journeyman-electricians/abilene/tx");
    const result = qualifyWithSource(s, page("Job Not Available Whoops.. looks like the company filled this job already. Another RoadDog must have gotten the job!"), derive, NOW);
    expect(result).toMatchObject({ qualified: false, noise: "EXPIRED", expiry: { basis: "SOURCE_STATES_CLOSED" } });
  });

  it("treats an old document without an open deadline as expired, and a job-board page stays noise whatever the page says", () => {
    const s = snippet("Invitation to Bid: Electrical Services — City of Beaumont", "The City of Beaumont invites sealed bids for electrical services in Beaumont, TX.", "https://beaumonttexas.gov/bids/12.pdf");
    expect(qualifyWithSource(s, page("Invitation to bid for electrical services. Bids will be received until July 20, 2021.", { documentDate: "2021-06-30" }), derive, NOW)).toMatchObject({ qualified: false, noise: "EXPIRED" });
    const board = snippet("143 pipe fitter Jobs in Houston, TX | Glassdoor", "Search pipe fitter jobs.", "https://www.glassdoor.com/Job/houston.htm");
    expect(qualifyWithSource(board, page("Acme is seeking contract labor for 40 pipefitters in Houston, TX."), derive, NOW)).toMatchObject({ qualified: false, noise: "JOB_BOARD_AGGREGATION" });
  });
});
