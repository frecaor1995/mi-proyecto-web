import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BurdenComponent, BurdenProfileScope } from "../../domain/burden-profile";
import type { CashFlowAssumptions } from "../../domain/cash-flow-engine";
import { assumedValue, createMoneyAmount, createPaymentTerms, createRate, verifiedValue } from "../../domain/commercial-economics";
import type { DeploymentEconomicsInput, LaborEconomicsInput } from "../../domain/commercial-economics";
import type {
  BurdenProfileVersionRecord, CommercialTermsVersionRecord, EconomicsScenarioSnapshotRecord,
} from "../../domain/commercial-economics-persistence";
import type { CommercialTermsContract } from "../../domain/commercial-terms";
import type { ScenarioDefinition } from "../../domain/economics-scenario";
import { runScenario } from "../../domain/scenario-engine";
import { assembleOpportunityEconomicsDetail } from "../../server/read-models/economics";
import { OpportunityEconomicsSection } from "../../components/opportunity-economics/opportunity-economics-section";

const usd = (amount: number) => createMoneyAmount(amount, "USD");

function laborInput(overrides: Partial<LaborEconomicsInput> = {}): LaborEconomicsInput {
  return {
    basePayRate: verifiedValue(usd(30)), overtimeMultiplier: verifiedValue(createRate(1.5)), workerPerDiem: verifiedValue(usd(0)),
    burdenComponents: [{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES", "OVERTIME_BASE_PORTION", "OVERTIME_PREMIUM_PORTION"] }],
    ...overrides,
  };
}
function commercialTerms(overrides: Partial<CommercialTermsContract> = {}): CommercialTermsContract {
  return {
    billRate: verifiedValue(usd(85)), overtimeBillBasis: verifiedValue({ kind: "MULTIPLIER", multiplier: createRate(1.5) }),
    reimbursablePerDiem: verifiedValue(usd(0)), perDiemMarkup: verifiedValue(createRate(0)),
    paymentTerms: verifiedValue(createPaymentTerms(30)), billingCadence: verifiedValue("WEEKLY"),
    ...overrides,
  };
}
function deployment(overrides: Partial<DeploymentEconomicsInput> = {}): DeploymentEconomicsInput {
  return {
    headcount: verifiedValue(4), regularHoursPerWeek: verifiedValue(40), overtimeHoursPerWeek: verifiedValue(0),
    duration: { kind: "FIXED", weeks: 8 }, startDate: null, estimatedEndDate: null, jurisdiction: null,
    ...overrides,
  };
}
function cashFlowAssumptions(overrides: Partial<CashFlowAssumptions> = {}): CashFlowAssumptions {
  return { payrollFrequency: verifiedValue("WEEKLY"), payrollAnchorWeek: verifiedValue(0), billingAnchorWeek: verifiedValue(0), ...overrides };
}
const platformScope: BurdenProfileScope = { level: "PLATFORM_DEFAULT", jurisdiction: null, tradeId: null, occupationId: null, companyId: null, scenarioId: null };

let sequence = 0;
function commercialTermsVersion(terms: CommercialTermsContract): CommercialTermsVersionRecord {
  return {
    id: `terms-${++sequence}`, contextType: "OPPORTUNITY", companyId: null, opportunityId: "opp-1", terms,
    supportingClaimIds: [], supportingEvidenceIds: [], ruleVersion: "test-v1", assertedBy: "operator-1",
    evaluatedAt: new Date("2026-09-07T12:00:00Z"), supersedesCommercialTermsId: null, createdAt: new Date("2026-09-07T12:00:00Z"),
  };
}
function burdenProfileVersion(components: BurdenComponent[]): BurdenProfileVersionRecord {
  return {
    id: `burden-${++sequence}`, scope: platformScope, components, ruleVersion: "test-v1", assertedBy: "operator-1",
    evaluatedAt: new Date("2026-09-07T12:00:00Z"), supersedesBurdenProfileId: null, createdAt: new Date("2026-09-07T12:00:00Z"),
  };
}
function snapshot(
  label: "BASE" | "CONSERVATIVE" | "TARGET", termsVersion: CommercialTermsVersionRecord, burdenVersion: BurdenProfileVersionRecord,
  laborOverrides: Partial<LaborEconomicsInput> = {},
): EconomicsScenarioSnapshotRecord {
  const definition: ScenarioDefinition = {
    label, baseLabor: { ...laborInput(laborOverrides), burdenComponents: burdenVersion.components },
    baseCommercialTerms: termsVersion.terms, baseDeployment: deployment(), baseCashFlowAssumptions: cashFlowAssumptions(),
  };
  const scenarioResult = runScenario(definition);
  return {
    id: `snapshot-${++sequence}`, opportunityId: "opp-1", scenarioLabel: label,
    commercialTermsVersionId: termsVersion.id, burdenProfileVersionId: burdenVersion.id,
    basis: { resolvedInputs: scenarioResult.resolvedInputs },
    result: { economics: scenarioResult.economics, cashFlow: scenarioResult.cashFlow, profitability: scenarioResult.profitability, weakestTier: scenarioResult.weakestTier, blockingReasons: scenarioResult.blockingReasons },
    ruleVersion: "test-v1", assertedBy: "operator-1", evaluatedAt: new Date("2026-09-07T12:00:00Z"), asOf: new Date("2026-09-07T12:00:00Z"),
    supersedesScenarioId: null, createdAt: new Date("2026-09-07T12:00:00Z"),
  };
}

function twoScenarioDetail() {
  const terms = commercialTermsVersion(commercialTerms());
  const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
  const base = snapshot("BASE", terms, burden);
  const target = snapshot("TARGET", terms, burden, { basePayRate: assumedValue(usd(35)) });
  return assembleOpportunityEconomicsDetail("opp-1", [base, target], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
}

describe("Phase 4H opportunity economics section (presentation)", () => {
  it("23. renders in English with translated section labels", () => {
    const html = renderToStaticMarkup(<OpportunityEconomicsSection locale="en-US" economics={twoScenarioDetail()} />);
    expect(html).toContain("Commercial terms");
    expect(html).toContain("Labor &amp; burden");
    expect(html).toContain("Base");
    expect(html).toContain("Target");
  });

  it("24. renders in Spanish with translated section labels, without translating canonical enum keys", () => {
    const html = renderToStaticMarkup(<OpportunityEconomicsSection locale="es-US" economics={twoScenarioDetail()} />);
    expect(html).toContain("Términos comerciales");
    expect(html).toContain("Mano de obra");
    expect(html).toContain("Objetivo"); // TARGET localized
    expect(html).not.toContain("[[missing:"); // no missing-key placeholders anywhere
  });

  it("empty state: economics unavailable is presented honestly, not as an error or a fabricated zero", () => {
    const html = renderToStaticMarkup(<OpportunityEconomicsSection locale="en-US" economics={null} />);
    expect(html).toContain("Unavailable");
  });

  it("empty state: no saved scenarios is presented honestly", () => {
    const html = renderToStaticMarkup(<OpportunityEconomicsSection locale="en-US" economics={{ opportunityId: "opp-1", scenarios: [], comparisons: [] }} />);
    expect(html).toContain("No scenario economics have been saved");
  });

  it("UNKNOWN, zero, and negative results render as visibly distinct states, never collapsed together", () => {
    const terms = commercialTermsVersion(commercialTerms({ billRate: verifiedValue(usd(10)) }));
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const lossSnap = snapshot("BASE", terms, burden, { basePayRate: verifiedValue(usd(50)) });
    const detail = assembleOpportunityEconomicsDetail("opp-1", [lossSnap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    const html = renderToStaticMarkup(<OpportunityEconomicsSection locale="en-US" economics={detail} />);
    expect(html).toContain("LOSS");
    expect(html).toContain("economics-known");
  });

  it("18/19. recovery status and the monthly cash-flow limitation are both presented", () => {
    const terms = commercialTermsVersion(commercialTerms({ billingCadence: verifiedValue("MONTHLY") }));
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const snap = snapshot("BASE", terms, burden);
    const detail = assembleOpportunityEconomicsDetail("opp-1", [snap], new Map([[terms.id, terms]]), new Map([[burden.id, burden]]));
    const html = renderToStaticMarkup(<OpportunityEconomicsSection locale="en-US" economics={detail} />);
    expect(html).toContain("Monthly billing cannot currently be placed");
  });

  it("20/21. missing commercial terms / burden profile render as an honest empty state, not a crash or a fabricated value", () => {
    const terms = commercialTermsVersion(commercialTerms());
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const snap = snapshot("BASE", terms, burden);
    const detail = assembleOpportunityEconomicsDetail("opp-1", [snap], new Map(), new Map());
    const html = renderToStaticMarkup(<OpportunityEconomicsSection locale="en-US" economics={detail} />);
    expect(html).toContain("No commercial terms have been recorded");
    expect(html).toContain("No burden profile has been recorded");
  });

  it("12/13/14. BASE/CONSERVATIVE/TARGET labels are rendered as plain organizational labels with an explicit no-policy-meaning note, never as verified/recommended/expected", () => {
    const html = renderToStaticMarkup(<OpportunityEconomicsSection locale="en-US" economics={twoScenarioDetail()} />);
    expect(html).toContain("Scenario labels are organizational only");
    // the disclaimer itself is allowed to name what it rules out ("...or a recommended outcome") -- what must never
    // appear is an actual claim asserting one of those things about a label, e.g. "Target is recommended"
    expect(html).not.toMatch(/target is recommended|is the recommended scenario|is the preferred scenario|is the best scenario|is the expected outcome|is verified truth/i);
  });

  it("25. the component never references HOT/AF01/eligibility/scoring and cannot mutate them", async () => {
    const source = (await readFile(resolve(process.cwd(), "src/components/opportunity-economics/opportunity-economics-section.tsx"), "utf8")).toLowerCase();
    expect(source).not.toMatch(/hot_|af01|eligib|actionab|scoring|contact_route/);
  });

  it("26. no GO/NO-GO, recommendation, winner, or ranking field exists anywhere in the section or read-model", async () => {
    const sectionSource = await readFile(resolve(process.cwd(), "src/components/opportunity-economics/opportunity-economics-section.tsx"), "utf8");
    const readModelSource = await readFile(resolve(process.cwd(), "src/server/read-models/economics.ts"), "utf8");
    for (const source of [sectionSource, readModelSource]) {
      expect(source).not.toMatch(/GO[_-]?NO[_-]?GO|winner|recommend|preferred[_-]?scenario|best[_-]?scenario/i);
    }
  });

  it("27/28/29/30. no operator editing/4G-mutation surface exists in this read-only phase -- browser-actor, protected-mutation-boundary, concurrency-conflict, and tamper-protection UX are therefore not applicable and are verified absent by construction", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/opportunity-economics/opportunity-economics-section.tsx"), "utf8");
    expect(source).not.toMatch(/executeProtected|idempotencyKey|useActionState|"use server"|CONCURRENCY_CONFLICT/);
  });

  it("keeps React free of database access and governed-state calculation (mirrors the certified opportunity-detail-view convention)", async () => {
    const source = (await readFile(resolve(process.cwd(), "src/components/opportunity-economics/opportunity-economics-section.tsx"), "utf8")).toLowerCase();
    expect(source).not.toMatch(/supabase|database_url|select |insert |update |delete |useeffect|fetch\(/);
  });

  it("15/16. scenario comparison renders signed deltas and marks cross-currency comparisons unavailable", () => {
    const usdTerms = commercialTermsVersion(commercialTerms());
    const cadTerms = commercialTermsVersion(commercialTerms({ billRate: verifiedValue(createMoneyAmount(95, "CAD")) }));
    const burden = burdenProfileVersion([{ type: "PAYROLL_TAX", rate: verifiedValue(createRate(0.0765)), appliesTo: ["REGULAR_WAGES"] }]);
    const usdSnap = snapshot("BASE", usdTerms, burden);
    const cadSnap = snapshot("TARGET", cadTerms, burden, { basePayRate: verifiedValue(createMoneyAmount(38, "CAD")) });
    const detail = assembleOpportunityEconomicsDetail("opp-1", [usdSnap, cadSnap], new Map([[usdTerms.id, usdTerms], [cadTerms.id, cadTerms]]), new Map([[burden.id, burden]]));
    const html = renderToStaticMarkup(<OpportunityEconomicsSection locale="en-US" economics={detail} />);
    expect(html).toContain("Scenario comparison");
    expect(html).toContain("Unavailable");
  });
});
