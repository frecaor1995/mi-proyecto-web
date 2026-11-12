/**
 * Recipe 2.2 — job level from what the posting states, not from one word in the title. "Apprentice" in a title is not
 * enough to call a posting entry level: if it requires prior experience (e.g. "minimum 1 year", "no inexperienced
 * electricians") or a journeyman license, it is MIXED (apprentice with experience). The official title is never changed.
 */

export type PostingLevelClass = "ENTRY_LEVEL" | "MIXED_APPRENTICE_EXPERIENCED" | "EXPERIENCED" | "UNKNOWN";
/** Matching / demand vocabulary (EvidenceLevel in discovery-intelligence). */
export type MatchingLevel = "APPRENTICE" | "HELPER" | "APPRENTICE_OR_JOURNEYMAN" | "JOURNEYMAN" | "UNKNOWN";

export interface PostingLevelInput {
  readonly title: string | null;
  readonly experience?: string | null;
  readonly licenses?: readonly string[] | string | null;
}

const ENTRY_TITLE = /\b(apprentice|helper|trainee|pre-?apprentice|entry[- ]level)\b/i;
const EXPERIENCED_TITLE = /\b(journeyman|journeyperson|master|foreman|lead|superintendent|general foreman)\b/i;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, un: 1, uno: 1, dos: 2, tres: 3 };

/** Minimum years of experience the text requires, or null when it states none. */
export function requiredExperienceYears(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/\b(\d{1,2}|one|two|three|four|five|un|uno|dos|tres)\s*\+?\s*(?:years?|yrs?|años?)\b/i);
  if (!match) return null;
  const value = /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1].toLowerCase()];
  return value ?? null;
}

const NO_EXPERIENCE = /\b(no (?:prior |previous )?experience (?:is )?(?:required|needed|necessary)|without experience|sin experiencia (?:requerida|necesaria))\b/i;
const REQUIRES_EXPERIENCE = /\b(no inexperienced|inexperienced (?:electricians|applicants|candidates) (?:are )?not (?:accepted|considered)|experience (?:is )?required|must have (?:prior |previous )?experience|sin experiencia no)\b/i;

export function classifyPostingLevel(input: PostingLevelInput): PostingLevelClass {
  const title = input.title ?? "";
  const licenses = Array.isArray(input.licenses) ? input.licenses.join(" ; ") : (input.licenses as string | null | undefined) ?? "";
  const experience = input.experience ?? "";
  const entryTitle = ENTRY_TITLE.test(title);
  if (!entryTitle) return EXPERIENCED_TITLE.test(title) ? "EXPERIENCED" : "UNKNOWN";
  const years = requiredExperienceYears(experience);
  const noExperienceNeeded = NO_EXPERIENCE.test(experience);
  const requiresExperience = !noExperienceNeeded && ((years !== null && years >= 1) || REQUIRES_EXPERIENCE.test(experience));
  const journeymanLicense = /\bjourneyman\b/i.test(licenses);
  return requiresExperience || journeymanLicense ? "MIXED_APPRENTICE_EXPERIENCED" : "ENTRY_LEVEL";
}

/** Level used by the governed demand / matching vocabulary, so Radar, metrics and matching agree. */
export function matchingLevelFor(level: PostingLevelClass, title: string | null): MatchingLevel {
  if (level === "MIXED_APPRENTICE_EXPERIENCED") return "APPRENTICE_OR_JOURNEYMAN";
  if (level === "EXPERIENCED") return "JOURNEYMAN";
  if (level === "ENTRY_LEVEL") return /\bhelper\b/i.test(title ?? "") ? "HELPER" : "APPRENTICE";
  return "UNKNOWN";
}
