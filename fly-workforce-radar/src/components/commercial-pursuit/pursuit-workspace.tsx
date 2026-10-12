import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import type { PursuitPageData, PursuitPermissions } from "../../server/commercial-pursuit/get-pursuit-page";
import type { PainSignalView, StaffRequestView } from "../../server/commercial-pursuit/pursuit-store";
import { pursuitCopy } from "./pursuit-copy";
import { ActivityForm, PainForm, ReviewPainForm, RoleForm, RunMatchingForm, StaffRequestForm } from "./pursuit-forms";

/**
 * Phase 3A commercial pursuit workspace for one opportunity. DEMAND (pain evidence), PURSUIT (route, roles, activities,
 * next action) and RESULT (outcomes, staff requests) are shown separately; nothing here sends anything to anyone.
 */
export function PursuitWorkspace({ locale, data, permissions }: { readonly locale: Locale; readonly data: PursuitPageData; readonly permissions: PursuitPermissions }) {
  const c = pursuitCopy(locale);
  const { view } = data;
  const o = view.opportunity;
  const day = (value: string | null) => (value ? formatDate(locale, new Date(value.length === 10 ? `${value}T12:00:00Z` : value), { dateStyle: "medium" }) : c.unknown);
  const operator = (id: string | null) => data.operators.find((x) => x.id === id)?.label ?? c.unknown;
  const contacts = view.contactOptions;
  const yesNo = (value: boolean) => (value ? c.yes : c.no);

  return (
    <div className="page-stack">
      <div className="page-actions">
        <Link className="button button-secondary" href={`/opportunities/${o.id}`}>{c.back}</Link>
        <Link className="button button-secondary" href="/opportunities/pursuits">{c.backList}</Link>
        {o.companyId ? <Link className="button button-secondary" href={`/companies/${o.companyId}#contacts`}>{c.companyLink}</Link> : null}
      </div>
      <section className="sig-panel ci-panel ct-panel" aria-labelledby="cp-title" id="pursuit">
        <h2 id="cp-title">{c.title} · {o.title ?? o.id}</h2>
        <p className="sig-panel-lede">{c.lede}</p>
        <p className="dr-note">{o.companyName ?? c.unknown}{o.origin ? ` · ${c.origin[o.origin] ?? o.origin}` : ""} · {c.noOutreach}</p>
        {!permissions.canWrite ? <p className="dr-note">{c.readOnly}</p> : null}

        <h3 className="ct-heading">{c.why}</h3>
        <p className="dr-card-note">{c.dimensionsNote}</p>
        <dl className="ci-grid">
          <div><dt>{c.pain}</dt><dd>{c.painLevel[view.pain.level]}<small>{view.pain.types.map((t) => c.painTypes[t]).join(" · ") || c.noPain}</small><small>{c.painCounts(view.pain.usable, view.pain.withheld)}</small></dd></div>
          <div><dt>{c.access}</dt><dd>{c.accessLevel[view.access.level]}<small>{view.access.factors.map((f) => c.factor[f]).join(" · ") || c.routeNone}</small></dd></div>
          <div><dt>{c.fit}</dt><dd>{c.fitLevel[view.fit.level]}{view.fit.level !== "UNKNOWN" && view.fit.level !== "NOT_EVALUATED" ? <small>{c.fitCounts(view.fit.strong, view.fit.possible, view.fit.requested)}</small> : null}</dd></div>
        </dl>
        <h3 className="ct-heading">{c.truth}</h3>
        <p className="dr-card-note">{c.truthNote}</p>
        <ul className="ct-states">
          <li className={view.truth.laborDemandEvidence ? "ci-status-supported" : "ci-status-unknown"}>{view.truth.laborDemandEvidence ? "✓" : "○"} {c.laborDemand}: {yesNo(view.truth.laborDemandEvidence)}</li>
          <li className={view.truth.externalLaborPurchasing === "CONFIRMED" ? "ci-status-supported" : "ci-status-unknown"}>{view.truth.externalLaborPurchasing === "CONFIRMED" ? "✓" : "○"} {c.externalPurchasing}: {c.purchasing[view.truth.externalLaborPurchasing]}</li>
          <li className={view.truth.conversationConfirmed ? "ci-status-supported" : "ci-status-unknown"}>{view.truth.conversationConfirmed ? "✓" : "○"} {c.conversation}: {yesNo(view.truth.conversationConfirmed)}</li>
          <li className={view.truth.staffRequest ? "ci-status-supported" : "ci-status-unknown"}>{view.truth.staffRequest ? "✓" : "○"} {c.staffRequestKnown}: {yesNo(view.truth.staffRequest)}</li>
        </ul>

        <dl className="ci-grid">
          <div><dt>{c.status}</dt><dd>{c.statuses[view.pipeline.status]}{view.pipeline.result ? <small>{c.results[view.pipeline.result]}</small> : null}</dd></div>
          <div><dt>{c.stage}</dt><dd>{c.stages[view.pipeline.currentStage]}</dd></div>
          <div><dt>{c.maxStage}</dt><dd>{c.stages[view.pipeline.maxStageReached]}</dd></div>
          <div className="ci-wide ci-action"><dt>{c.nextAction}</dt><dd>{view.nextAction
            ? <>{view.nextAction.action}<small className={view.nextAction.overdue ? "ci-expired" : ""}>{c.due}: {day(view.nextAction.due)}{view.nextAction.overdue ? ` · ${c.overdue}` : ""} · {c.owner}: {operator(view.nextAction.ownerOperatorId)}</small></>
            : c.nextNone}</dd></div>
        </dl>
        <p className="dr-card-note">{c.stageNote}</p>

        <h3 className="ct-heading">{c.roles}</h3>
        <dl className="ci-grid">
          <div><dt>{c.painOwner}</dt><dd>{view.roles.painOwner ? <>{view.roles.painOwner.personName}{view.roles.painOwner.personTitle ? <small>{view.roles.painOwner.personTitle}</small> : null}<small>{view.roles.painOwner.basis}</small></> : c.noneYet}</dd></div>
          <div><dt>{c.commercialContact}</dt><dd>{view.roles.commercialContact ? <>{view.roles.commercialContact.personName}{view.roles.commercialContact.personTitle ? <small>{view.roles.commercialContact.personTitle}</small> : null}<small>{view.roles.commercialContact.basis}</small></> : c.noneYet}</dd></div>
        </dl>
        <p className="dr-card-note">{c.rolesNote}</p>
        {permissions.canWrite ? <details className="dr-details"><summary>{c.designate}</summary><RoleForm locale={locale} opportunityId={o.id} contacts={contacts} /></details> : null}

        <h3 className="ct-heading">{c.route}</h3>
        {view.route ? (
          <dl className="ci-grid">
            <div><dt>{c.routePerson}</dt><dd>{view.route.person?.name ?? c.noneYet}{view.route.person?.title ? <small>{view.route.person.title}</small> : null}</dd></div>
            <div><dt>{c.routePhone}</dt><dd>{view.route.phone?.number ?? c.unknown}<small>{c.phoneClass[view.route.phoneClass]}</small></dd></div>
            <div><dt>{c.routeDepartment}</dt><dd>{view.route.department.replaceAll("_", " ").toLowerCase()}</dd></div>
          </dl>
        ) : <p className="po-empty">{c.routeNone}</p>}

        <h3 className="ct-heading">{c.painEvidence} · {view.painSignals.length}</h3>
        {view.painSignals.length ? <ul className="ct-list">{view.painSignals.map((p) => <PainCard key={p.id} locale={locale} pain={p} workerName={p.reportedByWorkerId ? data.workerNames[p.reportedByWorkerId] ?? null : null}
          canWrite={permissions.canWrite} returnPath={`/opportunities/${o.id}/pursuit`} />)}</ul> : <p className="po-empty">{c.noPain}</p>}
        <p className="dr-card-note">{c.history(view.painHistory)}</p>
        {permissions.canWrite ? <details className="dr-details"><summary>{c.recordPain}</summary><PainForm locale={locale} companyId={o.companyId} opportunityId={o.id} workers={[]} referral={false} /></details> : null}

        <h3 className="ct-heading">{c.staffRequests} · {view.staffRequests.length}</h3>
        {view.staffRequests.length ? <ul className="ct-list">{view.staffRequests.map((s) => <StaffRequestCard key={s.demandSignalId} locale={locale} request={s} opportunityId={o.id} canExecute={permissions.canExecuteMatching} />)}</ul>
          : <p className="po-empty">{c.noStaffRequest}</p>}
        {permissions.canWrite && view.pipeline.status !== "CLOSED" ? <details className="dr-details"><summary>{c.recordStaffRequest}</summary>
          <StaffRequestForm locale={locale} opportunityId={o.id} contacts={contacts} operators={data.operators} defaultOwner={permissions.operatorId} /></details> : null}

        <h3 className="ct-heading">{c.activity} · {view.activities.length}</h3>
        {view.referralChain.length ? <><p className="dr-card-note"><strong>{c.referralChain}</strong></p>
          <ol className="ci-list">{view.referralChain.map((r) => <li key={r.activityId}>{day(r.at)} · {r.from ?? c.contact} {c.referred} {[r.toName, r.toTitle, r.toDepartment].filter(Boolean).join(", ")}{r.referredCandidateId ? ` · ${c.referredCandidate}` : ""}</li>)}</ol></> : null}
        {view.activities.length ? (
          <ol className="ci-list">{[...view.activities].reverse().map((a) => (
            <li key={a.id}>
              <strong>{c.activityTypes[a.activityType]}</strong> · {day(a.performedAt)}{a.accessChannel ? ` · ${c.channels[a.accessChannel]}` : ""}{a.outcome ? ` · ${c.outcomes[a.outcome]}` : ""}{a.result ? ` · ${c.results[a.result]}` : ""}
              {a.contactName ? ` · ${c.contact}: ${a.contactName}${a.contactTitle ? ` (${a.contactTitle})` : ""}` : ""}
              {a.referredName || a.referredDepartment ? ` → ${[a.referredName, a.referredTitle, a.referredDepartment].filter(Boolean).join(", ")}` : ""}
              {a.offerHypothesis ? <small>{c.offers[a.offerHypothesis]}{a.offerNote ? ` — ${a.offerNote}` : ""} · {c.offerNote}</small> : null}
              {a.handlesExternalWorkforce === "YES" ? <small className="ci-status-supported">✓ {c.handlesYes}</small> : null}
              {a.notes ? <q className="ci-quote">{a.notes}</q> : null}
              {a.nextAction ? <small>{c.nextAction}: {a.nextAction} · {day(a.nextActionDue)} · {operator(a.nextActionOwnerOperatorId)}</small> : null}
              <small>{c.performedBy}: {operator(a.performedByOperatorId)}{a.contactInteractionId ? ` · ${c.ciLinked}` : ""}</small>
            </li>
          ))}</ol>
        ) : <p className="po-empty">{c.noActivity}</p>}
        {permissions.canWrite && view.pipeline.status !== "CLOSED" ? (
          <details className="dr-details" open={view.pipeline.status === "NOT_PURSUED"}><summary>{view.pipeline.status === "NOT_PURSUED" ? c.startPursuit : c.recordActivity}</summary>
            <ActivityForm locale={locale} opportunityId={o.id} contacts={contacts} operators={data.operators} defaultOwner={permissions.operatorId} start={view.pipeline.status === "NOT_PURSUED"} />
          </details>
        ) : null}
      </section>
    </div>
  );
}

