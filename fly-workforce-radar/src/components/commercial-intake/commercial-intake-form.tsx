"use client";
import { useActionState, useMemo, useState } from "react";
import type { Locale } from "../../i18n/locale";
import type { WorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import { activateCommercialIntakeAction, type CommercialIntakeActionState } from "../../server/commercial-intake/actions";
import { commercialIntakeCopy } from "./commercial-intake-copy";
import { COMMERCIAL_INTAKE_SOURCE_TYPES } from "../../domain/commercial-intake";

const initial:CommercialIntakeActionState={error:null,fieldErrors:{}};
export function CommercialIntakeForm({locale,taxonomy,idempotencyKey}:{readonly locale:Locale;readonly taxonomy:WorkforceTaxonomy;readonly idempotencyKey:string}){
  const copy=commercialIntakeCopy[locale], [state,action,pending]=useActionState(activateCommercialIntakeAction,initial);
  const [trade,setTrade]=useState(""), occupations=useMemo(()=>taxonomy.occupations.filter(item=>item.tradeCode===trade),[taxonomy.occupations,trade]);
  const label=(item:{labelEn:string;labelEs?:string})=>locale==="es-US"?(item.labelEs??item.labelEn):item.labelEn;
  return <form action={action} className="workforce-form commercial-intake-form">
    <input type="hidden" name="idempotencyKey" value={idempotencyKey}/>
    <p className="detail-honest-empty">{copy.honest}</p>
    <fieldset><legend>{copy.source}</legend>
      <label><span>{copy.sourceType}</span><select name="sourceType" defaultValue="PHONE_CALL">{COMMERCIAL_INTAKE_SOURCE_TYPES.map(value=><option value={value} key={value}>{copy[value]}</option>)}</select></label>
      <label><span>{copy.reference}</span><input name="sourceReference" type="text" maxLength={500}/></label>
      <label><span>{copy.evidence}</span><textarea name="evidenceSummary" required rows={4} maxLength={4000}/></label>
    </fieldset>
    <fieldset><legend>{copy.opportunity}</legend>
      <label><span>{copy.customer}</span><input name="customerName" required maxLength={200}/></label>
      <label><span>{copy.opportunity}</span><input name="opportunityTitle" required maxLength={240}/></label>
      <label><span>{copy.project}</span><input name="projectName" maxLength={240}/></label>
      <label><span>{copy.city}</span><input name="city" maxLength={120}/></label>
      <label><span>{copy.state}</span><input name="state" maxLength={80}/></label>
    </fieldset>
    <fieldset><legend>{copy.demand}</legend>
      <label><span>{copy.trade}</span><select name="tradeCode" required value={trade} onChange={event=>setTrade(event.target.value)}><option value="">—</option>{taxonomy.trades.map(item=><option value={item.code} key={item.code}>{label(item)}</option>)}</select></label>
      <label><span>{copy.occupation}</span><select name="occupationCode" required defaultValue="" key={trade}><option value="">—</option>{occupations.map(item=><option value={item.code} key={item.code}>{label(item)}</option>)}</select></label>
      <label><span>{copy.headcount}</span><input name="headcount" required type="number" min={1} step={1}/></label>
      <label><span>{copy.experience}</span><input name="minimumExperienceMonths" type="number" min={0} step={1}/></label>
      <label><span>{copy.start}</span><input name="startDate" type="date"/></label>
      <label><span>{copy.schedule}</span><input name="schedule" maxLength={240}/></label>
    </fieldset>
    <fieldset><legend>{copy.requirements}</legend>
      <RequirementOptions name="skills" title={copy.skills} options={taxonomy.skills} label={label} copy={copy}/>
      <RequirementOptions name="credentials" title={copy.credentials} options={taxonomy.credentials} label={label} copy={copy}/>
    </fieldset>
    {state.error?<p role="alert" className="workforce-form-error">{state.error==="restricted"?copy.restricted:state.error==="unavailable"?copy.unavailable:copy.invalid}</p>:null}
    <button type="submit" disabled={pending}>{pending?copy.pending:copy.activate}</button>
  </form>;
}
function RequirementOptions({name,title,options,label,copy}:{name:string;title:string;options:readonly {code:string;labelEn:string;labelEs?:string}[];label:(item:{labelEn:string;labelEs?:string})=>string;copy:Record<string,string>}){
  return <div className="intake-requirements"><h3>{title}</h3>{options.map(item=><label key={item.code}><span>{label(item)}</span><select name={name} defaultValue=""><option value="">{copy.none}</option><option value={`${item.code}|REQUIRED`}>{copy.required}</option><option value={`${item.code}|PREFERRED`}>{copy.preferred}</option></select></label>)}</div>;
}
