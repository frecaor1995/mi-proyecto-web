import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import { t } from "../../i18n/translate";
import type { CompanyDetailView as CompanyDetailData } from "../../server/read-models/company-detail";
import type { CompanyDetailResult } from "../../server/company-intelligence/get-company-intelligence";
import { CurrentnessBadge, TrustState } from "../ui/status-primitives";
import { ErrorState } from "../ui/foundation";

const formatDateTime = (value: string, locale: Locale) => formatDate(locale, new Date(value), { dateStyle: "medium", timeStyle: "short" });

export function CompanyIntelligenceDetailView({ locale, result }: { readonly locale: Locale; readonly result: CompanyDetailResult }) {
  if (result.state !== "READY") return <StateView locale={locale} state={result.state} />;
  const d = result.detail;
  const unknown = t(locale, "companyDetail.unknown");
  return (
    <div className="page-stack company-detail-view">
      <Link className="detail-back" href="/companies">← {t(locale, "companyDetail.back")}</Link>
      <header className="detail-hero">
        <div className="detail-hero-main">
          <p className="overline">{t(locale, "companyDetail.eyebrow")}</p>
          <h1>{d.overview.displayName ?? unknown}</h1>
          <p>{t(locale, "companyDetail.description")}</p>
          <div className="detail-reference"><span>{t(locale, "companyDetail.reference")}</span><code>{d.overview.companyId}</code></div>
        </div>
        <div className="detail-status-stack">
          <span className="detail-readonly">{t(locale, "companyDetail.readOnly")}</span>
          <CurrentnessBadge state={d.overview.currentness} locale={locale} />
        </div>
      </header>
      <div className="detail-layout">
        <main className="detail-main">
          <Section title={t(locale, "companyDetail.section.overview")} index="01">
            <div className="detail-grid">
              <Fact label={t(locale, "companyDetail.label.company")} value={d.overview.displayName ?? unknown} />
              <Fact label={t(locale, "companyDetail.label.identifier")} value={d.overview.companyId} />
              <Fact label={t(locale, "companyDetail.label.currentness")} value={<CurrentnessBadge state={d.overview.currentness} locale={locale} />} />
            </div>
            {d.overview.roles.length ? (
              <ul className="role-list">
                {d.overview.roles.map((role, i) => <li key={i}><strong>{role.role}</strong><TrustState state={role.verificationState} locale={locale} /><span>{role.basis}</span></li>)}
              </ul>
            ) : null}
          </Section>
          <Section title={t(locale, "companyDetail.section.opportunities")} index="02">
            {d.relatedOpportunities.length ? (
              <ul className="related-opportunity-list">
                {d.relatedOpportunities.map((opportunity) => (
                  <li key={opportunity.opportunityId}>
                    <Link href={`/opportunities/${encodeURIComponent(opportunity.opportunityId)}`}><strong>{opportunity.title ?? unknown}</strong></Link>
                    <span>{opportunity.location ?? unknown}</span>
                    <CurrentnessBadge state={opportunity.currentness} locale={locale} />
                  </li>
                ))}
              </ul>
            ) : <HonestEmpty>{t(locale, "companyDetail.empty.opportunities")}</HonestEmpty>}
          </Section>
          <Section title={t(locale, "companyDetail.section.contacts")} index="03">
            {d.contacts.length ? (
              <ul className="contact-list">
                {d.contacts.map((contact, i) => (
                  <li key={i}>
                    <strong>{contact.name ?? unknown}</strong>
                    <span>{contact.title ?? unknown}</span>
                    <span>{contact.routeType ?? unknown} · {contact.routeTarget ?? unknown}</span>
                    <div><TrustState state={contact.trustState} locale={locale} /><CurrentnessBadge state={contact.currentness} locale={locale} /></div>
                  </li>
                ))}
              </ul>
            ) : <HonestEmpty>{t(locale, "companyDetail.empty.contacts")}</HonestEmpty>}
          </Section>
          <Section title={t(locale, "companyDetail.section.vendorRoute")} index="04">
            <HonestEmpty>{t(locale, "companyDetail.empty.vendorRoute")}</HonestEmpty>
          </Section>
          <Section title={t(locale, "companyDetail.section.evidence")} index="05">
            {d.evidence.length ? (
              <ol className="evidence-timeline">
                {d.evidence.map((item) => (
                  <li key={item.evidenceId}>
                    <span className="timeline-node" />
                    <div className="evidence-head">
                      <strong>{item.evidenceType}</strong>
                      <div><TrustState state={item.verificationState} locale={locale} /><CurrentnessBadge state={item.currentness} locale={locale} /></div>
                    </div>
                    <dl>
                      <Meta label={t(locale, "companyDetail.label.source")} value={<a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a>} />
                      <Meta label={t(locale, "companyDetail.label.captured")} value={formatDateTime(item.capturedAt, locale)} />
                      <Meta label={t(locale, "companyDetail.label.claim")} value={item.supportedStatementSummary ?? unknown} />
                      <Meta label={t(locale, "companyDetail.label.provenance")} value={item.evidenceId} />
                    </dl>
                  </li>
                ))}
              </ol>
            ) : <HonestEmpty>{t(locale, "companyDetail.empty.evidence")}</HonestEmpty>}
          </Section>
        </main>
        <aside className="detail-rail">
          <RailSection title={t(locale, "companyDetail.section.manpower")}><Manpower locale={locale} detail={d} /></RailSection>
          <RailSection title={t(locale, "companyDetail.section.verification")}><Verification locale={locale} detail={d} /></RailSection>
          <RailSection title={t(locale, "companyDetail.section.gaps")}><Gaps locale={locale} detail={d} /></RailSection>
        </aside>
      </div>
    </div>
  );
}

