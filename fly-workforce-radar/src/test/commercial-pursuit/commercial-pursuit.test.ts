import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFER_HYPOTHESES, OUTCOMES, PIPELINE_STAGES, accessSummary, commercialTruth, currentNextAction, derivePipeline, fitSummary, learningCounts, painSummary, referralVisibility,
  stageOfActivity, validateActivity, type ActivityInput, type ActivityRecord, type PainSignalRecord,
} from "../../domain/commercial-pursuit";
import { declinedByHuman } from "../../domain/buyer-intelligence";
import { unknownStaffRequestFields, type StaffRequestInput } from "../../server/commercial-pursuit/pursuit-store";

let seq = 0;
const act = (overrides: Partial<ActivityRecord>): ActivityRecord => ({
  id: `a${++seq}`, activityType: "OUTREACH", accessChannel: "CALL", outcome: "NO_ANSWER", result: null, handlesExternalWorkforce: "UNKNOWN", performedAt: `2026-09-${String(10 + seq).padStart(2, "0")}T15:00:00Z`,
  recordedAt: `2026-09-${String(10 + seq).padStart(2, "0")}T15:05:00Z`, nextAction: "Follow up", nextActionDue: "2026-10-05", nextActionOwnerOperatorId: "op", offerHypothesis: null,
  contactName: null, referredName: null, referredDepartment: null, staffRequestDemandSignalId: null, ...overrides,
});
const pain = (overrides: Partial<PainSignalRecord>): PainSignalRecord => ({
  id: `p${++seq}`, painType: "JOB_REPOSTED", assertionBasis: "OBSERVED", status: "UNVERIFIED", confidence: "MEDIUM", summary: "Same posting re-published", sourceKind: "PUBLIC_SOURCE",
  sourceUrl: "https://jobs.example/1", observedAt: null, recordedAt: "2026-09-20T00:00:00Z", supersedesId: null, reportedByWorkerId: null, consentUseIntelligence: null,
  consentIdentifyWorker: null, supervisorName: null, supervisorTitle: null, ...overrides,
});
const input = (overrides: Partial<ActivityInput>): ActivityInput => ({
  activityType: "OUTREACH", accessChannel: "CALL", outcome: "NO_ANSWER", result: null, performedAt: "2026-09-21T15:00:00Z", nextAction: "Call back", nextActionDue: "2026-10-05",
  nextActionOwnerOperatorId: "op", referredName: null, referredDepartment: null, hasStaffRequest: false, offerHypothesis: null, ...overrides,
});
const OPEN = derivePipeline({ activities: [], routeIdentified: false });

