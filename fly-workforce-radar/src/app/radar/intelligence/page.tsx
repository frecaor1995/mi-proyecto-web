import Link from "next/link";
import { getDiscoveryIntelligence } from "../../../server/discovery-intelligence/get-discovery-intelligence";
import { ManualMissForm } from "../../../components/discovery-intelligence/manual-miss-form";
import styles from "./page.module.css";

const human = (value: string) => value.replaceAll("_", " ");
const count = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "UNKNOWN";

export default async function DiscoveryIntelligencePage() {
  const snapshot = await getDiscoveryIntelligence();
  const review = snapshot.companyDemand.filter((group) => group.resolutionState !== "RESOLVED_CANONICAL");
  return <div className={`page-stack ${styles.page}`}>
    <header className="app-page-header">
      <p className="po-eyebrow">Discovery Intelligence 1.3 · Human Review</p>
      <h1>Who appears to need people—and what do we actually know?</h1>
      <p>Fly converts stored public observations into explainable company identity and demand intelligence. Every unresolved fact stays explicit and every commercial conclusion still requires human review.</p>
    </header>

    {snapshot.state !== "READY" ? <section className={styles.boundary} role="status"><strong>{snapshot.state === "UNAVAILABLE" ? "Local database unavailable" : "Intelligence read model unavailable"}</strong><span>No business facts are fabricated while the local data boundary is unavailable.</span></section> : null}

    <section className={styles.metrics} aria-label="Company and demand intelligence scorecard">
      {[
        ["Unique demand observations", snapshot.metrics.uniqueObservations, "Stable identities, not query hits"],
        ["Known companies linked", snapshot.metrics.resolvedCanonical, "Existing canonical records only"],
        ["Identities needing review", snapshot.metrics.identifiedReview, "Identified, possible or ambiguous"],
        ["Identity unresolved", snapshot.metrics.unresolved, "Stored evidence remains insufficient"],
        ["Corroborated groups", snapshot.metrics.corroborated, "Distinct observations or sources"],
        ["Healthy watch sources", snapshot.metrics.healthyWatchSources, "Current local watch catalog"],
        ["Manual misses", snapshot.metrics.manualMisses, "Human coverage feedback"],
      ].map(([name, value, note]) => <article key={String(name)}><small>{name}</small><strong>{count(value as number | null)}</strong><span>{note}</span></article>)}
    </section>

    <section className={styles.ownerSummary}>
      <div><p className="po-eyebrow">Owner summary</p><h2>{count(snapshot.metrics.uniqueObservations)} observed demand identities</h2>
        <p>{count(snapshot.metrics.resolvedCanonical)} link to existing canonical companies; {count(snapshot.metrics.identifiedReview)} carry usable identity hints that require review; {count(snapshot.metrics.unresolved)} remain unresolved.</p></div>
      <div className={styles.summaryActions}><Link href="/companies">Review company registry</Link><Link href="/radar">Open Radar</Link></div>
    </section>

    <nav className={styles.workflow} aria-label="Discovery review workflow">
      {["Discovery", "Review", "Company", "Demand", "Verify", "Promote", "Match", "Talent Gap", "Contact"].map((step, index) => <span key={step}><b>{String(index + 1).padStart(2, "0")}</b>{step}</span>)}
    </nav>

    <section className={`${styles.panel} ${styles.marketPanel}`} id="market-signals">
      <header><div><p className="po-eyebrow">Aggregate market signals</p><h2>Where labor demand appears concentrated</h2></div><span>{snapshot.marketPressure.label}</span></header>
      <p className={styles.marketWarning}>Source-specific market counts are displayed separately. Overlapping aggregator populations are never summed.</p>
      <div className={styles.marketGrid}>{snapshot.aggregateMarketSignals.map((signal) => <article key={signal.observationId}>
        <div className={styles.cardTop}><span className={styles.marketBadge}>MARKET SIGNAL</span><span className={styles.health}>{human(signal.sourceRelationship)}</span></div>
        <p className={styles.marketLocation}>{signal.location ?? "Location in source title"}</p><h3>{human(signal.level)} {human(signal.profession ?? "ELECTRICAL")}</h3>
        <div className={styles.quantitySplit}><div><small>Aggregate source count</small><strong>{count(signal.count)}</strong></div><div><small>Employer headcount</small><strong>UNKNOWN</strong></div></div>
        <dl><div><dt>Source</dt><dd>{signal.domain}</dd></div><div><dt>Observed</dt><dd>{date(signal.firstSeenAt)} → {date(signal.lastSeenAt)}</dd></div><div><dt>Decomposition</dt><dd>{human(signal.decomposition.status)}</dd></div></dl>
        <div className={styles.decompositionBand}><div><small>Supported postings</small><strong>{signal.decomposition.postingCount}</strong></div><div><small>Unique employers</small><strong>{signal.decomposition.uniqueEmployerCount}</strong></div><div><small>Duplicates suppressed</small><strong>{signal.decomposition.duplicateCount}</strong></div></div>
        <p className={styles.boundaryNote}>{signal.warning} {signal.decomposition.reason}</p>
        {signal.decomposition.children.length ? <div className={styles.childPostings}>{signal.decomposition.children.map((child) => <article key={child.identity}>
          <div className={styles.cardTop}><span className={styles.childBadge}>{human(child.relationship)}</span><span>{child.vendorAcceptance === "UNKNOWN" ? "VENDOR ACCEPTANCE UNKNOWN" : child.vendorAcceptance}</span></div>
          <h4><a href={child.normalizedUrl} target="_blank" rel="noreferrer">{child.title ?? "Posting title UNKNOWN"}</a></h4>
          <p>{child.employerName ?? "Employer UNKNOWN"} · {child.location ?? "Location UNKNOWN"}</p>
          <dl><div><dt>Profession</dt><dd>{child.profession ?? "UNKNOWN"}</dd></div><div><dt>Pay / per diem</dt><dd>{child.pay ?? "UNKNOWN"} · {child.perDiem ?? "UNKNOWN"}</dd></div><div><dt>Headcount</dt><dd>{child.explicitHeadcount ?? "UNKNOWN"}</dd></div><div><dt>Evidence</dt><dd>{child.evidenceIds.length || child.provenance.length} record(s)</dd></div></dl>
          <p className={styles.evidenceGaps}>{child.evidenceGaps.length ? child.evidenceGaps.map(human).join(" · ") : "No extraction gaps recorded"}</p>
          <Link href={child.reviewHref}>Governed company and demand review →</Link>
        </article>)}</div> : <div className={styles.decompositionEmpty}><strong>No individual posting URLs are stored.</strong><p>The aggregate parent remains visible. Review its stored evidence manually; no postings, employers or headcount were invented.</p><Link href={`/radar/${signal.candidateId}`}>Open manual evidence review →</Link></div>}
        <a href={signal.url} target="_blank" rel="noreferrer">Inspect stored aggregate source ↗</a>
      </article>)}</div>
    </section>

    <section className={styles.panel} id="review-queue">
      <header><div><p className="po-eyebrow">Human review workbench</p><h2>What needs an owner decision?</h2></div><span>{snapshot.reviewQueue.length} observations</span></header>
      <div className={styles.workbench}>{snapshot.reviewQueue.map((item) => <article key={item.observationId}>
        <div className={styles.cardTop}><span className={styles.priority}>{item.priority}</span><span className={styles.state}>{item.reviewState}</span></div>
        <h3>{item.company}</h3><p>{item.title}</p>
        <dl className={styles.factGrid}><div><dt>Need</dt><dd>{human(item.profession ?? "UNKNOWN")} · {human(item.level)}</dd></div><div><dt>Where</dt><dd>{item.location ?? "UNKNOWN"}</dd></div><div><dt>Source</dt><dd>{item.source} · {human(item.sourceRelationship)}</dd></div><div><dt>Quantity</dt><dd>{human(item.quantity.type)}{item.quantity.value === null ? "" : ` · ${item.quantity.value}`}</dd></div><div><dt>Corroboration</dt><dd>{item.corroboration}</dd></div><div><dt>Safe next action</dt><dd>{item.nextAction}</dd></div></dl>
        <p className={styles.reasonLine}>{item.reasons.map(human).join(" · ")}</p>
        <div className={styles.safeActions}><Link href={`/radar/${item.candidateId}`}>Review evidence and demand</Link><Link href="/companies">Link/create through Companies</Link><span>Defer safely</span></div>
      </article>)}</div>
    </section>

    <section className={styles.pipeline} id="verified-demand"><div><small>COMPANY</small><strong>Human-confirmed only</strong><span>No automatic canonicalization</span></div><div><small>DEMAND</small><strong>Verification is separate</strong><span>UNKNOWN fields may remain</span></div><div><small>PROMOTION</small><strong>Explicit owner action</strong><span>No automatic opportunity</span></div><div><small>DOWNSTREAM</small><strong>Match → Gap → Contact</strong><span>Only after legitimate promotion</span></div></section>

    <section className={styles.panel}>
      <header><div><p className="po-eyebrow">Company demand concentration</p><h2>Who appears behind the observations</h2></div><span>{snapshot.companyDemand.length} identity groups</span></header>
      <div className={styles.companyGrid}>{snapshot.companyDemand.map((group) => <article className={styles.companyCard} key={group.key}>
        <div className={styles.cardTop}><span className={`${styles.state} ${styles[`state${group.resolutionState}`] ?? ""}`}>{human(group.resolutionState)}</span><span className={styles.confidence}>{group.confidence} identity</span></div>
        <h3>{group.canonicalCompanyId ? <Link href={`/companies/${group.canonicalCompanyId}`}>{group.displayName}</Link> : group.displayName}</h3>
        <p>{group.observationCount} distinct observation{group.observationCount === 1 ? "" : "s"} · {group.sourceCount} independent source domain{group.sourceCount === 1 ? "" : "s"}</p>
        <dl>
          <div><dt>Appears to need</dt><dd>{group.professions.map(human).join(", ") || "UNKNOWN"} · {group.levels.map(human).join(", ") || "UNKNOWN"}</dd></div>
          <div><dt>Where</dt><dd>{group.locations.join(", ") || "UNKNOWN"}</dd></div>
          <div><dt>Source relationship</dt><dd>{group.sourceRelationships.map(human).join(", ") || "UNKNOWN"}</dd></div>
          <div><dt>Corroboration</dt><dd>{group.corroboration} · {group.health}</dd></div>
          <div><dt>Observed</dt><dd>{date(group.firstSeenAt)} → {date(group.lastSeenAt)}</dd></div>
          <div><dt>Identity basis</dt><dd>{group.reasons.map(human).join(" · ")}</dd></div>
        </dl>
        <footer>{group.canonicalCompanyId ? <><strong>Linked to existing company</strong>{group.hasContactIntelligence ? <span>Contact Intelligence available</span> : null}</>
          : <><strong>Human review required</strong><Link href="/companies">Review or link through Companies →</Link></>}</footer>
      </article>)}</div>
    </section>

    <section className={styles.panel}>
      <header><div><p className="po-eyebrow">Identity review queue</p><h2>Safe next decisions</h2></div><span>{review.length} groups</span></header>
      <div className={styles.reviewQueue}>{review.map((group) => <article key={group.key}>
        <div><strong>{group.displayName}</strong><span>{human(group.resolutionState)} · {group.confidence}</span></div>
        <p>{group.reasons.map(human).join(" · ")} · {group.observationCount} observation{group.observationCount === 1 ? "" : "s"}</p>
        <div className={styles.safeActions}><Link href="/companies">Link existing / review company</Link><span>Defer</span><span>Keep unresolved</span></div>
      </article>)}</div>
    </section>

    <section className={styles.panel}>
      <header><div><p className="po-eyebrow">Demand observations</p><h2>Evidence-supported interpretation</h2></div><span>{snapshot.observations.length} unique</span></header>
      <div className={styles.observationList}>{snapshot.observations.map((item) => <article key={item.identity}>
        <div className={styles.cardTop}><span className={styles.state}>{human(item.resolution.state)}</span><span className={styles.health}>{human(item.watchState)}</span></div>
        <h3><a href={item.normalizedUrl} target="_blank" rel="noreferrer">{item.title}</a></h3>
        <p className={styles.companyLine}>{item.resolution.canonicalCompanyName ?? item.resolution.observedCompany ?? "Company identity unsupported"} <small>· {item.resolution.confidence} · {item.resolution.reasons.map(human).join(" / ")}</small></p>
        <dl className={styles.factGrid}>
          <div><dt>Profession / occupation</dt><dd>{human(item.demand.profession ?? "UNKNOWN")} · {human(item.demand.occupation ?? "UNKNOWN")}</dd></div>
          <div><dt>Level</dt><dd>{human(item.demand.level)}</dd></div><div><dt>Location</dt><dd>{item.demand.location ?? "UNKNOWN"}</dd></div>
          <div><dt>Pay / per diem</dt><dd>{item.demand.pay ?? "UNKNOWN"} · {item.demand.perDiem ?? "UNKNOWN"}</dd></div>
          <div><dt>Experience / credentials</dt><dd>{item.demand.experience ?? "UNKNOWN"} · {item.demand.credentials.join(", ") || "UNKNOWN"}</dd></div>
          <div><dt>Project / published</dt><dd>{item.demand.project ?? "UNKNOWN"} · {date(item.demand.publishedAt)}</dd></div>
        </dl>
        <footer><span>{human(item.demand.sourceRelationship)} · {item.domain}</span><strong>{item.canonicalEvidence ? "Canonical evidence linked" : "Provider observation · review required"}</strong></footer>
      </article>)}</div>
    </section>

    <div className={styles.columns}>
      <section className={styles.panel}><header><div><p className="po-eyebrow">Watch catalog</p><h2>Identity-aware sources</h2></div><span>{snapshot.watches.length} registered</span></header>
        <div className={styles.watchList}>{snapshot.watches.map((watch) => <article key={watch.id}><span className={`${styles.health} ${styles[`health${watch.health}`] ?? ""}`}>{human(watch.health)}</span>
          <h3>{watch.company ?? "Identity evidence insufficient"}</h3><p>{human(watch.resolutionState)} · {human(watch.resolutionReason)}</p>
          <small>{human(watch.sourceType)}{watch.platform ? ` · ${watch.platform}` : ""} · last successful {date(watch.lastSuccessfulAt)}</small></article>)}</div>
      </section>
      <section className={styles.panel}><header><div><p className="po-eyebrow">Source relationship</p><h2>What kind of source surfaced it?</h2></div><span>Not buyer authority</span></header>
        <div className={styles.relationships}>{Object.entries(snapshot.sourceRelationships).map(([name, value]) => <div key={name}><span>{human(name)}</span><strong>{value}</strong></div>)}</div>
        <p className={styles.boundaryNote}>A vacancy or staffing page does not prove external manpower acceptance, vendor acceptance, or buyer authority. Those remain UNKNOWN.</p>
      </section>
    </div>

    <details className={styles.technical}><summary>Technical discovery details</summary><div className={styles.columns}>
      <section className={styles.panel}><header><div><p className="po-eyebrow">Recipes</p><h2>Configured execution</h2></div></header>{snapshot.recipes.map((recipe) => <p key={recipe.key}><strong>{recipe.name}</strong> · {recipe.executions} executions · {recipe.observations} candidate rows</p>)}</section>
      <section className={styles.panel}><header><div><p className="po-eyebrow">Query ledger</p><h2>Recent executions</h2></div></header>{snapshot.recentExecutions.map((item) => <p key={item.id}><strong>{item.status}</strong> · {item.results} results · {item.query}</p>)}</section>
    </div></details>

    <section className={styles.guardrails}><h2>Evidence boundaries</h2><div><article><strong>IDENTITY ≠ BUYER</strong><p>Recognizing a company never proves purchasing authority.</p></article><article><strong>OBSERVED ≠ VERIFIED</strong><p>Stored search metadata remains human-reviewable.</p></article><article><strong>WATCH ≠ ACTIVE DEMAND</strong><p>STILL OBSERVED only reports continued visibility.</p></article><article><strong>UNKNOWN STAYS UNKNOWN</strong><p>No invented employer, project, headcount or acceptance.</p></article></div></section>
    <section className={styles.panel}><header><div><p className="po-eyebrow">Learning loop</p><h2>Human found something Radar missed</h2></div><span>Feedback only · never automatic demand</span></header><div className={styles.form}><ManualMissForm /></div></section>
  </div>;
}
