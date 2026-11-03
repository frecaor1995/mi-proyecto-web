"use client";

import { useActionState } from "react";
import type { Locale } from "../../i18n/locale";
import { confirmProjectSignalLinkAction, importProjectSignalsAction, type ProjectImportState, type ProjectLinkState } from "../../server/staffing-intelligence/actions";
import { staffingCopy } from "./staffing-copy";
import styles from "./staffing-intelligence.module.css";

const IMPORT_IDLE: ProjectImportState = { status: "IDLE", result: null, error: null };
const LINK_IDLE: ProjectLinkState = { status: "IDLE", error: null };

/** Paste or upload a fly.project-signal v1 file. The result lists every record's validation and outcome. */
export function ProjectSignalImportForm({ locale }: { readonly locale: Locale }) {
  const t = staffingCopy(locale);
  const [state, action, pending] = useActionState(importProjectSignalsAction, IMPORT_IDLE);
  return (
    <details className={styles.importBox} open={state.status !== "IDLE" || undefined}><summary>{t.importTitle}</summary>
      <form action={action} aria-label={t.importTitle}>
        <p className={styles.muted}>{t.importLede}</p>
        <label><span>{t.pasteJson}</span><textarea name="json" rows={6} spellCheck={false} placeholder='{"contract":"fly.project-signal","contractVersion":"1.0.0","producer":{"system":"…"},"records":[…]}' /></label>
        <label><span>{t.uploadFile}</span><input name="file" type="file" accept="application/json,.json" /></label>
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? t.importing : t.importSubmit}</button>
        {state.status === "INVALID_JSON" ? <p role="alert">{t.importErrors[state.error ?? "notJson"]}</p> : null}
        {state.status === "RESTRICTED" ? <p role="alert">{t.restricted}</p> : null}
        {state.status === "UNAVAILABLE" ? <p role="alert">{t.unavailable}</p> : null}
        {state.status === "FAILED" ? <p role="alert">{t.failed} {state.error}</p> : null}
        {state.result ? <div role="status" className={styles.importResult}>
          <p><b>{t.validation[state.result.validation.state]}</b>{state.result.validation.contractVersion ? ` · v${state.result.validation.contractVersion}` : ""}</p>
          {state.result.validation.errors.length ? <ul>{state.result.validation.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
          <ol>{state.result.results.map((r) => <li key={r.index}><b>#{r.index + 1} {r.sourceRecordId ?? ""}</b> — {t.outcome[r.outcome]}{r.version ? ` · ${t.version(r.version, r.version)}` : ""}
            {r.errors.length ? <ul>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            {r.warnings.length ? <ul className={styles.muted}>{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}</li>)}</ol>
        </div> : null}
      </form>
    </details>
  );
}

/** Explicit human confirmation of the company an imported record refers to. Nothing is linked by opening the page. */
export function ProjectSignalLinkForm({ locale, evidenceId, companies, suggestedCompanyId, defaultRole, canCreateProject }: {
  readonly locale: Locale; readonly evidenceId: string; readonly companies: readonly { readonly id: string; readonly name: string }[];
  readonly suggestedCompanyId: string | null; readonly defaultRole: string | null; readonly canCreateProject: boolean;
}) {
  const t = staffingCopy(locale);
  const [state, action, pending] = useActionState(confirmProjectSignalLinkAction, LINK_IDLE);
  return (
    <details className={styles.linkBox} open={state.status !== "IDLE" || undefined}><summary>{t.linkTitle}</summary>
      <form action={action} aria-label={t.linkTitle}>
        <input type="hidden" name="evidenceId" value={evidenceId} />
        <label><span>{t.linkCompany} *</span><select name="companyId" required defaultValue={suggestedCompanyId ?? ""}>
          <option value="" disabled>{t.selectCompany}</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span>{t.linkRole} *</span><select name="role" required defaultValue={defaultRole ?? ""}>
          <option value="" disabled>{t.selectCompany}</option>{["OWNER", "EPC", "GC", "ELECTRICAL_CONTRACTOR", "EMPLOYER"].map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}</select></label>
        {canCreateProject ? <label className={styles.check}><input type="checkbox" name="createProjectAndRole" /> {t.createProject}</label> : <p className={styles.muted}>{t.createProjectUnavailable}</p>}
        <label><span>{t.linkNote}</span><textarea name="note" rows={2} maxLength={1000} required /></label>
        <label className={styles.check}><input type="checkbox" name="confirm" required /> {t.linkConfirm}</label>
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? t.linking : t.linkSubmit}</button>
        {state.status === "LINKED" || state.status === "ALREADY_LINKED" ? <p role="status">{t.linkOk[state.status]}</p> : null}
        {state.status === "REJECTED" ? <p role="alert">{t.linkErrors[state.error ?? "failed"] ?? state.error}</p> : null}
      </form>
    </details>
  );
}