describe("pipeline stages advance only from human evidence", () => {
  it("a verified signal and a found contact never reach a human stage", () => {
    expect(derivePipeline({ activities: [], routeIdentified: true })).toMatchObject({ status: "NOT_PURSUED", currentStage: "ROUTE_IDENTIFIED", maxStageReached: "ROUTE_IDENTIFIED" });
    expect(derivePipeline({ activities: [act({ activityType: "PURSUIT_STARTED", accessChannel: null, outcome: null })], routeIdentified: true }))
      .toMatchObject({ status: "ACTIVE", currentStage: "ROUTE_IDENTIFIED" });
  });
  it("maps outcomes to stages: reaching a gatekeeper or the wrong person is a touch, not a conversation", () => {
    expect(stageOfActivity({ activityType: "OUTREACH", outcome: "NO_ANSWER" })).toBe("FIRST_TOUCH");
    for (const outcome of ["GATEKEEPER", "WRONG_PERSON", "REFERRED_TO_OTHER_PERSON", "CALL_BACK", "VOICEMAIL"] as const) expect(stageOfActivity({ activityType: "OUTREACH", outcome })).toBe("FIRST_TOUCH");
    for (const outcome of ["CONVERSATION", "ACCEPTS_EXTERNAL_LABOR", "DOES_NOT_ACCEPT_EXTERNAL_LABOR", "NO_CURRENT_NEED", "VENDOR_REGISTRATION_REQUIRED", "NOT_INTERESTED"] as const) {
      expect(stageOfActivity({ activityType: "MEETING", outcome })).toBe("CONVERSATION");
    }
    expect(stageOfActivity({ activityType: "FOLLOW_UP", outcome: "STAFF_REQUEST" })).toBe("STAFF_REQUEST");
    expect(stageOfActivity({ activityType: "NOTE", outcome: null })).toBeNull();
  });
  it("keeps max stage reached when the opportunity is lost", () => {
    const activities = [act({ outcome: "CONVERSATION" }), act({ activityType: "STAFF_REQUEST_RECEIVED", outcome: null, staffRequestDemandSignalId: "d1" }),
      act({ activityType: "PROPOSAL_SENT", accessChannel: "EMAIL", outcome: null }), act({ activityType: "RESULT", accessChannel: null, outcome: null, result: "LOST", nextAction: null, nextActionDue: null, nextActionOwnerOperatorId: null })];
    expect(derivePipeline({ activities, routeIdentified: true })).toMatchObject({ status: "CLOSED", currentStage: "RESULT", maxStageReached: "PROPOSAL", result: "LOST" });
    expect(currentNextAction(activities, "2026-10-10")).toBeNull();
  });
  it("covers every stage up to RESULT and nothing operational (no placement, timesheet or invoice stage)", () => {
    expect(PIPELINE_STAGES).toEqual(["SIGNAL", "ROUTE_IDENTIFIED", "FIRST_TOUCH", "CONVERSATION", "STAFF_REQUEST", "PROPOSAL", "PRESENTATION", "RESULT"]);
    expect(OUTCOMES).toEqual(expect.arrayContaining(["NO_CURRENT_NEED", "VENDOR_REGISTRATION_REQUIRED", "NOT_INTERESTED", "DOES_NOT_ACCEPT_EXTERNAL_LABOR"]));
  });
});

describe("activity validation", () => {
  it("requires access channel and outcome for contacts, and a next action with date and owner while the pursuit is open", () => {
    expect(validateActivity(input({ accessChannel: null, outcome: null }), OPEN)).toMatchObject({ accessChannel: "required", outcome: "required" });
    expect(validateActivity(input({ nextAction: null, nextActionDue: null, nextActionOwnerOperatorId: null }), OPEN)).toMatchObject({ nextAction: "required", nextActionDue: "required", nextActionOwner: "required" });
    expect(validateActivity(input({ activityType: "NOTE", accessChannel: null, outcome: null, nextAction: null, nextActionDue: null, nextActionOwnerOperatorId: null }), OPEN)).toEqual({});
    expect(validateActivity(input({}), OPEN)).toEqual({});
  });
  it("requires the referred person or department, a staff request record, and a result only on RESULT", () => {
    expect(validateActivity(input({ outcome: "REFERRED_TO_OTHER_PERSON" }), OPEN)).toMatchObject({ referredName: "required" });
    expect(validateActivity(input({ outcome: "REFERRED_TO_OTHER_PERSON", referredDepartment: "Procurement" }), OPEN)).toEqual({});
    expect(validateActivity(input({ outcome: "STAFF_REQUEST" }), OPEN)).toMatchObject({ staffRequest: "required" });
    expect(validateActivity(input({ result: "WON" }), OPEN)).toMatchObject({ result: "onlyForResult" });
    const closed = derivePipeline({ activities: [act({ activityType: "RESULT", accessChannel: null, outcome: null, result: "NO_DECISION" })], routeIdentified: false });
    expect(validateActivity(input({}), closed)).toMatchObject({ activityType: "pursuitClosed" });
  });
});

