"use server";
import { revalidatePath } from "next/cache";
import { authorizeOperator } from "../auth/authorization";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import type { EnrichmentInput } from "../../domain/contact-enrichment";
import { confirmEnrichment } from "./enrichment-service";

export interface EnrichmentActionState{readonly state:"IDLE"|"DONE"|"INVALID"|"RESTRICTED"|"UNAVAILABLE"|"FAILED";readonly detail:string|null}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function confirmEnrichmentAction(_:EnrichmentActionState,formData:FormData):Promise<EnrichmentActionState>{
 try{const auth=await authorizeOperator("company_discovery.run");if(auth.state!=="AUTHORIZED")return{state:"RESTRICTED",detail:null};const companyId=String(formData.get("companyId")??"");if(!UUID.test(companyId))return{state:"INVALID",detail:"company"};const rows=JSON.parse(String(formData.get("rows")??"[]")) as EnrichmentInput[];if(!Array.isArray(rows)||rows.length<1||rows.length>100)return{state:"INVALID",detail:"rows"};const provider=String(formData.get("provider")??"OTHER").trim().slice(0,80)||"OTHER";const mode=formData.get("mode")==="CSV"?"CSV":"MANUAL";const hash=String(formData.get("fileHash")??"")||null;if(hash&&!/^[0-9a-f]{64}$/.test(hash))return{state:"INVALID",detail:"hash"};const tx=getProductionTransactionRunner();if(!tx)return{state:"UNAVAILABLE",detail:null};const result=await tx(client=>confirmEnrichment(client,{companyId,operatorId:auth.operator.operatorId,mode,provider,filename:String(formData.get("filename")??"").slice(0,255)||null,fileHash:hash,mapping:JSON.parse(String(formData.get("mapping")??"{}")),rows}));revalidatePath(`/companies/${companyId}`);revalidatePath(`/companies/${companyId}/enrichment`);return{state:"DONE",detail:`${result.confirmed} confirmed · ${result.review} held for review · batch ${result.batchId}`};}catch(error){return{state:"FAILED",detail:error instanceof Error?error.message:"Unknown failure"};}
}
