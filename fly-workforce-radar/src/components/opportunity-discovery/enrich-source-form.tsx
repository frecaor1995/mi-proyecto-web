"use client";

import { useActionState } from "react";
import type { Locale } from "../../i18n/locale";
import { enrichSignalSourceAction, type EnrichActionState } from "../../server/source-enrichment/actions";
import { discoveryCopy } from "./discovery-copy";

const INITIAL: EnrichActionState = { state: "IDLE", status: null };

export function EnrichSourceForm({ locale, candidateId }: { readonly locale: Locale; readonly candidateId: string }) {
  const c = discoveryCopy(locale).intel;
  const [result, action, pending] = useActionState(enrichSignalSourceAction, INITIAL);
  return (
    <form action={action} className="dr-run">
      <input type="hidden" name="candidateId" value={candidateId} />
      <button className="button button-secondary" type="submit" disabled={pending}>{pending ? c.retrieving : c.retrieve}</button>
      {result.state !== "IDLE" ? <p role="status" className={result.state === "DONE" ? "dr-run-ok" : "dr-run-warn"}>{c.enrichResult[result.state]}{result.status ? ` ${c.enrichmentStatus[result.status] ?? result.status}` : ""}</p> : null}
    </form>
  );
}