describe("DEMAND ≠ PURSUIT ≠ RESULT", () => {
  it("labor-demand evidence never implies external-labor purchasing, a conversation or a staff request", () => {
    expect(commercialTruth({ painUsable: 3, demandSignals: 5, activities: [] })).toEqual({ laborDemandEvidence: true, externalLaborPurchasing: "UNKNOWN", conversationConfirmed: false, staffRequest: false });
    expect(commercialTruth({ painUsable: 0, demandSignals: 1, activities: [act({ outcome: "WRONG_PERSON" })] })).toMatchObject({ externalLaborPurchasing: "UNKNOWN", conversationConfirmed: false });
    expect(commercialTruth({ painUsable: 0, demandSignals: 1, activities: [act({ outcome: "VENDOR_REGISTRATION_REQUIRED" })] })).toMatchObject({ externalLaborPurchasing: "VENDOR_REGISTRATION_REQUIRED", conversationConfirmed: true, staffRequest: false });
    expect(commercialTruth({ painUsable: 0, demandSignals: 1, activities: [act({ outcome: "NO_CURRENT_NEED" })] }).externalLaborPurchasing).toBe("UNKNOWN");
    expect(commercialTruth({ painUsable: 0, demandSignals: 1, activities: [act({ outcome: "DOES_NOT_ACCEPT_EXTERNAL_LABOR" })] }).externalLaborPurchasing).toBe("DECLINED");
  });
  it("keeps PAIN, ACCESS and FIT separate — no combined score exists", () => {
    const strongPain = painSummary([pain({ status: "VERIFIED" })]);
    expect(strongPain.level).toBe("VERIFIED");
    expect(accessSummary({ route: null, commercialContactNamed: false, activities: [], usableWorkerReferral: false })).toEqual({ level: "NONE", factors: [] });
    expect(fitSummary([])).toMatchObject({ level: "UNKNOWN" });
    const domainSource = readFileSync(resolve(process.cwd(), "src/domain/commercial-pursuit.ts"), "utf8");
    expect(domainSource).not.toMatch(/priorityScore|compositeScore|pain\s*\*\s*access|access\s*\*\s*fit/i);
  });
  it("FIT stays UNKNOWN without a structured staff request and uses existing match counts otherwise", () => {
    expect(fitSummary([{ headcount: 4, counts: null }]).level).toBe("NOT_EVALUATED");
    expect(fitSummary([{ headcount: 4, counts: { STRONG_MATCH: 4, POSSIBLE_MATCH: 1, NO_MATCH: 2, INSUFFICIENT_DATA: 0 } }]).level).toBe("COVERABLE");
    expect(fitSummary([{ headcount: 4, counts: { STRONG_MATCH: 1, POSSIBLE_MATCH: 2, NO_MATCH: 2, INSUFFICIENT_DATA: 0 } }]).level).toBe("PARTIAL");
    expect(fitSummary([{ headcount: null, counts: { STRONG_MATCH: 0, POSSIBLE_MATCH: 0, NO_MATCH: 9, INSUFFICIENT_DATA: 1 } }]).level).toBe("NOT_COVERED");
  });
  it("lists access factors without promoting anyone", () => {
    const access = accessSummary({ route: { person: null, phoneClass: "D_MAIN", department: "PROCUREMENT", departmentEvidence: { quote: "Procurement", url: "u" }, responsibility: null },
      commercialContactNamed: false, activities: [act({ accessChannel: "EXISTING_RELATIONSHIP", outcome: "CONVERSATION" })], usableWorkerReferral: true });
    expect(access.factors).toEqual(expect.arrayContaining(["DEPARTMENTAL_ROUTE", "WORKER_REFERRAL", "EXISTING_RELATIONSHIP", "HUMAN_CONVERSATION"]));
    expect(access.factors).not.toContain("CONFIRMED_COMMERCIAL_RESPONSIBILITY");
  });
});

