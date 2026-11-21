import type { NormalizedDemandSignal } from "../../domain/ingestion";
import type { ProductionPageAdapter } from "../../domain/production-capture";
import type { ProductionCaptureRequest, ProductionSourceProfile, StructuredSourceFailure } from "../../domain/production-source";
import type { EvidenceRepository } from "../repositories/evidence/evidence-repository";
import type { IngestionRepository } from "../repositories/ingestion/ingestion-repository";
import type { ProductionCapturePersistence } from "../repositories/production-source/production-source-repository";
import type { EvidenceCaptureService } from "../services/evidence/capture-evidence";
import { canExecuteLive, deterministicObservationIdentity, structuredFailure } from "../services/production-source/production-source-policy";

export class ProductionCaptureIngestion {
  constructor(private evidence:EvidenceCaptureService,private persistence:ProductionCapturePersistence,private demand?:IngestionRepository,private evidenceRepository?:EvidenceRepository){}
  async run(sourceId:string,adapter:ProductionPageAdapter,request:ProductionCaptureRequest,profile:ProductionSourceProfile,policy:"ALLOW"|"DENY"|"REVIEW_REQUIRED"){
    const started=new Date();await this.persistence.registerAdapter(adapter.descriptor);
    if(!canExecuteLive(profile,policy,request.asOf)){const classification=policy==="DENY"?"COMPLIANCE_BLOCKED":"ACCESS_BLOCKED";const failure=structuredFailure(classification,`Execution denied: readiness=${profile.readiness}, policy=${policy}`,request.asOf);await this.persistence.recordFailure({...this.base(sourceId,adapter,request,profile,started),failure});return{status:"FAILED"as const,failure}}
    try{
      const page=await adapter.capturePage(request);if(!page.observations.length)throw structuredFailure("INVALID_CONTENT","No explicitly supported observations",request.asOf);
      const evidence=await this.evidence.capture({sourceId,sourceUrl:page.result.capturedUrl!,capturedAt:page.result.capturedAt,captureMethod:"HTTP_FETCH",payload:page.payload,contentType:page.result.contentType??undefined,extractorVersion:adapter.descriptor.parser.version,httpMetadata:page.result.httpMetadata,metadata:{adapterId:adapter.descriptor.adapterId,externalIdentifiers:page.result.externalIdentifiers,requestedTarget:request.requestedTarget}});
      const observationIds=await this.persistence.record({...this.base(sourceId,adapter,request,profile,started),capturedTarget:page.result.capturedUrl,evidenceId:evidence.id,contentHash:evidence.contentHash,capturedIdentifier:page.result.capturedIdentifier,observations:page.observations});
      let demandSignalId:string|null=null;const workforce=page.observations.find(o=>o.kind==="WORKFORCE_DEMAND"&&o.title);
      if(workforce&&this.demand&&this.evidenceRepository){const signal:NormalizedDemandSignal={externalPostingId:workforce.externalId,originalTitle:workforce.title!,roleType:/journeyman/i.test(workforce.title!)?"JOURNEYMAN_ELECTRICIAN":"OTHER",unresolvedPublisherName:workforce.organization,publisherType:null,city:workforce.location?.split(",")[0]??null,county:null,state:/texas|\btx\b/i.test(workforce.location??"")?"TX":null,payCurrency:null,basePayMin:null,basePayMax:null,payPeriod:null,overtimeAvailable:null,overtimeTerms:null,perDiemAvailable:null,perDiemAmount:null,perDiemFrequency:null,schedule:null,headcountEstimate:null,publishedAt:null,sourceCompensationText:null,metadata:{productionExecutionId:request.executionId,productionObservationId:observationIds[0]??null}};const identity=deterministicObservationIdentity(sourceId,workforce.externalId,page.result.capturedIdentifier,evidence.contentHash);demandSignalId=await this.demand.upsertDemandSignal({sourceId,rawEvidenceId:evidence.id,sourceIdentityKey:identity,parserVersion:adapter.descriptor.parser.version,observedAt:page.result.capturedAt,signal});await this.evidenceRepository.link(evidence.id,{kind:"DEMAND_SIGNAL",id:demandSignalId},"DERIVED_FROM")}
      return{status:"SUCCESS"as const,evidence,observations:page.observations,observationIds,demandSignalId};
    }catch(error){const failure=this.failure(error,request.asOf);await this.persistence.recordFailure({...this.base(sourceId,adapter,request,profile,started),failure});return{status:"FAILED"as const,failure}}
  }
  private base(sourceId:string,adapter:ProductionPageAdapter,request:ProductionCaptureRequest,profile:ProductionSourceProfile,startedAt:Date){return{executionId:request.executionId,sourceId,descriptor:adapter.descriptor,policyDecisionId:request.policyDecisionId,readiness:profile.readiness,requestedTarget:request.requestedTarget,startedAt,endedAt:request.asOf}}
  private failure(error:unknown,at:Date):StructuredSourceFailure{if(error&&typeof error==="object"&&"classification"in error)return error as StructuredSourceFailure;const message=error instanceof Error?error.message:"Capture failed",status=message.match(/HTTP (\d+)/)?.[1];return structuredFailure(status==="429"?"RATE_LIMITED":"HTTP_FAILURE",message,at,status?Number(status):null)}
}
