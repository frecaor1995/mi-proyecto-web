import { inflateRawSync, inflateSync } from "node:zlib";

/**
 * Text extraction from a retrieved source. Nothing is executed: HTML is reduced to visible text, JSON-LD is only
 * parsed as data (schema.org JobPosting fields), and PDFs are read with a minimal content-stream text parser.
 * If a document yields no readable text the result says so instead of guessing.
 */
export const MAX_EXTRACTED_CHARS = 20_000;

export interface StructuredPosting {
  readonly title?: string;
  readonly datePosted?: string;
  readonly validThrough?: string;
  readonly hiringOrganization?: string;
  readonly locality?: string;
  readonly region?: string;
  readonly salary?: string;
  readonly employmentType?: string;
  readonly experience?: string;
}

export interface ExtractedSource {
  readonly title: string | null;
  readonly text: string;
  readonly structured: { readonly jobPosting?: StructuredPosting; readonly documentDate?: string; readonly format: "HTML" | "PDF" | "TEXT" };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
export const decodeEntities = (value: string) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff)))
  .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
const squash = (value: string) => value.replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const stripTags = (html: string) => squash(decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n").replace(/<[^>]+>/g, " ")));

function jobPostingFrom(node: unknown): StructuredPosting | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const item of node) { const found = jobPostingFrom(item); if (found) return found; } return null; }
  const record = node as Record<string, unknown>;
  if (record["@graph"]) return jobPostingFrom(record["@graph"]);
  const type = record["@type"];
  if (!(type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))) return null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? stripTags(value).slice(0, 300) : undefined);
  const org = record.hiringOrganization as Record<string, unknown> | string | undefined;
  const location = (Array.isArray(record.jobLocation) ? record.jobLocation[0] : record.jobLocation) as Record<string, unknown> | undefined;
  const address = location?.address as Record<string, unknown> | undefined;
  const salary = record.baseSalary as Record<string, unknown> | undefined;
  const value = salary?.value as Record<string, unknown> | number | undefined;
  const amount = typeof value === "object" && value ? [value.minValue, value.maxValue].filter((part) => part != null).join("–") || String(value.value ?? "") : value != null ? String(value) : "";
  const unit = typeof value === "object" && value ? String(value.unitText ?? "") : "";
  return {
    title: text(record.title), datePosted: text(record.datePosted), validThrough: text(record.validThrough),
    hiringOrganization: typeof org === "string" ? text(org) : text(org?.name), locality: text(address?.addressLocality), region: text(address?.addressRegion),
    salary: amount ? `${salary?.currency ? `${String(salary.currency)} ` : ""}${amount}${unit ? ` per ${unit.toLowerCase()}` : ""}` : undefined,
    employmentType: Array.isArray(record.employmentType) ? record.employmentType.join(", ") : text(record.employmentType),
    experience: text((record.experienceRequirements as Record<string, unknown> | undefined)?.monthsOfExperience ? `${String((record.experienceRequirements as Record<string, unknown>).monthsOfExperience)} months` : record.experienceRequirements),
  };
}

export function extractHtml(html: string): ExtractedSource {
  let jobPosting: StructuredPosting | undefined;
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { jobPosting = jobPostingFrom(JSON.parse(match[1].trim())) ?? jobPosting; } catch { /* malformed JSON-LD is ignored */ }
    if (jobPosting) break;
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const cleaned = html.replace(/<(script|style|noscript|svg|template|iframe|nav|footer)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const main = cleaned.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0] ?? cleaned.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? cleaned;
  return { title: title ? stripTags(title).slice(0, 500) : null, text: stripTags(main).slice(0, MAX_EXTRACTED_CHARS), structured: { format: "HTML", ...(jobPosting ? { jobPosting } : {}) } };
}

function pdfString(literal: string): string {
  return literal.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, code: string) => {
    if (/^[0-7]+$/.test(code)) return String.fromCharCode(parseInt(code, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[code] ?? code;
  });
}

function textFromContentStream(content: string): string {
  const out: string[] = [];
  const token = /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|\b(T\*|Td|TD|ET)\b/g;
  for (const match of content.matchAll(token)) {
    if (match[1] !== undefined) {
      let line = "";
      for (const part of match[1].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?\d+(?:\.\d+)?)/g)) {
        if (part[1] !== undefined) line += pdfString(part[1]);
        else if (Number(part[2]) < -180) line += " ";
      }
      out.push(line);
    } else if (match[2] !== undefined) out.push(pdfString(match[2]));
    else out.push("\n");
  }
  return out.join("").replace(/[^\S\n]+/g, " ");
}

export function extractPdf(buffer: Buffer): ExtractedSource {
  const raw = buffer.toString("latin1");
  const parts: string[] = [];
  for (const match of raw.matchAll(/<<([\s\S]{0,600}?)>>\s*stream\r?\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    const data = buffer.subarray(start, end);
    let content: string | null = null;
    if (/\/FlateDecode/.test(match[1])) {
      for (const inflate of [inflateSync, inflateRawSync]) { try { content = inflate(data).toString("latin1"); break; } catch { /* try next */ } }
    } else if (!/\/Filter/.test(match[1])) content = data.toString("latin1");
    if (content && /\b(Tj|TJ)\b/.test(content)) parts.push(textFromContentStream(content));
    if (parts.join("").length > MAX_EXTRACTED_CHARS) break;
  }
  const date = raw.match(/\/CreationDate\s*\(D:(\d{4})(\d{2})(\d{2})/);
  const titleMeta = raw.match(/\/Title\s*\(((?:\\.|[^\\)]){1,300})\)/)?.[1];
  const text = squash(parts.join("\n").replace(/[^\x09\x0a\x20-\x7e -ÿ]/g, " ")).slice(0, MAX_EXTRACTED_CHARS);
  return { title: titleMeta ? pdfString(titleMeta).slice(0, 500) : null, text, structured: { format: "PDF", ...(date ? { documentDate: `${date[1]}-${date[2]}-${date[3]}` } : {}) } };
}

export function extractSource(body: Buffer, contentType: string): ExtractedSource {
  if (/pdf/i.test(contentType) || body.subarray(0, 5).toString("latin1") === "%PDF-") return extractPdf(body);
  const text = body.toString("utf8");
  if (/html/i.test(contentType) || /<html|<body|<title/i.test(text.slice(0, 5000))) return extractHtml(text);
  return { title: null, text: squash(text).slice(0, MAX_EXTRACTED_CHARS), structured: { format: "TEXT" } };
}
