"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { EngagementSelectionState, WorkerDemandEngagement } from "../../domain/worker-demand-engagement";
import type { Locale } from "../../i18n/locale";
import { submitWorkerEngagementAction, type WorkerEngagementActionState } from "../../server/opportunity-detail/worker-engagement-actions";
import type { WorkerDemandEngagementUi } from "../../server/opportunity-detail/get-worker-demand-engagement-ui";

const INITIAL_WORKER_ENGAGEMENT_ACTION_STATE:WorkerEngagementActionState={status:"READY",reason:null,blockers:[]};

const labels={
  "en-US":{title:"Worker engagement",start:"Start engagement",selection:"Selection",contact:"Contact attempt",response:"Worker response",availability:"Opportunity availability",resolutions:"Compensation / travel",candidate:"Establish candidate",reconcile:"Reconcile safeguards",history:"Immutable history",restricted:"Engagement access is restricted.",none:"No engagement has started.",success:"Engagement updated.",route:"Authorized contact route",outcome:"Contact outcome",chooseOutcome:"Choose an outcome",from:"Available from",until:"Available until",blockers:"Readiness blockers",confirmCandidate:"Establish this worker as a mobilization candidate?",confirmReconcile:"Reconcile this engagement's safeguards?"},
  "es-US":{title:"Gestión del trabajador",start:"Iniciar gestión",selection:"Selección",contact:"Intento de contacto",response:"Respuesta del trabajador",availability:"Disponibilidad para la oportunidad",resolutions:"Compensación / viaje",candidate:"Establecer candidato",reconcile:"Conciliar salvaguardas",history:"Historial inmutable",restricted:"El acceso a la gestión está restringido.",none:"No se ha iniciado la gestión.",success:"Gestión actualizada.",route:"Ruta de contacto autorizada",outcome:"Resultado del contacto",chooseOutcome:"Seleccione un resultado",from:"Disponible desde",until:"Disponible hasta",blockers:"Bloqueos de preparación",confirmCandidate:"¿Establecer este trabajador como candidato para movilización?",confirmReconcile:"¿Conciliar las salvaguardas de esta gestión?"},
} as const;

const errorLabels={
  "en-US":{invalidSelection:"Choose a different selection status before saving.",actionFailed:"The engagement could not be updated. Review the current information and try again."},
  "es-US":{invalidSelection:"Seleccione un estado diferente antes de guardar.",actionFailed:"No se pudo actualizar la gestión. Revise la información actual e intente nuevamente."},
} as const;

type PanelProps={readonly locale:Locale;readonly opportunityId:string;readonly demandSignalId:string;readonly workerId:string;readonly data:WorkerDemandEngagementUi|undefined};
type Action=(form:FormData)=>void;
type SharedFormProps={readonly action:Action;readonly hidden:React.ReactNode;readonly engagement:WorkerDemandEngagement;readonly label:string;readonly pending:boolean};

const VIEWPORT_CONTINUITY_MARGIN=16;

export function shouldCorrectWorkerEngagementViewport(state:WorkerEngagementActionState,engagementSignature:string|null,lastCorrectedSignature:string|null){
  return state.status==="SUCCEEDED"&&engagementSignature!==null&&engagementSignature!==lastCorrectedSignature;
}

export function keepWorkerEngagementInView(element:HTMLElement,viewportHeight:number){
  const bounds=element.getBoundingClientRect();
  if(bounds.bottom>=VIEWPORT_CONTINUITY_MARGIN&&bounds.top<=viewportHeight-VIEWPORT_CONTINUITY_MARGIN)return false;
  element.scrollIntoView({block:"nearest",inline:"nearest"});
  return true;
}

export function WorkerEngagementPanel(props:PanelProps){
  const [open,setOpen]=useState(false);
  return <WorkerEngagementPanelStateful {...props} open={open} onOpenChange={setOpen}/>;
}

