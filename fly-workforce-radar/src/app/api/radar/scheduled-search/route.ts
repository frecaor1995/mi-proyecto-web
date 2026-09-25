import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { PostgresGovernedDestinationCapture } from "../../../../server/company-discovery/governed-destination-capture";
import { PostgresCompanyDiscoveryRepository } from "../../../../server/company-discovery/discovery-repository";
import { getProductionSqlClient } from "../../../../server/database/production-sql-client";
import { executeDueOpportunitySearches } from "../../../../server/opportunity-search/run-opportunity-discovery";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected); const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  const client = getProductionSqlClient();
  if (!client) return NextResponse.json({ status: "unavailable" }, { status: 503 });
  const result = await executeDueOpportunitySearches({ repository: new PostgresCompanyDiscoveryRepository(client), capture: new PostgresGovernedDestinationCapture(client) });
  return NextResponse.json({ status: "completed", ...result });
}
