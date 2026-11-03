"use client";
import { useTransition } from "react";
import { setLocale } from "../../i18n/actions";
import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";

export function LanguageSelector({ locale }: { locale: Locale }) {
  const [pending, startTransition] = useTransition();
  const onChange = (next: Locale) => {
    if (next === locale || pending) return;
    startTransition(() => {
      void setLocale(next);
    });
  };
  return (
    <div className="language-selector" role="group" aria-label={t(locale, "a11y.languageSelector")}>
      <button
        type="button"
        className={locale === "en-US" ? "active" : ""}
        aria-pressed={locale === "en-US"}
        onClick={() => onChange("en-US")}
        disabled={pending}
      >
        {t(locale, "languageSelector.english")}
      </button>
      <button
        type="button"
        className={locale === "es-US" ? "active" : ""}
        aria-pressed={locale === "es-US"}
        onClick={() => onChange("es-US")}
        disabled={pending}
      >
        {t(locale, "languageSelector.spanish")}
      </button>
    </div>
  );
}
