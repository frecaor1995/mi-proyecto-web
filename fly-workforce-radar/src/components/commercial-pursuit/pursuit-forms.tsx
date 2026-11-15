"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "../../i18n/locale";
import {
  designateRoleAction, promotePainSignalAction, recordActivityAction, recordPainSignalAction, recordStaffRequestAction, reviewPainSignalAction, type PursuitActionState,
} from "../../server/commercial-pursuit/actions";
import { runOpportunityWorkforceMatchingAction, type WorkforceMatchingActionState } from "../../server/opportunity-detail/workforce-matching-actions";
import { pursuitCopy } from "./pursuit-copy";

const INITIAL: PursuitActionState = { state: "IDLE", errors: {} };
const ACTIVITY_TYPES = ["OUTREACH", "MEETING", "FOLLOW_UP", "PROPOSAL_SENT", "CANDIDATES_PRESENTED", "NEXT_ACTION_UPDATE", "NOTE", "RESULT"] as const;
const CHANNELS = ["CALL", "EMAIL", "WORKER_REFERRAL", "EXISTING_RELATIONSHIP", "JOBSITE_VISIT", "DISTRIBUTOR_REFERRAL", "INBOUND", "MEETING", "OTHER"] as const;
const OUTCOMES = ["NO_ANSWER", "VOICEMAIL", "GATEKEEPER", "WRONG_PERSON", "REFERRED_TO_OTHER_PERSON", "CALL_BACK", "CONVERSATION", "ACCEPTS_EXTERNAL_LABOR",
  "DOES_NOT_ACCEPT_EXTERNAL_LABOR", "NO_CURRENT_NEED", "VENDOR_REGISTRATION_REQUIRED", "NOT_INTERESTED", "OTHER"] as const;
const OFFERS = ["STAFFING_SUBCONTRACTOR", "ABSENCE_COVERAGE", "SMALL_TRIAL_CREW", "TEMP_TO_HIRE", "EVALUATED_ELECTRICIANS", "BILINGUAL_CREW", "OTHER"] as const;
const PAIN_TYPES = ["OPEN_ROLES_PERSISTENT", "JOB_REPOSTED", "STAFFING_AGENCY_BACKLOG", "WORKFORCE_EXIT", "PROJECT_LOAD", "PERMIT_LOAD", "ABSENCE_COVERAGE", "INBOUND_REQUEST", "OTHER", "UNKNOWN"] as const;

export interface Option { readonly id: string; readonly label: string }
export interface ContactOption { readonly candidateId: string; readonly label: string; readonly kind: "PERSON" | "CHANNEL" }

function useSaved(result: PursuitActionState) {
  const router = useRouter();
  useEffect(() => { if (result.state === "DONE") { if (result.href) router.push(result.href); else router.refresh(); } }, [result, router]);
}
function Status({ locale, result }: { readonly locale: Locale; readonly result: PursuitActionState }) {
  const c = pursuitCopy(locale);
  if (result.state === "IDLE") return null;
  const detail = Object.entries(result.errors).filter(([, v]) => v !== "ok").map(([k, v]) => `${c.field[k] ?? k}: ${c.errors[v] ?? v}`).join(" · ");
  return <p role="status" className={result.state === "DONE" ? "dr-run-ok" : "dr-run-warn"}>{c.formResult[result.state]}{detail ? ` ${detail}` : ""}</p>;
}
const Field = ({ label, children, error }: { readonly label: string; readonly children: ReactNode; readonly error?: string | null }) =>
  <label className="by-field"><span>{label}</span>{children}{error ? <small className="ci-status-requires_confirmation">{error}</small> : null}</label>;
const err = (locale: Locale, result: PursuitActionState, name: string) => { const e = result.errors[name]; return e && e !== "ok" ? pursuitCopy(locale).errors[e] ?? e : null; };
const today = () => new Date().toISOString().slice(0, 10);

