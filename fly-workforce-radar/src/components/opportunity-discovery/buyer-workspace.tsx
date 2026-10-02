import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import type { BuyerInvestigationView } from "../../server/contact-intelligence/buyer-investigation";
import type { ProviderStatus } from "../../server/contact-intelligence/providers";
import type { PersonGroup } from "../../domain/buyer-intelligence";
import { discoveryCopy } from "./discovery-copy";
import { BuyerSettingsForm, InteractionForm, RejectPersonForm, StartBuyerForm, type BuyerSubjectRef } from "./buyer-forms";
import { ValidateContactForm } from "./contact-forms";

const FACTS = ["identified", "currentlyAssociated", "relevant", "contactable", "responsibilityConfirmed"] as const;

/**
 * Buyer identification for one organization (Radar signal or strategic company): buyer path first, then named
 * professionals with separate facts, then general corporate channels — which are never counted as people.
 */
/** Today's date in the business's time zone (America/Chicago), as YYYY-MM-DD, for the interaction form. */
export const todayInChicago = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export function BuyerWorkspace({ locale, subject, view, providers, today = todayInChicago() }: { readonly locale: Locale; readonly subject: BuyerSubjectRef; readonly view: BuyerInvestigationView; readonly providers: readonly ProviderStatus[]; readonly today?: string }) {
  const b = discoveryCopy(locale).buyer;
  const c = discoveryCopy(locale).contact;
  const org = view.organization;
  const when = (value: string) => formatDate(locale, new Date(value), { dateStyle: "medium", timeStyle: "short" });
  const day = (value: string) => formatDate(locale, new Date(`${value}T12:00:00Z`), { dateStyle: "medium" });
  const route = view.route;
  const r = b.route;
  const fnLabel = (id: string, fallback: string) => b.fn[id] ?? fallback;
  const emailConfigured = providers.find((provider) => provider.id === "HUNTER_EMAIL_VERIFIER")?.state === "AVAILABLE";
  const phoneConfigured = providers.find((provider) => provider.id === "PHONE_LOOKUP")?.state === "AVAILABLE";
  const queries = view.sources.filter((source) => source.query);
  const pages = view.sources.filter((source) => !source.query);

  const personCard = (person: PersonGroup) => (
    <li key={person.key} className="ct-card by-person">
      <div className="sig-card-head">
        {person.facts.relevant ? <span className={`sig-kind by-state by-state-${person.state.toLowerCase()}`}>{b.states[person.state]}</span> : <span className="sig-kind">{b.notTarget}</span>}
        <span className={`sig-kind${person.currency === "HISTORICAL" ? " ci-expired" : ""}`}>{b.currency[person.currency]}</span>
        {person.fn ? <span className="sig-kind">{b.targetFunction}: {fnLabel(person.fn.id, person.fn.label)}</span> : null}
      </div>
      <p className="ct-name">{person.name}{person.title ? <span> — {person.title}</span> : null}</p>
      <p className="dr-card-note">{org.name}{person.location ? ` · ${person.location}` : ""}{person.titles.length > 1 ? ` · ${person.titles.slice(1).join(" / ")}` : ""}</p>
      <dl className="ct-routes">
        <div><dt>{b.email}</dt><dd>{person.email ? <>{person.email.address}<small>{b.emailStatus[person.email.status]}</small></> : b.noEmail}</dd></div>
        <div><dt>{b.phone}</dt><dd>{person.phone ? <>{person.phone.number}<small>{b.phoneStatus[person.phone.status]}</small></> : b.noPhone}</dd></div>
        <div><dt>{b.authority}</dt><dd>{b.authorityState[person.facts.responsibilityConfirmed ? (person.interactions.some((item) => item.personReached && item.handlesExternalWorkforce === "YES") ? "CONFIRMED_BY_HUMAN" : "CONFIRMED_BY_EVIDENCE") : "NOT_CONFIRMED"]}</dd></div>
        <div><dt>{b.evidenceDate}</dt><dd>{person.lastEvidenceDate ? day(person.lastEvidenceDate) : b.currency.UNDATED}</dd></div>
      </dl>
      <ul className="ct-states">
        {FACTS.map((fact) => <li key={fact} className={person.facts[fact] ? "ci-status-supported" : "ci-status-unknown"}>{person.facts[fact] ? "✓" : "○"} {b.facts[fact]}</li>)}
      </ul>
      <p className="dr-card-note ci-action"><strong>{b.next}:</strong> {b.nextAction[person.nextAction]}</p>
      <details className="dr-details"><summary>{b.evidence} · {person.sources.length}</summary>
        <ul className="ci-list">{person.sources.map((source) => (
          <li key={source.candidateId}>
            <strong>{b.sourceType[source.sourceType]}</strong> · {b.currency[source.currency]}{source.sourceDate ? ` · ${day(source.sourceDate)}` : ""} · <a href={source.sourceUrl} target="_blank" rel="noreferrer noopener">{source.sourceUrl}</a>
            {source.quote ? <q className="ci-quote">{source.quote}</q> : null}
            {source.responsibilityEvidence ? <q className="ci-quote">{source.responsibilityEvidence}</q> : null}
          </li>
        ))}</ul>
      </details>
      {person.interactions.length ? (
        <div className="by-history"><strong>{b.history}</strong>
          <ul className="ci-list">{person.interactions.map((item) => (
            <li key={item.recordedAt}>{day(item.contactDate)} · {b.channelLabel[item.channel]} · {item.personReached ? b.reachedYes : b.reachedNo} · {b.handles} {b.handlesLabel[item.handlesExternalWorkforce]}
              {item.referredTo ? ` · ${b.referredTo}: ${item.referredTo}` : ""}{item.responsibleDepartment ? ` · ${b.correctContact}: ${item.responsibleDepartment}` : ""}{item.notes ? ` — ${item.notes}` : ""}{item.nextAction ? ` → ${item.nextAction}` : ""}</li>
          ))}</ul>
        </div>
      ) : null}
      <div className="ct-inline">
        {person.email ? <ValidateContactForm locale={locale} signalId={subject.signalId ?? ""} companyId={subject.companyId} contactId={person.primaryCandidateId} channel="EMAIL" configured={emailConfigured} /> : null}
        {person.phone && person.phone.status !== "CORPORATE_MAIN" ? <ValidateContactForm locale={locale} signalId={subject.signalId ?? ""} companyId={subject.companyId} contactId={person.primaryCandidateId} channel="PHONE" configured={phoneConfigured} /> : null}
        <RejectPersonForm locale={locale} subject={subject} contactId={person.primaryCandidateId} />
      </div>
      <details className="dr-details"><summary>{b.interaction}</summary><InteractionForm locale={locale} subject={subject} contactId={person.primaryCandidateId} today={today} /></details>
    </li>
  );

  return (
    <section className="sig-panel ci-panel ct-panel by-panel" aria-labelledby="by-title" id="contacts">
      <h2 id="by-title">{b.title}</h2>
      <p className="sig-panel-lede">{b.lede}</p>

      <div className={`by-path${route.person ? "" : " by-path-none"}`} aria-labelledby="by-path-title">
        <h3 id="by-path-title">{r.title} · {org.name}{!route.person ? <> · <span className="by-none">{b.noBuyer}</span></> : null}</h3>
        <dl className="ci-grid">
          <div><dt>{r.targetPerson}</dt><dd>{route.person ? <>{route.person.name}<small>{b.states[route.person.state]} · {b.currency[route.person.currency]}</small></> : r.none}</dd></div>
          <div><dt>{r.personTitle}</dt><dd>{route.person?.title ?? r.none}{route.person?.fn ? <small>{b.targetFunction}: {fnLabel(route.person.fn.id, route.person.fn.label)}</small> : null}</dd></div>
          <div className="ci-wide"><dt>{r.responsibility}</dt><dd>{route.responsibility ? <>{route.responsibility.text || r.humanEvidence}<small>{route.responsibility.kind === "HUMAN" ? r.humanEvidence : <a href={route.responsibility.sourceUrl ?? "#"} target="_blank" rel="noreferrer noopener">{r.source}</a>}</small></> : r.noResponsibility}</dd></div>
          <div><dt>{r.phone}</dt><dd>{route.phone ? <>{route.phone.number}{route.phone.label ? <small>{route.phone.label}</small> : null}{route.phone.matchedOffice ? <small>{r.officeLine}</small> : null}{route.phone.sourceUrl ? <small><a href={route.phone.sourceUrl} target="_blank" rel="noreferrer noopener">{r.source}</a></small> : null}</> : r.none}</dd></div>
          <div><dt>{r.phoneType}</dt><dd>{r.phoneClass[route.phoneClass]}</dd></div>
          <div><dt>{r.alternative}</dt><dd>{route.alternative ? <>{route.alternative.value}<small>{route.alternative.phoneKind ? c.phoneKind[route.alternative.phoneKind] : route.alternative.label ?? ""}{route.alternative.label && route.alternative.phoneKind ? ` · ${route.alternative.label}` : ""}</small></> : r.none}</dd></div>
          <div><dt>{r.department}</dt><dd>{r.departments[route.department]}{route.departmentEvidence ? <small>{r.departmentEvidence}: <q className="ci-quote">{route.departmentEvidence.quote}</q> <a href={route.departmentEvidence.url} target="_blank" rel="noreferrer noopener">{r.source}</a></small> : null}</dd></div>
          <div className="ci-wide"><dt>{r.question}</dt><dd>{r.questions[org.type]}</dd></div>
          <div className="ci-wide ci-action"><dt>{r.next}</dt><dd>{r.instruction[route.instruction]({ name: route.person?.name ?? "", office: route.phone?.label ?? "", number: route.phone?.number ?? "", department: r.departments[route.department] })}</dd></div>
          <div><dt>{r.verified}</dt><dd><ul className="ct-states">{route.verified.length ? route.verified.map((key) => <li key={key} className="ci-status-supported">✓ {r.verifiedLabel[key]}</li>) : <li>{r.none}</li>}</ul></dd></div>
          <div><dt>{r.pending}</dt><dd><ul className="ct-states">{route.pending.map((key) => <li key={key} className="ci-status-unknown">○ {r.pendingLabel[key]}</li>)}</ul></dd></div>
          {!route.person ? <div className="ci-wide"><dt>{b.sourcesChecked}</dt><dd>{view.sources.length}</dd></div> : null}
        </dl>
      </div>

      <dl className="ci-grid">
        <div><dt>{b.orgType}</dt><dd>{b.types[org.type]}<small>{b.typeSource[org.typeSource]}</small></dd></div>
        <div><dt>{c.officialDomain}</dt><dd>{org.officialDomain ? <>{org.officialDomain}<small>{org.domainBasis}</small></> : c.unknown}</dd></div>
        <div className="ci-wide"><dt>{b.functionsSearched}</dt><dd>{view.functions.filter((fn) => fn.selected).map((fn) => fnLabel(fn.id, fn.label)).join(" · ")}</dd></div>
        <div className="ci-wide"><dt>{c.providers}</dt><dd><ul className="ci-list">{providers.map((provider) => (
          <li key={provider.id} className={provider.state === "AVAILABLE" ? "ci-status-supported" : "ci-status-requires_confirmation"}>{c.providerName[provider.id]}: {c.providerState[provider.state]}{provider.state === "NOT_CONFIGURED" ? ` ${provider.requires.join(", ")}` : ""}</li>
        ))}</ul></dd></div>
      </dl>

      <StartBuyerForm locale={locale} subject={subject} started={Boolean(view.investigation)} askWebsite={!org.officialDomain} />
      {view.investigation ? (
        <p className="dr-note">{c.started} {when(view.investigation.startedAt)}{view.investigation.lastRunAt ? ` · ${b.lastRun} ${when(view.investigation.lastRunAt)}` : ""}{view.investigation.stale ? ` · ${b.stale}` : ""} · {b.cached} {b.noOutreach}</p>
      ) : <p className="dr-note">{b.notStarted} {b.noOutreach}</p>}
      <details className="dr-details"><summary>{b.settings}</summary>
        <BuyerSettingsForm locale={locale} subject={subject} organizationType={org.type} typeSource={org.typeSource} functions={view.functions.map((fn) => ({ ...fn, label: fnLabel(fn.id, fn.label) }))} website={org.officialDomain} />
      </details>

      <h3 className="ct-heading">{b.people} · {view.people.length}</h3>
      {view.people.length ? <ul className="ct-list">{view.people.map(personCard)}</ul> : <p className="po-empty">{b.noPeople}</p>}
      {view.otherPeople.length ? (
        <details className="dr-details"><summary>{b.otherPeople} · {view.otherPeople.length}</summary><ul className="ct-list">{view.otherPeople.map(personCard)}</ul></details>
      ) : null}

      <h3 className="ct-heading">{b.channels} · {view.channels.length}</h3>
      {view.channels.length ? (
        <ul className="ci-list by-channels">{view.channels.map((channel) => (
          <li key={channel.candidateId}>{channel.value} — {channel.kind === "PHONE_ROUTE" ? `${c.phoneKind[channel.phoneKind ?? "UNKNOWN"] ?? c.phoneKind.UNKNOWN}${channel.label ? ` · ${channel.label}` : ""}` : `${c.functionLabel}: ${(channel.label ?? "general").replaceAll("_", " ").toLowerCase()}`} · <a href={channel.sourceUrl} target="_blank" rel="noreferrer noopener">{c.source}</a></li>
        ))}</ul>
      ) : <p className="po-empty">{b.noChannels}</p>}

      <h3 className="ct-heading">{b.canonical} · {view.canonical.length}</h3>
      {org.companyId ? (view.canonical.length ? (
        <ul className="ci-list">{view.canonical.map((person) => (
          <li key={person.id}>{person.name}{person.title ? ` — ${person.title}` : ""} · {person.contactFunction.replaceAll("_", " ").toLowerCase()} · {person.verificationState.toLowerCase()}{person.fromInvestigation ? ` · ${b.fromInvestigation}` : ""}</li>
        ))}</ul>
      ) : <p className="po-empty">{b.canonicalNone}</p>) : <p className="po-empty">{b.noCompany}</p>}

      {view.sources.length ? (
        <details className="dr-details"><summary>{b.sourcesChecked} · {view.sources.length}</summary>
          {queries.length ? <><p className="dr-card-note"><strong>{b.queries}</strong></p><ul className="ci-list">{queries.map((item) => <li key={`${item.query}-${item.retrievedAt}`}>{item.query} — {item.status === "OK" ? b.queryState.OK : item.status} · {when(item.retrievedAt)}</li>)}</ul></> : null}
          <ul className="ci-list">{pages.map((item) => <li key={`${item.url}-${item.retrievedAt}`}>{item.url} — {item.status} · {when(item.retrievedAt)}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
