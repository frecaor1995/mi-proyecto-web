import type { Locale } from "./locale";

/**
 * Intl-based, locale-aware formatting. Currency is always USD: changing the
 * UI locale changes how an amount is written, never the business value or
 * the currency unit itself (I18N-0 section P / manager section 16).
 */
export function formatDate(locale: Locale, date: Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options ?? { dateStyle: "medium" }).format(date);
}

export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPercent(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value);
}

export function formatCurrencyUSD(locale: Locale, amount: number): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(amount);
}

export function formatRelativeTime(locale: Locale, date: Date, now: Date): string {
  const diffMs = date.getTime() - now.getTime();
  const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, unitMs] of units) {
    if (Math.abs(diffMs) >= unitMs) return formatter.format(Math.round(diffMs / unitMs), unit);
  }
  return formatter.format(Math.round(diffMs / 1000), "second");
}
