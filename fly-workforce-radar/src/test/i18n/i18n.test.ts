import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// AppShell (rendered inside RootLayout) calls next/navigation's usePathname(),
// which returns null outside a real Next.js router context -- unrelated to
// I18N-1, and never previously exercised since no earlier test rendered
// RootLayout/AppShell directly. Mocked here, in this file only, purely so
// RootLayout's own <html lang> wiring can be rendered and asserted on.
vi.mock("next/navigation", () => ({ usePathname: () => "/command-center" }));

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  localeCookieOptions,
  matchAcceptLanguage,
  resolveLocaleFromSignals,
} from "../../i18n/locale";
import { DICTIONARIES, t } from "../../i18n/translate";
import { formatCurrencyUSD } from "../../i18n/format";
import { resolveServerLocale } from "../../i18n/server-locale";
import { NAVIGATION } from "../../components/shell/app-shell";
import { TrustState, CurrentnessBadge, ScopeBadge, TRUST_STATES, CURRENTNESS_STATES, SCOPE_STATES } from "../../components/ui/status-primitives";
import RootLayout from "../../app/layout";

function collectLeafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectLeafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("I18N-1 locale resolution", () => {
  it("1. en-US resolves correctly", () => {
    expect(resolveLocaleFromSignals({ cookieLocale: "en-US" })).toBe("en-US");
  });

  it("2. es-US resolves correctly", () => {
    expect(resolveLocaleFromSignals({ cookieLocale: "es-US" })).toBe("es-US");
  });

  it("3. unsupported locale falls back safely", () => {
    expect(resolveLocaleFromSignals({ cookieLocale: "fr-FR" })).toBe(DEFAULT_LOCALE);
    expect(resolveLocaleFromSignals({ authenticatedUserLocale: "zz-ZZ", cookieLocale: "fr-FR" })).toBe(DEFAULT_LOCALE);
    expect(isSupportedLocale("fr-FR")).toBe(false);
  });

  it("4. Accept-Language can select es-US", () => {
    expect(matchAcceptLanguage("es-MX,es;q=0.9,en;q=0.8")).toBe("es-US");
    expect(resolveLocaleFromSignals({ acceptLanguageHeader: "es-MX,es;q=0.9,en;q=0.8" })).toBe("es-US");
  });

  it("5. explicit cookie preference wins over browser language", () => {
    expect(resolveLocaleFromSignals({ cookieLocale: "en-US", acceptLanguageHeader: "es-ES" })).toBe("en-US");
  });

  it("6. locale cookie persistence works", () => {
    expect(LOCALE_COOKIE_NAME).toBe("fwr-locale");
    const devOptions = localeCookieOptions(false);
    expect(devOptions).toEqual({ path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: false });
    const prodOptions = localeCookieOptions(true);
    expect(prodOptions.secure).toBe(true);
    expect(prodOptions.sameSite).toBe("lax");
  });

  it("resolveServerLocale never throws outside a real request scope and falls back to the default", async () => {
    await expect(resolveServerLocale()).resolves.toBe(DEFAULT_LOCALE);
  });
});

