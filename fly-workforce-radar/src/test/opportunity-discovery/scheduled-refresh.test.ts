import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextScheduledRun, scheduledWindow } from "../../domain/opportunity-search";
import { DEFAULT_QUERIES_PER_CYCLE, MAX_QUERIES_PER_CYCLE } from "../../domain/discovery-coverage";

vi.mock("../../server/database/production-sql-client", () => ({ getProductionSqlClient: () => null }));

describe("six-hour scheduled refresh", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("authenticates the existing scheduler endpoint with CRON_SECRET only", async () => {
    vi.stubEnv("CRON_SECRET", "local-test-secret");
    const { GET } = await import("../../app/api/radar/scheduled-search/route");
    expect((await GET(new Request("http://localhost/api/radar/scheduled-search"))).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/radar/scheduled-search", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    // Authorized, but no database in this test: the endpoint reports unavailable instead of pretending to run.
    expect((await GET(new Request("http://localhost/api/radar/scheduled-search", { headers: { authorization: "Bearer local-test-secret" } }))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(new Request("http://localhost/api/radar/scheduled-search", { headers: { authorization: "Bearer " } }))).status).toBe(401);
  });

  it("runs once per six-hour window and advances the due time by six hours", () => {
    const at = new Date("2026-09-30T13:47:00Z");
    const window = scheduledWindow(at, 6);
    expect(window.toISOString()).toBe("2026-09-30T12:00:00.000Z");
    expect(scheduledWindow(new Date("2026-09-30T17:59:59Z"), 6).toISOString()).toBe(window.toISOString());
    expect(nextScheduledRun(window, 6).toISOString()).toBe("2026-09-30T18:00:00.000Z");
  });

  it("ships a six-hour cadence migration and keeps the existing cron route (no second scheduler)", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929010000_discovery_six_hour_cadence.sql"), "utf8");
    expect(migration).toMatch(/set cadence_hours = 6/);
    expect(migration).toMatch(/profile_kind = 'MULTI_TRADE_CYCLE'/);
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string }[] };
    expect(vercel.crons.map((cron) => cron.path)).toEqual(["/api/radar/scheduled-search"]);
  });

  it("keeps the provider budget bounded: 10 queries × 4 cycles/day ≈ 1,200 per 30 days", () => {
    expect(DEFAULT_QUERIES_PER_CYCLE).toBe(10);
    expect(MAX_QUERIES_PER_CYCLE).toBe(20);
    expect(DEFAULT_QUERIES_PER_CYCLE * (24 / 6) * 30).toBe(1200);
  });
});
