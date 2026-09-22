"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { MatchOutcome } from "../../domain/matching-engine";
import type { DemandMatchCriterionExplanation, DemandMatchReadModel, DemandMatchWorkerRow } from "../../domain/matching-results";
import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import { t } from "../../i18n/translate";
import type { DemandMatchingReadState, WorkforceMatchingUiPermissions } from "../../server/opportunity-detail/get-opportunity-workforce-matching";
import { runOpportunityWorkforceMatchingAction, type WorkforceMatchingActionState } from "../../server/opportunity-detail/workforce-matching-actions";

const OUTCOME_ORDER: readonly MatchOutcome[] = ["STRONG_MATCH", "POSSIBLE_MATCH", "INSUFFICIENT_DATA", "NO_MATCH"];
const INITIAL_STATE: WorkforceMatchingActionState = { status: "READY", demandSignalId: null, run: null, errorKey: null };

export interface WorkforceMatchingDemandOption {
  readonly id: string;
  readonly label: string;
}

export function WorkforceMatchingSection({ locale, opportunityId, demands, permissions, demandResults }: {
  readonly locale: Locale;
  readonly opportunityId: string;
  readonly demands: readonly WorkforceMatchingDemandOption[];
  readonly permissions: WorkforceMatchingUiPermissions;
  readonly demandResults: Readonly<Record<string, DemandMatchingReadState>>;
}) {
  const [selectedDemandId, setSelectedDemandId] = useState(demands.length === 1 ? demands[0].id : "");
  const [actionState, formAction, pending] = useActionState(runOpportunityWorkforceMatchingAction, INITIAL_STATE);
  const selectedReadState = selectedDemandId ? demandResults[selectedDemandId] : undefined;
  const readModel = selectedReadState?.state === "READY" ? selectedReadState.value : null;
  const showRunSummary = actionState.run !== null && actionState.demandSignalId === selectedDemandId;
  const hasStale = readModel?.workers.some((worker) => worker.freshness === "POTENTIALLY_STALE") ?? false;

  if (demands.length === 0) {
    return <div className="matching-panel matching-panel-unavailable" role="status">
      <strong>{t(locale, "workforceMatching.noDemandTitle")}</strong>
      <p>{t(locale, "workforceMatching.noDemandDescription")}</p>
    </div>;
  }

  if (!permissions.canRead && !permissions.canExecute) {
    return <div className="matching-panel matching-panel-restricted" role="status">
      <strong>{t(locale, "workforceMatching.restricted")}</strong>
      <p>{t(locale, permissions.authenticated ? "workforceMatching.restrictedDescription" : "workforceMatching.requiresSignIn")}</p>
    </div>;
  }

  return <div className="matching-workspace">
    <div className="matching-command-bar">
      <label className="matching-demand-selector">
        <span>{t(locale, "workforceMatching.demandSelection")}</span>
        {demands.length === 1
          ? <strong>{demands[0].label}</strong>
          : <select value={selectedDemandId} onChange={(event) => setSelectedDemandId(event.target.value)} aria-label={t(locale, "workforceMatching.demandSelection")}>
              <option value="">{t(locale, "workforceMatching.selectDemand")}</option>
              {demands.map((demand) => <option value={demand.id} key={demand.id}>{demand.label}</option>)}
            </select>}
      </label>
      {permissions.canExecute ? <form action={formAction} className="matching-run-form">
        <input type="hidden" name="opportunityId" value={opportunityId}/>
        <input type="hidden" name="demandSignalId" value={selectedDemandId}/>
        <button type="submit" disabled={pending || !selectedDemandId}>
          {pending ? t(locale, "workforceMatching.running") : hasStale || showRunSummary ? t(locale, "workforceMatching.runAgain") : t(locale, "workforceMatching.run")}
        </button>
      </form> : <p className="matching-permission-note">{t(locale, "workforceMatching.executionPermissionRequired")}</p>}
    </div>

    {pending ? <div className="matching-run-status matching-run-running" role="status" aria-live="polite">
      <span className="matching-pulse" aria-hidden="true"/><strong>{t(locale, "workforceMatching.running")}</strong>
      <p>{t(locale, "workforceMatching.runningDescription")}</p>
    </div> : null}

    {!pending && showRunSummary ? <RunSummary locale={locale} state={actionState}/> : null}
    {!pending && actionState.status === "FAILED" && !showRunSummary ? <div className="matching-run-status matching-run-failed" role="alert">
      <strong>{t(locale, "workforceMatching.failed")}</strong>
      <p>{t(locale, (actionState.errorKey ?? "workforceMatching.error.runFailed") as Parameters<typeof t>[1])}</p>
    </div> : null}

    {permissions.canRead ? <PersistedResults locale={locale} selectedDemandId={selectedDemandId} readState={selectedReadState} readModel={readModel}/> : <div className="matching-panel matching-panel-execute-only">
      <strong>{t(locale, "workforceMatching.persistedResultsRestricted")}</strong>
      <p>{t(locale, "workforceMatching.persistedResultsRestrictedDescription")}</p>
    </div>}
  </div>;
}

