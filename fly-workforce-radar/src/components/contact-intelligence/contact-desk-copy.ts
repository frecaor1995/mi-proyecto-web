import type { Locale } from "../../i18n/locale";

/** Contact Intelligence company contact desk copy (EN/ES); follows the selected language. */
const en = {
  title: "Contact desk — corporate channels, calls and next actions",
  lede: "Corporate channels are published company lines (no person). Calls are recorded against the company. DEMO records are marked and never count as real activity, conversion, request or result.",
  channels: "Corporate channels", noChannels: "No corporate channel recorded.",
  routeTypes: { CORPORATE_PHONE: "Corporate phone", OFFICE_PHONE: "Office phone", CORPORATE_EMAIL: "Corporate email", PROCUREMENT_PHONE: "Procurement phone", PROCUREMENT_EMAIL: "Procurement email" } as Record<string, string>,
  channelBasis: "Published on the official source — not a buyer's personal channel, not a confirmed supplier channel, not tested by a call.",
  addChannel: "Add a corporate channel", routeType: "Channel type *", value: "Phone or email as published *", sourceUrl: "Official source (https) *", observedOn: "Seen on *",
  locationLabel: "Office / location (optional)", sourceNote: "Source note (optional)", saveChannel: "Save channel",
  calls: "Calls", noCalls: "No call recorded.", recordCall: "Record a call",
  callDate: "Call date *", channelUsed: "Channel used", noChannel: "— not from a recorded channel —", outcome: "Call result *", supplier: "Uses external suppliers or agencies? *",
  outcomes: { REACHED: "Reached someone", NO_ANSWER: "No answer", VOICEMAIL: "Voicemail", GATEKEEPER: "Gatekeeper / reception", WRONG_NUMBER: "Wrong number", CALL_BACK_REQUESTED: "Asked to call back", NOT_CALLED: "Not called (DEMO only)" } as Record<string, string>,
  answers: { YES: "YES", NO: "NO", OWN_AGENCY_ONLY: "OWN AGENCY ONLY", UNKNOWN: "UNKNOWN", NOT_ASKED: "NOT ASKED" } as Record<string, string>,
  counterpartName: "Who answered (optional)", counterpartRole: "Their role or department (optional)", notes: "Notes", isDemo: "DEMO / TEST record (never counts as real activity)",
  nextAction: "Next action (optional)", nextActionDue: "Due date", owner: "Owner", saveCall: "Save call",
  actions: "Next actions", noActions: "No next action.", addAction: "Add a next action", action: "Action *", dueDate: "Due date *", saveAction: "Save next action",
  status: { OPEN: "Open", DONE: "Done", CANCELLED: "Cancelled" } as Record<string, string>, markDone: "Mark done", cancel: "Cancel", resolutionNote: "Note (optional)",
  demoTag: "DEMO", due: "due", by: "by", overdue: "overdue",
  saving: "Saving…", saved: "Saved.", duplicate: "This channel is already recorded for the company.", check: "Check the highlighted fields.", restricted: "Your operator account cannot do this.", unavailable: "The local database is unavailable.", failed: "Could not save:",
  errors: {
    invalid: "Invalid", invalidPhone: "Enter a 10-digit US phone", invalidEmail: "Enter a valid email", httpsRequired: "An https source is required", invalidDate: "Invalid date", future: "Cannot be in the future", tooLong: "Too long",
    required: "Required", notCalledOnlyForDemo: "\"Not called\" is only valid for a DEMO record", answerNeedsReachedCall: "An answer about suppliers needs a call where someone was reached",
    demoNotesMustSayDemo: "DEMO notes must say DEMO / PRUEBA / TEST", demoActionMustSayDemo: "A DEMO action must say DEMO / PRUEBA / TEST", notThisCompany: "That channel belongs to another company",
    notFound: "Not found", notOpen: "This action is no longer open",
  } as Record<string, string>,
  pendingTitle: "Company next actions due today or overdue", pendingLede: "From Contact Intelligence. DEMO actions are listed apart and never count as real activity.",
  pendingReal: "Real", pendingDemo: "DEMO / TEST (excluded from real activity)", noPending: "Nothing due.", openCompany: "Open company →",
};

