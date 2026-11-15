import type { ProductionObservation,PublicTransport } from "../../../domain/production-capture";
import type { ExpandedSourceDefinition } from "../../../domain/multi-source";
import type { SourceCapability } from "../../../domain/production-source";
import { PublicSourceAdapter,match,plainText } from "./public-source-adapter";
export class ExpandedPublicSourceAdapter extends PublicSourceAdapter {
 readonly descriptor;
 constructor(t:PublicTransport,readonly definition:ExpandedSourceDefinition){super(t,definition.endpoint);this.descriptor={adapterId:definition.adapterId,version:"1.0.0",sourceId:definition.key,sourceFamily:definition.family,captureMethod:"STATIC_HTML"as const,capabilities:definition.capabilities as SourceCapability[],executionRequirements:["public-page","robots-reviewed","rate-limit"],parser:{id:definition.parserId,version:"1.0.0"}}}
 protected parse(h:string,u:string):ProductionObservation[]{const x=plainText(h),title=match(x,this.definition.titlePattern)??match(h,this.definition.titlePattern),organization=match(x,this.definition.organizationPattern)??match(h,this.definition.organizationPattern);if(!title||!organization)return[];return[{kind:this.definition.kind,title,organization,location:this.definition.locationPattern?(match(x,this.definition.locationPattern)??match(h,this.definition.locationPattern)):null,sourceUrl:u,externalId:`${this.definition.key}:${title.toLowerCase().replace(/\s+/g,"-")}`,facts:{verificationState:"UNVERIFIED",af01Candidate:this.definition.kind==="STAFFING_INTELLIGENCE"?true:null,vendorRoute:this.definition.kind==="VENDOR_ROUTE"?title:null}}]}
}
