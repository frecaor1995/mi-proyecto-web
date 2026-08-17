import type {
  CapturedResource,
  DemandSignalParser,
  NormalizedDemandSignal,
} from "../../../domain/ingestion";
import {
  finiteNonNegative,
  finiteNonNegativeInteger,
  normalizeRole,
  validDate,
} from "./normalization";

interface StructuredPosting {
  externalPostingId?: unknown;
  title?: unknown;
  publisherName?: unknown;
  publisherType?: unknown;
  city?: unknown;
  county?: unknown;
  state?: unknown;
  hourlyPayMin?: unknown;
  hourlyPayMax?: unknown;
  currency?: unknown;
  overtimeTerms?: unknown;
  overtimeAvailable?: unknown;
  perDiemAmount?: unknown;
  perDiemUnit?: unknown;
  perDiemAvailable?: unknown;
  schedule?: unknown;
  headcountEstimate?: unknown;
  publishedAt?: unknown;
  compensationText?: unknown;
}

const textOrNull = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export class StructuredFixtureParser implements DemandSignalParser {
  readonly id = "structured-posting-json";
  readonly version = "structured-posting-json@1.0.0";

  parse(resource: CapturedResource): NormalizedDemandSignal {
    const payload = typeof resource.payload === "string"
      ? resource.payload
      : Buffer.from(resource.payload).toString("utf8");
    let posting: StructuredPosting;
    try {
      posting = JSON.parse(payload) as StructuredPosting;
    } catch {
      throw new Error("Malformed structured posting JSON");
    }

    const title = textOrNull(posting.title);
    if (!title) throw new Error("Structured posting is missing a title");

    const min = finiteNonNegative(posting.hourlyPayMin);
    const max = finiteNonNegative(posting.hourlyPayMax);
    const payIsConsistent = min === null || max === null || max >= min;
    const overtimeTerms = textOrNull(posting.overtimeTerms);
    const perDiem = finiteNonNegative(posting.perDiemAmount);

    return {
      externalPostingId: textOrNull(posting.externalPostingId),
      originalTitle: title,
      roleType: normalizeRole(title),
      unresolvedPublisherName: textOrNull(posting.publisherName),
      publisherType: textOrNull(posting.publisherType),
      city: textOrNull(posting.city),
      county: textOrNull(posting.county),
      state: textOrNull(posting.state),
      payCurrency: payIsConsistent ? textOrNull(posting.currency) : null,
      basePayMin: payIsConsistent ? min : null,
      basePayMax: payIsConsistent ? max : null,
      payPeriod: payIsConsistent && (min !== null || max !== null) ? "HOUR" : null,
      overtimeAvailable: typeof posting.overtimeAvailable === "boolean"
        ? posting.overtimeAvailable
        : null,
      overtimeTerms,
      perDiemAvailable: typeof posting.perDiemAvailable === "boolean"
        ? posting.perDiemAvailable
        : perDiem === null ? null : true,
      perDiemAmount: perDiem,
      perDiemFrequency: perDiem === null ? null : textOrNull(posting.perDiemUnit),
      schedule: textOrNull(posting.schedule),
      headcountEstimate: finiteNonNegativeInteger(posting.headcountEstimate),
      publishedAt: validDate(posting.publishedAt),
      sourceCompensationText: textOrNull(posting.compensationText),
      metadata: payIsConsistent ? {} : { compensationConflict: true },
    };
  }
}
