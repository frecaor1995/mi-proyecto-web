import type {
  CapturedResource,
  DemandSignalParser,
  NormalizedDemandSignal,
} from "../../../domain/ingestion";
import { normalizeRole, validDate } from "./normalization";

const decode = (value: string) => value
  .replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&nbsp;/g, " ")
  .replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, " ")
  .trim();

function matchText(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? decode(match[1]) || null : null;
}

function field(html: string, name: string): string | null {
  return matchText(
    html,
    new RegExp(`<[^>]+data-field=["']${name}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
  );
}

function compensation(text: string | null) {
  if (!text) return { min: null, max: null, currency: null, period: null };
  const range = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(?:hr|hour)|per\s+hour|hourly)/i);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (max >= min) return { min, max, currency: "USD", period: "HOUR" };
    return { min: null, max: null, currency: null, period: null };
  }
  const single = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(?:hr|hour)|per\s+hour|hourly)/i);
  if (!single) return { min: null, max: null, currency: null, period: null };
  const value = Number(single[1]);
  return { min: value, max: value, currency: "USD", period: "HOUR" };
}

function perDiem(text: string | null) {
  if (!text) return { available: null, amount: null, frequency: null };
  if (/\b(no|none|not offered)\b/i.test(text)) {
    return { available: false, amount: null, frequency: null };
  }
  const value = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s+)(day|week)/i);
  if (!value) return { available: null, amount: null, frequency: null };
  return { available: true, amount: Number(value[1]), frequency: value[2].toUpperCase() };
}

function overtime(text: string | null): boolean | null {
  if (!text) return null;
  if (/\b(no|none|not available)\b/i.test(text)) return false;
  if (/\b(available|overtime|ot)\b/i.test(text)) return true;
  return null;
}

export class CorporateCareersHtmlParser implements DemandSignalParser {
  readonly id = "corporate-careers-html";
  readonly version = "corporate-careers-html@1.0.0";

  parse(resource: CapturedResource): NormalizedDemandSignal {
    const html = typeof resource.payload === "string"
      ? resource.payload
      : Buffer.from(resource.payload).toString("utf8");
    const externalPostingId = html.match(/data-job-id=["']([^"']+)["']/i)?.[1]?.trim() || null;
    const title = matchText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (!externalPostingId || !title) throw new Error("Malformed careers posting: missing job ID or title");

    const compensationText = field(html, "compensation");
    const normalizedPay = compensation(compensationText);
    const normalizedPerDiem = perDiem(field(html, "per-diem"));
    const overtimeTerms = field(html, "overtime");
    const headcountText = field(html, "headcount");
    const headcount = headcountText && /^\d+$/.test(headcountText) ? Number(headcountText) : null;

    return {
      externalPostingId,
      originalTitle: title,
      roleType: normalizeRole(title),
      unresolvedPublisherName: field(html, "publisher"),
      publisherType: field(html, "publisher-type"),
      city: field(html, "city"),
      county: field(html, "county"),
      state: field(html, "state"),
      payCurrency: normalizedPay.currency,
      basePayMin: normalizedPay.min,
      basePayMax: normalizedPay.max,
      payPeriod: normalizedPay.period,
      overtimeAvailable: overtime(overtimeTerms),
      overtimeTerms,
      perDiemAvailable: normalizedPerDiem.available,
      perDiemAmount: normalizedPerDiem.amount,
      perDiemFrequency: normalizedPerDiem.frequency,
      schedule: field(html, "schedule"),
      headcountEstimate: headcount,
      publishedAt: validDate(field(html, "published-at")),
      sourceCompensationText: compensationText,
      metadata: normalizedPay.min === null && compensationText !== null
        ? { compensationUnparsed: true }
        : {},
    };
  }
}
