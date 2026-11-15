import { canonicalPostingUrl, type CapturedPosting } from "./individual-posting-capture";
import { externalIdFromUrl, platformFromUrl } from "./ats-capture-readiness";
import type { AtsPlatform } from "./company-ats-catalog";
import type { ObsoleteUrlRule } from "./ats-url-hygiene";
import { classifyPostingLevel, matchingLevelFor } from "./posting-level";

/**
 * Recipe 2.0 — assisted capture: an operator records a public posting they have seen (on the official page or in an
 * official job-alert email). The system never visits the URL, never copies the full description (the stored text is the
 * operator's own short summary) and never promotes the posting to a client, an opportunity or a staff request.
 */
export type AssistedProvenance = "ASSISTED_MANUAL" | "EMAIL_ALERT";
export type DataClass = "REAL" | "DEMO";

export const ASSISTED_LIMITS = { company: 200, title: 200, city: 120, salary: 120, experience: 300, licenses: 300, summary: 600, sender: 200, alertReference: 200, correctionReason: 600 } as const;

/**
 * Recipe 2.2 — official-link correction: the same posting recorded again under its corrected official URL, as a NEW
 * observation linked to the earlier one (which keeps its URL, its error and its human decisions untouched).
 */
export interface UrlCorrection {
  readonly previousCandidateId: string;
  readonly reason: string;
  readonly rule: ObsoleteUrlRule | null;
}

export interface AssistedPostingInput {
  readonly url: string;
  readonly company: string;
  readonly title: string;
  readonly city: string;
  readonly state: string;
  readonly salary: string | null;
  readonly experience: string | null;
  readonly licenses: string | null;
  readonly observedOn: string;
  readonly summary: string;
  readonly provenance: AssistedProvenance;
  readonly dataClass: DataClass;
  readonly emailAlert: { readonly sender: string; readonly receivedOn: string; readonly alertReference: string } | null;
  readonly correction?: UrlCorrection | null;
}

const trim = (value: string | null | undefined) => (value ?? "").trim();
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

export function validateAssistedPosting(input: AssistedPostingInput, now: Date): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  const url = trim(input.url);
  if (!url) errors.url = "required"; else if (!canonicalPostingUrl(url)) errors.url = "httpsPublicUrlRequired";
  for (const [field, limit] of [["company", ASSISTED_LIMITS.company], ["title", ASSISTED_LIMITS.title], ["city", ASSISTED_LIMITS.city]] as const) {
    const value = trim(input[field]);
    if (!value) errors[field] = "required"; else if (value.length > limit) errors[field] = "tooLong";
  }
  if (!/^[A-Za-z]{2}$/.test(trim(input.state))) errors.state = "twoLetterState";
  for (const [field, limit] of [["salary", ASSISTED_LIMITS.salary], ["experience", ASSISTED_LIMITS.experience], ["licenses", ASSISTED_LIMITS.licenses]] as const) {
    if (trim(input[field]).length > limit) errors[field] = "tooLong";
  }
  const summary = trim(input.summary);
  if (!summary) errors.summary = "required"; else if (summary.length > ASSISTED_LIMITS.summary) errors.summary = "tooLongUseOwnWords";
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  if (!isDate(trim(input.observedOn))) errors.observedOn = "invalidDate"; else if (trim(input.observedOn) > tomorrow) errors.observedOn = "future";
  if (input.provenance !== "ASSISTED_MANUAL" && input.provenance !== "EMAIL_ALERT") errors.provenance = "invalid";
  if (input.provenance === "EMAIL_ALERT") {
    const alert = input.emailAlert;
    if (!alert || !trim(alert.sender)) errors.emailSender = "required"; else if (trim(alert.sender).length > ASSISTED_LIMITS.sender) errors.emailSender = "tooLong";
    if (!alert || !isDate(trim(alert.receivedOn))) errors.emailReceivedOn = "invalidDate"; else if (trim(alert.receivedOn) > tomorrow) errors.emailReceivedOn = "future";
    if (!alert || !trim(alert.alertReference)) errors.emailAlertReference = "required"; else if (trim(alert.alertReference).length > ASSISTED_LIMITS.alertReference) errors.emailAlertReference = "tooLong";
  } else if (input.emailAlert) errors.emailSender = "onlyForEmailAlert";
  // REAL/DEMO separation follows the local convention: synthetic records say "DEMO LOCAL"; real ones never do.
  const demoNamed = /\bDEMO LOCAL\b/i.test(trim(input.company));
  if (input.dataClass === "DEMO" && !demoNamed) errors.dataClass = "demoMustBeNamedDemoLocal";
  if (input.dataClass === "REAL" && demoNamed) errors.dataClass = "realCannotBeDemoLocal";
  if (input.dataClass !== "REAL" && input.dataClass !== "DEMO") errors.dataClass = "invalid";
  if (input.correction) {
    const reason = trim(input.correction.reason);
    if (!/^[0-9a-f-]{36}$/i.test(trim(input.correction.previousCandidateId))) errors.correction = "invalid";
    if (!reason) errors.correctionReason = "required"; else if (reason.length > ASSISTED_LIMITS.correctionReason) errors.correctionReason = "tooLong";
  }
  return errors;
}

const roleOf = (title: string) => {
  const apprentice = /\b(apprentice|helper|trainee)\b/i.test(title);
  const electrical = /\belectric(al|ian)?\b/i.test(title);
  return {
    profession: electrical ? (apprentice ? "ELECTRICAL APPRENTICE" : "ELECTRICIAN") : null,
    level: /\bhelper\b/i.test(title) ? "HELPER" : /\b(apprentice|trainee)\b/i.test(title) ? "APPRENTICE" : /\bjourneyman\b/i.test(title) ? "JOURNEYMAN" : null,
  };
};
const listOf = (value: string | null) => trim(value).split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 10);

/** Builds the shared posting shape from operator input. Fields the operator did not state stay null; nothing is inferred. */
export function toAssistedPosting(input: AssistedPostingInput): { readonly posting: CapturedPosting; readonly platform: AtsPlatform; readonly identitySource: string } {
  const normalizedUrl = canonicalPostingUrl(trim(input.url))!;
  const role = roleOf(trim(input.title));
  const licenses = listOf(input.licenses);
  const levelClass = classifyPostingLevel({ title: trim(input.title), experience: trim(input.experience) || null, licenses });
  return {
    platform: platformFromUrl(normalizedUrl),
    identitySource: new URL(normalizedUrl).hostname,
    posting: {
      sourceUrl: trim(input.url), normalizedUrl, externalPostingId: externalIdFromUrl(normalizedUrl), employerName: trim(input.company), title: trim(input.title),
      // level from what the posting states (an "Apprentice" requiring experience or a journeyman license is MIXED)
      profession: role.profession, professionalLevel: levelClass === "UNKNOWN" ? role.level : matchingLevelFor(levelClass, trim(input.title)), location: `${trim(input.city)}, ${trim(input.state).toUpperCase()}`,
      compensation: trim(input.salary) || null, perDiem: null, experience: trim(input.experience) || null, licenses, certifications: [],
      // The operator records when they OBSERVED the posting; the source's posting date is not inferred from it.
      postingDate: null, explicitEmployerHeadcount: null, applicationUrl: normalizedUrl,
      relationship: "UNKNOWN", vendorAcceptance: "UNKNOWN", capturedAt: `${trim(input.observedOn)}T12:00:00.000Z`,
      evidenceExcerpt: trim(input.summary), evidenceCompleteness: "PARTIAL", parentAggregateObservationId: null,
    },
  };
}
