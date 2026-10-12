import type { ReactNode } from "react";
import type { BillingCadence } from "../../domain/commercial-terms";
import type { DerivedEconomicResult, EconomicFactTier, MoneyAmount, MoneyDelta, Rate, SignedRate } from "../../domain/economic-value";
import type { FundingRecoveryStatus } from "../../domain/working-capital-engine";
import type { ProfitabilityClassification } from "../../domain/scenario-engine";
import type { OpportunityEconomicsDetail, OpportunityEconomicsScenarioView } from "../../server/read-models/economics";
import type { Locale } from "../../i18n/locale";
import { formatDate, formatNumber, formatPercent } from "../../i18n/format";
import { t } from "../../i18n/translate";
import { EconomicFactTierBadge } from "../ui/status-primitives";

/**
 * Phase 4H. Presentation-only: reads already-computed certified 4D/4E/4F
 * results (via the read-model) and renders them. No wage/burden/billing/
 * cash-flow/scenario/comparison formula is reimplemented here -- every
 * number shown is exactly what the certified engines produced. UNKNOWN and
 * UNAVAILABLE are rendered explicitly and are never coerced to zero/blank.
 *
 * Read-only: this phase deliberately does not include operator editing
 * controls for the certified 4G mutation surfaces (commercial terms, burden
 * profile, scenario snapshot). See the Phase 4H implementation report for
 * this disclosed scope decision. Sensitivity is presented as a notice only,
 * for the same reason -- the certified 4F sensitivity engine requires
 * operator-supplied interactive test values, which have no input surface in
 * this read-only view.
 */

const formatDateTime = (locale: Locale, date: Date) => formatDate(locale, date, { dateStyle: "medium", timeStyle: "short" });

