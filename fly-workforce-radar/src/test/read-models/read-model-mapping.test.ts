import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRUST_STATES, CURRENTNESS_STATES, SCOPE_STATES } from "../../components/ui/status-primitives";
import {
  READ_MODEL_TRUST_STATES,
  READ_MODEL_CURRENTNESS_STATES,
  READ_MODEL_SCOPE_KINDS,
  READ_MODEL_CAPABILITY_STATES,
  knownMetric,
  currentnessFromStaleAfter,
  mapDatabaseVerificationState,
  mapCandidateEvidenceState,
  mapManpowerAcceptanceTrustState,
  scopeFromHumanVerificationScope,
  toProvenanceRefs,
} from "../../server/read-models/shared";
import { assembleCommandCenterSummary, COMMAND_CENTER_METRIC_KINDS } from "../../server/read-models/command-center";
import { assembleExternalManpowerAcceptanceView, assembleOpportunityRadarItem } from "../../server/read-models/opportunity-radar";
import { assembleProjectIntelligenceProfile } from "../../server/read-models/project-intelligence";
import { assembleRelationshipGraph } from "../../server/read-models/relationship-graph";
import { assembleEvidenceTimelineItem } from "../../server/read-models/evidence-timeline";
import { assembleCommercialActionItem } from "../../server/read-models/commercial-action";
import { assembleHumanVerificationPacketView } from "../../server/read-models/human-verification";
import type { AcceptanceEvaluation } from "../../domain/manpower-acceptance";
import type { CompanyRoleRecord } from "../../domain/company";
import type { EvidenceRecord } from "../../domain/evidence";
import type { ClaimRecord } from "../../domain/claims";
import type { CommercialActionResult } from "../../domain/commercial-action";
import type { OpportunityRecord } from "../../domain/opportunity";
import type { EligibilityResult } from "../../domain/eligibility";
import type { HumanVerificationPacket } from "../../domain/human-verification-planning";

const ASOF = new Date("2026-01-01T00:00:00.000Z");

describe("UI-2 vocabulary parity with UI-1", () => {
  it("trust states match status-primitives.tsx exactly", () => {
    expect(new Set(Object.keys(TRUST_STATES))).toEqual(new Set(READ_MODEL_TRUST_STATES));
  });
  it("currentness states match status-primitives.tsx exactly", () => {
    expect(new Set(Object.keys(CURRENTNESS_STATES))).toEqual(new Set(READ_MODEL_CURRENTNESS_STATES));
  });
  it("scope kinds match status-primitives.tsx exactly", () => {
    expect(new Set(Object.keys(SCOPE_STATES))).toEqual(new Set(READ_MODEL_SCOPE_KINDS));
  });
});

