import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { formatDate } from "../../i18n/format";
import type { LearningCounts } from "../../domain/commercial-pursuit";
import type { PursuitListItem } from "../../server/commercial-pursuit/pursuit-store";
import { pursuitCopy } from "./pursuit-copy";

/** Pursuits with stage and next action; overdue first. The learning block is data collection only (no weighting). */
export function PursuitListView({ locale, data, overdueOnly }: {
  readonly locale: Locale; readonly overdueOnly: boolean;
  readonly data: { readonly items: readonly PursuitListItem[]; readonly learning: LearningCounts; readonly window: { readonly from: string; readonly to: string }; readonly operators: readonly { readonly id: string; readonly label: string }[] };
}) {
  const c = pursuitCopy(locale);
  const day = (value: string | null) => (value ? formatDate(locale, new Date(value.length === 10 ? `${value}T12:00:00Z` : value), { dateStyle: "medium" }) : "—");
  const items = overdueOnly ? data.items.filter((i) => i.nextAction?.overdue) : data.items;
  const l = data.learning;
  const L = c.learningLabels;
  const operator = (id: string) => data.operators.find((o) => o.id === id)?.label ?? "—";
  return (
    <div className="page-stack">
      <div className="page-actions">
        <Link className={`button ${overdueOnly ? "button-secondary" : "button-primary"}`} href="/opportunities/pursuits">{c.all}</Link>
        <Link className={`button ${overdueOnly ? "button-primary" : "button-secondary"}`} href="/opportunities/pursuits?view=overdue">{c.overdueOnly} · {l.nextActions.overdue}</Link>
      </div>
      <section className="sig-panel ci-panel" aria-labelledby="cpl-title">
        <h2 id="cpl-title">{c.listTitle}</h2>
        <p className="sig-panel-lede">{c.listLede}</p>
        <p className="dr-note">{c.noOutreach}</p>
        {items.length ? (
          <table className="ci-table">
            <thead><tr><th>{c.colOpportunity}</th><th>{c.colStage}</th><th>{c.colMax}</th><th>{c.colNext}</th><th>{c.colLast}</th></tr></thead>
            <tbody>{items.map((item) => (
              <tr key={item.opportunityId}>
                <td><Link href={`/opportunities/${item.opportunityId}/pursuit`}>{item.title ?? item.opportunityId}</Link><br /><small>{item.companyName ?? "—"}</small></td>
                <td>{c.stages[item.pipeline.currentStage]}{item.pipeline.result ? <><br /><small>{c.results[item.pipeline.result]}</small></> : null}</td>
                <td>{c.stages[item.pipeline.maxStageReached]}</td>
                <td>{item.nextAction ? <>{item.nextAction.action}<br /><small className={item.nextAction.overdue ? "ci-expired" : ""}>{day(item.nextAction.due)}{item.nextAction.overdue ? ` · ${c.overdue}` : ""} · {operator(item.nextAction.ownerOperatorId)}</small></> : c.nextNone}</td>
                <td>{day(item.lastActivityAt || null)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="po-empty">{c.listEmpty}</p>}
      </section>
      <section className="sig-panel ci-panel" aria-labelledby="cpl-learning">
        <h2 id="cpl-learning">{c.learning(data.window.from, data.window.to)}</h2>
        <dl className="ci-grid">
          <div><dt>{L.pursued}</dt><dd>{l.pursued}</dd></div><div><dt>{L.firstTouches}</dt><dd>{l.firstTouches}</dd></div><div><dt>{L.conversations}</dt><dd>{l.conversations}</dd></div>
          <div><dt>{L.externalLaborConfirmed}</dt><dd>{l.externalLaborConfirmed}</dd></div><div><dt>{L.staffRequests}</dt><dd>{l.staffRequests}</dd></div>
          <div><dt>{L.proposals}</dt><dd>{l.proposals}</dd></div><div><dt>{L.presentations}</dt><dd>{l.presentations}</dd></div>
          <div><dt>{c.results.WON}</dt><dd>{l.results.WON}</dd></div><div><dt>{c.results.LOST}</dt><dd>{l.results.LOST}</dd></div><div><dt>{c.results.NO_DECISION}</dt><dd>{l.results.NO_DECISION}</dd></div>
          <div><dt>{L.openNext}</dt><dd>{l.nextActions.open}</dd></div><div><dt>{L.overdueNext}</dt><dd>{l.nextActions.overdue}</dd></div>
        </dl>
        <p className="dr-card-note"><strong>{c.byChannel}</strong></p>
        <ul className="ci-list">{Object.entries(l.byChannel).map(([channel, v]) => <li key={channel}>{c.channels[channel] ?? channel}: {v.touches} {c.touches} · {v.conversations} {c.conversationsShort} · {v.staffRequests} {c.requestsShort}</li>)}</ul>
        <p className="dr-card-note"><strong>{c.byOutcome}</strong></p>
        <ul className="ci-list">{Object.entries(l.byOutcome).map(([outcome, n]) => <li key={outcome}>{c.outcomes[outcome] ?? outcome}: {n}</li>)}</ul>
        <p className="dr-card-note"><strong>{c.byOffer}</strong></p>
        <ul className="ci-list">{Object.entries(l.byOffer).map(([offer, v]) => <li key={offer}>{c.offers[offer] ?? offer}: {v.opportunities} · {v.conversations} {c.conversationsShort} · {v.staffRequests} {c.requestsShort}</li>)}</ul>
      </section>
    </div>
  );
}
