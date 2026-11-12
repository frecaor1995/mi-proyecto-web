"use client";
import { useActionState } from "react";
import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import type { DictionaryKey } from "../../i18n/dictionary-shape";
import type { TradeOption, OccupationOption, SkillOption, CredentialOption } from "../../server/workforce/get-workforce-taxonomy";
import {
  addCredentialAction, addContactRouteAction, addSkillAction, addTradeOccupationAction,
  addWorkHistoryAction, appendAvailabilityAction, appendCompensationAction, appendLocationAction, updateWorkerOverviewAction,
  type WorkerActionState,
} from "../../server/workforce/worker-actions";

const initialState: WorkerActionState = { successKey: null, errorKey: null };

function Feedback({ locale, errorKey, successKey }: { locale: Locale; errorKey: string | null; successKey: string | null }) {
  return (
    <>
      {errorKey ? <p role="alert" className="workforce-form-error">{t(locale, errorKey as DictionaryKey)}</p> : null}
      {successKey ? <p role="status" className="workforce-form-success">{t(locale, successKey as DictionaryKey)}</p> : null}
    </>
  );
}

export function OverviewEditForm({ locale, workerId, displayName }: { locale: Locale; workerId: string; displayName: string }) {
  const [state, formAction, pending] = useActionState(updateWorkerOverviewAction, initialState);
  return (
    <form action={formAction} className="workforce-form">
      <input type="hidden" name="workerId" value={workerId} />
      <label>
        <span>{t(locale, "workforce.overview.displayNameLabel")}</span>
        <input name="displayName" type="text" defaultValue={displayName} required maxLength={200} />
      </label>
      <label className="workforce-checkbox-field">
        <input name="markVerified" type="checkbox" />
        <span>{t(locale, "workforce.overview.markVerifiedLabel")}</span>
      </label>
      <Feedback locale={locale} errorKey={state.errorKey} successKey={state.successKey} />
      <button type="submit" disabled={pending}>{t(locale, "workforce.overview.saveButton")}</button>
    </form>
  );
}