describe("UI-2 assembler/mapper correctness (section 23)", () => {
  it("1. verified state maps correctly", () => {
    expect(mapDatabaseVerificationState("VERIFIED")).toBe("VERIFIED");
    expect(mapCandidateEvidenceState("VERIFIED")).toBe("VERIFIED");
  });

  it("2. unknown remains unknown", () => {
    expect(currentnessFromStaleAfter(ASOF, undefined)).toBe("UNKNOWN");
    expect(scopeFromHumanVerificationScope(undefined).kind).toBe("UNKNOWN");
  });

  it("3. stale remains stale", () => {
    expect(mapDatabaseVerificationState("STALE")).toBe("STALE");
    expect(currentnessFromStaleAfter(ASOF, new Date("2025-01-01T00:00:00.000Z"))).toBe("STALE");
  });

  it("4. conflict remains conflict", () => {
    expect(mapCandidateEvidenceState("CONFLICTING")).toBe("CONFLICT");
  });

  it("5. scope is preserved", () => {
    expect(scopeFromHumanVerificationScope({ projectId: "proj-1" })).toEqual({
      kind: "PROJECT", companyId: null, projectId: "proj-1", divisionName: null, tradeId: null,
    });
  });

  it("6. unknown scope never becomes companywide/global", () => {
    expect(scopeFromHumanVerificationScope(null).kind).toBe("UNKNOWN");
    expect(scopeFromHumanVerificationScope({}).kind).toBe("UNKNOWN");
    expect(scopeFromHumanVerificationScope({ companyScope: "UNKNOWN" }).kind).toBe("UNKNOWN");
  });

  it("7. missing evidence is explicit", () => {
    expect(mapManpowerAcceptanceTrustState("INSUFFICIENT_EVIDENCE")).toBe("MISSING_EVIDENCE");
  });

  it("8. human verification requirement is explicit", () => {
    const opportunity: OpportunityRecord = {
      id: "opp-1", identityKey: "key-1", projectId: null, unresolvedCompanyContext: null, title: "Test",
      lifecycle: "ACTIVE", firstSeenAt: ASOF, lastSeenAt: ASOF, staleAfter: null, verificationDueAt: null, metadata: {},
    };
    const eligibility: EligibilityResult = {
      opportunityId: "opp-1", evaluatedAt: ASOF, asOf: ASOF, ruleVersion: "v1", eligibilityType: "HOT_A_ELIGIBLE",
      eligible: false, passedRequirements: [], failedRequirements: ["HUMAN_VERIFICATION_REQUIRED"],
      blockingGaps: ["HUMAN_VERIFICATION_REQUIRED"],
      reviewedIdentifiers: { evidenceIds: [], claimIds: [], contactIds: [], routeIds: [], reviewDecisionIds: [] },
      requirements: [], explanation: "blocked", economicsReady: false,
    };
    const item = assembleOpportunityRadarItem({ opportunity, eligibility, asOf: ASOF });
    expect(item.verificationState).toBe("HUMAN_VERIFICATION_REQUIRED");
  });

  it("9. AF01 positive maps correctly without exposing unnecessary persistence", () => {
    const evaluation: AcceptanceEvaluation = {
      id: "af01-1", companyId: "co-1", context: null, result: "VERIFIED_POSITIVE",
      qualifyingCategories: ["STAFFING_VENDOR_ACCEPTED"], supportingClaimIds: ["claim-1"],
      supportingEvidenceIds: ["ev-1"], ignoredClaimIds: [], evaluatedAt: ASOF, ruleVersion: "af-01@2.0.0",
      validUntil: null, reason: "explicit statement", explanation: { internal: "raw blob" },
    };
    const view = assembleExternalManpowerAcceptanceView(evaluation, ASOF);
    expect(view.accepted).toBe(true);
    expect(view.trustState).toBe("VERIFIED");
    expect(view).not.toHaveProperty("explanation");
    expect(view).not.toHaveProperty("ignoredClaimIds");
  });

  it("10. AF01 negative maps correctly", () => {
    const evaluation: AcceptanceEvaluation = {
      id: "af01-2", companyId: "co-1", context: null, result: "VERIFIED_NEGATIVE",
      qualifyingCategories: [], supportingClaimIds: [], supportingEvidenceIds: ["ev-2"], ignoredClaimIds: [],
      evaluatedAt: ASOF, ruleVersion: "af-01@2.0.0", validUntil: null, reason: "explicit denial", explanation: {},
    };
    const view = assembleExternalManpowerAcceptanceView(evaluation, ASOF);
    expect(view.accepted).toBe(false);
    expect(view.trustState).toBe("VERIFIED");
  });

  it("11. candidate evidence does not become verified", () => {
    expect(mapCandidateEvidenceState("CANDIDATE")).toBe("CANDIDATE");
    expect(mapCandidateEvidenceState("CANDIDATE")).not.toBe("VERIFIED");
  });

  it("12. no relationship is inferred from mere co-occurrence", () => {
    const roleA: CompanyRoleRecord = {
      id: "role-a", companyId: "company-a", role: "OWNER", context: { type: "PROJECT", id: "proj-9" },
      evidenceId: "ev-a", claimId: null, assertionKind: "FACT", verificationState: "VERIFIED", basis: "EXPLICIT_EMPLOYER",
      actor: "system", observedAt: ASOF, firstSeenAt: ASOF, lastSeenAt: ASOF,
    };
    const roleB: CompanyRoleRecord = {
      id: "role-b", companyId: "company-b", role: "ELECTRICAL_CONTRACTOR", context: { type: "PROJECT", id: "proj-9" },
      evidenceId: "ev-b", claimId: null, assertionKind: "FACT", verificationState: "VERIFIED", basis: "EXPLICIT_EMPLOYER",
      actor: "system", observedAt: ASOF, firstSeenAt: ASOF, lastSeenAt: ASOF,
    };
    const graph = assembleRelationshipGraph([roleA, roleB], ASOF);
    expect(graph.edges).toHaveLength(2);
    const directCompanyToCompanyEdge = graph.edges.find(
      (edge) => edge.fromNodeId.startsWith("company:") && edge.toNodeId.startsWith("company:"),
    );
    expect(directCompanyToCompanyEdge).toBeUndefined();
  });

  it("13. unavailable capability is not presented operational", () => {
    const profile = assembleProjectIntelligenceProfile({ projectId: "proj-1", location: "Amarillo, TX" });
    expect(profile.capabilityState).toBe("UNAVAILABLE");
    expect(profile.capabilityState).not.toBe("OPERATIONAL");
  });

  it("14. zero counts remain legitimate zero", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF, hotCount: knownMetric(0) });
    expect(summary.hotCount.value).toEqual({ state: "KNOWN", value: 0 });
  });

  it("15. unknown counts are not converted to zero", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF });
    expect(summary.nearReadyCount.value).toEqual({ state: "UNKNOWN" });
    expect(summary.nearReadyCount.value).not.toHaveProperty("value");
  });

  it("16. provenance references are preserved", () => {
    const result: CommercialActionResult = {
      opportunityId: "opp-3", action: "CALL_TODAY", ruleVersion: "v1", evaluatedAt: ASOF, asOf: ASOF,
      eligibilityBasis: { snapshotIds: [], eligibleTypes: ["HOT_A_ELIGIBLE"] },
      scoreBasis: { snapshotId: null, state: "SCORED", score: 90 },
      supportingRoute: null, evidenceIds: ["ev-7"], claimIds: ["claim-7"], contactIds: [], humanDecisionIds: [],
      acceptance: { id: null, state: "VERIFIED_POSITIVE" }, gaps: [], preventedStrongerActions: [],
      explanation: "ready", recommendationOnly: true,
    };
    const item = assembleCommercialActionItem(result, ASOF);
    expect(item.provenanceRefs).toContainEqual({ evidenceId: "ev-7", claimId: null, sourceUrl: null });
    expect(item.provenanceRefs).toContainEqual({ evidenceId: null, claimId: "claim-7", sourceUrl: null });
  });

  it("17. read model contains no unnecessary raw persistence payload", () => {
    const evidence: EvidenceRecord = {
      id: "ev-9", sourceId: "src-1", sourceUrl: "https://example.com/job", capturedAt: ASOF, captureMethod: "HTTP_FETCH",
      contentHash: "abc123", payloadSizeBytes: 4096, contentType: "text/html", extractorVersion: "1.0.0",
      storageReference: "s3://bucket/key", httpMetadata: { status: 200 }, metadata: { raw: "internal-only" },
    };
    const claim: ClaimRecord = {
      id: "claim-9", identityKey: "key-9", subject: { type: "COMPANY", id: "company-a" }, predicate: "company_role",
      value: "OWNER", assertionKind: "FACT", verificationState: "VERIFIED", externalManpowerCategory: null,
      assertedAt: ASOF, assertedBy: null, verifiedAt: ASOF, verificationActorReference: null, staleAfter: null,
      verificationDueAt: null, notes: null, metadata: {},
    };
    const item = assembleEvidenceTimelineItem({ evidence, claim, asOf: ASOF });
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("httpMetadata");
    expect(serialized).not.toContain("contentHash");
    expect(serialized).not.toContain("payloadSizeBytes");
    expect(serialized).not.toContain("storageReference");
    expect(serialized).not.toContain("internal-only");
  });
});

