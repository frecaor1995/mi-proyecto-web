import type { Dictionary, DictionaryKey } from "./dictionary-shape";
import type { Locale } from "./locale";
import { dictionary as enUS } from "./locales/en-US";
import { dictionary as esUS } from "./locales/es-US";

export const DICTIONARIES: Record<Locale, Dictionary> = { "en-US": enUS, "es-US": esUS };

function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, source);
}

/**
 * Resolves a dotted DictionaryKey (e.g. "nav.opportunities", "trust.VERIFIED")
 * against the given locale's dictionary, with optional {param} interpolation.
 * Canonical semantic state never flows through here as a VALUE -- only as
 * part of the KEY (see I18N-0 section L/U): callers pass a state like
 * "VERIFIED" as `trust.${state}`, they never pass rendered prose in.
 */
export function t(locale: Locale, key: DictionaryKey, params?: Readonly<Record<string, string>>): string {
  const raw = getPath(DICTIONARIES[locale], key);
  const value = typeof raw === "string" ? raw : `[[missing: ${key}]]`;
  if (!params) return value;
  return Object.entries(params).reduce((acc, [name, replacement]) => acc.replaceAll(`{${name}}`, replacement), value);
}