function WorkerEngagementPanelStateful({locale,opportunityId,demandSignalId,workerId,data,open,onOpenChange}:PanelProps&{readonly open:boolean;readonly onOpenChange:(open:boolean)=>void}){
  const copy=labels[locale],[state,action,pending]=useActionState(submitWorkerEngagementAction,INITIAL_WORKER_ENGAGEMENT_ACTION_STATE);
  const panelRef=useRef<HTMLDetailsElement>(null),lastCorrectedSignature=useRef<string|null>(null);
  const engagementSignature=data?.state==="READY"&&data.engagement?`${data.engagement.id}:${data.engagement.version}`:null;
  useEffect(()=>{
    if(!shouldCorrectWorkerEngagementViewport(state,engagementSignature,lastCorrectedSignature.current))return;
    lastCorrectedSignature.current=engagementSignature;
    const panel=panelRef.current;
    if(panel)keepWorkerEngagementInView(panel,window.innerHeight);
  },[engagementSignature,state]);
  if(!data||data.state==="UNAVAILABLE")return null;
  if(data.state==="RESTRICTED")return <div className="engagement-panel engagement-restricted">{copy.restricted}</div>;
  const engagement=data.engagement;
  const hidden=<><input type="hidden" name="opportunityId" value={opportunityId}/><input type="hidden" name="demandSignalId" value={demandSignalId}/><input type="hidden" name="workerId" value={workerId}/><input type="hidden" name="engagementId" value={engagement?.id??""}/><input type="hidden" name="expectedVersion" value={engagement?.version??0}/><input type="hidden" name="matchResultId" value={data.currentMatchResultId??""}/></>;
  return <details ref={panelRef} className="engagement-panel" open={open} onToggle={event=>onOpenChange(event.currentTarget.open)}><summary><span>{copy.title}</span><strong>{engagement?.mobilizationState??copy.none}</strong></summary>
    <div className="engagement-body">
      {data.warnings.map(w=><p className="engagement-warning" key={w}>{w.replaceAll("_"," ")}</p>)}
      {state.status==="SUCCEEDED"?<p role="status" className="engagement-success">{copy.success}</p>:null}
      <WorkerEngagementActionFeedback locale={locale} state={state}/>
      {!engagement&&data.permissions.canWrite?<form action={action}>{hidden}<input type="hidden" name="command" value="CREATE"/><button type="submit" disabled={pending}>{copy.start}</button></form>:null}
      {engagement&&data.permissions.canWrite?<>
        <SelectionCommandForm action={action} hidden={hidden} engagement={engagement} label={copy.selection} pending={pending} key={`${engagement.id}:selection:${engagement.selectionState}`}/>
        {data.permissions.canReadContact&&data.permissions.canExecuteContact&&data.contactChoices.length?<ContactCommandForm action={action} hidden={hidden} label={copy.contact} routeLabel={copy.route} outcomeLabel={copy.outcome} chooseOutcomeLabel={copy.chooseOutcome} contactChoices={data.contactChoices} pending={pending} key={`${engagement.id}:contact:${engagement.version}`}/>:null}
        <ResponseCommandForm action={action} hidden={hidden} engagement={engagement} label={copy.response} pending={pending} key={`${engagement.id}:response:${engagement.responseState}`}/>
        <AvailabilityCommandForm action={action} hidden={hidden} engagement={engagement} label={copy.availability} fromLabel={copy.from} untilLabel={copy.until} pending={pending} key={`${engagement.id}:availability:${engagement.demandAvailabilityState}:${engagement.availableFrom?.toString()??""}:${engagement.availableUntil?.toString()??""}`}/>
        <ResolutionCommandForm action={action} hidden={hidden} engagement={engagement} label={copy.resolutions} pending={pending} key={`${engagement.id}:resolutions:${engagement.compensationResolutionState}:${engagement.travelResolutionState}`}/>
        <div className="engagement-actions"><CommandForm action={action} hidden={hidden} command="ESTABLISH_CANDIDATE" label={copy.candidate} pending={pending} disabled={engagement.mobilizationState==="CANDIDATE"} confirmation={copy.confirmCandidate}/><CommandForm action={action} hidden={hidden} command="RECONCILE_SAFEGUARDS" label={copy.reconcile} pending={pending} confirmation={copy.confirmReconcile}/></div>
      </>:null}
      {engagement?<dl className="engagement-summary"><div><dt>{copy.selection}</dt><dd>{engagement.selectionState}</dd></div><div><dt>{copy.contact}</dt><dd>{engagement.contactState}</dd></div><div><dt>{copy.response}</dt><dd>{engagement.responseState}</dd></div><div><dt>{copy.availability}</dt><dd>{engagement.demandAvailabilityState}</dd></div></dl>:null}
      {data.history.length?<details className="engagement-history"><summary>{copy.history} ({data.history.length})</summary><ol>{data.history.map(event=><li key={event.id}><strong>{event.eventType.replaceAll("_"," ")}</strong><time>{new Date(event.occurredAt).toLocaleString(locale)}</time>{event.reasonCode?<span>{event.reasonCode}</span>:null}</li>)}</ol></details>:null}
    </div>
  </details>;
}

