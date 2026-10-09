"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Locale } from "../../i18n/locale";
import { recordAssistedPostingAction, type AssistedCaptureState } from "../../server/discovery-intelligence/assisted-capture-actions";

const INITIAL: AssistedCaptureState = { state: "IDLE", outcome: null, reviewHref: null, errors: {} };
const COPY = {
  "en-US": {
    errors: {
      required: "Required", tooLong: "Too long", tooLongUseOwnWords: "Too long — summarize in your own words (max 600 characters)", httpsPublicUrlRequired: "Public https URL required",
      twoLetterState: "Two-letter state (e.g. TX)", invalidDate: "Invalid date", future: "Cannot be in the future", onlyForEmailAlert: "Only for email alerts",
      demoMustBeNamedDemoLocal: "DEMO records must name the company 'DEMO LOCAL …'", realCannotBeDemoLocal: "REAL records cannot use a 'DEMO LOCAL' company", invalid: "Invalid",
    } as Record<string, string>,
    outcomes: {
      CREATED: "Recorded. Pending Human Review.", RE_OBSERVED: "Already known posting: a new dated observation was added. Pending Human Review.",
      DUPLICATE: "Duplicate: this posting was already recorded for that observation date. Nothing new was created.",
    } as Record<string, string>,
    summary: "Record a posting (assisted capture or email alert)", aria: "Assisted posting capture",
    intro: "Record a public posting you have seen. Fly does not open the URL; write requirements and the summary in your own words — do not paste the full description.",
    provenance: "Provenance *", assisted: "ASSISTED_MANUAL — seen on the official page", email: "EMAIL_ALERT — official job-alert email", dataClass: "Data class *",
    url: "Official posting URL *", company: "Company *", title: "Job title *", city: "City *", state: "State *", salary: "Salary — only if published", experience: "Experience — as stated",
    licenses: "Licenses / certifications (separate with ;)", observedOn: "Observed on *", ownSummary: "Your own summary * (max 600)", sender: "Alert sender *", receivedOn: "Received on *", reference: "Alert reference *",
    submit: "Record posting for Human Review", pending: "Recording…", openReview: "Open Human Review", check: "Check the highlighted fields.", restricted: "Your operator account cannot record postings.",
    unavailable: "The local database is unavailable.", failed: "Could not record:",
  },
  "es-US": {
    errors: {
      required: "Obligatorio", tooLong: "Demasiado largo", tooLongUseOwnWords: "Demasiado largo — resume con tus propias palabras (máx. 600 caracteres)", httpsPublicUrlRequired: "Se requiere una URL pública https",
      twoLetterState: "Estado de dos letras (p. ej. TX)", invalidDate: "Fecha inválida", future: "No puede ser una fecha futura", onlyForEmailAlert: "Solo para alertas por correo",
      demoMustBeNamedDemoLocal: "Los registros DEMO deben nombrar la empresa 'DEMO LOCAL …'", realCannotBeDemoLocal: "Los registros REALES no pueden usar una empresa 'DEMO LOCAL'", invalid: "Inválido",
    } as Record<string, string>,
    outcomes: {
      CREATED: "Registrada. Pendiente de revisión humana.", RE_OBSERVED: "Vacante ya conocida: se agregó una nueva observación con fecha. Pendiente de revisión humana.",
      DUPLICATE: "Duplicado: esta vacante ya estaba registrada para esa fecha de observación. No se creó nada nuevo.",
    } as Record<string, string>,
    summary: "Registrar una vacante (captura asistida o alerta por correo)", aria: "Captura asistida de vacante",
    intro: "Registra una vacante pública que hayas visto. Fly no abre la URL; escribe los requisitos y el resumen con tus propias palabras — no pegues la descripción completa.",
    provenance: "Procedencia *", assisted: "ASSISTED_MANUAL — vista en la página oficial", email: "EMAIL_ALERT — correo oficial de alerta de empleo", dataClass: "Tipo de dato *",
    url: "URL oficial de la vacante *", company: "Empresa *", title: "Puesto *", city: "Ciudad *", state: "Estado *", salary: "Salario — solo si está publicado", experience: "Experiencia — tal como se indica",
    licenses: "Licencias / certificaciones (separar con ;)", observedOn: "Observada el *", ownSummary: "Tu propio resumen * (máx. 600)", sender: "Remitente de la alerta *", receivedOn: "Recibida el *", reference: "Referencia de la alerta *",
    submit: "Registrar vacante para revisión humana", pending: "Registrando…", openReview: "Abrir revisión humana", check: "Revisa los campos marcados.", restricted: "Tu cuenta de operador no puede registrar vacantes.",
    unavailable: "La base de datos local no está disponible.", failed: "No se pudo registrar:",
  },
} as const;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Recipe 2.0 assisted capture. The operator records a public posting they have seen; the system never visits the URL,
 * stores only the operator's own short summary, and requires Human Review. Never a client, opportunity or staff request.
 * `defaultCompany` only pre-fills the company name (e.g. a priority source); every other field comes from the operator.
 */