function NextActionFields({ locale, operators, defaultOwner, result, required }: { readonly locale: Locale; readonly operators: readonly Option[]; readonly defaultOwner: string; readonly result: PursuitActionState; readonly required: boolean }) {
  const f = pursuitCopy(locale).field;
  return (
    <fieldset className="by-functions"><legend>{f.nextAction}</legend>
      <Field label={f.nextAction} error={err(locale, result, "nextAction")}><input name="nextAction" maxLength={500} required={required} /></Field>
      <Field label={f.nextActionDue} error={err(locale, result, "nextActionDue")}><input name="nextActionDue" type="date" required={required} /></Field>
      <Field label={f.nextActionOwner} error={err(locale, result, "nextActionOwner")}>
        <select name="nextActionOwner" defaultValue={defaultOwner}>{operators.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      </Field>
    </fieldset>
  );
}

function ContactSelect({ locale, contacts, name = "contactCandidateId" }: { readonly locale: Locale; readonly contacts: readonly ContactOption[]; readonly name?: string }) {
  const c = pursuitCopy(locale);
  return <select name={name} defaultValue=""><option value="">{c.choose}</option>{contacts.map((o) => <option key={o.candidateId} value={o.candidateId}>{o.label}</option>)}</select>;
}

export function ActivityForm({ locale, opportunityId, contacts, operators, defaultOwner, start }: {
  readonly locale: Locale; readonly opportunityId: string; readonly contacts: readonly ContactOption[]; readonly operators: readonly Option[]; readonly defaultOwner: string; readonly start: boolean;
}) {
  const c = pursuitCopy(locale);
  const [result, action, pending] = useActionState(recordActivityAction, INITIAL);
  useSaved(result);
  return (
    <form action={action} className="by-settings">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      {start ? <input type="hidden" name="activityType" value="PURSUIT_STARTED" /> : (
        <Field label={c.field.activityType} error={err(locale, result, "activityType")}>
          <select name="activityType" defaultValue="OUTREACH">{ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{c.activityTypes[t]}</option>)}</select>
        </Field>
      )}
      {start ? null : <>
        <Field label={c.field.channel} error={err(locale, result, "accessChannel")}><select name="accessChannel" defaultValue=""><option value="">{c.choose}</option>{CHANNELS.map((t) => <option key={t} value={t}>{c.channels[t]}</option>)}</select></Field>
        <Field label={c.field.outcome} error={err(locale, result, "outcome")}><select name="outcome" defaultValue=""><option value="">{c.choose}</option>{OUTCOMES.map((t) => <option key={t} value={t}>{c.outcomes[t]}</option>)}</select></Field>
        <Field label={c.field.result} error={err(locale, result, "result")}><select name="result" defaultValue=""><option value="">{c.choose}</option>{(["WON", "LOST", "NO_DECISION"] as const).map((t) => <option key={t} value={t}>{c.results[t]}</option>)}</select></Field>
        <Field label={c.field.contact} error={err(locale, result, "contactCandidateId")}><ContactSelect locale={locale} contacts={contacts} /></Field>
        <Field label={c.field.contactName}><input name="contactName" maxLength={200} /></Field>
        <Field label={c.field.contactTitle}><input name="contactTitle" maxLength={200} /></Field>
        <Field label={c.field.performedAt} error={err(locale, result, "performedAt")}><input name="performedAt" type="date" defaultValue={today()} max={today()} /></Field>
        <Field label={c.field.handles} error={err(locale, result, "handlesExternalWorkforce")}>
          <select name="handlesExternalWorkforce" defaultValue="UNKNOWN"><option value="UNKNOWN">{c.unknownOption}</option><option value="YES">{c.yes}</option><option value="NO">{c.no}</option></select>
        </Field>
        <fieldset className="by-functions"><legend>{c.outcomes.REFERRED_TO_OTHER_PERSON}</legend>
          <Field label={c.field.referredName} error={err(locale, result, "referredName")}><input name="referredName" maxLength={200} /></Field>
          <Field label={c.field.referredTitle}><input name="referredTitle" maxLength={200} /></Field>
          <Field label={c.field.referredDepartment}><input name="referredDepartment" maxLength={200} /></Field>
          <Field label={c.field.referredPhone}><input name="referredPhone" maxLength={40} inputMode="tel" /></Field>
          <Field label={c.field.referredEmail}><input name="referredEmail" type="email" maxLength={254} /></Field>
        </fieldset>
      </>}
      <Field label={c.field.offer}><select name="offerHypothesis" defaultValue=""><option value="">{c.choose}</option>{OFFERS.map((t) => <option key={t} value={t}>{c.offers[t]}</option>)}</select><small>{c.offerNote}</small></Field>
      <Field label={c.field.offerNote}><input name="offerNote" maxLength={1000} /></Field>
      <Field label={c.field.notes}><textarea name="notes" maxLength={4000} rows={3} /></Field>
      <NextActionFields locale={locale} operators={operators} defaultOwner={defaultOwner} result={result} required={start} />
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? c.saving : start ? c.startPursuit : c.recordActivity}</button>
      <Status locale={locale} result={result} />
    </form>
  );
}

