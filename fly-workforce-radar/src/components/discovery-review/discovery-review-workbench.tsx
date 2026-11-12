"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { Locale } from "../../i18n/locale";
import { companyReviewAction, demandReviewAction, promoteVerifiedDemandAction, type DiscoveryReviewActionState } from "../../server/discovery-review/actions";
import type { DiscoveryReviewCase } from "../../server/discovery-review/discovery-review-workflow";
import { labelFor } from "../discovery-intelligence/intelligence-copy";

const COPY = {
  "en-US": {
    saved: "Decision saved. The review state is current.", eyebrow: "Controlled human review", title: "Company → demand → promotion",
    verified: "DEMAND VERIFIED", demandRequired: "DEMAND REVIEW REQUIRED", companyRequired: "COMPANY REVIEW REQUIRED", postingFirst: "POSTING VERIFICATION REQUIRED",
    observedIdentity: "Observed identity", noIdentity: "Identity not established", source: "Source", professionLevel: "Profession / level", location: "Location", unknown: "Unknown",
    quantity: "Quantity", headcount: "Employer headcount", headcountVerify: "Requires demand verification", aggregateWarning: "Aggregate source count — not confirmed employer headcount.",
    openSource: "Open source evidence ↗",
    companyTitle: "Confirm the company identity", companyLede: "Choose the supported outcome. Nothing is linked merely by opening this page.", decision: "Decision", select: "Select an outcome",
    companyOutcomes: { LINK: "Link existing company", CREATE: "Create canonical company", REJECT_MATCH: "Reject possible match", DEFER: "Defer decision", UNSUPPORTED: "Identity unsupported", KEEP_UNRESOLVED: "Keep unresolved", NOT_ACTIONABLE: "Not actionable" } as Record<string, string>,
    existing: "Existing canonical company", noCompany: "No company selected", newName: "New company name (only for Create)", reason: "Reason / supporting evidence",
    companyConfirm: "I confirm this is my human company-resolution decision.", saving: "Saving…", companySubmit: "Confirm company decision", current: "Current:",
    demandTitle: "Is there documented demand?", demandLede: "Company resolution and demand verification are separate decisions. Verifying confirms that the posting documents a real labor need for this company; it does not confirm that the company buys external labor. Unknown optional facts remain unknown.",
    demandOutcomes: { VERIFY: "Verify demand (documented labor need)", REJECT: "Reject / not supported", DEFER: "Defer decision" } as Record<string, string>,
    demandReason: "Reason / evidence reviewed", demandConfirm: "I confirm the source supports this demand decision.", resolveFirst: "Resolve a canonical company first.", verifyPostingFirst: "Verify the posting first (step 1).",
    demandSubmit: "Confirm demand decision", headcountShort: "Headcount",
    promotionTitle: "Promotion boundary", promotionLede: "Verified demand is not an opportunity until you deliberately promote it.", openOpportunity: "Open existing opportunity",
    promotionConfirm: "I confirm promotion into the opportunity pipeline.", promoting: "Promoting…", promote: "Promote to opportunity", demandRequiredGate: "Demand verification is required before promotion.",
    contactIntelligence: "Contact Intelligence", available: "AVAILABLE", notYet: "NOT YET AVAILABLE", openContacts: "Open contacts →",
  },
  "es-US": {
    saved: "Decisión guardada. El estado de la revisión está actualizado.", eyebrow: "Revisión humana controlada", title: "Empresa → demanda → promoción",
    verified: "DEMANDA VERIFICADA", demandRequired: "REQUIERE REVISIÓN DE DEMANDA", companyRequired: "REQUIERE REVISIÓN DE EMPRESA", postingFirst: "REQUIERE VERIFICAR LA PUBLICACIÓN",
    observedIdentity: "Identidad observada", noIdentity: "Identidad no establecida", source: "Fuente", professionLevel: "Profesión / nivel", location: "Ubicación", unknown: "Desconocido",
    quantity: "Cantidad", headcount: "Personal requerido por la empresa", headcountVerify: "Requiere verificar la demanda", aggregateWarning: "Conteo agregado de la fuente — no es personal confirmado del empleador.",
    openSource: "Abrir evidencia de la fuente ↗",
    companyTitle: "Confirmar la identidad de la empresa", companyLede: "Elige el resultado que respalda la evidencia. Abrir esta página no vincula nada.", decision: "Decisión", select: "Selecciona un resultado",
    companyOutcomes: { LINK: "Vincular empresa existente", CREATE: "Crear empresa canónica", REJECT_MATCH: "Rechazar posible coincidencia", DEFER: "Aplazar decisión", UNSUPPORTED: "Identidad sin respaldo", KEEP_UNRESOLVED: "Mantener sin resolver", NOT_ACTIONABLE: "No accionable" } as Record<string, string>,
    existing: "Empresa canónica existente", noCompany: "Ninguna empresa seleccionada", newName: "Nombre de la nueva empresa (solo para Crear)", reason: "Motivo / evidencia de respaldo",
    companyConfirm: "Confirmo que esta es mi decisión humana sobre la identidad de la empresa.", saving: "Guardando…", companySubmit: "Confirmar decisión de empresa", current: "Actual:",
    demandTitle: "¿Existe demanda documentada?", demandLede: "La identidad de la empresa y la verificación de la demanda son decisiones separadas. Verificar confirma que la publicación documenta una necesidad laboral real de esta empresa; no confirma que la empresa compre personal externo. Los datos opcionales desconocidos siguen desconocidos.",
    demandOutcomes: { VERIFY: "Verificar demanda (necesidad laboral documentada)", REJECT: "Rechazar / sin respaldo", DEFER: "Aplazar decisión" } as Record<string, string>,
    demandReason: "Motivo / evidencia revisada", demandConfirm: "Confirmo que la fuente respalda esta decisión de demanda.", resolveFirst: "Primero resuelve una empresa canónica.", verifyPostingFirst: "Primero verifica la publicación (paso 1).",
    demandSubmit: "Confirmar decisión de demanda", headcountShort: "Personal",
    promotionTitle: "Límite de promoción", promotionLede: "La demanda verificada no es una oportunidad hasta que la promuevas deliberadamente.", openOpportunity: "Abrir oportunidad existente",
    promotionConfirm: "Confirmo la promoción al flujo de oportunidades.", promoting: "Promoviendo…", promote: "Promover a oportunidad", demandRequiredGate: "Se requiere verificar la demanda antes de promover.",
    contactIntelligence: "Inteligencia de contactos", available: "DISPONIBLE", notYet: "AÚN NO DISPONIBLE", openContacts: "Abrir contactos →",
  },
} as const;