describe("toProvenanceRefs", () => {
  it("drops null/undefined entries and preserves the rest", () => {
    expect(toProvenanceRefs({ evidenceIds: ["ev-1", null, undefined], claimIds: [null] })).toEqual([
      { evidenceId: "ev-1", claimId: null, sourceUrl: null },
    ]);
  });
});

const SAMPLE_PACKET: HumanVerificationPacket = {
  task: { id: "task-1", status: "OPEN", createdAt: ASOF.toISOString(), dueAt: null, assignedOperatorId: null, verificationObjective: "confirm AF01" },
  target: { companyId: "company-a", companyName: "Acme Staffing", projectId: null, projectName: null, opportunityId: "opp-1", opportunityTitle: null, tradeId: null, occupationId: null, person: null },
  whyThisMatters: { blocker: "AF01 unverified", commercialQuestion: "Do they accept external manpower?", currentCanonicalState: "NOT_VERIFIED", publicEvidenceInsufficientReason: "no public statement found" },
  question: { primary: "Does Acme Staffing accept external manpower on this project?", followUp: null },
  expectedClassifications: { answerDispositions: ["AFFIRMATIVE", "NEGATIVE"], commercialMechanisms: ["DIRECT_EXTERNAL_MANPOWER"] },
  authorityRequired: { minimumLevel: "SUBJECT_MATTER_INFORMED", evidenceToCapture: ["name", "title"], warning: "confirm authority before recording" },
  scopeToConfirm: { projectId: "proj-1" },
  possibleEffects: ["may unlock HOT_A_ELIGIBLE"],
  sourceBasis: [{ evidenceId: "ev-1", claimId: null, sourceUrl: "https://example.com", observedAt: null, current: true, summary: "job posting mentions staffing vendors" }],
  conflicts: [],
  doNotClaim: ["Do not claim this is confirmed until verified"],
  safetyPrivacy: ["Do not record without consent"],
  nextAction: "CALL",
};

