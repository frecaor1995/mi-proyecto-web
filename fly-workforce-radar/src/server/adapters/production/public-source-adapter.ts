import type { CapturedProductionPage, ProductionObservation, PublicTransport } from "../../../domain/production-capture";
import type { ProductionAdapterDescriptor, ProductionCaptureRequest, ProductionCaptureResult, ProductionSourceAdapter } from "../../../domain/production-source";

export abstract class PublicSourceAdapter implements ProductionSourceAdapter {
  abstract readonly descriptor: ProductionAdapterDescriptor;
  constructor(protected readonly transport:PublicTransport, protected readonly url:string){}
  protected abstract parse(html:string,url:string):ProductionObservation[];
  async capturePage(request:ProductionCaptureRequest):Promise<CapturedProductionPage>{
    const response=await this.transport.get(this.url);
    if(response.status<200||response.status>=300)throw new Error(`HTTP ${response.status}`);
    const observations=this.parse(response.body,response.url);
    const result={status:"CAPTURED" as const,executionId:request.executionId,capturedIdentifier:observations[0]?.externalId??response.url,capturedUrl:response.url,capturedAt:request.asOf,contentType:response.contentType,contentReference:response.url,httpMetadata:{status:response.status,headers:response.headers},externalIdentifiers:Object.fromEntries(observations.map((o,i)=>[String(i),o.externalId])),nextCursor:null};
    return{result,payload:response.body,observations};
  }
  async capture(request:ProductionCaptureRequest):Promise<ProductionCaptureResult>{return(await this.capturePage(request)).result}
}
export const plainText=(html:string)=>html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
export const match=(text:string,re:RegExp)=>text.match(re)?.[1]?.trim()??null;
