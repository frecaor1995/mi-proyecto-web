import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import type { DictionaryKey } from "../../i18n/dictionary-shape";
import type { WorkerLifecycleStatus, WorkerProfile } from "../../domain/worker";
import type { WorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import type { WorkerUiPermissions } from "../../server/workforce/worker-permissions";
import { removeTradeOccupationAction, removeSkillAction, verifyCredentialAction, markWorkHistoryEndedAction, updateContactConsentAction, deactivateContactRouteAction, archiveWorkerAction, reactivateWorkerAction } from "../../server/workforce/worker-actions";
import {
  OverviewEditForm, TradeOccupationAddForm, SkillAddForm, CredentialAddForm, AvailabilityAddForm,
  LocationAddForm, WorkHistoryAddForm, ContactRouteAddForm, CompensationAddForm,
} from "./worker-profile-forms";

/**
 * WORKFORCE-TALENT-A4 canonical worker profile. Every value rendered here
 * comes from `WorkerProfile` (WorkerService.getWorkerProfile's own read
 * model) -- no raw repository join is ever touched from this component.
 * UNKNOWN (Fact.state==="UNKNOWN") and REDACTED (PermissionGated.access
 * ==="REDACTED") are rendered with distinct, never-interchangeable copy --
 * see the three helper renderers below.
 */
export function WorkerProfileView({ locale, profile, taxonomy, permissions, lifecycleOutcome }: {
  readonly locale: Locale; readonly profile: WorkerProfile; readonly taxonomy: WorkforceTaxonomy; readonly permissions: WorkerUiPermissions;
  readonly lifecycleOutcome?: { readonly success: "archived" | "reactivated" | null; readonly error: "archive" | "reactivate" | null };
}) {
  const unknown = t(locale, "workforce.unknownValue");
  const w = profile.worker;
  return (
    <div className="page-stack">
      <Link className="detail-back" href="/workforce">← {t(locale, "workforce.listTitle")}</Link>
      <header className="detail-hero">
        <div className="detail-hero-main">
          <p className="overline">{t(locale, "workforce.eyebrow")}</p>
          <h1>{w.displayName}</h1>
        </div>
        <div className="detail-status-stack">
          <span>{t(locale, `workforce.lifecycleState.${w.lifecycleStatus}` as DictionaryKey)}</span>
          <span>{w.profileVerificationState}</span>
        </div>
      </header>

      <LifecycleControls locale={locale} workerId={w.id} lifecycleStatus={w.lifecycleStatus} canWrite={permissions.profileWrite} outcome={lifecycleOutcome} />

      <CompletenessSection locale={locale} profile={profile} />

      <Section title={t(locale, "workforce.section.overview")} index="A">
        <div className="detail-fact-band">
          <Fact label={t(locale, "workforce.overview.verifiedAtLabel")} value={w.verifiedAt ? w.verifiedAt.toISOString().slice(0, 10) : unknown} />
          <Fact label={t(locale, "workforce.overview.firstSeenAtLabel")} value={w.firstSeenAt.toISOString().slice(0, 10)} />
          <Fact label={t(locale, "workforce.overview.lastSeenAtLabel")} value={w.lastSeenAt ? w.lastSeenAt.toISOString().slice(0, 10) : unknown} />
        </div>
        {permissions.profileWrite ? <OverviewEditForm locale={locale} workerId={w.id} displayName={w.displayName} /> : null}
      </Section>

      <Section title={t(locale, "workforce.section.tradeOccupation")} index="B">
        {profile.tradeOccupations.length === 0 ? <p className="detail-honest-empty">{t(locale, "workforce.tradeOccupation.empty")}</p> : (
          <ul className="workforce-record-list">
            {profile.tradeOccupations.map((to) => (
              <li key={`${to.tradeCode}:${to.occupationCode}`} className="workforce-record">
                <div className="workforce-record-main">
                  <strong>{to.occupationCode} · {to.tradeCode}</strong>
                  <small>{t(locale, `workforce.tradeOccupation.${to.roleDesignation === "PRIMARY" ? "primaryLabel" : "secondaryLabel"}`)} · {to.experienceMonths != null ? `${to.experienceMonths} ${t(locale, "workforce.tradeOccupation.experienceMonthsSuffix")}` : unknown}</small>
                </div>
                {permissions.profileWrite ? (
                  <form action={removeTradeOccupationAction}>
                    <input type="hidden" name="workerId" value={w.id} />
                    <input type="hidden" name="tradeCode" value={to.tradeCode} />
                    <input type="hidden" name="occupationCode" value={to.occupationCode} />
                    <button type="submit">{t(locale, "workforce.tradeOccupation.removeButton")}</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {permissions.profileWrite ? <TradeOccupationAddForm locale={locale} workerId={w.id} trades={taxonomy.trades} occupations={taxonomy.occupations} /> : null}
      </Section>

      <Section title={t(locale, "workforce.section.skills")} index="C">
        {profile.skills.length === 0 ? <p className="detail-honest-empty">{t(locale, "workforce.skills.empty")}</p> : (
          <ul className="workforce-record-list">
            {profile.skills.map((skill) => (
              <li key={skill.skillCode} className="workforce-record">
                <div className="workforce-record-main"><strong>{skill.skillCode}</strong><small>{skill.verificationState}</small></div>
                {permissions.profileWrite ? (
                  <form action={removeSkillAction}>
                    <input type="hidden" name="workerId" value={w.id} />
                    <input type="hidden" name="skillCode" value={skill.skillCode} />
                    <button type="submit">{t(locale, "workforce.skills.removeButton")}</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {permissions.profileWrite ? <SkillAddForm locale={locale} workerId={w.id} skills={taxonomy.skills} /> : null}
      </Section>

      <Section title={t(locale, "workforce.section.credentials")} index="D">
        {/* Safe shape only -- WorkerProfile.credentials has no raw_identifier field to accidentally render. */}
        {profile.credentials.length === 0 ? <p className="detail-honest-empty">{t(locale, "workforce.credentials.empty")}</p> : (
          <ul className="workforce-record-list">
            {profile.credentials.map((credential) => (
              <li key={credential.credentialCode} className="workforce-record">
                <div className="workforce-record-main">
                  <strong>{credential.credentialCode}</strong>
                  <small>
                    {credential.verificationState} · {t(locale, "workforce.credentials.issuedAtLabel")}: {credential.issuedAt ? credential.issuedAt.toISOString().slice(0, 10) : unknown}
                    {" · "}{t(locale, "workforce.credentials.expiresAtLabel")}: {credential.expiresAt ? credential.expiresAt.toISOString().slice(0, 10) : unknown}
                  </small>
                </div>
                {permissions.profileWrite && credential.verificationState !== "VERIFIED" ? (
                  <form action={verifyCredentialAction}>
                    <input type="hidden" name="workerId" value={w.id} />
                    <input type="hidden" name="credentialCode" value={credential.credentialCode} />
                    <button type="submit">{t(locale, "workforce.credentials.verifyButton")}</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {permissions.profileWrite ? <CredentialAddForm locale={locale} workerId={w.id} credentials={taxonomy.credentials} /> : null}
      </Section>

      <Section title={t(locale, "workforce.section.availability")} index="E">
        <p className="detail-honest-empty">
          {t(locale, "workforce.availability.currentLabel")}: {profile.currentAvailability.state === "KNOWN"
            ? t(locale, `workforce.availability.statusOption.${profile.currentAvailability.value.status}` as DictionaryKey)
            : t(locale, "workforce.unknownValue")}
          {profile.currentAvailability.state === "KNOWN" && profile.currentAvailability.value.availableFrom
            ? ` (${t(locale, "workforce.availability.availableFromLabel")}: ${profile.currentAvailability.value.availableFrom.toISOString().slice(0, 10)})` : ""}
        </p>
        {permissions.profileWrite ? <AvailabilityAddForm locale={locale} workerId={w.id} /> : null}
      </Section>

      <Section title={t(locale, "workforce.section.location")} index="F">
        {/* Coarse only -- no street address, no lat/lng exist anywhere in WorkerLocationRecord. */}
        <p className="detail-honest-empty">
          {t(locale, "workforce.location.currentLabel")}: {profile.currentLocation.state === "KNOWN"
            ? [profile.currentLocation.value.city, profile.currentLocation.value.region, profile.currentLocation.value.country].filter(Boolean).join(", ") || unknown
            : unknown}
        </p>
        {profile.currentLocation.state === "KNOWN" ? (
          <div className="detail-fact-band">
            <Fact label={t(locale, "workforce.location.travelWillingLabel")} value={profile.currentLocation.value.travelWilling ? "Yes" : "No"} />
            <Fact label={t(locale, "workforce.location.travelRadiusLabel")} value={profile.currentLocation.value.travelRadiusMiles != null ? `${profile.currentLocation.value.travelRadiusMiles} ${t(locale, "workforce.location.milesSuffix")}` : unknown} />
            <Fact label={t(locale, "workforce.location.relocationWillingLabel")} value={profile.currentLocation.value.relocationWilling ? "Yes" : "No"} />
          </div>
        ) : null}
        {permissions.profileWrite ? <LocationAddForm locale={locale} workerId={w.id} /> : null}
      </Section>

      <Section title={t(locale, "workforce.section.workHistory")} index="G">
        {profile.workHistory.length === 0 ? <p className="detail-honest-empty">{t(locale, "workforce.workHistory.empty")}</p> : (
          <ul className="workforce-record-list">
            {profile.workHistory.map((entry) => (
              <li key={entry.id} className="workforce-record">
                <div className="workforce-record-main">
                  <strong>{entry.employerLabel}{entry.projectLabel ? ` · ${entry.projectLabel}` : ""}</strong>
                  <small>{entry.startDate ? entry.startDate.toISOString().slice(0, 10) : unknown} — {entry.endDate ? entry.endDate.toISOString().slice(0, 10) : t(locale, "workforce.workHistory.presentLabel")}</small>
                </div>
                {permissions.profileWrite && !entry.endDate ? (
                  <form action={markWorkHistoryEndedAction}>
                    <input type="hidden" name="workerId" value={w.id} />
                    <input type="hidden" name="id" value={entry.id} />
                    <button type="submit">{t(locale, "workforce.workHistory.markEndedSubmit")}</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {permissions.profileWrite ? <WorkHistoryAddForm locale={locale} workerId={w.id} /> : null}
      </Section>

      <Section title={t(locale, "workforce.section.contact")} index="H">
        {profile.contact.access === "REDACTED" ? (
          <RestrictedPanel locale={locale} titleKey="workforce.contact.restrictedTitle" descriptionKey="workforce.contact.restrictedDescription" />
        ) : (
          <>
            {!permissions.contactWrite ? <p className="detail-honest-empty">{t(locale, "workforce.contact.readOnlyNotice")}</p> : null}
            {profile.contact.value.routes.length === 0 ? <p className="detail-honest-empty">{t(locale, "workforce.contact.empty")}</p> : (
              <ul className="workforce-record-list">
                {profile.contact.value.routes.map((route) => (
                  <li key={route.id} className="workforce-record">
                    <div className="workforce-record-main">
                      <strong>{route.routeType}: {route.target}</strong>
                      <small>
                        {t(locale, `workforce.contact.consentOption.${route.consentState}` as DictionaryKey)}
                        {route.lifecycleStatus === "INACTIVE" ? ` · ${t(locale, "workforce.contact.inactiveLabel")}` : ""}
                        {route.preferred ? ` · ${t(locale, "workforce.contact.preferredLabel")}` : ""}
                      </small>
                    </div>
                    {permissions.contactWrite && route.lifecycleStatus === "ACTIVE" ? (
                      <div className="workforce-inline-actions">
                        {route.consentState !== "GRANTED" ? (
                          <form action={updateContactConsentAction}>
                            <input type="hidden" name="workerId" value={w.id} />
                            <input type="hidden" name="id" value={route.id} />
                            <input type="hidden" name="consentState" value="GRANTED" />
                            <button type="submit">{t(locale, "workforce.contact.consentOption.GRANTED")}</button>
                          </form>
                        ) : null}
                        <form action={deactivateContactRouteAction}>
                          <input type="hidden" name="workerId" value={w.id} />
                          <input type="hidden" name="id" value={route.id} />
                          <button type="submit">{t(locale, "workforce.contact.deactivateButton")}</button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {permissions.contactWrite ? <ContactRouteAddForm locale={locale} workerId={w.id} /> : null}
          </>
        )}
      </Section>

      <Section title={t(locale, "workforce.section.compensation")} index="I">
        {profile.compensation.access === "REDACTED" ? (
          <RestrictedPanel locale={locale} titleKey="workforce.compensation.restrictedTitle" descriptionKey="workforce.compensation.restrictedDescription" />
        ) : (
          <>
            {!permissions.compensationWrite ? <p className="detail-honest-empty">{t(locale, "workforce.compensation.readOnlyNotice")}</p> : null}
            {profile.compensation.value.length === 0 ? <p className="detail-honest-empty">{t(locale, "workforce.compensation.empty")}</p> : (
              <ul className="workforce-record-list">
                {profile.compensation.value.map((expectation) => (
                  <li key={expectation.id} className="workforce-record">
                    <div className="workforce-record-main">
                      <strong>{t(locale, `workforce.compensation.rateTypeOption.${expectation.rateType}` as DictionaryKey)}: {expectation.rateMin != null ? `${expectation.rateMin} ${expectation.currency}` : unknown}{expectation.ratePreferred != null ? ` – ${expectation.ratePreferred} ${expectation.currency}` : ""}</strong>
                      <small>{expectation.perDiemRequired ? t(locale, "workforce.compensation.perDiemLabel") : ""} {expectation.negotiable ? t(locale, "workforce.compensation.negotiableLabel") : ""}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {permissions.compensationWrite ? <CompensationAddForm locale={locale} workerId={w.id} /> : null}
          </>
        )}
      </Section>
    </div>
  );
}

/**
 * WORKFORCE-TALENT-A4-R10. Only two transitions are ever exposed here --
 * ACTIVE -> ARCHIVED and ARCHIVED -> ACTIVE -- matching the two narrow
 * WorkerService methods; INACTIVE is left entirely alone (no button is
 * ever rendered for it, preserving its existing, unrelated behavior).
 * The archive confirmation uses a native <details>/<summary> disclosure --
 * no Client Component, no window.confirm() -- so the warning copy must be
 * read before "Confirmar archivo" is even reachable.
 */
function LifecycleControls({ locale, workerId, lifecycleStatus, canWrite, outcome }: {
  locale: Locale; workerId: string; lifecycleStatus: WorkerLifecycleStatus; canWrite: boolean;
  outcome?: { readonly success: "archived" | "reactivated" | null; readonly error: "archive" | "reactivate" | null };
}) {
  return (
    <div className="workforce-lifecycle-controls">
      {outcome?.success === "archived" ? <p role="status" className="workforce-form-success">{t(locale, "workforce.overview.archiveSuccess")}</p> : null}
      {outcome?.success === "reactivated" ? <p role="status" className="workforce-form-success">{t(locale, "workforce.overview.reactivateSuccess")}</p> : null}
      {outcome?.error === "archive" ? <p role="alert" className="workforce-form-error">{t(locale, "workforce.overview.archiveError")}</p> : null}
      {outcome?.error === "reactivate" ? <p role="alert" className="workforce-form-error">{t(locale, "workforce.overview.reactivateError")}</p> : null}
      {canWrite && lifecycleStatus === "ACTIVE" ? (
        <details className="workforce-archive-confirm">
          <summary>{t(locale, "workforce.overview.archiveAction")}</summary>
          <p>{t(locale, "workforce.overview.archiveWarning")}</p>
          <form action={archiveWorkerAction}>
            <input type="hidden" name="workerId" value={workerId} />
            <button type="submit">{t(locale, "workforce.overview.archiveConfirmSubmit")}</button>
          </form>
        </details>
      ) : null}
      {canWrite && lifecycleStatus === "ARCHIVED" ? (
        <form action={reactivateWorkerAction}>
          <input type="hidden" name="workerId" value={workerId} />
          <button type="submit">{t(locale, "workforce.overview.reactivateAction")}</button>
        </form>
      ) : null}
    </div>
  );
}

function CompletenessSection({ locale, profile }: { locale: Locale; profile: WorkerProfile }) {
  const items: string[] = [];
  if (profile.tradeOccupations.length === 0) items.push(t(locale, "workforce.completeness.missingTrade"));
  if (profile.skills.length === 0) items.push(t(locale, "workforce.completeness.missingSkills"));
  if (profile.currentAvailability.state === "UNKNOWN") items.push(t(locale, "workforce.completeness.missingAvailability"));
  if (profile.credentials.some((c) => c.verificationState === "UNVERIFIED")) items.push(t(locale, "workforce.completeness.credentialVerificationPending"));
  if (profile.contact.access === "GRANTED" && profile.contact.value.routes.every((r) => r.consentState !== "GRANTED")) items.push(t(locale, "workforce.completeness.missingContactConsent"));
  return (
    <Section title={t(locale, "workforce.section.completeness")} index="•">
      {items.length === 0 ? (
        <ul className="workforce-completeness"><li className="workforce-complete">{t(locale, "workforce.completeness.allGood")}</li></ul>
      ) : (
        <ul className="workforce-completeness">{items.map((item) => <li key={item}>{item}</li>)}</ul>
      )}
    </Section>
  );
}

function RestrictedPanel({ locale, titleKey, descriptionKey }: { locale: Locale; titleKey: DictionaryKey; descriptionKey: DictionaryKey }) {
  return (
    <div className="workforce-restricted">
      <strong>{t(locale, titleKey)}</strong>
      <p>{t(locale, descriptionKey)}</p>
    </div>
  );
}

function Section({ title, index, children }: { title: string; index: string; children: ReactNode }) {
  return <section className="detail-section"><header><span>{index}</span><h2>{title}</h2></header><div className="workforce-section-body">{children}</div></section>;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="detail-fact"><span>{label}</span><strong>{value}</strong></div>;
}
