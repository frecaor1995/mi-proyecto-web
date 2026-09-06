"use server";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "./supabase-server-client";

export interface SignInFormState { readonly error: string | null }

/** Server action backing the sign-in form. Returns a dictionary KEY on failure (never rendered English) so the client component can translate it; never echoes the submitted password back. */
export async function signInWithPasswordAction(_previous: SignInFormState, formData: FormData): Promise<SignInFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "auth.signInError" };

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { error: "auth.signInUnavailable" };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "auth.signInError" };
  redirect("/command-center");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}
