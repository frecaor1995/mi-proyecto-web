import type{ContactRouteGrade,ContactRouteType}from"./contact";
import type{EligibilityType}from"./eligibility";
import type{HumanVerificationDecision,VerificationState}from"./verification";

/**
 * Phase 2M. TECH-DEBT-04 (deferred by Phase 2L) is that the richer buyer/AF-01/
 * contact-route evidence sitting in the Phase 2H/2I/2J targeted-evidence FACTS
 * ledgers -- and in the earlier hot-conversion REAL_CONVERSION_SET ledger -- could
 * not be consumed by opportunity-qualification-service.ts without opportunity-
 * qualification-service.ts importing targeted-evidence-closure-service.ts, which
 * already imports qualificationDossiers FROM opportunity-qualification-service.ts.
 * That would be a circular import.
 *
 * This file defines a neutral vocabulary that sits strictly BELOW both: it names
 * only what a candidate observation IS (its type, its raw value, its provenance,
 * its verification/review state) and never verifies, rejects, infers, grades,
 * scores, or determines eligibility. Nothing in this file, and nothing the
 * corresponding service produces from real production evidence, is ever
 * "VERIFIED" -- only a real human reviewer, or (in deterministic tests only) the
 * explicitly-labeled CONTROLLED_TEST_REVIEW identity, can produce that state.
 */

export const AGGREGATED_CANDIDATE_TYPES=[
  "BUYER_CANDIDATE",
  "AF01_CANDIDATE",
  "CONTACT_AUTHORITY",
  "COMPANY_PROJECT_CONFLICT",
  "STALE_CRITICAL_EVIDENCE",
]as const;
export type AggregatedCandidateType=(typeof AGGREGATED_CANDIDATE_TYPES)[number];

/**
 * A candidate's own review lifecycle. READY_FOR_HUMAN_REVIEW and NEEDS_MORE_EVIDENCE
 * are the only states real (non-controlled) aggregation output may ever carry --
 * matching the bright line already established by ReviewPackage in
 * domain/targeted-evidence-closure.ts. VERIFIED/REJECTED/DEFERRED only ever appear
 * on a candidate that has been run through the CONTROLLED_TEST_REVIEW pathway.
 */
export const AGGREGATION_REVIEW_STATES=[
  "READY_FOR_HUMAN_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "VERIFIED",
  "REJECTED",
  "DEFERRED",
]as const;
export type AggregationReviewState=(typeof AGGREGATION_REVIEW_STATES)[number];

/** The only identity permitted to move a candidate to VERIFIED/REJECTED/DEFERRED
 * outside of a real human reviewer acting through a real review system. Automated
 * Phase 2M execution must never use this identity against real production data. */
export const CONTROLLED_TEST_REVIEWER_ID="CONTROLLED_TEST_REVIEW";

export interface AggregatedCandidateProvenance{
  originService:string;
  originFactId:string|null;
}

export interface AggregatedCandidate{
  id:string;
  type:AggregatedCandidateType;
  /** The tracked qualification-dossier id this candidate applies to, or null when the
   * underlying evidence is real but not linked to any of the tracked opportunities
   * (e.g. Trillium Amarillo, whose market -- Texas Panhandle -- is not one of the four
   * tracked dossiers). A null opportunityId means this candidate structurally cannot
   * unlock any eligibility gate; it can still be reviewed as a standalone question. */
  opportunityId:string|null;
  /** A stable identifier for this candidate's context: opportunityId when present,
   * otherwise a deterministic synthetic id derived from market/source/subject so the
   * candidate is still individually addressable. */
  contextId:string;
  market:string;
  company:string|null;
  project:string|null;
  /** The candidate's primary descriptive value (buyer name / AF-01 excerpt / contact
   * person name or route / conflict text / stale-evidence reason). Never inferred
   * beyond what the underlying evidence states. */
  value:string;
  category:string|null;
  contactPersonName:string|null;
  routeTarget:string|null;
  routeType:ContactRouteType|null;
  /** Never populated for real evidence; only ever set after a CONTROLLED_TEST_REVIEW
   * VERIFY decision on a candidate of type CONTACT_AUTHORITY. */
  routeGrade:ContactRouteGrade|null;
  evidenceIds:string[];
  sourceIds:string[];
  sourceUrls:string[];
  observedAt:Date;
  staleAfter:Date|null;
  /** Candidate-level verification state. Always UNVERIFIED for real aggregation
   * output; only CONTROLLED_TEST_REVIEW decisions in tests can change this. */
  verificationState:VerificationState;
  reviewState:AggregationReviewState;
  reason:string;
  contraryEvidence:string[];
  provenance:AggregatedCandidateProvenance;
}

export interface HumanReviewQueueItem{
  id:string;
  candidateId:string;
  targetType:AggregatedCandidateType;
  opportunityId:string|null;
  contextId:string;
  market:string;
  evidenceIds:string[];
  sourceUrls:string[];
  currentState:AggregationReviewState;
  reasonReviewRequired:string;
  /** The gate this candidate would help satisfy if it were verified, grounded
   * directly in eligibility-service.ts's real requirement codes -- not the
   * qualification layer's descriptive gap matrix. "NONE" is an honest, structural
   * finding for candidate types the real eligibility engine does not gate on
   * (e.g. a bare buyer-role candidate; see the Phase 2M report). */
  affectsGate:EligibilityType|"CONFLICT_RESOLUTION"|"NONE";
  /** Set only when this candidate is the SOLE remaining blocker on that gate for its
   * tracked opportunity, i.e. verifying it alone would flip the gate to eligible. */
  wouldUnlockGate:EligibilityType|null;
  isStale:boolean;
  staleAfter:Date|null;
  priority:number;
  priorityReason:string;
}

export interface AggregationReviewDecisionInput{
  candidateId:string;
  decision:HumanVerificationDecision;
  reviewerId:string;
  reason:string;
  evidenceIds:string[];
  decidedAt:Date;
  /** Only meaningful on a VERIFY decision against a CONTACT_AUTHORITY candidate. */
  grade?:ContactRouteGrade|null;
}
