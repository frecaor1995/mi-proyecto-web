import type { Locale } from "../../i18n/locale";
import type { WorkerProfile } from "../../domain/worker";
import { credentialExpirationBand, deriveWorkerReadiness, type WorkerIntelligenceFacts } from "../../domain/workforce-intelligence";
import type { WorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import { addCredentialInstanceAction, captureWorkerReferralAction, recordDocumentReadinessAction, recordMobilityAction, recordWorkConditionsAction, recordWorkerConsentAction, recordWorkerLevelAction } from "../../server/workforce/workforce-intelligence-actions";
import styles from "./worker-intelligence-panel.module.css";

const LEVELS = ["APPRENTICE", "JOURNEYMAN", "MASTER", "FOREMAN", "TECHNICIAN", "HELPER", "OTHER"] as const;
const human = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());

export function WorkerIntelligencePanel({ locale, profile, facts, taxonomy, canWrite }: { readonly locale: Locale; readonly profile: WorkerProfile; readonly facts: WorkerIntelligenceFacts; readonly taxonomy: WorkforceTaxonomy; readonly canWrite: boolean }) {
  const es = locale === "es-US";
  const worker = profile.worker;
  const availability = profile.currentAvailability.state === "KNOWN" ? profile.currentAvailability.value.status : null;
  const primary = facts.canonicalAssignment;
  const readiness = deriveWorkerReadiness({ lifecycle: worker.lifecycleStatus, profileVerificationState: worker.profileVerificationState, availability, facts });
  const mobility = facts.mobility;
  const conditions = facts.conditions;
  const presentation = facts.consents.find((consent) => consent.purpose === "CANDIDATE_PRESENTATION")?.state ?? "UNKNOWN";
  const dataUse = facts.consents.find((consent) => consent.purpose === "DATA_USE")?.state ?? "UNKNOWN";

  return <section className={styles.panel}>
    <div className={styles.hero}>
      <article className={styles.readiness}>
        <p className={styles.overline}>Workforce readiness / Phase 4A</p>
        <h2>{es ? "¿Se puede presentar hoy?" : "Can this worker be presented today?"}</h2>
        <span className={styles.state}>{human(readiness.state)}</span>
        {readiness.blockers.length ? <ul className={styles.blockers}>{readiness.blockers.map((blocker) => <li key={blocker}>{human(blocker)}</li>)}</ul> : <p>{es ? "No hay bloqueadores generales conocidos." : "No known general readiness blockers."}</p>}
      </article>
      <article className={styles.section}>
        <header><p className={styles.overline}>{es ? "Resumen operativo" : "Operational snapshot"}</p><h3>{facts.level?.code ?? (es ? "Nivel desconocido" : "Level unknown")}</h3></header>
        <div className={styles.facts}><Fact label={es ? "Oficio" : "Trade"} value={primary?.tradeCode ?? "UNKNOWN"} /><Fact label={es ? "Ocupación" : "Occupation"} value={primary?.occupationCode ?? "UNKNOWN"} /><Fact label={es ? "Presentación" : "Presentation"} value={presentation} /><Fact label={es ? "Uso de datos" : "Data use"} value={dataUse} /><Fact label={es ? "Disponibilidad" : "Availability"} value={availability ?? "UNKNOWN"} /><Fact label={es ? "Viaje Texas" : "Texas travel"} value={mobility?.inStateTravel ?? "UNKNOWN"} /></div>
      </article>
    </div>

    <Section title={es ? "Oficio, ocupación y nivel" : "Trade, occupation & level"} note={es ? "Oficio y ocupación vienen de la asignación canónica. El nivel es un hecho separado." : "Trade and occupation come from the canonical assignment. Level is a separate fact."}>
      <div className={styles.cards}><Record title={es ? "Oficio canónico" : "Canonical trade"} meta={primary?.tradeCode ?? "UNKNOWN"} /><Record title={es ? "Ocupación canónica" : "Canonical occupation"} meta={primary?.occupationCode ?? "UNKNOWN"} /><Record title={es ? "Nivel del trabajador" : "Worker level"} meta={facts.level ? `${facts.level.code} · ${facts.level.verificationState}` : "UNKNOWN · NOT RECORDED"} /></div>
      {canWrite ? <form className={styles.form} action={recordWorkerLevelAction}>
        <Hidden id={worker.id} />
        <label>Trade<select name="tradeCode" defaultValue={primary?.tradeCode ?? ""}><option value="">Unknown</option>{taxonomy.trades.map((trade) => <option key={trade.code} value={trade.code}>{es ? trade.labelEs : trade.labelEn}</option>)}</select></label>
        <label>Occupation<select name="occupationCode" defaultValue={primary?.occupationCode ?? ""}><option value="">Unknown</option>{taxonomy.occupations.filter((occupation) => !primary || occupation.tradeCode === primary.tradeCode).map((occupation) => <option key={occupation.code} value={occupation.code}>{es ? occupation.labelEs : occupation.labelEn}</option>)}</select></label>
        <label>Level<select name="levelCode" defaultValue="" required><option value="" disabled>Select level</option>{LEVELS.map((level) => <option key={level} value={level}>{human(level)}</option>)}</select></label>
        <button type="submit">{es ? "Registrar nivel" : "Record level"}</button>
      </form> : null}
    </Section>

    <Section title={es ? "Licencias y certificaciones" : "Licenses & certifications"} note={es ? "Verificación y vencimiento se muestran por separado." : "Verification and expiration remain separate."}>
      <div className={styles.cards}>{facts.credentials.length ? facts.credentials.map((credential) => <Record key={credential.id} title={`${credential.credentialCode}${credential.jurisdiction ? ` · ${credential.jurisdiction}` : ""}`} meta={`${credential.verificationState} · ${human(credentialExpirationBand(credential.expiresAt))}${credential.expiresAt ? ` · ${credential.expiresAt.toISOString().slice(0, 10)}` : ""}`} />) : <Record title="No credentials recorded" meta="EXPIRATION UNKNOWN" />}</div>
      {canWrite ? <form className={styles.form} action={addCredentialInstanceAction}><Hidden id={worker.id} /><label>Credential<select name="credentialCode" defaultValue="" required><option value="" disabled>Select credential</option>{taxonomy.credentials.map((credential) => <option value={credential.code} key={credential.code}>{es ? credential.labelEs : credential.labelEn}</option>)}</select></label><label>Jurisdiction<input name="jurisdiction" placeholder="TX" /></label><label>Issuing authority<input name="issuingAuthority" /></label><label>Issued<input name="issuedAt" type="date" /></label><label>Expires<input name="expiresAt" type="date" /></label><button>{es ? "Agregar instancia" : "Add instance"}</button></form> : null}
    </Section>

    <Section title={es ? "Movilidad y condiciones" : "Mobility & work conditions"} note={es ? "No preguntado permanece desconocido." : "Not asked remains unknown."}>
      <div className={styles.cards}><Record title="Texas travel" meta={mobility?.inStateTravel ?? "UNKNOWN"} /><Record title="Out-of-state travel" meta={mobility?.outOfStateTravel ?? "UNKNOWN"} /><Record title="Relocation" meta={mobility?.relocation ?? "UNKNOWN"} /><Record title="Per diem" meta={conditions?.perDiem ?? "UNKNOWN"} /><Record title="Transportation" meta={conditions?.transportation ?? "UNKNOWN"} /><Record title="Tools" meta={conditions?.tools ?? "UNKNOWN"} /></div>
      {canWrite ? <>
        <form className={styles.form} action={recordMobilityAction}><Hidden id={worker.id} /><label>Texas travel<Tri name="inState" value={mobility?.inStateTravel} /></label><label>Out-of-state travel<Tri name="outState" value={mobility?.outOfStateTravel} /></label><label>Relocation<Tri name="relocation" value={mobility?.relocation} /></label><button>{es ? "Guardar movilidad" : "Record mobility"}</button></form>
        <form className={styles.form} action={recordWorkConditionsAction}><Hidden id={worker.id} /><label>Per diem<select name="perDiem" defaultValue={conditions?.perDiem ?? "UNKNOWN"}>{["UNKNOWN", "REQUIRES", "ACCEPTS", "NOT_REQUIRED"].map((state) => <option key={state} value={state}>{human(state)}</option>)}</select></label><label>Transportation<Tri name="transportation" value={conditions?.transportation} /></label><label>Tools<select name="tools" defaultValue={conditions?.tools ?? "UNKNOWN"}>{["UNKNOWN", "YES", "NO", "PARTIAL"].map((state) => <option key={state} value={state}>{human(state)}</option>)}</select></label><label>Maximum hours/week<input type="number" min="1" max="168" name="maximumHours" defaultValue={conditions?.maximumHoursPerWeek ?? ""} /></label><label>Overtime<Tri name="overtime" value={conditions?.overtime} /></label><div className={`${styles.checks} ${styles.wide}`}>{["DAY", "NIGHT", "ROTATING"].map((shift) => <label key={shift}><input type="checkbox" name="shifts" value={shift} defaultChecked={facts.shifts.some((fact) => fact.code === shift)} />{human(shift)}</label>)}</div><button>{es ? "Guardar condiciones" : "Record conditions"}</button></form>
      </> : null}
    </Section>

    <Section title={es ? "Consentimiento" : "Purpose-scoped consent"} note={es ? "Contacto, uso de datos, presentación e inteligencia comercial son permisos distintos." : "Contact, data use, presentation, and commercial-intelligence consent remain separate."}>
      <div className={styles.cards}><Record title="Operational data use" meta={dataUse} /><Record title="Candidate presentation" meta={presentation} /></div>
      {canWrite ? <form className={styles.form} action={recordWorkerConsentAction}><Hidden id={worker.id} /><label>Purpose<select name="purpose" defaultValue="" required><option value="" disabled>Select purpose</option><option value="DATA_USE">Operational data use</option><option value="CANDIDATE_PRESENTATION">Candidate presentation</option></select></label><label>State<select name="state" defaultValue="UNKNOWN"><option value="UNKNOWN">Unknown</option><option value="GRANTED">Granted</option><option value="REVOKED">Revoked</option></select></label><button>{es ? "Registrar consentimiento" : "Record consent"}</button></form> : null}
    </Section>

    <Section title={es ? "Documentos y verificación" : "Document readiness"} note={es ? "Solo estado operativo; no se exponen documentos sensibles." : "Operational state only; no sensitive document contents are exposed."}>
      <div className={styles.cards}>{facts.documents.length ? facts.documents.map((document) => <Record key={document.documentType} title={document.documentType} meta={`${human(document.readinessState)} · ${document.verificationState}`} />) : <Record title="Document readiness" meta="UNKNOWN · NOT RECORDED" />}</div>
      {canWrite ? <form className={styles.form} action={recordDocumentReadinessAction}><Hidden id={worker.id} /><label>Document type<input name="documentType" required /></label><label>Readiness<select name="readinessState" defaultValue="UNKNOWN">{["UNKNOWN", "KNOWN", "VERIFIED", "MISSING", "EXPIRED", "REQUIRES_VERIFICATION"].map((state) => <option key={state} value={state}>{human(state)}</option>)}</select></label><label>Expires<input type="date" name="expiresAt" /></label><button>{es ? "Registrar documento" : "Record readiness"}</button></form> : null}
    </Section>

    <Section title={es ? "Referencia comercial del trabajador" : "Worker commercial referral"} note={es ? "Crea evidencia no verificada para revisión humana; no crea demanda ni oportunidad." : "Creates unverified evidence for human review; it creates no demand or opportunity."}>
      {canWrite ? <form className={styles.form} action={captureWorkerReferralAction}><Hidden id={worker.id} /><label>Company ID<input name="companyId" placeholder="Known company UUID" /></label><label>Opportunity ID<input name="opportunityId" placeholder="Known opportunity UUID" /></label><label className={styles.wide}>Unresolved association<input name="unresolvedAssociation" placeholder="Company, project, or site as reported" /></label><label>Reported at<input type="datetime-local" name="reportedAt" /></label><label className={styles.wide}>Report<textarea name="summary" required placeholder="Worker reports that…" /></label><label>Site/project<input name="siteText" /></label><label>City<input name="city" /></label><label>State<input name="state" /></label><label>Needed role<input name="neededRoleText" /></label><div className={`${styles.checks} ${styles.wide}`}><label><input type="checkbox" name="consentUseIntelligence" value="yes" /> Consent to use intelligence</label><label><input type="checkbox" name="consentIdentifyWorker" value="yes" /> Separate consent to identify worker</label></div><button>{es ? "Enviar a revisión humana" : "Send to human review"}</button></form> : null}
    </Section>
  </section>;
}

function Section({ title, note, children }: { readonly title: string; readonly note: string; readonly children: React.ReactNode }) { return <article className={styles.section}><header><h3>{title}</h3><p>{note}</p></header>{children}</article>; }
function Fact({ label, value }: { readonly label: string; readonly value: string }) { return <div className={styles.fact}><span>{label}</span><strong>{human(value)}</strong></div>; }
function Record({ title, meta }: { readonly title: string; readonly meta: string }) { return <div className={styles.record}><strong>{human(title)}</strong><span>{human(meta)}</span></div>; }
function Hidden({ id }: { readonly id: string }) { return <input type="hidden" name="workerId" value={id} />; }
function Tri({ name, value }: { readonly name: string; readonly value?: string }) { return <select name={name} defaultValue={value ?? "UNKNOWN"}><option value="UNKNOWN">Unknown</option><option value="YES">Yes</option><option value="NO">No</option></select>; }
