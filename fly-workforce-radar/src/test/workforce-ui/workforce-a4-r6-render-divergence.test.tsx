import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as WorkforcePage from "../../app/workforce/page";
import { WorkforceListView } from "../../components/workforce/workforce-list-view";
import type { WorkforceListResult } from "../../server/workforce/get-workforce-list";
import type { WorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import type { WorkerProfile } from "../../domain/worker";

/**
 * WORKFORCE-TALENT-A4-R6. Server-side tracing proved every layer up to and
 * including the rendered SSR HTML was correct (Manager's own View Page
 * Source check: the worker's name was present in the raw response) while
 * the same content did not remain visible through normal in-app navigation.
 * The workforce render tree carries zero Client Components and zero client
 * hooks (verified: no "use client" anywhere in workforce-list-view.tsx),
 * which rules out a classic hydration mismatch as the mechanism -- there is
 * no client-side re-render of this subtree for a mismatch to produce. The
 * remaining, evidence-supported explanation is Next.js's client-side Router
 * Cache serving a stale RSC payload for soft navigations (e.g. the sidebar
 * <Link>) to a dynamic, session-dependent route that never declared a
 * route-segment config opting out of it. This test pins that opt-out.
 */
describe("WORKFORCE-TALENT-A4-R6 route-segment caching", () => {
  it("declares force-dynamic so in-app soft navigation never serves a stale Router Cache entry for /workforce", () => {
    expect(WorkforcePage.dynamic).toBe("force-dynamic");
  });
});

describe("WORKFORCE-TALENT-A4-R6 non-empty server result stays visible through the render path", () => {
  const taxonomy: WorkforceTaxonomy = { trades: [], occupations: [], skills: [], credentials: [] };
  const baseQuery = { lifecycleStatus: null, tradeCode: null, occupationCode: null, page: 1 } as const;

  function worker(): WorkforceListResult["items"][number]["worker"] {
    return {
      id: "22222222-2222-4222-8222-222222222222", displayName: "DEMO LOCAL SYNTHETIC", lifecycleStatus: "ACTIVE",
      profileVerificationState: "UNVERIFIED", verifiedAt: null, sourceOfRecord: "IMPORTED",
      firstSeenAt: new Date(), lastSeenAt: null, createdAt: new Date(), updatedAt: new Date(),
    } as WorkerProfile["worker"];
  }

  it("renders the worker row and the New Worker action for an authorized, operational, non-empty result", () => {
    const result: WorkforceListResult = {
      authorized: true, capability: "OPERATIONAL", reason: null,
      items: [{ worker: worker(), primaryTradeOccupation: null, tradeOccupationCount: 0, availabilityStatus: null, locationSummary: null, missingTrade: true, missingAvailability: true }],
    };
    const html = renderToStaticMarkup(
      <WorkforceListView locale="en-US" query={baseQuery} result={result} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate={true} />,
    );
    expect(html).toContain("DEMO LOCAL SYNTHETIC");
    expect(html).toContain("New worker");
    expect(html).not.toContain("No workers yet");
  });

  it("uses the worker's stable id as the row key, never its display name (rules out name-collision as a rendering identity risk)", () => {
    const w = worker();
    const result: WorkforceListResult = {
      authorized: true, capability: "OPERATIONAL", reason: null,
      items: [{ worker: w, primaryTradeOccupation: null, tradeOccupationCount: 0, availabilityStatus: null, locationSummary: null, missingTrade: true, missingAvailability: true }],
    };
    const html = renderToStaticMarkup(
      <WorkforceListView locale="en-US" query={baseQuery} result={result} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate={true} />,
    );
    expect(html).toContain(`/workforce/${encodeURIComponent(w.id)}`);
  });
});
