import { createServerSupabaseClient } from "./supabase-server-client";

export interface ServerSession { readonly authUserId: string; readonly email: string | null }

/**
 * Resolves the trusted server-side session. Uses supabase.auth.getUser(),
 * which revalidates the token against the Supabase Auth server, rather than
 * trusting a locally-decoded session cookie. Returns null for no session,
 * an expired/revoked session, or a missing Supabase configuration -- all
 * three fail closed identically for callers.
 */
export async function resolveServerSession(): Promise<ServerSession | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { authUserId: data.user.id, email: data.user.email ?? null };
}
