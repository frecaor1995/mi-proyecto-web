import type { OperatorStatus } from "../../domain/operator";

export type GlobalGateDecision = "ALLOW" | "REQUIRE_LOGIN" | "DENY_OPERATOR";

export function decideGlobalOperatorGate(input: {
  readonly authenticated: boolean;
  readonly operatorStatus: OperatorStatus | null;
}): GlobalGateDecision {
  if (!input.authenticated) return "REQUIRE_LOGIN";
  return input.operatorStatus === "ACTIVE" ? "ALLOW" : "DENY_OPERATOR";
}

export function isPublicApplicationPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth/") || pathname === "/api/health"
    || pathname === "/api/radar/scheduled-search";
}