function formatMoney(locale: Locale, amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${formatNumber(locale, amount, { maximumFractionDigits: 2 })}`;
  }
}

function DerivedValue<T>({ result, locale, format, negative }: { result: DerivedEconomicResult<T>; locale: Locale; format: (value: T, tier: Exclude<EconomicFactTier, "UNKNOWN">) => ReactNode; negative?: boolean }) {
  if (result.state === "UNKNOWN") return <span className="economics-value economics-unknown">{t(locale, "economics.unknown")}</span>;
  if (result.state === "UNAVAILABLE") return <span className="economics-value economics-unavailable" title={result.reason}>{t(locale, "economics.unavailable")}</span>;
  return <span className={`economics-value economics-known${negative ? " economics-negative" : ""}`}><span>{format(result.value, result.tier)}</span><EconomicFactTierBadge tier={result.tier} locale={locale} /></span>;
}

function money(locale: Locale) {
  return (value: MoneyAmount | MoneyDelta) => formatMoney(locale, value.amount, value.currency);
}
function percent(locale: Locale) {
  return (value: Rate | SignedRate) => formatPercent(locale, value.value);
}

function MetricRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="economics-metric"><span className="economics-metric-label">{label}</span><span className="economics-metric-value">{children}</span></div>;
}
function HonestEmpty({ children }: { children: ReactNode }) {
  return <p className="detail-honest-empty">{children}</p>;
}

function recoveryLabel(locale: Locale, recovery: FundingRecoveryStatus): string {
  if (recovery.kind === "RECOVERED") return `${t(locale, "economics.recovery.RECOVERED")} — ${t(locale, "economics.overview.recoveryWeek")} ${recovery.weekIndex}`;
  return t(locale, `economics.recovery.${recovery.kind}`);
}

function classificationText(locale: Locale, classification: ProfitabilityClassification | null): string | null {
  if (!classification) return null;
  // Purely descriptive of the sign already computed by the certified engine.
  return classification;
}

function ScenarioOverview({ locale, scenario }: { locale: Locale; scenario: OpportunityEconomicsScenarioView }) {
  // Prefer complete economics; fall back to labor-only ONLY when complete is not known and labor-only is -- otherwise
  // show complete's own UNKNOWN/UNAVAILABLE state honestly (never silently substitute one for the other).
  const completeKnown = scenario.profitability.complete.grossProfit.state === "KNOWN";
  const laborOnlyKnown = scenario.profitability.laborOnly.grossProfit.state === "KNOWN";
  const useComplete = completeKnown || !laborOnlyKnown;
  const profitSide = useComplete ? scenario.profitability.complete : scenario.profitability.laborOnly;
  const wc = scenario.cashFlow.complete.workingCapital;
  return <div className="economics-overview">
    <p className="economics-overview-label">{useComplete ? t(locale, "economics.overview.completeLabel") : t(locale, "economics.overview.laborOnlyLabel")}</p>
    {!useComplete && <p className="detail-honest-empty">{t(locale, "economics.overview.laborOnlyNotice")}</p>}
    <MetricRow label={t(locale, "economics.overview.revenue")}>
      <DerivedValue result={scenario.economics.billing.completeTotalWorkforcePerWeek} locale={locale} format={money(locale)} />
    </MetricRow>
    <MetricRow label={t(locale, "economics.overview.employerCost")}>
      <DerivedValue result={scenario.economics.labor.completeTotalWorkforcePerWeek} locale={locale} format={money(locale)} />
    </MetricRow>
    <MetricRow label={t(locale, "economics.overview.grossProfit")}>
      <DerivedValue result={profitSide.grossProfit} locale={locale} negative={profitSide.classification === "LOSS"} format={(value) => {
        const classification = classificationText(locale, profitSide.classification);
        return <>{money(locale)(value)}{classification ? ` (${classification})` : ""}</>;
      }} />
    </MetricRow>
    <MetricRow label={t(locale, "economics.overview.grossMargin")}>
      <DerivedValue result={profitSide.grossMargin} locale={locale} negative={profitSide.classification === "LOSS"} format={percent(locale)} />
    </MetricRow>
    <MetricRow label={t(locale, "economics.overview.workingCapital")}>
      {wc.state === "UNKNOWN" && <span className="economics-value economics-unknown">{t(locale, "economics.unknown")}</span>}
      {wc.state === "UNAVAILABLE" && <span className="economics-value economics-unavailable" title={wc.reason}>{t(locale, "economics.unavailable")}</span>}
      {wc.state === "KNOWN" && <span className="economics-value economics-known"><span>{money(locale)(wc.value.workingCapitalRequirement)}</span><EconomicFactTierBadge tier={wc.tier} locale={locale} /></span>}
    </MetricRow>
    <MetricRow label={t(locale, "economics.overview.fundingNeededWeek")}>
      {wc.state === "KNOWN" ? (wc.value.fundingNeededWeek === null ? t(locale, "economics.overview.noFundingNeeded") : String(wc.value.fundingNeededWeek)) : (wc.state === "UNKNOWN" ? t(locale, "economics.unknown") : t(locale, "economics.unavailable"))}
    </MetricRow>
    <MetricRow label={t(locale, "economics.overview.recoveryStatus")}>
      {wc.state === "KNOWN" ? recoveryLabel(locale, wc.value.recovery) : (wc.state === "UNKNOWN" ? t(locale, "economics.unknown") : t(locale, "economics.unavailable"))}
    </MetricRow>
    {scenario.weakestTier && <MetricRow label={t(locale, "economics.overview.weakestTier")}><EconomicFactTierBadge tier={scenario.weakestTier} locale={locale} /></MetricRow>}
  </div>;
}

function billingCadenceLabel(locale: Locale, cadence: BillingCadence): string {
  return t(locale, `economics.billingCadenceOption.${cadence}`);
}

function CommercialTermsPanel({ locale, scenario }: { locale: Locale; scenario: OpportunityEconomicsScenarioView }) {
  const ct = scenario.commercialTerms;
  if (!ct) return <HonestEmpty>{t(locale, "economics.commercialTerms.none")}</HonestEmpty>;
  const terms = ct.contract;
  return <div className="economics-panel">
    <MetricRow label={t(locale, "economics.commercialTerms.billRate")}><DerivedValue result={toResult(terms.billRate)} locale={locale} format={money(locale)} /></MetricRow>
    <MetricRow label={t(locale, "economics.commercialTerms.overtimeBillBasis")}>
      {terms.overtimeBillBasis.tier === "UNKNOWN" ? <span className="economics-value economics-unknown">{t(locale, "economics.unknown")}</span> : <span className="economics-value economics-known">
        <span>{terms.overtimeBillBasis.value.kind === "RATE" ? `${t(locale, "economics.overtimeBillBasisKind.RATE")}: ${formatMoney(locale, terms.overtimeBillBasis.value.rate.amount, terms.overtimeBillBasis.value.rate.currency)}` : `${t(locale, "economics.overtimeBillBasisKind.MULTIPLIER")}: ${formatNumber(locale, terms.overtimeBillBasis.value.multiplier.value, { maximumFractionDigits: 2 })}×`}</span>
        <EconomicFactTierBadge tier={terms.overtimeBillBasis.tier} locale={locale} />
      </span>}
    </MetricRow>
    <MetricRow label={t(locale, "economics.commercialTerms.reimbursablePerDiem")}><DerivedValue result={toResult(terms.reimbursablePerDiem)} locale={locale} format={money(locale)} /></MetricRow>
    <MetricRow label={t(locale, "economics.commercialTerms.perDiemMarkup")}><DerivedValue result={toResult(terms.perDiemMarkup)} locale={locale} format={percent(locale)} /></MetricRow>
    <MetricRow label={t(locale, "economics.commercialTerms.paymentTermsDays")}><DerivedValue result={toResult(terms.paymentTerms)} locale={locale} format={(v) => String(v.days)} /></MetricRow>
    <MetricRow label={t(locale, "economics.commercialTerms.billingCadence")}><DerivedValue result={toResult(terms.billingCadence)} locale={locale} format={(v) => billingCadenceLabel(locale, v)} /></MetricRow>
    <MetricRow label={t(locale, "economics.commercialTerms.ruleVersion")}>{ct.ruleVersion}</MetricRow>
    <MetricRow label={t(locale, "economics.commercialTerms.evaluatedAt")}>{formatDateTime(locale, ct.evaluatedAt)}</MetricRow>
  </div>;
}

function toResult<T>(value: { tier: "UNKNOWN" } | { tier: Exclude<EconomicFactTier, "UNKNOWN">; value: T }): DerivedEconomicResult<T> {
  return value.tier === "UNKNOWN" ? { state: "UNKNOWN" } : { state: "KNOWN", tier: value.tier, value: value.value };
}

function LaborBurdenPanel({ locale, scenario }: { locale: Locale; scenario: OpportunityEconomicsScenarioView }) {
  const bp = scenario.burdenProfile;
  if (!bp) return <HonestEmpty>{t(locale, "economics.laborBurden.none")}</HonestEmpty>;
  return <div className="economics-panel">
    <MetricRow label={t(locale, "economics.laborBurden.burdenScope")}>{t(locale, `economics.burdenScopeLevel.${bp.scope.level}`)}</MetricRow>
    <MetricRow label={t(locale, "economics.laborBurden.burdenComponents")}>
      {bp.components.length === 0 ? <HonestEmpty>{t(locale, "economics.laborBurden.none")}</HonestEmpty> : <ul className="economics-burden-list">
        {bp.components.map((component, index) => <li key={`${component.type}-${index}`}>
          <strong>{t(locale, `economics.burdenComponentType.${component.type}`)}</strong>{" "}
          <DerivedValue result={toResult(component.rate)} locale={locale} format={percent(locale)} />
          <span className="economics-burden-applies">{t(locale, "economics.laborBurden.appliesTo")}: {component.appliesTo.map((portion) => t(locale, `economics.wagePortion.${portion}`)).join(", ")}</span>
        </li>)}
      </ul>}
    </MetricRow>
    <MetricRow label={t(locale, "economics.laborBurden.workerPerDiem")}><DerivedValue result={scenario.economics.labor.workerPerDiemCost} locale={locale} format={money(locale)} /></MetricRow>
  </div>;
}

function CashFlowTable({ locale, scenario }: { locale: Locale; scenario: OpportunityEconomicsScenarioView }) {
  const ledger = scenario.cashFlow.complete.ledger;
  if (ledger.state === "UNKNOWN") return <HonestEmpty>{t(locale, "economics.unknown")}</HonestEmpty>;
  if (ledger.state === "UNAVAILABLE") return <HonestEmpty>{ledger.reason}</HonestEmpty>;
  return <div className="economics-table-wrap">
    <table className="economics-table">
      <caption className="sr-only">{t(locale, "economics.cashFlow.title")}</caption>
      <thead><tr><th scope="col">{t(locale, "economics.cashFlow.week")}</th><th scope="col">{t(locale, "economics.cashFlow.cashOut")}</th><th scope="col">{t(locale, "economics.cashFlow.cashIn")}</th><th scope="col">{t(locale, "economics.cashFlow.cumulative")}</th></tr></thead>
      <tbody>{ledger.value.entries.map((entry) => <tr key={entry.weekIndex} className={entry.cumulativeCash.amount < 0 ? "economics-row-negative" : undefined}>
        <th scope="row">{entry.weekIndex}</th>
        <td>{formatMoney(locale, entry.totalOutflow.amount, entry.totalOutflow.currency)}</td>
        <td>{formatMoney(locale, entry.totalInflow.amount, entry.totalInflow.currency)}</td>
        <td>{formatMoney(locale, entry.cumulativeCash.amount, entry.cumulativeCash.currency)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function BlockersList({ locale, scenario }: { locale: Locale; scenario: OpportunityEconomicsScenarioView }) {
  if (scenario.blockingReasons.length === 0) return <HonestEmpty>{t(locale, "economics.blockers.none")}</HonestEmpty>;
  return <ul className="economics-blocker-list">{scenario.blockingReasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>;
}

function ScenarioBlock({ locale, scenario }: { locale: Locale; scenario: OpportunityEconomicsScenarioView }) {
  return <article className="economics-scenario" aria-labelledby={`economics-scenario-${scenario.snapshotId}`}>
    <header className="economics-scenario-header">
      <h3 id={`economics-scenario-${scenario.snapshotId}`}>{t(locale, `economics.scenarioLabel.${scenario.label}`)}</h3>
      <span className="economics-scenario-asof">{t(locale, "economics.commercialTerms.evaluatedAt")}: {formatDateTime(locale, scenario.asOf)}</span>
    </header>
    <ScenarioOverview locale={locale} scenario={scenario} />
    <div className="economics-subsections">
      <section aria-label={t(locale, "economics.commercialTerms.title")}><h4>{t(locale, "economics.commercialTerms.title")}</h4><CommercialTermsPanel locale={locale} scenario={scenario} /></section>
      <section aria-label={t(locale, "economics.laborBurden.title")}><h4>{t(locale, "economics.laborBurden.title")}</h4><LaborBurdenPanel locale={locale} scenario={scenario} /></section>
      <section aria-label={t(locale, "economics.cashFlow.title")}><h4>{t(locale, "economics.cashFlow.title")}</h4><p className="economics-caveat">{t(locale, "economics.cashFlow.monthlyLimitation")}</p><CashFlowTable locale={locale} scenario={scenario} /></section>
      <section aria-label={t(locale, "economics.blockers.title")}><h4>{t(locale, "economics.blockers.title")}</h4><BlockersList locale={locale} scenario={scenario} /></section>
      <section aria-label={t(locale, "economics.sensitivity.title")}><h4>{t(locale, "economics.sensitivity.title")}</h4><p className="economics-caveat">{t(locale, "economics.sensitivity.notice")}</p></section>
    </div>
  </article>;
}

function deltaMoney(locale: Locale, result: DerivedEconomicResult<MoneyDelta>): ReactNode {
  return <DerivedValue result={result} locale={locale} negative={result.state === "KNOWN" && result.value.amount < 0} format={(v) => (v.amount > 0 ? "+" : "") + formatMoney(locale, v.amount, v.currency)} />;
}
function deltaPercent(locale: Locale, result: DerivedEconomicResult<SignedRate>): ReactNode {
  return <DerivedValue result={result} locale={locale} negative={result.state === "KNOWN" && result.value.value < 0} format={(v) => (v.value > 0 ? "+" : "") + formatPercent(locale, v.value)} />;
}
function deltaWeeks(locale: Locale, result: DerivedEconomicResult<number>): ReactNode {
  return <DerivedValue result={result} locale={locale} negative={result.state === "KNOWN" && result.value < 0} format={(v) => (v > 0 ? "+" : "") + String(v)} />;
}

function ComparisonBlock({ locale, economics }: { locale: Locale; economics: OpportunityEconomicsDetail }) {
  if (economics.comparisons.length === 0) return <HonestEmpty>{t(locale, "economics.comparison.none")}</HonestEmpty>;
  return <div className="economics-table-wrap">
    <table className="economics-table">
      <caption className="sr-only">{t(locale, "economics.comparison.title")}</caption>
      <thead><tr><th scope="col" /><th scope="col">{t(locale, "economics.comparison.revenueDelta")}</th><th scope="col">{t(locale, "economics.comparison.employerCostDelta")}</th><th scope="col">{t(locale, "economics.comparison.grossProfitDelta")}</th><th scope="col">{t(locale, "economics.comparison.grossMarginDelta")}</th><th scope="col">{t(locale, "economics.comparison.workingCapitalDelta")}</th><th scope="col">{t(locale, "economics.comparison.recoveryWeekDelta")}</th></tr></thead>
      <tbody>{economics.comparisons.map((comparison, i) => <tr key={i}>
        <th scope="row">{t(locale, `economics.scenarioLabel.${comparison.from}`)} → {t(locale, `economics.scenarioLabel.${comparison.to}`)}</th>
        <td>{deltaMoney(locale, comparison.revenueDelta)}</td>
        <td>{deltaMoney(locale, comparison.employerCostDelta)}</td>
        <td>{deltaMoney(locale, comparison.grossProfitDelta)}</td>
        <td>{deltaPercent(locale, comparison.grossMarginDelta)}</td>
        <td>{deltaMoney(locale, comparison.workingCapitalDelta)}</td>
        <td>{deltaWeeks(locale, comparison.recoveryWeekDelta)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function OpportunityEconomicsSection({ locale, economics }: { locale: Locale; economics: OpportunityEconomicsDetail | null }) {
  if (!economics) return <HonestEmpty>{t(locale, "economics.unavailable")}</HonestEmpty>;
  if (economics.scenarios.length === 0) return <HonestEmpty>{t(locale, "economics.empty")}</HonestEmpty>;
  return <div className="economics-section">
    <p className="economics-label-note">{t(locale, "economics.labelNote")}</p>
    <div className="economics-scenario-list">{economics.scenarios.map((scenario) => <ScenarioBlock key={scenario.snapshotId} locale={locale} scenario={scenario} />)}</div>
    {economics.scenarios.length > 1 && <section aria-label={t(locale, "economics.comparison.title")} className="economics-comparison"><h3>{t(locale, "economics.comparison.title")}</h3><ComparisonBlock locale={locale} economics={economics} /></section>}
  </div>;
}
