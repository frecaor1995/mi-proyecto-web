import type { Locale } from "../../i18n/locale";
import { latestSupplierAnswer, supplierAnswerEffect, type RecordedSupplierAnswer } from "../../domain/external-supplier-answer";
import { getProductionSqlClient } from "../../server/database/production-sql-client";
import { catalogKeyForName, loadSupplierAnswers } from "../../server/discovery-intelligence/external-supplier-answers";
import { ExternalSupplierAnswerForm } from "./external-supplier-answer-form";
import { supplierCopy } from "./intelligence-copy";

/** Current answer, what it means for this company only, and the immutable history (newest first). */
export function SupplierAnswerSummary({ locale, answers }: { readonly locale: Locale; readonly answers: readonly RecordedSupplierAnswer[] }) {
  const t = supplierCopy(locale);
  const latest = latestSupplierAnswer(answers);
  const effect = supplierAnswerEffect(latest);
  return (
    <div className="supplier-answer-summary">
      <p><b>{t.current}:</b> {t.answers[effect.state]}{latest?.conversationDate ? ` · ${latest.conversationDate}` : ""}{latest?.responderName ? ` · ${latest.responderName}` : ""}{latest?.responderRole ? ` (${latest.responderRole})` : ""}</p>
      <p className="sig-muted">{t.effects[effect.state]}{effect.b2bPriority === "LOWERED_OWN_AGENCY" ? ` ${t.lowered}` : ""}{effect.commercialSignal ? ` ${t.signal}` : ""}</p>
      {latest?.nextAction ? <p><b>{t.nextAction}:</b> {latest.nextAction}</p> : null}
      {answers.length ? <details><summary>{t.history} · {answers.length}</summary><ol className="sig-history">{answers.map((a) => <li key={a.evidenceId}>
        <strong>{t.answers[a.answer]}</strong> <span>{a.conversationDate ?? "—"} · {a.channel ? t.channels[a.channel as keyof typeof t.channels] ?? a.channel : "—"} · {t.recordedBy} {a.recordedBy ?? "—"} · {a.recordedAt.slice(0, 10)}</span>
        {a.responderName || a.responderRole ? <p>{[a.responderName, a.responderRole].filter(Boolean).join(" · ")}</p> : null}
        {a.summary ? <p>{a.summary}</p> : null}{a.evidenceReference ? <p><small>{t.evidence}: {a.evidenceReference}</small></p> : null}
      </li>)}</ol></details> : null}
    </div>
  );
}

/** Phase 3A Company Detail: the supplier question for a canonical company (loads its own answers; read-only DB access). */
export async function CompanySupplierAnswers({ locale, companyId, companyName, canWrite }: { readonly locale: Locale; readonly companyId: string; readonly companyName: string; readonly canWrite: boolean }) {
  const t = supplierCopy(locale);
  const client = getProductionSqlClient();
  const catalogKey = catalogKeyForName(companyName);
  const answers = client ? await loadSupplierAnswers(client, { catalogKey, companyId, companyName }).catch(() => []) : [];
  return (
    <section className="ct-heading-block" id="external-suppliers">
      <h3 className="ct-heading">{t.question}</h3>
      <SupplierAnswerSummary locale={locale} answers={answers} />
      {canWrite ? <ExternalSupplierAnswerForm locale={locale} catalogKey={catalogKey} companyId={companyId} companyName={companyName} /> : null}
    </section>
  );
}
