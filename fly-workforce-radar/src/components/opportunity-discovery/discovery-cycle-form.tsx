"use client";

import { useActionState } from "react";
import type { Locale } from "../../i18n/locale";
import { runDiscoveryCycleNow, type DiscoveryCycleActionState } from "../../server/opportunity-search/actions";
import { discoveryCopy } from "./discovery-copy";

const INITIAL: DiscoveryCycleActionState = { state: "IDLE", findings: 0, queries: 0, failedQueries: 0, failureCode: null };

export function DiscoveryCycleForm({ locale, authorized, providerConfigured }: { readonly locale: Locale; readonly authorized: boolean; readonly providerConfigured: boolean }) {
  const c = discoveryCopy(locale).multi;
  const [result, action, pending] = useActionState(runDiscoveryCycleNow, INITIAL);
  const message = result.state === "IDLE" ? null
    : `${c.result[result.state]}${result.queries ? ` ${c.cycleSummary(result.findings, result.queries, result.failedQueries)}` : ""}${result.state === "FAILED" && result.failureCode ? ` (${result.failureCode.replaceAll("_", " ")})` : ""}`;
  return (
    <form action={action} className="dr-run">
      <button className="button button-primary" type="submit" disabled={!authorized || !providerConfigured || pending}>{pending ? c.running : c.runNow}</button>
      {message ? <p role="status" className={result.state === "COMPLETED" ? "dr-run-ok" : "dr-run-warn"}>{message}</p> : null}
    </form>
  );
}