export function PainCard({ locale, pain, workerName, canWrite, returnPath }: { readonly locale: Locale; readonly pain: PainSignalView; readonly workerName: string | null; readonly canWrite: boolean; readonly returnPath: string }) {
  const c = pursuitCopy(locale);
  const day = (value: string | null) => (value ? formatDate(locale, new Date(value), { dateStyle: "medium" }) : c.unknown);
  const referral = pain.painType === "WORKER_REFERRAL";
  return (
    <li className="ct-card">
      <div className="sig-card-head">
        <span className="sig-kind">{c.painTypes[pain.painType]}</span>
        <span className="sig-kind">{c.bases[pain.assertionBasis]}</span>
        <span className={`sig-kind${pain.status === "REJECTED" ? " ci-expired" : ""}`}>{c.painStatuses[pain.status]}</span>
        <span className="sig-kind">{c.confidences[pain.confidence]}</span>
      </div>
      <p>{pain.summary}</p>
      <p className="dr-card-note">{c.sourceKinds[pain.sourceKind]}{pain.sourceUrl ? <> · <a href={pain.sourceUrl} target="_blank" rel="noreferrer noopener">{pain.sourceUrl}</a></> : null} · {day(pain.observedAt)} · {day(pain.recordedAt)}</p>
      {referral ? <>
        <p className="dr-card-note">{c.reportedBy}: {workerName ?? c.workerHidden}{pain.siteText ? ` · ${c.site}: ${pain.siteText}` : ""}{pain.city ? ` · ${pain.city}${pain.state ? `, ${pain.state}` : ""}` : ""}</p>
        {pain.supervisorName ? <p className="dr-card-note">{c.supervisor}: {pain.supervisorName}{pain.supervisorTitle ? ` — ${pain.supervisorTitle}` : ""}</p> : null}
        {pain.neededHeadcount || pain.neededRoleText ? <p className="dr-card-note">{c.needed}: {[pain.neededHeadcount, pain.neededRoleText].filter(Boolean).join(" × ")}</p> : null}
        <ul className="ct-states">
          {!pain.usableCommercially ? <li className="ci-status-requires_confirmation">⚠ {c.noUse}</li> : null}
          <li className={pain.mayNameWorkerToProspect ? "ci-status-supported" : "ci-status-requires_confirmation"}>{pain.mayNameWorkerToProspect ? `✓ ${c.identityAllowed}` : `⚠ ${c.identityWithheld}`}</li>
        </ul>
      </> : null}
      {canWrite && pain.status === "UNVERIFIED" ? <ReviewPainForm locale={locale} painSignalId={pain.id} returnPath={returnPath} /> : null}
    </li>
  );
}

