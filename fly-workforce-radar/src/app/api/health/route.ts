import { NextResponse } from "next/server";
import { checkWorkforceDatabaseConnectionHealth } from "../../../server/database/connection-health";

export async function GET() {
  const database = await checkWorkforceDatabaseConnectionHealth();
  const healthy = database === "CONNECTED";
  return NextResponse.json(
    { status: healthy ? "healthy" : "degraded", database },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
