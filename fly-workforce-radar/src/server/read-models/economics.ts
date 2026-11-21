import type { BurdenComponent, BurdenProfileScope } from "../../domain/burden-profile";
import type { ScenarioLabel } from "../../domain/commercial-economics";
import type { CommercialEconomicsEvaluation } from "../../domain/commercial-economics-engine";
import type {
  BurdenProfileVersionRecord, CommercialTermsVersionRecord, EconomicsScenarioSnapshotRecord,
} from "../../domain/commercial-economics-persistence";
import type { CommercialTermsContract } from "../../domain/commercial-terms";
import type { CashFlowEvaluation } from "../../domain/cash-flow-engine";
import type { EconomicFactTier } from "../../domain/economic-value";
import type { ScenarioProfitability, ScenarioResult } from "../../domain/scenario-engine";
import type { ScenarioComparison } from "../../domain/scenario-comparison";
import { compareScenarios } from "../../domain/scenario-comparison";

/**
 * Phase 4H. Pure projection of certified Phase 4C persisted economics
 * (Economics Scenario Snapshots, and the Commercial Terms/Burden Profile
 * versions they reference) into a UI-ready structure. This module performs
 * NO I/O and reimplements NO 4D/4E/4F formula -- it only reshapes already-
 * loaded data. See src/server/opportunity-detail/get-opportunity-economics.ts
 * for the I/O loader that calls this.
 *
 * A snapshot's `result`/`basis` columns are untyped jsonb at the certified
 * 4C persistence boundary (Record<string, unknown>) -- the shapes below
 * describe exactly what the certified Phase 4G scenario-snapshot mutation
 * writes there (economics/cashFlow/profitability/weakestTier/blockingReasons
 * in `result`; resolvedInputs in `basis`). If a row does not match this
 * shape (which cannot happen for anything 4G itself wrote), the scenario is
 * simply omitted rather than the UI crashing or fabricating a value.
 */

interface PersistedScenarioResultPayload {
  readonly economics: CommercialEconomicsEvaluation;
  readonly cashFlow: CashFlowEvaluation;
  readonly profitability: ScenarioProfitability;
  readonly weakestTier: Exclude<EconomicFactTier, "UNKNOWN"> | null;
  readonly blockingReasons: readonly string[];
}
interface PersistedScenarioBasisPayload {
  readonly resolvedInputs: ScenarioResult["resolvedInputs"];
}

export interface OpportunityEconomicsCommercialTermsView {
  readonly contract: CommercialTermsContract;
  readonly ruleVersion: string;
  readonly evaluatedAt: Date;
}
export interface OpportunityEconomicsBurdenProfileView {
  readonly scope: BurdenProfileScope;
  readonly components: readonly BurdenComponent[];
  readonly ruleVersion: string;
  readonly evaluatedAt: Date;
}

export interface OpportunityEconomicsScenarioView {
  readonly snapshotId: string;
  readonly label: ScenarioLabel;
  readonly asOf: Date;
  readonly ruleVersion: string;
  readonly weakestTier: Exclude<EconomicFactTier, "UNKNOWN"> | null;
  readonly blockingReasons: readonly string[];
  readonly commercialTerms: OpportunityEconomicsCommercialTermsView | null;
  readonly burdenProfile: OpportunityEconomicsBurdenProfileView | null;
  readonly economics: CommercialEconomicsEvaluation;
  readonly cashFlow: CashFlowEvaluation;
  readonly profitability: ScenarioProfitability;
  /** Reconstructed for reuse of the certified compareScenarios formula (never reimplemented here) -- null only if the persisted payload is malformed/incomplete. */
  readonly comparable: ScenarioResult | null;
}

export interface OpportunityEconomicsDetail {
  readonly opportunityId: string;
  readonly scenarios: readonly OpportunityEconomicsScenarioView[];
  readonly comparisons: readonly ScenarioComparison[];
}

function reconstructScenarioResult(snapshot: EconomicsScenarioSnapshotRecord, result: PersistedScenarioResultPayload): ScenarioResult | null {
  const basis = snapshot.basis as Partial<PersistedScenarioBasisPayload> | null | undefined;
  if (!basis?.resolvedInputs) return null;
  return {
    label: snapshot.scenarioLabel,
    calculationId: snapshot.id,
    resolvedInputs: basis.resolvedInputs,
    economics: result.economics,
    cashFlow: result.cashFlow,
    profitability: result.profitability,
    weakestTier: result.weakestTier ?? null,
    blockingReasons: result.blockingReasons ?? [],
  };
}