export function WorkerEngagementActionFeedback({locale,state}:{readonly locale:Locale;readonly state:WorkerEngagementActionState}){
  if(state.status!=="REJECTED")return null;
  const copy=labels[locale],errors=errorLabels[locale],message=state.reason==="INVALID_SELECTION_TRANSITION"?errors.invalidSelection:errors.actionFailed;
  return <div role="alert" className="engagement-error"><strong>{message}</strong>{state.blockers.length?<p>{copy.blockers}: {state.blockers.join(", ")}</p>:null}</div>;
}

export const isSelectionSubmissionDisabled=(persisted:EngagementSelectionState,selected:EngagementSelectionState,pending:boolean)=>pending||selected===persisted;
export const isContactSubmissionDisabled=(routeId:string,outcome:string,pending:boolean)=>pending||!routeId||!outcome;
export const isResponseSubmissionDisabled=(persisted:string,selected:string,pending:boolean)=>pending||selected===persisted;
export const isAvailabilitySubmissionDisabled=(persistedState:string,persistedFrom:string,persistedUntil:string,selectedState:string,selectedFrom:string,selectedUntil:string,pending:boolean)=>pending||(selectedState==="CONFIRMED_AVAILABLE"&&!selectedFrom)||(selectedState===persistedState&&selectedFrom===persistedFrom&&selectedUntil===persistedUntil);
export const isResolutionSubmissionDisabled=(persistedCompensation:string,persistedTravel:string,selectedCompensation:string,selectedTravel:string,pending:boolean)=>pending||(selectedCompensation===persistedCompensation&&selectedTravel===persistedTravel);
export const formatCalendarDateForInput=(value:Date|null)=>value===null||Number.isNaN(value.getTime())?"":`${value.getFullYear().toString().padStart(4,"0")}-${(value.getMonth()+1).toString().padStart(2,"0")}-${value.getDate().toString().padStart(2,"0")}`;
export const confirmWorkerEngagementCommand=(message:string,confirmAction:(message:string)=>boolean)=>confirmAction(message);
export const preventImplicitWorkerEngagementSubmit=(event:{preventDefault:()=>void})=>event.preventDefault();
export function activateWorkerEngagementCommand(action:Action,formData:FormData,confirmation?:string,confirmAction?:(message:string)=>boolean){
  if(confirmation&&(!confirmAction||!confirmWorkerEngagementCommand(confirmation,confirmAction)))return false;
  startTransition(()=>action(formData));
  return true;
}

function SelectionCommandForm({action,hidden,engagement,label,pending}:SharedFormProps){
  const [selectedValue,setSelectedValue]=useState<EngagementSelectionState>(engagement.selectionState);
  return <CommandForm action={action} hidden={hidden} command="SET_SELECTION" label={label} pending={pending} disabled={isSelectionSubmissionDisabled(engagement.selectionState,selectedValue,pending)}><select name="state" value={selectedValue} onChange={event=>setSelectedValue(event.target.value as EngagementSelectionState)}>{["REVIEWING","SHORTLISTED","SELECTED","NOT_SELECTED"].map(value=><option key={value}>{value}</option>)}</select></CommandForm>;
}

function ContactCommandForm({action,hidden,label,routeLabel,outcomeLabel,chooseOutcomeLabel,contactChoices,pending}:{readonly action:Action;readonly hidden:React.ReactNode;readonly label:string;readonly routeLabel:string;readonly outcomeLabel:string;readonly chooseOutcomeLabel:string;readonly contactChoices:WorkerDemandEngagementUi["contactChoices"];readonly pending:boolean}){
  const [routeId,setRouteId]=useState(contactChoices[0]?.id??""),[outcome,setOutcome]=useState("");
  return <CommandForm action={action} hidden={hidden} command="RECORD_CONTACT" label={label} pending={pending} disabled={isContactSubmissionDisabled(routeId,outcome,pending)}><label>{routeLabel}<select name="routeId" value={routeId} onChange={event=>setRouteId(event.target.value)} required>{contactChoices.map(route=><option value={route.id} key={route.id}>{route.routeType} · {route.target}</option>)}</select></label><label>{outcomeLabel}<select name="outcome" value={outcome} onChange={event=>setOutcome(event.target.value)} required><option value="" disabled>{chooseOutcomeLabel}</option>{["NO_ANSWER","VOICEMAIL_LEFT","MESSAGE_SENT","EMAIL_SENT","WRONG_ROUTE","CONVERSATION_COMPLETED","RESPONSE_RECEIVED"].map(value=><option key={value}>{value}</option>)}</select></label></CommandForm>;
}

