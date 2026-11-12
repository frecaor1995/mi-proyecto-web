import Link from "next/link";
import { isDemoLocalLabel } from "../../domain/workforce-population";
import type { Locale } from "../../i18n/locale";
import type { WorkforceListQuery, WorkforceListResult } from "../../server/workforce/get-workforce-list";
import type { WorkforceIntelligenceSummary } from "../../server/workforce/get-workforce-intelligence";
import type { TradeOption } from "../../server/workforce/get-workforce-taxonomy";
import styles from "./workforce-intelligence.module.css";

const human = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
type IntelligenceFilters = { readonly availability: string; readonly level: string; readonly credential: string; readonly readiness: string };

function pageHref(query: WorkforceListQuery, filters: IntelligenceFilters, page: number): string {
  const params = new URLSearchParams();
  if (query.lifecycleStatus) params.set("lifecycle", query.lifecycleStatus);
  if (query.tradeCode) params.set("trade", query.tradeCode);
  if (query.occupationCode) params.set("occupation", query.occupationCode);
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (page > 1) params.set("page", String(page));
  const value = params.toString();
  return value ? `/workforce?${value}` : "/workforce";
}

export function WorkforceIntelligenceList({ locale, result, summaries, trades, query, filters, canCreate }: {
  locale: Locale;
  result: WorkforceListResult;
  summaries: ReadonlyMap<string, WorkforceIntelligenceSummary>;
  trades: readonly TradeOption[];
  query: WorkforceListQuery;
  filters: IntelligenceFilters;
  canCreate: boolean;
}) {
  const es = locale === "es-US";
  const items = result.items;
  const ready = items.filter((item) => summaries.get(item.worker.id)?.readiness === "READY").length;
  const blocked = items.filter((item) => summaries.get(item.worker.id)?.readiness === "BLOCKED").length;
  const pagination = result.pagination ?? { page: query.page, pageSize: 20, totalItems: items.length, totalPages: items.length ? 1 : 0, realItems: items.filter((item) => !isDemoLocalLabel(item.worker.displayName)).length, demoItems: items.filter((item) => isDemoLocalLabel(item.worker.displayName)).length };
  const first = items.length ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const last = Math.min(pagination.page * pagination.pageSize, pagination.totalItems);

  return <main className={styles.shell}>
    <section className={styles.hero}><p className={styles.eyebrow}>Workforce Intelligence / Phase 4A</p><h1>{es ? "La capacidad real, sin suposiciones." : "Know who is ready. Know what is missing."}</h1><p>{es ? "Inventario operativo con disponibilidad, credenciales, vencimientos, consentimiento y bloqueadores explicables." : "Operational workforce inventory with availability, credential expiry, consent, and explainable readiness blockers."}</p></section>
    <section className={styles.metrics}><Metric label={es ? "Total Workforce" : "Total workforce"} value={pagination.totalItems} /><Metric label="REAL" value={pagination.realItems} /><Metric label="DEMO LOCAL" value={pagination.demoItems} /><Metric label={es ? "Listos · esta página" : "Ready · this page"} value={ready} /><Metric label={es ? "Bloqueados · esta página" : "Blocked · this page"} value={blocked} /></section>
    <form className={styles.toolbar} method="get"><label>{es ? "Oficio" : "Trade"}<select name="trade" defaultValue={query.tradeCode ?? ""}><option value="">{es ? "Todos" : "All trades"}</option>{trades.map((trade) => <option key={trade.code} value={trade.code}>{es ? trade.labelEs : trade.labelEn}</option>)}</select></label><label>{es ? "Nivel" : "Level"}<select name="level" defaultValue={filters.level}><option value="">{es ? "Cualquier nivel" : "Any level"}</option>{["APPRENTICE", "JOURNEYMAN", "MASTER", "FOREMAN", "TECHNICIAN", "HELPER", "OTHER", "UNKNOWN"].map((value) => <option key={value}>{human(value)}</option>)}</select></label><label>{es ? "Disponibilidad" : "Availability"}<select name="availability" defaultValue={filters.availability}><option value="">{es ? "Cualquier estado" : "Any state"}</option>{["AVAILABLE", "COMMITTED", "UNAVAILABLE", "UNKNOWN"].map((value) => <option key={value}>{human(value)}</option>)}</select></label><label>{es ? "Credencial" : "Credential"}<select name="credential" defaultValue={filters.credential}><option value="">{es ? "Cualquier vencimiento" : "Any expiry"}</option>{["EXPIRED", "WITHIN_30", "WITHIN_60", "WITHIN_90", "LATER", "UNKNOWN"].map((value) => <option key={value}>{human(value)}</option>)}</select></label><label>{es ? "Preparación" : "Readiness"}<select name="readiness" defaultValue={filters.readiness}><option value="">{es ? "Cualquier estado" : "Any state"}</option>{["READY", "NEEDS_ATTENTION", "BLOCKED"].map((value) => <option key={value}>{human(value)}</option>)}</select></label><button type="submit">{es ? "Aplicar filtros" : "Apply filters"}</button>{canCreate ? <Link className={styles.new} href="/workforce/new">+ {es ? "Agregar trabajador" : "Add worker"}</Link> : null}</form>
    {items.length ? <section className={styles.grid}>{items.map((item) => {
      const intel = summaries.get(item.worker.id);
      const primary = item.primaryTradeOccupation;
      const isDemo = isDemoLocalLabel(item.worker.displayName);
      return <Link className={styles.card} href={`/workforce/${item.worker.id}`} key={item.worker.id}><header><div><span className={styles.code}>{primary?.tradeCode ?? (es ? "Oficio desconocido" : "Trade unknown")}</span><h2>{item.worker.displayName}</h2><span className={`${styles.origin} ${isDemo ? styles.originDemo : styles.originReal}`}>{isDemo ? "DEMO LOCAL" : "REAL"}</span></div><span className={`${styles.badge} ${intel?.readiness === "READY" ? styles.ready : intel?.readiness === "BLOCKED" ? styles.blocked : styles.attention}`}>{human(intel?.readiness ?? "NEEDS_ATTENTION")}</span></header><div className={styles.facts}><Fact label={es ? "Rol / nivel" : "Role / level"} value={[primary?.occupationCode, intel?.level].filter(Boolean).join(" · ") || "Unknown"} /><Fact label={es ? "Disponibilidad" : "Availability"} value={item.availabilityStatus ?? "Unknown"} /><Fact label={es ? "Ubicación" : "Location"} value={item.locationSummary ?? "Unknown"} /><Fact label={es ? "Credenciales" : "Credentials"} value={`${intel?.verifiedCredentialCount ?? 0}/${intel?.credentialCount ?? 0} verified`} /><Fact label={es ? "Próximo vencimiento" : "Nearest expiry"} value={intel?.nearestExpiration ?? "Unknown"} /><Fact label={es ? "Estado de vencimiento" : "Expiry status"} value={human(intel?.expirationBand ?? "UNKNOWN")} /></div>{intel?.blockers.length ? <ul className={styles.blockers}>{intel.blockers.slice(0, 3).map((blocker) => <li key={blocker}>{human(blocker)}</li>)}</ul> : null}</Link>;
    })}</section> : <div className={styles.empty}>{es ? "No hay trabajadores para estos filtros." : "No workers match these filters."}</div>}
    {pagination.totalPages > 1 ? <nav className={styles.pagination} aria-label={es ? "Paginación de Workforce" : "Workforce pagination"}><div><strong>{es ? `Página ${pagination.page} de ${pagination.totalPages}` : `Page ${pagination.page} of ${pagination.totalPages}`}</strong><span>{es ? `Mostrando ${first}-${last} de ${pagination.totalItems}` : `Showing ${first}-${last} of ${pagination.totalItems}`}</span></div><div>{pagination.page > 1 ? <Link href={pageHref(query, filters, pagination.page - 1)}>{es ? "Anterior" : "Previous"}</Link> : <span aria-disabled="true">{es ? "Anterior" : "Previous"}</span>}{pagination.page < pagination.totalPages ? <Link href={pageHref(query, filters, pagination.page + 1)}>{es ? "Siguiente" : "Next"}</Link> : <span aria-disabled="true">{es ? "Siguiente" : "Next"}</span>}</div></nav> : null}
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className={styles.fact}><span>{label}</span><strong>{human(value)}</strong></div>; }
