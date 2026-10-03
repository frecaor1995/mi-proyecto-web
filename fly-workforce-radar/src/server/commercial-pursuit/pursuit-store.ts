import { createHash, randomUUID } from "node:crypto";
import {
  accessSummary, commercialTruth, currentNextAction, currentPainSignals, derivePipeline, fitSummary, learningCounts, painSummary, referralVisibility,
  validateActivity, type AccessChannel, type AccessSummary, type ActivityRecord, type ActivityType, type AssertionBasis, type CommercialTruth,
  type Confidence, type FitSummary, type HandlesExternalWorkforce, type LearningCounts, type NextActionState, type OfferHypothesis, type Outcome,
  type PainSignalRecord, type PainSourceKind, type PainStatus, type PainSummary, type PainType, type PipelineState, type PursuitResult,
} from "../../domain/commercial-pursuit";
import { classifyOrganization, matchBuyerFunction, personKey, type ActionableRoute, type OrganizationType } from "../../domain/buyer-intelligence";
import type { DemandMatchCounts } from "../../domain/matching-results";
import type { CommercialIntakeInput } from "../../domain/commercial-intake";
import { ensureInvestigation, loadBuyerInvestigation, recordInteraction } from "../contact-intelligence/buyer-investigation";
import { PostgresCommercialIntakeRepository } from "../repositories/commercial-intake/postgres-commercial-intake-repository";
import { PostgresDemandRequirementRepository } from "../repositories/demand/postgres-demand-requirement-repository";
import { PostgresEvidenceRepository, type SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresSourceRepository } from "../repositories/source/postgres-source-repository";
import { EvidenceCaptureService } from "../services/evidence/capture-evidence";

/**
 * Phase 3A commercial pursuit store. Every write is an append-only human record with operator and time; provenance goes
 * through the existing raw_evidence model; human feedback about people goes through Contact Intelligence's own
 * recordInteraction (2.0 state rules unchanged). Nothing here contacts anyone.
 */
const MANUAL_SOURCE_NAME = "Fly Workforce Radar manual commercial intake";
const EXTRACTOR_VERSION = "commercial-pursuit@1.0.0";

export class PursuitValidationError extends Error {
  constructor(readonly errors: Readonly<Record<string, string>>) { super(`Invalid commercial pursuit input: ${Object.keys(errors).join(", ")}`); }
}

const iso = (value: string | Date | null) => (value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString());
const day = (value: string | Date | null) => (value === null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const clean = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

async function manualSourceId(client: SqlClient, observedAt: Date): Promise<string> {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [MANUAL_SOURCE_NAME]);
  const sources = new PostgresSourceRepository(client);
  const source = await sources.findByName(MANUAL_SOURCE_NAME) ?? await sources.create({
    name: MANUAL_SOURCE_NAME, sourceType: "OTHER", accessClassification: "RESTRICTED", enabled: true, requiresAuth: true, paywalled: false,
    sourceMetadata: { purpose: "operator-recorded inbound commercial evidence" }, firstSeenAt: observedAt, lastSeenAt: observedAt,
  });
  return source.id;
}

/** Operator-recorded evidence (MANUAL capture) — the same provenance path Commercial Intake uses. */
async function captureManualEvidence(client: SqlClient, input: { readonly kind: string; readonly reference: string; readonly payload: Record<string, unknown>; readonly operatorId: string; readonly at: Date; readonly sourceUrl?: string | null }) {
  const evidence = await new EvidenceCaptureService(new PostgresEvidenceRepository(client)).capture({
    sourceId: await manualSourceId(client, input.at), sourceUrl: clean(input.sourceUrl) ?? `urn:fly-workforce-radar:${input.kind}:${input.reference}`,
    capturedAt: input.at, captureMethod: "MANUAL", payload: JSON.stringify({ ...input.payload, recordedByOperatorId: input.operatorId, recordedAt: input.at.toISOString() }),
    contentType: "application/json", extractorVersion: EXTRACTOR_VERSION, metadata: { kind: input.kind, operatorRecorded: true, actorOperatorId: input.operatorId },
  });
  return evidence.id;
}

async function opportunityCompany(client: SqlClient, opportunityId: string): Promise<{ readonly companyId: string | null; readonly companyName: string | null; readonly title: string | null }> {
  const row = (await client.query<{ company_id: string | null; common_name: string | null; title: string | null; unresolved_company_context: string | null }>(
    `select oc.company_id, c.common_name, o.title, o.unresolved_company_context from opportunities o
       left join opportunity_companies oc on oc.opportunity_id=o.id left join companies c on c.id=oc.company_id
      where o.id=$1 order by oc.created_at nulls last limit 1`, [opportunityId])).rows[0];
  if (!row) throw new PursuitValidationError({ opportunityId: "notFound" });
  return { companyId: row.company_id, companyName: row.common_name ?? row.unresolved_company_context, title: row.title };
}

// ---------------------------------------------------------------------------------------------------------
// DEMAND: pain evidence and worker referrals

export interface PainSignalInput {
  readonly companyId: string | null;
  readonly opportunityId: string | null;
  readonly painType: PainType;
  readonly assertionBasis: AssertionBasis;
  readonly confidence: Confidence;
  readonly summary: string;
  readonly sourceKind: PainSourceKind;
  readonly sourceUrl: string | null;
  readonly observedAt: string | null;
  readonly demandSignalId?: string | null;
  readonly workerReferral?: {
    readonly reportedByWorkerId: string; readonly siteText: string | null; readonly city: string | null; readonly state: string | null;
    readonly supervisorName: string | null; readonly supervisorTitle: string | null; readonly neededHeadcount: number | null; readonly neededRoleText: string | null;
    readonly consentUseIntelligence: boolean; readonly consentIdentifyWorker: boolean;
  } | null;
}

