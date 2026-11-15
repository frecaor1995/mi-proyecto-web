import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { getProductionResponseCaptureOwnershipRunner } from "../../server/database/production-sql-client";

type Waiter = () => void;

class AdvisoryLockServer {
  private readonly owners = new Map<string, number>();
  private readonly waiters = new Map<string, Waiter[]>();

  async lock(session: number, key: string): Promise<void> {
    if (!this.owners.has(key)) { this.owners.set(key, session); return; }
    await new Promise<void>((resolve) => {
      const queued = this.waiters.get(key) ?? [];
      queued.push(() => { this.owners.set(key, session); resolve(); });
      this.waiters.set(key, queued);
    });
  }

  unlock(session: number, key: string): boolean {
    if (this.owners.get(key) !== session) return false;
    this.owners.delete(key);
    const next = this.waiters.get(key)?.shift();
    if (next) next();
    return true;
  }
}

function fakePool(server: AdvisoryLockServer, unlockThrows = false) {
  let nextSession = 0;
  const releases: Array<boolean | Error | undefined> = [];
  return {
    releases,
    pool: {
      async connect() {
        const session = ++nextSession;
        return {
          async query(text: string, values?: unknown[]) {
            const key = String(values?.[0] ?? "");
            if (/pg_advisory_lock/.test(text)) { await server.lock(session, key); return { rows: [{}] }; }
            if (/pg_advisory_unlock/.test(text)) {
              if (unlockThrows) throw new Error("INJECTED_UNLOCK_FAILURE");
              return { rows: [{ unlocked: server.unlock(session, key) }] };
            }
            return { rows: [] };
          },
          release(discard?: boolean | Error) { releases.push(discard); },
        };
      },
    } as unknown as Pool,
  };
}

describe("TX-INTEGRITY-04B-R1 response-capture session ownership", () => {
  const priorDatabaseUrl = process.env.DATABASE_URL;
  afterEach(() => {
    globalThis.__flyWorkforceRadarPool = undefined;
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
  });

  it("serializes two workers for the same key across independent transactions", async () => {
    process.env.DATABASE_URL = "postgres://local-test-only";
    const fake = fakePool(new AdvisoryLockServer());
    globalThis.__flyWorkforceRadarPool = fake.pool;
    const own = getProductionResponseCaptureOwnershipRunner()!;
    const order: string[] = [];
    let releaseA!: () => void;
    let phaseAReached!: () => void;
    const holdA = new Promise<void>((resolve) => { releaseA = resolve; });
    const reachedA = new Promise<void>((resolve) => { phaseAReached = resolve; });

    const workerA = own("same-key", async ({ transactionRunner }) => {
      order.push("A:owned");
      await transactionRunner(async () => { order.push("A:phase-1"); phaseAReached(); });
      await holdA;
      await transactionRunner(async () => { order.push("A:phase-2"); });
      order.push("A:done");
    });
    await reachedA;
    const workerB = own("same-key", async () => { order.push("B:owned"); });
    await Promise.resolve();
    expect(order).toEqual(["A:owned", "A:phase-1"]);
    releaseA();
    await Promise.all([workerA, workerB]);
    expect(order).toEqual(["A:owned", "A:phase-1", "A:phase-2", "A:done", "B:owned"]);
    expect(fake.releases).toEqual([false, false]);
  });

  it("destroys rather than pools a session when explicit unlock fails", async () => {
    process.env.DATABASE_URL = "postgres://local-test-only";
    const fake = fakePool(new AdvisoryLockServer(), true);
    globalThis.__flyWorkforceRadarPool = fake.pool;
    const own = getProductionResponseCaptureOwnershipRunner()!;
    await expect(own("same-key", async () => "completed")).rejects.toThrow("INJECTED_UNLOCK_FAILURE");
    expect(fake.releases).toEqual([true]);
  });
});