describe("I18N-1 dictionary completeness", () => {
  it("7. EN and ES dictionaries have complete matching shape", () => {
    const enPaths = new Set(collectLeafPaths(DICTIONARIES["en-US"]));
    const esPaths = new Set(collectLeafPaths(DICTIONARIES["es-US"]));
    expect(esPaths).toEqual(enPaths);
  });

  it("8. navigation resolves in both languages", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const group of NAVIGATION) {
        expect(t(locale, group.labelKey)).not.toMatch(/^\[\[missing/);
        for (const item of group.items) expect(t(locale, item.labelKey)).not.toMatch(/^\[\[missing/);
      }
    }
  });

  it("9. trust states resolve in both languages", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const state of Object.keys(TRUST_STATES) as (keyof typeof TRUST_STATES)[]) {
        expect(t(locale, `trust.${state}`)).not.toMatch(/^\[\[missing/);
      }
    }
  });

  it("10. currentness resolves in both languages", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const state of Object.keys(CURRENTNESS_STATES) as (keyof typeof CURRENTNESS_STATES)[]) {
        expect(t(locale, `currentness.${state}`)).not.toMatch(/^\[\[missing/);
      }
    }
  });

  it("11. scope resolves in both languages", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const scope of Object.keys(SCOPE_STATES) as (keyof typeof SCOPE_STATES)[]) {
        expect(t(locale, `scope.${scope}`)).not.toMatch(/^\[\[missing/);
      }
    }
  });

  it("12. route titles resolve in both languages", () => {
    const routeKeys = ["opportunities","companies","projects","contacts","signals","verification","actions","hot","nearReady","evidence","relationships","sources","activity","settings"] as const;
    for (const locale of SUPPORTED_LOCALES) {
      for (const route of routeKeys) {
        expect(t(locale, `routes.${route}.title`)).not.toMatch(/^\[\[missing/);
        expect(t(locale, `routes.${route}.description`)).not.toMatch(/^\[\[missing/);
      }
    }
  });

  it("13. accessibility labels resolve in both languages", () => {
    const a11yKeys = ["skipToContent","closeNavigation","primaryNavigation","expandNavigation","collapseNavigation","openNavigation","searchUnavailable","workspaceProfile","languageSelector"] as const;
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of a11yKeys) expect(t(locale, `a11y.${key}`)).not.toMatch(/^\[\[missing/);
      expect(t(locale, "a11yStatus.trustPrefix")).not.toMatch(/^\[\[missing/);
      expect(t(locale, "a11yStatus.currentnessPrefix")).not.toMatch(/^\[\[missing/);
      expect(t(locale, "a11yStatus.scopePrefix")).not.toMatch(/^\[\[missing/);
    }
  });

  it("14. language selector exposes English and Español in both locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(t(locale, "languageSelector.english")).toBe("English");
      expect(t(locale, "languageSelector.spanish")).toBe("Español");
    }
  });
});

describe("I18N-1 server rendering", () => {
  it("15. document lang reflects the resolved locale", async () => {
    const html = renderToStaticMarkup(await RootLayout({ children: null }));
    expect(html).toContain(`lang="${DEFAULT_LOCALE}"`);
  });

  it("19. UI-1 route coverage remains intact", () => {
    const paths = NAVIGATION.flatMap((group) => group.items.map((item) => item.href));
    expect(paths).toEqual([
      "/command-center","/opportunities","/companies","/projects","/contacts","/signals",
      "/verification","/actions","/hot","/near-ready","/evidence","/relationships",
      "/sources","/activity","/settings",
    ]);
  });
});

describe("I18N-1 formatting", () => {
  it("16. USD remains USD across locale formatting", () => {
    const en = formatCurrencyUSD("en-US", 1234.5);
    const es = formatCurrencyUSD("es-US", 1234.5);
    expect(en).toMatch(/\$/);
    expect(es).toMatch(/\$/);
    // the underlying numeric value must be identical regardless of locale formatting
    const stripToDigits = (s: string) => s.replace(/[^\d]/g, "");
    expect(stripToDigits(en)).toBe(stripToDigits(es));
    expect(stripToDigits(en)).toBe("123450");
  });
});

describe("I18N-1 evidence and truth safety", () => {
  it("17. evidence is not passed through translation helpers", async () => {
    for (const file of ["src/i18n/format.ts", "src/i18n/translate.ts", "src/i18n/locale.ts", "src/i18n/actions.ts"]) {
      const source = await readFile(resolve(process.cwd(), file), "utf8");
      expect(source.toLowerCase()).not.toContain("evidence");
    }
  });

  it("18. unsupported/missing semantic localization fails safely", () => {
    // @ts-expect-error -- intentionally an invalid key to prove the fallback marker, not a blank string or a throw
    expect(t("en-US", "trust.NOT_A_REAL_STATE")).toBe("[[missing: trust.NOT_A_REAL_STATE]]");
  });

  it("20. switching locale does not mutate canonical semantic state", () => {
    for (const state of Object.keys(TRUST_STATES) as (keyof typeof TRUST_STATES)[]) {
      const en = renderToStaticMarkup(TrustState({ state, locale: "en-US" }));
      const es = renderToStaticMarkup(TrustState({ state, locale: "es-US" }));
      const classOf = (html: string) => html.match(/class="([^"]+)"/)?.[1];
      expect(classOf(en)).toBe(classOf(es));
      expect(classOf(en)).toContain(`state-${state.toLowerCase()}`);
    }
    const enCurrentness = renderToStaticMarkup(CurrentnessBadge({ state: "AGING", locale: "en-US" }));
    const esCurrentness = renderToStaticMarkup(CurrentnessBadge({ state: "AGING", locale: "es-US" }));
    expect(enCurrentness.match(/class="([^"]+)"/)?.[1]).toBe(esCurrentness.match(/class="([^"]+)"/)?.[1]);
    const enScope = renderToStaticMarkup(ScopeBadge({ scope: "UNKNOWN", locale: "en-US" }));
    const esScope = renderToStaticMarkup(ScopeBadge({ scope: "UNKNOWN", locale: "es-US" }));
    expect(enScope.match(/class="([^"]+)"/)?.[1]).toBe(esScope.match(/class="([^"]+)"/)?.[1]);
  });
});