function StaffRequestCard({ locale, request, opportunityId, canExecute }: { readonly locale: Locale; readonly request: StaffRequestView; readonly opportunityId: string; readonly canExecute: boolean }) {
  const c = pursuitCopy(locale);
  const f = c.srFields;
  const m = request.metadata as { level?: string | null; specialty?: string | null; billRate?: number | null; additionalRequirements?: string | null; requestingContact?: { name?: string | null; title?: string | null } };
  const u = (value: unknown) => (value === null || value === undefined || value === "" ? <em>{c.unknown}</em> : String(value));
  const bool = (value: boolean | null) => (value === null ? <em>{c.unknown}</em> : value ? c.yes : c.no);
  const req = request.credentials.filter((x) => x.level === "REQUIRED").map((x) => x.code);
  const pref = request.credentials.filter((x) => x.level === "PREFERRED").map((x) => x.code);
  return (
    <li className="ct-card">
      <p className="ct-name">{request.title}</p>
      <dl className="ct-routes">
        <div><dt>{f.trade}</dt><dd>{u(request.tradeCode)}</dd></div><div><dt>{f.occupation}</dt><dd>{u(request.occupationCode)}</dd></div>
        <div><dt>{f.level}</dt><dd>{u(m.level)}</dd></div><div><dt>{f.headcount}</dt><dd>{u(request.headcount)}</dd></div>
        <div><dt>{f.specialty}</dt><dd>{u(m.specialty)}</dd></div><div><dt>{f.projectSite}</dt><dd>{u(request.projectSite)}</dd></div>
        <div><dt>{f.city}</dt><dd>{request.city ? `${request.city}${request.state ? `, ${request.state}` : ""}` : <em>{c.unknown}</em>}</dd></div>
        <div><dt>{f.start}</dt><dd>{u(request.startDate)}</dd></div><div><dt>{f.duration}</dt><dd>{u(request.durationText ?? request.expectedEndDate)}</dd></div>
        <div><dt>{f.schedule}</dt><dd>{u([request.schedule, request.shift].filter(Boolean).join(" · ") || null)}</dd></div>
        <div><dt>{f.experience}</dt><dd>{u(request.minimumExperienceMonths)}</dd></div>
        <div><dt>{f.required}</dt><dd>{u(req.join(", ") || null)}</dd></div><div><dt>{f.preferred}</dt><dd>{u(pref.join(", ") || null)}</dd></div>
        <div><dt>{f.pay}</dt><dd>{u(request.payRateMin !== null || request.payRateMax !== null ? `${request.payRateMin ?? "?"}–${request.payRateMax ?? "?"}${request.payPeriod ? ` / ${request.payPeriod}` : ""}` : null)}</dd></div>
        <div><dt>{f.bill}</dt><dd>{u(m.billRate)}</dd></div>
        <div><dt>{f.perDiem}</dt><dd>{bool(request.perDiemAvailable)}{request.perDiemAmount !== null ? ` · ${request.perDiemAmount}` : ""}</dd></div>
        <div><dt>{f.travel}</dt><dd>{bool(request.travelRequired)}</dd></div>
        <div><dt>{f.additional}</dt><dd>{u(m.additionalRequirements)}</dd></div>
        <div><dt>{f.requester}</dt><dd>{u(m.requestingContact?.name ? `${m.requestingContact.name}${m.requestingContact.title ? ` — ${m.requestingContact.title}` : ""}` : null)}</dd></div>
        <div><dt>{f.received}</dt><dd>{u(request.receivedAt?.slice(0, 10))}</dd></div>
      </dl>
      <p className="dr-card-note">{request.matchCounts ? c.fitCounts(request.matchCounts.STRONG_MATCH, request.matchCounts.POSSIBLE_MATCH, request.headcount) : c.fitLevel.NOT_EVALUATED}</p>
      <div className="ct-inline">
        {canExecute ? <RunMatchingForm locale={locale} opportunityId={opportunityId} demandSignalId={request.demandSignalId} /> : <small>{c.matchingPermission}</small>}
        <Link className="button button-secondary" href={`/opportunities/${opportunityId}#workforce-matching`}>{c.openMatching}</Link>
      </div>
    </li>
  );
}
