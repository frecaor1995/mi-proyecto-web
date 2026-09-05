import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/command-center" }));

import CommandCenter from "../../app/command-center/page";
import { CommandCenterView } from "../../components/command-center/command-center-view";
import { MetricTile } from "../../components/command-center/metric-tile";
import { NAVIGATION } from "../../components/shell/app-shell";
import { TrustState, CurrentnessBadge } from "../../components/ui/status-primitives";
import { SUPPORTED_LOCALES } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import { assembleCommandCenterSummary, COMMAND_CENTER_METRIC_KINDS } from "../../server/read-models/command-center";
import { knownMetric, unknownMetric, unavailableMetric } from "../../server/read-models/shared";
import type { CommercialActionItem } from "../../server/read-models/commercial-action";

const ASOF = new Date("2026-03-01T12:00:00.000Z");

function commercialActionFixture(overrides: Partial<CommercialActionItem> = {}): CommercialActionItem {
  return {
    opportunityId: "opp-1",
    recommendation: "CALL_TODAY",
    whyNow: "Acme Corp confirmed external manpower acceptance last week",
    blockers: [],
    supportingRoute: null,
    provenanceRefs: [],
    canonicalReadiness: { eligibleTypes: ["HOT_A_ELIGIBLE"], scoreState: "SCORED", score: 90 },
    currentness: "CURRENT",
    recommendationOnly: true,
    ...overrides,
  };
}

