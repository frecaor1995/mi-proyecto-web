"use client";
import { useActionState, useState } from "react";
import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import type { DictionaryKey } from "../../i18n/dictionary-shape";
import { createWorkerAction, type WorkerActionState } from "../../server/workforce/worker-actions";
import type { TradeOption, OccupationOption } from "../../server/workforce/get-workforce-taxonomy";

const SOURCE_OPTIONS = ["SELF_REGISTERED", "SOURCED", "IMPORTED", "UNKNOWN"] as const;
const initialState: WorkerActionState = { successKey: null, errorKey: null };

/**
 * Minimum-first-step creation: only displayName is required. Trade/occupation
 * is optional -- a worker with no trade assigned yet is a valid, representable
 * state (WORKFORCE-TALENT-A2-A Section S, "worker record exists" gate).
 * Occupation options are filtered client-side by the selected trade, using
 * the full canonical taxonomy already loaded server-side (small, bounded
 * lists -- no extra round trip needed).
 */
export function WorkerCreateForm({ locale, trades, occupations }: { readonly locale: Locale; readonly trades: readonly TradeOption[]; readonly occupations: readonly OccupationOption[] }) {
  const [state, formAction, pending] = useActionState(createWorkerAction, initialState);
  const [selectedTrade, setSelectedTrade] = useState("");
  const filteredOccupations = selectedTrade ? occupations.filter((o) => o.tradeCode === selectedTrade) : occupations;
  return (
    <form action={formAction} className="workforce-form" aria-label={t(locale, "workforce.create.title")}>
      <label>
        <span>{t(locale, "workforce.create.displayNameLabel")}</span>
        <input name="displayName" type="text" required maxLength={200} />
      </label>
      <label>
        <span>{t(locale, "workforce.create.sourceOfRecordLabel")}</span>
        <select name="sourceOfRecord" defaultValue="IMPORTED">
          {SOURCE_OPTIONS.map((option) => <option key={option} value={option}>{t(locale, `workforce.create.sourceOfRecordOption.${option}` as DictionaryKey)}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.create.tradeLabel")}</span>
        <select name="tradeCode" value={selectedTrade} onChange={(event) => setSelectedTrade(event.target.value)}>
          <option value="">{t(locale, "workforce.filterTradeAll")}</option>
          {trades.map((trade) => <option key={trade.code} value={trade.code}>{trade.labelEn}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.create.occupationLabel")}</span>
        <select name="occupationCode" defaultValue="">
          <option value="">{t(locale, "workforce.filterOccupationAll")}</option>
          {filteredOccupations.map((occupation) => <option key={occupation.code} value={occupation.code}>{occupation.labelEn}</option>)}
        </select>
      </label>
      <label>
        <span>{t(locale, "workforce.create.experienceMonthsLabel")}</span>
        <input name="experienceMonths" type="number" min={0} />
      </label>
      {state.errorKey ? <p role="alert" className="workforce-form-error">{t(locale, state.errorKey as DictionaryKey)}</p> : null}
      <button type="submit" disabled={pending}>{t(locale, "workforce.create.submit")}</button>
    </form>
  );
}
