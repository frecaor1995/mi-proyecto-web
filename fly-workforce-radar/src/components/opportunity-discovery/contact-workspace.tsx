import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import type { ContactInvestigationView } from "../../server/contact-intelligence/investigation";
import type { ProviderStatus } from "../../server/contact-intelligence/providers";
import { discoveryCopy } from "./discovery-copy";
import { ContactDecisionForm, StartInvestigationForm, ValidateContactForm } from "./contact-forms";

/** Contact investigation for one signal: organization identity, target functions, contacts with separate states. */
export function ContactWorkspace({ locale, signalId, view, providers }: { readonly locale: Locale; readonly signalId: string; readonly view: ContactInvestigationView; readonly providers: readonly ProviderStatus[] }) {
  const c = discoveryCopy(locale).contact;
  const org = view.organization;
  const when = (value: string) => formatDate(locale, new Date(value), { dateStyle: "medium", timeStyle: "short" });
  const emailConfigured = providers.find((provider) => provider.id === "HUNTER_EMAIL_VERIFIER")?.state === "AVAILABLE";
  const phoneConfigured = providers.find((provider) => provider.id === "PHONE_LOOKUP")?.state === "AVAILABLE";
  return (
    <section className="sig-panel ci-panel ct-panel" aria-labelledby="ct-title" id="contacts">
      <h2 id="ct-title">{c.title}</h2>
      <p className="sig-panel-lede">{c.lede}</p>
      {view.historicalSource ? <p className="ci-expired ct-warning">{c.historical}</p> : null}
      <dl className="ci-grid">
        <div><dt>{c.organization}</dt><dd>{org.name ?? c.unknown}{org.project ? <small>{c.project}: {org.project}</small> : null}</dd></div>
        <div><dt>{c.role}</dt><dd>{c.roles[org.role]}<small>{org.roleBasis}</small></dd></div>
        <div className="ci-wide"><dt>{c.officialDomain}</dt><dd>{org.officialDomain ? <>{org.officialDomain} <small>{org.domainBasis} ({c.needsConfirmation})</small></> : c.unknown}</dd></div>
        <div className="ci-wide"><dt>{c.targets}</dt><dd>{view.targets.map((target) => target.label).join(" · ")}</dd></div>
        <div className="ci-wide ci-action"><dt>{c.research}</dt><dd>{view.missingFunctions.length ? <ul className="ci-list">{view.missingFunctions.map((target) => (
          <li key={target.contactFunction}>{c.researchTask(target.label, org.name ?? c.unknown, org.officialDomain ? target.paths.map((path) => `${org.officialDomain}${path}`).join(", ") : "")}</li>
        ))}</ul> : "—"}</dd></div>
        <div className="ci-wide"><dt>{c.providers}</dt><dd><ul className="ci-list">{providers.map((provider) => (
          <li key={provider.id} className={provider.state === "AVAILABLE" ? "ci-status-supported" : "ci-status-requires_confirmation"}>{c.providerName[provider.id]}: {c.providerState[provider.state]}{provider.state === "NOT_CONFIGURED" ? ` ${provider.requires.join(", ")}` : ""}</li>
        ))}</ul></dd></div>
      </dl>
      <StartInvestigationForm locale={locale} signalId={signalId} started={Boolean(view.investigation)} />
      {view.investigation ? <p className="dr-note">{c.started} {when(view.investigation.startedAt)} · {c.noOutreach} {c.authority}</p> : <p className="dr-note">{c.notStarted}</p>}
      {view.retrievals.length ? (
        <details className="dr-details"><summary>{c.retrievals} · {view.retrievals.length}</summary>
          <ul className="ci-list">{view.retrievals.map((item) => <li key={`${item.url}-${item.retrievedAt}`}>{item.url} — {item.status}{item.httpStatus ? ` ${item.httpStatus}` : ""}</li>)}</ul>
        </details>
      ) : null}
      {view.investigation ? <h3 className="ct-heading">{c.candidates} · {view.candidates.length}</h3> : null}
      {view.investigation && !view.candidates.length ? <p className="po-empty">{c.none}</p> : null}
      <ul className="ct-list">
        {view.candidates.map((contact) => (
          <li key={contact.id} className="ct-card">
            <div className="sig-card-head">
              {contact.historical ? <span className="sig-kind ci-expired">{c.historicalBadge}</span> : null}
              <span className="sig-kind">{c.providerLabel[contact.provider]}</span>
              <span className="sig-kind">{c.functionLabel}: {contact.contactFunction.replaceAll("_", " ").toLowerCase()}</span>
            </div>
            <p className="ct-name">{contact.personName ?? (contact.email ? contact.email : contact.phone)}{contact.title ? <span> — {contact.title}</span> : null}</p>
            <dl className="ct-routes">
              <div><dt>Email</dt><dd>{contact.email ?? c.noEmail}</dd></div>
              <div><dt>{contact.phoneKind ? c.phoneKind[contact.phoneKind] : "Phone"}</dt><dd>{contact.phone ?? c.noPhone}</dd></div>
            </dl>
            <ul className="ct-states">
              <li className="ci-status-supported">✓ {c.states.discovered}</li>
              <li className={contact.attributed ? "ci-status-supported" : "ci-status-unknown"} title={contact.attributionBasis ?? undefined}>{contact.attributed ? "✓" : "○"} {contact.attributed ? c.states.attributed : c.states.notAttributed}{contact.attributionBasis ? ` — ${contact.attributionBasis}` : ""}</li>
              {contact.email ? <li className={contact.emailValidation?.result === "VALID" ? "ci-status-supported" : "ci-status-unknown"}>{c.states.email}: {contact.emailValidation ? `${c.validation[contact.emailValidation.result]} (${contact.emailValidation.provider}, ${when(contact.emailValidation.checkedAt)})` : c.states.notChecked}</li> : null}
              {contact.phone ? <li className={contact.phoneValidation?.result === "VALID" ? "ci-status-supported" : "ci-status-unknown"}>{c.states.phone}: {contact.phoneValidation ? `${c.validation[contact.phoneValidation.result]} (${contact.phoneValidation.provider}, ${when(contact.phoneValidation.checkedAt)})` : c.states.notChecked}</li> : null}
              <li className={contact.decision?.decision === "CONFIRMED" ? "ci-status-supported" : "ci-status-unknown"}>{c.states.human}: {contact.decision ? `${c.decisions[contact.decision.decision]} · ${when(contact.decision.decidedAt)}` : c.states.notChecked}</li>
            </ul>
            <p className="dr-card-note"><strong>{c.why}:</strong> {contact.priority.reason}</p>
            <p className="dr-card-note"><strong>{c.source}:</strong> <a href={contact.sourceUrl} target="_blank" rel="noreferrer noopener">{contact.sourceUrl}</a>{contact.quote ? <q className="ci-quote">{contact.quote}</q> : null}</p>
            <div className="ct-inline">
              {contact.email ? <ValidateContactForm locale={locale} signalId={signalId} contactId={contact.id} channel="EMAIL" configured={emailConfigured} /> : null}
              {contact.phone ? <ValidateContactForm locale={locale} signalId={signalId} contactId={contact.id} channel="PHONE" configured={phoneConfigured} /> : null}
            </div>
            <ContactDecisionForm locale={locale} signalId={signalId} contactId={contact.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}
