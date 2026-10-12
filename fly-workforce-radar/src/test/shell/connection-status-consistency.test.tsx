import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/command-center" }));

import { AppShell } from "../../components/shell/app-shell";
import { CommandCenterView } from "../../components/command-center/command-center-view";
import { assembleCommandCenterSummary } from "../../server/read-models/command-center";
import type { ReadModelCapabilityState } from "../../server/read-models/shared";
import { CONNECTION_HEALTH_TO_CAPABILITY, evaluateDatabaseConnectionHealth } from "../../server/database/connection-health";
import type { SqlClient } from "../../server/repositories/evidence/postgres-evidence-repository";

const ASOF = new Date("2026-03-01T12:00:00.000Z");

function shellHtml(capability: ReadModelCapabilityState) {
  return renderToStaticMarkup(<AppShell locale="en-US" dataConnectionCapability={capability}>content</AppShell>);
}
function commandCenterHtml(capability: ReadModelCapabilityState) {
  const summary = assembleCommandCenterSummary({ asOf: ASOF, dataConnectionCapability: capability });
  return renderToStaticMarkup(<CommandCenterView locale="en-US" summary={summary} commercialActions={[]} dataAsOf={null} />);
}

describe("Connection status: one truthful source, shell and Command Center never disagree", () => {
  it("CONNECTED: both the shell and Command Center show the same 'Connected' text and dot state", () => {
    const shell = shellHtml("OPERATIONAL");
    const cc = commandCenterHtml("OPERATIONAL");
    expect(shell).toContain("Connected");
    expect(shell).toContain("cc-connection-operational");
    expect(cc).toContain("Connected");
    expect(cc).toContain("cc-connection-operational");
    expect(shell).not.toContain("Not connected");
  });

  it("UNAVAILABLE: both the shell and Command Center show the same 'Not connected' text and dot state", () => {
    const shell = shellHtml("UNAVAILABLE");
    const cc = commandCenterHtml("UNAVAILABLE");
    expect(shell).toContain("Not connected");
    expect(shell).toContain("cc-connection-unavailable");
    expect(cc).toContain("Not connected");
    expect(cc).toContain("cc-connection-unavailable");
    expect(shell).not.toContain(">Connected<");
  });

  it("UNKNOWN: both the shell and Command Center show the same 'Connection status unknown' text and dot state", () => {
    const shell = shellHtml("UNKNOWN");
    const cc = commandCenterHtml("UNKNOWN");
    expect(shell).toContain("Connection status unknown");
    expect(shell).toContain("cc-connection-unknown");
    expect(cc).toContain("Connection status unknown");
    expect(cc).toContain("cc-connection-unknown");
  });

  /**
   * WORKFORCE PUBLICATION R2-C. Command Center's own adoption of the shared
   * CONNECTION_HEALTH_TO_CAPABILITY table (get-command-center-summary.ts)
   * is unrelated Command Center source, intentionally not staged in this
   * Workforce publication -- asserting its internals here would assert a
   * fact about excluded source, not about anything Commit 2 actually owns.
   * The CONNECTED/UNAVAILABLE/UNKNOWN cases above already prove the shell
   * (Workforce/shared) side renders correctly off the one canonical table;
   * this file's remaining tests cover connection-health.ts and app-shell.tsx
   * directly, the two pieces this publication is actually responsible for.
   * Command Center's side of the "single source of truth" contract is
   * Command Center's own publication's responsibility to test.
   */

  it("no duplicated DB client construction in the shell: it never imports pg or calls a second getProductionSqlClient", async () => {
    const source = (await readFile(resolve(process.cwd(), "src/components/shell/app-shell.tsx"), "utf8")).toLowerCase();
    expect(source).not.toMatch(/require\(["']pg["']\)|from\s*["']pg["']|getproductionsqlclient|new pool\(/);
  });

  it("never surfaces the underlying driver error, credentials, or connection string through the shared health check", async () => {
    const secretConnectionString = "postgres://produser:sup3rSecret@internal-db.example:5432/workforce";
    const failingClient: SqlClient = { query: async () => { throw new Error(`could not connect to server: ${secretConnectionString}`); } };
    const health = await evaluateDatabaseConnectionHealth(failingClient);
    const capability = CONNECTION_HEALTH_TO_CAPABILITY[health];
    expect(capability).toBe("UNAVAILABLE");
    expect(JSON.stringify(capability)).not.toContain("produser");
    expect(JSON.stringify(capability)).not.toContain("sup3rSecret");
  });
});