const es: typeof en = {
  title: "Mesa de contacto — canales corporativos, llamadas y próximas acciones",
  lede: "Los canales corporativos son líneas publicadas por la empresa (sin persona). Las llamadas se registran contra la empresa. Los registros DEMO quedan marcados y nunca cuentan como actividad, conversión, solicitud ni resultado real.",
  channels: "Canales corporativos", noChannels: "No hay canal corporativo registrado.",
  routeTypes: { CORPORATE_PHONE: "Teléfono corporativo", OFFICE_PHONE: "Teléfono de oficina", CORPORATE_EMAIL: "Correo corporativo", PROCUREMENT_PHONE: "Teléfono de compras", PROCUREMENT_EMAIL: "Correo de compras" },
  channelBasis: "Publicado en la fuente oficial — no es el canal personal de un comprador, no es un canal de proveedores confirmado y no se ha probado con una llamada.",
  addChannel: "Agregar un canal corporativo", routeType: "Tipo de canal *", value: "Teléfono o correo tal como se publica *", sourceUrl: "Fuente oficial (https) *", observedOn: "Visto el *",
  locationLabel: "Oficina / ubicación (opcional)", sourceNote: "Nota de la fuente (opcional)", saveChannel: "Guardar canal",
  calls: "Llamadas", noCalls: "No hay llamadas registradas.", recordCall: "Registrar una llamada",
  callDate: "Fecha de la llamada *", channelUsed: "Canal utilizado", noChannel: "— no es un canal registrado —", outcome: "Resultado de la llamada *", supplier: "¿Usa proveedores externos o agencias? *",
  outcomes: { REACHED: "Se habló con alguien", NO_ANSWER: "Sin respuesta", VOICEMAIL: "Buzón de voz", GATEKEEPER: "Recepción / filtro", WRONG_NUMBER: "Número equivocado", CALL_BACK_REQUESTED: "Pidieron volver a llamar", NOT_CALLED: "No se llamó (solo DEMO)" },
  answers: { YES: "SÍ", NO: "NO", OWN_AGENCY_ONLY: "SOLO AGENCIA PROPIA", UNKNOWN: "DESCONOCIDO", NOT_ASKED: "NO SE PREGUNTÓ" },
  counterpartName: "Quién respondió (opcional)", counterpartRole: "Su cargo o departamento (opcional)", notes: "Notas", isDemo: "Registro DEMO / PRUEBA (nunca cuenta como actividad real)",
  nextAction: "Próxima acción (opcional)", nextActionDue: "Fecha límite", owner: "Responsable", saveCall: "Guardar llamada",
  actions: "Próximas acciones", noActions: "No hay próximas acciones.", addAction: "Agregar una próxima acción", action: "Acción *", dueDate: "Fecha límite *", saveAction: "Guardar próxima acción",
  status: { OPEN: "Abierta", DONE: "Hecha", CANCELLED: "Cancelada" }, markDone: "Marcar como hecha", cancel: "Cancelar", resolutionNote: "Nota (opcional)",
  demoTag: "DEMO", due: "vence", by: "responsable", overdue: "vencida",
  saving: "Guardando…", saved: "Guardado.", duplicate: "Este canal ya está registrado para la empresa.", check: "Revisa los campos marcados.", restricted: "Tu cuenta de operador no puede hacer esto.", unavailable: "La base de datos local no está disponible.", failed: "No se pudo guardar:",
  errors: {
    invalid: "Inválido", invalidPhone: "Ingresa un teléfono de EE. UU. de 10 dígitos", invalidEmail: "Ingresa un correo válido", httpsRequired: "Se requiere una fuente https", invalidDate: "Fecha inválida", future: "No puede ser futura", tooLong: "Demasiado largo",
    required: "Obligatorio", notCalledOnlyForDemo: "\"No se llamó\" solo es válido para un registro DEMO", answerNeedsReachedCall: "Una respuesta sobre proveedores requiere una llamada en la que se habló con alguien",
    demoNotesMustSayDemo: "Las notas DEMO deben decir DEMO / PRUEBA / TEST", demoActionMustSayDemo: "Una acción DEMO debe decir DEMO / PRUEBA / TEST", notThisCompany: "Ese canal pertenece a otra empresa",
    notFound: "No encontrado", notOpen: "Esta acción ya no está abierta",
  },
  pendingTitle: "Próximas acciones de empresas para hoy o vencidas", pendingLede: "Desde Inteligencia de contactos. Las acciones DEMO se listan aparte y nunca cuentan como actividad real.",
  pendingReal: "Reales", pendingDemo: "DEMO / PRUEBA (excluidas de la actividad real)", noPending: "Nada pendiente.", openCompany: "Abrir empresa →",
};

export const contactDeskCopy = (locale: Locale) => (locale === "es-US" ? es : en);