export function RoleForm({ locale, opportunityId, contacts }: { readonly locale: Locale; readonly opportunityId: string; readonly contacts: readonly ContactOption[] }) {
  const c = pursuitCopy(locale);
  const [result, action, pending] = useActionState(designateRoleAction, INITIAL);
  useSaved(result);
  return (
    <form action={action} className="by-settings">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <Field label={c.field.role}><select name="role" defaultValue="PAIN_OWNER"><option value="PAIN_OWNER">{c.painOwner}</option><option value="COMMERCIAL_CONTACT">{c.commercialContact}</option></select></Field>
      <Field label={c.field.contact}><ContactSelect locale={locale} contacts={contacts.filter((o) => o.kind === "PERSON")} /></Field>
      <Field label={c.field.personName} error={err(locale, result, "personName")}><input name="personName" maxLength={200} required /></Field>
      <Field label={c.field.personTitle}><input name="personTitle" maxLength={200} /></Field>
      <Field label={c.field.basis} error={err(locale, result, "basis")}><input name="basis" maxLength={600} required /></Field>
      <button className="button button-secondary" type="submit" disabled={pending}>{pending ? c.saving : c.designate}</button>
      <Status locale={locale} result={result} />
    </form>
  );
}

const TriSelect = ({ locale, name }: { readonly locale: Locale; readonly name: string }) => {
  const c = pursuitCopy(locale);
  return <select name={name} defaultValue=""><option value="">{c.unknownOption}</option><option value="yes">{c.yes}</option><option value="no">{c.no}</option></select>;
};

export function StaffRequestForm({ locale, opportunityId, contacts, operators, defaultOwner }: {
  readonly locale: Locale; readonly opportunityId: string; readonly contacts: readonly ContactOption[]; readonly operators: readonly Option[]; readonly defaultOwner: string;
}) {
  const c = pursuitCopy(locale);
  const f = c.field;
  const [result, action, pending] = useActionState(recordStaffRequestAction, INITIAL);
  useSaved(result);
  const text = (name: string, max = 200, type = "text") => <Field key={name} label={f[name]} error={err(locale, result, name)}><input name={name} type={type} maxLength={max} /></Field>;
  return (
    <form action={action} className="by-settings">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <p className="dr-card-note">{c.noStaffRequest}</p>
      <Field label={f.channel} error={err(locale, result, "accessChannel")}><select name="accessChannel" defaultValue="CALL">{CHANNELS.map((t) => <option key={t} value={t}>{c.channels[t]}</option>)}</select></Field>
      <Field label={f.receivedAt} error={err(locale, result, "receivedAt")}><input name="receivedAt" type="date" defaultValue={today()} max={today()} /></Field>
      <Field label={f.contact}><ContactSelect locale={locale} contacts={contacts.filter((o) => o.kind === "PERSON")} /></Field>
      {text("contactName")}{text("contactTitle")}
      {text("tradeCode", 60)}{text("occupationCode", 60)}{text("level", 80)}{text("headcount", 6, "number")}{text("specialty")}{text("projectSite", 300)}{text("city", 120)}{text("state", 40)}
      {text("startDate", 10, "date")}{text("expectedEndDate", 10, "date")}{text("durationText", 120)}{text("schedule", 120)}{text("shift", 80)}{text("minimumExperienceMonths", 4, "number")}
      {text("requiredCredentials", 400)}{text("preferredCredentials", 400)}{text("requiredSkills", 400)}
      {text("payRateMin", 12, "number")}{text("payRateMax", 12, "number")}{text("payPeriod", 20)}{text("billRate", 12, "number")}
      <Field label={f.perDiemAvailable}><TriSelect locale={locale} name="perDiemAvailable" /></Field>{text("perDiemAmount", 12, "number")}
      <Field label={f.travelRequired}><TriSelect locale={locale} name="travelRequired" /></Field>
      {text("additionalRequirements", 1000)}
      <Field label={f.notes}><textarea name="notes" maxLength={4000} rows={2} /></Field>
      <NextActionFields locale={locale} operators={operators} defaultOwner={defaultOwner} result={result} required />
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? c.saving : c.recordStaffRequest}</button>
      <Status locale={locale} result={result} />
    </form>
  );
}

