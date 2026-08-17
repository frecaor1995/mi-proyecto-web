export default function Home() {
  return (
    <main className="foundation-shell">
      <div className="grid" aria-hidden="true" />
      <section className="status-panel" aria-labelledby="foundation-title">
        <p className="eyebrow">
          <span className="status-dot" aria-hidden="true" />
          Fly Electric Solutions LLC
        </p>
        <h1 id="foundation-title">
          Fly Workforce <span>Radar</span>
        </h1>
        <div className="rule" aria-hidden="true" />
        <p className="status-copy">Foundation initialized</p>
        <p className="scope-note">Dedicated application boundary · Phase 1A</p>
      </section>
    </main>
  );
}
