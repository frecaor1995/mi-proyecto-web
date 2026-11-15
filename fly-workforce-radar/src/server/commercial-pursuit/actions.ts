"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  ACCESS_CHANNELS, ACTIVITY_TYPES, ASSERTION_BASES, CONFIDENCES, OFFER_HYPOTHESES, OUTCOMES, PAIN_SOURCE_KINDS, PAIN_TYPES, RESULTS,
  type AccessChannel, type ActivityType, type AssertionBasis, type Confidence, type HandlesExternalWorkforce, type OfferHypothesis, type Outcome, type PainSourceKind, type PainType, type PursuitResult,
} from "../../domain/commercial-pursuit";
import { authorizeOperator } from "../auth/authorization";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import { PursuitValidationError, designateRole, promotePainSignal, recordActivity, recordPainSignal, recordStaffRequest, supersedePainSignal } from "./pursuit-store";

/**
 * Phase 3A actions. Every action records what a HUMAN did or learned; none sends anything to anyone.
 * Writes need "commercial_pursuit.write" and run in one transaction (evidence, records and Contact Intelligence feedback).
 */
export interface PursuitActionState {
  readonly state: "IDLE" | "DONE" | "RESTRICTED" | "UNAVAILABLE" | "INVALID" | "FAILED";
  readonly errors: Readonly<Record<string, string>>;
  readonly href?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (data: FormData, name: string, max = 500) => String(data.get(name) ?? "").trim().slice(0, max) || null;
const id = (data: FormData, name: string) => { const value = text(data, name, 64); return value && UUID.test(value) ? value : null; };
const oneOf = <T extends string>(data: FormData, name: string, values: readonly T[]): T | null => { const value = text(data, name, 64); return value && (values as readonly string[]).includes(value) ? value as T : null; };
const int = (data: FormData, name: string) => { const value = text(data, name, 12); if (value === null) return null; const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : Number.NaN; };
const num = (data: FormData, name: string) => { const value = text(data, name, 20); if (value === null) return null; const n = Number(value); return Number.isFinite(n) ? n : Number.NaN; };
/** Tri-state from a select: "yes" / "no" / "" (unknown stays null — never defaulted). */
const tri = (data: FormData, name: string) => { const value = text(data, name, 8); return value === "yes" ? true : value === "no" ? false : null; };
const codes = (data: FormData, name: string) => (text(data, name, 400) ?? "").split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
const dateTime = (data: FormData, name: string) => { const value = text(data, name, 40); return value ? new Date(value.length <= 10 ? `${value}T12:00:00Z` : value).toISOString() : null; };

async function run(fn: (operatorId: string, runner: NonNullable<ReturnType<typeof getProductionTransactionRunner>>) => Promise<string[]>): Promise<PursuitActionState> {
  const authorization = await authorizeOperator("commercial_pursuit.write");
  if (authorization.state !== "AUTHORIZED") return { state: "RESTRICTED", errors: {} };
  const runner = getProductionTransactionRunner();
  if (!runner) return { state: "UNAVAILABLE", errors: {} };
  try {
    const paths = await fn(authorization.operator.operatorId, runner);
    for (const path of paths) revalidatePath(path);
    revalidatePath("/opportunities/pursuits");
    return { state: "DONE", errors: {} };
  } catch (error) {
    if (error instanceof PursuitValidationError) return { state: "INVALID", errors: error.errors };
    const code = (error as { code?: string } | null)?.code;
    if (["23503", "23514", "22P02", "22007", "22008"].includes(code ?? "")) return { state: "INVALID", errors: { form: "rejectedByDatabase" } };
    return { state: "FAILED", errors: { form: error instanceof Error ? error.message.slice(0, 200) : "failed" } };
  }
}

export async function recordPainSignalAction(previous: PursuitActionState, data: FormData): Promise<PursuitActionState> {
  void previous;
  const painType = oneOf<PainType>(data, "painType", PAIN_TYPES);
  const companyId = id(data, "companyId");
  const opportunityId = id(data, "opportunityId");
  if (!painType || (!companyId && !opportunityId)) return { state: "INVALID", errors: { painType: painType ? "ok" : "required", companyId: "required" } };
  const workerId = id(data, "reportedByWorkerId");
  const isReferral = painType === "WORKER_REFERRAL";
  if (isReferral && !workerId) return { state: "INVALID", errors: { reportedByWorkerId: "required" } };
  return run(async (operatorId, runner) => {
    await runner((client) => recordPainSignal(client, {
      companyId, opportunityId, painType, confidence: oneOf<Confidence>(data, "confidence", CONFIDENCES) ?? "UNKNOWN", summary: text(data, "summary", 2000) ?? "",
      assertionBasis: isReferral ? "REPORTED" : oneOf<AssertionBasis>(data, "assertionBasis", ASSERTION_BASES) ?? "REPORTED",
      sourceKind: isReferral ? "WORKER_REPORT" : oneOf<PainSourceKind>(data, "sourceKind", PAIN_SOURCE_KINDS) ?? "OPERATOR_OBSERVATION",
      sourceUrl: text(data, "sourceUrl", 2000), observedAt: dateTime(data, "observedAt"),
      workerReferral: isReferral ? {
        reportedByWorkerId: workerId!, siteText: text(data, "siteText", 300), city: text(data, "city", 120), state: text(data, "state", 40), supervisorName: text(data, "supervisorName", 200),
        supervisorTitle: text(data, "supervisorTitle", 200), neededHeadcount: int(data, "neededHeadcount"), neededRoleText: text(data, "neededRoleText", 300),
        consentUseIntelligence: data.get("consentUseIntelligence") === "yes", consentIdentifyWorker: data.get("consentIdentifyWorker") === "yes",
      } : null,
    }, operatorId));
    return [companyId ? `/companies/${companyId}` : "", opportunityId ? `/opportunities/${opportunityId}/pursuit` : ""].filter(Boolean);
  });
}

export async function reviewPainSignalAction(previous: PursuitActionState, data: FormData): Promise<PursuitActionState> {
  void previous;
  const painSignalId = id(data, "painSignalId");
  const status = oneOf(data, "status", ["VERIFIED", "REJECTED"] as const);
  if (!painSignalId || !status) return { state: "INVALID", errors: { status: "required" } };
  return run(async (operatorId, runner) => {
    await runner((client) => supersedePainSignal(client, { painSignalId, status, note: text(data, "note", 300) }, operatorId));
    return [text(data, "returnPath", 200) ?? "/opportunities/pursuits"];
  });
}

export async function promotePainSignalAction(previous: PursuitActionState, data: FormData): Promise<PursuitActionState> {
  void previous;
  const painSignalId = id(data, "painSignalId");
  const tradeCode = text(data, "tradeCode", 60)?.toUpperCase() ?? null;
  const occupationCode = text(data, "occupationCode", 60)?.toUpperCase() ?? null;
  const title = text(data, "opportunityTitle", 200);
  const customer = text(data, "customerName", 200);
  if (!painSignalId || !tradeCode || !occupationCode || !title || !customer) return { state: "INVALID", errors: { opportunityTitle: title ? "ok" : "required", tradeCode: tradeCode ? "ok" : "required", occupationCode: occupationCode ? "ok" : "required" } };
  let href: string | null = null;
  const result = await run(async (operatorId, runner) => {
    const promoted = await runner((client) => promotePainSignal(client, { painSignalId, intake: {
      idempotencyKey: randomUUID(), evidenceSummary: text(data, "evidenceSummary", 1000) ?? title, customerName: customer, opportunityTitle: title, projectName: text(data, "projectName", 200),
      city: text(data, "city", 120), state: text(data, "state", 40), tradeCode, occupationCode, headcount: int(data, "headcount"), minimumExperienceMonths: null, startDate: null, schedule: null, skills: [], credentials: [],
    } }, operatorId));
    href = `/opportunities/${promoted.opportunityId}/pursuit`;
    return [text(data, "returnPath", 200) ?? "/opportunities", href];
  });
  return { ...result, href };
}

export async function recordActivityAction(previous: PursuitActionState, data: FormData): Promise<PursuitActionState> {
  void previous;
  const opportunityId = id(data, "opportunityId");
  const activityType = oneOf<ActivityType>(data, "activityType", ACTIVITY_TYPES);
  if (!opportunityId || !activityType || activityType === "STAFF_REQUEST_RECEIVED") return { state: "INVALID", errors: { activityType: "required" } };
  const referralName = text(data, "referredName", 200);
  const referralDepartment = text(data, "referredDepartment", 200);
  return run(async (operatorId, runner) => {
    await runner((client) => recordActivity(client, {
      opportunityId, activityType, accessChannel: oneOf<AccessChannel>(data, "accessChannel", ACCESS_CHANNELS), outcome: oneOf<Outcome>(data, "outcome", OUTCOMES),
      result: oneOf<PursuitResult>(data, "result", RESULTS), handlesExternalWorkforce: (oneOf<HandlesExternalWorkforce>(data, "handlesExternalWorkforce", ["YES", "NO", "UNKNOWN"]) ?? "UNKNOWN"),
      contactCandidateId: id(data, "contactCandidateId"), contactPersonId: null, contactName: text(data, "contactName", 200), contactTitle: text(data, "contactTitle", 200),
      performedAt: dateTime(data, "performedAt") ?? new Date().toISOString(), notes: text(data, "notes", 4000),
      nextAction: text(data, "nextAction", 500), nextActionDue: text(data, "nextActionDue", 10), nextActionOwnerOperatorId: id(data, "nextActionOwner") ?? (text(data, "nextAction") ? operatorId : null),
      offerHypothesis: oneOf<OfferHypothesis>(data, "offerHypothesis", OFFER_HYPOTHESES), offerNote: text(data, "offerNote", 1000),
      referral: referralName || referralDepartment ? { name: referralName, title: text(data, "referredTitle", 200), department: referralDepartment, phone: text(data, "referredPhone", 40), email: text(data, "referredEmail", 254) } : null,
    }, operatorId));
    return [`/opportunities/${opportunityId}/pursuit`];
  });
}

export async function designateRoleAction(previous: PursuitActionState, data: FormData): Promise<PursuitActionState> {
  void previous;
  const opportunityId = id(data, "opportunityId");
  const role = oneOf(data, "role", ["PAIN_OWNER", "COMMERCIAL_CONTACT"] as const);
  if (!opportunityId || !role) return { state: "INVALID", errors: { role: "required" } };
  return run(async (operatorId, runner) => {
    await runner((client) => designateRole(client, { opportunityId, role, personName: text(data, "personName", 200) ?? "", personTitle: text(data, "personTitle", 200),
      contactCandidateId: id(data, "contactCandidateId"), contactPersonId: null, basis: text(data, "basis", 600) ?? "", sourceActivityId: null, sourcePainSignalId: id(data, "sourcePainSignalId") }, operatorId));
    return [`/opportunities/${opportunityId}/pursuit`];
  });
}

export async function recordStaffRequestAction(previous: PursuitActionState, data: FormData): Promise<PursuitActionState> {
  void previous;
  const opportunityId = id(data, "opportunityId");
  const accessChannel = oneOf<AccessChannel>(data, "accessChannel", ACCESS_CHANNELS);
  if (!opportunityId || !accessChannel) return { state: "INVALID", errors: { accessChannel: "required" } };
  return run(async (operatorId, runner) => {
    await runner((client) => recordStaffRequest(client, {
      opportunityId, receivedAt: dateTime(data, "receivedAt") ?? new Date().toISOString(), accessChannel, contactCandidateId: id(data, "contactCandidateId"),
      contactName: text(data, "contactName", 200), contactTitle: text(data, "contactTitle", 200), tradeCode: text(data, "tradeCode", 60)?.toUpperCase() ?? null,
      occupationCode: text(data, "occupationCode", 60)?.toUpperCase() ?? null, level: text(data, "level", 80), headcount: int(data, "headcount"), specialty: text(data, "specialty", 200),
      projectSite: text(data, "projectSite", 300), city: text(data, "city", 120), state: text(data, "state", 40), startDate: text(data, "startDate", 10), expectedEndDate: text(data, "expectedEndDate", 10),
      durationText: text(data, "durationText", 120), schedule: text(data, "schedule", 120), shift: text(data, "shift", 80), minimumExperienceMonths: int(data, "minimumExperienceMonths"),
      requiredCredentials: codes(data, "requiredCredentials"), preferredCredentials: codes(data, "preferredCredentials"), requiredSkills: codes(data, "requiredSkills"),
      payRateMin: num(data, "payRateMin"), payRateMax: num(data, "payRateMax"), payPeriod: text(data, "payPeriod", 20), billRate: num(data, "billRate"),
      perDiemAvailable: tri(data, "perDiemAvailable"), perDiemAmount: num(data, "perDiemAmount"), travelRequired: tri(data, "travelRequired"),
      additionalRequirements: text(data, "additionalRequirements", 1000), notes: text(data, "notes", 4000),
      nextAction: text(data, "nextAction", 500) ?? "", nextActionDue: text(data, "nextActionDue", 10) ?? "", nextActionOwnerOperatorId: id(data, "nextActionOwner") ?? operatorId,
    }, operatorId));
    return [`/opportunities/${opportunityId}/pursuit`, `/opportunities/${opportunityId}`];
  });
}
