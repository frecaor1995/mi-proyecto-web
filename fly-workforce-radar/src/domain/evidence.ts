export const EVIDENCE_STATUSES = ["ACTIVE", "SUPERSEDED", "INVALID"] as const;
export const EVIDENCE_LINK_TYPES = ["SUPPORTS", "DERIVED_FROM", "OBSERVED_IN"] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export type EvidenceLinkType = (typeof EVIDENCE_LINK_TYPES)[number];
export type CapturedPayload = string | Uint8Array;

export interface EvidenceCaptureInput {
  sourceId: string;
  sourceUrl: string;
  capturedAt: Date;
  captureMethod: string;
  payload: CapturedPayload;
  contentType?: string;
  extractorVersion?: string;
  storageReference?: string;
  httpMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CreateEvidenceRecord {
  sourceId: string;
  sourceUrl: string;
  capturedAt: Date;
  captureMethod: string;
  contentHash: string;
  payloadSizeBytes: number;
  contentType?: string;
  extractorVersion?: string;
  storageReference?: string;
  httpMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface EvidenceRecord {
  id: string;
  sourceId: string;
  sourceUrl: string;
  capturedAt: Date;
  captureMethod: string;
  contentHash: string;
  payloadSizeBytes: number | null;
  contentType: string | null;
  extractorVersion: string | null;
  storageReference: string | null;
  httpMetadata: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export type EvidenceTarget =
  | { kind: "DEMAND_SIGNAL"; id: string }
  | { kind: "CLAIM"; id: string }
  | { kind: "COMPANY_ROLE"; id: string }
  | { kind: "VENDOR_ROUTE"; id: string }
  | { kind: "CONTACT_PERSON"; id: string }
  | { kind: "CONTACT_ROUTE"; id: string }
  | { kind: "PROJECT"; id: string }
  | { kind: "OPPORTUNITY"; id: string };

export interface EvidenceLinkRecord {
  id: string;
  evidenceId: string;
  linkType: EvidenceLinkType;
  target: EvidenceTarget;
  createdAt: Date;
}