export async function recordPainSignal(client: SqlClient, input: PainSignalInput, operatorId: string, now = new Date()): Promise<{ readonly id: string; readonly rawEvidenceId: string }> {
  const errors: Record<string, string> = {};
  if (!input.companyId && !input.opportunityId) errors.companyId = "required";
  if (!input.summary.trim()) errors.summary = "required";
  const referral = input.painType === "WORKER_REFERRAL" ? input.workerReferral ?? null : null;
  if (input.painType === "WORKER_REFERRAL" && !referral) errors.workerReferral = "required";
  if (input.painType !== "WORKER_REFERRAL" && input.workerReferral) errors.workerReferral = "onlyForWorkerReferral";
  if (referral && referral.consentIdentifyWorker && !referral.consentUseIntelligence) errors.consentIdentifyWorker = "requiresUseConsent";
  if (input.observedAt && Number.isNaN(Date.parse(input.observedAt))) errors.observedAt = "invalidDate";
  if (Object.keys(errors).length) throw new PursuitValidationError(errors);
  const companyId = input.companyId ?? (input.opportunityId ? (await opportunityCompany(client, input.opportunityId)).companyId : null);
  const id = randomUUID();
  // The evidence payload records what was reported and the consents — no identity documents or private worker data.
  const rawEvidenceId = await captureManualEvidence(client, {
    kind: "commercial-pain", reference: id, operatorId, at: now, sourceUrl: input.sourceUrl,
    payload: { painType: input.painType, assertionBasis: input.assertionBasis, summary: input.summary, sourceKind: input.sourceKind, observedAt: input.observedAt,
      ...(referral ? { workerReferral: { reportedByWorkerId: referral.reportedByWorkerId, site: referral.siteText, city: referral.city, state: referral.state,
        supervisorName: referral.supervisorName, supervisorTitle: referral.supervisorTitle, neededHeadcount: referral.neededHeadcount, neededRole: referral.neededRoleText,
        consentUseIntelligence: referral.consentUseIntelligence, consentIdentifyWorker: referral.consentIdentifyWorker } } : {}) },
  });
  await client.query(
    `insert into commercial_pain_signals(id,company_id,opportunity_id,pain_type,assertion_basis,status,confidence,summary,source_kind,source_url,raw_evidence_id,
       demand_signal_id,observed_at,recorded_at,entered_by_kind,recorded_by_operator_id,reported_by_worker_id,site_text,city,state,supervisor_name,supervisor_title,
       needed_headcount,needed_role_text,consent_use_intelligence,consent_identify_worker)
     values($1,$2,$3,$4,$5,'UNVERIFIED',$6,$7,$8,$9,$10,$11,$12,$13,'HUMAN',$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [id, companyId, input.opportunityId, input.painType, input.assertionBasis, input.confidence, input.summary.trim(), input.sourceKind, clean(input.sourceUrl), rawEvidenceId,
      input.demandSignalId ?? null, iso(input.observedAt), now.toISOString(), operatorId, referral?.reportedByWorkerId ?? null, clean(referral?.siteText), clean(referral?.city),
      clean(referral?.state), clean(referral?.supervisorName), clean(referral?.supervisorTitle), referral?.neededHeadcount ?? null, clean(referral?.neededRoleText),
      referral?.consentUseIntelligence ?? null, referral?.consentIdentifyWorker ?? null]);
  if (input.opportunityId) await new PostgresEvidenceRepository(client).link(rawEvidenceId, { kind: "OPPORTUNITY", id: input.opportunityId }, "SUPPORTS");
  return { id, rawEvidenceId };
}

/** Status changes are new rows superseding the previous one (append-only; the earlier assertion stays auditable). */
export async function supersedePainSignal(client: SqlClient, input: { readonly painSignalId: string; readonly status: PainStatus; readonly opportunityId?: string | null; readonly note?: string | null },
  operatorId: string, now = new Date()): Promise<{ readonly id: string }> {
  const previous = (await client.query<Record<string, unknown>>("select * from commercial_pain_signals where id=$1", [input.painSignalId])).rows[0];
  if (!previous) throw new PursuitValidationError({ painSignalId: "notFound" });
  const successor = (await client.query<{ id: string }>("select id from commercial_pain_signals where supersedes_id=$1", [input.painSignalId])).rows[0];
  if (successor) throw new PursuitValidationError({ painSignalId: "alreadySuperseded" });
  if (input.status === "VERIFIED" && previous.pain_type === "WORKER_REFERRAL" && previous.consent_use_intelligence !== true) throw new PursuitValidationError({ status: "noConsentToUse" });
  const id = randomUUID();
  const opportunityId = input.opportunityId ?? (previous.opportunity_id as string | null);
  await client.query(
    `insert into commercial_pain_signals(id,company_id,opportunity_id,pain_type,assertion_basis,status,confidence,summary,source_kind,source_url,raw_evidence_id,
       demand_signal_id,observed_at,recorded_at,entered_by_kind,recorded_by_operator_id,supersedes_id,reported_by_worker_id,site_text,city,state,supervisor_name,
       supervisor_title,needed_headcount,needed_role_text,consent_use_intelligence,consent_identify_worker)
     select $1,company_id,$2,pain_type,assertion_basis,$3,confidence,case when $4::text is null then summary else left(summary || ' — ' || $4, 2000) end,source_kind,source_url,
       raw_evidence_id,demand_signal_id,observed_at,$5,'HUMAN',$6,id,reported_by_worker_id,site_text,city,state,supervisor_name,supervisor_title,needed_headcount,
       needed_role_text,consent_use_intelligence,consent_identify_worker from commercial_pain_signals where id=$7`,
    [id, opportunityId, input.status, clean(input.note), now.toISOString(), operatorId, input.painSignalId]);
  if (opportunityId && opportunityId !== previous.opportunity_id) {
    await new PostgresEvidenceRepository(client).link(String(previous.raw_evidence_id), { kind: "OPPORTUNITY", id: opportunityId }, "SUPPORTS");
  }
  return { id };
}

/**
 * A verified, consented pain signal becomes a B2B opportunity only through the existing Commercial Intake (the same
 * path as a promoted Radar signal). The intake demand is labor-demand evidence, never a staff request.
 */
export async function promotePainSignal(client: SqlClient, input: { readonly painSignalId: string; readonly intake: Omit<CommercialIntakeInput, "sourceType" | "sourceReference"> },
  operatorId: string, now = new Date()): Promise<{ readonly opportunityId: string; readonly painSignalId: string }> {
  const pain = (await client.query<{ status: string; pain_type: string; consent_use_intelligence: boolean | null; opportunity_id: string | null; company_id: string | null; raw_evidence_id: string }>(
    "select status, pain_type, consent_use_intelligence, opportunity_id, company_id, raw_evidence_id from commercial_pain_signals where id=$1", [input.painSignalId])).rows[0];
  if (!pain) throw new PursuitValidationError({ painSignalId: "notFound" });
  if (pain.status !== "VERIFIED") throw new PursuitValidationError({ painSignalId: "notVerified" });
  if (pain.pain_type === "WORKER_REFERRAL" && pain.consent_use_intelligence !== true) throw new PursuitValidationError({ painSignalId: "noConsentToUse" });
  if (pain.opportunity_id) return { opportunityId: pain.opportunity_id, painSignalId: input.painSignalId };
  const activation = await new PostgresCommercialIntakeRepository(client).activate({ ...input.intake, sourceType: "REFERRAL", sourceReference: null }, operatorId, now);
  // The pain signal already names the company; if name resolution in intake left the opportunity unlinked, link it
  // to that company with the pain evidence as the reason (an intake-resolved company is never replaced).
  if (pain.company_id) {
    await client.query(
      `insert into opportunity_companies(opportunity_id, company_id, link_reason, evidence_id)
       select $1, $2, 'Company identified by the commercial pain signal', $3 where not exists (select 1 from opportunity_companies where opportunity_id=$1)`,
      [activation.opportunityId, pain.company_id, pain.raw_evidence_id]);
  }
  const successor = await supersedePainSignal(client, { painSignalId: input.painSignalId, status: "VERIFIED", opportunityId: activation.opportunityId }, operatorId, now);
  return { opportunityId: activation.opportunityId, painSignalId: successor.id };
}

// ---------------------------------------------------------------------------------------------------------
// PURSUIT: activities, roles and staff requests

export interface ActivityWrite {
  readonly opportunityId: string;
  readonly activityType: ActivityType;
  readonly accessChannel: AccessChannel | null;
  readonly outcome: Outcome | null;
  readonly result: PursuitResult | null;
  /** Only YES when the person explicitly said they manage staffing vendors / subcontracted labor. */
  readonly handlesExternalWorkforce: HandlesExternalWorkforce;
  readonly contactCandidateId: string | null;
  readonly contactPersonId: string | null;
  readonly contactName: string | null;
  readonly contactTitle: string | null;
  readonly performedAt: string;
  readonly notes: string | null;
  readonly nextAction: string | null;
  readonly nextActionDue: string | null;
  readonly nextActionOwnerOperatorId: string | null;
  readonly offerHypothesis: OfferHypothesis | null;
  readonly offerNote: string | null;
  readonly referral: { readonly name: string | null; readonly title: string | null; readonly department: string | null; readonly phone: string | null; readonly email: string | null } | null;
}

const CI_CHANNEL: Record<AccessChannel, "PHONE" | "EMAIL" | "IN_PERSON" | "VIDEO" | "OTHER"> = {
  CALL: "PHONE", EMAIL: "EMAIL", MEETING: "IN_PERSON", JOBSITE_VISIT: "IN_PERSON", WORKER_REFERRAL: "OTHER", EXISTING_RELATIONSHIP: "OTHER",
  DISTRIBUTOR_REFERRAL: "OTHER", INBOUND: "OTHER", OTHER: "OTHER",
};
const NOT_REACHED: readonly Outcome[] = ["NO_ANSWER", "VOICEMAIL", "GATEKEEPER"];

async function loadActivities(client: SqlClient, opportunityId: string): Promise<ActivityView[]> {
  const rows = (await client.query<Record<string, unknown>>("select * from commercial_activities where opportunity_id=$1 order by performed_at, recorded_at, id", [opportunityId])).rows;
  return rows.map((r) => ({
    id: String(r.id), activityType: r.activity_type as ActivityType, accessChannel: (r.access_channel as AccessChannel | null) ?? null, outcome: (r.outcome as Outcome | null) ?? null,
    result: (r.result as PursuitResult | null) ?? null, handlesExternalWorkforce: r.handles_external_workforce as HandlesExternalWorkforce,
    performedAt: iso(r.performed_at as Date)!, recordedAt: iso(r.recorded_at as Date)!, nextAction: (r.next_action as string | null) ?? null, nextActionDue: day(r.next_action_due as Date | null),
    nextActionOwnerOperatorId: (r.next_action_owner_operator_id as string | null) ?? null, offerHypothesis: (r.offer_hypothesis as OfferHypothesis | null) ?? null,
    contactName: (r.contact_name_snapshot as string | null) ?? null, contactTitle: (r.contact_title_snapshot as string | null) ?? null,
    referredName: (r.referred_name as string | null) ?? null, referredTitle: (r.referred_title as string | null) ?? null, referredDepartment: (r.referred_department as string | null) ?? null,
    referredPhone: (r.referred_phone as string | null) ?? null, referredEmail: (r.referred_email as string | null) ?? null,
    staffRequestDemandSignalId: (r.staff_request_demand_signal_id as string | null) ?? null, contactCandidateId: (r.contact_candidate_id as string | null) ?? null,
    contactPersonId: (r.contact_person_id as string | null) ?? null, referredCandidateId: (r.referred_candidate_id as string | null) ?? null,
    contactInteractionId: (r.contact_interaction_id as string | null) ?? null, notes: (r.notes as string | null) ?? null, offerNote: (r.offer_note as string | null) ?? null,
    performedByOperatorId: String(r.performed_by_operator_id),
  }));
}

/** A person named by a human during an interaction enters Contact Intelligence as a candidate with human provenance. */
async function recordReferredCandidate(client: SqlClient, input: { readonly companyId: string; readonly companyName: string; readonly activityId: string; readonly referrer: string | null;
  readonly name: string; readonly title: string | null; readonly department: string | null; readonly phone: string | null; readonly email: string | null; readonly at: string; readonly operatorId: string }): Promise<string> {
  const investigation = await ensureInvestigation(client, { kind: "COMPANY", companyId: input.companyId }, input.operatorId);
  const type: OrganizationType = (investigation as { organization_type?: OrganizationType | null }).organization_type ?? classifyOrganization(input.companyName);
  const fn = matchBuyerFunction(input.title, type).fn;
  const basis = `Named by ${input.referrer ?? "a contact"} during a recorded commercial interaction on ${input.at.slice(0, 10)} (activity ${input.activityId}).`;
  const identity = createHash("sha256").update(`human-referral:${input.activityId}:${input.name.toLowerCase()}`).digest("hex");
  const row = (await client.query<{ id: string }>(
    `insert into contact_candidates(investigation_id,identity_key,kind,person_name,title,contact_function,organization,email,phone,phone_kind,source_url,provider,
       evidence_quote,attributed,attribution_basis,historical,person_key,source_type,source_date,evidence_currency,department)
     values($1,$2,'PERSON',$3,$4,$5::contact_function,$6,$7,$8,$9,$10,'HUMAN_INTERACTION',$11,true,$12,false,$13,'HUMAN_REFERRAL',$14::date,'CURRENT',$15)
     on conflict (investigation_id, identity_key) do nothing returning id`,
    [investigation.id, identity, input.name, input.title, fn?.contactFunction ?? "OTHER", input.companyName, clean(input.email), clean(input.phone), input.phone ? "UNKNOWN" : null,
      `urn:fly-workforce-radar:commercial-activity:${input.activityId}`, `${input.referrer ?? "Contact"} referred Fly to ${input.name}${input.title ? `, ${input.title}` : ""}${input.department ? ` (${input.department})` : ""}.`.slice(0, 600),
      basis.slice(0, 600), personKey(input.name, input.companyName), input.at.slice(0, 10), clean(input.department)])).rows[0];
  if (row) return row.id;
  return (await client.query<{ id: string }>("select id from contact_candidates where investigation_id=$1 and identity_key=$2", [investigation.id, identity])).rows[0].id;
}

export async function recordActivity(client: SqlClient, input: ActivityWrite, operatorId: string, options: { readonly staffRequestDemandSignalId?: string | null; readonly now?: Date } = {}):
  Promise<{ readonly id: string; readonly contactInteractionId: string | null; readonly referredCandidateId: string | null }> {
  const now = options.now ?? new Date();
  const activities = await loadActivities(client, input.opportunityId);
  const pipeline = derivePipeline({ activities, routeIdentified: false });
  const validation = validateActivity({ ...input, referredName: input.referral?.name ?? null, referredDepartment: input.referral?.department ?? null, hasStaffRequest: Boolean(options.staffRequestDemandSignalId) }, pipeline);
  // Humans record what already happened (same tolerance as Contact Intelligence interactions: today + 1 day).
  const errors = Date.parse(input.performedAt) > now.getTime() + 86400000 ? { ...validation, performedAt: "future" } : validation;
  if (Object.keys(errors).length) throw new PursuitValidationError(errors);
  const { companyId, companyName } = await opportunityCompany(client, input.opportunityId);
  const id = randomUUID();

  // Contact Intelligence feedback (existing rules): the interaction with the contacted person is CI evidence.
  let contactInteractionId: string | null = null;
  let contactName = clean(input.contactName);
  let contactTitle = clean(input.contactTitle);
  if (input.contactCandidateId) {
    const candidate = (await client.query<{ person_name: string | null; title: string | null }>("select person_name, title from contact_candidates where id=$1", [input.contactCandidateId])).rows[0];
    if (!candidate) throw new PursuitValidationError({ contactCandidateId: "notFound" });
    contactName ??= candidate.person_name; contactTitle ??= candidate.title;
    if (input.outcome && input.accessChannel) {
      const handles: HandlesExternalWorkforce = input.outcome === "WRONG_PERSON" ? "NO" : input.handlesExternalWorkforce;
      await recordInteraction(client, {
        candidateId: input.contactCandidateId, personReached: !NOT_REACHED.includes(input.outcome), contactDate: input.performedAt.slice(0, 10), channel: CI_CHANNEL[input.accessChannel],
        handlesExternalWorkforce: handles, referredTo: input.referral ? [input.referral.name, input.referral.title, input.referral.department].filter(Boolean).join(", ") || null : null,
        responsibleDepartment: clean(input.referral?.department), notes: [`Commercial activity ${input.outcome}`, clean(input.notes)].filter(Boolean).join(" — ").slice(0, 1000),
        nextAction: clean(input.nextAction), operatorId, companyId, opportunityId: input.opportunityId, now,
      });
      contactInteractionId = (await client.query<{ id: string }>("select id from contact_interactions where candidate_id=$1 order by recorded_at desc, id desc limit 1", [input.contactCandidateId])).rows[0]?.id ?? null;
    }
  }
  if (input.handlesExternalWorkforce === "YES" && !input.contactCandidateId && !input.contactPersonId) throw new PursuitValidationError({ handlesExternalWorkforce: "requiresIdentifiedContact" });

  let referredCandidateId: string | null = null;
  const referredName = clean(input.referral?.name);
  if (input.outcome === "REFERRED_TO_OTHER_PERSON" && referredName && companyId) {
    referredCandidateId = await recordReferredCandidate(client, { companyId, companyName: companyName ?? "", activityId: id, referrer: contactName, name: referredName,
      title: clean(input.referral?.title), department: clean(input.referral?.department), phone: clean(input.referral?.phone), email: clean(input.referral?.email), at: input.performedAt, operatorId });
  }

  await client.query(
    `insert into commercial_activities(id,opportunity_id,company_id,activity_type,access_channel,outcome,result,handles_external_workforce,contact_candidate_id,contact_person_id,
       contact_name_snapshot,contact_title_snapshot,performed_by_operator_id,performed_at,recorded_at,notes,next_action,next_action_due,next_action_owner_operator_id,
       offer_hypothesis,offer_note,referred_name,referred_title,referred_department,referred_phone,referred_email,referred_candidate_id,contact_interaction_id,staff_request_demand_signal_id)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::date,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
    [id, input.opportunityId, companyId, input.activityType, input.accessChannel, input.outcome, input.result, input.handlesExternalWorkforce, input.contactCandidateId,
      input.contactPersonId, contactName, contactTitle, operatorId, iso(input.performedAt), now.toISOString(), clean(input.notes), clean(input.nextAction), input.nextActionDue || null,
      input.nextActionOwnerOperatorId, input.offerHypothesis, clean(input.offerNote), referredName, clean(input.referral?.title), clean(input.referral?.department),
      clean(input.referral?.phone), clean(input.referral?.email), referredCandidateId, contactInteractionId, options.staffRequestDemandSignalId ?? null]);
  return { id, contactInteractionId, referredCandidateId };
}

