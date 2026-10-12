import type { ClaimCandidate } from "../../../domain/claims";
import type { ExternalManpowerCategory } from "../../../domain/database";

interface ExplicitRule {
  category: ExternalManpowerCategory;
  pattern: RegExp;
}

const positiveRules: ExplicitRule[] = [
  { category: "STAFFING_VENDOR_ACCEPTED", pattern: /\b(approved|authorized) staffing vendors?\b/i },
  { category: "SUPPLEMENTAL_LABOR_ACCEPTED", pattern: /\b(accept|use|engage)s? supplemental labo[u]?r\b/i },
  { category: "CONTINGENT_WORKFORCE_ACCEPTED", pattern: /\b(accept|use|engage)s? contingent work(?:er|force)s?\b/i },
  { category: "CRAFT_LABOR_VENDOR_ACCEPTED", pattern: /\b(approved|authorized) craft labo[u]?r vendors?\b/i },
  { category: "THIRD_PARTY_RECRUITING_ACCEPTED", pattern: /\bthird[- ]party recruiters?\b[^.]{0,100}\b(submit|submission|accepted|may)\b/i },
  { category: "LABOR_SUBCONTRACTING_ACCEPTED", pattern: /\b(accept|use|engage)s? labo[u]?r subcontract(?:ors?|ing)\b/i },
];

const rejectionPattern = /\b(no|do not|does not|not)\s+(?:outside\s+)?(?:staffing\s+)?agenc(?:y|ies)\s+(?:accepted|allowed|permitted)\b/i;

export function buildManpowerAcceptanceClaims(input: {
  companyId: string;
  evidenceId: string;
  text: string;
  assertedBy?: string;
  staleAfter?: Date | null;
}): ClaimCandidate[] {
  const shared = {
    subject: { type: "COMPANY" as const, id: input.companyId },
    predicate: "external_manpower_acceptance_category" as const,
    assertionKind: "FACT" as const,
    evidenceIds: [input.evidenceId],
    assertedBy: input.assertedBy ?? "system:af-01-explicit-language-builder",
    staleAfter: input.staleAfter,
    metadata: { builder: "af-01-explicit-language@1.0.0", sourceText: input.text },
  };
  if (rejectionPattern.test(input.text)) {
    return [{ ...shared, externalManpowerCategory: "STAFFING_VENDOR_ACCEPTED", value: { accepted: false, explicitText: input.text } }];
  }
  return positiveRules
    .filter((rule) => rule.pattern.test(input.text))
    .map((rule) => ({
      ...shared, externalManpowerCategory: rule.category,
      value: { accepted: true, explicitText: input.text },
    }));
}
