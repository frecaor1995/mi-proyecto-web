import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "../components/shell/app-shell";
import { resolveServerLocale } from "../i18n/server-locale";
import { t } from "../i18n/translate";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale();
  return {
    title: { default: t(locale, "meta.title"), template: t(locale, "meta.titleTemplate") },
    description: t(locale, "meta.description"),
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await resolveServerLocale();
  return (
    <html lang={locale}>
      <body>
        <a className="skip-link" href="#main-content">{t(locale, "a11y.skipToContent")}</a>
        <AppShell locale={locale}>{children}</AppShell>
      </body>
    </html>
  );
}