export function PainForm({ locale, companyId, opportunityId, workers, referral }: {
  readonly locale: Locale; readonly companyId: string | null; readonly opportunityId: string | null; readonly workers: readonly Option[]; readonly referral: boolean;
}) {
  const c = pursuitCopy(locale);
  const f = c.field;
  const [result, action, pending] = useActionState(recordPainSignalAction, INITIAL);
  useSaved(result);
  return (
    <form action={action} className="by-settings">
      {companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}
      {opportunityId ? <input type="hidden" name="opportunityId" value={opportunityId} /> : null}
      <p className="dr-card-note">{c.sensitiveHint}</p>
      {referral ? <>
        <input type="hidden" name="painType" value="WORKER_REFERRAL" />
        <Field label={f.worker} error={err(locale, result, "reportedByWorkerId")}><select name="reportedByWorkerId" required defaultValue=""><option value="">{c.choose}</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></Field>
        <Field label={f.siteText}><input name="siteText" maxLength={300} /></Field>
        <Field label={f.city}><input name="city" maxLength={120} /></Field>
        <Field label={f.state}><input name="state" maxLength={40} /></Field>
        <Field label={f.supervisorName}><input name="supervisorName" maxLength={200} /></Field>
        <Field label={f.supervisorTitle}><input name="supervisorTitle" maxLength={200} /></Field>
        <Field label={f.neededHeadcount} error={err(locale, result, "neededHeadcount")}><input name="neededHeadcount" type="number" min={1} /></Field>
        <Field label={f.neededRoleText}><input name="neededRoleText" maxLength={300} /></Field>
        <fieldset className="by-functions"><legend>{c.consentHint}</legend>
          <label><input type="checkbox" name="consentUseIntelligence" value="yes" /> {f.consentUse}</label>
          <label><input type="checkbox" name="consentIdentifyWorker" value="yes" /> {f.consentIdentify}</label>
          {err(locale, result, "consentIdentifyWorker") ? <small className="ci-status-requires_confirmation">{err(locale, result, "consentIdentifyWorker")}</small> : null}
        </fieldset>
      </> : <>
        <Field label={f.painType}><select name="painType" defaultValue="OTHER">{PAIN_TYPES.map((t) => <option key={t} value={t}>{c.painTypes[t]}</option>)}</select></Field>
        <Field label={f.basisKind}><select name="assertionBasis" defaultValue="OBSERVED">{(["OBSERVED", "REPORTED", "INFERRED"] as const).map((t) => <option key={t} value={t}>{c.bases[t]}</option>)}</select></Field>
        <Field label={f.sourceKind}><select name="sourceKind" defaultValue="PUBLIC_SOURCE">{(["PUBLIC_SOURCE", "HUMAN_INTERACTION", "OPERATOR_OBSERVATION"] as const).map((t) => <option key={t} value={t}>{c.sourceKinds[t]}</option>)}</select></Field>
        <Field label={f.sourceUrl}><input name="sourceUrl" type="url" maxLength={2000} /></Field>
      </>}
      <Field label={f.confidence}><select name="confidence" defaultValue="UNKNOWN">{(["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const).map((t) => <option key={t} value={t}>{c.confidences[t]}</option>)}</select></Field>
      <Field label={f.observedAt} error={err(locale, result, "observedAt")}><input name="observedAt" type="date" max={today()} /></Field>
      <Field label={f.summary} error={err(locale, result, "summary")}><textarea name="summary" maxLength={2000} rows={3} required /></Field>
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? c.saving : referral ? c.recordReferral : c.recordPain}</button>
      <Status locale={locale} result={result} />
    </form>
  );
}

export function ReviewPainForm({ locale, painSignalId, returnPath }: { readonly locale: Locale; readonly painSignalId: string; readonly returnPath: string }) {
  const c = pursuitCopy(locale);
  const [result, action, pending] = useActionState(reviewPainSignalAction, INITIAL);
  useSaved(result);
  return (
    <form action={action} className="ct-inline">
      <input type="hidden" name="painSignalId" value={painSignalId} /><input type="hidden" name="returnPath" value={returnPath} />
      <input name="note" maxLength={300} placeholder={c.reviewNote} aria-label={c.reviewNote} />
      <button className="button button-secondary" type="submit" name="status" value="VERIFIED" disabled={pending}>{c.verify}</button>
      <button className="button button-secondary" type="submit" name="status" value="REJECTED" disabled={pending}>{c.reject}</button>
      <Status locale={locale} result={result} />
    </form>
  );
}

export function PromotePainForm({ locale, painSignalId, customerName, returnPath, city, state }: {
  readonly locale: Locale; readonly painSignalId: string; readonly customerName: string; readonly returnPath: string; readonly city: string | null; readonly state: string | null;
}) {
  const c = pursuitCopy(locale);
  const f = c.field;
  const [result, action, pending] = useActionState(promotePainSignalAction, INITIAL);
  useSaved(result);
  return (
    <form action={action} className="by-settings">
      <input type="hidden" name="painSignalId" value={painSignalId} /><input type="hidden" name="returnPath" value={returnPath} />
      <input type="hidden" name="customerName" value={customerName} /><input type="hidden" name="city" value={city ?? ""} /><input type="hidden" name="state" value={state ?? ""} />
      <Field label={f.opportunityTitle} error={err(locale, result, "opportunityTitle")}><input name="opportunityTitle" maxLength={200} required /></Field>
      <Field label={f.tradeCode} error={err(locale, result, "tradeCode")}><input name="tradeCode" maxLength={60} required placeholder="ELECTRICAL" /></Field>
      <Field label={f.occupationCode} error={err(locale, result, "occupationCode")}><input name="occupationCode" maxLength={60} required placeholder="ELECTRICIAN" /></Field>
      <Field label={f.headcount}><input name="headcount" type="number" min={1} /></Field>
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? c.saving : c.promote}</button>
      <Status locale={locale} result={result} />
    </form>
  );
}

const MATCH_INITIAL: WorkforceMatchingActionState = { status: "READY", demandSignalId: null, run: null, errorKey: null };
/** Invokes the EXISTING matching action unchanged against a staff request's demand signal. */
export function RunMatchingForm({ locale, opportunityId, demandSignalId }: { readonly locale: Locale; readonly opportunityId: string; readonly demandSignalId: string }) {
  const c = pursuitCopy(locale);
  const router = useRouter();
  const [state, action, pending] = useActionState(runOpportunityWorkforceMatchingAction, MATCH_INITIAL);
  useEffect(() => { if (state.status === "COMPLETED" || state.status === "PARTIAL_SUCCESS") router.refresh(); }, [state, router]);
  return (
    <form action={action} className="ct-inline">
      <input type="hidden" name="opportunityId" value={opportunityId} /><input type="hidden" name="demandSignalId" value={demandSignalId} />
      <button className="button button-secondary" type="submit" disabled={pending}>{pending ? c.saving : c.runMatching}</button>
      {state.status !== "READY" ? <span role="status" className={state.status === "FAILED" ? "dr-run-warn" : "dr-run-ok"}>{state.status}{state.errorKey ? ` · ${state.errorKey}` : ""}</span> : null}
    </form>
  );
}
