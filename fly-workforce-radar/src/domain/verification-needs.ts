/**
 * Phase 2R-B Discovery: what a promoted tracked signal still needs a human to
 * find out.
 *
 * THE POINT IS SUBTRACTION, NOT ADDITION. A need is emitted ONLY when the
 * corresponding fact is genuinely missing from what the source stated. A
 * signal that already carries a buyer does not get a RESOLVE_BUYER task just
 * to keep the checklist symmetrical, and a signal that carries wage, schedule
 * AND per-diem gets no VERIFY_ECONOMICS at all. A fully-evidenced signal
 * yields zero needs -- that outcome is correct, not a bug.
 *
 * This module answers "what is still unknown", nothing else. It does not
 * grade, score, rank, prioritise or route anything, it never decides
 * eligibility, and it emits no contact-route grades: per this codebase's
 * existing eligibility model (source-portfolio-audit-2k-service.ts's
 * HOT_GAP_FINDINGS), promoting an AF-01 candidate to a verified
 * manpower-acceptance record and grading a contact route are human-gated steps.
 * A need produced here is an instruction for that human, never a substitute
 * for them.
 */
export const VERIFICATION_NEEDS_RULE_VERSION="verification-needs@1.0.0";

export const VERIFICATION_NEED_KINDS=[
  "RESOLVE_BUYER",
  "VERIFY_MANPOWER_ACCEPTANCE",
  "FIND_ACTIONABLE_CONTACT",
  "IDENTIFY_PROJECT",
  "VERIFY_ECONOMICS",
  "VERIFY_HEADCOUNT",
  "VERIFY_TEMPORAL_STATUS"
]as const;
export type VerificationNeedKind=(typeof VERIFICATION_NEED_KINDS)[number];

export interface VerificationNeed{
  kind:VerificationNeedKind;
  /** Names the specific fact(s) found missing, so the reason is auditable
   * against the source text rather than boilerplate. */
  reason:string;
  /** The individual sub-facts that were absent. Empty for needs that track a
   * single field. */
  missingFields:string[];
}

/**
 * The known state of a candidate, as captured. Every field is "what the source
 * explicitly stated", with null meaning "the source did not state it" -- never
 * "we did not look" and never a default.
 */
export interface VerificationNeedsInput{
  buyer:string|null;
  /** AF-01 / manpower-acceptance status. Null whenever the source did not
   * explicitly state one. A union dispatch board carrying a job call is NOT
   * evidence of manpower acceptance, so adapters leave this null. */
  manpowerAcceptance:string|null;
  contact:string|null;
  project:string|null;
  wage:string|null;
  hoursOrSchedule:string|null;
  perDiemOrIncentive:string|null;
  headcount:number|null;
  /** The source's own posting/observation date. Null when the page did not
   * state one, which is exactly when currentness is unclear. */
  postingDate:Date|string|null;
}

export interface VerificationNeedsResult{
  needs:VerificationNeed[];
  kinds:VerificationNeedKind[];
  ruleVersion:string;
}

const stated=(v:string|null|undefined):boolean=>typeof v==="string"&&v.trim().length>0;

/** Pure and deterministic: same input, same needs, no clock and no I/O. */
export function deriveVerificationNeeds(input:VerificationNeedsInput):VerificationNeedsResult{
  const needs:VerificationNeed[]=[];

  if(!stated(input.buyer))needs.push({kind:"RESOLVE_BUYER",reason:"the source's own text never named the buying entity paying for this manpower",missingFields:["buyer"]});

  if(!stated(input.manpowerAcceptance))needs.push({kind:"VERIFY_MANPOWER_ACCEPTANCE",reason:"no explicit AF-01 / manpower-acceptance statement was captured; whether this buyer accepts third-party manpower is unverified and requires human confirmation (the existence of a job call is not evidence of acceptance)",missingFields:["manpowerAcceptance"]});

  if(!stated(input.contact))needs.push({kind:"FIND_ACTIONABLE_CONTACT",reason:"no named, actionable contact was stated in the source text; no contact-route grade is assigned here because grading is human-gated",missingFields:["contact"]});

  if(!stated(input.project))needs.push({kind:"IDENTIFY_PROJECT",reason:"the source named no distinct project this manpower is for",missingFields:["project"]});

  // Economics is a composite: partial knowledge still needs verification, and
  // the reason names precisely which parts were missing.
  const economicsMissing=[
    ...(stated(input.wage)?[]:["wage"]),
    ...(stated(input.hoursOrSchedule)?[]:["hoursOrSchedule"]),
    ...(stated(input.perDiemOrIncentive)?[]:["perDiemOrIncentive"])
  ];
  if(economicsMissing.length>0){
    const known=["wage","hoursOrSchedule","perDiemOrIncentive"].filter(f=>!economicsMissing.includes(f));
    needs.push({
      kind:"VERIFY_ECONOMICS",
      reason:known.length>0
        ?`economics are only partially stated (present: ${known.join(", ")}; missing: ${economicsMissing.join(", ")})`
        :"no wage, schedule or per-diem/incentive figure was stated in the source text",
      missingFields:economicsMissing
    });
  }

  if(input.headcount===null||input.headcount===undefined)needs.push({kind:"VERIFY_HEADCOUNT",reason:"the source stated no explicit worker count for this call",missingFields:["headcount"]});

  const hasDate=input.postingDate instanceof Date?!Number.isNaN(input.postingDate.getTime()):stated(typeof input.postingDate==="string"?input.postingDate:null);
  if(!hasDate)needs.push({kind:"VERIFY_TEMPORAL_STATUS",reason:"the source stated no posting/observation date, so whether this call is still open is unclear",missingFields:["postingDate"]});

  return{needs,kinds:needs.map(n=>n.kind),ruleVersion:VERIFICATION_NEEDS_RULE_VERSION};
}
