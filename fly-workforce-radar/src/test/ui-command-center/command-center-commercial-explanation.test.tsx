import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommandCenterView } from "../../components/command-center/command-center-view";
import { commercialActionExplanation } from "../../components/command-center/commercial-action-explanation";
import { assembleCommandCenterSummary } from "../../server/read-models/command-center";
import type { CommercialActionItem } from "../../server/read-models/commercial-action";

describe("Command Center — commercial action reasons in plain language", () => {
  it("shows a plain-language reason instead of the rule engine's technical text, which stays as data", () => {
    const technical = "VERIFY_MANPOWER_ACCEPTANCE: selected by commercial-action@1.0.0 after authoritative eligibility; recommendation only";
    const action: CommercialActionItem = { opportunityId: "o", recommendation: "VERIFY_MANPOWER_ACCEPTANCE", whyNow: technical, blockers: ["A", "B"], supportingRoute: null, provenanceRefs: [],
      canonicalReadiness: { eligibleTypes: [], scoreState: null, score: null }, currentness: "UNKNOWN" as never, recommendationOnly: true };
    const html = renderToStaticMarkup(<CommandCenterView locale="es-US" summary={assembleCommandCenterSummary({ asOf: new Date("2026-10-10T18:00:00Z") })} commercialActions={[action]} dataAsOf={null} />);
    expect(html).toContain("Aún no sabemos si esta empresa acepta trabajadores de agencias o proveedores externos.");
    expect(html).toContain("2 datos pendientes.");
    expect(html.replace(/data-rule-explanation="[^"]*"/g, "")).not.toContain("selected by");
    expect(html).toContain(`data-rule-explanation="${technical}"`);
    expect(commercialActionExplanation("en-US", { recommendation: "UNKNOWN_NEW_ACTION", blockers: [] })).toBe("Review the opportunity before acting. Recommendation only: the system contacts no one.");
  });
});