describe("worker referral consent", () => {
  const referral = (use: boolean | null, identify: boolean | null) => pain({ painType: "WORKER_REFERRAL", assertionBasis: "REPORTED", sourceKind: "WORKER_REPORT", reportedByWorkerId: "w1",
    consentUseIntelligence: use, consentIdentifyWorker: identify });
  it("uses intelligence only with consent, and names the worker only with the second, separate consent", () => {
    expect(referralVisibility(referral(false, false))).toEqual({ usableCommercially: false, mayNameWorkerToProspect: false });
    expect(referralVisibility(referral(true, false))).toEqual({ usableCommercially: true, mayNameWorkerToProspect: false });
    expect(referralVisibility(referral(true, true))).toEqual({ usableCommercially: true, mayNameWorkerToProspect: true });
    expect(referralVisibility(referral(false, true)).mayNameWorkerToProspect).toBe(false);
  });
  it("excludes non-consented intelligence from PAIN and counts it as withheld", () => {
    const summary = painSummary([referral(false, false), pain({ assertionBasis: "INFERRED" })]);
    expect(summary).toMatchObject({ level: "INFERRED", usable: 1, withheld: 1 });
    expect(summary.types).not.toContain("WORKER_REFERRAL");
  });
  it("follows supersession chains (append-only history; latest assertion counts)", () => {
    const first = pain({ id: "x1" });
    const second = pain({ id: "x2", supersedesId: "x1", status: "REJECTED" });
    expect(painSummary([first, second])).toMatchObject({ level: "NONE", rejected: 1 });
  });
});

describe("offer hypotheses are tested messages, not contractual promises", () => {
  it("contains approaches only — no guarantees, free hours, replacement policies or fees", () => {
    expect(OFFER_HYPOTHESES).toEqual(["STAFFING_SUBCONTRACTOR", "ABSENCE_COVERAGE", "SMALL_TRIAL_CREW", "TEMP_TO_HIRE", "EVALUATED_ELECTRICIANS", "BILINGUAL_CREW", "OTHER"]);
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261003010000_commercial_pursuit.sql"), "utf8");
    expect(migration).not.toMatch(/guarantee|free_hours|replacement_polic|conversion_fee|temp_to_hire_fee/i);
  });
});

describe("staff request unknown fields", () => {
  it("lists every field the requester did not state", () => {
    const blank: StaffRequestInput = { opportunityId: "o", receivedAt: "2026-09-25T00:00:00Z", accessChannel: "CALL", contactCandidateId: null, contactName: null, contactTitle: null, tradeCode: null,
      occupationCode: null, level: null, headcount: null, specialty: null, projectSite: null, city: null, state: null, startDate: null, expectedEndDate: null, durationText: null, schedule: null,
      shift: null, minimumExperienceMonths: null, requiredCredentials: [], preferredCredentials: [], requiredSkills: [], payRateMin: null, payRateMax: null, payPeriod: null, billRate: null,
      perDiemAvailable: null, perDiemAmount: null, travelRequired: null, additionalRequirements: null, notes: null, nextAction: "x", nextActionDue: "2026-10-01", nextActionOwnerOperatorId: "op" };
    expect(unknownStaffRequestFields(blank)).toHaveLength(18);
    expect(unknownStaffRequestFields({ ...blank, headcount: 3, perDiemAvailable: false, travelRequired: true })).not.toEqual(expect.arrayContaining(["headcount", "perDiem", "travelRequired"]));
  });
});

describe("wrong-person feedback (Contact Intelligence)", () => {
  const interaction = (handles: "YES" | "NO" | "UNKNOWN", at: string, reached = true) => ({ candidateId: "c", personReached: reached, contactDate: at.slice(0, 10), channel: "PHONE" as const,
    handlesExternalWorkforce: handles, referredTo: null, responsibleDepartment: null, notes: null, nextAction: null, recordedAt: at });
  it("drops a person from route selection only on the latest reached human NO; a later YES restores them", () => {
    expect(declinedByHuman({ interactions: [] })).toBe(false);
    expect(declinedByHuman({ interactions: [interaction("NO", "2026-09-21T10:00:00Z")] })).toBe(true);
    expect(declinedByHuman({ interactions: [interaction("NO", "2026-09-21T10:00:00Z", false)] })).toBe(false);
    expect(declinedByHuman({ interactions: [interaction("NO", "2026-09-21T10:00:00Z"), interaction("YES", "2026-09-22T10:00:00Z")] })).toBe(false);
    expect(declinedByHuman({ interactions: [interaction("NO", "2026-09-21T10:00:00Z"), interaction("UNKNOWN", "2026-09-22T10:00:00Z")] })).toBe(true);
  });
});

