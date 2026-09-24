"use server";
import { redirect } from "next/navigation";
import type { CommercialIntakeInput, CommercialIntakeSourceType } from "../../domain/commercial-intake";
import type { DemandRequirementLevel } from "../../domain/demand-matching";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import { CommercialIntakeService } from "../services/commercial-intake/commercial-intake-service";

export interface CommercialIntakeActionState { readonly error: "invalid"|"restricted"|"unavailable"|null; readonly fieldErrors: Readonly<Record<string,string>> }
const text=(data:FormData,key:string)=>{const value=data.get(key);return typeof value==="string"?value.trim():""};
const optional=(data:FormData,key:string)=>text(data,key)||null;
const numberOrNull=(value:string)=>value===""?null:Number(value);
function requirements(data:FormData, key:string) {
  return data.getAll(key).flatMap((raw) => {
    if(typeof raw!=="string")return [];
    const [code,level]=raw.split("|");
    return code&&(level==="REQUIRED"||level==="PREFERRED")?[{code,level:level as DemandRequirementLevel}]:[];
  });
}
export async function activateCommercialIntakeAction(_previous:CommercialIntakeActionState,data:FormData):Promise<CommercialIntakeActionState>{
  const input:CommercialIntakeInput={
    idempotencyKey:text(data,"idempotencyKey"),sourceType:text(data,"sourceType") as CommercialIntakeSourceType,
    sourceReference:optional(data,"sourceReference"),evidenceSummary:text(data,"evidenceSummary"),customerName:text(data,"customerName"),
    opportunityTitle:text(data,"opportunityTitle"),projectName:optional(data,"projectName"),city:optional(data,"city"),state:optional(data,"state"),
    tradeCode:text(data,"tradeCode"),occupationCode:text(data,"occupationCode"),headcount:Number(text(data,"headcount")),
    minimumExperienceMonths:numberOrNull(text(data,"minimumExperienceMonths")),startDate:optional(data,"startDate"),schedule:optional(data,"schedule"),
    skills:requirements(data,"skills"),credentials:requirements(data,"credentials"),
  };
  const result=await new CommercialIntakeService({transactionRunner:getProductionTransactionRunner()}).activate(input);
  if(result.kind==="ACTIVATED")redirect(`/opportunities/${encodeURIComponent(result.value.opportunityId)}`);
  if(result.kind==="VALIDATION_ERROR")return{error:"invalid",fieldErrors:result.errors};
  if(result.kind==="UNAVAILABLE")return{error:"unavailable",fieldErrors:{}};
  return{error:"restricted",fieldErrors:{}};
}