function RunSummary({ locale, state }: { readonly locale: Locale; readonly state: WorkforceMatchingActionState }) {
  const run = state.run;
  if (!run) return null;
  const partial = state.status === "PARTIAL_SUCCESS";
  const failed = state.status === "FAILED";
  return <section className={`matching-run-status matching-run-${partial ? "partial" : failed ? "failed" : "completed"}`} role={failed ? "alert" : "status"} aria-live="polite">
    <header><div><span>{t(locale, "workforceMatching.runSummary")}</span><strong>{t(locale, partial ? "workforceMatching.partialSuccess" : failed ? "workforceMatching.failed" : "workforceMatching.completed")}</strong></div><time>{formatDate(locale, new Date(run.completedAt), { dateStyle: "medium", timeStyle: "short" })}</time></header>
    {partial ? <p>{t(locale, "workforceMatching.partialSuccessDescription", { persisted: String(run.persistedWorkerCount), failed: String(run.failedWorkerCount) })}</p> : null}
    {failed && state.errorKey ? <p>{t(locale, state.errorKey as Parameters<typeof t>[1])}</p> : null}
    <div className="matching-run-metrics">
      <Metric label={t(locale, "workforceMatching.eligibleWorkers")} value={run.eligibleWorkerCount}/>
      <Metric label={t(locale, "workforceMatching.evaluatedWorkers")} value={run.evaluatedWorkerCount}/>
      <Metric label={t(locale, "workforceMatching.persistedWorkers")} value={run.persistedWorkerCount}/>
      <Metric label={t(locale, "workforceMatching.failedWorkers")} value={run.failedWorkerCount}/>
    </div>
    <div className="matching-outcome-grid matching-outcome-grid-run">
      {OUTCOME_ORDER.map((outcome) => <OutcomeTile locale={locale} outcome={outcome} count={run.outcomes[outcome]} key={outcome}/>) }
    </div>
  </section>;
}

function PersistedResults({ locale, selectedDemandId, readState, readModel }: {
  readonly locale: Locale;
  readonly selectedDemandId: string;
  readonly readState: DemandMatchingReadState | undefined;
  readonly readModel: DemandMatchReadModel | null;
}) {
  if (!selectedDemandId) return <div className="matching-panel" role="status"><strong>{t(locale, "workforceMatching.selectDemandPrompt")}</strong></div>;
  if (!readState || readState.state !== "READY") return <div className="matching-panel matching-panel-unavailable" role="status"><strong>{t(locale, "workforceMatching.resultsUnavailable")}</strong><p>{t(locale, "workforceMatching.resultsUnavailableDescription")}</p></div>;
  if (!readModel || readModel.workers.length === 0) return <div className="matching-panel matching-panel-empty" role="status"><strong>{t(locale, "workforceMatching.noPersistedResults")}</strong><p>{t(locale, "workforceMatching.noPersistedResultsDescription")}</p></div>;

  return <section className="matching-persisted-results" aria-labelledby="matching-persisted-title">
    <header className="matching-results-heading"><div><span>{t(locale, "workforceMatching.currentPicture")}</span><h3 id="matching-persisted-title">{t(locale, "workforceMatching.persistedResults")}</h3></div><small>{t(locale, "workforceMatching.persistedResultsBoundary")}</small></header>
    <div className="matching-outcome-grid">
      {OUTCOME_ORDER.map((outcome) => <OutcomeTile locale={locale} outcome={outcome} count={readModel.counts[outcome]} key={outcome}/>) }
    </div>
    <div className="matching-groups">
      {OUTCOME_ORDER.map((outcome) => <WorkerGroup locale={locale} outcome={outcome} workers={readModel.workers.filter((worker) => worker.outcome === outcome)} key={outcome}/>) }
    </div>
  </section>;
}