describe("UI-2R i18n compatibility reconciliation (section 16)", () => {
  it("1. Command Center metrics expose semantic metric identity, not English display labels", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF });
    expect(summary.hotCount.kind).toBe("HOT_OPPORTUNITIES");
    expect(summary.nearReadyCount.kind).toBe("NEAR_READY_OPPORTUNITIES");
    expect(COMMAND_CENTER_METRIC_KINDS).toContain(summary.hotCount.kind);
    expect(summary.hotCount).not.toHaveProperty("label");
  });

  it("2. no command-center assembler bakes English label prose", async () => {
    const source = await readFile(resolve(process.cwd(), "src/server/read-models/command-center.ts"), "utf8");
    expect(source).not.toMatch(/"HOT opportunities"|"Near Ready opportunities"|"Blocked items"/);
    expect(source).not.toContain("label:");
  });

  it("3. scope descriptor preserves semantic kind", () => {
    expect(scopeFromHumanVerificationScope({ projectId: "p1" }).kind).toBe("PROJECT");
    expect(scopeFromHumanVerificationScope({ tradeId: "ELECTRICAL" as never }).kind).toBe("TRADE");
  });

  it("4. PROJECT scope preserves project id separately from presentation", () => {
    const scope = scopeFromHumanVerificationScope({ projectId: "proj-42" });
    expect(scope.projectId).toBe("proj-42");
    expect(scope).not.toHaveProperty("label");
  });

  it("5. DIVISION scope preserves division information structurally", () => {
    const scope = scopeFromHumanVerificationScope({ companyScope: "DIVISION", divisionOrSubsidiary: "Gulf Coast Division" });
    expect(scope.kind).toBe("DIVISION");
    expect(scope.divisionName).toBe("Gulf Coast Division");
  });

  it("6. TRADE scope preserves trade information structurally", () => {
    const scope = scopeFromHumanVerificationScope({ tradeId: "ELECTRICAL" as never });
    expect(scope.kind).toBe("TRADE");
    expect(scope.tradeId).toBe("ELECTRICAL");
  });

  it("7. UNKNOWN scope remains UNKNOWN and is never treated as global", () => {
    const scope = scopeFromHumanVerificationScope(undefined);
    expect(scope.kind).toBe("UNKNOWN");
    expect(scope.kind).not.toBe("COMPANY");
    expect(scope.companyId).toBeNull();
  });

  it("8. scope assembler contains no English presentation label as required output", async () => {
    const source = await readFile(resolve(process.cwd(), "src/server/read-models/shared.ts"), "utf8");
    expect(source).not.toMatch(/label: string/);
    expect(source).not.toContain("Scope unknown — not global");
    expect(source).not.toContain("Companywide");
  });

  it("9. the same read-model result can be consumed by either en-US or es-US presentation without recomputation or locale input", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF, hotCount: knownMetric(3) });
    // no locale argument exists anywhere in this call; the same object is valid input to any future presentation layer
    const forEnglish = summary;
    const forSpanish = summary;
    expect(forEnglish).toBe(forSpanish);
    expect(forEnglish.hotCount.kind).toBe("HOT_OPPORTUNITIES");
  });

  it("10. no read-model assembler accepts locale", async () => {
    const files = [
      "shared.ts", "command-center.ts", "opportunity-radar.ts", "opportunity-detail.ts",
      "company-intelligence.ts", "project-intelligence.ts", "human-verification.ts", "signal.ts",
      "evidence-timeline.ts", "commercial-action.ts", "relationship-graph.ts", "source-health.ts",
    ];
    for (const file of files) {
      const source = await readFile(resolve(process.cwd(), "src/server/read-models", file), "utf8");
      expect(source.toLowerCase()).not.toContain("locale");
    }
  });

  it("11. commercial action remains canonical semantic code", () => {
    const result: CommercialActionResult = {
      opportunityId: "opp-4", action: "VERIFY_CONTACT", ruleVersion: "v1", evaluatedAt: ASOF, asOf: ASOF,
      eligibilityBasis: { snapshotIds: [], eligibleTypes: [] }, scoreBasis: { snapshotId: null, state: null, score: null },
      supportingRoute: null, evidenceIds: [], claimIds: [], contactIds: [], humanDecisionIds: [],
      acceptance: { id: null, state: "NOT_VERIFIED" }, gaps: [], preventedStrongerActions: [],
      explanation: "needs contact verification", recommendationOnly: true,
    };
    const item = assembleCommercialActionItem(result, ASOF);
    expect(item.recommendation).toBe("VERIFY_CONTACT");
    expect(item.recommendation).not.toBe("Verify contact");
    expect(item.recommendationOnly).toBe(true);
  });

  it("12. trust/currentness/capability remain canonical semantic states", () => {
    expect(READ_MODEL_TRUST_STATES).toContain("HUMAN_VERIFICATION_REQUIRED");
    expect(READ_MODEL_CURRENTNESS_STATES).toContain("AGING");
    expect(READ_MODEL_CAPABILITY_STATES).toEqual(["OPERATIONAL", "PARTIAL", "PLANNED", "UNAVAILABLE", "UNKNOWN"]);
  });

  it("13. proper nouns pass through unchanged", () => {
    const view = assembleHumanVerificationPacketView(SAMPLE_PACKET);
    expect(view.target.companyName).toBe("Acme Staffing");
  });

  it("14. evidence provenance remains unchanged", () => {
    const evidence: EvidenceRecord = {
      id: "ev-20", sourceId: "src-2", sourceUrl: "https://example.com/posting", capturedAt: ASOF, captureMethod: "HTTP_FETCH",
      contentHash: "hash", payloadSizeBytes: 10, contentType: "text/html", extractorVersion: "1.0.0",
      storageReference: "ref", httpMetadata: {}, metadata: {},
    };
    const item = assembleEvidenceTimelineItem({ evidence, asOf: ASOF });
    expect(item.provenanceRef).toEqual({ evidenceId: "ev-20", claimId: null, sourceUrl: "https://example.com/posting" });
  });

  it("15. candidate evidence remains candidate, not verified", () => {
    expect(mapCandidateEvidenceState("CANDIDATE")).toBe("CANDIDATE");
  });

  it("16. VERIFIED_NEGATIVE remains distinct from VERIFIED_POSITIVE", () => {
    expect(mapManpowerAcceptanceTrustState("VERIFIED_NEGATIVE")).toBe("VERIFIED");
    const negative = assembleExternalManpowerAcceptanceView(
      { id: "af01-3", companyId: "co-2", context: null, result: "VERIFIED_NEGATIVE", qualifyingCategories: [], supportingClaimIds: [], supportingEvidenceIds: [], ignoredClaimIds: [], evaluatedAt: ASOF, ruleVersion: "af-01@2.0.0", validUntil: null, reason: "explicit denial", explanation: {} },
      ASOF,
    );
    const positive = assembleExternalManpowerAcceptanceView(
      { id: "af01-4", companyId: "co-2", context: null, result: "VERIFIED_POSITIVE", qualifyingCategories: [], supportingClaimIds: [], supportingEvidenceIds: [], ignoredClaimIds: [], evaluatedAt: ASOF, ruleVersion: "af-01@2.0.0", validUntil: null, reason: "explicit acceptance", explanation: {} },
      ASOF,
    );
    expect(negative.accepted).toBe(false);
    expect(positive.accepted).toBe(true);
    expect(negative.accepted).not.toBe(positive.accepted);
  });

  it("17. known zero remains zero", () => {
    expect(knownMetric(0)).toEqual({ state: "KNOWN", value: 0 });
  });

  it("18. unknown remains unknown", () => {
    const summary = assembleCommandCenterSummary({ asOf: ASOF });
    expect(summary.blockedCount.value).toEqual({ state: "UNKNOWN" });
  });

  it("19. human verification required remains explicit", () => {
    const opportunity: OpportunityRecord = {
      id: "opp-5", identityKey: "key-5", projectId: null, unresolvedCompanyContext: null, title: "Test",
      lifecycle: "ACTIVE", firstSeenAt: ASOF, lastSeenAt: ASOF, staleAfter: null, verificationDueAt: null, metadata: {},
    };
    const eligibility: EligibilityResult = {
      opportunityId: "opp-5", evaluatedAt: ASOF, asOf: ASOF, ruleVersion: "v1", eligibilityType: "HOT_A_ELIGIBLE",
      eligible: false, passedRequirements: [], failedRequirements: ["HUMAN_VERIFICATION_REQUIRED"],
      blockingGaps: ["HUMAN_VERIFICATION_REQUIRED"],
      reviewedIdentifiers: { evidenceIds: [], claimIds: [], contactIds: [], routeIds: [], reviewDecisionIds: [] },
      requirements: [], explanation: "blocked", economicsReady: false,
    };
    const item = assembleOpportunityRadarItem({ opportunity, eligibility, asOf: ASOF });
    expect(item.verificationState).toBe("HUMAN_VERIFICATION_REQUIRED");
  });

  it("20. if questionType is added, it matches the canonical upstream value without changing generated primaryQuestion text", () => {
    const withoutType = assembleHumanVerificationPacketView(SAMPLE_PACKET);
    const withType = assembleHumanVerificationPacketView(SAMPLE_PACKET, "MANPOWER_ACCEPTANCE");
    expect(withoutType.questionType).toBeNull();
    expect(withType.questionType).toBe("MANPOWER_ACCEPTANCE");
    expect(withType.primaryQuestion).toBe(withoutType.primaryQuestion);
    expect(withType.primaryQuestion).toBe(SAMPLE_PACKET.question.primary);
  });
});