describe("commercial learning data (no weighting, no source pausing)", () => {
  it("keeps pursuit intent separate from human commercial evidence and results", () => {
    const started = act({ activityType: "PURSUIT_STARTED", accessChannel: null, outcome: null, result: null });
    const pipeline = derivePipeline({ activities: [started], routeIdentified: false });
    const truth = commercialTruth({ painUsable: 0, demandSignals: 1, activities: [started] });
    const counts = learningCounts([{ activities: [started] }], { from: "2026-09-01", to: "2026-09-30" }, "2026-09-30");
    expect(pipeline).toMatchObject({ status: "ACTIVE", currentStage: "SIGNAL", maxStageReached: "SIGNAL", result: null });
    expect(truth).toEqual({ laborDemandEvidence: true, externalLaborPurchasing: "UNKNOWN", conversationConfirmed: false, staffRequest: false });
    expect(counts).toMatchObject({ firstTouches: 0, conversations: 0, externalLaborConfirmed: 0, staffRequests: 0, proposals: 0, presentations: 0, results: { WON: 0, LOST: 0, NO_DECISION: 0 } });
  });
  it("counts touches, conversations, staff requests, channels, outcomes and offers inside the window", () => {
    const pursuits = [
      { activities: [act({ activityType: "PURSUIT_STARTED", accessChannel: null, outcome: null, offerHypothesis: "SMALL_TRIAL_CREW", performedAt: "2026-09-21T10:00:00Z" }),
        act({ accessChannel: "WORKER_REFERRAL", outcome: "CONVERSATION", performedAt: "2026-09-22T10:00:00Z" }),
        act({ activityType: "STAFF_REQUEST_RECEIVED", accessChannel: "CALL", outcome: null, staffRequestDemandSignalId: "d", performedAt: "2026-09-23T10:00:00Z", nextActionDue: "2026-09-25" })] },
      { activities: [act({ outcome: "NO_ANSWER", performedAt: "2026-09-24T10:00:00Z", offerHypothesis: "BILINGUAL_CREW" })] },
      { activities: [act({ outcome: "CONVERSATION", performedAt: "2026-07-01T10:00:00Z" })] }, // outside the window
    ];
    const counts = learningCounts(pursuits, { from: "2026-09-01", to: "2026-09-30" }, "2026-09-30");
    expect(counts).toMatchObject({ pursued: 2, firstTouches: 2, conversations: 1, staffRequests: 1, nextActions: { open: 2, overdue: 1 } });
    expect(counts.byChannel.WORKER_REFERRAL).toEqual({ touches: 1, conversations: 1, staffRequests: 0 });
    expect(counts.byOffer.SMALL_TRIAL_CREW).toEqual({ opportunities: 1, conversations: 1, staffRequests: 1 });
    expect(counts.byOffer.BILINGUAL_CREW).toEqual({ opportunities: 1, conversations: 0, staffRequests: 0 });
  });
});

describe("no automated outbound contact", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((entry) => { const p = join(dir, entry); return statSync(p).isDirectory() ? files(p) : [p]; });
  it("commercial pursuit code has no messaging, email, SMS or dialing capability", () => {
    const root = resolve(process.cwd(), "src");
    const scanned = [join(root, "domain/commercial-pursuit.ts"), ...files(join(root, "server/commercial-pursuit")), ...files(join(root, "components/commercial-pursuit"))]
      .filter((f) => /\.(ts|tsx)$/.test(f));
    expect(scanned.length).toBeGreaterThanOrEqual(4);
    for (const file of scanned) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bfetch\(|nodemailer|sendgrid|twilio|whatsapp|smtp|\bsendMail\b|\bsendSms\b|mailto:|tel:/i);
    }
  });
});
