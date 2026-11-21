import type { Instrumentation } from "next";
import { assertProductionConfig } from "./server/config/production-config";
import { logServerError } from "./server/observability/safe-release-logger";

export function register(): void {
  // Build compilation is not a serving runtime and may intentionally omit
  // deployment secrets. Proxy repeats this assertion before real traffic.
  if (process.env.NEXT_PHASE !== "phase-production-build") assertProductionConfig();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  logServerError("request_error", {
    path: request.path.split("?")[0],
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    digest,
  });
};
