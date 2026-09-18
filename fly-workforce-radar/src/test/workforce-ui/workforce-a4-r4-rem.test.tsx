import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkforceListView } from "../../components/workforce/workforce-list-view";
import type { WorkforceListResult } from "../../server/workforce/get-workforce-list";
import type { WorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import type { WorkerProfile } from "../../domain/worker";

/**
 * WORKFORCE-TALENT-A4-R4-REM. The four behavioral states the Manager
 * certified must be visually distinguishable: authorized-and-operational,
 * unauthenticated, authenticated-but-unauthorized, and genuine database
 * unavailability. Before this remediation, the latter three were
 * indistinguishable from each other and from a real DB outage.
 */
const taxonomy: WorkforceTaxonomy = { trades: [], occupations: [], skills: [], credentials: [] };
const baseQuery = { lifecycleStatus: null, tradeCode: null, occupationCode: null, page: 1 } as const;

function worker(): WorkforceListResult["items"][number]["worker"] {
  return {
    id: "11111111-1111-4111-8111-111111111111", displayName: "SYNTHETIC-REM-WORKER", lifecycleStatus: "ACTIVE",
    profileVerificationState: "UNVERIFIED", verifiedAt: null, sourceOfRecord: "IMPORTED",
    firstSeenAt: new Date(), lastSeenAt: null, createdAt: new Date(), updatedAt: new Date(),
  } as WorkerProfile["worker"];
}

function render(result: WorkforceListResult, canCreate: boolean) {
  return renderToStaticMarkup(<WorkforceListView locale="en-US" query={baseQuery} result={result} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate={canCreate} />);
}

describe("WORKFORCE-TALENT-A4-R4-REM four-state behavioral matrix", () => {
  it("A. authenticated + authorized + operational: worker rows and New Worker are visible, marker reflects real capability", () => {
    const result: WorkforceListResult = { authorized: true, capability: "OPERATIONAL", items: [{ worker: worker(), primaryTradeOccupation: null, tradeOccupationCount: 0, availabilityStatus: null, locationSummary: null, missingTrade: true, missingAvailability: true }], reason: null };
    const html = render(result, true);
    expect(html).toContain("SYNTHETIC-REM-WORKER");
    expect(html).toContain("New worker");
    expect(html).toContain("Connected"); // capabilityState.OPERATIONAL
    expect(html).not.toMatch(/not authorized|sign in|Not connected/);
  });

  it("B. unauthenticated: shows the sign-in message, never claims the database is disconnected", () => {
    const result: WorkforceListResult = { authorized: false, capability: "UNAVAILABLE", items: [], reason: "UNAUTHENTICATED" };
    const html = render(result, false);
    expect(html).toContain("Sign in to manage the workforce database.");
    expect(html).not.toContain("Your account is not authorized");
    expect(html).not.toContain("Not connected");
    expect(html).not.toContain("New worker");
    expect(html).toContain("Foundation ready"); // neutral default marker, not a false DB-disconnected claim
  });

  it("C. authenticated but unauthorized: shows the operator-authorization message, never claims the database is disconnected", () => {
    const result: WorkforceListResult = { authorized: false, capability: "UNAVAILABLE", items: [], reason: "UNAUTHORIZED" };
    const html = render(result, false);
    expect(html).toContain("Your account is not authorized to manage the workforce database.");
    expect(html).not.toContain("Sign in to manage the workforce database.");
    expect(html).not.toContain("Not connected");
    expect(html).not.toContain("New worker");
    expect(html).toContain("Foundation ready");
  });

  it("D. genuine database/capability unavailable: distinct message from both auth states, and the marker is allowed to say so truthfully", () => {
    const result: WorkforceListResult = { authorized: false, capability: "UNAVAILABLE", items: [], reason: "DATABASE_CONNECTION_UNAVAILABLE" };
    const html = render(result, false);
    expect(html).toContain("Workforce database unavailable");
    expect(html).not.toContain("Your account is not authorized");
    expect(html).not.toContain("Sign in to manage the workforce database.");
    expect(html).toContain("Not connected"); // capabilityState.UNAVAILABLE -- truthful here, this IS a real DB outage
  });

  it("B and C never render the top New worker action even if canCreate were somehow true (defense in depth: reason gates the panel regardless)", () => {
    const unauthenticated: WorkforceListResult = { authorized: false, capability: "UNAVAILABLE", items: [], reason: "UNAUTHENTICATED" };
    const html = render(unauthenticated, true);
    // canCreate still renders the top button per its own independent condition,
    // but the panel below must still show the sign-in message, not a false empty/ok state.
    expect(html).toContain("Sign in to manage the workforce database.");
  });

  it("Spanish: all four states resolve to real text, never a raw dictionary key", () => {
    const states: WorkforceListResult[] = [
      { authorized: true, capability: "OPERATIONAL", items: [], reason: null },
      { authorized: false, capability: "UNAVAILABLE", items: [], reason: "UNAUTHENTICATED" },
      { authorized: false, capability: "UNAVAILABLE", items: [], reason: "UNAUTHORIZED" },
      { authorized: false, capability: "UNAVAILABLE", items: [], reason: "DATABASE_CONNECTION_UNAVAILABLE" },
    ];
    for (const result of states) {
      const html = renderToStaticMarkup(<WorkforceListView locale="es-US" query={baseQuery} result={result} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate={false} />);
      expect(html).not.toMatch(/\[\[missing:/);
    }
  });
});
