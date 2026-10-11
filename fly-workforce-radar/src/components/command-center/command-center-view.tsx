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
import { commercialActionExplanation } from "./commercial-action-explanation";
import type { CommandCenterDemoMetrics, CommandCenterRecommendation } from "../../server/command-center/get-command-center-summary";
import styles from "./command-center-view.module.css";

/** View-only copy for recommendation identity and the DEMO block (EN/ES); follows the selected language. */
const VIEW_COPY = {
  "en-US": {
    untitled: "Untitled opportunity", company: "Company", companyUnconfirmed: "Company not confirmed (no canonical link)", openOpportunity: "Open opportunity",
    demoActions: (n: number) => `DEMO / test recommendations (${n}) — not real work`,
    demoMetrics: (hot: number, near: number, prioritized: number, opportunities: number) => `${opportunities} DEMO opportunit${opportunities === 1 ? "y" : "ies"} excluded from these counts (HOT ${hot} · Near Ready ${near} · prioritized ${prioritized}).`,
  },
  "es-US": {
    untitled: "Oportunidad sin título", company: "Empresa", companyUnconfirmed: "Empresa no confirmada (sin vínculo canónico)", openOpportunity: "Abrir oportunidad",
    demoActions: (n: number) => `Recomendaciones DEMO / prueba (${n}) — no son trabajo real`,
    demoMetrics: (hot: number, near: number, prioritized: number, opportunities: number) => `${opportunities} oportunidad${opportunities === 1 ? "" : "es"} DEMO excluida${opportunities === 1 ? "" : "s"} de estos indicadores (HOT ${hot} · Casi listas ${near} · priorizadas ${prioritized}).`,
  },
} as const;

/** A recommendation; title/company/isDemo are present when it comes from the Command Center page data. */
export type CommandCenterActionView = CommercialActionItem & Partial<Pick<CommandCenterRecommendation, "title" | "companyId" | "companyName" | "isDemo">>;

export interface CommandCenterViewProps {
  readonly locale: Locale;
  readonly summary: CommandCenterSummary;
  /** REAL recommendations. */
  readonly commercialActions: readonly CommandCenterActionView[];
  /** DEMO recommendations, rendered apart and labelled; never counted as real. */
  readonly demoCommercialActions?: readonly CommandCenterActionView[];
  /** DEMO counts excluded from the real HOT / Near Ready / prioritized metrics. */
  readonly demoMetrics?: CommandCenterDemoMetrics | null;
  /**
   * Only set when a real, evidence-backed "as of" instant is known. `null`
   * in the honest default state -- the page must never call `new Date()`
   * and present render time as if it were data freshness (UI-3 section 16).
   */
  readonly dataAsOf: Date | null;
}

export function CommandCenterView({ locale, summary, commercialActions, demoCommercialActions = [], demoMetrics = null, dataAsOf }: CommandCenterViewProps) {
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

      <AttentionSection locale={locale} summary={summary} demoMetrics={demoMetrics} />

      <div className="cc-two-column">
        <CommercialActionsPanel locale={locale} actions={commercialActions} demoActions={demoCommercialActions} />
        <VerificationSummary locale={locale} verificationWorkValue={summary.verificationWorkCount.value} />
      </div>

      <RadarCoverageSection locale={locale} summary={summary} />
    </div>
  );
}

/**
 * Primary area: "What requires attention today?" -- only the metrics that
 * are truthfully KNOWN (HOT, Near Ready, Human Verification, prioritized
 * Commercial Actions). Unsupported metrics never appear here (see
 * RadarCoverageSection below) so the primary dashboard experience is never
 * dominated by UNKNOWN tiles.
 */
function AttentionSection({ locale, summary, demoMetrics }: { locale: Locale; summary: CommandCenterSummary; demoMetrics: CommandCenterDemoMetrics | null }) {
  const priorityMetrics: { readonly kind: Parameters<typeof MetricTile>[0]["kind"]; readonly value: CommandCenterSummary["verificationWorkCount"]["value"] }[] = [
    { kind: "HOT_OPPORTUNITIES", value: summary.hotCount.value },
    { kind: "NEAR_READY_OPPORTUNITIES", value: summary.nearReadyCount.value },
    { kind: "VERIFICATION_WORK", value: summary.verificationWorkCount.value },
    { kind: "PRIORITIZED_ACTIONS", value: summary.prioritizedActionCount.value },
  ];
  const allKnownZero = priorityMetrics.every((metric) => metric.value.state === "KNOWN" && metric.value.value === 0);

  return (
    <section aria-labelledby="attention-title" className="cc-section cc-section-primary">
      <div className="section-heading">
        <p className="overline">{t(locale, "commandCenter.attentionOverline")}</p>
        <h2 id="attention-title">{t(locale, "commandCenter.attentionTitle")}</h2>
      </div>
      <div className="metric-band">
        {priorityMetrics.map((metric) => (
          <MetricTile key={metric.kind} locale={locale} kind={metric.kind} value={metric.value} />
        ))}
      </div>
      {allKnownZero ? <p className="cc-no-attention">{t(locale, "commandCenter.noAttentionItems")}</p> : null}
      {demoMetrics && demoMetrics.opportunities ? <p className={styles.demoNote}><em className="demo-badge">DEMO</em>{VIEW_COPY[locale].demoMetrics(demoMetrics.hot, demoMetrics.nearReady, demoMetrics.prioritized, demoMetrics.opportunities)}</p> : null}
    </section>
  );
}

