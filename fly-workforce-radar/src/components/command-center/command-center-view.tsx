import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import type { DictionaryKey } from "../../i18n/dictionary-shape";
import { t } from "../../i18n/translate";
import { formatDate } from "../../i18n/format";
import { PageHeader } from "../ui/foundation";
import { TrustState, CurrentnessBadge, ScopeBadge } from "../ui/status-primitives";
import { MetricTile } from "./metric-tile";
import type { CommandCenterSummary } from "../../server/read-models/command-center";
import type { CommercialActionItem } from "../../server/read-models/commercial-action";

export interface CommandCenterViewProps {
  readonly locale: Locale;
  readonly summary: CommandCenterSummary;
  readonly commercialActions: readonly CommercialActionItem[];
  /**
   * Only set when a real, evidence-backed "as of" instant is known. `null`
   * in the honest default state -- the page must never call `new Date()`
   * and present render time as if it were data freshness (UI-3 section 16).
   */
  readonly dataAsOf: Date | null;
}

export function CommandCenterView({ locale, summary, commercialActions, dataAsOf }: CommandCenterViewProps) {
  return (
    <div className="page-stack command-center-view">
      <PageHeader
        eyebrow={t(locale, "commandCenter.eyebrow")}
        title={t(locale, "commandCenter.title")}
        description={t(locale, "commandCenter.description")}
        locale={locale}
      />

      <section className="cc-connection-row" aria-label={t(locale, "shell.dataConnectionLabel")}>
        <span className={`cc-connection-dot cc-connection-${summary.dataConnectionCapability.toLowerCase()}`} aria-hidden="true" />
        <span className="cc-connection-label">{t(locale, "shell.dataConnectionLabel")}</span>
        <strong className="cc-connection-value">{t(locale, `capabilityState.${summary.dataConnectionCapability}`)}</strong>
        {dataAsOf ? (
          <span className="cc-asof">
            {t(locale, "commandCenter.asOfLabel")} {formatDate(locale, dataAsOf)}
          </span>
        ) : null}
      </section>

      <section aria-labelledby="cc-metrics-title" className="cc-section">
        <h2 id="cc-metrics-title" className="cc-section-title sr-only">{t(locale, "commandCenter.metricsSectionTitle")}</h2>
        <div className="metric-band">
          <MetricTile locale={locale} kind="HOT_OPPORTUNITIES" value={summary.hotCount.value} />
          <MetricTile locale={locale} kind="NEAR_READY_OPPORTUNITIES" value={summary.nearReadyCount.value} />
          <MetricTile locale={locale} kind="VERIFICATION_WORK" value={summary.verificationWorkCount.value} />
          <MetricTile locale={locale} kind="ACTIONABLE_ROUTES" value={summary.actionableRoutesCount.value} />
          <MetricTile locale={locale} kind="STALE_EVIDENCE" value={summary.staleEvidenceCount.value} />
          <MetricTile locale={locale} kind="CONFLICTS" value={summary.conflictCount.value} />
          <MetricTile locale={locale} kind="BLOCKED_ITEMS" value={summary.blockedCount.value} />
          <MetricTile locale={locale} kind="PRIORITIZED_ACTIONS" value={summary.prioritizedActionCount.value} />
        </div>
      </section>

      <AttentionSection locale={locale} summary={summary} />

      <section aria-labelledby="cc-state-title" className="cc-section">
        <div className="section-heading">
          <p className="overline">{t(locale, "commandCenter.opportunityStateTitle")}</p>
          <h2 id="cc-state-title">{t(locale, "commandCenter.opportunityStateTitle")}</h2>
        </div>
        <div className="metric-band metric-band-compact">
          <MetricTile locale={locale} kind="HOT_OPPORTUNITIES" value={summary.hotCount.value} />
          <MetricTile locale={locale} kind="NEAR_READY_OPPORTUNITIES" value={summary.nearReadyCount.value} />
          <MetricTile locale={locale} kind="VERIFICATION_WORK" value={summary.verificationWorkCount.value} />
        </div>
      </section>

      <div className="cc-two-column">
        <CommercialActionsPanel locale={locale} actions={commercialActions} />
        <VerificationSummary locale={locale} verificationWorkValue={summary.verificationWorkCount.value} />
      </div>

      <div className="cc-two-column">
        <RadarCapability locale={locale} sourceHealthCapability={summary.sourceHealthCapability} />
        <DataTrustLegend locale={locale} />
      </div>
    </div>
  );
}

