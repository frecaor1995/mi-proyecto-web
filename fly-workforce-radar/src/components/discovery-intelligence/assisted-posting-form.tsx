"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { recordAssistedPostingAction, type AssistedCaptureState } from "../../server/discovery-intelligence/assisted-capture-actions";

const INITIAL: AssistedCaptureState = { state: "IDLE", outcome: null, reviewHref: null, errors: {} };
const ERRORS: Record<string, string> = {
  required: "Required", tooLong: "Too long", tooLongUseOwnWords: "Too long — summarize in your own words (max 600 characters)", httpsPublicUrlRequired: "Public https URL required",
  twoLetterState: "Two-letter state (e.g. TX)", invalidDate: "Invalid date", future: "Cannot be in the future", onlyForEmailAlert: "Only for email alerts",
  demoMustBeNamedDemoLocal: "DEMO records must name the company 'DEMO LOCAL …'", realCannotBeDemoLocal: "REAL records cannot use a 'DEMO LOCAL' company", invalid: "Invalid",
};
const OUTCOMES: Record<string, string> = {
  CREATED: "Recorded. Pending Human Review.", RE_OBSERVED: "Already known posting: a new dated observation was added. Pending Human Review.",
  DUPLICATE: "Duplicate: this posting was already recorded for that observation date. Nothing new was created.",
};
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Recipe 2.0 assisted capture. The operator records a public posting they have seen; the system never visits the URL,
 * stores only the operator's own short summary, and requires Human Review. Never a client, opportunity or staff request.
 */
export function AssistedPostingForm() {
  const [result, action, pending] = useActionState(recordAssistedPostingAction, INITIAL);
  const [provenance, setProvenance] = useState("ASSISTED_MANUAL");
  const err = (name: string) => (result.errors[name] ? <small role="alert">{ERRORS[result.errors[name]] ?? result.errors[name]}</small> : null);
  // the <details> lives here so it stays open after the server action revalidates the page and the outcome stays visible
  return (
    <details open={result.state !== "IDLE" || undefined}><summary>Record a posting (assisted capture or email alert)</summary>
    <form action={action} aria-label="Assisted posting capture">
      <p>Record a public posting you have seen. Fly does not open the URL; write requirements and the summary in your own words — do not paste the full description.</p>
      <div className="sig-form-grid">
        <label><span>Provenance *</span><select name="provenance" value={provenance} onChange={(e) => setProvenance(e.target.value)}>
          <option value="ASSISTED_MANUAL">ASSISTED_MANUAL — seen on the official page</option><option value="EMAIL_ALERT">EMAIL_ALERT — official job-alert email</option></select></label>
        <label><span>Data class *</span><select name="dataClass" defaultValue="REAL"><option value="REAL">REAL</option><option value="DEMO">DEMO LOCAL</option></select>{err("dataClass")}</label>
        <label><span>Official posting URL *</span><input name="url" type="url" pattern="https://.*" maxLength={2000} required />{err("url")}</label>
        <label><span>Company *</span><input name="company" maxLength={200} required />{err("company")}</label>
        <label><span>Job title *</span><input name="title" maxLength={200} required />{err("title")}</label>
        <label><span>City *</span><input name="city" maxLength={120} required />{err("city")}</label>
        <label><span>State *</span><input name="state" maxLength={2} required placeholder="TX" />{err("state")}</label>
        <label><span>Salary — only if published</span><input name="salary" maxLength={120} />{err("salary")}</label>
        <label><span>Experience — as stated</span><input name="experience" maxLength={300} />{err("experience")}</label>
        <label><span>Licenses / certifications (separate with ;)</span><input name="licenses" maxLength={300} />{err("licenses")}</label>
        <label><span>Observed on *</span><input name="observedOn" type="date" defaultValue={today()} max={today()} required />{err("observedOn")}</label>
        <label><span>Your own summary * (max 600)</span><textarea name="summary" maxLength={600} rows={3} required />{err("summary")}</label>
        {provenance === "EMAIL_ALERT" ? <>
          <label><span>Alert sender *</span><input name="emailSender" maxLength={200} required />{err("emailSender")}</label>
          <label><span>Received on *</span><input name="emailReceivedOn" type="date" max={today()} required />{err("emailReceivedOn")}</label>
          <label><span>Alert reference *</span><input name="emailAlertReference" maxLength={200} required />{err("emailAlertReference")}</label>
        </> : null}
      </div>
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? "Recording…" : "Record posting for Human Review"}</button>
      {result.state === "DONE" && result.outcome ? <p role="status">{OUTCOMES[result.outcome]} {result.reviewHref ? <Link href={result.reviewHref}>Open Human Review</Link> : null}</p> : null}
      {result.state === "INVALID" ? <p role="status">Check the highlighted fields.</p> : null}
      {result.state === "RESTRICTED" ? <p role="status">Your operator account cannot record postings.</p> : null}
      {result.state === "UNAVAILABLE" ? <p role="status">The local database is unavailable.</p> : null}
      {result.state === "FAILED" ? <p role="status">Could not record: {result.errors.form}</p> : null}
    </form>
    </details>
  );
}
