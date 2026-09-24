import type { Locale } from "../../i18n/locale";

export const commercialIntakeCopy = {
  "en-US": {
    eyebrow:"Commercial intake", title:"New opportunity / Intake", description:"Turn a real workforce request into traceable evidence, a current demand, and a matching-ready opportunity.",
    source:"Source and provenance", sourceType:"Source type", reference:"Source reference (optional except public source)", evidence:"What was requested / evidence summary",
    customer:"Customer / contractor", opportunity:"Opportunity title", project:"Project / site (optional)", city:"City", state:"State",
    demand:"Workforce demand", trade:"Trade", occupation:"Occupation", headcount:"Requested workers", experience:"Minimum experience (months)", start:"Start date", schedule:"Schedule / timing (optional)",
    requirements:"Match-relevant requirements", skills:"Skills", credentials:"Credentials / certifications", required:"Required", preferred:"Preferred", none:"Not selected",
    activate:"Activate opportunity", pending:"Activating…", restricted:"You do not have permission to activate commercial intake.", unavailable:"Commercial intake is temporarily unavailable.",
    honest:"Only record facts supplied by the source. Optional blank values remain unknown and will appear as honest gaps.", invalid:"Correct the highlighted intake information and try again.",
    PHONE_CALL:"Phone call", EMAIL:"Email", REFERRAL:"Referral", CUSTOMER_CONVERSATION:"Customer conversation", PUBLIC_SOURCE:"Public source / governed lead",
  },
  "es-US": {
    eyebrow:"Ingreso comercial", title:"Nueva oportunidad / Ingreso", description:"Convierta una solicitud real de personal en evidencia trazable, demanda vigente y una oportunidad lista para matching.",
    source:"Fuente y procedencia", sourceType:"Tipo de fuente", reference:"Referencia de fuente (opcional excepto fuente pública)", evidence:"Solicitud recibida / resumen de evidencia",
    customer:"Cliente / contratista", opportunity:"Título de la oportunidad", project:"Proyecto / sitio (opcional)", city:"Ciudad", state:"Estado",
    demand:"Demanda de personal", trade:"Oficio", occupation:"Ocupación", headcount:"Trabajadores solicitados", experience:"Experiencia mínima (meses)", start:"Fecha de inicio", schedule:"Horario / momento (opcional)",
    requirements:"Requisitos relevantes para matching", skills:"Habilidades", credentials:"Credenciales / certificaciones", required:"Requerido", preferred:"Preferido", none:"No seleccionado",
    activate:"Activar oportunidad", pending:"Activando…", restricted:"No tiene permiso para activar ingresos comerciales.", unavailable:"El ingreso comercial no está disponible temporalmente.",
    honest:"Registre únicamente hechos proporcionados por la fuente. Los campos opcionales vacíos permanecen desconocidos y se mostrarán como brechas.", invalid:"Corrija la información indicada e intente nuevamente.",
    PHONE_CALL:"Llamada telefónica", EMAIL:"Correo electrónico", REFERRAL:"Referencia", CUSTOMER_CONVERSATION:"Conversación con cliente", PUBLIC_SOURCE:"Fuente pública / oportunidad gobernada",
  },
} as const satisfies Record<Locale, Record<string,string>>;
