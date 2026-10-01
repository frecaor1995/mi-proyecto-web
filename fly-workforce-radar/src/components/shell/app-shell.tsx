"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import type { Locale } from "../../i18n/locale";
import { t } from "../../i18n/translate";
import { signOutAction } from "../../server/auth/actions";
import type { ReadModelCapabilityState } from "../../server/read-models/shared";
import { Icon } from "../ui/icon";
import { LanguageSelector } from "./language-selector";

export interface ShellAuthState { readonly authenticated: boolean; readonly email: string | null }

export const NAVIGATION = [
  { labelKey: "nav.groupOverview", planned: false, secondary: false, items: [{ href: "/command-center", labelKey: "nav.commandCenter", icon: "grid" }] },
  { labelKey: "nav.groupWorkflow", planned: false, secondary: false, items: [{ href: "/radar", labelKey: "nav.radar", icon: "radar" }, { href: "/opportunities", labelKey: "nav.opportunities", icon: "check" }, { href: "/workforce", labelKey: "nav.workforce", icon: "user" }] },
  { labelKey: "nav.groupIntelligence", planned: false, secondary: false, items: [{ href: "/companies", labelKey: "nav.companies", icon: "building" }, { href: "/projects", labelKey: "nav.projects", icon: "project" }] },
  { labelKey: "nav.groupIntelligence", planned: false, secondary: true, items: [{ href: "/hot", labelKey: "nav.hot", icon: "flame" }, { href: "/near-ready", labelKey: "nav.nearReady", icon: "near" }, { href: "/verification", labelKey: "nav.verification", icon: "verify" }] },
  { labelKey: "nav.groupPlanned", planned: true, secondary: true, items: [{ href: "/contacts", labelKey: "nav.contacts", icon: "users" }, { href: "/signals", labelKey: "nav.signals", icon: "signal" }, { href: "/actions", labelKey: "nav.actions", icon: "action" }, { href: "/evidence", labelKey: "nav.evidence", icon: "evidence" }, { href: "/relationships", labelKey: "nav.relationships", icon: "relation" }, { href: "/sources", labelKey: "nav.sources", icon: "source" }, { href: "/activity", labelKey: "nav.activity", icon: "activity" }, { href: "/settings", labelKey: "nav.settings", icon: "settings" }] },
] as const;

export const isActiveRoute = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function AppShell({ children, locale, authState = { authenticated: false, email: null }, dataConnectionCapability = "UNKNOWN" }: { children: ReactNode; locale: Locale; authState?: ShellAuthState; dataConnectionCapability?: ReadModelCapabilityState }) {
  const path = usePathname();
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  return <div className={`app-shell ${compact ? "is-compact" : ""} ${open ? "nav-open" : ""}`}>
    <button className="nav-scrim" aria-label={t(locale, "a11y.closeNavigation")} onClick={() => setOpen(false)} />
    <aside className="sidebar" aria-label={t(locale, "a11y.primaryNavigation")}>
      <div className="brand"><span className="brand-mark"><span /><span /><span /></span><div><strong>{t(locale, "shell.brandName")}</strong><small>{t(locale, "shell.brandSubtitle")}</small></div><button className="icon-button desktop-only" onClick={() => setCompact((value) => !value)} aria-label={compact ? t(locale, "a11y.expandNavigation") : t(locale, "a11y.collapseNavigation")} aria-expanded={!compact}><Icon name="panel" /></button></div>
      <nav>{NAVIGATION.map((group, index) => {
        const links = group.items.map((item) => { const active = isActiveRoute(path, item.href); const label = t(locale, item.labelKey); return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`${active ? "active" : ""}${group.planned ? " nav-planned-link" : ""}`} aria-current={active ? "page" : undefined} title={compact ? label : undefined}><Icon name={item.icon} /><span>{label}</span>{group.planned ? <em className="nav-soon">{t(locale, "nav.plannedBadge")}</em> : null}</Link>; });
        return group.secondary ? <details className={`nav-group ${group.planned ? "nav-planned" : "nav-secondary"}`} key={`${group.labelKey}-${index}`} open={group.items.some((item) => isActiveRoute(path, item.href))}><summary>{t(locale, group.labelKey)}</summary>{links}</details> : <section className="nav-group" key={`${group.labelKey}-${index}`} aria-label={t(locale, group.labelKey)}><h2>{t(locale, group.labelKey)}</h2>{links}</section>;
      })}</nav>
      <div className="sidebar-foot"><span className="access-lock"><Icon name="warning" />{t(locale, "shell.internalDevelopment")}</span></div>
    </aside>
    <div className="app-frame"><header className="topbar"><button className="icon-button mobile-menu" aria-label={t(locale, "a11y.openNavigation")} onClick={() => setOpen(true)} aria-expanded={open}><Icon name="menu" /></button><div className="mobile-brand">{t(locale, "shell.brandName")} <span>{t(locale, "shell.mobileBrandSuffix")}</span></div><div className="topbar-context"><span className={`cc-connection-${dataConnectionCapability.toLowerCase()}`} /><strong>{t(locale, `capabilityState.${dataConnectionCapability}`)}</strong></div><div className="topbar-status"><LanguageSelector locale={locale} />{authState.authenticated ? <form action={signOutAction} className="session-control"><span title={authState.email ?? undefined}>{authState.email ?? t(locale, "auth.sessionEmailLabel")}</span><button type="submit">{t(locale, "auth.signOutAction")}</button></form> : <Link href="/login" className="session-control">{t(locale, "auth.unauthenticatedLabel")}</Link>}</div></header><main id="main-content" className="workspace" tabIndex={-1}>{children}</main></div>
  </div>;
}
