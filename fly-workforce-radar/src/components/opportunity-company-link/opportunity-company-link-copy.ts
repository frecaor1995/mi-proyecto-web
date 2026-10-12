import type { Locale } from "../../i18n/locale";

/** Opportunity → company link copy (EN/ES); follows the selected language. */
const en = {
  title: "Opportunities linked to this company",
  lede: "A link is a human decision: someone reviewed the evidence and confirmed that the opportunity concerns this company. A name match is only a suggestion; nothing is linked automatically.",
  linked: "Linked", noLinked: "No opportunity is linked to this company.", linkedOn: "linked on", reason: "Reason", aggregatorLinked: "Source is a job aggregator; the published pay is not attributed to this company.",
  candidates: "Unlinked opportunities you can review", noCandidates: "There is no unlinked opportunity of the same kind (real/DEMO).",
  suggested: "Suggested by name", suggestedNote: "The text recorded with the opportunity names this company. Review the evidence before deciding.",
  companyText: "Company text recorded", sources: "Evidence", noSources: "No source URL recorded.", demand: "Demand", pay: "Published pay",
  payNote: "Shown as published by the source. Linking does not make it this company's pay.",
  aggregatorWarning: "Aggregator source. This listing comes from a job board that republishes or summarizes third-party postings. It does not confirm that this company is the employer, and its pay range is not this company's pay.",
  open: "Review and link", linkReason: "Why this opportunity concerns this company (min. 20 characters) *", evidenceNote: "Additional evidence reviewed (optional)",
  ackAggregator: "I understand the source is an aggregator: the employer is not confirmed by it and its pay is not attributed to this company.",
  confirm: "I reviewed the evidence and confirm this link as a human decision.", save: "Link opportunity", saving: "Linking…",
  saved: "Linked. The decision and its evidence were recorded.", check: "Check:", restricted: "Your operator account cannot do this.",
  unavailable: "The local database is unavailable.", failed: "Could not link. Nothing was recorded; try again or tell the administrator.",
  demoTag: "DEMO", readOnly: "Read-only: your account cannot link opportunities.",
  fields: { opportunityId: "Opportunity", companyId: "Company", reason: "Reason", humanConfirmed: "Human confirmation", aggregatorAcknowledged: "Aggregator warning" } as Record<string, string>,
  errors: { required: "required", tooShort: "write at least 20 characters", demoMismatch: "a DEMO record can only be linked to a DEMO record", alreadyLinked: "this opportunity is already linked",
    linkedToOtherCompany: "this opportunity is already linked to another company", notFound: "not found" } as Record<string, string>,
};

const es: typeof en = {
  title: "Oportunidades vinculadas a esta empresa",
  lede: "Un vínculo es una decisión humana: alguien revisó la evidencia y confirmó que la oportunidad corresponde a esta empresa. Una coincidencia de nombre es solo una sugerencia; nada se vincula automáticamente.",
  linked: "Vinculadas", noLinked: "No hay oportunidades vinculadas a esta empresa.", linkedOn: "vinculada el", reason: "Motivo", aggregatorLinked: "La fuente es un agregador de empleos; el salario publicado no se atribuye a esta empresa.",
  candidates: "Oportunidades sin vincular que puedes revisar", noCandidates: "No hay oportunidades sin vincular del mismo tipo (real/DEMO).",
  suggested: "Sugerida por nombre", suggestedNote: "El texto registrado con la oportunidad menciona a esta empresa. Revisa la evidencia antes de decidir.",
  companyText: "Texto de empresa registrado", sources: "Evidencia", noSources: "No hay URL de fuente registrada.", demand: "Demanda", pay: "Salario publicado",
  payNote: "Se muestra tal como lo publicó la fuente. Vincular no lo convierte en el salario de esta empresa.",
  aggregatorWarning: "Fuente agregadora. Este anuncio viene de un portal de empleo que republica o resume ofertas de terceros. No confirma que esta empresa sea el empleador, y su rango salarial no es el salario de esta empresa.",
  open: "Revisar y vincular", linkReason: "Por qué esta oportunidad corresponde a esta empresa (mín. 20 caracteres) *", evidenceNote: "Evidencia adicional revisada (opcional)",
  ackAggregator: "Entiendo que la fuente es un agregador: no confirma al empleador y su salario no se atribuye a esta empresa.",
  confirm: "Revisé la evidencia y confirmo este vínculo como decisión humana.", save: "Vincular oportunidad", saving: "Vinculando…",
  saved: "Vinculada. La decisión y su evidencia quedaron registradas.", check: "Revisa:", restricted: "Tu cuenta de operador no puede hacer esto.",
  unavailable: "La base de datos local no está disponible.", failed: "No se pudo vincular. No se registró nada; inténtalo de nuevo o avisa al administrador.",
  demoTag: "DEMO", readOnly: "Solo lectura: tu cuenta no puede vincular oportunidades.",
  fields: { opportunityId: "Oportunidad", companyId: "Empresa", reason: "Motivo", humanConfirmed: "Confirmación humana", aggregatorAcknowledged: "Advertencia de agregador" },
  errors: { required: "obligatorio", tooShort: "escribe al menos 20 caracteres", demoMismatch: "un registro DEMO solo puede vincularse con otro registro DEMO", alreadyLinked: "esta oportunidad ya está vinculada",
    linkedToOtherCompany: "esta oportunidad ya está vinculada a otra empresa", notFound: "no encontrado" },
};

export const opportunityCompanyLinkCopy = (locale: Locale) => (locale === "es-US" ? es : en);
