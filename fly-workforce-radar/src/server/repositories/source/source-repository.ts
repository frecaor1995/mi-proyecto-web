import type {
  CaptureMethod,
  CapturePolicyDecisionRecord,
  CreateSourceInput,
  RecordCapturePolicyDecisionInput,
  SourceHealthStatus,
  SourceRecord,
  SourceYieldMeasurementInput,
} from "../../../domain/source";

export interface SourceRepository {
  create(input: CreateSourceInput): Promise<SourceRecord>;
  getById(id: string): Promise<SourceRecord | null>;
  /** 3I-B3 addition: no name-based lookup existed on this repository before. */
  findByName(name: string): Promise<SourceRecord | null>;
  getCurrentDecision(sourceId: string, method: CaptureMethod): Promise<CapturePolicyDecisionRecord | null>;
  listDecisionHistory(sourceId: string, method: CaptureMethod): Promise<CapturePolicyDecisionRecord[]>;
  recordDecision(input: RecordCapturePolicyDecisionInput): Promise<CapturePolicyDecisionRecord>;
  recordHealth(sourceId: string, status: SourceHealthStatus, observedAt: Date, reason?: string): Promise<string>;
  recordYield(input: SourceYieldMeasurementInput): Promise<string>;
}
