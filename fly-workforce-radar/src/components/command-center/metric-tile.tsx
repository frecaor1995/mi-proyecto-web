import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import { formatNumber } from "../../i18n/format";
import type { CommandCenterMetricKind } from "../../server/read-models/command-center";
import type { MetricValue } from "../../server/read-models/shared";

/**
 * Renders a semantic metric kind + MetricValue honestly (UI-3 sections 5/6.B/15):
 * KNOWN shows the real number (0 renders as 0, with an explicit "no X" caption
 * when zero); UNKNOWN never renders as 0 or a dash-only silence, it says so;
 * UNAVAILABLE is visually and textually distinct from UNKNOWN. The `kind` ->
 * label mapping is the only "localization of a read-model value" this
 * component performs -- it never invents or recomputes the value itself.
 */
export function MetricTile({ locale, kind, value }: { locale: Locale; kind: CommandCenterMetricKind; value: MetricValue }) {
  const label = t(locale, `commandCenter.metricKindLabel.${kind}`);

  if (value.state === "KNOWN") {
    const caption = value.value === 0 ? t(locale, "commandCenter.knownZeroTemplate", { metric: label }) : label;
    return (
      <article className="metric-tile metric-tile-known" aria-label={`${label}: ${value.value}`}>
        <span className="metric-tile-value">{formatNumber(locale, value.value)}</span>
        <span className="metric-tile-caption">{caption}</span>
      </article>
    );
  }

  if (value.state === "UNAVAILABLE") {
    const caption = t(locale, "commandCenter.unavailableMetricTemplate", { metric: label });
    return (
      <article className="metric-tile metric-tile-unavailable" aria-label={caption}>
        <span className="metric-tile-value" aria-hidden="true">—</span>
        <span className="metric-tile-caption">{caption}</span>
      </article>
    );
  }

  const caption = t(locale, "commandCenter.unknownCountTemplate", { metric: label });
  return (
    <article className="metric-tile metric-tile-unknown" aria-label={caption}>
      <span className="metric-tile-value" aria-hidden="true">—</span>
      <span className="metric-tile-caption">{caption}</span>
    </article>
  );
}