function AttentionSection({ locale, summary }: { locale: Locale; summary: CommandCenterSummary }) {
  const attentionMetrics: { readonly kind: Parameters<typeof MetricTile>[0]["kind"]; readonly value: CommandCenterSummary["verificationWorkCount"]["value"] }[] = [
    { kind: "VERIFICATION_WORK", value: summary.verificationWorkCount.value },
    { kind: "STALE_EVIDENCE", value: summary.staleEvidenceCount.value },
    { kind: "CONFLICTS", value: summary.conflictCount.value },
    { kind: "BLOCKED_ITEMS", value: summary.blockedCount.value },
    { kind: "PRIORITIZED_ACTIONS", value: summary.prioritizedActionCount.value },
  ];
  const allKnownZero = attentionMetrics.every((metric) => metric.value.state === "KNOWN" && metric.value.value === 0);

  return (
    <section aria-labelledby="attention-title" className="cc-section">
      <div className="section-heading">
        <p className="overline">{t(locale, "commandCenter.attentionOverline")}</p>
        <h2 id="attention-title">{t(locale, "commandCenter.attentionTitle")}</h2>
      </div>
      {allKnownZero ? (
        <p className="cc-no-attention">{t(locale, "commandCenter.noAttentionItems")}</p>
      ) : (
        <div className="metric-band metric-band-compact">
          {attentionMetrics.map((metric) => (
            <MetricTile key={metric.kind} locale={locale} kind={metric.kind} value={metric.value} />
          ))}
          <article className="metric-tile metric-tile-unavailable" aria-label={t(locale, "commandCenter.unavailableMetricTemplate", { metric: t(locale, "commandCenter.attentionMissingEvidenceLabel") })}>
            <span className="metric-tile-value" aria-hidden="true">—</span>
            <span className="metric-tile-caption">{t(locale, "commandCenter.unavailableMetricTemplate", { metric: t(locale, "commandCenter.attentionMissingEvidenceLabel") })}</span>
          </article>
        </div>
      )}
    </section>
  );
}

function CommercialActionsPanel({ locale, actions }: { locale: Locale; actions: readonly CommercialActionItem[] }) {
  return (
    <section aria-labelledby="cc-actions-title" className="cc-panel">
      <h2 id="cc-actions-title">{t(locale, "commandCenter.commercialActionsTitle")}</h2>
      {actions.length === 0 ? (
        <p className="cc-panel-empty">{t(locale, "commandCenter.commercialActionsEmpty")}</p>
      ) : (
        <ul className="cc-action-list">
          {actions.map((action) => (
            <li key={action.opportunityId} className="cc-action-row">
              <strong>{t(locale, `commercialAction.${action.recommendation}` as DictionaryKey)}</strong>
              <span>{action.whyNow}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VerificationSummary({ locale, verificationWorkValue }: { locale: Locale; verificationWorkValue: CommandCenterSummary["verificationWorkCount"]["value"] }) {
  return (
    <section aria-labelledby="cc-verification-title" className="cc-panel">
      <h2 id="cc-verification-title">{t(locale, "commandCenter.verificationSectionTitle")}</h2>
      <MetricTile locale={locale} kind="VERIFICATION_WORK" value={verificationWorkValue} />
      <p className="cc-panel-note">{t(locale, "commandCenter.verificationReadOnlyNote")}</p>
      <Link href="/verification" className="cc-panel-link">{t(locale, "commandCenter.verificationViewLink")}</Link>
    </section>
  );
}

function RadarCapability({ locale, sourceHealthCapability }: { locale: Locale; sourceHealthCapability: CommandCenterSummary["sourceHealthCapability"] }) {
  return (
    <section aria-labelledby="cc-radar-title" className="cc-panel">
      <h2 id="cc-radar-title">{t(locale, "commandCenter.radarCapabilityTitle")}</h2>
      <p>{t(locale, "commandCenter.radarCapabilityStatement")}</p>
      <p className="cc-panel-note">{t(locale, "shell.dataConnectionLabel")}: {t(locale, `capabilityState.${sourceHealthCapability}`)}</p>
    </section>
  );
}

function DataTrustLegend({ locale }: { locale: Locale }) {
  return (
    <aside className="cc-panel" aria-labelledby="cc-trust-title">
      <p className="overline">{t(locale, "commandCenter.trustPreviewOverline")}</p>
      <h2 id="cc-trust-title">{t(locale, "commandCenter.dataTrustTitle")}</h2>
      <p>{t(locale, "commandCenter.trustPreviewDescription")}</p>
      <div className="chip-stack">
        <TrustState state="VERIFIED" locale={locale} />
        <TrustState state="HUMAN_VERIFICATION_REQUIRED" locale={locale} />
        <CurrentnessBadge state="UNKNOWN" locale={locale} />
        <ScopeBadge scope="UNKNOWN" locale={locale} />
      </div>
    </aside>
  );
}
