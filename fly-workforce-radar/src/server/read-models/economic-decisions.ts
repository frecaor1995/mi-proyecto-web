import type { EconomicDecisionRecord, EconomicDisposition } from "../../domain/economic-decision";
import type { EconomicFactTier } from "../../domain/economic-value";

export interface EconomicDecisionView {
  readonly decisionId: string;
  readonly opportunityId: string;
  readonly disposition: EconomicDisposition;
  readonly rationale: string;
  readonly decidedByOperatorId: string;
  readonly scenarioSnapshotId: string;
  readonly scenarioEffectiveCertainty: EconomicFactTier;
  readonly scenarioBlockingReasons: readonly string[];
  readonly supersedesDecisionId: string | null;
  readonly ruleVersion: string;
  readonly decidedAt: Date;
  readonly createdAt: Date;
  /** One-based position in the durable root-to-current lineage. */
  readonly lineagePosition: number;
  readonly isCurrent: boolean;
}

export interface OpportunityEconomicDecisionDetail {
  readonly opportunityId: string;
  /** Null is a legitimate "no decision yet" state, not a fabricated disposition. */
  readonly current: EconomicDecisionView | null;
  /** Deterministic root-to-current ordering, independent of timestamps or input row order. */
  readonly history: readonly EconomicDecisionView[];
}

function decisionView(record: EconomicDecisionRecord, position: number, isCurrent: boolean): EconomicDecisionView {
  return {
    decisionId: record.id,
    opportunityId: record.opportunityId,
    disposition: record.disposition,
    rationale: record.rationale,
    decidedByOperatorId: record.decidedBy,
    scenarioSnapshotId: record.scenarioSnapshotId,
    scenarioEffectiveCertainty: record.scenarioEffectiveCertainty,
    scenarioBlockingReasons: [...record.scenarioBlockingReasons],
    supersedesDecisionId: record.supersedesDecisionId,
    ruleVersion: record.ruleVersion,
    decidedAt: record.decidedAt,
    createdAt: record.createdAt,
    lineagePosition: position,
    isCurrent,
  };
}

/**
 * Phase 4K. Pure read projection over Phase 4J's immutable records. It follows
 * explicit supersession edges rather than inferring business order from time,
 * and fails closed if data does not form the certified single linear lineage.
 */
export function assembleOpportunityEconomicDecisionDetail(
  opportunityId: string,
  records: readonly EconomicDecisionRecord[],
): OpportunityEconomicDecisionDetail {
  const scoped = records.filter((record) => record.opportunityId === opportunityId);
  if (scoped.length === 0) {
    return { opportunityId, current: null, history: [] };
  }

  const byId = new Map(scoped.map((record) => [record.id, record]));
  if (byId.size !== scoped.length) throw new Error("Duplicate economic decision identity in history");
  const roots = scoped.filter((record) => record.supersedesDecisionId === null);
  if (roots.length !== 1) throw new Error("Economic decision history must contain exactly one root");

  const successorById = new Map<string, EconomicDecisionRecord>();
  for (const record of scoped) {
    if (record.supersedesDecisionId === null) continue;
    if (!byId.has(record.supersedesDecisionId)) throw new Error("Economic decision predecessor is missing from opportunity history");
    if (successorById.has(record.supersedesDecisionId)) throw new Error("Economic decision history contains a fork");
    successorById.set(record.supersedesDecisionId, record);
  }

  const ordered: EconomicDecisionRecord[] = [];
  const visited = new Set<string>();
  let cursor: EconomicDecisionRecord | undefined = roots[0];
  while (cursor) {
    if (visited.has(cursor.id)) throw new Error("Economic decision history contains a cycle");
    visited.add(cursor.id);
    ordered.push(cursor);
    cursor = successorById.get(cursor.id);
  }
  if (ordered.length !== scoped.length) throw new Error("Economic decision history is disconnected");

  const effective = ordered.at(-1)!;
  const history = ordered.map((record, index) => decisionView(record, index + 1, record.id === effective.id));
  return { opportunityId, current: history.at(-1)!, history };
}
