import type { CompanyRoleRecord } from "@/domain/company";
import type { ReadModelCurrentness, ReadModelTrustState } from "./shared";
import { currentnessFromStaleAfter, mapDatabaseVerificationState } from "./shared";

export const RELATIONSHIP_NODE_KINDS = [
  "OWNER", "GC_EPC", "CONTRACTOR", "SUBCONTRACTOR", "STAFFING_WORKFORCE_PROVIDER", "FLY", "WORKFORCE",
  "PROJECT", "OPPORTUNITY", "DEMAND_SIGNAL",
] as const;
export type RelationshipNodeKind = (typeof RELATIONSHIP_NODE_KINDS)[number];

export interface RelationshipNode {
  readonly id: string;
  readonly kind: RelationshipNodeKind;
  readonly label: string;
}

export interface RelationshipEdge {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relationshipType: string;
  readonly verificationState: ReadModelTrustState;
  readonly currentness: ReadModelCurrentness;
  readonly evidenceRefs: readonly string[];
}

export interface RelationshipGraph {
  readonly nodes: readonly RelationshipNode[];
  readonly edges: readonly RelationshipEdge[];
}

const COMPANY_ROLE_TO_NODE_KIND: Record<string, RelationshipNodeKind> = {
  OWNER: "OWNER",
  EPC: "GC_EPC",
  GC: "GC_EPC",
  ELECTRICAL_CONTRACTOR: "CONTRACTOR",
  EMPLOYER: "CONTRACTOR",
  STAFFING_SUPPLIER: "STAFFING_WORKFORCE_PROVIDER",
  MANPOWER_BUYER: "GC_EPC",
};

/**
 * Builds evidence-backed edges strictly one CompanyRoleRecord at a time --
 * each record structurally requires its own evidenceId (domain/company.ts).
 * This function never compares two records to each other and never creates
 * an edge because two entities merely appear in the same source/project; the
 * only edges it can ever produce are the (company -> role-context) pairs
 * each individual record's own evidenceId already asserts. See UI-2 section 15.
 */
export function assembleRelationshipGraph(
  roles: readonly CompanyRoleRecord[],
  asOf: Date,
  companyLabels: Readonly<Record<string, string>> = {},
): RelationshipGraph {
  const nodes = new Map<string, RelationshipNode>();
  const edges: RelationshipEdge[] = [];
  for (const role of roles) {
    const companyNodeId = `company:${role.companyId}`;
    const contextNodeId = `${role.context.type.toLowerCase()}:${role.context.id}`;
    nodes.set(companyNodeId, {
      id: companyNodeId,
      kind: COMPANY_ROLE_TO_NODE_KIND[role.role] ?? "CONTRACTOR",
      label: companyLabels[role.companyId] ?? role.companyId,
    });
    nodes.set(contextNodeId, { id: contextNodeId, kind: role.context.type, label: role.context.id });
    edges.push({
      fromNodeId: companyNodeId,
      toNodeId: contextNodeId,
      relationshipType: role.role,
      verificationState: mapDatabaseVerificationState(role.verificationState),
      currentness: currentnessFromStaleAfter(asOf, undefined),
      evidenceRefs: [role.evidenceId],
    });
  }
  return { nodes: Array.from(nodes.values()), edges };
}