const IDLE:DiscoveryReviewActionState={status:"IDLE",error:null};
const ES_ERRORS:Record<string,string>={
  "Complete the decision and reason before confirming.":"Completa la decisión y el motivo antes de confirmar.","This action requires Human Verification permission.":"Esta acción requiere permiso de verificación humana.",
  "The governed local database is unavailable.":"La base de datos local gobernada no está disponible.","Verify the posting before the company decision.":"Verifica la publicación antes de la decisión de empresa.",
  "Resolve the canonical company before demand review":"Resuelve la empresa canónica antes de revisar la demanda.","Select a canonical company":"Selecciona una empresa canónica.","Canonical company not found":"No se encontró la empresa canónica.",
  "Company name is required":"El nombre de la empresa es obligatorio.","Verify the canonical demand before promotion.":"Verifica la demanda canónica antes de promover.","Discovery observation not found":"No se encontró la observación.","Invalid review case.":"Caso de revisión inválido.","Verify the posting before promotion.":"Verifica la publicación antes de promover.","Confirm the canonical company before promotion.":"Confirma la empresa canónica antes de promover.",
};
function Result({state,saved,locale}:{state:DiscoveryReviewActionState;saved:string;locale:Locale}){return state.error?<p className="review-r1-error" role="alert">{locale==="es-US"?ES_ERRORS[state.error]??state.error:state.error}</p>:state.status==="SAVED"?<p className="review-r1-ok" role="status">{saved}</p>:null;}

/**
 * `postingVerified` applies to recorded postings (Recipe 2.x): null for other observations. When false, the company
 * decision stays locked until the posting itself has been verified (the server enforces the same rule).
 */