function ResponseCommandForm({action,hidden,engagement,label,pending}:SharedFormProps){
  const [selected,setSelected]=useState(engagement.responseState);
  return <CommandForm action={action} hidden={hidden} command="RECORD_RESPONSE" label={label} pending={pending} disabled={isResponseSubmissionDisabled(engagement.responseState,selected,pending)}><select name="state" value={selected} onChange={event=>setSelected(event.target.value as typeof selected)}>{["UNKNOWN","NO_RESPONSE","NEEDS_INFORMATION","INTERESTED","NOT_INTERESTED"].map(value=><option key={value}>{value}</option>)}</select></CommandForm>;
}

function AvailabilityCommandForm({action,hidden,engagement,label,fromLabel,untilLabel,pending}:SharedFormProps&{readonly fromLabel:string;readonly untilLabel:string}){
  const persistedFrom=formatCalendarDateForInput(engagement.availableFrom),persistedUntil=formatCalendarDateForInput(engagement.availableUntil);
  const [selectedState,setSelectedState]=useState(engagement.demandAvailabilityState),[selectedFrom,setSelectedFrom]=useState(persistedFrom),[selectedUntil,setSelectedUntil]=useState(persistedUntil);
  const disabled=isAvailabilitySubmissionDisabled(engagement.demandAvailabilityState,persistedFrom,persistedUntil,selectedState,selectedFrom,selectedUntil,pending);
  return <CommandForm action={action} hidden={hidden} command="SET_AVAILABILITY" label={label} pending={pending} disabled={disabled}><select name="state" value={selectedState} onChange={event=>setSelectedState(event.target.value as typeof selectedState)}>{["UNKNOWN","CONFIRMED_AVAILABLE","CONFIRMED_UNAVAILABLE"].map(value=><option key={value}>{value}</option>)}</select><label>{fromLabel}<input name="availableFrom" type="date" value={selectedFrom} onChange={event=>setSelectedFrom(event.target.value)} required={selectedState==="CONFIRMED_AVAILABLE"}/></label><label>{untilLabel}<input name="availableUntil" type="date" value={selectedUntil} onChange={event=>setSelectedUntil(event.target.value)}/></label></CommandForm>;
}

function ResolutionCommandForm({action,hidden,engagement,label,pending}:SharedFormProps){
  const [compensation,setCompensation]=useState(engagement.compensationResolutionState),[travel,setTravel]=useState(engagement.travelResolutionState);
  const values=["UNKNOWN","NOT_REQUIRED","COMPATIBLE","ACCEPTED_CONFLICT","UNRESOLVED_CONFLICT"];
  return <CommandForm action={action} hidden={hidden} command="SET_RESOLUTIONS" label={label} pending={pending} disabled={isResolutionSubmissionDisabled(engagement.compensationResolutionState,engagement.travelResolutionState,compensation,travel,pending)}><select name="compensation" value={compensation} onChange={event=>setCompensation(event.target.value as typeof compensation)}>{values.map(value=><option key={value}>{value}</option>)}</select><select name="travel" value={travel} onChange={event=>setTravel(event.target.value as typeof travel)}>{values.map(value=><option key={value}>{value}</option>)}</select></CommandForm>;
}

function CommandForm({action,hidden,command,label,pending,disabled=false,confirmation,children=null}:{readonly action:Action;readonly hidden:React.ReactNode;readonly command:string;readonly label:string;readonly pending:boolean;readonly disabled?:boolean;readonly confirmation?:string;readonly children?:React.ReactNode}){
  return <form action={action} className="engagement-command" onSubmit={preventImplicitWorkerEngagementSubmit}><h6>{label}</h6>{hidden}<input type="hidden" name="command" value={command}/><div>{children}</div><button type="button" disabled={pending||disabled} onClick={event=>{const form=event.currentTarget.form;if(form)activateWorkerEngagementCommand(action,new FormData(form),confirmation,window.confirm);}}>{label}</button></form>;
}
