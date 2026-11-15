import type { Locale } from "../../i18n/locale";
import type { CommercialActionItem } from "../../server/read-models/commercial-action";

/**
 * Plain-language explanation of a commercial-action recommendation for the operator. The rule engine's own
 * explanation (e.g. "VERIFY_MANPOWER_ACCEPTANCE: selected by commercial-action@1.0.0 …") stays unchanged in the
 * read model (CommercialActionItem.whyNow) for traceability; it is just not the text shown to people.
 */
const EXPLANATIONS: Record<Locale, Record<string, string>> = {
  "en-US": {
    CALL_TODAY: "There is a verified contact and the opportunity is ready: call today.",
    EMAIL_TODAY: "There is a verified email and the opportunity is ready: write today.",
    CONTACT_RECRUITER: "The available route is the company's recruiter: contact them to offer workforce.",
    REGISTER_AS_VENDOR: "The company works with registered suppliers: start the vendor registration.",
    VERIFY_CONTACT: "Before calling, confirm that the recorded contact is still correct.",
    VERIFY_MANPOWER_ACCEPTANCE: "We do not know yet whether this company accepts workers from agencies or external suppliers. Confirm it before offering workers.",
    RESEARCH_PROJECT: "Project information is missing (scope, dates or contractor). Research it before reaching out.",
    RESOLVE_CONFLICT: "The evidence contains contradicting data. Resolve it before acting.",
    WAIT: "There is no useful commercial step yet; wait for new evidence.",
  },
  "es-US": {
    CALL_TODAY: "Hay un contacto verificado y la oportunidad está lista: conviene llamar hoy.",
    EMAIL_TODAY: "Hay un correo verificado y la oportunidad está lista: conviene escribir hoy.",
    CONTACT_RECRUITER: "La vía disponible es el reclutador de la empresa: contáctelo para ofrecer personal.",
    REGISTER_AS_VENDOR: "La empresa trabaja con proveedores registrados: conviene iniciar el registro como proveedor.",
    VERIFY_CONTACT: "Antes de llamar, confirme que el contacto registrado sigue siendo correcto.",
    VERIFY_MANPOWER_ACCEPTANCE: "Aún no sabemos si esta empresa acepta trabajadores de agencias o proveedores externos. Confírmelo antes de ofrecer personal.",
    RESEARCH_PROJECT: "Falta información del proyecto (alcance, fechas o contratista). Investíguelo antes de contactar.",
    RESOLVE_CONFLICT: "La evidencia contiene datos que se contradicen. Resuélvalos antes de actuar.",
    WAIT: "Por ahora no hay un paso comercial útil; espere nueva evidencia.",
  },
};

const SUFFIX: Record<Locale, { readonly recommendation: string; readonly gaps: (n: number) => string; readonly fallback: string }> = {
  "en-US": { recommendation: "Recommendation only: the system contacts no one.", gaps: (n) => `${n} missing data point${n === 1 ? "" : "s"}.`, fallback: "Review the opportunity before acting." },
  "es-US": { recommendation: "Es solo una recomendación: el sistema no contacta a nadie.", gaps: (n) => `${n} dato${n === 1 ? "" : "s"} pendiente${n === 1 ? "" : "s"}.`, fallback: "Revise la oportunidad antes de actuar." },
};

export function commercialActionExplanation(locale: Locale, item: Pick<CommercialActionItem, "recommendation" | "blockers">): string {
  const s = SUFFIX[locale] ?? SUFFIX["en-US"];
  const base = (EXPLANATIONS[locale] ?? EXPLANATIONS["en-US"])[item.recommendation] ?? s.fallback;
  return [base, item.blockers.length ? s.gaps(item.blockers.length) : null, s.recommendation].filter(Boolean).join(" ");
}