export function DiscoveryReviewWorkbench({review,locale="en-US",postingVerified=null,firstStep=1}:{readonly review:DiscoveryReviewCase;readonly locale?:Locale;readonly postingVerified?:boolean|null;readonly firstStep?:number}){
  const t=COPY[locale];
  const [companyState,companyAction,companyPending]=useActionState(companyReviewAction,IDLE);
  const [demandState,demandAction,demandPending]=useActionState(demandReviewAction,IDLE);
  const [promotionState,promotionAction,promotionPending]=useActionState(promoteVerifiedDemandAction,IDLE);
  const resolved=Boolean(review.companyDecision?.companyId);
  const verified=review.demandDecision?.decision==="VERIFY";
  const companyLocked=postingVerified===false;
  const n=(offset:number)=>String(firstStep+offset).padStart(2,"0");
  return <section className="review-r1-shell" aria-labelledby="review-r1-title">
    <header className="review-r1-header"><div><p className="po-eyebrow">{t.eyebrow}</p><h2 id="review-r1-title">{t.title}</h2></div><span className="review-r1-state">{verified?t.verified:resolved?t.demandRequired:companyLocked?t.postingFirst:t.companyRequired}</span></header>
    <div className="review-r1-evidence">
      <div><span>{t.observedIdentity}</span><strong>{review.observedCompany??t.noIdentity}</strong></div><div><span>{t.source}</span><strong>{review.source}</strong></div>
      <div><span>{t.professionLevel}</span><strong>{review.profession?labelFor(locale,review.profession):t.unknown} · {labelFor(locale,review.level)}</strong></div><div><span>{t.location}</span><strong>{review.location??t.unknown}</strong></div>
      <div><span>{t.quantity}</span><strong>{review.quantity.value??t.unknown} · {labelFor(locale,review.quantity.type)}</strong></div><div><span>{t.headcount}</span><strong>{review.quantity.type==="EXPLICIT_EMPLOYER_HEADCOUNT"?t.headcountVerify:t.unknown}</strong></div>
    </div>
    {review.quantity.type==="AGGREGATE_MARKET_COUNT"?<p className="review-r1-warning">{t.aggregateWarning}</p>:null}
    <blockquote className="review-r1-excerpt">{review.description??review.title}</blockquote>
    <a className="button button-secondary" href={review.url} target="_blank" rel="noreferrer noopener">{t.openSource}</a>

    <div className="review-r1-steps">
      <form action={companyAction} className={`review-r1-card ${companyLocked?"is-locked":""}`}>
        <span className="review-r1-number">{n(0)}</span><h3>{t.companyTitle}</h3><p>{t.companyLede}</p>
        <input type="hidden" name="candidateId" value={review.candidateId}/>
        <label><span>{t.decision}</span><select name="outcome" required defaultValue=""><option value="" disabled>{t.select}</option>{["LINK","CREATE","REJECT_MATCH","DEFER","UNSUPPORTED","KEEP_UNRESOLVED","NOT_ACTIONABLE"].map(o=><option key={o} value={o}>{t.companyOutcomes[o]}</option>)}</select></label>
        <label><span>{t.existing}</span><select name="companyId" defaultValue=""><option value="">{t.noCompany}</option>{review.companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label><span>{t.newName}</span><input name="companyName" maxLength={200} defaultValue={review.observedCompany??""}/></label>
        <label><span>{t.reason}</span><textarea name="reason" required maxLength={2000} rows={3}/></label>
        <label className="review-r1-confirm"><input type="checkbox" required/> {t.companyConfirm}</label>
        {companyLocked?<p className="review-r1-gate">{t.verifyPostingFirst}</p>:null}
        <Result state={companyState} saved={t.saved} locale={locale}/><button className="button button-primary" disabled={companyLocked||companyPending}>{companyPending?t.saving:t.companySubmit}</button>
        {review.companyDecision?<p className="review-r1-current"><b>{t.current}</b> {t.companyOutcomes[review.companyDecision.outcome]??review.companyDecision.outcome.replaceAll("_"," ")}{review.companyDecision.companyName?` · ${review.companyDecision.companyName}`:""}</p>:null}
      </form>

      <form action={demandAction} className={`review-r1-card ${!resolved?"is-locked":""}`}>
        <span className="review-r1-number">{n(1)}</span><h3>{t.demandTitle}</h3><p>{t.demandLede}</p>
        <input type="hidden" name="candidateId" value={review.candidateId}/>
        <label><span>{t.decision}</span><select name="outcome" required defaultValue=""><option value="" disabled>{t.select}</option>{["VERIFY","REJECT","DEFER"].map(o=><option key={o} value={o}>{t.demandOutcomes[o]}</option>)}</select></label>
        <label><span>{t.demandReason}</span><textarea name="reason" required maxLength={2000} rows={3}/></label>
        <label className="review-r1-confirm"><input type="checkbox" required/> {t.demandConfirm}</label>
        {!resolved?<p className="review-r1-gate">{t.resolveFirst}</p>:null}<Result state={demandState} saved={t.saved} locale={locale}/><button className="button button-primary" disabled={!resolved||demandPending}>{demandPending?t.saving:t.demandSubmit}</button>
        {review.demandDecision?<p className="review-r1-current"><b>{t.current}</b> {t.demandOutcomes[review.demandDecision.decision]??review.demandDecision.decision} · {t.headcountShort} {review.quantity.type==="EXPLICIT_EMPLOYER_HEADCOUNT"&&verified?review.quantity.value:t.unknown}</p>:null}
      </form>

      <form action={promotionAction} className={`review-r1-card ${!verified?"is-locked":""}`}>
        <span className="review-r1-number">{n(2)}</span><h3>{t.promotionTitle}</h3><p>{t.promotionLede}</p><input type="hidden" name="candidateId" value={review.candidateId}/>
        {review.demandDecision?.opportunityId?<Link className="button button-primary" href={`/opportunities/${review.demandDecision.opportunityId}`}>{t.openOpportunity}</Link>:<><label className="review-r1-confirm"><input type="checkbox" required/> {t.promotionConfirm}</label><Result state={promotionState} saved={t.saved} locale={locale}/><button className="button button-primary" disabled={!verified||promotionPending}>{promotionPending?t.promoting:t.promote}</button></>}
        {!verified?<p className="review-r1-gate">{t.demandRequiredGate}</p>:null}
      </form>
    </div>
    <footer className="review-r1-handoff"><div><span>{t.contactIntelligence}</span><strong>{review.contactIntelligenceAvailable?t.available:t.notYet}</strong></div><Link href="/contacts">{t.openContacts}</Link></footer>
  </section>;
}
