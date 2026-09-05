import { assembleCommandCenterSummary, type CommandCenterSummary } from "../read-models/command-center";
import type { CommercialActionItem } from "../read-models/commercial-action";

/**
 * UI-3's smallest honest presentation adapter (phase section 11). No
 * canonical service in the repository yet aggregates HOT/Near
 * Ready/verification/evidence/conflict/blocked/action counts across
 * opportunities -- calling assembleCommandCenterSummary with no metric
 * inputs is not a placeholder shortcut, it IS the honest result: every
 * metric resolves to UNKNOWN and the connection state to UNAVAILABLE,
 * exactly as UI-2's certified assembler defines "no data supplied."
 *
 * When a real aggregation service exists, only this function's body
 * changes -- it becomes the one place that calls that service and passes
 * real MetricValue results into assembleCommandCenterSummary. Nothing in
 * the Command Center presentation layer needs to change.
 */
export function getCommandCenterSummary(asOf: Date): CommandCenterSummary {
  return assembleCommandCenterSummary({ asOf });
}

/**
 * No commercial-action aggregation service exists yet either (see
 * commercial-action.ts's assembler, which operates on a single already-
 * computed CommercialActionResult, not a queryable list). An empty array is
 * the honest "nothing available" result, not a fabricated absence of work --
 * the Command Center panel must render its own empty state for this, not
 * treat the empty array as "zero actions exist."
 */
export function getCommandCenterCommercialActions(): readonly CommercialActionItem[] {
  return [];
}