export function TradeOccupationAddForm({ locale, workerId, trades, occupations }: { locale: Locale; workerId: string; trades: readonly TradeOption[]; occupations: readonly OccupationOption[] }) {
  const [state, formAction, pending] = useActionState(addTradeOccupationAction, initialState);
  return (
    <form action={formAction} className="workforce-form">
      <input type="hidden" name="workerId" value={workerId} />
      <label>
        <span>{t(locale, "workforce.tradeOccupation.addTradeLabel")}</span>
        <select name="tradeCode" required defaultValue="">
          <option value="" disabled>{t(locale, "workforce.filterTradeAll")}</option>
          {trades.map((trade) => <option key={trade.code} value={trade.code}>{trade.labelEn}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.tradeOccupation.addOccupationLabel")}</span>
        <select name="occupationCode" required defaultValue="">
          <option value="" disabled>{t(locale, "workforce.filterOccupationAll")}</option>
          {occupations.map((occupation) => <option key={occupation.code} value={occupation.code}>{occupation.labelEn}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.tradeOccupation.addRoleLabel")}</span>
        <select name="roleDesignation" defaultValue="SECONDARY">
          <option value="PRIMARY">{t(locale, "workforce.tradeOccupation.primaryLabel")}</option>
          <option value="SECONDARY">{t(locale, "workforce.tradeOccupation.secondaryLabel")}</option>
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.tradeOccupation.addExperienceLabel")}</span>
        <input name="experienceMonths" type="number" min={0} />
      </label>
      <Feedback locale={locale} errorKey={state.errorKey} successKey={state.successKey} />
      <button type="submit" disabled={pending}>{t(locale, "workforce.tradeOccupation.addSubmit")}</button>
    </form>
  );
}

export function SkillAddForm({ locale, workerId, skills }: { locale: Locale; workerId: string; skills: readonly SkillOption[] }) {
  const [state, formAction, pending] = useActionState(addSkillAction, initialState);
  return (
    <form action={formAction} className="workforce-form">
      <input type="hidden" name="workerId" value={workerId} />
      <label>
        <span>{t(locale, "workforce.skills.addSkillLabel")}</span>
        <select name="skillCode" required defaultValue="">
          <option value="" disabled>{t(locale, "workforce.skills.addSkillLabel")}</option>
          {skills.map((skill) => <option key={skill.code} value={skill.code}>{skill.labelEn}</option>)}
        </select>
      </label>
      <Feedback locale={locale} errorKey={state.errorKey} successKey={state.successKey} />
      <button type="submit" disabled={pending}>{t(locale, "workforce.skills.addSubmit")}</button>
    </form>
  );
}

export function CredentialAddForm({ locale, workerId, credentials }: { locale: Locale; workerId: string; credentials: readonly CredentialOption[] }) {
  const [state, formAction, pending] = useActionState(addCredentialAction, initialState);
  return (
    <form action={formAction} className="workforce-form">
      <input type="hidden" name="workerId" value={workerId} />
      <label>
        <span>{t(locale, "workforce.credentials.addCredentialLabel")}</span>
        <select name="credentialCode" required defaultValue="">
          <option value="" disabled>{t(locale, "workforce.credentials.addCredentialLabel")}</option>
          {credentials.map((credential) => <option key={credential.code} value={credential.code}>{credential.labelEn}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.credentials.addRawIdentifierLabel")}</span>
        <input name="rawIdentifier" type="text" autoComplete="off" title={t(locale, "workforce.credentials.addRawIdentifierHint")} />
      </label>
      <label>
        <span>{t(locale, "workforce.credentials.addIssuedAtLabel")}</span>
        <input name="issuedAt" type="date" />
      </label>
      <label>
        <span>{t(locale, "workforce.credentials.addExpiresAtLabel")}</span>
        <input name="expiresAt" type="date" />
      </label>
      <Feedback locale={locale} errorKey={state.errorKey} successKey={state.successKey} />
      <button type="submit" disabled={pending}>{t(locale, "workforce.credentials.addSubmit")}</button>
    </form>
  );
}

export function AvailabilityAddForm({ locale, workerId }: { locale: Locale; workerId: string }) {
  const [state, formAction, pending] = useActionState(appendAvailabilityAction, initialState);
  return (
    <form action={formAction} className="workforce-form">
      <input type="hidden" name="workerId" value={workerId} />
      <label>
        <span>{t(locale, "workforce.availability.statusLabel")}</span>
        <select name="status" defaultValue="UNKNOWN">
          {(["AVAILABLE", "COMMITTED", "UNAVAILABLE", "UNKNOWN"] as const).map((option) => <option key={option} value={option}>{t(locale, `workforce.availability.statusOption.${option}` as DictionaryKey)}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.availability.availableFromLabel")}</span>
        <input name="availableFrom" type="date" />
      </label>
      <label>
        <span>{t(locale, "workforce.availability.availableUntilLabel")}</span>
        <input name="availableUntil" type="date" />
      </label>
      <Feedback locale={locale} errorKey={state.errorKey} successKey={state.successKey} />
      <button type="submit" disabled={pending}>{t(locale, "workforce.availability.addSubmit")}</button>
    </form>
  );
}

export function LocationAddForm({ locale, workerId }: { locale: Locale; workerId: string }) {
  const [state, formAction, pending] = useActionState(appendLocationAction, initialState);
  return (
    <form action={formAction} className="workforce-form">
      <input type="hidden" name="workerId" value={workerId} />
      <label>
        <span>{t(locale, "workforce.location.cityLabel")}</span>
        <input name="city" type="text" maxLength={120} />
      </label>
      <label>
        <span>{t(locale, "workforce.location.regionLabel")}</span>
        <input name="region" type="text" maxLength={120} />
      </label>
      <label>
        <span>{t(locale, "workforce.location.countryLabel")}</span>
        <input name="country" type="text" maxLength={120} />
      </label>
      <label className="workforce-checkbox-field">
        <input name="travelWilling" type="checkbox" />
        <span>{t(locale, "workforce.location.travelWillingLabel")}</span>
      </label>
      <label>
        <span>{t(locale, "workforce.location.travelRadiusLabel")}</span>
        <input name="travelRadiusMiles" type="number" min={0} />
      </label>
      <label className="workforce-checkbox-field">
        <input name="relocationWilling" type="checkbox" />
        <span>{t(locale, "workforce.location.relocationWillingLabel")}</span>
      </label>
      <Feedback locale={locale} errorKey={state.errorKey} successKey={state.successKey} />
      <button type="submit" disabled={pending}>{t(locale, "workforce.location.addSubmit")}</button>
    </form>
  );
}

export function WorkHistoryAddForm({ locale, workerId }: { locale: Locale; workerId: string }) {
  const [state, formAction, pending] = useActionState(addWorkHistoryAction, initialState);
  return (
    <form action={formAction} className="workforce-form">
      <input type="hidden" name="workerId" value={workerId} />
      <label>
        <span>{t(locale, "workforce.workHistory.employerLabel")}</span>
        <input name="employerLabel" type="text" required maxLength={200} />
      </label>
      <label>
        <span>{t(locale, "workforce.workHistory.projectLabel")}</span>
        <input name="projectLabel" type="text" maxLength={200} />
      </label>
      <label>
        <span>{t(locale, "workforce.workHistory.startDateLabel")}</span>
        <input name="startDate" type="date" />
      </label>
      <label>
        <span>{t(locale, "workforce.workHistory.endDateLabel")}</span>
        <input name="endDate" type="date" />
      </label>
      <Feedback locale={locale} errorKey={state.errorKey} successKey={state.successKey} />
      <button type="submit" disabled={pending}>{t(locale, "workforce.workHistory.addSubmit")}</button>
    </form>
  );
}

export function ContactRouteAddForm({ locale, workerId }: { locale: Locale; workerId: string }) {
  const [state, formAction, pending] = useActionState(addContactRouteAction, initialState);
  return (
    <form action={formAction} className="workforce-form">
      <input type="hidden" name="workerId" value={workerId} />
      <label>
        <span>{t(locale, "workforce.contact.routeTypeLabel")}</span>
        <select name="routeType" defaultValue="PHONE">
          {(["PHONE", "EMAIL", "SMS", "OTHER"] as const).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.contact.targetLabel")}</span>
        <input name="target" type="text" required maxLength={200} />
      </label>
      <label>
        <span>{t(locale, "workforce.contact.consentLabel")}</span>
        <select name="consentState" defaultValue="UNKNOWN" title={t(locale, "workforce.contact.consentRequiredHint")}>
          {(["GRANTED", "REVOKED", "UNKNOWN"] as const).map((option) => <option key={option} value={option}>{t(locale, `workforce.contact.consentOption.${option}` as DictionaryKey)}</option>)}
        </select>
      </label>
      <Feedback locale={locale} errorKey={state.errorKey} successKey={state.successKey} />
      <button type="submit" disabled={pending}>{t(locale, "workforce.contact.addSubmit")}</button>
    </form>
  );
}

export function CompensationAddForm({ locale, workerId }: { locale: Locale; workerId: string }) {
  const [state, formAction, pending] = useActionState(appendCompensationAction, initialState);
  return (
    <form action={formAction} className="workforce-form">
      <input type="hidden" name="workerId" value={workerId} />
      <label>
        <span>{t(locale, "workforce.compensation.rateTypeLabel")}</span>
        <select name="rateType" defaultValue="HOURLY">
          {(["HOURLY", "DAILY", "SALARY", "PROJECT"] as const).map((option) => <option key={option} value={option}>{t(locale, `workforce.compensation.rateTypeOption.${option}` as DictionaryKey)}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.compensation.rateMinLabel")}</span>
        <input name="rateMin" type="number" min={0} step="0.01" />
      </label>
      <label>
        <span>{t(locale, "workforce.compensation.ratePreferredLabel")}</span>
        <input name="ratePreferred" type="number" min={0} step="0.01" />
      </label>
      <label>
        <span>{t(locale, "workforce.compensation.currencyLabel")}</span>
        <input name="currency" type="text" defaultValue="USD" maxLength={3} />
      </label>
      <label className="workforce-checkbox-field">
        <input name="perDiemRequired" type="checkbox" />
        <span>{t(locale, "workforce.compensation.perDiemLabel")}</span>
      </label>
      <label className="workforce-checkbox-field">
        <input name="negotiable" type="checkbox" defaultChecked />
        <span>{t(locale, "workforce.compensation.negotiableLabel")}</span>
      </label>
      <Feedback locale={locale} errorKey={state.errorKey} successKey={state.successKey} />
      <button type="submit" disabled={pending}>{t(locale, "workforce.compensation.addSubmit")}</button>
    </form>
  );
}