describe("UI-3 Command Center (section 17)", () => {
  it("1. /command-center renders the professional Command Center", async () => {
    const html = renderToStaticMarkup(await CommandCenter());
    expect(html).toContain("Command Center");
    expect(html).toContain("cc-connection-row");
    expect(html).toContain("metric-band");
    expect(html).toContain("cc-panel");
  });

  it("2. the 8 semantic metric kinds are mapped to localized presentation labels", () => {
    expect(COMMAND_CENTER_METRIC_KINDS).toHaveLength(8);
    for (const kind of COMMAND_CENTER_METRIC_KINDS) {
      expect(t("en-US", `commandCenter.metricKindLabel.${kind}`)).not.toMatch(/^\[\[missing/);
    }
  });

  it("3. en-US metric labels render correctly", () => {
    const html = renderToStaticMarkup(<MetricTile locale="en-US" kind="HOT_OPPORTUNITIES" value={unknownMetric()} />);
    expect(html).toContain("Current count unavailable: HOT opportunities.");
  });

  it("4. es-US metric labels render correctly", () => {
    const html = renderToStaticMarkup(<MetricTile locale="es-US" kind="HOT_OPPORTUNITIES" value={unknownMetric()} />);
    expect(html).toContain("Conteo actual no disponible: oportunidades HOT.");
  });

  it("5. KNOWN 0 displays as 0", () => {
    const html = renderToStaticMarkup(<MetricTile locale="en-US" kind="HOT_OPPORTUNITIES" value={knownMetric(0)} />);
    expect(html).toContain(">0<");
    expect(html).toContain("There are currently no HOT opportunities.");
  });

  it("6. UNKNOWN does not display as 0", () => {
    const html = renderToStaticMarkup(<MetricTile locale="en-US" kind="HOT_OPPORTUNITIES" value={unknownMetric()} />);
    expect(html).not.toContain(">0<");
    expect(html).toContain("metric-tile-unknown");
  });

  it("7. UNAVAILABLE is distinct from UNKNOWN", () => {
    const unknownHtml = renderToStaticMarkup(<MetricTile locale="en-US" kind="HOT_OPPORTUNITIES" value={unknownMetric()} />);
    const unavailableHtml = renderToStaticMarkup(<MetricTile locale="en-US" kind="HOT_OPPORTUNITIES" value={unavailableMetric("no assembler yet")} />);
    expect(unknownHtml).toContain("metric-tile-unknown");
    expect(unavailableHtml).toContain("metric-tile-unavailable");
    expect(unknownHtml).not.toBe(unavailableHtml);
    expect(unavailableHtml).toContain("Data for HOT opportunities is not connected yet.");
  });

  it("8. no fake metric numbers exist in production/default data state", async () => {
    const html = renderToStaticMarkup(await CommandCenter());
    expect(html).not.toContain("metric-tile-known");
    expect(html).not.toMatch(/Acme|Bechtel|Hays|MMR|Finish Line|HOT [1-9]/);
  });

  it("9. HOT state is not inferred from candidate/unverified state", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF });
    expect(summary.hotCount.value.state).not.toBe("KNOWN");
    const html = renderToStaticMarkup(<MetricTile locale="en-US" kind="HOT_OPPORTUNITIES" value={summary.hotCount.value} />);
    expect(html).not.toContain(">0<");
  });

  it("10. attention section handles missing evidence", async () => {
    const html = renderToStaticMarkup(await CommandCenter());
    expect(html).toContain("missing evidence");
  });

  it("11. attention section handles stale evidence", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF, staleEvidenceCount: knownMetric(4) });
    const html = renderToStaticMarkup(
      <CommandCenterView locale="en-US" summary={summary} commercialActions={[]} dataAsOf={null} />,
    );
    expect(html).toContain("stale evidence items");
    expect(html).toContain(">4<");
  });

  it("12. attention section handles conflicts", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF, conflictCount: knownMetric(2) });
    const html = renderToStaticMarkup(
      <CommandCenterView locale="en-US" summary={summary} commercialActions={[]} dataAsOf={null} />,
    );
    expect(html).toContain("conflicts");
    expect(html).toContain(">2<");
  });

  it("13. human verification required remains distinct", () => {
    const trustHtml = renderToStaticMarkup(<TrustState state="HUMAN_VERIFICATION_REQUIRED" locale="en-US" />);
    const metricHtml = renderToStaticMarkup(<MetricTile locale="en-US" kind="VERIFICATION_WORK" value={unknownMetric()} />);
    expect(trustHtml).toContain("Human verification required");
    expect(metricHtml).not.toContain("Human verification required");
  });

  it("14. commercial action displays localized label while preserving the canonical action code", () => {
    const action = commercialActionFixture({ recommendation: "VERIFY_CONTACT" });
    const enHtml = renderToStaticMarkup(
      <CommandCenterView locale="en-US" summary={assembleCommandCenterSummary({ asOf: ASOF })} commercialActions={[action]} dataAsOf={null} />,
    );
    const esHtml = renderToStaticMarkup(
      <CommandCenterView locale="es-US" summary={assembleCommandCenterSummary({ asOf: ASOF })} commercialActions={[action]} dataAsOf={null} />,
    );
    expect(enHtml).toContain("Verify contact");
    expect(esHtml).toContain("Verificar contacto");
    expect(action.recommendation).toBe("VERIFY_CONTACT");
  });

  it("15. no automatic commercial action is executed", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/command-center/command-center-view.tsx"), "utf8");
    expect(source).not.toMatch(/fetch\(|onClick=\{.*(call|email|register|verify)/i);
    expect(source).not.toContain("useEffect");
  });

  it("16. source/radar capability does not claim autonomous continuous search unless provided by read model", async () => {
    const source = await readFile(resolve(process.cwd(), "src/i18n/locales/en-US.ts"), "utf8");
    expect(source).not.toMatch(/scanning now|autonomous|continuous search/i);
    const html = renderToStaticMarkup(await CommandCenter());
    expect(html).toContain("configured adapters");
  });

  it("17. trust badge localizes without changing semantic state", () => {
    const en = renderToStaticMarkup(<TrustState state="VERIFIED" locale="en-US" />);
    const es = renderToStaticMarkup(<TrustState state="VERIFIED" locale="es-US" />);
    const classOf = (html: string) => html.match(/class="([^"]+)"/)?.[1];
    expect(classOf(en)).toBe(classOf(es));
    expect(en).toContain("Verified");
    expect(es).toContain("Verificado");
  });

  it("18. currentness badge localizes without changing semantic state", () => {
    const en = renderToStaticMarkup(<CurrentnessBadge state="AGING" locale="en-US" />);
    const es = renderToStaticMarkup(<CurrentnessBadge state="AGING" locale="es-US" />);
    const classOf = (html: string) => html.match(/class="([^"]+)"/)?.[1];
    expect(classOf(en)).toBe(classOf(es));
    expect(en).toContain("Aging");
    expect(es).toContain("Por vencer");
  });

  it("19. the same CommandCenterSummary can render in en-US and es-US", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF, hotCount: knownMetric(0) });
    for (const locale of SUPPORTED_LOCALES) {
      const html = renderToStaticMarkup(<CommandCenterView locale={locale} summary={summary} commercialActions={[]} dataAsOf={null} />);
      expect(html.length).toBeGreaterThan(0);
    }
  });

  it("20. proper names are not translated", () => {
    const action = commercialActionFixture({ whyNow: "Acme Corp confirmed external manpower acceptance last week" });
    const enHtml = renderToStaticMarkup(
      <CommandCenterView locale="en-US" summary={assembleCommandCenterSummary({ asOf: ASOF })} commercialActions={[action]} dataAsOf={null} />,
    );
    const esHtml = renderToStaticMarkup(
      <CommandCenterView locale="es-US" summary={assembleCommandCenterSummary({ asOf: ASOF })} commercialActions={[action]} dataAsOf={null} />,
    );
    expect(enHtml).toContain("Acme Corp confirmed external manpower acceptance last week");
    expect(esHtml).toContain("Acme Corp confirmed external manpower acceptance last week");
  });

  it("21. unknown timestamp is not fabricated", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF });
    const html = renderToStaticMarkup(<CommandCenterView locale="en-US" summary={summary} commercialActions={[]} dataAsOf={null} />);
    expect(html).not.toContain("As of");
  });

  it("22. known asOf uses the locale formatter", () => {
    const knownAsOf = new Date("2026-02-14T00:00:00.000Z");
    const summary = assembleCommandCenterSummary({ asOf: ASOF });
    const html = renderToStaticMarkup(<CommandCenterView locale="en-US" summary={summary} commercialActions={[]} dataAsOf={knownAsOf} />);
    expect(html).toContain("As of");
    expect(html).toMatch(/Feb(ruary)? 1[34], 2026/);
  });

  it("23. accessibility labels are localized", async () => {
    const html = renderToStaticMarkup(await CommandCenter());
    expect(html).toContain('aria-label="Data connection"');
  });

  it("24. responsive semantic structure remains valid", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain(".metric-band{grid-template-columns:repeat(2,1fr)}");
    expect(css).toContain(".cc-two-column{grid-template-columns:1fr}");
  });

  it("25. existing UI-1 navigation still reaches /command-center", () => {
    const paths = NAVIGATION.flatMap((group) => group.items.map((item) => item.href));
    expect(paths).toContain("/command-center");
  });

  it("26. existing I18N language switching remains intact for this page", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF });
    const enHtml = renderToStaticMarkup(<CommandCenterView locale="en-US" summary={summary} commercialActions={[]} dataAsOf={null} />);
    const esHtml = renderToStaticMarkup(<CommandCenterView locale="es-US" summary={summary} commercialActions={[]} dataAsOf={null} />);
    expect(enHtml).toContain("Command Center");
    expect(esHtml).toContain("Centro de Mando");
    expect(enHtml).not.toBe(esHtml);
  });

  it("28. no direct database/Supabase access is introduced into UI-3", async () => {
    const files = [
      "src/server/command-center/get-command-center-summary.ts",
      "src/components/command-center/command-center-view.tsx",
      "src/components/command-center/metric-tile.tsx",
      "src/app/command-center/page.tsx",
    ];
    for (const file of files) {
      const source = await readFile(resolve(process.cwd(), file), "utf8");
      expect(source.toLowerCase()).not.toContain("supabase");
      expect(source).not.toMatch(/createClient\(|\.from\(["'`]|\bSQL\b/);
    }
  });
});
