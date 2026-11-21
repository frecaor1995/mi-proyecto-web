import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OperationalResult } from "../../server/opportunity-operations/get-opportunity-operational-result";

const action = (opportunityId: string) => ({
  opportunityId, action: "VERIFY_MANPOWER_ACCEPTANCE", ruleVersion: "commercial-action@1.0.0", evaluatedAt: new Date("2026-10-10T18:00:00.000Z"), asOf: new Date("2026-10-10T18:00:00.000Z"),
  eligibilityBasis: { snapshotIds: [], eligibleTypes: [] }, scoreBasis: { snapshotId: null, state: null, score: null }, supportingRoute: null,
  evidenceIds: [], claimIds: [], contactIds: [], humanDecisionIds: [], acceptance: { id: null, state: "UNKNOWN" }, gaps: ["MISSING_CONTACT"], preventedStrongerActions: [],
  explanation: "VERIFY_MANPOWER_ACCEPTANCE: selected by commercial-action@1.0.0 after authoritative eligibility; recommendation only", recommendationOnly: true,
});
const item = (id: string, title: string, classification: string, company: { id: string; name: string } | null): OperationalResult => ({
  opportunityId: id, title, companyId: company?.id ?? null, companyName: company?.name ?? null, classification,
  commercialActionResult: action(id), gatedAction: { gate: "ACTIVE", activeRecommendation: null, explanation: "" },
} as unknown as OperationalResult);

const radarItems = [
  item("real-1", "$22-$57/hr Electrician Jobs Houston, TX", "NEAR_READY", null),
  item("demo-1", "DEMO LOCAL SYNTHETIC — Complete Electrical Workforce Opportunity", "HOT", { id: "c-demo", name: "DEMO LOCAL Contractor" }),
  item("demo-2", "DEMO LOCAL B5 VALIDATION OPPORTUNITY", "NEAR_READY", null),
  item("real-2", "Industrial electricians — Baytown", "WATCH", { id: "c-real", name: "Walker Engineering" }),
];

vi.mock("../../server/database/connection-health", async (orig) => ({ ...(await orig<object>()), checkWorkforceDatabaseConnectionHealth: async () => "OPERATIONAL" }));
vi.mock("../../server/human-verification-desk/get-human-verification-desk", () => ({ loadOpenHumanVerificationWorkload: async () => ({ state: "READY", openCount: 1 }) }));
vi.mock("../../server/opportunity-operations/get-operational-radar-summary", () => ({
  loadOperationalRadar: async () => ({ state: "READY", summary: { asOf: "2026-10-10T18:00:00.000Z", items: radarItems, evaluatedCount: 4, totalOpportunities: 4, coverageComplete: true, failedCount: 0 } }),
}));

describe("Command Center — HOT / Near Ready / recommendations exclude DEMO opportunities", () => {
  it("counts only REAL opportunities, reports DEMO apart with the same DEMO LOCAL title rule, and keeps each recommendation's identity", async () => {
    const { getCommandCenterPageData } = await import("../../server/command-center/get-command-center-summary");
    const data = await getCommandCenterPageData(new Date("2026-10-10T18:00:00Z"));
    expect(data.summary.hotCount.value).toEqual({ state: "KNOWN", value: 0 });
    expect(data.summary.nearReadyCount.value).toEqual({ state: "KNOWN", value: 1 });
    expect(data.summary.prioritizedActionCount.value).toEqual({ state: "KNOWN", value: 2 });
    expect(data.demo).toEqual({ hot: 1, nearReady: 1, prioritized: 2, opportunities: 2 });
    expect(data.commercialActions.map((a) => [a.opportunityId, a.title, a.companyName, a.isDemo])).toEqual([
      ["real-1", "$22-$57/hr Electrician Jobs Houston, TX", null, false],
      ["real-2", "Industrial electricians — Baytown", "Walker Engineering", false],
    ]);
    expect(data.demoCommercialActions.every((a) => a.isDemo)).toBe(true);
    expect(data.demoCommercialActions.map((a) => a.opportunityId).sort()).toEqual(["demo-1", "demo-2"]);
  });

  it("renders title, link, canonical company or 'not confirmed', the action, and a separate DEMO block", async () => {
    const { getCommandCenterPageData } = await import("../../server/command-center/get-command-center-summary");
    const { CommandCenterView } = await import("../../components/command-center/command-center-view");
    const data = await getCommandCenterPageData(new Date("2026-10-10T18:00:00Z"));
    const html = renderToStaticMarkup(<CommandCenterView locale="es-US" summary={data.summary} commercialActions={data.commercialActions}
      demoCommercialActions={data.demoCommercialActions} demoMetrics={data.demo} dataAsOf={null} />);
    expect(html).toContain('href="/opportunities/real-1"');
    expect(html).toContain("$22-$57/hr Electrician Jobs Houston, TX");
    expect(html).toContain("Empresa no confirmada (sin vínculo canónico)"); // no company invented from free text
    expect(html).toContain('href="/companies/c-real"');
    expect(html).toContain("Verificar aceptación de mano de obra");
    expect(html).toContain("Recomendaciones DEMO / prueba (2) — no son trabajo real");
    expect(html).toContain("2 oportunidades DEMO excluidas de estos indicadores (HOT 1 · Casi listas 1 · priorizadas 2).");
    const realList = html.slice(0, html.indexOf("Recomendaciones DEMO"));
    expect(realList).not.toContain("DEMO LOCAL SYNTHETIC");
    expect(html.replace(/data-rule-explanation="[^"]*"/g, "")).not.toContain("selected by");
  });
});