function assembleScenarioView(
  snapshot: EconomicsScenarioSnapshotRecord,
  commercialTermsVersion: CommercialTermsVersionRecord | null,
  burdenProfileVersion: BurdenProfileVersionRecord | null,
): OpportunityEconomicsScenarioView | null {
  const result = snapshot.result as Partial<PersistedScenarioResultPayload> | null | undefined;
  if (!result?.economics || !result.cashFlow || !result.profitability) return null;
  const fullResult: PersistedScenarioResultPayload = {
    economics: result.economics, cashFlow: result.cashFlow, profitability: result.profitability,
    weakestTier: result.weakestTier ?? null, blockingReasons: result.blockingReasons ?? [],
  };
  return {
    snapshotId: snapshot.id,
    label: snapshot.scenarioLabel,
    asOf: snapshot.asOf,
    ruleVersion: snapshot.ruleVersion,
    weakestTier: fullResult.weakestTier,
    blockingReasons: fullResult.blockingReasons,
    commercialTerms: commercialTermsVersion ? { contract: commercialTermsVersion.terms, ruleVersion: commercialTermsVersion.ruleVersion, evaluatedAt: commercialTermsVersion.evaluatedAt } : null,
    burdenProfile: burdenProfileVersion ? { scope: burdenProfileVersion.scope, components: burdenProfileVersion.components, ruleVersion: burdenProfileVersion.ruleVersion, evaluatedAt: burdenProfileVersion.evaluatedAt } : null,
    economics: fullResult.economics,
    cashFlow: fullResult.cashFlow,
    profitability: fullResult.profitability,
    comparable: reconstructScenarioResult(snapshot, fullResult),
  };
}

/**
 * economics_scenario_snapshots are certified as independent historical
 * captures (no getCurrent* method exists on EconomicsScenarioRepository --
 * see the Phase 4G implementation report). For the primary overview, this
 * keeps only the snapshot(s) not explicitly superseded by another snapshot
 * in the same result set, and at most one per label (the most recently
 * evaluated) -- a presentation-only "what's current to show" choice, not a
 * new certified concurrency/current-head rule.
 */
function currentSnapshotsByLabel(snapshots: readonly EconomicsScenarioSnapshotRecord[]): readonly EconomicsScenarioSnapshotRecord[] {
  const supersededIds = new Set(snapshots.map((s) => s.supersedesScenarioId).filter((id): id is string => id !== null));
  const notSuperseded = snapshots.filter((s) => !supersededIds.has(s.id));
  const byLabel = new Map<ScenarioLabel, EconomicsScenarioSnapshotRecord>();
  for (const snapshot of notSuperseded) {
    const existing = byLabel.get(snapshot.scenarioLabel);
    if (!existing || snapshot.evaluatedAt.getTime() > existing.evaluatedAt.getTime()) byLabel.set(snapshot.scenarioLabel, snapshot);
  }
  return [...byLabel.values()];
}

/** Presentation-only display order (BASE, CONSERVATIVE, TARGET) -- never implies economic ordering; compareScenarios below still only compares explicitly paired scenarios. */
const SCENARIO_LABEL_ORDER: Readonly<Record<ScenarioLabel, number>> = { BASE: 0, CONSERVATIVE: 1, TARGET: 2 };

export function assembleOpportunityEconomicsDetail(
  opportunityId: string,
  snapshots: readonly EconomicsScenarioSnapshotRecord[],
  commercialTermsById: ReadonlyMap<string, CommercialTermsVersionRecord>,
  burdenProfileById: ReadonlyMap<string, BurdenProfileVersionRecord>,
): OpportunityEconomicsDetail {
  const current = currentSnapshotsByLabel(snapshots);
  const scenarios = current
    .map((snapshot) => assembleScenarioView(
      snapshot,
      snapshot.commercialTermsVersionId ? (commercialTermsById.get(snapshot.commercialTermsVersionId) ?? null) : null,
      snapshot.burdenProfileVersionId ? (burdenProfileById.get(snapshot.burdenProfileVersionId) ?? null) : null,
    ))
    .filter((view): view is OpportunityEconomicsScenarioView => view !== null)
    .slice()
    .sort((a, b) => SCENARIO_LABEL_ORDER[a.label] - SCENARIO_LABEL_ORDER[b.label]);

  const comparable = scenarios.map((s) => s.comparable).filter((c): c is ScenarioResult => c !== null);
  const comparisons: ScenarioComparison[] = [];
  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) comparisons.push(compareScenarios(comparable[i], comparable[j]));
  }

  return { opportunityId, scenarios, comparisons };
}
