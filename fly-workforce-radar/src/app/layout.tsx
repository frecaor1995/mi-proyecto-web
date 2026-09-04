import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "../components/shell/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fly Workforce Radar", template: "%s · Fly Workforce Radar" },
  description: "Workforce Intelligence & Commercial Opportunity Platform for Fly Electric Solutions LLC.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to main content</a><AppShell>{children}</AppShell></body></html>;
}
