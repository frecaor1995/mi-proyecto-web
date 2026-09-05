import type { ProjectRelationship } from "@/domain/temporal-project-intelligence";
import type { ReadModelCapabilityState } from "./shared";

export interface ProjectRelationshipView {
  readonly companyName: string | null;
  readonly relationship: ProjectRelationship;
  readonly evidenceRefs: readonly string[];
}

/**
 * There is no canonical Project entity in the backend today (UI-2 research
 * finding 2): OpportunityRecord.projectId and HumanVerificationScope.projectId
 * are opaque id/string references with nothing to join against, and
 * temporal-project-intelligence.ts's ProjectEvidenceCandidate is evidence
 * ABOUT a project, not a resolved Project record. This contract exists so a
 * future backend phase has a stable shape to populate; today's assembler can
 * only echo the opaque reference it was given and marks the profile
 * UNAVAILABLE at the top level -- never OPERATIONAL -- regardless of which
 * optional fields a caller happens to supply.
 */
export interface ProjectIntelligenceProfile {
  readonly projectId: string;
  readonly projectName: string | null;
  readonly capabilityState: ReadModelCapabilityState;
  readonly relationships: readonly ProjectRelationshipView[];
  readonly location: { readonly capabilityState: ReadModelCapabilityState; readonly value: string | null };
  readonly timeline: { readonly capabilityState: ReadModelCapabilityState; readonly startDate: string | null; readonly completionDate: string | null };
}

export interface ProjectIntelligenceAssemblyInput {
  readonly projectId: string;
  readonly projectName?: string | null;
  readonly relationships?: readonly ProjectRelationshipView[];
  readonly location?: string | null;
  readonly startDate?: Date | null;
  readonly completionDate?: Date | null;
}

export function assembleProjectIntelligenceProfile(input: ProjectIntelligenceAssemblyInput): ProjectIntelligenceProfile {
  return {
    projectId: input.projectId,
    projectName: input.projectName ?? null,
    capabilityState: "UNAVAILABLE",
    relationships: input.relationships ?? [],
    location: { capabilityState: input.location ? "PARTIAL" : "UNAVAILABLE", value: input.location ?? null },
    timeline: {
      capabilityState: input.startDate || input.completionDate ? "PARTIAL" : "UNAVAILABLE",
      startDate: input.startDate ? input.startDate.toISOString() : null,
      completionDate: input.completionDate ? input.completionDate.toISOString() : null,
    },
  };
}
