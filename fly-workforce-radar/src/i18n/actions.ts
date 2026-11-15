"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE_NAME, SUPPORTED_LOCALES, localeCookieOptions, type Locale } from "./locale";

/**
 * Persists an explicit language-selector choice (I18N-0 section G/F step 1 --
 * an explicit user action always wins and is never overridden by
 * Accept-Language again).
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, localeCookieOptions(process.env.NODE_ENV === "production"));
  revalidatePath("/", "layout");
}