function StateView({ locale, state }: { locale: Locale; state: "NOT_FOUND" | "UNAVAILABLE" | "ERROR" }) {
  const base = state === "NOT_FOUND" ? "notFound" : state === "UNAVAILABLE" ? "unavailable" : "error";
  return (
    <div className="page-stack detail-state">
      <Link className="detail-back" href="/companies">← {t(locale, "companyDetail.back")}</Link>
      <ErrorState locale={locale} title={t(locale, `companyDetail.state.${base}Title`)} description={t(locale, `companyDetail.state.${base}Description`)} />
    </div>
  );
}
function Section({ title, index, children }: { title: string; index: string; children: ReactNode }) {
  return <section className="detail-section"><header><span>{index}</span><h2>{title}</h2></header>{children}</section>;
}
function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="detail-rail-section"><h2>{title}</h2>{children}</section>;
}
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="detail-fact"><span>{label}</span><strong>{value}</strong></div>;
}
function Meta({ label, value }: { label: string; value: ReactNode }) {
  return <><dt>{label}</dt><dd>{value}</dd></>;
}
function HonestEmpty({ children }: { children: ReactNode }) {
  return <p className="detail-honest-empty">{children}</p>;
}
function Manpower({ locale, detail: d }: { locale: Locale; detail: CompanyDetailData }) {
  if (!d.manpowerAcceptance) return <HonestEmpty>{t(locale, "companyDetail.empty.manpower")}</HonestEmpty>;
  const a = d.manpowerAcceptance;
  const label = a.accepted === true ? "positive" : a.accepted === false ? "negative" : a.trustState === "CANDIDATE" ? "candidate" : "unknown";
  return (
    <div className={`acceptance-block acceptance-${label}`}>
      <strong>{t(locale, `companyDetail.manpower.${label}`)}</strong>
      <TrustState state={a.trustState} locale={locale} />
      <CurrentnessBadge state={a.currentness} locale={locale} />
      <Fact label={t(locale, "companyDetail.label.result")} value={a.result} />
      <Fact label={t(locale, "companyDetail.label.reason")} value={a.reason || t(locale, "companyDetail.unknown")} />
    </div>
  );
}
function Verification({ locale, detail: d }: { locale: Locale; detail: CompanyDetailData }) {
  return d.humanVerification.length ? (
    <ul className="verification-list">
      {d.humanVerification.map((item) => (
        <li key={item.id}>
          <Link href={`/verification/${encodeURIComponent(item.id)}`}><strong>{item.verificationObjective}</strong></Link>
          <span>{item.status}</span>
          <CurrentnessBadge state={item.currentness} locale={locale} />
        </li>
      ))}
    </ul>
  ) : <HonestEmpty>{t(locale, "companyDetail.empty.verification")}</HonestEmpty>;
}
function Gaps({ locale, detail: d }: { locale: Locale; detail: CompanyDetailData }) {
  return d.gaps.length ? (
    <ul className="gap-list">{d.gaps.map((gap) => <li key={gap}>{t(locale, `companyDetail.gap.${gap}`)}</li>)}</ul>
  ) : <HonestEmpty>{t(locale, "companyDetail.empty.gaps")}</HonestEmpty>;
}
