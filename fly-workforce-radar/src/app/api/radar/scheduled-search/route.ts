import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { PostgresGovernedDestinationCapture } from "../../../../server/company-discovery/governed-destination-capture";
import { PostgresCompanyDiscoveryRepository } from "../../../../server/company-discovery/discovery-repository";
import { getProductionSqlClient } from "../../../../server/database/production-sql-client";
import { executeDueOpportunitySearches } from "../../../../server/opportunity-search/run-opportunity-discovery";
import { enrichPromisingFromLatestRun } from "../../../../server/source-enrichment/enrich-source";

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
  // Bounded original-source retrieval for a few promising new findings (never a crawl; failures are recorded).
  const enriched = result.executed > 0 ? await enrichPromisingFromLatestRun(client, 5).catch(() => 0) : 0;
  return NextResponse.json({ status: "completed", ...result, enriched });
}
