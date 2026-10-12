import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Trusted server-side Supabase Auth client (App Router). Reads cookies via
 * next/headers; writes are best-effort (a Server Component cannot set
 * cookies -- session refresh there is handled by middleware.ts instead).
 * This client is used ONLY to authenticate the user; it never queries the
 * Fly Workforce Radar domain tables -- those stay on getProductionSqlClient().
 *
 * next/headers throws outside a real Next.js request scope -- exactly what
 * happens when a page/layout is unit-tested directly (see
 * src/i18n/server-locale.ts for the identical, already-certified pattern).
 * Returning null there is deliberate: it is what lets RootLayout keep
 * rendering unmodified under renderToStaticMarkup, resolving to "no
 * session" rather than throwing.
 */
export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const cookieStore = await cookies();
    return createServerClient(url, key, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component render; middleware.ts refreshes the session instead.
          }
        },
      },
    });
  } catch {
    return null;
  }
}