function ActionRow({ locale, action }: { locale: Locale; action: CommandCenterActionView }) {
  const c = VIEW_COPY[locale];
  return (
    <li className={`cc-action-row${action.isDemo ? ` ${styles.demoRow}` : ""}`}>
      <Link className={styles.opportunity} href={`/opportunities/${action.opportunityId}`} aria-label={`${c.openOpportunity}: ${action.title ?? c.untitled}`}>
        {action.isDemo ? <em className="demo-badge">DEMO</em> : null}{action.title ?? c.untitled}
      </Link>
      {action.companyName && action.companyId
        ? <small className={styles.company}>{c.company}: <Link href={`/companies/${action.companyId}`}>{action.companyName}</Link></small>
        : <small className={styles.unconfirmed}>{c.companyUnconfirmed}</small>}
      <strong>{t(locale, `commercialAction.${action.recommendation}` as DictionaryKey)}</strong>
      <span data-rule-explanation={action.whyNow}>{commercialActionExplanation(locale, action)}</span>
    </li>
  );
}

function CommercialActionsPanel({ locale, actions, demoActions }: { locale: Locale; actions: readonly CommandCenterActionView[]; demoActions: readonly CommandCenterActionView[] }) {
  return (
    <section aria-labelledby="cc-actions-title" className="cc-panel">
      <h2 id="cc-actions-title">{t(locale, "commandCenter.commercialActionsTitle")}</h2>
      {actions.length === 0 ? (
        <p className="cc-panel-empty">{t(locale, "commandCenter.commercialActionsEmpty")}</p>
      ) : (
        <ul className="cc-action-list">
          {actions.map((action) => <ActionRow key={action.opportunityId} locale={locale} action={action} />)}
        </ul>
      )}
      {demoActions.length ? (
        <details className={styles.demoBlock}>
          <summary>{VIEW_COPY[locale].demoActions(demoActions.length)}</summary>
          <ul className="cc-action-list">{demoActions.map((action) => <ActionRow key={action.opportunityId} locale={locale} action={action} />)}</ul>
        </details>
      ) : null}
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

function RadarCoverageSection({ locale, summary }: { locale: Locale; summary: CommandCenterSummary }) {
  return (
    <section className="cc-section" aria-labelledby="cc-coverage-title">
      <div className="section-heading">
        <p className="overline">{t(locale, "commandCenter.radarCapabilityTitle")}</p>
        <h2 id="cc-coverage-title" className="sr-only">{t(locale, "commandCenter.metricsSectionTitle")}</h2>
      </div>
      <div className="metric-band metric-band-compact">
        <MetricTile locale={locale} kind="ACTIONABLE_ROUTES" value={summary.actionableRoutesCount.value} />
        <MetricTile locale={locale} kind="STALE_EVIDENCE" value={summary.staleEvidenceCount.value} />
        <MetricTile locale={locale} kind="CONFLICTS" value={summary.conflictCount.value} />
        <MetricTile locale={locale} kind="BLOCKED_ITEMS" value={summary.blockedCount.value} />
        <article className="metric-tile metric-tile-unavailable" aria-label={t(locale, "commandCenter.unavailableMetricTemplate", { metric: t(locale, "commandCenter.attentionMissingEvidenceLabel") })}>
          <span className="metric-tile-value" aria-hidden="true">—</span>
          <span className="metric-tile-caption">{t(locale, "commandCenter.unavailableMetricTemplate", { metric: t(locale, "commandCenter.attentionMissingEvidenceLabel") })}</span>
        </article>
      </div>
      <div className="cc-two-column">
        <RadarCapability locale={locale} sourceHealthCapability={summary.sourceHealthCapability} />
        <DataTrustLegend locale={locale} />
      </div>
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