export async function designateRole(client: SqlClient, input: { readonly opportunityId: string; readonly role: "PAIN_OWNER" | "COMMERCIAL_CONTACT"; readonly personName: string; readonly personTitle: string | null;
  readonly contactCandidateId: string | null; readonly contactPersonId: string | null; readonly basis: string; readonly sourceActivityId: string | null; readonly sourcePainSignalId: string | null },
  operatorId: string, now = new Date()): Promise<{ readonly id: string }> {
  const errors: Record<string, string> = {};
  if (!input.personName.trim()) errors.personName = "required";
  if (!input.basis.trim()) errors.basis = "required";
  if (Object.keys(errors).length) throw new PursuitValidationError(errors);
  await opportunityCompany(client, input.opportunityId);
  const id = randomUUID();
  await client.query(
    `insert into commercial_pursuit_roles(id,opportunity_id,role,person_name,person_title,contact_candidate_id,contact_person_id,basis,source_activity_id,source_pain_signal_id,recorded_by_operator_id,recorded_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, input.opportunityId, input.role, input.personName.trim(), clean(input.personTitle), input.contactCandidateId, input.contactPersonId, input.basis.trim(),
      input.sourceActivityId, input.sourcePainSignalId, operatorId, now.toISOString()]);
  return { id };
}

export interface StaffRequestInput {
  readonly opportunityId: string;
  readonly receivedAt: string;
  readonly accessChannel: AccessChannel;
  readonly contactCandidateId: string | null;
  readonly contactName: string | null;
  readonly contactTitle: string | null;
  readonly tradeCode: string | null;
  readonly occupationCode: string | null;
  readonly level: string | null;
  readonly headcount: number | null;
  readonly specialty: string | null;
  readonly projectSite: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly startDate: string | null;
  readonly expectedEndDate: string | null;
  readonly durationText: string | null;
  readonly schedule: string | null;
  readonly shift: string | null;
  readonly minimumExperienceMonths: number | null;
  readonly requiredCredentials: readonly string[];
  readonly preferredCredentials: readonly string[];
  readonly requiredSkills: readonly string[];
  readonly payRateMin: number | null;
  readonly payRateMax: number | null;
  readonly payPeriod: string | null;
  readonly billRate: number | null;
  readonly perDiemAvailable: boolean | null;
  readonly perDiemAmount: number | null;
  readonly travelRequired: boolean | null;
  readonly additionalRequirements: string | null;
  readonly notes: string | null;
  readonly nextAction: string;
  readonly nextActionDue: string;
  readonly nextActionOwnerOperatorId: string;
}

/** Fields the requester did not state stay null and are listed as UNKNOWN — never filled in. */
export const STAFF_REQUEST_FIELDS = ["tradeCode", "occupationCode", "level", "headcount", "specialty", "projectSite", "city", "startDate", "durationText", "schedule",
  "minimumExperienceMonths", "requiredCredentials", "preferredCredentials", "payRate", "billRate", "perDiem", "travelRequired", "additionalRequirements"] as const;
export function unknownStaffRequestFields(input: StaffRequestInput): readonly string[] {
  const known: Record<(typeof STAFF_REQUEST_FIELDS)[number], boolean> = {
    tradeCode: Boolean(input.tradeCode), occupationCode: Boolean(input.occupationCode), level: Boolean(input.level), headcount: input.headcount !== null, specialty: Boolean(input.specialty),
    projectSite: Boolean(input.projectSite), city: Boolean(input.city), startDate: Boolean(input.startDate), durationText: Boolean(input.durationText || input.expectedEndDate),
    schedule: Boolean(input.schedule || input.shift), minimumExperienceMonths: input.minimumExperienceMonths !== null, requiredCredentials: input.requiredCredentials.length > 0,
    preferredCredentials: input.preferredCredentials.length > 0, payRate: input.payRateMin !== null || input.payRateMax !== null, billRate: input.billRate !== null,
    perDiem: input.perDiemAvailable !== null, travelRequired: input.travelRequired !== null, additionalRequirements: Boolean(input.additionalRequirements),
  };
  return STAFF_REQUEST_FIELDS.filter((field) => !known[field]);
}

/**
 * An explicit request for people becomes a demand signal on the opportunity (publisher_type STAFF_REQUEST), so the
 * existing matching engine can be run against it unchanged, plus the human activity that received it.
 */
export async function recordStaffRequest(client: SqlClient, input: StaffRequestInput, operatorId: string, now = new Date()): Promise<{ readonly demandSignalId: string; readonly activityId: string; readonly unknownFields: readonly string[] }> {
  const errors: Record<string, string> = {};
  if (input.headcount !== null && (!Number.isInteger(input.headcount) || input.headcount < 1)) errors.headcount = "positiveInteger";
  // Postgres accepts NaN in numeric columns; a malformed number must never be stored as a value.
  for (const [name, value] of [["minimumExperienceMonths", input.minimumExperienceMonths], ["payRateMin", input.payRateMin], ["payRateMax", input.payRateMax], ["billRate", input.billRate], ["perDiemAmount", input.perDiemAmount]] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) errors[name] = "nonNegativeNumber";
  }
  if (input.occupationCode && !input.tradeCode) errors.tradeCode = "requiredWithOccupation";
  if (input.minimumExperienceMonths !== null && input.minimumExperienceMonths < 0) errors.minimumExperienceMonths = "nonNegativeInteger";
  if (input.payRateMin !== null && input.payRateMax !== null && input.payRateMax < input.payRateMin) errors.payRateMax = "lessThanMin";
  if (input.startDate && input.expectedEndDate && input.expectedEndDate < input.startDate) errors.expectedEndDate = "beforeStart";
  if (Number.isNaN(Date.parse(input.receivedAt))) errors.receivedAt = "invalidDate";
  else if (Date.parse(input.receivedAt) > now.getTime() + 86400000) errors.receivedAt = "future";
  if (Object.keys(errors).length) throw new PursuitValidationError(errors);
  const { companyId, companyName, title } = await opportunityCompany(client, input.opportunityId);
  const activityId = randomUUID();
  const unknownFields = unknownStaffRequestFields(input);
  const rawEvidenceId = await captureManualEvidence(client, { kind: "staff-request", reference: activityId, operatorId, at: now, payload: { staffRequest: input, unknownFields } });
  const received = new Date(input.receivedAt);
  const requestTitle = `Staff request — ${[input.headcount ? `${input.headcount} ×` : null, input.level, input.occupationCode ?? input.tradeCode ?? "role not stated"].filter(Boolean).join(" ")}`;
  const demand = (await client.query<{ id: string }>(
    `insert into demand_signals(title,original_title,role_type,publisher_company_id,unresolved_publisher_name,publisher_type,city,state,schedule,shift,headcount_estimate,
       published_at,first_seen_at,last_seen_at,stale_after,source_id,raw_evidence_id,source_identity_key,parser_version,trade_code,occupation_code,minimum_experience_months,
       start_date,expected_end_date,duration_text,base_pay_min,base_pay_max,pay_period,per_diem_available,per_diem_amount,travel_required,demand_status,verification_state,
       normalized_metadata,unresolved_project_context)
     values($1,$1,'OTHER',$2,$3,'STAFF_REQUEST',$4,$5,$6,$7,$8,$9,$9,$9,$10,(select source_id from raw_evidence where id=$11),$11,$12,$13,$14,$15,$16,$17::date,$18::date,$19,$20,$21,$22,
       $23,$24,$25,'CURRENT','UNVERIFIED',$26::jsonb,$27) returning id`,
    [requestTitle.slice(0, 300), companyId, companyId ? null : companyName ?? title, clean(input.city), clean(input.state), clean(input.schedule), clean(input.shift), input.headcount,
      received.toISOString(), new Date(received.getTime() + 90 * 86400000).toISOString(), rawEvidenceId, `staff-request:${activityId}`, EXTRACTOR_VERSION,
      clean(input.tradeCode), clean(input.occupationCode), input.minimumExperienceMonths, input.startDate || null, input.expectedEndDate || null, clean(input.durationText),
      input.payRateMin, input.payRateMax, clean(input.payPeriod), input.perDiemAvailable, input.perDiemAmount, input.travelRequired,
      JSON.stringify({ kind: "STAFF_REQUEST", level: clean(input.level), specialty: clean(input.specialty), billRate: input.billRate, additionalRequirements: clean(input.additionalRequirements),
        requestingContact: { candidateId: input.contactCandidateId, name: clean(input.contactName), title: clean(input.contactTitle) }, receivedAt: received.toISOString(),
        accessChannel: input.accessChannel, activityId, unknownFields }), clean(input.projectSite)])).rows[0];
  const evidence = new PostgresEvidenceRepository(client);
  await evidence.link(rawEvidenceId, { kind: "DEMAND_SIGNAL", id: demand.id }, "DERIVED_FROM");
  await evidence.link(rawEvidenceId, { kind: "OPPORTUNITY", id: input.opportunityId }, "SUPPORTS");
  await new PostgresDemandRequirementRepository(client).setDemandRequirements({
    demandSignalId: demand.id,
    skills: input.requiredSkills.map((code) => ({ skillCode: code, requirementLevel: "REQUIRED" as const, sourceLabel: "Staff request", rawEvidenceId })),
    credentials: [...input.requiredCredentials.map((code) => ({ credentialCode: code, requirementLevel: "REQUIRED" as const })), ...input.preferredCredentials.map((code) => ({ credentialCode: code, requirementLevel: "PREFERRED" as const }))]
      .map((item) => ({ ...item, sourceRequirementText: "Staff request", rawEvidenceId })),
  });
  await client.query("insert into opportunity_demand_signals(opportunity_id, demand_signal_id) values($1,$2) on conflict do nothing", [input.opportunityId, demand.id]);
  await recordActivity(client, {
    opportunityId: input.opportunityId, activityType: "STAFF_REQUEST_RECEIVED", accessChannel: input.accessChannel, outcome: null, result: null, handlesExternalWorkforce: "UNKNOWN",
    contactCandidateId: input.contactCandidateId, contactPersonId: null, contactName: input.contactName, contactTitle: input.contactTitle, performedAt: received.toISOString(), notes: input.notes,
    nextAction: input.nextAction, nextActionDue: input.nextActionDue, nextActionOwnerOperatorId: input.nextActionOwnerOperatorId, offerHypothesis: null, offerNote: null, referral: null,
  }, operatorId, { staffRequestDemandSignalId: demand.id, now });
  const activity = (await client.query<{ id: string }>("select id from commercial_activities where staff_request_demand_signal_id=$1", [demand.id])).rows[0];
  return { demandSignalId: demand.id, activityId: activity.id, unknownFields };
}

// ---------------------------------------------------------------------------------------------------------
// Read models

export interface ActivityView extends ActivityRecord {
  readonly contactTitle: string | null; readonly referredTitle: string | null; readonly referredPhone: string | null; readonly referredEmail: string | null;
  readonly contactCandidateId: string | null; readonly contactPersonId: string | null; readonly referredCandidateId: string | null; readonly contactInteractionId: string | null;
  readonly notes: string | null; readonly offerNote: string | null; readonly performedByOperatorId: string;
}
export interface PainSignalView extends PainSignalRecord { readonly opportunityId: string | null; readonly companyId: string | null; readonly siteText: string | null; readonly city: string | null;
  readonly state: string | null; readonly neededHeadcount: number | null; readonly neededRoleText: string | null; readonly rawEvidenceId: string; readonly usableCommercially: boolean; readonly mayNameWorkerToProspect: boolean }
export interface RoleView { readonly id: string; readonly role: "PAIN_OWNER" | "COMMERCIAL_CONTACT"; readonly personName: string; readonly personTitle: string | null; readonly basis: string;
  readonly contactCandidateId: string | null; readonly recordedAt: string }
export interface StaffRequestView {
  readonly demandSignalId: string; readonly title: string; readonly tradeCode: string | null; readonly occupationCode: string | null; readonly headcount: number | null; readonly city: string | null;
  readonly state: string | null; readonly projectSite: string | null; readonly startDate: string | null; readonly expectedEndDate: string | null; readonly durationText: string | null;
  readonly schedule: string | null; readonly shift: string | null; readonly minimumExperienceMonths: number | null; readonly payRateMin: number | null; readonly payRateMax: number | null;
  readonly payPeriod: string | null; readonly perDiemAvailable: boolean | null; readonly perDiemAmount: number | null; readonly travelRequired: boolean | null;
  readonly metadata: Readonly<Record<string, unknown>>; readonly credentials: readonly { readonly code: string; readonly level: string }[]; readonly skills: readonly { readonly code: string; readonly level: string }[];
  readonly unknownFields: readonly string[]; readonly matchCounts: DemandMatchCounts | null; readonly receivedAt: string | null;
}
export interface ReferralLink { readonly activityId: string; readonly at: string; readonly from: string | null; readonly toName: string | null; readonly toTitle: string | null; readonly toDepartment: string | null; readonly referredCandidateId: string | null }
export interface PursuitView {
  readonly opportunity: { readonly id: string; readonly title: string | null; readonly lifecycle: string; readonly companyId: string | null; readonly companyName: string | null; readonly origin: string | null };
  readonly pipeline: PipelineState;
  readonly nextAction: NextActionState | null;
  readonly activities: readonly ActivityView[];
  readonly painSignals: readonly PainSignalView[];
  readonly painHistory: number;
  readonly roles: { readonly painOwner: RoleView | null; readonly commercialContact: RoleView | null; readonly history: readonly RoleView[] };
  readonly staffRequests: readonly StaffRequestView[];
  readonly demandSignalCount: number;
  readonly route: ActionableRoute | null;
  readonly contactOptions: readonly { readonly candidateId: string; readonly label: string; readonly kind: "PERSON" | "CHANNEL" }[];
  readonly referralChain: readonly ReferralLink[];
  readonly pain: PainSummary; readonly access: AccessSummary; readonly fit: FitSummary; readonly truth: CommercialTruth;
}

async function loadPainSignals(client: SqlClient, where: { readonly opportunityId?: string; readonly companyId?: string | null }): Promise<{ readonly current: PainSignalView[]; readonly total: number }> {
  const rows = (await client.query<Record<string, unknown>>(
    `select * from commercial_pain_signals where ($1::uuid is not null and opportunity_id=$1) or ($2::uuid is not null and company_id=$2) order by recorded_at, id`,
    [where.opportunityId ?? null, where.companyId ?? null])).rows;
  // Supersession chains may move from company-level to opportunity-level; resolve over the whole chain set.
  const all = rows.map((r): PainSignalView => {
    const base = {
      id: String(r.id), painType: r.pain_type as PainType, assertionBasis: r.assertion_basis as AssertionBasis, status: r.status as PainStatus, confidence: r.confidence as Confidence,
      summary: String(r.summary), sourceKind: r.source_kind as PainSourceKind, sourceUrl: (r.source_url as string | null) ?? null, observedAt: iso(r.observed_at as Date | null),
      recordedAt: iso(r.recorded_at as Date)!, supersedesId: (r.supersedes_id as string | null) ?? null, reportedByWorkerId: (r.reported_by_worker_id as string | null) ?? null,
      consentUseIntelligence: (r.consent_use_intelligence as boolean | null) ?? null, consentIdentifyWorker: (r.consent_identify_worker as boolean | null) ?? null,
      supervisorName: (r.supervisor_name as string | null) ?? null, supervisorTitle: (r.supervisor_title as string | null) ?? null,
    };
    const visibility = referralVisibility(base);
    return { ...base, opportunityId: (r.opportunity_id as string | null) ?? null, companyId: (r.company_id as string | null) ?? null, siteText: (r.site_text as string | null) ?? null,
      city: (r.city as string | null) ?? null, state: (r.state as string | null) ?? null, neededHeadcount: (r.needed_headcount as number | null) ?? null,
      neededRoleText: (r.needed_role_text as string | null) ?? null, rawEvidenceId: String(r.raw_evidence_id), ...visibility };
  });
  return { current: [...currentPainSignals(all)], total: all.length };
}

async function loadStaffRequests(client: SqlClient, opportunityId: string): Promise<StaffRequestView[]> {
  const rows = (await client.query<Record<string, unknown>>(
    `select d.* from demand_signals d join opportunity_demand_signals ods on ods.demand_signal_id=d.id where ods.opportunity_id=$1 and d.publisher_type='STAFF_REQUEST' order by d.first_seen_at, d.id`,
    [opportunityId])).rows;
  const out: StaffRequestView[] = [];
  for (const r of rows) {
    const id = String(r.id);
    // SqlClient may wrap a single transactional pg client; keep its queries sequential (pg 9 removes concurrent calls).
    const credentials = await client.query<{ code: string; level: string }>("select credential_code as code, requirement_level as level from demand_credential_requirements where demand_signal_id=$1 order by 2, 1", [id]);
    const skills = await client.query<{ code: string; level: string }>("select skill_code as code, requirement_level as level from demand_skill_requirements where demand_signal_id=$1 order by 2, 1", [id]);
    const results = await client.query<{ outcome: string; n: string }>("select outcome, count(*) n from worker_demand_match_results where demand_signal_id=$1 and superseded_at is null group by outcome", [id]);
    const counts = results.rows.length ? { STRONG_MATCH: 0, POSSIBLE_MATCH: 0, NO_MATCH: 0, INSUFFICIENT_DATA: 0, ...Object.fromEntries(results.rows.map((x) => [x.outcome, Number(x.n)])) } as DemandMatchCounts : null;
    const metadata = (r.normalized_metadata as Record<string, unknown>) ?? {};
    out.push({
      demandSignalId: id, title: String(r.title), tradeCode: (r.trade_code as string | null) ?? null, occupationCode: (r.occupation_code as string | null) ?? null,
      headcount: (r.headcount_estimate as number | null) ?? null, city: (r.city as string | null) ?? null, state: (r.state as string | null) ?? null,
      projectSite: (r.unresolved_project_context as string | null) ?? null, startDate: day(r.start_date as Date | null), expectedEndDate: day(r.expected_end_date as Date | null),
      durationText: (r.duration_text as string | null) ?? null, schedule: (r.schedule as string | null) ?? null, shift: (r.shift as string | null) ?? null,
      minimumExperienceMonths: (r.minimum_experience_months as number | null) ?? null, payRateMin: r.base_pay_min === null ? null : Number(r.base_pay_min),
      payRateMax: r.base_pay_max === null ? null : Number(r.base_pay_max), payPeriod: (r.pay_period as string | null) ?? null, perDiemAvailable: (r.per_diem_available as boolean | null) ?? null,
      perDiemAmount: r.per_diem_amount === null ? null : Number(r.per_diem_amount), travelRequired: (r.travel_required as boolean | null) ?? null, metadata,
      credentials: credentials.rows, skills: skills.rows, unknownFields: (metadata.unknownFields as string[] | undefined) ?? [], matchCounts: counts,
      receivedAt: (metadata.receivedAt as string | undefined) ?? null,
    });
  }
  return out;
}

export async function loadPursuit(client: SqlClient, opportunityId: string, today: string): Promise<PursuitView | null> {
  const opportunity = (await client.query<{ id: string; title: string | null; lifecycle: string; opportunity_metadata: Record<string, unknown> }>(
    "select id, title, lifecycle::text as lifecycle, opportunity_metadata from opportunities where id=$1", [opportunityId])).rows[0];
  if (!opportunity) return null;
  const { companyId, companyName } = await opportunityCompany(client, opportunityId);
  // These reads can share one transaction-bound pg client, so they must remain sequential.
  const activities = await loadActivities(client, opportunityId);
  const pains = await loadPainSignals(client, { opportunityId, companyId });
  const roleRows = await client.query<Record<string, unknown>>("select * from commercial_pursuit_roles where opportunity_id=$1 order by recorded_at, id", [opportunityId]);
  const staffRequests = await loadStaffRequests(client, opportunityId);
  const demandCount = await client.query<{ n: string }>(`select count(*) n from demand_signals d join opportunity_demand_signals ods on ods.demand_signal_id=d.id
      where ods.opportunity_id=$1 and d.publisher_type is distinct from 'STAFF_REQUEST'`, [opportunityId]);
  const ci = companyId ? await loadBuyerInvestigation(client, { kind: "COMPANY", companyId }).catch(() => null) : null;
  const route = ci?.investigation ? ci.route : null;
  const roles: RoleView[] = roleRows.rows.map((r) => ({ id: String(r.id), role: r.role as RoleView["role"], personName: String(r.person_name), personTitle: (r.person_title as string | null) ?? null,
    basis: String(r.basis), contactCandidateId: (r.contact_candidate_id as string | null) ?? null, recordedAt: iso(r.recorded_at as Date)! }));
  const latest = (role: RoleView["role"]) => [...roles].reverse().find((r) => r.role === role) ?? null;
  const pipeline = derivePipeline({ activities, routeIdentified: Boolean(route && (route.person || route.phone)) });
  const pain = painSummary(pains.current);
  return {
    opportunity: { id: opportunity.id, title: opportunity.title, lifecycle: opportunity.lifecycle, companyId, companyName, origin: (opportunity.opportunity_metadata?.origin as string | undefined) ?? null },
    pipeline, nextAction: currentNextAction(activities, today), activities, painSignals: pains.current, painHistory: pains.total,
    roles: { painOwner: latest("PAIN_OWNER"), commercialContact: latest("COMMERCIAL_CONTACT"), history: roles },
    staffRequests, demandSignalCount: Number(demandCount.rows[0]?.n ?? 0), route,
    contactOptions: ci ? [
      ...[...ci.people, ...ci.otherPeople].map((p) => ({ candidateId: p.primaryCandidateId, label: `${p.name}${p.title ? ` — ${p.title}` : ""}`, kind: "PERSON" as const })),
      ...ci.channels.filter((c) => c.kind === "PHONE_ROUTE").map((c) => ({ candidateId: c.candidateId, label: `${c.value}${c.label ? ` — ${c.label}` : ""}`, kind: "CHANNEL" as const })),
    ] : [],
    referralChain: activities.filter((a) => a.outcome === "REFERRED_TO_OTHER_PERSON").map((a) => ({ activityId: a.id, at: a.performedAt, from: a.contactName, toName: a.referredName,
      toTitle: a.referredTitle, toDepartment: a.referredDepartment, referredCandidateId: a.referredCandidateId })),
    pain, access: accessSummary({ route, commercialContactNamed: Boolean(latest("COMMERCIAL_CONTACT")), activities,
      usableWorkerReferral: pains.current.some((p) => p.painType === "WORKER_REFERRAL" && p.usableCommercially) }),
    fit: fitSummary(staffRequests.map((s) => ({ headcount: s.headcount, counts: s.matchCounts }))),
    truth: commercialTruth({ painUsable: pain.usable, demandSignals: Number(demandCount.rows[0]?.n ?? 0), activities }),
  };
}

export interface PursuitListItem { readonly opportunityId: string; readonly title: string | null; readonly companyName: string | null; readonly pipeline: PipelineState; readonly nextAction: NextActionState | null; readonly lastActivityAt: string }
export async function listPursuits(client: SqlClient, today: string, windowDays = 30): Promise<{ readonly items: readonly PursuitListItem[]; readonly learning: LearningCounts; readonly window: { readonly from: string; readonly to: string } }> {
  const ids = (await client.query<{ opportunity_id: string }>("select distinct opportunity_id from commercial_activities")).rows.map((r) => r.opportunity_id);
  const items: PursuitListItem[] = [];
  const pursuits: { activities: ActivityView[] }[] = [];
  for (const id of ids) {
    const view = await loadPursuit(client, id, today);
    if (!view) continue;
    const activities = [...view.activities];
    const { companyName, title } = view.opportunity;
    pursuits.push({ activities });
    items.push({ opportunityId: id, title, companyName, pipeline: view.pipeline, nextAction: view.nextAction,
      lastActivityAt: activities[activities.length - 1]?.performedAt ?? "" });
  }
  items.sort((a, b) => Number(Boolean(b.nextAction?.overdue)) - Number(Boolean(a.nextAction?.overdue)) || (a.nextAction?.due ?? "9999").localeCompare(b.nextAction?.due ?? "9999"));
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (windowDays - 1) * 86400000).toISOString().slice(0, 10);
  return { items, learning: learningCounts(pursuits, { from, to: today }, today), window: { from, to: today } };
}

export async function loadCompanyCommercial(client: SqlClient, companyId: string, today: string): Promise<{ readonly painSignals: readonly PainSignalView[]; readonly pain: PainSummary;
  readonly opportunities: readonly { readonly id: string; readonly title: string | null; readonly pipeline: PipelineState; readonly nextAction: NextActionState | null }[] }> {
  const pains = await loadPainSignals(client, { companyId });
  const opportunityIds = (await client.query<{ opportunity_id: string; title: string | null }>(
    "select oc.opportunity_id, o.title from opportunity_companies oc join opportunities o on o.id=oc.opportunity_id where oc.company_id=$1 order by o.created_at desc", [companyId])).rows;
  const opportunities = [];
  for (const row of opportunityIds) {
    const view = await loadPursuit(client, row.opportunity_id, today);
    if (view) opportunities.push({ id: row.opportunity_id, title: row.title, pipeline: view.pipeline, nextAction: view.nextAction });
  }
  return { painSignals: pains.current, pain: painSummary(pains.current), opportunities };
}
