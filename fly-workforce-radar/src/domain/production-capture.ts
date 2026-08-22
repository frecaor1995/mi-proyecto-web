import type { ProductionCaptureResult, ProductionSourceAdapter } from "./production-source";

export type ProductionObservationKind = "WORKFORCE_DEMAND" | "PROJECT_PROCUREMENT";
export interface ProductionObservation {
  kind: ProductionObservationKind; title: string | null; organization: string | null; location: string | null;
  sourceUrl: string; externalId: string; facts: Record<string, string | number | boolean | null>;
}
export interface CapturedProductionPage { result: Extract<ProductionCaptureResult,{status:"CAPTURED"}>; payload:string; observations:ProductionObservation[] }
export interface ProductionPageAdapter extends ProductionSourceAdapter { capturePage(request: Parameters<ProductionSourceAdapter["capture"]>[0]):Promise<CapturedProductionPage> }
export interface PublicTransport { get(url:string):Promise<{status:number;url:string;contentType:string|null;body:string;headers:Record<string,string>}> }
