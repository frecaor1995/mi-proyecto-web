import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkforceIntelligenceList } from "../../components/workforce/workforce-intelligence-list";
import type { WorkforceListResult } from "../../server/workforce/get-workforce-list";

const worker = (id: string, displayName: string) => ({
  worker: { id, displayName, lifecycleStatus: "ACTIVE" as const, profileVerificationState: "UNVERIFIED" as const, verifiedAt: null, sourceOfRecord: "IMPORTED" as const, firstSeenAt: new Date(), lastSeenAt: null, createdAt: new Date(), updatedAt: new Date() },
  primaryTradeOccupation: null, tradeOccupationCount: 0, availabilityStatus: "AVAILABLE", locationSummary: null, missingTrade: false, missingAvailability: false,
});

describe("Workforce count and pagination remediation", () => {
  it("shows global 41/31/10 counts, explicit page semantics, origin badges, and a functional next link", () => {
    const result: WorkforceListResult = { capability: "OPERATIONAL", authorized: true, reason: null, items: [worker("11111111-1111-4111-8111-111111111111", "REAL WORKER"), worker("22222222-2222-4222-8222-222222222222", "DEMO LOCAL WORKER")], pagination: { page: 1, pageSize: 20, totalItems: 41, totalPages: 3, realItems: 31, demoItems: 10 } };
    const summaries = new Map(result.items.map((item) => [item.worker.id, { workerId: item.worker.id, level: null, levelVerification: null, credentialCount: 0, verifiedCredentialCount: 0, nearestExpiration: null, expirationBand: "UNKNOWN", readiness: "BLOCKED", blockers: ["PRESENTATION_CONSENT_MISSING"] } as const]));
    const html = renderToStaticMarkup(<WorkforceIntelligenceList locale="en-US" result={result} summaries={summaries} trades={[]} query={{ lifecycleStatus: null, tradeCode: null, occupationCode: null, page: 1 }} filters={{ availability: "", level: "", credential: "", readiness: "" }} canCreate={false} />);
    expect(html).toContain("Total workforce</span><strong>41");
    expect(html).toContain("REAL</span><strong>31");
    expect(html).toContain("DEMO LOCAL</span><strong>10");
    expect(html).toContain("Blocked · this page");
    expect(html).toContain("Page 1 of 3");
    expect(html).toContain("Showing 1-20 of 41");
    expect(html).toContain('href="/workforce?page=2"');
  });

  it("preserves active filters when navigating pages", () => {
    const result: WorkforceListResult = { capability: "OPERATIONAL", authorized: true, reason: null, items: [worker("11111111-1111-4111-8111-111111111111", "REAL WORKER")], pagination: { page: 2, pageSize: 20, totalItems: 41, totalPages: 3, realItems: 31, demoItems: 10 } };
    const html = renderToStaticMarkup(<WorkforceIntelligenceList locale="en-US" result={result} summaries={new Map()} trades={[]} query={{ lifecycleStatus: "ACTIVE", tradeCode: "ELECTRICAL", occupationCode: null, page: 2 }} filters={{ availability: "AVAILABLE", level: "APPRENTICE", credential: "", readiness: "BLOCKED" }} canCreate={false} />);
    expect(html).toContain("lifecycle=ACTIVE&amp;trade=ELECTRICAL&amp;availability=AVAILABLE&amp;level=APPRENTICE&amp;readiness=BLOCKED");
  });
});
