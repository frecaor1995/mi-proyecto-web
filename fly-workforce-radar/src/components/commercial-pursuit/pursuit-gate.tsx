import type { Locale } from "../../i18n/locale";
import { pursuitCopy } from "./pursuit-copy";

export function PursuitGate({ locale, state }: { readonly locale: Locale; readonly state: "UNAUTHENTICATED" | "UNAUTHORIZED" | "UNAVAILABLE" | "NOT_FOUND" }) {
  const c = pursuitCopy(locale);
  const message = { UNAUTHENTICATED: c.signIn, UNAUTHORIZED: c.unauthorized, UNAVAILABLE: c.unavailable, NOT_FOUND: c.notFound }[state];
  return <section className="sig-panel"><h2>{c.title}</h2><p className="po-empty">{message}</p></section>;
}
