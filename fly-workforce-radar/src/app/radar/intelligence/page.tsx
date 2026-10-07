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
      <p className="po-eyebrow">Discovery Intelligence 1.2 · Company + Demand</p>
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
