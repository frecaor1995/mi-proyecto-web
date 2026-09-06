"use client";
import { useActionState, useId, useState } from "react";
import { HUMAN_ANSWER_DISPOSITIONS, HUMAN_AUTHORITY_LEVELS, HUMAN_COMMERCIAL_MECHANISMS, HUMAN_INTERACTION_METHODS, HUMAN_INTERACTION_OUTCOMES, type HumanInteractionOutcome, type HumanVerificationTaskStatus } from "../../domain/human-verification";
import type { DictionaryKey } from "../../i18n/dictionary-shape";
import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import { submitHumanVerificationResponseAction, type ResponseCaptureFormState } from "../../server/human-verification-response/actions";

const NON_SUBSTANTIVE_OUTCOMES: ReadonlySet<HumanInteractionOutcome> = new Set(["NO_ANSWER", "VOICEMAIL_LEFT", "WRONG_NUMBER", "EMAIL_SENT", "EMAIL_BOUNCED"]);

function reachedHumanFor(outcome: HumanInteractionOutcome | ""): boolean {
  return outcome !== "" && !NON_SUBSTANTIVE_OUTCOMES.has(outcome);
}

const initialState: ResponseCaptureFormState = { outcome: null, error: null };

export function ResponseCaptureForm({
  locale, taskId, expectedTaskStatus, contactName, contactTitle, contactRouteType, contactRouteTarget,
}: {
  readonly locale: Locale;
  readonly taskId: string;
  readonly expectedTaskStatus: HumanVerificationTaskStatus;
  readonly contactName: string | null;
  readonly contactTitle: string | null;
  readonly contactRouteType: string | null;
  readonly contactRouteTarget: string | null;
}) {
  const [state, formAction, pending] = useActionState(submitHumanVerificationResponseAction, initialState);
  const [outcome, setOutcome] = useState<HumanInteractionOutcome | "">("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const formId = useId();
  const reached = reachedHumanFor(outcome);

  if (state.outcome?.kind === "EXECUTED" || state.outcome?.kind === "REPLAYED") {
    return (
      <div className="response-capture-result response-capture-success">
        <p>{t(locale, "verificationResponse.submitted")}</p>
        <p>{t(locale, "verificationResponse.newStatus")}: <strong>{state.outcome.newTaskStatus}</strong></p>
        {state.outcome.canonicalOutcome === "AF01_EVALUATED" ? (
          <p>{t(locale, "verificationResponse.af01Updated")}: <strong>{state.outcome.af01Result}</strong></p>
        ) : (
          <p>{t(locale, "verificationResponse.noCanonicalChange")}</p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="response-capture-form" id={formId}>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="expectedTaskStatus" value={expectedTaskStatus} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="reachedHuman" value={String(reached)} />

      {(state.error || (state.outcome?.kind === "REJECTED")) ? (
        <p role="alert" className="response-capture-error">
          {state.error ? t(locale, state.error as DictionaryKey) : t(locale, `verificationResponse.rejected.${state.outcome?.kind === "REJECTED" ? state.outcome.reason : "UNKNOWN"}` as DictionaryKey)}
        </p>
      ) : null}

      <fieldset>
        <legend>{t(locale, "verificationResponse.attemptSection")}</legend>
        <label>
          <span>{t(locale, "verificationResponse.interactionMethod")}</span>
          <select name="interactionMethod" required defaultValue="">
            <option value="" disabled>{t(locale, "verificationResponse.selectOne")}</option>
            {HUMAN_INTERACTION_METHODS.map((value) => <option key={value} value={value}>{t(locale, `verificationResponse.method.${value}` as DictionaryKey)}</option>)}
          </select>
        </label>
        <label>
          <span>{t(locale, "verificationResponse.interactionOutcome")}</span>
          <select name="interactionOutcome" required value={outcome} onChange={(event) => setOutcome(event.target.value as HumanInteractionOutcome)}>
            <option value="" disabled>{t(locale, "verificationResponse.selectOne")}</option>
            {HUMAN_INTERACTION_OUTCOMES.map((value) => <option key={value} value={value}>{t(locale, `verificationResponse.outcome.${value}` as DictionaryKey)}</option>)}
          </select>
        </label>
        <label>
          <span>{t(locale, "verificationResponse.respondentName")}</span>
          <input type="text" name="personNameSnapshot" defaultValue={contactName ?? ""} />
        </label>
        <label>
          <span>{t(locale, "verificationResponse.respondentTitle")}</span>
          <input type="text" name="personTitleSnapshot" defaultValue={contactTitle ?? ""} />
        </label>
        <p className="response-capture-route-hint">{t(locale, "verificationResponse.knownRoute")}: {contactRouteType ?? "—"} · {contactRouteTarget ?? "—"}</p>
        <label>
          <span>{t(locale, "verificationResponse.responseVerbatim")}</span>
          <textarea name="responseVerbatim" rows={2} />
        </label>
        <label>
          <span>{t(locale, "verificationResponse.responseSummary")}</span>
          <textarea name="responseSummary" rows={3} required />
        </label>
      </fieldset>

      {outcome !== "" ? (
        reached ? (
          <fieldset>
            <legend>{t(locale, "verificationResponse.classificationSection")}</legend>
            <label>
              <span>{t(locale, "verificationResponse.answerDisposition")}</span>
              <select name="answerDisposition" required defaultValue="">
                <option value="" disabled>{t(locale, "verificationResponse.selectOne")}</option>
                {HUMAN_ANSWER_DISPOSITIONS.map((value) => <option key={value} value={value}>{t(locale, `verificationResponse.disposition.${value}` as DictionaryKey)}</option>)}
              </select>
            </label>
            <label>
              <span>{t(locale, "verificationResponse.authorityLevel")}</span>
              <select name="authorityLevel" required defaultValue="">
                <option value="" disabled>{t(locale, "verificationResponse.selectOne")}</option>
                {HUMAN_AUTHORITY_LEVELS.map((value) => <option key={value} value={value}>{t(locale, `verificationResponse.authority.${value}` as DictionaryKey)}</option>)}
              </select>
            </label>
            <label>
              <span>{t(locale, "verificationResponse.authorityBasis")}</span>
              <input type="text" name="authorityBasis" />
            </label>
            <label>
              <span>{t(locale, "verificationResponse.commercialMechanism")}</span>
              <select name="commercialMechanism" defaultValue="">
                <option value="">{t(locale, "verificationResponse.notApplicable")}</option>
                {HUMAN_COMMERCIAL_MECHANISMS.map((value) => <option key={value} value={value}>{t(locale, `verificationResponse.mechanism.${value}` as DictionaryKey)}</option>)}
              </select>
            </label>
            <label>
              <span>{t(locale, "verificationResponse.followUpTarget")}</span>
              <input type="text" name="followUpTarget" placeholder={t(locale, "verificationResponse.followUpTargetPlaceholder")} />
            </label>
            <label>
              <span>{t(locale, "verificationResponse.assessmentNotes")}</span>
              <textarea name="assessmentNotes" rows={2} />
            </label>
          </fieldset>
        ) : (
          <p className="response-capture-note">{t(locale, "verificationResponse.nonSubstantiveNote")}</p>
        )
      ) : null}

      <button type="submit" disabled={pending}>{pending ? t(locale, "verificationResponse.submitting") : t(locale, "verificationResponse.submit")}</button>
    </form>
  );
}