function WorkerGroup({ locale, outcome, workers }: { readonly locale: Locale; readonly outcome: MatchOutcome; readonly workers: readonly DemandMatchWorkerRow[] }) {
  const ordered = useMemo(() => [...workers].sort((a, b) => a.workerDisplayName.localeCompare(b.workerDisplayName, locale) || a.workerId.localeCompare(b.workerId)), [workers, locale]);
  return <section className={`matching-group matching-group-${outcome.toLowerCase()}`}>
    <header><h4>{t(locale, `workforceMatching.outcome.${outcome}`)}</h4><span>{ordered.length}</span></header>
    {ordered.length === 0 ? <p className="matching-group-empty">{t(locale, "workforceMatching.noWorkersInGroup")}</p> : <div className="matching-worker-list">{ordered.map((worker) => <WorkerCard locale={locale} worker={worker} key={worker.workerId}/>)}</div>}
  </section>;
}

function WorkerCard({ locale, worker }: { readonly locale: Locale; readonly worker: DemandMatchWorkerRow }) {
  return <article className="matching-worker-card">
    <header><div><Link href={`/workforce/${encodeURIComponent(worker.workerId)}`}>{worker.workerDisplayName || t(locale, "workforceMatching.unknownWorker")}</Link><small>{worker.workerId}</small></div><span className={`matching-freshness matching-freshness-${worker.freshness.toLowerCase()}`}>{t(locale, `workforceMatching.freshness.${worker.freshness}`)}</span></header>
    {worker.freshness === "POTENTIALLY_STALE" ? <p className="matching-stale-note">{t(locale, "workforceMatching.staleDescription")}</p> : null}
    <dl className="matching-worker-meta">
      <div><dt>{t(locale, "workforceMatching.currentLifecycle")}</dt><dd>{worker.currentWorkerLifecycleStatus ?? t(locale, "workforceMatching.unknownValue")}</dd></div>
      <div><dt>{t(locale, "workforceMatching.evaluatedAt")}</dt><dd><time>{formatDate(locale, new Date(worker.evaluatedAt), { dateStyle: "medium", timeStyle: "short" })}</time></dd></div>
    </dl>
    <details className="matching-reasons"><summary>{t(locale, "workforceMatching.whyThisMatch")}</summary>
      <ul>{worker.explanations.map((explanation, index) => <Explanation locale={locale} explanation={explanation} key={`${explanation.criterion}-${explanation.subject ?? "none"}-${index}`}/>)}</ul>
    </details>
    {worker.missingInformationReasons.length > 0 ? <section className="matching-missing"><h5>{t(locale, "workforceMatching.missingInformation")}</h5><ul>{worker.missingInformationReasons.map((reason, index) => <li key={`${reason}-${index}`}>{t(locale, `workforceMatching.reason.${reason}` as Parameters<typeof t>[1])}</li>)}</ul></section> : null}
  </article>;
}

function Explanation({ locale, explanation }: { readonly locale: Locale; readonly explanation: DemandMatchCriterionExplanation }) {
  return <li className={`matching-reason matching-reason-${explanation.state.toLowerCase()}`}>
    <span>{t(locale, `workforceMatching.criterionState.${explanation.state}`)}</span>
    <p>{t(locale, `workforceMatching.reason.${explanation.reasonCode}`)}{explanation.subject ? ` · ${explanation.subject}` : ""}</p>
  </li>;
}

function OutcomeTile({ locale, outcome, count }: { readonly locale: Locale; readonly outcome: MatchOutcome; readonly count: number }) {
  return <div className={`matching-outcome-tile matching-outcome-${outcome.toLowerCase()}`}><strong>{count}</strong><span>{t(locale, `workforceMatching.outcome.${outcome}`)}</span></div>;
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
