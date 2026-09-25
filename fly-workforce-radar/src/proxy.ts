import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { assertProductionConfig } from "./server/config/production-config";
import { decideGlobalOperatorGate, isPublicApplicationPath } from "./server/auth/global-operator-gate";
import { getProductionSqlClient } from "./server/database/production-sql-client";
import { PostgresOperatorRepository } from "./server/repositories/operator/postgres-operator-repository";

/**
 * Refreshes the Supabase Auth session cookie on every request (the current
 * non-deprecated @supabase/ssr pattern). This is session lifecycle only --
 * it does not authorize anything; route-level/server-action authorization
 * still happens via authorizeOperator() (see src/server/auth/authorization.ts).
 * Fails open to NextResponse.next() when Supabase is not configured, since
 * this app has no public routes requiring a session to view.
 */
export async function proxy(request: NextRequest) {
  assertProductionConfig();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const publicPath = isPublicApplicationPath(request.nextUrl.pathname);
  if (!url || !key) return publicPath ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (publicPath) return response;

  const client = getProductionSqlClient();
  const operator = !error && data.user && client
    ? await new PostgresOperatorRepository(client).findByAuthUserId(data.user.id)
    : null;
  const decision = decideGlobalOperatorGate({ authenticated: !error && Boolean(data.user), operatorStatus: operator?.status ?? null });
  if (decision === "ALLOW") return response;
  const redirect = NextResponse.redirect(new URL(`/login?reason=${decision === "DENY_OPERATOR" ? "operator" : "session"}`, request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
