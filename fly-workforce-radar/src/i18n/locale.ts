/**
 * I18N-1. Single authoritative locale definition -- no other file in the app
 * may declare its own locale string literal union. Frozen by I18N-0: no URL
 * locale prefixes, en-US is the permanent final fallback.
 */
export const SUPPORTED_LOCALES = ["en-US", "es-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en-US";
export const LOCALE_COOKIE_NAME = "fwr-locale";

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Pure cookie-attribute policy (I18N-0 section G): ~1 year, Lax, Secure only
 * in production. Kept separate from the actual `cookies().set(...)` call
 * (see src/i18n/actions.ts) so the policy itself is unit-testable without a
 * real Next.js request context.
 */
export function localeCookieOptions(isProduction: boolean): { path: string; maxAge: number; sameSite: "lax"; secure: boolean } {
  return { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: isProduction };
}

/**
 * Picks a supported locale out of a raw Accept-Language header value, e.g.
 * "es-MX,es;q=0.9,en;q=0.8". Matches on base language (the part before "-")
 * against each supported locale's own base language, in the header's
 * stated preference order. Returns null if nothing matches -- callers fall
 * back to DEFAULT_LOCALE, never invent a match.
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const preferences = header
    .split(",")
    .map((part) => part.trim().split(";")[0])
    .filter(Boolean);
  for (const preferred of preferences) {
    const preferredBase = preferred.split("-")[0]?.toLowerCase();
    const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === preferred.toLowerCase());
    if (exact) return exact;
    const baseMatch = SUPPORTED_LOCALES.find((locale) => locale.split("-")[0].toLowerCase() === preferredBase);
    if (baseMatch) return baseMatch;
  }
  return null;
}

/**
 * Deterministic resolution precedence (I18N-0 section F):
 *   1. authenticated user preference   -- not implemented, auth does not exist yet
 *   2. workspace preference            -- not implemented, workspaces do not exist yet
 *   3. fwr-locale cookie
 *   4. Accept-Language header
 *   5. DEFAULT_LOCALE
 *
 * Signals are passed in explicitly (rather than this function reaching into
 * next/headers itself) so it stays a pure, synchronous, framework-free
 * function: trivially unit-testable, and safe to call from any rendering
 * context -- including outside a real Next.js request (e.g. a component
 * unit test), where it simply has no cookie/header signals to consider and
 * falls through to DEFAULT_LOCALE. Callers inside a real request (see
 * src/i18n/server-locale.ts) are the only place that reads next/headers.
 */
export function resolveLocaleFromSignals(input: {
  authenticatedUserLocale?: string | null;
  workspaceLocale?: string | null;
  cookieLocale?: string | null;
  acceptLanguageHeader?: string | null;
}): Locale {
  if (isSupportedLocale(input.authenticatedUserLocale)) return input.authenticatedUserLocale;
  if (isSupportedLocale(input.workspaceLocale)) return input.workspaceLocale;
  if (isSupportedLocale(input.cookieLocale)) return input.cookieLocale;
  const fromHeader = matchAcceptLanguage(input.acceptLanguageHeader);
  if (fromHeader) return fromHeader;
  return DEFAULT_LOCALE;
}
