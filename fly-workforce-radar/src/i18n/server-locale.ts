import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, resolveLocaleFromSignals, type Locale } from "./locale";

/**
 * The ONLY function in the app permitted to read next/headers for locale
 * purposes (I18N-0 section G: one resolver, nothing else reads
 * cookies/headers directly). Async because Next.js 16's cookies()/headers()
 * are async APIs. Authenticated-user and workspace preference signals are
 * left undefined -- there is no auth/workspace system yet (I18N-0 section 6);
 * resolveLocaleFromSignals already treats an absent signal as "skip this
 * tier," so adding those signals later is additive, not a rewrite.
 *
 * next/headers throws when called outside a real Next.js request scope --
 * which is exactly what happens when a page component is unit-tested
 * directly (no dev/build server involved). Falling back to DEFAULT_LOCALE in
 * that case is deliberate, not a swallowed bug: it's what lets UI-1's
 * existing renderToStaticMarkup-based component tests keep working
 * unmodified in their assertions, rendering the same English text as before
 * I18N-1, while a real running app still resolves the genuine per-request
 * locale.
 */
export async function resolveServerLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    const headerStore = await headers();
    return resolveLocaleFromSignals({
      cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null,
      acceptLanguageHeader: headerStore.get("accept-language"),
    });
  } catch {
    return DEFAULT_LOCALE;
  }
}
