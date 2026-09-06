import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase Auth client. Only the public URL and publishable key ever reach the browser -- never DATABASE_URL or a secret/service-role key. */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