export function AssistedPostingForm({ locale = "en-US", defaultCompany = "" }: { readonly locale?: Locale; readonly defaultCompany?: string }) {
  const t = COPY[locale];
  const [result, action, pending] = useActionState(recordAssistedPostingAction, INITIAL);
  const [provenance, setProvenance] = useState("ASSISTED_MANUAL");
  const err = (name: string) => (result.errors[name] ? <small role="alert">{t.errors[result.errors[name]] ?? result.errors[name]}</small> : null);
  // the <details> lives here so it stays open after the server action revalidates the page and the outcome stays visible
  return (
    <details id="register" open={result.state !== "IDLE" || Boolean(defaultCompany) || undefined}><summary>{t.summary}</summary>
    <form action={action} aria-label={t.aria}>
      <p>{t.intro}</p>
      <div className="sig-form-grid">
        <label><span>{t.provenance}</span><select name="provenance" value={provenance} onChange={(e) => setProvenance(e.target.value)}>
          <option value="ASSISTED_MANUAL">{t.assisted}</option><option value="EMAIL_ALERT">{t.email}</option></select></label>
        <label><span>{t.dataClass}</span><select name="dataClass" defaultValue="REAL"><option value="REAL">REAL</option><option value="DEMO">DEMO LOCAL</option></select>{err("dataClass")}</label>
        <label><span>{t.url}</span><input name="url" type="url" pattern="https://.*" maxLength={2000} required />{err("url")}</label>
        <label><span>{t.company}</span><input name="company" maxLength={200} required defaultValue={defaultCompany} />{err("company")}</label>
        <label><span>{t.title}</span><input name="title" maxLength={200} required />{err("title")}</label>
        <label><span>{t.city}</span><input name="city" maxLength={120} required />{err("city")}</label>
        <label><span>{t.state}</span><input name="state" maxLength={2} required placeholder="TX" />{err("state")}</label>
        <label><span>{t.salary}</span><input name="salary" maxLength={120} />{err("salary")}</label>
        <label><span>{t.experience}</span><input name="experience" maxLength={300} />{err("experience")}</label>
        <label><span>{t.licenses}</span><input name="licenses" maxLength={300} />{err("licenses")}</label>
        <label><span>{t.observedOn}</span><input name="observedOn" type="date" defaultValue={today()} max={today()} required />{err("observedOn")}</label>
        <label><span>{t.ownSummary}</span><textarea name="summary" maxLength={600} rows={3} required />{err("summary")}</label>
        {provenance === "EMAIL_ALERT" ? <>
          <label><span>{t.sender}</span><input name="emailSender" maxLength={200} required />{err("emailSender")}</label>
          <label><span>{t.receivedOn}</span><input name="emailReceivedOn" type="date" max={today()} required />{err("emailReceivedOn")}</label>
          <label><span>{t.reference}</span><input name="emailAlertReference" maxLength={200} required />{err("emailAlertReference")}</label>
        </> : null}
      </div>
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? t.pending : t.submit}</button>
      {result.state === "DONE" && result.outcome ? <p role="status">{t.outcomes[result.outcome]} {result.reviewHref ? <Link href={result.reviewHref}>{t.openReview}</Link> : null}</p> : null}
      {result.state === "INVALID" ? <p role="status">{t.check}</p> : null}
      {result.state === "RESTRICTED" ? <p role="status">{t.restricted}</p> : null}
      {result.state === "UNAVAILABLE" ? <p role="status">{t.unavailable}</p> : null}
      {result.state === "FAILED" ? <p role="status">{t.failed} {result.errors.form}</p> : null}
    </form>
    </details>
  );
}
