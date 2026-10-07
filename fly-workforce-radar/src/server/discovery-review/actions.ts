"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorizeOperator } from "../auth/authorization";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import { PostgresOpportunityRepository } from "../repositories/opportunity/postgres-opportunity-repository";
import { OpportunityService } from "../services/opportunity/opportunity-service";
import { COMPANY_REVIEW_OUTCOMES, DEMAND_REVIEW_OUTCOMES, recordCompanyReview, recordDemandReview, type CompanyReviewOutcome, type DemandReviewOutcome } from "./discovery-review-workflow";

export interface DiscoveryReviewActionState { readonly status:"IDLE"|"SAVED"|"REJECTED"; readonly error:string|null }
const rejected=(error:string):DiscoveryReviewActionState=>({status:"REJECTED",error});
const text=(data:FormData,key:string)=>{const value=data.get(key);return typeof value==="string"?value.trim():""};
const refresh=(candidateId:string)=>{revalidatePath("/radar/intelligence");revalidatePath(`/radar/${candidateId}`);};

export async function companyReviewAction(_state:DiscoveryReviewActionState,data:FormData):Promise<DiscoveryReviewActionState>{
  const candidateId=text(data,"candidateId"),outcome=text(data,"outcome") as CompanyReviewOutcome,reason=text(data,"reason").slice(0,2000);
  if(!candidateId||!COMPANY_REVIEW_OUTCOMES.includes(outcome)||!reason)return rejected("Complete the decision and reason before confirming.");
  const auth=await authorizeOperator("human_verification.write");if(auth.state!=="AUTHORIZED")return rejected("This action requires Human Verification permission.");
  const runner=getProductionTransactionRunner();if(!runner)return rejected("The governed local database is unavailable.");
  try{await runner(client=>recordCompanyReview(client,{candidateId,outcome,selectedCompanyId:text(data,"companyId"),companyName:text(data,"companyName"),reason,operatorId:auth.operator.operatorId,now:new Date()}));refresh(candidateId);return{status:"SAVED",error:null};}
  catch(error){return rejected(error instanceof Error?error.message:"Company review could not be saved.");}
}

export async function demandReviewAction(_state:DiscoveryReviewActionState,data:FormData):Promise<DiscoveryReviewActionState>{
  const candidateId=text(data,"candidateId"),outcome=text(data,"outcome") as DemandReviewOutcome,reason=text(data,"reason").slice(0,2000);
  if(!candidateId||!DEMAND_REVIEW_OUTCOMES.includes(outcome)||!reason)return rejected("Complete the decision and reason before confirming.");
  const auth=await authorizeOperator("human_verification.write");if(auth.state!=="AUTHORIZED")return rejected("This action requires Human Verification permission.");
  const runner=getProductionTransactionRunner();if(!runner)return rejected("The governed local database is unavailable.");
  try{await runner(client=>recordDemandReview(client,{candidateId,outcome,reason,operatorId:auth.operator.operatorId,now:new Date()}));refresh(candidateId);return{status:"SAVED",error:null};}
  catch(error){return rejected(error instanceof Error?error.message:"Demand review could not be saved.");}
}

export async function promoteVerifiedDemandAction(_state:DiscoveryReviewActionState,data:FormData):Promise<DiscoveryReviewActionState>{
  const candidateId=text(data,"candidateId");if(!candidateId)return rejected("Invalid review case.");
  const auth=await authorizeOperator("human_verification.write");if(auth.state!=="AUTHORIZED")return rejected("This action requires Human Verification permission.");
  const runner=getProductionTransactionRunner();if(!runner)return rejected("The governed local database is unavailable.");
  let opportunityId:string;
  try{opportunityId=await runner(async client=>{
    const row=await client.query<{demand_signal_id:string;company_id:string;evidence_id:string;title:string;opportunity_id:string|null}>(`select x.demand_signal_id,d.publisher_company_id company_id,d.raw_evidence_id evidence_id,d.title,ods.opportunity_id
      from discovery_observation_demand_signals x join demand_signals d on d.id=x.demand_signal_id
      join lateral(select decision from human_verification_decisions where target_type='DEMAND_SIGNAL' and target_id=d.id order by decided_at desc,created_at desc limit 1)h on h.decision='VERIFY'
      left join opportunity_demand_signals ods on ods.demand_signal_id=d.id where x.candidate_id=$1 order by h.decided_at desc limit 1`,[candidateId]);
    const item=row.rows[0];if(!item)throw new Error("Verify the canonical demand before promotion.");if(item.opportunity_id)return item.opportunity_id;
    const created=await new OpportunityService(new PostgresOpportunityRepository(client)).create({demandSignalIds:[item.demand_signal_id],companyId:item.company_id,unresolvedCompanyContext:null,projectId:null,title:item.title,evidenceIds:[item.evidence_id],observedAt:new Date(),staleAfter:null,metadata:{origin:"DISCOVERY_HUMAN_REVIEW",actorOperatorId:auth.operator.operatorId}});return created.id;
  });}
  catch(error){return rejected(error instanceof Error?error.message:"Promotion could not be completed.");}
  refresh(candidateId);redirect(`/opportunities/${opportunityId}`);
}
